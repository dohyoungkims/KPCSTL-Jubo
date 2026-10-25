// Controller tests with a minimal DOM boundary; these do not replace browser QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import B from '../frontend/core.js';
import T from '../frontend/team-client.js';
import {initializeIssue,applyCommand} from '../lib/team-domain.mjs';
import * as domain from '../lib/team-domain.mjs';
import {createPagesStore} from '../frontend/pages-store.mjs';

async function harness({needsName=false,client=null,storage=null}={}){
 const actor={id:'ui-editor',name:'김 편집자'},people=[actor];let current=initializeIssue(B.createStore().issues[0],actor,new Date().toISOString()),profile=needsName?null:actor;
 const nodes=new Map(),handlers=new Map(),timers=new Map(),saved=[];
 function node(id){if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',value:'',style:{},hidden:false,disabled:false,open:false,showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},setAttribute(){},querySelector(){return {disabled:false};}});return nodes.get(id);}
 const document={hidden:false,activeElement:null,querySelector:s=>node(s),querySelectorAll:()=>[],addEventListener:(n,fn)=>handlers.set(n,fn)};
 const remote={...T,async call(command){if(!command)return {user:actor,profile,members:people,issues:[B.clone(current)]};if(command.op==='profile'){profile={id:actor.id,name:command.name};people[0]=profile;return {profile,members:people};}try{const r=applyCommand(current,command,profile,people);current=r.issue;return {issue:B.clone(current)};}catch(e){if(e.status===409)e.current=B.clone(current);throw e;}}};
 const context={document,console,crypto,Map,Set,Date,JSON,Intl,Object,Array,String,Number,Promise,Error,URL,Blob,location:{hash:'',origin:'https://church.test'},navigator:{clipboard:{writeText:async()=>{}}},localStorage:storage||{getItem:()=>null,setItem(){},removeItem(){}},setTimeout:(fn,ms)=>{const id=Symbol();timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),setInterval(){},addEventListener(){},scrollTo(){},Bulletin:B,BulletinTeam:client||remote,BulletinPrintView:{markup:()=>'<div>PDF preview</div>',render(){},get:async i=>({bytes:new Uint8Array([1]),exportable:true,date:i.date,revision:i.revision,filename:'test.pdf'}),save:r=>saved.push(r)}};
 context.window=context;
 vm.runInNewContext(readFileSync(new URL('../frontend/app.js',import.meta.url),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 const click=async dataset=>handlers.get('click')({target:{dataset,closest(){return this;}},preventDefault(){}});
 const input=async(path,value)=>{handlers.get('input')({target:{dataset:{field:path},value},isComposing:false});for(const [id,timer]of timers)if(timer.ms===700){timers.delete(id);await timer.fn();}};
 return {node,click,input,handlers,saved,get current(){return current;},remote,async external(op,args={}){current=applyCommand(current,T.command(op,current,args),actor,people).issue;}};
}
test('controller opens name entry for a first-time collaborator',async()=>{
 const h=await harness({needsName:true});assert.equal(h.node('#dialog').open,true);assert.match(h.node('#dialog-content').innerHTML,/어떤 이름/);
 h.node('#display-name').value='새 이름';await h.handlers.get('submit')({target:{id:'profile-form',querySelector(){return {disabled:false};}},preventDefault(){}});
 assert.equal(h.node('#dialog').open,false);assert.equal(h.node('#profile-button').textContent,'새 ');
});
test('controller saves edited text with an author and shows per-person progress',async()=>{
 const h=await harness();await h.input('sermon.title','휴대폰에서 편집한 제목');assert.equal(h.current.sermon.title,'휴대폰에서 편집한 제목');assert.equal(h.current.history.at(-1).actorName,'김 편집자');
 await h.click({taskSection:'sermon',taskStatus:'done'});assert.equal(h.current.tasks.sermon.status,'done');
 await h.click({view:'review'});assert.match(h.node('#main').innerHTML,/김 편집자/);assert.match(h.node('#main').innerHTML,/1<span> \/ 6개 항목 완료/);
 await h.input('sermon.title','수정 후 재검토');assert.equal(h.current.tasks.sermon.status,'progress');
});
test('controller finalizes and downloads the same completed revision',async()=>{
 const h=await harness();for(const section of Object.keys(T.areas))await h.click({taskSection:section,taskStatus:'done'});
 await h.click({action:'finalize'});assert.equal(h.node('#dialog').open,true);
 await h.click({action:'confirm-finalize'});assert.equal(h.current.status,'finalized');assert.equal(h.saved.length,1);assert.match(h.saved[0].filename,/-FINAL-v1\.pdf$/);
});
test('a change during final review prevents approving an unseen revision',async()=>{
 const h=await harness();for(const section of Object.keys(T.areas))await h.click({taskSection:section,taskStatus:'done'});
 await h.click({action:'finalize'});await h.external('fields',{changes:{'sermon.title':'Changed during review'}});
 await h.click({action:'confirm-finalize'});assert.equal(h.current.status,'draft');assert.equal(h.saved.length,0);
 await h.click({action:'confirm-finalize'});assert.equal(h.node('#dialog').open,false);assert.equal(h.saved.length,0);
});


const selectionKey=path=>'kpcstl.github-pages.current.v1:'+path;
function memoryStorage(){
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
async function localHarness(storage=memoryStorage(),path='/KPCSTL-Jubo/'){
 const api=createPagesStore({storage,B,domain,key:'kpcstl.github-pages.v1:'+path});
 if(!(await api.call()).profile){
  await api.call({op:'profile',name:'로컬 편집자'});
  await api.call(T.command('import',null,{issue:B.createStore().issues[0]}));
 }
 const client={...T,...api,storageMode:'local',shareUrl:'https://church.test'+path};
 return {...await harness({client,storage}),api,storage,client};
}
test('Pages keeps the created week and archive selection after reloading',async()=>{
 const h=await localHarness();
 h.node('#new-date').value='2026-10-11';
 await h.handlers.get('submit')({target:{id:'new-week-form'},preventDefault(){}});
 assert.equal(h.storage.getItem(selectionKey('/KPCSTL-Jubo/')),'2026-10-11');
 const reopened=await localHarness(h.storage);
 assert.match(reopened.node('#main').innerHTML,/2026년 10월 11일/);
 await reopened.input('sermon.title','다음 주에 저장');
 let data=await h.api.call();
 assert.equal(data.issues.find(i=>i.id==='2026-10-11').sermon.title,'다음 주에 저장');
 assert.notEqual(data.issues.find(i=>i.id==='2026-10-04').sermon.title,'다음 주에 저장');
 await reopened.click({open:'2026-10-04',openView:'editor'});
 const archived=await localHarness(h.storage);
 assert.match(archived.node('#main').innerHTML,/2026년 10월 4일/);
 assert.equal(h.storage.getItem(selectionKey('/KPCSTL-Jubo/')),'2026-10-04');
});
test('Pages selection is path-scoped and stale selections fall back to an existing issue',async()=>{
 const storage=memoryStorage();
 storage.setItem(selectionKey('/KPCSTL-Jubo/'),'2026-10-11');
 const other=await localHarness(storage,'/Another-Church/');
 assert.match(other.node('#main').innerHTML,/2026년 10월 4일/);
 assert.equal(storage.getItem(selectionKey('/KPCSTL-Jubo/')),'2026-10-11');
 storage.setItem(selectionKey('/Another-Church/'),'2099-01-04');
 const reopened=await localHarness(storage,'/Another-Church/');
 assert.match(reopened.node('#main').innerHTML,/2026년 10월 4일/);
});
test('Pages restores pending edits for the saved selected week, not the default week',async()=>{
 const h=await localHarness(),initial=(await h.api.call()).issues[0];
 const next=(await h.api.call(T.command('new-week',initial,{date:'2026-10-11'}))).issue;
 const profile=(await h.api.call()).profile;
 h.storage.setItem(selectionKey('/KPCSTL-Jubo/'),next.id);
 h.storage.setItem('kpcstl.pending.'+profile.id+'.'+next.id,JSON.stringify({baseVersion:next.version,baseIssue:next,changes:{'sermon.title':'복구할 다음 주 제목'}}));
 await localHarness(h.storage);
 const saved=await h.api.call();
 assert.equal(saved.issues.find(i=>i.id===next.id).sermon.title,'복구할 다음 주 제목');
 assert.notEqual(saved.issues.find(i=>i.id===initial.id).sermon.title,'복구할 다음 주 제목');
 assert.equal(h.storage.getItem('kpcstl.pending.'+profile.id+'.'+next.id),null);
});
test('shared mode ignores the Pages selection key',async()=>{
 const storage=memoryStorage();storage.setItem(selectionKey('/KPCSTL-Jubo/'),'2026-10-11');
 const h=await harness({storage});
 await h.click({open:'2026-10-04',openView:'editor'});
 assert.equal(storage.getItem(selectionKey('/KPCSTL-Jubo/')),'2026-10-11');
 assert.match(h.node('#main').innerHTML,/2026년 10월 4일/);
});
