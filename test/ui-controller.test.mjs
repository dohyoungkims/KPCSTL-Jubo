// Controller tests with a minimal DOM boundary; these do not replace browser QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import B from '../frontend/core.js';
import T from '../frontend/team-client.js';
import {initializeIssue,applyCommand} from '../lib/team-domain.mjs';

async function harness({needsName=false}={}){
 const actor={id:'ui-editor',name:'김 편집자'},people=[actor];let current=initializeIssue(B.createStore().issues[0],actor,new Date().toISOString()),profile=needsName?null:actor;
 const nodes=new Map(),handlers=new Map(),timers=new Map(),saved=[];
 function node(id){if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',value:'',style:{},hidden:false,disabled:false,open:false,showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},setAttribute(){},querySelector(){return {disabled:false};}});return nodes.get(id);}
 const document={hidden:false,activeElement:null,querySelector:s=>node(s),querySelectorAll:()=>[],addEventListener:(n,fn)=>handlers.set(n,fn)};
 const remote={...T,async call(command){if(!command)return {user:actor,profile,members:people,issues:[B.clone(current)]};if(command.op==='profile'){profile={id:actor.id,name:command.name};people[0]=profile;return {profile,members:people};}try{const r=applyCommand(current,command,profile,people);current=r.issue;return {issue:B.clone(current)};}catch(e){if(e.status===409)e.current=B.clone(current);throw e;}}};
 const context={document,console,crypto,Map,Set,Date,JSON,Intl,Object,Array,String,Number,Promise,Error,URL,Blob,location:{hash:'',origin:'https://church.test'},navigator:{clipboard:{writeText:async()=>{}}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout:(fn,ms)=>{const id=Symbol();timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),setInterval(){},addEventListener(){},scrollTo(){},Bulletin:B,BulletinTeam:remote,BulletinPrintView:{markup:()=>'<div>PDF preview</div>',render(){},get:async i=>({bytes:new Uint8Array([1]),exportable:true,date:i.date,revision:i.revision,filename:'test.pdf'}),save:r=>saved.push(r)}};
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
