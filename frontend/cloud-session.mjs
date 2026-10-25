const invitationPattern=/^kpc_inv_[A-Za-z0-9_-]{43}$/;
const tokenPattern=/^[-A-Za-z0-9._~+/]+=*$/;
const fail=(message,code,status)=>Object.assign(Error(message),{code,...(status?{status}:{})});

export function publicDirectory(value){
  const url=new URL('.',value);url.search='';url.hash='';return url;
}

export function invitationLink(directory,code){
  if(typeof code!=='string'||!invitationPattern.test(code))throw fail('초대 코드를 확인해 주세요.','INVALID_INVITATION');
  const url=new URL('studio.html',publicDirectory(directory));url.hash='invite='+code;return url.href;
}

// A link opened on an already loaded studio page changes only the hash. Flush
// the current editor first; the new invitation stays in memory only until login.
export function watchInvitationLinks({window,session,beforeSwitch=async()=>true,cancelSwitch=()=>{},onError=()=>{},reload=()=>window.location.reload()}){
  let busy=false;
  const changed=async()=>{
    const fragment=new URLSearchParams(window.location.hash.slice(1));
    if(!fragment.has('invite'))return;
    const code=fragment.get('invite');
    window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
    if(busy){onError(fail('로그인을 확인하는 중입니다. 잠시 후 개인 초대 링크를 다시 열어 주세요.','BUSY'));return;}
    busy=true;let prepared=false;
    try{
      prepared=await beforeSwitch();
      if(!prepared)throw fail('현재 입력의 저장 또는 충돌 확인을 마친 뒤 개인 초대 링크를 다시 열어 주세요.','PENDING_CHANGES');
      await session.login(code);
      reload();
    }catch(error){if(prepared)cancelSwitch();onError(error);}
    finally{busy=false;}
  };
  window.addEventListener('hashchange',changed);
  return ()=>window.removeEventListener('hashchange',changed);
}

