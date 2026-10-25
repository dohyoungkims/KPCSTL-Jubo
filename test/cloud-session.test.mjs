import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createCloudSession,invitationLink,publicDirectory,watchInvitationLinks} from '../frontend/cloud-session.mjs';
import B from '../frontend/core.js';
import T from '../frontend/team-client.js';
import {initializeIssue} from '../lib/team-domain.mjs';

const now=Date.parse('2026-10-24T12:00:00Z');
const code='kpc_inv_'+'a'.repeat(43),token='kpc_ses_'+'b'.repeat(43);
const identity={user:{id:'editor-1',name:'박태진 목사'},isAdmin:true,expiresAt:'2026-11-24T12:00:00Z'};
const directory='https://church.github.io/KPCSTL-Jubo/';
const base='https://api.church.test';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
function memory(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function session(options={}){return createCloudSession({apiBaseUrl:base,directory,storage:memory(),now:()=>now,fetch:async()=>response({token,...identity}),...options});}

test('invitation login stores only session token and expiry in its scoped key',async()=>{
  const storage=memory(),calls=[];
  const auth=session({storage,fetch:async(url,options)=>{calls.push({url,options});return response({token,...identity});}});
  assert.deepEqual(await auth.login(code),identity);
  assert.equal(auth.getToken(),token);
  assert.equal(storage.values.size,1);
  const [key,value]=[...storage.values][0];
  assert.ok(key.includes(base));assert.ok(key.includes(directory));
  assert.deepEqual(JSON.parse(value),{token,expiresAt:identity.expiresAt});
  assert.ok(!value.includes(code));assert.ok(!value.includes(identity.user.name));
  assert.equal(calls[0].url,base+'/api/login');assert.deepEqual(JSON.parse(calls[0].options.body),{code});
  assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.referrerPolicy,'no-referrer');
});

test('open sharing discovers the server identity without a token and saves no credentials',async()=>{
  const storage=memory();await session({storage}).login(code);const before=[...storage.values];let request;
  const common={user:{id:'shared-editor',name:'주보 편집팀'},isAdmin:false,sharedEditing:true,expiresAt:null};
  const auth=session({storage,fetch:async(url,options)=>{request={url,options};return response(common);}});
  assert.deepEqual(await auth.shared(),common);assert.equal(request.url,base+'/api/session');assert.equal(Object.hasOwn(request.options.headers,'Authorization'),false);assert.deepEqual([...storage.values],before);
  await assert.rejects(session({fetch:async()=>response(identity)}).shared(),error=>error.code==='INVALID_RESPONSE');
  await assert.rejects(session({fetch:async()=>response({},401)}).shared(),error=>error.status===401);
});

test('session restore authenticates and is isolated across API and site directories',async()=>{
  const storage=memory();await session({storage}).login(code);
  let called=false;
  const restored=session({storage,fetch:async(url,options)=>{called=true;assert.equal(url,base+'/api/session');assert.equal(options.headers.Authorization,'Bearer '+token);return response(identity);}});
  assert.deepEqual(await restored.restore(),identity);assert.equal(called,true);
  assert.equal(await session({storage,apiBaseUrl:'https://another.church.test'}).restore(),null);
  assert.equal(await session({storage,directory:'https://church.github.io/Another/'}).restore(),null);
});

test('a login change in another tab cannot silently reattribute pending edits',async()=>{
  const storage=memory(),first=session({storage});await first.login(code);
  const secondToken='kpc_ses_'+'c'.repeat(43);
  const second=session({storage,fetch:async()=>response({token:secondToken,...identity,user:{id:'editor-2',name:'다른 편집자'}})});
  await second.login('kpc_inv_'+'d'.repeat(43));
  assert.throws(()=>first.getToken(),error=>error.code==='SESSION_CHANGED'&&error.status===401);
  assert.equal(second.getToken(),secondToken);
  let sent=false;const remote=T.createRemoteClient({baseUrl:base+'/api/team',getToken:first.getToken,fetch:async()=>{sent=true;return response({});}});
  await assert.rejects(remote.call({op:'fields'}),error=>error.status===401);assert.equal(sent,false);
});

