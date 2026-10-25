import cloudConfig from './cloud-config.mjs';

// This page only reads the public snapshot endpoint. It never loads a draft,
// an editor session, or the browser's former local bulletin data.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateLabel=value=>new Date(value+'T12:00:00Z').toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});
const row=(label,value)=>`<div class="public-row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
const prose=(title,body)=>`<section class="public-card"><h2>${esc(title)}</h2><p class="public-prose">${esc(body)||'등록된 내용이 없습니다.'}</p></section>`;
const money=cents=>'$'+(cents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const cents=value=>{const [whole,fraction='']=String(value).split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));};
let issues=[],selectedId='',renderedKey='',fetching=false,checkedAt=null,previewRun=0;
let pdfKey='',pdfPromise=null,pdfLibrary=null;
const initialId=new URL(location.href).searchParams.get('issue');

document.title='KPCSTL · 주일 주보';
document.body.classList.add('public-page');
document.body.innerHTML=`
  <a class="skip" href="#public-main">본문으로 이동</a>
  <header class="public-masthead"><a class="public-brand" href="./"><span aria-hidden="true">✦</span><span>KPCSTL<small>세인트루이스 한인장로교회</small></span></a><a class="public-editor-link" href="${cloudConfig.openEditing?'./':'studio.html'}">주보 편집 <span aria-hidden="true">↗</span></a></header>
  <main id="public-main" tabindex="-1">
    <div class="public-intro"><div><p class="public-kicker">SUNDAY BULLETIN</p><h1>함께 예배하는 주일</h1><p>말씀과 교회 소식을 한곳에서 만나보세요.</p></div><label class="public-archive" hidden><span>지난 주보 보기</span><select id="public-archive" aria-label="주보 날짜 선택"></select></label></div>
    <div class="public-connection" role="status" aria-live="polite"><span id="public-status">공개된 주보를 불러오고 있습니다…</span><button class="public-refresh" type="button" data-public="refresh">새로고침</button></div>
    <div id="public-notice" role="status" hidden></div>
    <div id="public-content" aria-busy="true"><section class="public-empty"><span aria-hidden="true">✦</span><h2>주보를 불러오는 중입니다.</h2></section></div>
  </main>
  <footer class="public-footer"><strong>세인트루이스 한인장로교회</strong><span>Korean Presbyterian Church of St. Louis</span><a href="${cloudConfig.openEditing?'./':'studio.html'}">교역자 · 주보 편집</a></footer>`;
const $=selector=>document.querySelector(selector);

function issueMarkup(i){
  const w=i.worship,s=i.sections,r=i.roster,m=i.midweek;
  const worship=[['1부 예배',w.service1],['2부 예배',w.service2],['예배로의 부름',w.call],['송영',w.doxology],['신앙고백',w.confession],['1부 찬양',w.hymn1],['2부 찬양',w.praise2],['1부 대표기도',w.prayer1],['2부 대표기도',w.prayer2],['성경봉독',i.sermon.scripture],['설교',i.sermon.preacher],['드림과 헌신',w.giving],['교회소식','Announcements'],['폐회찬양',w.closing],['축도',w.benediction]];
  const offering=[['십일조','tithe'],['주일헌금','sunday'],['감사헌금','thanks'],['주일학교','school'],['선교헌금','mission'],['장학헌금','scholarship'],['구제헌금','relief']];
  const total=offering.reduce((sum,[,key])=>sum+cents(i.offering[key]),0);
  return `<article aria-labelledby="public-bulletin-date">
    <header class="public-cover"><div class="public-cover-top"><span class="public-final">공개 주보</span><span>주일예배 · v${esc(i.revision)}</span></div><h2 id="public-bulletin-date">${esc(dateLabel(i.date))}</h2><div class="public-cover-rule"></div><p class="public-cover-label">이번 주 말씀</p><h3>${esc(i.sermon.title)||'주일 말씀'}</h3><p class="public-scripture">${esc(i.sermon.scripture)}</p><p class="public-preacher">${esc(i.sermon.preacher)}</p><div class="public-service-times"><span>1부 ${esc(w.service1)}</span><span>2부 ${esc(w.service2)}</span></div></header>
    <div class="public-tools"><p>확정된 주보를 모든 기기에서 함께 볼 수 있습니다.</p><div><button class="btn" type="button" data-public="preview" aria-expanded="false" aria-controls="public-pdf">인쇄 미리보기</button><button class="btn primary" type="button" data-public="download">PDF 저장</button></div></div>
    <p id="public-download-status" class="public-download-status" role="status" hidden></p>
    <section id="public-pdf" class="public-pdf" aria-label="주보 인쇄 미리보기" hidden><div class="public-pdf-heading"><h2>인쇄 미리보기</h2><button class="btn" type="button" data-public="close-preview">닫기</button></div><p id="public-pdf-status" role="status"></p><div id="public-pdf-warnings"></div><div id="public-pdf-pages" class="print-pages"></div></section>
    <div class="public-grid"><section class="public-card"><h2>주일예배 순서</h2><dl class="public-rows">${worship.map(([a,b])=>row(a,b)).join('')}</dl></section>
    <section class="public-card public-announcements"><h2>교회 소식</h2>${i.announcements.map((a,n)=>`<div class="public-item"><h3><span class="public-number">${n+1}.</span> ${esc(a.title)}</h3><p class="public-prose">${esc(a.body)}</p></div>`).join('')||'<p>등록된 소식이 없습니다.</p>'}</section>
    <section class="public-card"><h2>예배 봉사자</h2><dl class="public-rows">${row('대표기도 · '+r.date1,'1부 '+r.prayer11+'\n2부 '+r.prayer21)}${row('대표기도 · '+r.date2,'1부 '+r.prayer12+'\n2부 '+r.prayer22)}${row('예배 안내 · '+r.month1,'1부 '+r.usher11+'\n2부 '+r.usher21)}${row('예배 안내 · '+r.month2,'1부 '+r.usher12+'\n2부 '+r.usher22)}</dl></section>
    ${prose('주일 애찬',s.meals)}${prose('목회 일정',s.pastoral)}${prose('주요 행사 / 일정',s.events)}
    <section class="public-card"><h2>주중 집회</h2><dl class="public-rows">${row('금요찬양집회',m.fridayText+'\n'+m.fridayLeader)}${row('토요새벽예배',m.saturdayText+'\n'+m.saturdayLeader)}</dl></section>
    ${prose('함께 기도해 주세요',s.prayers)}<section class="public-card"><h2>헌금 통계</h2><dl class="public-rows">${offering.map(([label,key])=>row(label,money(cents(i.offering[key])))).join('')}<div class="public-total">${row('합계',money(total))}</div></dl></section>
    <section class="public-card"><h2>말씀 나눔</h2>${i.questions.map(q=>`<div class="public-item"><p class="public-prose"><strong>${esc(q.number)}.</strong> ${esc(q.body)}</p></div>`).join('')||'<p>등록된 질문이 없습니다.</p>'}</section></div>
    <div class="public-fixed"><details class="public-card"><summary>예배 및 집회 안내</summary><p class="public-prose">${esc(globalThis.Bulletin?.fixedSchedule||'자세한 안내는 PDF 주보를 확인해 주세요.')}</p></details><details class="public-card"><summary>교회 섬김이</summary><p class="public-prose">${esc(globalThis.Bulletin?.fixedStaff||'자세한 안내는 PDF 주보를 확인해 주세요.')}</p></details></div>
  </article>`;
}

function current(){return issues.find(i=>i.id===selectedId);}
function notice(message){const node=$('#public-notice');node.textContent=message;node.hidden=!message;}
function render(){
  const i=current(),content=$('#public-content');
  $('.public-archive').hidden=!issues.length;
  const archive=$('#public-archive');
  archive.innerHTML=issues.map(item=>`<option value="${esc(item.id)}" ${item.id===selectedId?'selected':''}>${esc(dateLabel(item.date))}${item.id===issues[0]?.id?' · 최신':''}</option>`).join('');
  const key=JSON.stringify(i||null);
  if(key===renderedKey)return;
  renderedKey=key;previewRun++;pdfKey='';pdfPromise=null;
  content.innerHTML=i?issueMarkup(i):'<section class="public-empty"><span aria-hidden="true">✦</span><h2>아직 공개된 주보가 없습니다.</h2><p>주보가 준비되면 이곳에서 확인하실 수 있습니다.</p></section>';
  content.setAttribute('aria-busy','false');
  document.title=i?`${dateLabel(i.date)} · KPCSTL 주보`:'KPCSTL · 주일 주보';
}

function validIssue(i){
  if(!i||typeof i!=='object'||!/^\d{4}-\d{2}-\d{2}$/.test(i.date)||i.id!==i.date||!globalThis.Bulletin?.validDate(i.date)||!Number.isSafeInteger(i.revision)||i.revision<1)return false;
  const groups={sermon:['title','scripture','preacher'],worship:['service1','service2','call','doxology','confession','hymn1','praise2','prayer1','prayer2','giving','closing','benediction'],sections:['meals','pastoral','events','prayers'],roster:['date1','date2','month1','month2','prayer11','prayer12','prayer21','prayer22','usher11','usher12','usher21','usher22'],midweek:['fridayText','saturdayText','fridayLeader','saturdayLeader'],offering:['tithe','sunday','thanks','school','mission','scholarship','relief']};
  const text=value=>typeof value==='string'&&value.length<=12000;
  if(Object.entries(groups).some(([group,keys])=>!i[group]||keys.some(key=>!text(i[group][key]))))return false;
  if(groups.offering.some(key=>!/^\d{1,8}(\.\d{0,2})?$/.test(i.offering[key])))return false;
  return [['announcements',['title','body']],['questions',['number','body']]].every(([list,keys])=>Array.isArray(i[list])&&i[list].length<=100&&i[list].every(item=>item&&keys.every(key=>text(item[key]))));
}

async function refresh(){
  if(fetching)return;
  fetching=true;$('.public-refresh').disabled=true;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const base=new URL(cloudConfig.apiBaseUrl),local=['localhost','127.0.0.1','[::1]'].includes(base.hostname);
    if(base.username||base.password||(base.protocol!=='https:'&&!(local&&base.protocol==='http:')))throw Error('Invalid public endpoint');
    const response=await fetch(new URL('/api/public',base),{credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal,headers:{accept:'application/json'}});
    if(!response.ok)throw Error('Public endpoint unavailable');
    const data=await response.json();
    if(!Array.isArray(data.issues)||data.issues.some(i=>!validIssue(i)))throw Error('Invalid public response');
    const next=[...data.issues].sort((a,b)=>b.date.localeCompare(a.date));
    if(new Set(next.map(i=>i.id)).size!==next.length)throw Error('Duplicate public issue');
    issues=next;
    if(!selectedId){selectedId=issues.find(i=>i.id===initialId)?.id||issues[0]?.id||'';if(initialId&&!issues.some(i=>i.id===initialId))notice('요청하신 날짜의 공개 주보가 없어 최신 주보를 표시합니다.');}
    else if(!issues.some(i=>i.id===selectedId)){selectedId=issues[0]?.id||'';notice('선택한 주보를 더 이상 불러올 수 없어 공개된 최신 주보를 표시합니다.');}
    render();checkedAt=new Date();
    $('#public-status').textContent=`온라인 · ${checkedAt.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 확인 · 30초마다 갱신`;
    $('.public-connection').classList.remove('is-stale');
  }catch{
    $('.public-connection').classList.add('is-stale');
    $('#public-status').textContent=checkedAt?'연결을 확인해 주세요. 현재는 마지막으로 불러온 주보를 표시하고 있습니다.':'주보를 불러오지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해 주세요.';
    if(!checkedAt){$('#public-content').innerHTML='<section class="public-empty"><span aria-hidden="true">✦</span><h2>주보를 불러올 수 없습니다.</h2><p>잠시 후 새로고침해 주세요.</p></section>';$('#public-content').setAttribute('aria-busy','false');}
  }finally{clearTimeout(timeout);fetching=false;$('.public-refresh').disabled=false;}
}

function getPdf(i){
  const key=JSON.stringify(i);
  if(key!==pdfKey||!pdfPromise){pdfKey=key;pdfPromise=globalThis.BulletinPrintView.get(i).catch(error=>{if(pdfKey===key)pdfPromise=null;throw error;});}
  return pdfPromise;
}

async function preview(){
  const i=current();if(!i)return;
  const section=$('#public-pdf'),status=$('#public-pdf-status'),pages=$('#public-pdf-pages'),warnings=$('#public-pdf-warnings');
  if(!section.hidden){section.hidden=true;$('[data-public="preview"]').setAttribute('aria-expanded','false');previewRun++;return;}
  section.hidden=false;$('[data-public="preview"]').setAttribute('aria-expanded','true');
  const run=++previewRun;pages.innerHTML='';warnings.innerHTML='';pages.setAttribute('aria-busy','true');status.textContent='인쇄용 PDF를 만들고 있습니다…';
  let pdf;
  try{
    const result=await getPdf(i);if(run!==previewRun||!section.isConnected)return;
    status.textContent=result.exportable?'PDF 저장 파일과 같은 미리보기입니다. 용지: US Letter · 인쇄 배율: 실제 크기(100%).':'인쇄 범위를 넘는 내용이 있어 PDF를 저장할 수 없습니다. 교회 주보 담당자에게 알려 주세요.';
    warnings.innerHTML=result.warnings.map(w=>`<p class="print-warning ${w.blocking?'blocking':''}">${esc(w.message)}</p>`).join('');
    pdfLibrary=pdfLibrary||import('./vendor/pdf.min.mjs').catch(error=>{pdfLibrary=null;throw error;});
    const library=await pdfLibrary;if(run!==previewRun)return;
    library.GlobalWorkerOptions.workerSrc=new URL('vendor/pdf.worker.min.mjs',document.baseURI).href;
    pdf=await library.getDocument({data:result.bytes.slice(),isEvalSupported:false}).promise;
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
      if(run!==previewRun||!section.isConnected)return;
      const page=await pdf.getPage(pageNumber),figure=document.createElement('figure'),canvas=document.createElement('canvas'),caption=document.createElement('figcaption');
      const viewport=page.getViewport({scale:Math.min(devicePixelRatio||1,2)*1.2});
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`주보 ${pageNumber}쪽. 본문의 디지털 주보에서도 내용을 읽을 수 있습니다.`);
      caption.textContent=`${pageNumber} / ${pdf.numPages} · ${['예배 순서와 일정','교회 소식과 헌금','말씀 나눔 1','말씀 나눔 2'][pageNumber-1]||'주보'}`;
      figure.append(canvas,caption);pages.append(figure);
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;page.cleanup();
    }
  }catch{if(run===previewRun&&section.isConnected)status.textContent='미리보기를 표시하지 못했습니다. 닫은 후 다시 시도해 주세요.';}
  finally{if(run===previewRun)pages.setAttribute('aria-busy','false');if(pdf)await pdf.destroy();}
}

async function download(button){
  const i=current();if(!i)return;
  const status=$('#public-download-status');button.disabled=true;status.hidden=false;status.textContent='PDF를 준비하고 있습니다…';
  try{
    const result=await getPdf(i);if(!button.isConnected)return;
    if(!result.exportable){status.textContent='인쇄 범위를 넘는 내용이 있어 PDF를 저장할 수 없습니다. 교회 주보 담당자에게 알려 주세요.';return;}
    globalThis.BulletinPrintView.save(result);status.textContent='PDF 파일을 열었습니다. 브라우저의 다운로드 또는 공유 메뉴에서 저장해 주세요.';
  }catch{if(status.isConnected)status.textContent='PDF를 만들지 못했습니다. 연결을 확인한 후 다시 시도해 주세요.';}
  finally{if(button.isConnected)button.disabled=false;}
}

$('#public-archive').addEventListener('change',event=>{
  selectedId=event.target.value;notice('');render();
  const url=new URL(location.href);url.searchParams.set('issue',selectedId);history.replaceState(null,'',url);
});
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-public]');if(!button)return;
  if(button.dataset.public==='refresh')void refresh();
  if(button.dataset.public==='preview')void preview();
  if(button.dataset.public==='download')void download(button);
  if(button.dataset.public==='close-preview'){$('#public-pdf').hidden=true;previewRun++;const trigger=$('[data-public="preview"]');trigger.setAttribute('aria-expanded','false');trigger.focus();}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
setInterval(()=>{if(!document.hidden)void refresh();},30000);
void refresh();
