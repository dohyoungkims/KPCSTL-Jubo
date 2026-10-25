import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import B from '../frontend/core.js';
import T from '../frontend/team-client.js';
import {teamApi} from '../lib/team-service.mjs';

class LocalD1{
 constructor(){this.db=new DatabaseSync(':memory:');this.queue=Promise.resolve();this.db.exec(readFileSync(new URL('../drizzle/0000_easy_sharon_carter.sql',import.meta.url),'utf8'));}
 prepare(sql){const db=this.db;let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};}
 batch(statements){const work=this.queue.then(async()=>{this.db.exec('BEGIN');try{const values=[];for(const [index,s]of statements.entries()){if(this.failSnapshot&&index===1)throw Error('Simulated snapshot failure');values.push(await s.run());}this.db.exec('COMMIT');return values;}catch(e){this.db.exec('ROLLBACK');throw e;}});this.queue=work.catch(()=>{});return work;}
}
const call=async(db,user,body,extra={})=>{
 const headers={'Content-Type':'application/json','origin':'https://church.test',...extra};if(user)headers['oai-authenticated-user-id']=user;
 const response=await teamApi(new Request('https://church.test/api/team',{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})}),db);
 return {status:response.status,data:await response.json()};
};
async function setup(){const db=new LocalD1();for(const [id,name]of [['alice','준비 담당'],['bob','김 봉사자']])assert.equal((await call(db,id,{op:'profile',name})).status,200);const r=await call(db,'alice',{op:'import',commandId:crypto.randomUUID(),issue:B.createStore().issues[0]});assert.equal(r.status,200);return {db,issue:r.data.issue};}
const cmd=(op,i,args={})=>T.command(op,i,args);

