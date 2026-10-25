/* Authenticated shared data. Local recovery copies never replace server data. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BulletinTeam=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const areas={sermon:'설교 · 예배',announcements:'교회 소식',volunteers:'봉사 · 애찬',schedule:'모임 · 일정',prayers:'기도 · 헌금',questions:'설교 질문'};
  async function call(command,options={}){
    const fetcher=options.fetch||globalThis.fetch,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetcher('/api/team',{method:command?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,...(command?{headers:{'Content-Type':'application/json'},body:JSON.stringify(command)}:{})});
      let data;try{data=await response.json();}catch{throw Error('서버에 연결하지 못했습니다. 로그인과 인터넷 연결을 확인해 주세요.');}
      if(!response.ok){const error=Error(data.error||'저장하지 못했습니다.');Object.assign(error,{status:response.status,current:data.current});throw error;}
      return data;
    }catch(e){if(e.name==='AbortError')throw Error('서버 응답이 늦습니다. 입력 내용은 이 기기에 보관됩니다. 연결 후 다시 저장해 주세요.');throw e;}
    finally{clearTimeout(timeout);}
  }
  const command=(op,issue,args={})=>({op,issueId:issue?.id,baseVersion:issue?.version,commandId:crypto.randomUUID(),...args});
  const ready=i=>Object.keys(areas).every(k=>i.tasks?.[k]?.status==='done')&&!i.migrationNotes?.length;
  const initials=name=>Array.from((name||'?').trim()).slice(0,2).join('');
  function rebase(base,current,changes){
    const next={},mapping={},conflicts=[];
    const valueAt=(obj,path)=>path.split('.').reduce((v,k)=>v?.[k],obj);
    for(const [path,value]of Object.entries(changes)){
      let target=path,deleted=false;
      const match=path.match(/^(announcements|questions)\.(\d+)\.(title|body|number)$/);
      if(match){const [,list,index,key]=match,id=base[list]?.[Number(index)]?.id,newIndex=current[list]?.findIndex(x=>x.id===id);if(newIndex<0||newIndex===undefined)deleted=true;else target=`${list}.${newIndex}.${key}`;}
      mapping[path]=deleted?null:target;
      if(!deleted)next[target]=value;
      const before=valueAt(base,path),remote=deleted?undefined:valueAt(current,target);
      if(deleted||(remote!==before&&remote!==value))conflicts.push({path:target,originalPath:path,value,before,remote,deleted});
    }
    return {changes:next,mapping,conflicts};
  }
  return {areas,call,command,ready,initials,rebase};
});
