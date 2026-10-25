/* Shared weekly editor with named audit history and recoverable local pending edits. */
(() => {
'use strict';
const B=window.Bulletin,T=window.BulletinTeam,KEY='kpcstl.bulletin.study.v1';
const localOnly=T.storageMode==='local';
const cloudOnly=T.storageMode==='cloud';
const selectionKey=localOnly?'kpcstl.github-pages.current.v1:'+new URL('.',T.shareUrl||location.href).pathname:cloudOnly?'kpcstl.cloud-current.v1:'+T.storageScope:null;
let restoreSelection=!!selectionKey;
const wording=(shared,local)=>localOnly?local:shared;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={edit:'M4 20h4L20 8l-4-4L4 16v4M14 6l4 4',preview:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',review:'M8 3H5v18h14V3h-3M8 2h8v4H8zM8 13l3 3 5-6',archive:'M3 5h18v4H3zM5 9v12h14V9M10 13h4',plus:'M12 5v14M5 12h14',arrow:'M5 12h14M14 7l5 5-5 5',download:'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4',up:'M6 14l6-6 6 6',down:'M6 10l6 6 6-6',trash:'M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7',undo:'M8 5L3 10l5 5M3 10h11a6 6 0 0 1 0 12',book:'M3 4h6l3 2 3-2h6v16h-6l-3 2-3-2H3zM12 6v16'};
const icon=n=>`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[n]||icons.book}"/></svg>`;
const navs=[['editor','edit','편집','주보 편집'],['preview','preview','미리보기','미리보기'],['review','review',wording('팀 진행','내 진행'),wording('팀 진행 · 검토','내 진행 · 검토')],['archive','archive','보관함','지난 주보']];
const sections=[['sermon','설교 · 예배'],['announcements','교회 소식'],['volunteers','봉사 · 애찬'],['schedule','모임 · 일정'],['prayers','기도 · 헌금'],['questions','설교 질문'],['staff','고정 교회 안내']];
let store=B.createStore(),loadError=false;
try{const raw=localStorage.getItem(KEY);if(raw){const s=JSON.parse(raw);if(!B.validStore(s))throw Error('Invalid saved data');store=s;}}catch{loadError=true;}
const legacyStore=B.clone(store);store.issues=store.issues.map(B.upgrade);
let finalReview=null;
let profile=null,members=[],signedUser=null,connected=false,initialized=false,operationBusy=false,flushPromise=null,conflict=null,actorFilter='all',historyCount=50;
let view='editor',section='sermon',previewMode='print',query='',year='all',month='all',pending=new Map(),timer=null,toastTimer=null,pdfDownloading=false;
const issue=()=>store.issues.find(x=>x.id===store.current);
const dateLabel=d=>new Date(d+'T12:00:00Z').toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});
const amount=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
const btn=(label,action,cls='',ic='')=>`<button class="btn ${cls}" data-action="${action}">${ic?icon(ic):''}${label}</button>`;
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function status(t,failed=false){$('#save-status').textContent=t;$('#save-status').style.color=failed?'#a7473f':'';}
function updateIssue(next){const idx=store.issues.findIndex(i=>i.id===next.id);if(idx<0)store.issues.push(next);else store.issues[idx]=next;}
function selectIssue(id){
 if(!store.issues.some(i=>i.id===id))return false;
 store.current=id;
 if(selectionKey)try{localStorage.setItem(selectionKey,id);}catch{toast('현재 주보 선택을 저장하지 못했습니다. 주보 내용의 저장 상태를 확인해 주세요.');}
 return true;
}
function recoveryKey(){return profile?'kpcstl.pending.'+(cloudOnly?T.storageScope+'.':'')+profile.id+'.'+store.current:null;}
function persistPending(){try{const key=recoveryKey();if(key){if(pending.size)localStorage.setItem(key,JSON.stringify({baseVersion:issue().version,baseIssue:issue(),changes:Object.fromEntries(pending)}));else localStorage.removeItem(key);}}catch{status('기기 복구 저장 실패',true);}}
function notifyConnection(message='',bad=false){const el=$('#connection-banner');el.hidden=!message;el.className='connection-banner'+(bad?' connection-error':'');el.textContent=message;}
function notifyAuth(error){if(cloudOnly&&error.status===401){notifyConnection(error.message,true);$('#connection-banner').innerHTML=esc(error.message)+` <a href="${esc(T.loginUrl)}">다시 로그인</a>`;}}
const visibleMembers=data=>T.sharedEditing?data.members.filter(member=>member.id===(data.profile?.id||profile?.id)):data.members;
function applyShared(data){
 signedUser=data.user;profile=data.profile;members=visibleMembers(data);
 if(data.issues.length){
  store.issues=data.issues;
  if(restoreSelection){
   try{const selected=localStorage.getItem(selectionKey);if(store.issues.some(i=>i.id===selected))store.current=selected;}catch{}
   restoreSelection=false;
  }
  if(!store.issues.some(i=>i.id===store.current))store.current=store.issues[0].id;
 }
 connected=true;initialized=!!data.issues.length;status(wording('공유 저장소에 연결됨','이 브라우저에 저장됨'));
 const b=$('#profile-button');b.textContent=T.initials(profile?.name);b.title=profile?.name||'표시 이름 등록';
 if(T.sharedEditing)b.setAttribute?.('aria-label','공유 편집팀 안내');
}
function locked(){return !profile||!initialized||operationBusy;}
function setBusy(value){operationBusy=value;document.querySelectorAll('#fields input,#fields textarea,#main button,#main select').forEach(e=>{e.disabled=value||!profile||!initialized;});}
async function mutation(op,args={}){
 if(!profile){showProfile();return null;}
 setBusy(true);
 try{const result=await T.call(T.command(op,issue(),args));if(result.issue)updateIssue(result.issue);connected=true;status(wording('공유 저장 완료','이 브라우저에 저장 완료'));notifyConnection();return result.issue;}
 catch(e){if(e.current){updateIssue(e.current);render();}connected=e.status?true:false;status('저장 확인 필요',true);toast(e.message);notifyAuth(e);return null;}
 finally{setBusy(false);}
}
function showProfile(){if(T.sharedEditing){showDialog(`<h2>주보 편집팀</h2><p>이 링크를 연 누구나 같은 주보를 편집할 수 있습니다. 변경 기록은 개인 이름 대신 주보 편집팀으로 남습니다.</p><p>화면 위의 공유 저장 완료 표시를 확인해 주세요. 다른 기기에도 같은 내용이 반영됩니다.</p><div class="actions">${btn('확정된 주보 보기','published-view','')}${btn('닫기','close-dialog','primary')}</div>`);return;}showDialog(`<h2>어떤 이름으로 편집할까요?</h2><p>${wording('이 이름이 변경 기록과 담당자 목록에 표시됩니다. 로그인한 계정에 연결됩니다.','이 이름은 이 브라우저의 변경 기록에만 표시됩니다. 로그인이나 다른 기기와의 공유는 없습니다.')}</p><form id="profile-form"><label class="field"><span>표시 이름</span><input id="display-name" maxlength="60" required autocomplete="name" value="${esc(profile?.name||signedUser?.name||'')}"></label><p class="field-help">예: 박태진 목사 · 이름은 나중에 바꿀 수 있습니다.</p><div id="profile-error" class="dialog-error" role="alert"></div><button class="btn primary" type="submit">${profile?'이름 저장':'이 이름으로 시작하기'}</button>${profile?btn('취소','close-dialog',''):''}</form>${cloudOnly?`<div class="divider"></div><div class="actions">${T.manageEditors?btn('편집자 초대','manage-editors',''):''}${btn('로그아웃','logout','')}</div>`:''}`);}
async function initializeShared(){
 const data=await T.call();applyShared(data);
 if(!profile){render();showProfile();return;}
 if(cloudOnly){
  const seeds=Array.isArray(T.initialIssues)?T.initialIssues:[];
  for(const i of seeds){try{await T.call(T.command('import',null,{issue:i}));}catch(e){if(e.status!==409)throw e;}}
  T.initialIssues=[];
  if(seeds.length)applyShared(await T.call());
  if(!initialized){store.issues=[];store.current=null;notifyConnection();render();return;}
 }else if(!data.issues.length){
  notifyConnection(wording('이 기기의 주보를 공유 보관함에 등록하고 있습니다. 기존 기기 자료도 보존합니다.','이 브라우저의 주보 보관함을 준비합니다. 다른 기기와 공유되지 않습니다.'));
  for(const i of legacyStore.issues){try{await T.call(T.command('import',null,{issue:i}));}catch(e){if(e.status!==409)throw e;}}
  applyShared(await T.call());
 }
 notifyConnection();render();restorePending();
}
function restorePending(){
 try{const raw=localStorage.getItem(recoveryKey());if(!raw)return;const draft=JSON.parse(raw);pending=new Map(Object.entries(draft.changes||{}));if(pending.size){notifyConnection(wording('저장되지 않았던 입력을 복구했습니다. 최신 공유 내용과 비교한 뒤 저장해 주세요.','저장되지 않았던 입력을 복구했습니다. 이 브라우저의 최신 내용과 비교한 뒤 저장해 주세요.'),true);render();if(draft.baseVersion!==issue().version){const current=B.clone(issue()),r=T.rebase(draft.baseIssue||current,current,draft.changes);if(r.conflicts.length){conflict={current,changes:r.conflicts.some(c=>c.deleted)?draft.changes:r.changes,base:draft.baseIssue,mapping:r.mapping,conflictingPaths:r.conflicts.map(c=>c.path),deleted:r.conflicts.some(c=>c.deleted)};showConflict();}else{remapPending(r.mapping);flush();}}else flush();}}
 catch{toast('기기 복구 자료를 읽지 못했습니다. JSON 백업을 확인해 주세요.');}
}
const safeValue=(object,path)=>{try{return B.getPath(object,path);}catch{return '[삭제된 항목]';}};
function remapPending(mapping){const next=new Map();for(const[path,value]of pending){const mapped=Object.hasOwn(mapping,path)?mapping[path]:path;if(mapped)next.set(mapped,value);}pending=next;}
function showConflict(){if(!conflict)return;showDialog(`<h2>같은 항목이 수정됐어요</h2><p>${wording('입력하신 내용은 보존했습니다. 최신 공유 내용과 비교해 저장 방식을 선택해 주세요.','입력하신 내용은 보존했습니다. 다른 탭에서 저장한 내용과 비교해 주세요.')}</p><div class="conflict-list">${Object.entries(conflict.changes).map(([path,value])=>`<article><strong>${esc(labelFor(path))}</strong><div class="diff before">${wording('공유된 내용: ','저장된 내용: ')}${esc(safeValue(conflict.current,path))}</div><div class="diff after">내 입력: ${esc(value)}</div></article>`).join('')}</div><div class="actions">${btn(wording('공유 내용 사용','저장된 내용 사용'),'conflict-server','')}${conflict.deleted?'<p>삭제된 항목이 있어 내 입력을 자동 적용할 수 없습니다. 위 내용을 복사한 뒤 공유 내용을 선택해 주세요.</p>':btn('내 입력으로 저장','conflict-mine','primary')}</div>`);}
function flush(){
 clearTimeout(timer);if(conflict)return Promise.resolve(false);
 if(flushPromise)return flushPromise.then(ok=>ok&&pending.size?flush():ok);
 if(!pending.size)return Promise.resolve(true);
 if(!profile||!initialized){showProfile();return Promise.resolve(false);}
 flushPromise=(async()=>{
  while(pending.size){
   const base=B.clone(issue());let changes=Object.fromEntries(pending);persistPending();status(wording('공유 저장 중…','이 브라우저에 저장 중…'));
   try{
    let result;
    try{result=await T.call(T.command('fields',base,{changes}));}
    catch(e){
     if(e.status!==409||!e.current)throw e;
     const rebased=T.rebase(base,e.current,changes);
     if(rebased.conflicts.length){conflict={current:e.current,changes:rebased.changes,base,mapping:rebased.mapping,conflictingPaths:rebased.conflicts.map(c=>c.path),deleted:rebased.conflicts.some(c=>c.deleted)};if(conflict.deleted)conflict.changes={...changes,...rebased.changes};updateIssue(e.current);showConflict();status('동시 수정 확인 필요',true);return false;}
     remapPending(rebased.mapping);changes=rebased.changes;updateIssue(e.current);result=await T.call(T.command('fields',e.current,{changes}));
    }
    updateIssue(result.issue);for(const [path,value]of Object.entries(changes))if(pending.get(path)===value)pending.delete(path);
    persistPending();connected=true;status(wording('공유 저장 완료','이 브라우저에 저장 완료'));notifyConnection();refreshLive();
   }catch(e){connected=!!e.status;status(wording('서버 저장 대기','기기 저장 확인 필요'),true);notifyConnection(e.message+' 입력을 유지한 채 다시 저장할 수 있습니다.',true);notifyAuth(e);persistPending();return false;}
  }
  return true;
 })().finally(()=>{flushPromise=null;});return flushPromise;
}
function stagedIssue(){let next=issue();try{for(const[path,value]of pending)next=B.update(next,path,value);}catch{}return next;}
function refreshLive(){const progress=$('.section-progress');if(progress)progress.outerHTML=sectionProgress();const badge=$('.week-strip .badge');if(badge){badge.textContent=issue().status==='finalized'?'최종 확정':wording('함께 편집 중','이 브라우저의 초안');badge.className='badge'+(issue().status==='finalized'?' reviewed':'');}const p=$('#live-preview');if(p)p.innerHTML=reader(stagedIssue(),false);const r=$('#rev-number');if(r)r.textContent='v'+issue().revision;const total=$('#giving-total');if(total){try{total.textContent=amount(B.totalCents(stagedIssue().offering)/100);}catch{}}}
function field(label,path,multiline=false,help='',type='text'){
  const val=B.getPath(stagedIssue(),path);return `<label class="field"><span>${label}</span>${multiline?`<textarea data-field="${path}" rows="${path.startsWith('sections')?5:3}" maxlength="12000" ${locked()?'disabled':''}>${esc(val)}</textarea>`:`<input data-field="${path}" value="${esc(val)}" type="${type}" ${locked()?'disabled':''} ${path.startsWith('offering')?'inputmode="decimal"':''} maxlength="${path.startsWith('offering')?11:500}">`}${help?`<span class="field-help">${help}</span>`:''}</label>`;
}
function pageHeading(kicker,title,description,actions=''){return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p class="subheading">${description}</p></div><div class="actions">${actions}</div></div>`;}
function weekStrip(){const i=issue(),d=new Date(i.date+'T12:00:00Z');return `<div class="week-strip"><div class="date-tile"><span>${d.toLocaleDateString('en-US',{month:'short',timeZone:'UTC'}).toUpperCase()}</span><strong>${d.getUTCDate()}</strong></div><div class="week-meta"><strong>${dateLabel(i.date)} 주일</strong><small>1부 ${esc(i.worship.service1)} · 2부 ${esc(i.worship.service2)}</small></div><span class="badge ${i.status==='finalized'?'reviewed':''}">${i.status==='finalized'?'최종 확정':wording('함께 편집 중','이 브라우저의 초안')}</span><span class="revision" id="rev-number">v${i.revision}</span></div>`;}
function rosterText(i){const r=i.roster;return `대표기도 ${r.date1}: 1부 ${r.prayer11} / 2부 ${r.prayer21}\n대표기도 ${r.date2}: 1부 ${r.prayer12} / 2부 ${r.prayer22}\n예배 안내 ${r.month1}: 1부 ${r.usher11} / 2부 ${r.usher21}\n예배 안내 ${r.month2}: 1부 ${r.usher12} / 2부 ${r.usher22}`;}
function midweekText(i){const m=i.midweek;return `금요찬양집회: ${m.fridayText} · ${m.fridayLeader}\n토요새벽예배: ${m.saturdayText} · ${m.saturdayLeader}`;}
function reader(i,full=true){
 const row=(a,b)=>`<div class="reader-row"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;
 const content=(title,body)=>`<section class="reader-section"><h3>${title}</h3><div class="reader-item"><p>${esc(body)}</p></div></section>`;
 const nums=['tithe','sunday','thanks','school','mission','scholarship','relief'],names=['십일조','주일헌금','감사헌금','주일학교','선교헌금','장학헌금','구제헌금'];
 return `<article class="reader"><header class="reader-head"><div class="church">KPCSTL · SUNDAY BULLETIN</div><h2>${dateLabel(i.date)}</h2><p>세인트루이스 한인장로교회</p><p class="sermon-title">${esc(i.sermon.title||'설교 제목을 입력해 주세요')}</p><p>${esc(i.sermon.scripture)}${i.sermon.preacher?' · '+esc(i.sermon.preacher):''}</p></header><div class="reader-content"><section class="reader-section"><h3>주일예배 순서</h3>${row('1부 / 2부',i.worship.service1+' / '+i.worship.service2)}${row('예배로의 부름',i.worship.call)}${row('송영',i.worship.doxology)}${row('신앙고백',i.worship.confession)}${row('1부 찬양',i.worship.hymn1)}${row('2부 찬양',i.worship.praise2)}${row('1부 대표기도',i.worship.prayer1)}${row('2부 대표기도',i.worship.prayer2)}${row('성경봉독',i.sermon.scripture)}${row('설교',i.sermon.preacher)}${row('드림과 헌신',i.worship.giving)}${row('교회소식','Announcements')}${row('폐회찬양',i.worship.closing)}${row('축도',i.worship.benediction)}</section><section class="reader-section"><h3>교회 소식</h3>${i.announcements.map((a,n)=>`<div class="reader-item"><strong>${n+1}. ${esc(a.title)}</strong><p>${esc(a.body)}</p></div>`).join('')||'<p>등록된 소식이 없습니다.</p>'}</section>${content('예배 봉사자',rosterText(i))}${content('주일 애찬',i.sections.meals)}${content('목회 일정',i.sections.pastoral)}${content('주요 행사',i.sections.events)}${content('주중 집회',midweekText(i))}${content('함께 기도해 주세요',i.sections.prayers)}<section class="reader-section"><h3>헌금 통계</h3>${nums.map((k,n)=>row(names[n],amount(Number(i.offering[k])))).join('')}${row('합계',amount(B.totalCents(i.offering)/100))}</section><section class="reader-section"><h3>말씀 나눔</h3>${i.questions.map(q=>`<div class="reader-item"><strong>${esc(q.number)}. ${esc(q.body)}</strong></div>`).join('')}</section>${content('예배 및 집회 안내',B.fixedSchedule)}${content('교회 섬김이',B.fixedStaff)}${full?'<p class="preview-caption">편집 내용을 보여 주는 디지털 미리보기입니다.<br>인쇄 미리보기 탭에서 편집본 PDF를 확인하세요.</p>':''}</div></article>`;
}
function assistant(){return `<section class="assistant-card"><h3><span aria-hidden="true">✧</span> 변경을 제안해 주세요</h3><p>휴대폰에서도 수정 요청을 남기고, 검토 화면에서 확인하세요.</p><label class="field"><span class="sr-only">변경 요청</span><textarea id="request-body" rows="3" placeholder="예: 2부 대표기도 담당자를 바꿔 주세요."></textarea></label>${btn('변경 요청 남기기','add-request','', 'arrow')}<p style="margin:12px 0 0">요청만 저장합니다. AI 연결은 다음 구현 단계입니다.</p></section>`;}
function editor(){
 const num=sections.findIndex(x=>x[0]===section)+1;
 let form='',title='',desc='';
 if(section==='sermon'){title='이번 주 말씀과 예배';desc='한 곳에서 수정하면 디지털 미리보기에도 함께 반영됩니다.';form=field('설교 제목','sermon.title',true)+`<div class="field-grid">${field('성경 본문','sermon.scripture')}${field('설교자','sermon.preacher')}</div><div class="form-divider"></div><div class="field-grid">${field('1부 예배 시간','worship.service1')}${field('2부 예배 시간','worship.service2')}${field('송영','worship.doxology')}${field('신앙고백','worship.confession')}${field('1부 찬양','worship.hymn1')}${field('2부 찬양','worship.praise2')}${field('1부 대표기도','worship.prayer1')}${field('2부 대표기도','worship.prayer2')}</div>${field('예배로의 부름','worship.call')}${field('드림과 헌신','worship.giving')}<div class="field-grid">${field('폐회찬양','worship.closing')}${field('축도','worship.benediction')}</div>`;}
 if(section==='announcements'){title='교회 소식을 전해요';desc='순서는 위아래 버튼으로 바꿀 수 있어요. 삭제한 내용은 되돌릴 수 있습니다.';form=issue().announcements.map((a,n)=>listCard('announcements',n,field('소식 제목',`announcements.${n}.title`)+field('안내 내용',`announcements.${n}.body`,true))).join('')+`<button class="add-button" data-action="list-add" data-list="announcements">+ 교회 소식 추가</button>`;}
 if(section==='volunteers'){title='함께 섬기는 분들';desc='표 제목과 1부·2부 표시는 고정됩니다. 날짜와 담당자만 바꿔 주세요.';form=`<div class="fixed-note">고정: 대표기도 / 예배 안내 · 1부 / 2부</div><h3>대표기도</h3><div class="field-grid">${field('첫째 주 날짜','roster.date1')}${field('둘째 주 날짜','roster.date2')}${field('첫째 주 1부','roster.prayer11')}${field('둘째 주 1부','roster.prayer12')}${field('첫째 주 2부','roster.prayer21')}${field('둘째 주 2부','roster.prayer22')}</div><h3>예배 안내</h3><div class="field-grid">${field('첫째 달','roster.month1')}${field('둘째 달','roster.month2')}${field('첫째 달 1부','roster.usher11')}${field('둘째 달 1부','roster.usher12')}${field('첫째 달 2부','roster.usher21')}${field('둘째 달 2부','roster.usher22')}</div>`+field('주일 애찬 순서','sections.meals',true);}
 if(section==='schedule'){title='한 주의 만남과 일정';desc='집회 이름과 표의 항목명은 고정됩니다.';form=field('목회 일정','sections.pastoral',true)+field('주요 행사와 일정','sections.events',true)+`<div class="fixed-note">고정: 금요찬양집회 / 토요새벽예배 · 성경 본문·주제 / 인도자</div><div class="field-grid">${field('금요찬양집회 본문 · 주제','midweek.fridayText')}${field('토요새벽예배 본문 · 주제','midweek.saturdayText')}${field('금요찬양집회 인도자','midweek.fridayLeader')}${field('토요새벽예배 인도자','midweek.saturdayLeader')}</div>`;}
 if(section==='prayers'){title='함께 기도하고 나눠요';desc='헌금 합계는 입력된 항목을 바탕으로 자동 계산됩니다.';const names=['십일조','주일헌금','감사헌금','주일학교','선교헌금','장학헌금','구제헌금'];form=field('함께 기도해 주세요','sections.prayers',true)+`<div class="form-divider"></div><div class="field-grid">${Object.keys(issue().offering).map((k,n)=>field(names[n]+' (USD)','offering.'+k)).join('')}</div><div class="money-total"><span>헌금 합계</span><strong id="giving-total">${amount(B.totalCents(issue().offering)/100)}</strong></div>`;}
 if(section==='questions'){title='말씀을 삶으로 이어가요';desc='원본에는 1번과 5번만 있습니다. 번호를 확인하고 필요한 질문을 추가하세요.';form='<div class="callout" style="margin-bottom:20px">질문 번호는 자동으로 바꾸지 않습니다. 원본의 누락 여부를 먼저 확인해 주세요.</div>'+issue().questions.map((q,n)=>listCard('questions',n,field('질문 번호',`questions.${n}.number`)+field('질문 내용',`questions.${n}.body`,true))).join('')+`<button class="add-button" data-action="list-add" data-list="questions">+ 말씀 나눔 질문 추가</button>`;}
 if(section==='staff'){title='매주 유지되는 교회 안내';desc='표시해 주신 영역은 원본 그대로 고정되어 주간 편집으로 바뀌지 않습니다.';form=`<div class="fixed-note">고정 영역 · 원본 PDF에서 보존</div><h3>예배 및 집회 안내</h3><img class="fixed-reference" src="assets/fixed-regular.png" alt="고정 예배와 집회 안내"><h3>교회 섬김이</h3><img class="fixed-reference staff-reference" src="assets/fixed-staff.png" alt="고정 교회 섬김이 안내">`;}
 if(issue().migrationNotes?.length)form=`<div class="migration-note"><h3>이전 자유 입력을 보존했습니다</h3><p>아래 내용을 새 표에 옮긴 뒤 확인해 주세요.</p>${issue().migrationNotes.map(n=>`<pre>${esc(n.body)}</pre>`).join('')}${btn('표에 반영했음을 확인','migration-ack','')}</div>`+form;
 return pageHeading('SUNDAY, TOGETHER','주일을 함께 준비해요','익숙한 주보를, 더 편하게 준비하는 공간.',btn('인쇄 미리보기','print-preview','', 'preview')+btn('편집본 PDF 다운로드','download-pdf','primary','download')+btn('새 주보 만들기','new-week','','plus'))+weekStrip()+sectionProgress()+`<div class="editor-grid"><div><nav class="section-tabs" aria-label="편집할 주보 항목">${sections.map(([id,label])=>`<button class="section-tab ${section===id?'active':''}" data-section="${id}" aria-current="${section===id?'true':'false'}">${label}</button>`).join('')}</nav><section class="panel"><h2 class="panel-title"><span class="section-number">0${num}</span>${title}</h2><p class="panel-description">${desc}</p><div id="fields">${form}</div><div class="section-footer"><small>${wording(T.sharedEditing?'주보 편집팀의 변경 내용과 시간이 함께 저장됩니다.':'이름과 시간이 함께 공유 저장됩니다.','이름과 시간이 이 브라우저에 저장됩니다. 다른 기기와 공유되지 않습니다.')}</small>${btn(T.sharedEditing?'공유된 마지막 수정 되돌리기':'내 마지막 수정 되돌리기','undo','small','undo')}</div></section></div><aside class="preview-pane"><div class="preview-head"><h2>디지털 미리보기</h2><span>입력 내용 실시간 반영</span></div><div class="preview-device" id="live-preview">${reader(issue(),false)}</div>${assistant()}<p class="preview-caption">인쇄 미리보기에서 4쪽 레이아웃을 확인하고<br>편집본 PDF를 다운로드하세요.</p></aside></div>`;
}
function listCard(list,n,fields){return `<div class="list-card"><div class="list-top"><strong>${list==='questions'?'QUESTION':'ANNOUNCEMENT'} ${String(n+1).padStart(2,'0')}</strong><div class="icon-buttons">${[['up','위로 이동'],['down','아래로 이동'],['delete','삭제']].map(([a,l])=>`<button class="icon-btn" data-action="list-${a}" data-list="${list}" data-index="${n}" aria-label="${n+1}번째 항목 ${l}" ${(a==='up'&&n===0)||(a==='down'&&n===issue()[list].length-1)?'disabled':''}>${icon(a==='delete'?'trash':a)}</button>`).join('')}</div></div>${fields}</div>`;}
function preview(){
 const tabs=[['print','인쇄 미리보기'],['digital','디지털 보기'],['source','원본 비교']];
 const heading=pageHeading('READ & CHECK','편집한 주보를 확인해요',dateLabel(issue().date)+' · 현재 편집 내용',btn('편집으로 돌아가기','back-edit','')+btn('편집본 PDF 다운로드','download-pdf','primary','download'));
 const nav=`<nav class="section-tabs" aria-label="미리보기 형식">${tabs.map(([id,label])=>`<button class="section-tab ${previewMode===id?'active':''}" data-preview="${id}">${label}</button>`).join('')}</nav>`;
 if(previewMode==='print')return heading+nav+window.BulletinPrintView.markup();
 if(previewMode==='source')return heading+nav+`<div class="callout info" style="margin-bottom:25px">2026년 10월 4일 원본입니다. 이 탭은 수정되지 않는 비교용 자료입니다. <a href="assets/reference.pdf" download="KPCSTL-2026-10-04-original.pdf">원본 PDF 받기</a><br>편집한 내용은 인쇄 미리보기에서 확인하세요.</div><div class="source-pages">${[1,2,3,4].map(n=>`<div><img src="assets/source-${n}.png" alt="2026년 10월 4일 주보 ${n}쪽 원본" loading="lazy"><p>${n} / 4 · 원본</p></div>`).join('')}</div>`;
 return heading+nav+`<div class="preview-layout"><div class="reader-full">${reader(issue())}</div><aside><section class="panel"><div class="eyebrow">ONE SOURCE, TWO VIEWS</div><h2 class="panel-title">휴대폰에서는<br>편안하게 읽으세요</h2><p class="panel-description">같은 편집 내용으로 모바일 주보와 인쇄 PDF를 만듭니다.</p>${btn('인쇄 레이아웃 확인','print-preview','primary wide-action','preview')}</section><div class="callout" style="margin-top:18px">${wording(cloudOnly?'편집 내용은 같은 링크에서 온라인으로 공유됩니다. 확정된 주보 보기에서는 마지막 확정본을 볼 수 있습니다.':'현재 기기의 초안입니다. 여러 기기의 편집 내용이 공유 저장됩니다. 교인용 공개 링크는 아직 연결되지 않았습니다.','현재 브라우저의 초안입니다. 다른 기기나 교인에게 자동으로 공유되지 않습니다. PDF를 다운로드해 전달해 주세요.')}</div></aside></div>`;
}
async function downloadPdf(final=false,savedSnapshot=null){
 if(pdfDownloading||!await flush())return;
 const snapshot=B.clone(savedSnapshot||issue());if(final&&!snapshot.finalization){toast('최종 확정 후 배포용 PDF를 받을 수 있습니다.');return;}let result=null;pdfDownloading=true;
 document.querySelectorAll('[data-action="download-pdf"]').forEach(b=>{b.disabled=true;b.textContent='PDF 만드는 중…';});
 try{
  result=await window.BulletinPrintView.get(snapshot);
  if(!savedSnapshot&&(issue().id!==snapshot.id||issue().revision!==snapshot.revision||pending.size)){toast('PDF를 만드는 동안 내용이 바뀌었습니다. 최신 내용으로 다시 다운로드해 주세요.');return;}
  if(!result.exportable){previewMode='print';navigate('preview');toast('인쇄 칸을 넘는 내용이 있습니다. 빨간 안내 항목을 먼저 수정해 주세요.');return;}
  if(final)result={...result,filename:`KPCSTL-${snapshot.date}-FINAL-v${snapshot.revision}.pdf`};window.BulletinPrintView.save(result);toast(`${result.date} · v${result.revision} 편집본 PDF를 저장합니다.`);
 }catch(e){toast(e.message||'PDF를 만들지 못했습니다. 다시 시도해 주세요.');}
 finally{pdfDownloading=false;document.querySelectorAll('[data-action="download-pdf"]').forEach(b=>{b.disabled=!!(result&&!result.exportable&&issue().id===snapshot.id&&issue().revision===snapshot.revision);b.innerHTML=icon('download')+'편집본 PDF 다운로드';});}
}
function archive(){const years=[...new Set(store.issues.map(i=>i.date.slice(0,4)))].sort().reverse();return pageHeading('OUR WEEKS, TOGETHER','지난 주일의 기록','한 주도 덮어쓰지 않고, 차곡차곡 모아두는 주보.',btn('JSON 백업','export','', 'download')+btn('새 주보 만들기','new-week','primary','plus'))+`<div class="stat-line"><span><b>${store.issues.length}</b>개의 주보</span><span>연도 · 월 · 주일별로 찾아보기</span></div><div class="filter-row"><label class="search-wrap"><span class="sr-only">주보 검색</span><input id="archive-search" class="search-input" placeholder="설교 제목, 성경 본문, 교회 소식 검색" value="${esc(query)}"></label><select id="year-filter" aria-label="연도 선택"><option value="all">모든 연도</option>${years.map(y=>`<option ${year===y?'selected':''}>${y}</option>`).join('')}</select><select id="month-filter" aria-label="월 선택"><option value="all">모든 월</option>${Array.from({length:12},(_,n)=>`<option value="${String(n+1).padStart(2,'0')}" ${month===String(n+1).padStart(2,'0')?'selected':''}>${n+1}월</option>`).join('')}</select></div><div id="archive-results">${archiveResults()}</div><div class="callout info">${wording('주보는 공유 저장소에 날짜별로 보관됩니다. 새 주보를 만들어도 이전 주의 내용과 변경 기록은 유지됩니다.','주보는 이 브라우저에 날짜별로 보관됩니다. 브라우저 데이터를 지우면 자료가 사라질 수 있으므로 JSON 백업과 PDF를 다운로드해 주세요.')}</div>`;}
function archiveResults(){const list=store.issues.filter(i=>(year==='all'||i.date.startsWith(year))&&(month==='all'||i.date.slice(5,7)===month)&&JSON.stringify([i.date,i.sermon,i.announcements]).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.date.localeCompare(a.date));if(!list.length)return '<div class="archive-empty">검색 결과가 없습니다.<br>다른 제목이나 월을 선택해 주세요.</div>';const groups={};for(const i of list)(groups[i.date.slice(0,7)]??=[]).push(i);return Object.entries(groups).map(([m,items])=>`<section class="archive-group"><h2>${m.slice(0,4)}년 ${Number(m.slice(5))}월 <span class="badge">${items.length}주</span></h2><div class="archive-cards">${items.map(i=>`<article class="archive-card"><div class="archive-cover"><div class="mini-paper" aria-hidden="true">${'<i></i>'.repeat(8)}</div><div class="archive-day">${Number(i.date.slice(8))}<small>SUNDAY</small></div></div><div class="archive-body"><span class="badge ${i.status==='finalized'?'reviewed':''}">${i.status==='finalized'?'최종 확정':'초안'}</span><h3>${esc(i.sermon.title||'새로운 한 주의 주보')}</h3><p>${esc(i.sermon.scripture||'성경 본문을 입력해 주세요')} · v${i.revision}</p><div class="actions"><button class="btn small" data-open="${i.id}" data-open-view="preview">읽기</button><button class="btn small primary" data-open="${i.id}" data-open-view="editor">편집</button></div></div></article>`).join('')}</div></section>`).join('');}
const timeLabel=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'America/Chicago',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})+' · 세인트루이스 시간':'아직 없음';
const stateLabel={todo:'시작 전',progress:'진행 중',done:'완료'};
const memberName=id=>members.find(m=>m.id===id)?.name||'담당자 미지정';
const avatar=name=>`<span class="person-avatar" aria-hidden="true">${esc(T.initials(name))}</span>`;
function labelFor(path){const map={'sermon.title':'설교 제목','sermon.scripture':'성경 본문','sermon.preacher':'설교자','worship.prayer1':'1부 대표기도','worship.prayer2':'2부 대표기도','sections.meals':'애찬 순서','sections.pastoral':'목회 일정','sections.events':'주요 행사','sections.prayers':'기도 제목'};return map[path]||({'roster':'예배 봉사자','midweek':'주중 집회','worship':'예배 순서','offering':'헌금','announcements':'교회 소식','questions':'설교 질문'}[path.split('.')[0]]||path);}
function sectionProgress(){const t=issue().tasks?.[section];if(!t)return '';return `<div class="section-progress"><div>${avatar(memberName(t.assigneeId))}<span><strong>${esc(memberName(t.assigneeId))}</strong><small>${stateLabel[t.status]}${t.updatedAt?' · '+timeLabel(t.updatedAt):''}</small></span></div><button class="btn small" data-task-section="${section}" data-task-status="${t.status==='done'?'progress':'done'}">${t.status==='done'?'다시 진행 중으로':'내 부분 완료 표시'}</button></div>`;}
function review(){
 const i=issue(),tasks=i.tasks||{},done=Object.values(tasks).filter(t=>t.status==='done').length,isCoordinator=profile?.id===i.coordinatorId;
 const events=[...i.history.map(h=>({...h,type:'content',label:labelFor(h.path)+(h.undoOf?' 되돌림':' 수정')})),...(i.activity||[])].filter(h=>actorFilter==='all'||h.actorId===actorFilter).sort((a,b)=>(b.at||'').localeCompare(a.at||''));
 const requests=i.requests.filter(r=>!r.resolved).length;
 return pageHeading('PREPARE SUNDAY, TOGETHER',wording('이번 주, 함께 준비해요','이번 주, 내 준비 상황'),wording(T.sharedEditing?'함께 준비하는 항목과 완료 상태를 한눈에 확인하세요.':'누가 무엇을 맡았는지, 어떤 부분이 완료됐는지 한눈에 확인하세요.','이 브라우저에서 편집한 내용과 완료 상태를 확인하세요.'),btn('링크 복사','share','')+btn('검토용 PDF','download-pdf','','download')+(i.finalization?btn('최종 PDF 다운로드','final-pdf','primary','download'):isCoordinator?btn('검토 후 최종 확정','finalize','primary','review'):''))+weekStrip()+`<section class="team-overview"><div><div class="eyebrow">THIS WEEK’S PROGRESS</div><h2>${done}<span> / 6개 항목 완료</span></h2><p>${i.finalization?esc(i.finalization.actorName)+'님이 '+timeLabel(i.finalization.at)+'에 확정했습니다.':done===6?'모든 담당 항목을 완료했습니다. 최종 담당자의 확인을 기다립니다.':'각자 맡은 부분을 편집하고 완료 표시를 남겨 주세요.'}</p><div class="team-progress-track"><div style="width:${done/6*100}%"></div></div></div><div class="coordinator-box"><small>최종 담당자</small><strong>${esc(memberName(i.coordinatorId))}</strong>${isCoordinator||(cloudOnly&&T.isAdmin)?`<label><span class="sr-only">최종 담당자 변경</span><select id="coordinator-select">${members.map(m=>`<option value="${esc(m.id)}" ${m.id===i.coordinatorId?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label>`:''}<small>미처리 요청 ${requests}개</small></div></section><div class="people-grid">${members.map(m=>{const mine=Object.values(tasks).filter(t=>t.assigneeId===m.id),complete=mine.filter(t=>t.status==='done').length,last=[...i.history,...(i.activity||[])].filter(h=>h.actorId===m.id).sort((a,b)=>(b.at||'').localeCompare(a.at||''))[0];return `<button class="person-card ${actorFilter===m.id?'selected':''}" data-actor="${esc(m.id)}">${avatar(m.name)}<span><strong>${esc(m.name)}</strong><small>${complete} / ${mine.length} 담당 완료</small><small>최근 ${timeLabel(last?.at)}</small></span></button>`;}).join('')}</div><div class="task-grid">${Object.entries(T.areas).map(([key,name])=>{const t=tasks[key]||{status:'todo'};return `<section class="task-card"><div class="task-heading"><h3>${name}</h3><span class="task-state ${t.status}">${stateLabel[t.status]}</span></div><label class="field"><span>담당자</span><select data-assign="${key}" ${!profile?'disabled':''}><option value="">담당자 미지정</option>${members.map(m=>`<option value="${esc(m.id)}" ${m.id===t.assigneeId?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><p class="task-meta">${t.completedBy?'완료: '+esc(t.completedBy.name)+' · '+timeLabel(t.completedAt):t.updatedBy?'최근 수정: '+esc(t.updatedBy.name)+' · '+timeLabel(t.updatedAt):'작업 기록이 아직 없습니다.'}</p><div class="actions"><button class="btn small" data-edit-section="${key}">편집</button><button class="btn small ${t.status==='done'?'':'primary'}" data-task-section="${key}" data-task-status="${t.status==='done'?'progress':'done'}">${t.status==='done'?'완료 취소':'완료 표시'}</button></div></section>`;}).join('')}</div><div class="review-grid"><section class="review-card"><h2>변경 기록</h2><div class="filter-row"><label class="field"><span>편집자별 보기</span><select id="actor-filter"><option value="all">모두</option>${members.map(m=>`<option value="${esc(m.id)}" ${actorFilter===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label></div>${events.length?events.slice(0,historyCount).map(h=>`<details class="history-item"><summary>${avatar(h.actorName||'이전 기록')}<span><strong>${esc(h.actorName||'이전 기기 기록')}</strong><br>${esc(h.label)}<small>${timeLabel(h.at)}${h.version?' · 저장 #'+h.version:''}</small></span></summary>${h.before!==undefined?`<div class="diff before">이전\n${esc(typeof h.before==='string'?h.before:JSON.stringify(h.before,null,2))}</div>`:''}${h.after!==undefined?`<div class="diff after">변경\n${esc(typeof h.after==='string'?h.after:JSON.stringify(h.after,null,2))}</div>`:''}</details>`).join(''):'<div class="empty-note">아직 변경 기록이 없습니다.</div>'}${events.length>historyCount?btn('이전 기록 더 보기','more-history',''):''}</section><section class="review-card"><h2>변경 요청과 검토 메모</h2>${i.requests.map(r=>`<article class="request"><small>${esc(r.actorName||'이전 기기 기록')} · ${timeLabel(r.at)}</small><p>${esc(r.body)}</p><button class="btn small" data-resolve="${r.id}">${r.resolved?'처리 완료 · 다시 열기':'처리 완료로 표시'}</button></article>`).join('')}${assistant()}<div class="divider"></div>${i.comments.map(c=>`<article class="request"><small>${esc(c.actorName||'이전 기기 기록')} · ${timeLabel(c.at)}</small><p>${esc(c.body)}</p></article>`).join('')}<label class="field"><span>검토 메모</span><textarea id="comment-body" rows="3" placeholder="검토한 내용이나 다음 작업을 남겨 주세요."></textarea></label>${btn(T.sharedEditing?'메모 저장':'내 이름으로 메모 저장','add-comment','')}<div class="divider"></div><h3>이전 최종 확정본</h3>${(i.publications||[]).slice().reverse().map(f=>`<div class="publication-row"><span>${esc(f.actorName)}<small>${timeLabel(f.at)} · v${f.revision}</small></span><button class="btn small" data-final-version="${f.version}">PDF</button></div>`).join('')||'<p class="field-help">아직 확정된 주보가 없습니다.</p>'}</section></div><div class="callout info" style="margin-top:24px">${wording(T.sharedEditing?'이 링크에서 누구나 같은 주보를 편집합니다. 변경 기록에는 주보 편집팀으로 표시되며, 마지막 수정 되돌리기는 편집팀의 가장 최근 수정에 적용됩니다.':cloudOnly?'개인 초대 링크로 로그인한 편집자끼리 같은 초안을 준비합니다. 편집자 이름과 진행 기록은 공개 주보와 배포용 PDF에 들어가지 않습니다.':'동료가 이 사이트에 접근해 로그인하고 이름을 등록하면 담당자 목록에 나타납니다. 링크를 복사하는 것만으로 사이트 접근 권한이 부여되지는 않습니다. 편집자 이름과 진행 기록은 교인 배포용 PDF에 들어가지 않습니다.','이 화면은 이 브라우저의 진행 기록입니다. 다른 교인이 같은 링크를 열어도 각자의 별도 자료를 보게 됩니다. 편집 결과를 전달하려면 PDF를 다운로드해 공유해 주세요.')}</div>`;
}
function guide(){if(T.sharedEditing)return pageHeading('SHARED ONLINE WORKSPACE','같은 링크에서 함께 준비해요','개인 초대나 로그인 없이 휴대폰과 컴퓨터에서 같은 주보를 편집합니다.')+`<div class="guide-grid"><section class="panel"><h2>온라인에 함께 저장돼요</h2><p>입력 후 화면 위에 공유 저장 완료가 표시되면 온라인 저장이 끝난 것입니다. 다른 기기의 새 변경 내용은 자동으로 갱신됩니다. 동시에 같은 항목을 바꾸면 비교 화면에서 선택할 수 있습니다.</p>${btn('같은 앱 링크 복사','share','primary')}</section><section class="panel"><h2>공유 편집팀</h2><p>누구나 이 링크에서 편집할 수 있으며, 변경 기록에는 주보 편집팀으로 표시됩니다. 공유된 마지막 수정 되돌리기는 다른 기기에서 저장한 최근 수정에도 적용될 수 있습니다.</p></section><section class="panel"><h2>완성한 주보 확인</h2><p>각 준비 항목을 완료하고 미리보기와 변경 요청을 확인한 뒤 최종 확정하세요. 확정된 주보 보기에는 마지막 확정본이 표시됩니다. 이후 수정은 다시 확정할 때까지 초안으로 남습니다.</p>${btn('확정된 주보 보기','published-view','')}</section><section class="panel"><h2>이전 자료와 백업</h2><p>이전에 사용하던 브라우저의 원본 자료는 남아 있습니다. 직접 가져오기를 선택할 때만 새 날짜의 주보를 공유 보관함에 추가하며, 기존 온라인 주보를 덮어쓰지 않습니다.</p>${btn('이 기기의 이전 주보 가져오기','import-local','')}${btn('공유 주보 JSON 백업','export','','download')}</section></div>`;if(cloudOnly)return pageHeading('SHARED ONLINE WORKSPACE','함께 주보를 준비하는 방법','편집자끼리 같은 초안을 준비하고, 최종 확정한 주보를 교인에게 공개합니다.')+`<div class="guide-grid"><section class="panel"><h2>휴대폰과 컴퓨터에서 이어서 편집</h2><p>본인의 개인 초대 링크로 로그인하면 온라인에 저장한 내용을 다른 기기에서도 이어서 편집할 수 있습니다. 화면 위의 공유 저장 상태를 확인해 주세요.</p><p>팀의 새 변경 내용은 자동으로 갱신됩니다. 동시에 같은 항목을 수정하면 비교 화면에서 선택할 수 있습니다.</p></section><section class="panel"><h2>교인에게 공개하기</h2><ol><li>각자 맡은 내용을 입력하고 완료로 표시합니다.</li><li>최종 담당자가 인쇄 미리보기와 변경 요청을 확인합니다.</li><li>최종 확정하면 교인용 링크에 해당 주보가 공개됩니다.</li><li>그 뒤의 수정은 새 초안으로 보관되며, 다시 확정하기 전까지 이전 확정본이 공개됩니다.</li></ol>${btn('교인용 링크 복사','share','primary')}</section><section class="panel"><h2>개인 초대 링크</h2><p>관리자가 이름별 개인 초대 링크를 만듭니다. 초대 링크는 해당 편집자에게만 전달해 주세요. 내 이름 버튼에서 로그아웃할 수 있습니다.</p>${T.manageEditors?btn('편집자 초대','manage-editors',''):''}</section><section class="panel"><h2>이전 자료와 백업</h2><p>기존 브라우저의 자료는 그대로 남아 있습니다. 가져오기를 선택한 자료만 공유 보관함에 추가되며, 같은 날짜의 기존 공유 주보를 덮어쓰지 않습니다.</p>${btn('이 기기의 이전 주보 가져오기','import-local','')}${btn('공유 주보 JSON 백업','export','','download')}</section></div>`;if(localOnly)return pageHeading('GITHUB PAGES','주보를 준비하는 방법','누구나 링크를 열 수 있습니다. 편집 자료는 각자의 브라우저에 저장됩니다.')+`<div class="guide-grid"><section class="panel"><h2>편집하고 PDF로 전달해요</h2><ol><li>이 브라우저에서 사용할 이름을 등록합니다.</li><li>주보를 수정하고 미리보기를 확인합니다.</li><li>내 진행 화면에서 6개 항목을 확인합니다.</li><li>완성한 PDF를 다운로드해 교인에게 전달합니다.</li></ol></section><section class="panel"><h2>저장 범위</h2><p>새로고침해도 같은 브라우저에서 이어서 편집할 수 있습니다. 다른 기기나 교인과 자동으로 공유되지 않습니다. 브라우저 데이터를 지우기 전에 JSON 백업과 PDF를 다운로드해 주세요.</p>${btn('이 브라우저 JSON 백업','export','primary','download')}</section><section class="panel"><h2>주간 보관함</h2><p>새 주보를 만들어도 이전 주보와 확정본은 이 브라우저에 보존됩니다. 예배 안내와 섬김이 등 고정 정보는 원본 PDF를 유지합니다.</p></section><section class="panel"><h2>함께 편집하려면</h2><p>여러 사람이 같은 주보를 온라인으로 편집하는 기능에는 별도의 공유 저장소와 로그인 연결이 필요합니다. 현재 이 사이트에는 연결되어 있지 않습니다.</p></section></div>`;return pageHeading('OUR WORKSPACE','함께 준비하는 방법','편집 내용과 진행 상태를 같은 주보에 모읍니다.')+`<div class="guide-grid"><section class="panel"><h2>이번 주 작업 순서</h2><ol><li>로그인한 뒤 표시 이름을 등록합니다.</li><li>팀 진행 화면에서 담당 항목을 정합니다.</li><li>각자 수정하고 내 부분을 완료로 표시합니다.</li><li>최종 담당자가 미리보기와 요청을 확인합니다.</li><li>최종 확정한 PDF를 배포합니다.</li></ol></section><section class="panel"><h2>안전하게 이어서 작업해요</h2><p>변경은 이름·시간·이전 내용과 함께 서버에 저장합니다. 완료한 항목을 다시 수정하면 진행 중으로 돌아갑니다. 동시에 같은 항목을 수정하면 비교 화면이 나타납니다.</p><p>기존 브라우저 자료는 그대로 보존합니다. 서버와 이름을 등록한 뒤 공유 보관함으로 가져올 수 있습니다.</p>${btn('공유 주보 JSON 백업','export','primary','download')}${btn('이 기기의 이전 주보 가져오기','import-local','')}</section><section class="panel"><h2>고정된 교회 정보</h2><p>예배 및 집회 안내, 교회 섬김이 정보, 봉사자·주중 집회 표의 제목과 항목명은 원본 PDF에서 그대로 보존합니다. 날짜·담당자·본문은 해당 입력 칸에서 수정하세요.</p></section><section class="panel"><h2>현재 범위</h2><p>공유 편집, 이름과 변경 기록, 담당별 완료 표시, 주간 보관함과 PDF 다운로드를 지원합니다. AI가 요청을 해석하는 기능과 교인용 공개 주보 링크는 아직 연결되지 않았습니다.</p><p>이 사이트의 접속 권한과 외부 초대는 호스팅 설정에 따릅니다.</p></section></div>`;}
function render(){
 $('#desktop-nav').innerHTML=navs.map(([v,ic,short,long])=>`<button class="nav-item ${view===v?'active':''}" data-view="${v}" aria-current="${view===v?'page':'false'}">${icon(ic)}${long}</button>`).join('');
 $('#mobile-nav').innerHTML=navs.map(([v,ic,short])=>`<button class="${view===v?'active':''}" data-view="${v}" aria-current="${view===v?'page':'false'}">${icon(ic)}${short}</button>`).join('');
 $('#breadcrumb').textContent='주보 / '+(navs.find(x=>x[0]===view)?.[3]||'디자인 안내');
 if(cloudOnly&&!initialized){$('#main').innerHTML=pageHeading('SHARED BULLETINS',connected?'공유 주보를 준비해 주세요':'공유 주보를 불러오는 중…',connected?'등록된 주보가 없습니다. 이 기기의 자료를 가져오거나 예시 주보로 시작할 수 있습니다.':'온라인에 저장된 최신 내용을 확인하고 있습니다.',connected?btn('공유 주보 준비하기','cloud-start','primary'):'');return;}
 $('#main').innerHTML=({editor,preview,archive,review,guide}[view]||editor)();
 if(!profile||!initialized)document.querySelectorAll('#fields input,#fields textarea,[data-task-status],[data-assign]').forEach(e=>e.disabled=true);
 if(view==='preview'&&previewMode==='print')window.BulletinPrintView.render(B.clone(issue()));
}
async function navigate(v){if(!await flush())return;view=v;location.hash=v;render();window.scrollTo({top:0,behavior:'auto'});}
function showDialog(content){$('#dialog-content').innerHTML=content;$('#dialog').showModal();}
function newWeek(){showDialog(`<h2>새로운 한 주를 준비해요</h2><p>현재 주보를 바탕으로 새 초안을 만듭니다. 이전 주보는 그대로 남습니다.</p><div class="callout" style="margin:18px 0">설교 제목·본문, 기도제목, 헌금 금액은 새로 입력합니다. 복사한 소식과 일정은 날짜를 확인해 주세요.</div><form id="new-week-form"><label class="field"><span>새 주보의 주일 날짜</span><input id="new-date" type="date" required value="${B.nextWeek(issue().date)}"></label><div class="dialog-error" id="new-error" role="alert"></div><div class="actions"><button type="button" class="btn" data-action="close-dialog">취소</button><button type="submit" class="btn primary">새 초안 만들기</button></div></form>`);}
async function exportData(){if(!await flush())return;const backup=localOnly?{...store,pagesBackup:await T.getBackup()}:store;const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='kpcstl-bulletins-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(wording('공유 주보와 변경 기록을 JSON으로 내보냈습니다.','이 브라우저의 주보와 변경 기록을 JSON으로 내보냈습니다.'));}
document.addEventListener('input',e=>{const t=e.target;if(t.dataset.field){if(locked())return;pending.set(t.dataset.field,t.value);persistPending();status('입력 중 · 저장 대기');clearTimeout(timer);if(!e.isComposing){refreshLive();timer=setTimeout(flush,700);}}if(t.id==='archive-search'){query=t.value;$('#archive-results').innerHTML=archiveResults();}});
document.addEventListener('compositionstart',()=>clearTimeout(timer));
document.addEventListener('compositionend',e=>{if(e.target.dataset.field){pending.set(e.target.dataset.field,e.target.value);persistPending();refreshLive();timer=setTimeout(flush,700);}});
document.addEventListener('change',async e=>{const t=e.target;if(t.id==='year-filter'){year=t.value;$('#archive-results').innerHTML=archiveResults();}if(t.id==='month-filter'){month=t.value;$('#archive-results').innerHTML=archiveResults();}if(t.id==='actor-filter'){actorFilter=t.value;render();}if(t.dataset.assign&&await flush()){await mutation('task',{section:t.dataset.assign,assigneeId:t.value||null});render();}if(t.id==='coordinator-select'&&await flush()){await mutation('coordinator',{memberId:t.value});render();}});
document.addEventListener('click',async e=>{
 const t=e.target.closest('button,a');if(!t)return;
 const a=t.dataset.action;
 if(a==='profile'){if(conflict){showConflict();return;}if(await flush())showProfile();return;}
 if(a==='close-dialog'){if(profile)$('#dialog').close();return;}
 if(a==='conflict-mine'||a==='conflict-server'){
  if(!conflict)return;const c=conflict;updateIssue(c.current);if(c.mapping)remapPending(c.mapping);
  if(a==='conflict-server')for(const [path,value]of Object.entries(c.changes)){let changed=true;try{changed=c.conflictingPaths?c.conflictingPaths.includes(path):safeValue(c.current,path)!==safeValue(c.base,path);}catch{}if(changed&&pending.get(path)===value)pending.delete(path);}
  conflict=null;$('#dialog').close();persistPending();if(await flush())render();return;
 }
 if(operationBusy)return;
 if(t.dataset.view){e.preventDefault();await navigate(t.dataset.view);return;}
 if(t.dataset.section){if(!await flush())return;section=t.dataset.section;render();return;}
 if(t.dataset.preview){if(!await flush())return;previewMode=t.dataset.preview;render();return;}
 if(t.dataset.editSection){if(!await flush())return;section=t.dataset.editSection;await navigate('editor');return;}
 if(t.dataset.open){if(!await flush())return;if(!selectIssue(t.dataset.open))return;await navigate(t.dataset.openView);restorePending();return;}
 if(t.dataset.actor){actorFilter=actorFilter===t.dataset.actor?'all':t.dataset.actor;render();return;}
 if(!await flush())return;
 if(t.dataset.taskSection){await mutation('task',{section:t.dataset.taskSection,status:t.dataset.taskStatus});render();return;}
 if(t.dataset.resolve){await mutation('resolve',{requestId:t.dataset.resolve});render();return;}
 if(t.dataset.finalVersion){try{const data=await T.getVersion(issue().id,Number(t.dataset.finalVersion));await downloadPdf(true,data.issue);}catch(err){toast(err.message);}return;}
 if(!a)return;
 try{
  if(a==='new-week'){if(!profile){showProfile();return;}newWeek();}
  else if(a==='print-preview'){previewMode='print';await navigate('preview');}
  else if(a==='download-pdf')await downloadPdf();
  else if(a==='final-pdf')await downloadPdf(true);
  else if(a==='source'){previewMode='source';await navigate('preview');}
  else if(a==='back-edit')await navigate('editor');
  else if(a==='export')await exportData();
  else if(a==='logout'&&cloudOnly&&T.logout)await T.logout();
  else if(a==='published-view'&&cloudOnly)location.assign(T.readerUrl||T.shareUrl);
  else if(a==='manage-editors'&&cloudOnly&&T.manageEditors)await T.manageEditors();
  else if(a==='cloud-start'&&cloudOnly){T.initialIssues=await T.prepareMigration();await initializeShared();}
  else if(a==='undo'){if(await mutation('undo')){render();toast(T.sharedEditing?'편집팀의 마지막 수정을 되돌렸습니다.':'내 마지막 수정을 되돌렸습니다.');}}
  else if(a.startsWith('list-')){if(await mutation('list',{list:t.dataset.list,action:a.slice(5),index:Number(t.dataset.index)}))render();}
  else if(a==='add-request'){if(await mutation('request',{body:$('#request-body').value,section})){await navigate('review');toast('이름과 함께 변경 요청을 저장했습니다.');}}
  else if(a==='add-comment'){if(await mutation('comment',{body:$('#comment-body').value}))render();}
  else if(a==='more-history'){historyCount+=50;render();}
  else if(a==='migration-ack'){if(await mutation('migration-ack'))render();}
  else if(a==='share'){try{await navigator.clipboard.writeText((T.shareUrl||location.origin+'/studio.html'));toast(wording(cloudOnly?'같이 사용하는 주보 앱 링크를 복사했습니다.':'주보 스튜디오 링크를 복사했습니다.','앱 링크를 복사했습니다. 내 편집 내용은 링크에 포함되지 않습니다.'));}catch{showDialog(`<h2>${cloudOnly?'함께 사용하는 주보 앱 링크':'주보 스튜디오 링크'}</h2><label class="field"><span>복사해서 공유하세요</span><input readonly value="${esc((T.shareUrl||location.origin+'/studio.html'))}"></label>${btn('닫기','close-dialog','')}`);}}
  else if(a==='import-local'&&cloudOnly){T.initialIssues=await T.prepareMigration();await initializeShared();}
  else if(a==='import-local'){
   if(!profile){showProfile();return;}let added=0,skipped=0;
   for(const i of legacyStore.issues){try{const r=await T.call(T.command('import',null,{issue:i}));updateIssue(r.issue);added++;}catch(err){if(err.status===409)skipped++;else throw err;}}
   render();toast(`${added}개 주보를 가져왔습니다. 같은 날짜 ${skipped}개는 기존 공유 내용을 유지했습니다.`);
  }
  else if(a==='finalize'){
   const pdf=await window.BulletinPrintView.get(B.clone(issue()));
   if(!pdf.exportable){previewMode='print';await navigate('preview');toast('인쇄 미리보기의 확인 항목을 먼저 해결해 주세요.');return;}
   if(!T.ready(issue())){toast('모든 담당 항목을 완료한 뒤 확정해 주세요.');return;}
   finalReview={id:issue().id,version:issue().version,revision:issue().revision};
   showDialog(`<h2>배포할 주보를 확정할까요?</h2><p>${dateLabel(issue().date)} · v${issue().revision}</p><p>6개 항목이 완료됐습니다. ${esc(profile.name)}님의 이름과 확정 시간이 기록됩니다.</p>${cloudOnly?'<p>확정하면 확정된 주보 보기에서 이 주보를 볼 수 있습니다.</p>':''}<div class="actions">${btn('다시 검토','close-dialog','')}${btn('확정하고 PDF 받기','confirm-finalize','primary')}</div>`);
  }
  else if(a==='confirm-finalize'){if(!finalReview||issue().id!==finalReview.id||issue().version!==finalReview.version){$('#dialog').close();toast('내용이나 진행 상태가 바뀌었습니다. 최신 미리보기를 확인한 뒤 다시 확정해 주세요.');return;}if(await mutation('finalize',{baseVersion:finalReview.version})){$('#dialog').close();render();await downloadPdf(true);}}
 }catch(err){toast(err.message);}
});
document.addEventListener('submit',async e=>{
 if(e.target.id==='profile-form'){e.preventDefault();const button=e.target.querySelector('button[type="submit"]');button.disabled=true;try{const result=await T.call({op:'profile',name:$('#display-name').value});profile=result.profile;members=result.members;$('#dialog').close();await initializeShared();}catch(err){$('#profile-error').textContent=err.message;}finally{button.disabled=false;}}
 if(e.target.id==='new-week-form'){e.preventDefault();const next=await mutation('new-week',{date:$('#new-date').value});if(next){selectIssue(next.id);$('#dialog').close();section='sermon';await navigate('editor');toast('이전 주를 보존하고 새 주보를 만들었습니다. 담당과 날짜를 확인해 주세요.');}else $('#new-error').textContent='새 주보를 만들지 못했습니다. 날짜와 연결 상태를 확인해 주세요.';}
});
$('#dialog').addEventListener('cancel',e=>{if(!profile||conflict)e.preventDefault();});
window.addEventListener('beforeunload',e=>{if(pending.size||flushPromise){persistPending();e.preventDefault();e.returnValue='';}});
window.addEventListener('online',()=>{if(pending.size)flush();else synchronize();});
window.addEventListener('hashchange',()=>{const v=location.hash.slice(1);if(['editor','preview','review','archive','guide'].includes(v)&&v!==view)navigate(v);});
async function synchronize(){
 if(!profile||pending.size||flushPromise||operationBusy||conflict||document.hidden||$('#dialog').open||document.activeElement?.matches('input,textarea,select'))return;
 try{const data=await T.call(),changed=JSON.stringify(data.issues.map(i=>[i.id,i.version]))!==JSON.stringify(store.issues.map(i=>[i.id,i.version]))||JSON.stringify(visibleMembers(data))!==JSON.stringify(members);applyShared(data);notifyConnection();if(changed){render();toast(wording('팀의 최신 작업을 불러왔습니다.','다른 탭에서 저장한 최신 내용을 불러왔습니다.'));}}
 catch(error){connected=false;status('연결 대기',true);notifyConnection(wording('인터넷 연결을 기다립니다. 새 입력은 이 기기에 복구용으로 보관됩니다.','이 브라우저의 저장 상태를 확인해 주세요. 저장되지 않은 입력은 화면에 유지됩니다.'),true);notifyAuth(error);}
}
setInterval(synchronize,8000);
if(cloudOnly){
 T.beforeSessionChange=async()=>{if(operationBusy||conflict)return false;if(!await flush())return false;setBusy(true);return true;};
 T.cancelSessionChange=()=>setBusy(false);
}
view=['editor','preview','review','archive','guide'].includes(location.hash.slice(1))?location.hash.slice(1):'editor';
render();initializeShared().catch(e=>{status(wording('공유 연결 확인 필요','기기 저장소 확인 필요'),true);notifyConnection(e.message,true);if(cloudOnly)notifyAuth(e);else if(!localOnly&&e.status===401)$('#connection-banner').innerHTML='로그인 후 다시 열어 주세요. <a href="/signin-with-chatgpt?return_to=%2Fstudio.html" target="_top">로그인하기</a>';});
})();
