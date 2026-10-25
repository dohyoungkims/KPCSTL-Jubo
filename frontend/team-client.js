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
  // baseUrl is the complete team endpoint. It is fixed for this client so neither
  // commands nor version identifiers can redirect an editor's access token.
  function createRemoteClient({baseUrl,getToken,allowAnonymous=false,fetch:fetcher=globalThis.fetch,timeoutMs=15000}={}){
    let endpoint;
    try{
      if(typeof baseUrl!=='string'||/[\u0000-\u0020\u007f\\]/.test(baseUrl)||!/^https?:\/\//i.test(baseUrl))throw Error();
      endpoint=new URL(baseUrl);
      const loopback=['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname);
      if(!(endpoint.protocol==='https:'||(endpoint.protocol==='http:'&&loopback))||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error();
    }catch{throw TypeError('공유 서버 주소는 HTTPS API 주소여야 합니다.');}
    if(typeof allowAnonymous!=='boolean')throw TypeError('공유 접근 설정이 올바르지 않습니다.');
    if(getToken===undefined&&allowAnonymous)getToken=()=>null;
    if(typeof getToken!=='function'||typeof fetcher!=='function')throw TypeError('공유 저장에는 로그인과 서버 연결 설정이 필요합니다.');
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw TypeError('서버 대기 시간 설정이 올바르지 않습니다.');
    const failure=(message,code,details={})=>Object.assign(Error(message),{code,...details});
    const authFailure=()=>failure('로그인이 필요합니다. 다시 로그인한 뒤 저장해 주세요.','AUTH_REQUIRED',{status:401});
    async function request(url,command){
      const controller=new AbortController();
      let timeout;
      const expired=new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(failure('서버 응답이 늦습니다. 입력 내용은 이 기기에 보관됩니다. 연결 후 다시 저장해 주세요.','TIMEOUT'));},timeoutMs);});
      const work=async()=>{
        let token;
        try{token=await getToken();}catch{throw authFailure();}
        if(controller.signal.aborted)throw failure('서버 응답 시간이 초과됐습니다. 다시 저장해 주세요.','TIMEOUT');
        const anonymous=allowAnonymous&&(token===null||token===undefined||token==='');
        if(!anonymous&&(typeof token!=='string'||!token||!/^[-A-Za-z0-9._~+/]+=*$/.test(token)))throw authFailure();
        let response;
        try{
          response=await fetcher(url.href,{method:command?'POST':'GET',credentials:'omit',mode:'cors',redirect:'error',cache:'no-store',signal:controller.signal,headers:{...(!anonymous?{Authorization:`Bearer ${token}`}:{ }),Accept:'application/json',...(command?{'Content-Type':'application/json'}:{})},...(command?{body:JSON.stringify(command)}:{})});
        }catch{throw failure('공유 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 저장해 주세요.','NETWORK');}
        if(response.status===401)throw authFailure();
        if(response.status===403)throw failure('이 주보를 편집할 권한이 없습니다. 담당자에게 접근 권한을 요청해 주세요.','FORBIDDEN',{status:403});
        let data;
        try{data=await response.json();if(!data||typeof data!=='object'||Array.isArray(data))throw Error();}
        catch{throw failure('서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.','INVALID_RESPONSE',response.ok?{}:{status:response.status});}
        if(!response.ok)throw failure(typeof data.error==='string'&&data.error?data.error:'저장하지 못했습니다.',response.status===409?'CONFLICT':'HTTP_ERROR',{status:response.status,...(response.status===409&&data.current?{current:data.current}:{})});
        return data;
      };
      try{return await Promise.race([work(),expired]);}
      finally{clearTimeout(timeout);}
    }
    return Object.freeze({
      call:command=>request(new URL(endpoint.href),command),
      getVersion(issueId,version){
        if(typeof issueId!=='string'||!issueId||!Number.isSafeInteger(Number(version))||Number(version)<1)return Promise.reject(failure('해당 기록을 찾을 수 없습니다.','INVALID_VERSION',{status:400}));
        const url=new URL(endpoint.href);url.searchParams.set('issue',issueId);url.searchParams.set('version',String(Number(version)));
        return request(url);
      }
    });
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
  async function getVersion(issueId,version){
    const response=await fetch(`/api/team?issue=${encodeURIComponent(issueId)}&version=${Number(version)}`,{credentials:'same-origin',cache:'no-store'});
    const data=await response.json();if(!response.ok)throw Error(data.error||'해당 기록을 찾을 수 없습니다.');return data;
  }
  return {areas,call,command,ready,initials,rebase,getVersion,createRemoteClient};
});