test('expired or malformed saved sessions are cleared while bulletin drafts remain',async()=>{
  const storage=memory();storage.setItem('draft','keep');await session({storage}).login(code);
  const expired=session({storage,now:()=>Date.parse(identity.expiresAt)});
  await assert.rejects(async()=>expired.getToken(),error=>error.status===401);
  assert.deepEqual([...storage.values],[['draft','keep']]);
  await session({storage}).login(code);const key=[...storage.values.keys()].find(key=>key!=='draft');storage.setItem(key,'bad json');
  assert.equal(await session({storage}).restore(),null);assert.equal(storage.getItem('draft'),'keep');
});

test('invalid invitation codes never reach the server',async()=>{
  let requests=0;const auth=session({fetch:async()=>{requests++;return response({token,...identity});}});
  for(const invalid of ['',null,'a'.repeat(43),'kpc_inv_'+'a'.repeat(42),code+'x','kpc_inv_'+'a'.repeat(42)+'!'])await assert.rejects(auth.login(invalid),error=>error.code==='INVALID_INVITATION');
  assert.equal(requests,0);
});

test('failed authentication clears only the scoped session and gives a friendly error',async()=>{
  const storage=memory();await session({storage}).login(code);storage.setItem('draft','keep');
  const auth=session({storage,fetch:async()=>new Response('<html>Expired</html>',{status:401})});
  await assert.rejects(auth.restore(),error=>error.status===401&&error.code==='AUTH_REQUIRED');
  assert.deepEqual([...storage.values],[['draft','keep']]);
});

test('logout clears the browser session even when the connection fails',async()=>{
  const storage=memory();await session({storage}).login(code);let sent;
  const auth=session({storage,fetch:async(url,options)=>{sent={url,options};throw Error(token);}});
  await assert.rejects(auth.logout(),error=>error.code==='NETWORK'&&!error.message.includes(token));
  assert.equal(sent.url,base+'/api/logout');assert.equal(sent.options.method,'POST');
  assert.equal(storage.values.size,0);
});

test('admin invitation and revocation requests keep token and query at the configured origin',async()=>{
  const storage=memory();await session({storage}).login(code);const calls=[];
  const auth=session({storage,fetch:async(url,options)=>{calls.push({url,options});if(options.method==='GET')return response({editors:[identity.user]});if(options.method==='POST')return response({code,id:'editor-2',name:'이 목사'});return response({ok:true});}});
  assert.deepEqual(await auth.listEditors(),[identity.user]);
  assert.equal((await auth.inviteEditor(' 이 목사 ')).code,code);
  const id='https://evil.test/?id=steal&next=1';await auth.revokeEditor(id);
  assert.deepEqual(JSON.parse(calls[1].options.body),{name:'이 목사'});
  const url=new URL(calls[2].url);assert.equal(url.origin,base);assert.equal(url.pathname,'/api/access');assert.deepEqual([...url.searchParams],[['id',id]]);
  for(const call of calls){assert.equal(call.options.headers.Authorization,'Bearer '+token);assert.equal(call.options.redirect,'error');assert.equal(call.options.credentials,'omit');}
});

test('public links contain no invite, login query or editor filename',()=>{
  const input=directory+'studio.html?edit=1&token=do-not-share#invite='+code;
  assert.equal(publicDirectory(input).href,directory);
  assert.equal(invitationLink(input,code),directory+'studio.html#invite='+code);
  assert.throws(()=>invitationLink(input,'bad'));
});

test('cloud session validates origins, blocks unsafe protocols, and allows loopback QA',()=>{
  for(const apiBaseUrl of ['http://api.church.test','https://user:pass@api.church.test','https://api.church.test/path','https://api.church.test/?token=secret','https://api.church.test/#fragment','//api.church.test','https://api.\nchurch.test'])assert.throws(()=>session({apiBaseUrl}),error=>error.code==='CONFIG');
  for(const apiBaseUrl of ['http://127.0.0.1:8787','http://localhost:8787','http://[::1]:8787'])assert.doesNotThrow(()=>session({apiBaseUrl}));
});

test('malformed responses, permission errors and unavailable browser storage fail safely',async()=>{
  await assert.rejects(session({fetch:async()=>response({token,...identity,user:null})}).login(code),error=>error.code==='INVALID_RESPONSE');
  await assert.rejects(session({fetch:async()=>new Response('broken')}).login(code),error=>error.code==='INVALID_RESPONSE');
  await assert.rejects(session({fetch:async()=>response({},403)}).login(code),error=>error.code==='FORBIDDEN');
  const storage={...memory(),setItem(){throw Error('disabled');}};
  await assert.rejects(session({storage}).login(code),error=>error.code==='STORAGE');
});

