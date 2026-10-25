// Invitation fragments never reach application navigation, saved links or logs.
let invitationCode=null;
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('invite')){
  invitationCode=fragment.get('invite');
  history.replaceState(history.state,'',location.pathname+location.search);
}

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const directory=new URL('.',location.href);directory.search='';directory.hash='';
const publicUrl=directory.href;
const editorUrl=new URL('studio.html',directory).href;
const $=selector=>document.querySelector(selector);

function showLogin(session,message='',invitation=null){
  document.body.classList.add('cloud-auth');
  $('#save-status').textContent='편집자 로그인';
  $('#connection-banner').hidden=true;
  $('#main').innerHTML=`<section class="panel cloud-login"><div class="eyebrow">KPCSTL · EDITOR ACCESS</div><h1>함께 주보를 준비해요</h1><p>받으신 개인 초대 링크를 열거나 초대 코드를 입력해 주세요. 로그인하면 여러 기기에서 같은 주보를 편집할 수 있습니다.</p><form id="cloud-login-form"><label class="field"><span>개인 초대 코드</span><input id="cloud-invitation" type="password" required minlength="51" maxlength="51" autocomplete="one-time-code" autocapitalize="none" spellcheck="false"></label><p class="cloud-auth-error" id="cloud-login-error" role="alert">${escape(message)}</p><button class="btn primary" type="submit">편집자로 로그인</button></form><p class="field-help">초대 링크는 본인만 사용해 주세요. 교인에게는 아래 주보 링크를 공유하시면 됩니다.</p><a class="btn" href="${escape(publicUrl)}">교인용 주보 보기</a></section>`;
  return new Promise(resolve=>{
    const form=$('#cloud-login-form'),input=$('#cloud-invitation'),button=form.querySelector('button');
    let busy=false;
    async function login(code){
      if(busy)return;busy=true;button.disabled=true;button.textContent='로그인 확인 중…';$('#cloud-login-error').textContent='';input.value='';
      try{const user=await session.login(code);document.body.classList.remove('cloud-auth');resolve(user);}
      catch(error){$('#cloud-login-error').textContent=error.message;input.focus();}
      finally{busy=false;button.disabled=false;button.textContent='편집자로 로그인';}
    }
    form.addEventListener('submit',event=>{event.preventDefault();login(input.value);});
    if(invitation!==null){const code=invitation;invitation=null;login(code);}else input.focus();
  });
}

function manageEditors(session,user,makeInvitationLink){
  const dialog=$('#dialog'),content=$('#dialog-content');
  content.innerHTML='<h2>편집자 초대</h2><p role="status">편집자 목록을 불러오는 중…</p>';
  dialog.showModal();
  async function refresh(){
    const editors=await session.listEditors();
    content.innerHTML=`<h2>편집자 초대</h2><p>이름별로 개인 초대 링크를 만들어 해당 담당자에게 전달해 주세요.</p><form id="cloud-invite-form"><label class="field"><span>편집자 이름</span><input id="cloud-editor-name" required maxlength="60" placeholder="예: 박태진 목사" autocomplete="off"></label><button class="btn primary" type="submit">개인 초대 링크 만들기</button></form><p id="cloud-access-error" class="cloud-auth-error" role="alert"></p><div id="cloud-invite-result" class="cloud-invite-result" hidden></div><div class="cloud-editor-list">${editors.map(editor=>`<div class="cloud-editor-row"><span><strong>${escape(editor.name)}</strong><small>${editor.role==='admin'?'관리자':editor.revokedAt?'접근 해제됨':editor.expiresAt&&Date.parse(editor.expiresAt)<=Date.now()?'초대 만료':'편집자'}</small></span>${editor.id!==user.user.id&&editor.role!=='admin'&&!editor.revokedAt?`<button class="btn small" type="button" data-revoke-editor="${escape(editor.id)}">접근 해제</button>`:''}</div>`).join('')}</div><button class="btn" id="cloud-access-close" type="button">닫기</button>`;
    $('#cloud-access-close').addEventListener('click',()=>dialog.close());
    $('#cloud-invite-form').addEventListener('submit',async event=>{
      event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;$('#cloud-access-error').textContent='';
      try{
        const editor=await session.inviteEditor($('#cloud-editor-name').value);
        const link=makeInvitationLink(directory,editor.code);
        await refresh();
        const result=$('#cloud-invite-result');result.hidden=false;result.innerHTML=`<h3>${escape(editor.name)}님의 개인 초대 링크</h3><label class="field"><span>이 링크를 해당 편집자에게만 보내 주세요</span><input id="cloud-created-link" readonly value="${escape(link)}"></label><button class="btn" type="button" id="cloud-copy-invite">초대 링크 복사</button><p class="field-help">링크는 이 화면에서만 표시됩니다. 닫기 전에 복사해 주세요.</p>`;
        $('#cloud-copy-invite').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(link);$('#cloud-copy-invite').textContent='복사 완료';}catch{$('#cloud-created-link').focus();$('#cloud-created-link').select();$('#cloud-access-error').textContent='선택된 링크를 직접 복사해 주세요.';}});
      }catch(error){$('#cloud-access-error').textContent=error.message;}
      finally{button.disabled=false;}
    });
    for(const button of content.querySelectorAll('[data-revoke-editor]'))button.addEventListener('click',async()=>{
      button.disabled=true;$('#cloud-access-error').textContent='';
      try{await session.revokeEditor(button.dataset.revokeEditor);await refresh();}catch(error){$('#cloud-access-error').textContent=error.message;button.disabled=false;}
    });
  }
  return refresh().catch(error=>{content.innerHTML=`<h2>편집자 초대</h2><p class="cloud-auth-error" role="alert">${escape(error.message)}</p><button class="btn" id="cloud-access-close" type="button">닫기</button>`;$('#cloud-access-close').addEventListener('click',()=>dialog.close());});
}