test('shared API rejects anonymous requests and cross-origin writes',async()=>{
 const db=new LocalD1();assert.equal((await call(db,null)).status,401);
 assert.equal((await call(db,'alice',{op:'profile',name:'Alice'},{origin:'https://other.test'})).status,403);
 assert.equal((await call(db,'alice',{op:'profile',name:' '})).status,400);
});
test('changes use the signed-in actor and server timestamp, ignoring forged client attribution',async()=>{
 const {db,issue}=await setup();const r=await call(db,'bob',cmd('fields',issue,{actorId:'alice',actorName:'Forged',changes:{'sermon.title':'새 설교 제목'}}));
 assert.equal(r.status,200);const h=r.data.issue.history.at(-1);assert.equal(h.actorId,'bob');assert.equal(h.actorName,'김 봉사자');assert.match(h.at,/^\d{4}-\d{2}-\d{2}T/);assert.equal(r.data.issue.tasks.sermon.status,'progress');
 const remote=await call(db,'alice');assert.equal(remote.data.issues[0].sermon.title,'새 설교 제목');
});
test('fixed reference areas and prototype paths cannot be edited through the API',async()=>{
 const {db,issue}=await setup();for(const path of ['sections.regular','sections.staff','sections.volunteers','sermon.__proto__.polluted'])assert.equal((await call(db,'alice',cmd('fields',issue,{changes:{[path]:'bad'}}))).status,400);
 assert.equal({}.polluted,undefined);assert.equal((await call(db,'alice')).data.issues[0].version,1);
});
test('stale writes return 409, preserve the first save and do not create an extra snapshot',async()=>{
 const {db,issue}=await setup();const first=await call(db,'alice',cmd('fields',issue,{changes:{'sermon.title':'Alice title'}}));const second=await call(db,'bob',cmd('fields',issue,{changes:{'sermon.title':'Bob title'}}));
 assert.equal(first.status,200);assert.equal(second.status,409);assert.equal(second.data.current.sermon.title,'Alice title');
 assert.equal(db.db.prepare('SELECT count(*) AS n FROM issue_versions').get().n,2);
});
test('two simultaneous writers cannot both replace the same version',async()=>{
 const {db,issue}=await setup();const results=await Promise.all([call(db,'alice',cmd('fields',issue,{changes:{'sermon.title':'Concurrent Alice'}})),call(db,'bob',cmd('fields',issue,{changes:{'sermon.title':'Concurrent Bob'}}))]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(db.db.prepare('SELECT count(*) AS n FROM issue_versions').get().n,2);
});
test('snapshot failure rolls the content update back atomically',async()=>{
 const {db,issue}=await setup();db.failSnapshot=true;const r=await call(db,'alice',cmd('fields',issue,{changes:{'sermon.title':'Must not persist'}}));assert.equal(r.status,400);
 const current=(await call(db,'alice')).data.issues[0];assert.equal(current.sermon.title,issue.sermon.title);assert.equal(current.version,1);
});
test('repeating a command does not duplicate a saved change or snapshot',async()=>{
 const {db,issue}=await setup(),command=cmd('fields',issue,{changes:{'sermon.title':'Retry-safe'}});
 assert.equal((await call(db,'alice',command)).status,200);assert.equal((await call(db,'alice',command)).status,200);
 const current=(await call(db,'alice')).data.issues[0];assert.equal(current.history.length,1);assert.equal(current.version,2);
});
test('completion records a person and time; subsequent edits reopen that section',async()=>{
 let {db,issue}=await setup();issue=(await call(db,'alice',cmd('task',issue,{section:'sermon',assigneeId:'bob'}))).data.issue;
 issue=(await call(db,'bob',cmd('task',issue,{section:'sermon',status:'done'}))).data.issue;
 assert.equal(issue.tasks.sermon.completedBy.id,'bob');assert.ok(issue.tasks.sermon.completedAt);
 issue=(await call(db,'alice',cmd('fields',issue,{changes:{'sermon.title':'Needs another review'}}))).data.issue;
 assert.equal(issue.tasks.sermon.status,'progress');assert.equal(issue.tasks.sermon.completedAt,null);assert.ok(issue.activity.some(e=>e.type==='reopen'));
});
test('only the coordinator finalizes a complete issue, preserving earlier finalized versions after edits',async()=>{
 let {db,issue}=await setup();assert.equal((await call(db,'alice',cmd('finalize',issue))).status,400);
 for(const section of Object.keys(T.areas))issue=(await call(db,'alice',cmd('task',issue,{section,status:'done'}))).data.issue;
 assert.equal((await call(db,'bob',cmd('finalize',issue))).status,400);
 issue=(await call(db,'alice',cmd('finalize',issue))).data.issue;assert.equal(issue.status,'finalized');const version=issue.version;
 issue=(await call(db,'bob',cmd('fields',issue,{changes:{'sermon.title':'A later correction'}}))).data.issue;
 assert.equal(issue.status,'draft');assert.equal(issue.finalization,null);assert.equal(issue.publications.length,1);
 const old=JSON.parse(db.db.prepare('SELECT document FROM issue_versions WHERE issue_id=? AND version=?').get(issue.id,version).document);assert.equal(old.status,'finalized');assert.notEqual(old.sermon.title,issue.sermon.title);
});
test('unresolved requests prevent final approval and retain requester identity',async()=>{
 let {db,issue}=await setup();for(const section of Object.keys(T.areas))issue=(await call(db,'alice',cmd('task',issue,{section,status:'done'}))).data.issue;
 issue=(await call(db,'bob',cmd('request',issue,{body:'본문 확인해 주세요.',section:'sermon'}))).data.issue;
 assert.equal(issue.requests[0].actorName,'김 봉사자');assert.equal((await call(db,'alice',cmd('finalize',issue))).status,400);
});
test('new Sunday keeps previous content and resets progress; duplicate dates do not overwrite',async()=>{
 const {db,issue}=await setup();const next=await call(db,'alice',cmd('new-week',issue,{date:'2026-10-11'}));assert.equal(next.status,200);
 assert.equal(next.data.issue.sermon.title,'');assert.ok(Object.values(next.data.issue.tasks).every(t=>t.status==='todo'));
 assert.equal((await call(db,'bob',cmd('new-week',issue,{date:'2026-10-11'}))).status,409);
 const all=(await call(db,'alice')).data.issues;assert.equal(all.length,2);assert.equal(all.find(i=>i.id===issue.id).sermon.title,issue.sermon.title);
});
test('legacy browser imports preserve historical anonymity and unmapped table text',async()=>{
 const db=new LocalD1();await call(db,'alice',{op:'profile',name:'Alice'});
 let i=B.update(B.createStore().issues[0],'sermon.title','Original browser edit');delete i.roster;i.sections.volunteers='Custom volunteers not mapped yet';
 const result=await call(db,'alice',{op:'import',commandId:'import-legacy',issue:i});assert.equal(result.status,200);
 assert.equal(result.data.issue.history[0].actorId,null);assert.ok(result.data.issue.history[0].legacy);assert.equal(result.data.issue.migrationNotes[0].body,i.sections.volunteers);
});
test('client rebase preserves item identity across reordering and reports deletion',()=>{
 const base=B.createStore().issues[0],current=B.clone(base);[current.announcements[0],current.announcements[1]]=[current.announcements[1],current.announcements[0]];
 const r=T.rebase(base,current,{'announcements.0.title':'My update'});assert.equal(r.mapping['announcements.0.title'],'announcements.1.title');assert.equal(r.conflicts.length,0);
 current.announcements.splice(1,1);assert.equal(T.rebase(base,current,{'announcements.0.title':'My update'}).conflicts[0].deleted,true);
});
test('client rebase merges separate fields but flags same-field collisions',()=>{
 const base=B.createStore().issues[0],current=B.clone(base);current.sermon.scripture='A new passage';
 assert.equal(T.rebase(base,current,{'sermon.title':'My title'}).conflicts.length,0);
 current.sermon.title='Someone else';assert.equal(T.rebase(base,current,{'sermon.title':'My title'}).conflicts.length,1);
});