test('session request timeout aborts the network and stores no credentials',async()=>{
  const storage=memory();let signal;
  const auth=session({storage,timeoutMs:5,fetch:async(url,options)=>{signal=options.signal;return new Promise(()=>{});}});
  await assert.rejects(auth.login(code),error=>error.code==='TIMEOUT');assert.equal(signal.aborted,true);assert.equal(storage.values.size,0);
});

test('invitation fragment is removed before module imports or editor navigation',()=>{
  const bootstrap=readFileSync(new URL('../frontend/pages-bootstrap.mjs',import.meta.url),'utf8');
  const early=bootstrap.slice(0,bootstrap.indexOf('const escape='));
  const calls=[];
  vm.runInNewContext(early,{URLSearchParams,location:{hash:'#invite='+code,pathname:'/KPCSTL-Jubo/studio.html',search:'?edit=1'},history:{state:{keep:1},replaceState(...args){calls.push(args);}}});
  assert.equal(calls.length,1);assert.equal(calls[0][2],'/KPCSTL-Jubo/studio.html?edit=1');assert.ok(!calls[0][2].includes(code));
});

test('a same-page invitation clears its fragment, saves pending work and switches before reload',async()=>{
  const events=[];let handler;
  const window={location:{hash:'#invite='+code,pathname:'/KPCSTL-Jubo/studio.html',search:'',reload(){events.push('reload');}},history:{state:null,replaceState(a,b,url){events.push('clear');assert.equal(url,'/KPCSTL-Jubo/studio.html');window.location.hash='';}},addEventListener(name,fn){handler=fn;},removeEventListener(){}};
  watchInvitationLinks({window,session:{async login(value){events.push('login');assert.equal(value,code);assert.equal(window.location.hash,'');}},beforeSwitch:async()=>{events.push('flush');return true;}});
  await handler();assert.deepEqual(events,['clear','flush','login','reload']);
});

test('same-page invitation keeps the current session when pending changes cannot save',async()=>{
  const errors=[];let handler,logins=0,reloads=0;
  const window={location:{hash:'#invite='+code,pathname:'/studio.html',search:'',reload(){reloads++;}},history:{replaceState(){window.location.hash='';}},addEventListener(name,fn){handler=fn;},removeEventListener(){}};
  watchInvitationLinks({window,session:{async login(){logins++;}},beforeSwitch:async()=>false,onError:error=>errors.push(error)});
  await handler();assert.equal(window.location.hash,'');assert.equal(logins,0);assert.equal(reloads,0);assert.equal(errors[0].code,'PENDING_CHANGES');
});

test('invalid same-page invitations restore the editor controls without reloading',async()=>{
  let handler,unlocked=false,error;
  const window={location:{hash:'#invite=invalid',pathname:'/studio.html',search:'',reload(){assert.fail('must not reload');}},history:{replaceState(){window.location.hash='';}},addEventListener(name,fn){handler=fn;},removeEventListener(){}};
  watchInvitationLinks({window,session:{async login(){throw Error('Invalid invitation');}},beforeSwitch:async()=>true,cancelSwitch:()=>{unlocked=true;},onError:value=>{error=value;}});
  await handler();assert.equal(unlocked,true);assert.equal(error.message,'Invalid invitation');
});

