/* Preview uses the exported PDF itself, including its embedded Korean fonts. */
(() => {
  'use strict';
  let cachedKey='',cachedPromise=null,libraryPromise=null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const snapshotKey=i=>JSON.stringify([i.date,i.revision,i.sermon,i.worship,i.sections,i.roster,i.midweek,i.announcements,i.offering,i.questions,i.migrationNotes]);
  function get(issue){
    const key=snapshotKey(issue);
    if(key!==cachedKey||!cachedPromise){
      cachedKey=key;
      cachedPromise=window.BulletinPrint.generate(JSON.parse(JSON.stringify(issue))).catch(e=>{if(cachedKey===key)cachedPromise=null;throw e;});
    }
    return cachedPromise;
  }
  function save(result){
    if(!result.exportable)throw Error('인쇄 칸을 넘는 내용이 있습니다. 미리보기의 안내 항목을 먼저 수정해 주세요.');
    const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/pdf'}));
    const a=document.createElement('a');a.href=url;a.download=result.filename;a.rel='noopener';a.target='_blank';
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function markup(){return '<section class="print-preview" aria-label="편집본 인쇄 미리보기"><div id="print-status" class="callout info" role="status">편집 내용을 반영한 PDF를 만들고 있습니다…</div><p class="preview-caption">원본의 배경과 섹션 위치를 유지합니다. 고정 안내와 표의 항목명은 원본 그대로 보존합니다. 새 한글의 글꼴은 원본과 차이가 있을 수 있습니다.</p><div id="print-warnings"></div><div id="print-pages" class="print-pages" aria-busy="true"></div></section>';}
  async function render(issue){
    const host=document.getElementById('print-pages'),status=document.getElementById('print-status'),warnings=document.getElementById('print-warnings');
    if(!host)return;
    const key=snapshotKey(issue);
    let pdf;
    try{
      const result=await get(issue);if(!host.isConnected||key!==cachedKey)return;
      status.innerHTML=`<strong>${esc(result.date)} · v${result.revision} · ${result.pages}쪽</strong><br>${result.exportable?'아래 화면과 다운로드 파일은 같은 PDF입니다. 용지: US Letter · 인쇄 배율: 실제 크기(100%).':'내용이 넘치는 곳에 빨간 테두리가 표시됩니다. 해당 항목을 수정하면 다운로드할 수 있습니다.'}`;
      warnings.innerHTML=result.warnings.map(w=>`<div class="print-warning ${w.blocking?'blocking':''}"><span>${esc(w.message)}</span>${w.blocking?`<button class="btn small" data-edit-section="${esc(w.section)}">${esc(w.label)} 수정</button>`:''}</div>`).join('');
      document.querySelectorAll('[data-action="download-pdf"]').forEach(b=>{b.disabled=!result.exportable;b.title=result.exportable?'현재 편집 내용을 PDF로 저장':'미리보기의 넘침 안내를 먼저 확인해 주세요.';});
      libraryPromise=libraryPromise||import('./vendor/pdf.min.mjs').catch(e=>{libraryPromise=null;throw e;});
      const lib=await libraryPromise;if(!host.isConnected)return;
      lib.GlobalWorkerOptions.workerSrc=new URL('vendor/pdf.worker.min.mjs',document.baseURI).href;
      pdf=await lib.getDocument({data:result.bytes.slice(),isEvalSupported:false}).promise;
      if(!host.isConnected)return;
      for(let n=1;n<=pdf.numPages;n++){
        if(!host.isConnected)return;
        const page=await pdf.getPage(n),figure=document.createElement('figure'),canvas=document.createElement('canvas'),caption=document.createElement('figcaption');
        canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`편집본 ${n}쪽. 접근 가능한 내용은 디지털 보기에서 확인하세요.`);
        const scale=Math.min(window.devicePixelRatio||1,2)*1.2,viewport=page.getViewport({scale});
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        caption.textContent=`${n} / 4 · ${['예배 순서와 일정','교회 소식과 헌금','말씀 나눔 1','말씀 나눔 2'][n-1]}`;
        figure.append(canvas,caption);host.append(figure);
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;page.cleanup();
      }
    }catch(e){
      if(host.isConnected){status.textContent='PDF 미리보기를 표시하지 못했습니다. 다운로드 버튼으로 파일을 저장하거나 다시 시도해 주세요.';host.innerHTML='<button class="btn" data-action="print-preview">미리보기 다시 시도</button>';}
      console.error('PDF preview failed',e);
    }finally{if(host.isConnected)host.setAttribute('aria-busy','false');if(pdf)await pdf.destroy();}
  }
  window.BulletinPrintView={get,save,markup,render};
})();