export function createCloudSession({apiBaseUrl,directory,storage,fetch:fetcher=globalThis.fetch,now=Date.now,timeoutMs=15000}={}){
  let api;
  try{
    if(typeof apiBaseUrl!=='string'||/[\u0000-\u0020\u007f\\]/.test(apiBaseUrl)||!/^https?:\/\//i.test(apiBaseUrl))throw Error();
    api=new URL(apiBaseUrl);
    const local=['localhost','127.0.0.1','[::1]'].includes(api.hostname);
    if(!(api.protocol==='https:'||(api.protocol==='http:'&&local))||api.pathname!=='/'||api.search||api.hash||api.username||api.password)throw Error();
  }catch{throw fail('공유 서버 주소 설정을 확인해 주세요.','CONFIG');}
  if(!storage||typeof storage.getItem!=='function'||typeof fetcher!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw fail('공유 로그인 설정을 확인해 주세요.','CONFIG');
  const key='kpcstl.cloud-session.v1:'+api.origin+'|'+publicDirectory(directory).href;
  let activeToken=null;
  const clear=()=>{try{storage.removeItem(key);}catch{throw fail('로그인 정보를 지우지 못했습니다. 브라우저 저장 권한을 확인해 주세요.','STORAGE');}};
  function saved(){
    let raw;
    try{raw=storage.getItem(key);}catch{throw fail('브라우저 저장소를 열 수 없습니다. 저장 권한을 확인해 주세요.','STORAGE');}
    if(!raw)return null;
    let value;try{value=JSON.parse(raw);}catch{clear();return null;}
    if(!value||typeof value.token!=='string'||!tokenPattern.test(value.token)||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=now()){clear();return null;}
    return {token:value.token,expiresAt:value.expiresAt};
  }
  function getToken(){
    const session=saved();
    if(!session)throw fail('로그인이 만료되었습니다. 개인 초대 링크로 다시 로그인해 주세요.','AUTH_REQUIRED',401);
    if(activeToken&&activeToken!==session.token)throw fail('다른 탭에서 로그인이 바뀌었습니다. 현재 입력은 보관됩니다. 다시 로그인해 편집자를 확인해 주세요.','SESSION_CHANGED',401);
    activeToken=session.token;return session.token;
  }
  async function request(path,{method='GET',body,authenticated=true}={}){
    const token=authenticated?getToken():null;
    const controller=new AbortController();let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail('서버 응답이 늦습니다. 잠시 후 다시 시도해 주세요.','TIMEOUT'));},timeoutMs);});
    const work=async()=>{
      let response;
      try{response=await fetcher(new URL(path,api).href,{method,credentials:'omit',mode:'cors',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
      catch{throw fail('인터넷 연결을 확인하고 다시 시도해 주세요. 입력한 주보는 지워지지 않습니다.','NETWORK');}
      if(response.status===401){if(authenticated)clear();throw fail(authenticated?'로그인이 만료되었거나 접근 권한이 해제되었습니다. 개인 초대 링크로 다시 로그인해 주세요.':'초대 코드가 올바르지 않거나 만료되었습니다. 담당자에게 새 초대 링크를 요청해 주세요.','AUTH_REQUIRED',401);}
      if(response.status===403)throw fail('이 작업은 관리자만 할 수 있습니다.','FORBIDDEN',403);
      let data;try{data=await response.json();if(!data||typeof data!=='object'||Array.isArray(data))throw Error();}catch{throw fail('서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.','INVALID_RESPONSE',response.ok?undefined:response.status);}
      if(!response.ok)throw fail(typeof data.error==='string'?data.error:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.','HTTP_ERROR',response.status);
      return data;
    };
    try{return await Promise.race([work(),timeout]);}finally{clearTimeout(timer);}
  }
  function identity(data){
    if(!data.user||typeof data.user.id!=='string'||typeof data.user.name!=='string'||typeof data.isAdmin!=='boolean')throw fail('로그인 정보를 확인할 수 없습니다.','INVALID_RESPONSE');
    return {user:{id:data.user.id,name:data.user.name},isAdmin:data.isAdmin,expiresAt:data.expiresAt};
  }
  return Object.freeze({
    getToken,
    async restore(){if(!saved())return null;return identity(await request('/api/session'));},
    async login(code){
      if(typeof code!=='string'||!invitationPattern.test(code.trim()))throw fail('받으신 개인 초대 코드(kpc_inv_로 시작)를 입력해 주세요.','INVALID_INVITATION');
      const data=await request('/api/login',{method:'POST',body:{code:code.trim()},authenticated:false});
      const user=identity(data);
      if(typeof data.token!=='string'||!tokenPattern.test(data.token)||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=now())throw fail('로그인 정보를 확인할 수 없습니다.','INVALID_RESPONSE');
      try{storage.setItem(key,JSON.stringify({token:data.token,expiresAt:data.expiresAt}));}
      catch{throw fail('로그인을 유지할 수 없습니다. 브라우저 저장 권한을 확인해 주세요.','STORAGE');}
      activeToken=data.token;
      return user;
    },
    async logout(){try{if(saved())await request('/api/logout',{method:'POST'});}finally{clear();}},
    async listEditors(){const data=await request('/api/access');if(!Array.isArray(data.editors))throw fail('편집자 목록을 확인할 수 없습니다.','INVALID_RESPONSE');return data.editors;},
    async inviteEditor(name){if(typeof name!=='string'||!name.trim()||name.trim().length>60)throw fail('편집자 이름을 1~60자로 입력해 주세요.','INVALID_NAME');const data=await request('/api/access',{method:'POST',body:{name:name.trim()}});if(!invitationPattern.test(data.code))throw fail('초대 링크를 확인할 수 없습니다.','INVALID_RESPONSE');return data;},
    revokeEditor:id=>request('/api/access?id='+encodeURIComponent(id),{method:'DELETE'}),
  });
}