async function start(){
  const {default:config}=await import('./cloud-config.mjs');
  if(!config.apiBaseUrl){
    invitationCode=null;
    const domain=await import('./team-domain.browser.mjs');
    const {createPagesStore}=await import('./pages-store.mjs');
    const local=createPagesStore({storage:localStorage,locks:navigator.locks,domain,B:globalThis.Bulletin,key:'kpcstl.github-pages.v1:'+directory.pathname});
    Object.assign(globalThis.BulletinTeam,local,{storageMode:'local',shareUrl:publicUrl});
    await import('./app.js');return;
  }
  const privateEditor=location.pathname.endsWith('/studio.html')||new URLSearchParams(location.search).get('edit')==='1'||invitationCode!==null;
  if(!privateEditor){await import('./public-view.js');return;}
  const {createCloudSession,invitationLink,watchInvitationLinks}=await import('./cloud-session.mjs');
  const session=createCloudSession({apiBaseUrl:config.apiBaseUrl,directory,storage:localStorage});
  let user=null,message='';
  if(invitationCode===null){try{user=await session.restore();}catch(error){message=error.message;}}
  if(!user){const code=invitationCode;invitationCode=null;user=await showLogin(session,message,code);}
  const T=globalThis.BulletinTeam;
  const remote=T.createRemoteClient({baseUrl:new URL('/api/team',config.apiBaseUrl).href,getToken:session.getToken});
  const current=await remote.call();
  if(!current.profile)await remote.call({op:'profile',name:user.user.name});
  const {prepareCloudMigration}=await import('./cloud-migration.mjs');
  const initialIssues=await prepareCloudMigration({remote,B:globalThis.Bulletin,directory,storage:localStorage});
  Object.assign(T,remote,{
    storageMode:'cloud',shareUrl:publicUrl,loginUrl:editorUrl,isAdmin:user.isAdmin,
    storageScope:new URL(config.apiBaseUrl).origin+'|'+directory.href,
    initialIssues,
    prepareMigration:()=>prepareCloudMigration({remote,B:globalThis.Bulletin,directory,storage:localStorage,force:true}),
    logout:async()=>{try{await session.logout();}finally{location.replace(publicUrl);}},
    manageEditors:user.isAdmin?()=>manageEditors(session,user,invitationLink):null,
  });
  document.body.classList.remove('cloud-auth');document.body.classList.add('cloud-editor');
  const banner=$('.prototype-banner');banner.dataset.storageLabel='온라인 공유 저장';
  banner.innerHTML='<span class="dot"></span><strong>온라인으로 함께 편집</strong><span>편집은 팀에 공유되고, 최종 확정한 주보만 교인에게 공개됩니다.</span><button data-view="review">팀 진행 보기</button>';
  const actions=document.createElement('div');actions.className='cloud-session-actions';
  actions.innerHTML=`<a class="text-button" href="${escape(publicUrl)}">교인용 주보 보기 ↗</a>${user.isAdmin?'<button class="text-button" data-action="manage-editors">편집자 초대</button>':''}<button class="text-button" data-action="logout">로그아웃</button>`;
  $('.sidebar-bottom').append(actions);
  await import('./app.js');
  watchInvitationLinks({window,session,beforeSwitch:()=>T.beforeSessionChange(),cancelSwitch:()=>T.cancelSessionChange(),onError:error=>{const banner=$('#connection-banner');banner.hidden=false;banner.className='connection-banner connection-error';banner.textContent=error.message;}});
}

start().catch(error=>{
  invitationCode=null;
  $('#save-status').textContent='연결 확인 필요';
  const banner=$('#connection-banner');banner.hidden=false;banner.textContent=error.message||'주보를 열지 못했습니다. 연결과 브라우저 저장 권한을 확인해 주세요. 기존 자료는 삭제하지 않았습니다.';
  $('#main').innerHTML=`<section class="panel cloud-login"><h1>주보 연결을 확인해 주세요</h1><p>${escape(error.message||'잠시 후 다시 시도해 주세요.')}</p><button class="btn primary" id="cloud-retry" type="button">다시 시도</button><a class="btn" href="${escape(publicUrl)}">교인용 주보 보기</a></section>`;
  $('#cloud-retry').addEventListener('click',()=>location.reload());
});