async function cloudController({issues=[],seeds=[],failImport=false,isAdmin=false,sharedEditing=false,extraMembers=[]}={}){
  const actor={id:'editor-1',name:'박태진 목사'},nodes=new Map(),handlers=new Map(),imports=[];let remoteIssues=B.clone(issues);
  const storage=memory();
  function node(id){if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',value:'',style:{},hidden:false,disabled:false,open:false,showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},querySelector(){return {disabled:false};}});return nodes.get(id);}
  const client={...T,storageMode:'cloud',isAdmin,sharedEditing,storageScope:base+'|'+directory,shareUrl:directory,loginUrl:directory+'studio.html',initialIssues:seeds,async call(command){if(!command)return {user:actor,profile:actor,members:[actor,...extraMembers],issues:B.clone(remoteIssues)};if(command.op==='import'){imports.push(command.issue.id);if(failImport)throw Error('Offline');if(remoteIssues.some(i=>i.id===command.issue.id))throw Object.assign(Error('Already exists'),{status:409});remoteIssues.push(initializeIssue(command.issue,actor,new Date(now).toISOString()));return {issue:remoteIssues.at(-1)};}}};
  const document={hidden:false,activeElement:null,querySelector:node,querySelectorAll:()=>[],addEventListener:(name,handler)=>handlers.set(name,handler)};
  const context={document,console,crypto,Map,Set,Date,JSON,Intl,Object,Array,String,Number,Promise,Error,URL,Blob,location:{hash:'',origin:'https://church.github.io'},navigator:{clipboard:{writeText:async()=>{}}},localStorage:storage,setTimeout(){},clearTimeout(){},setInterval(){},addEventListener(){},scrollTo(){},Bulletin:B,BulletinTeam:client,BulletinPrintView:{markup:()=>'',render(){}}};context.window=context;
  vm.runInNewContext(readFileSync(new URL('../frontend/app.js',import.meta.url),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  return {imports,client,node,handlers,get issues(){return remoteIssues;}};
}

test('empty cloud does not silently import sample or legacy browser bulletins',async()=>{
  const h=await cloudController();assert.equal(h.issues.length,0);assert.deepEqual(h.imports,[]);assert.match(h.node('#main').innerHTML,/공유 주보 준비하기/);assert.doesNotMatch(h.node('#main').innerHTML,/data-field=/);
});

test('explicit cloud migration adds selected dates even when server already has another issue',async()=>{
  const initial=B.createStore(),copy=B.duplicate(initial,initial.current,'2026-10-11');
  const actor={id:'editor-1',name:'박태진 목사'};
  const h=await cloudController({issues:[initializeIssue(initial.issues[0],actor,new Date(now).toISOString())],seeds:[copy.issues[1]]});
  assert.deepEqual(h.imports,['2026-10-11']);assert.equal(h.issues.length,2);assert.deepEqual(Array.from(h.client.initialIssues),[]);
});

test('same-date migration cannot overwrite remote edits and failed imports remain retryable',async()=>{
  const seed=B.createStore().issues[0],actor={id:'editor-1',name:'박태진 목사'};
  const current=initializeIssue(seed,actor,new Date(now).toISOString());current.sermon.title='Keep current online';
  const h=await cloudController({issues:[current],seeds:[seed]});assert.equal(h.issues[0].sermon.title,'Keep current online');
  const failed=await cloudController({seeds:[seed],failImport:true});assert.equal(failed.client.initialIssues.length,1);assert.match(failed.node('#connection-banner').textContent,/Offline/);
});

test('admin can replace an unavailable coordinator without receiving a finalize action',async()=>{
  const current=initializeIssue(B.createStore().issues[0],{id:'old-coordinator',name:'이전 담당자'},new Date(now).toISOString());
  const h=await cloudController({issues:[current],isAdmin:true});
  await h.handlers.get('click')({target:{dataset:{view:'review'},closest(){return this;}},preventDefault(){}});
  assert.match(h.node('#main').innerHTML,/id="coordinator-select"/);
  assert.doesNotMatch(h.node('#main').innerHTML,/data-action="finalize"/);
});

test('common editing shows fixed team information and only the common assignment choice',async()=>{
  const current=initializeIssue(B.createStore().issues[0],{id:'editor-1',name:'주보 편집팀'},new Date(now).toISOString());
  const h=await cloudController({issues:[current],sharedEditing:true,extraMembers:[{id:'private-admin',name:'관리자'}]});
  const click=async dataset=>h.handlers.get('click')({target:{dataset,closest(){return this;}},preventDefault(){}});
  await click({action:'profile'});assert.match(h.node('#dialog-content').innerHTML,/주보 편집팀/);assert.doesNotMatch(h.node('#dialog-content').innerHTML,/profile-form|data-action="logout"|data-action="manage-editors"/);
  await click({view:'review'});assert.match(h.node('#main').innerHTML,/data-action="finalize"/);assert.doesNotMatch(h.node('#main').innerHTML,/<option value="private-admin"/);
});
