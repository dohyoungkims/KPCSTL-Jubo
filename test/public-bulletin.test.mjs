import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import B from '../frontend/core.js';
import {initializeIssue,applyCommand,areas} from '../lib/team-domain.mjs';
import {publicBulletinApi} from '../lib/public-bulletin.mjs';

const at='2026-10-24T12:00:00.000Z',actor={id:'private-user-id',name:'PRIVATE_EDITOR_NAME'};
const copy=value=>JSON.parse(JSON.stringify(value));
class LocalD1{
  constructor(){this.db=new DatabaseSync(':memory:');this.queries=0;this.db.exec(readFileSync(new URL('../drizzle/0000_easy_sharon_carter.sql',import.meta.url),'utf8'));}
  prepare(sql){this.queries++;const db=this.db;let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};}};}
  current(issue){this.db.prepare('INSERT OR REPLACE INTO issues (id,version,document,mutation_id,updated_at) VALUES (?,?,?,?,?)').run(issue.id,issue.version,JSON.stringify(issue),'private-mutation',at);}
  snapshot(issue){this.db.prepare('INSERT OR REPLACE INTO issue_versions (issue_id,version,document,actor_id,created_at) VALUES (?,?,?,?,?)').run(issue.id,issue.version,JSON.stringify(issue),actor.id,at);}
}
function mutate(issue,op,args={},time=at){return applyCommand(issue,{op,issueId:issue.id,baseVersion:issue.version,commandId:crypto.randomUUID(),...args},actor,[actor],time).issue;}
function finalized(id='2026-10-04'){
  const input=B.createStore().issues[0];input.id=id;input.date=id;
  let issue=initializeIssue(input,actor,at);
  for(const section of Object.keys(areas))issue=mutate(issue,'task',{section,status:'done'});
  return mutate(issue,'finalize');
}
async function call(db,query='',method='GET'){
  const response=await publicBulletinApi(new Request('https://api.church.test/api/public'+query,{method}),db);
  return {status:response.status,headers:response.headers,data:await response.json()};
}
function seed(issue=finalized()){const db=new LocalD1();db.current(issue);db.snapshot(issue);return {db,issue};}

test('public projection returns only printable fields and excludes editor metadata at every level',async()=>{
  const issue=finalized();
  issue.history.push({private:'PRIVATE_HISTORY'});issue.comments.push({body:'PRIVATE_COMMENT'});
  issue.requests.push({body:'PRIVATE_REQUEST',resolved:true});issue.migrationNotes=[];
  issue.secret='PRIVATE_ROOT';issue.sermon.secret='PRIVATE_SERMON';issue.sections.staff='PRIVATE_IGNORED_STAFF';
  issue.sections.regular='PRIVATE_IGNORED_SCHEDULE';issue.sections.volunteers='PRIVATE_LEGACY_ROSTER';issue.sections.midweek='PRIVATE_LEGACY_MIDWEEK';
  for(const list of [issue.announcements,issue.questions])for(const item of list){item.id='PRIVATE_ITEM_ID';item.internal='PRIVATE_ITEM_FIELD';}
  const {db}=seed(issue),result=await call(db,'?issue='+issue.id);
  assert.equal(result.status,200);
  assert.deepEqual(Object.keys(result.data.issue).sort(),['id','date','revision','sermon','worship','sections','offering','roster','midweek','announcements','questions'].sort());
  assert.deepEqual(Object.keys(result.data.issue.sections),['meals','pastoral','events','prayers']);
  assert.deepEqual(result.data.issue.announcements[0],{title:issue.announcements[0].title,body:issue.announcements[0].body});
  assert.deepEqual(result.data.issue.questions[0],{number:issue.questions[0].number,body:issue.questions[0].body});
  assert.doesNotMatch(JSON.stringify(result.data),/PRIVATE_|private-user-id|private-mutation/);
  assert.equal(result.data.issue.sermon.title,issue.sermon.title);
  assert.equal(result.headers.get('cache-control'),'no-store');
});

test('a later draft remains private while the previous final stays available',async()=>{
  const {db,issue}=seed(),draft=mutate(issue,'fields',{changes:{'sermon.title':'PRIVATE_UNFINISHED_CORRECTION'}});
  db.current(draft);db.snapshot(draft);
  const result=await call(db,'?issue='+issue.id);
  assert.equal(result.status,200);assert.equal(result.data.issue.sermon.title,issue.sermon.title);
  assert.equal(result.data.issue.revision,issue.revision);assert.doesNotMatch(JSON.stringify(result.data),/PRIVATE_UNFINISHED/);
});

test('unpublished issues are absent and cannot be requested by version',async()=>{
  const db=new LocalD1(),draft=initializeIssue(B.createStore().issues[0],actor,at);db.current(draft);db.snapshot(draft);
  assert.deepEqual((await call(db)).data,{issues:[]});
  assert.equal((await call(db,'?issue='+draft.id)).status,404);
  assert.equal((await call(db,'?issue='+draft.id+'&version=1')).status,400);
  assert.equal((await call(db,'?issue=2026-10-11')).status,404);
});

test('latest final is selected by version, even with reordered publications and clock drift',async()=>{
  const {db,issue}=seed();let newer=mutate(issue,'fields',{changes:{'sermon.title':'Corrected public title'}});
  newer=mutate(newer,'task',{section:'sermon',status:'done'});
  newer=mutate(newer,'finalize',{},'2026-10-24T11:00:00.000Z');db.snapshot(newer);
  const current=mutate(newer,'fields',{changes:{'sermon.title':'PRIVATE_NEXT_DRAFT'}});current.publications.reverse();db.current(current);
  const result=await call(db,'?issue='+issue.id);
  assert.equal(result.status,200);assert.equal(result.data.issue.sermon.title,'Corrected public title');assert.equal(result.data.issue.revision,newer.revision);
});

test('public archive orders published dates descending and excludes draft-only weeks',async()=>{
  const db=new LocalD1();for(const id of ['2026-10-04','2026-10-18','2026-10-11']){const issue=finalized(id);db.current(issue);db.snapshot(issue);}
  const draft=initializeIssue({...B.createStore().issues[0],id:'2026-10-25',date:'2026-10-25'},actor,at);db.current(draft);
  assert.deepEqual((await call(db)).data.issues.map(issue=>issue.date),['2026-10-18','2026-10-11','2026-10-04']);
  assert.equal(db.queries,1);
});

test('malformed current documents do not expose snapshots or prevent valid archive entries',async()=>{
  const {db,issue}=seed();
  for(const [index,document]of ['{broken','null','[]','{"publications":"bad"}','{"publications":[null,"bad",1,[]]}'].entries()){
    const id='2026-11-'+String(index+1).padStart(2,'0');
    db.db.prepare('INSERT INTO issues VALUES (?,?,?,?,?)').run(id,8,document,'mutation',at);
    assert.equal((await call(db,'?issue='+id)).status,404);
  }
  const result=await call(db);assert.equal(result.status,200);assert.deepEqual(result.data.issues.map(item=>item.id),[issue.id]);
});

test('missing or malformed latest snapshot fails closed instead of exposing an older final',async()=>{
  for(const corrupt of [null,'{broken',JSON.stringify([]),JSON.stringify({secret:'PRIVATE_BROKEN_SNAPSHOT'})]){
    const {db,issue}=seed();let newer=mutate(issue,'fields',{changes:{'sermon.title':'New final'}});newer=mutate(newer,'task',{section:'sermon',status:'done'});newer=mutate(newer,'finalize');db.current(newer);
    if(corrupt!==null)db.db.prepare('INSERT INTO issue_versions VALUES (?,?,?,?,?)').run(newer.id,newer.version,corrupt,actor.id,at);
    const result=await call(db,'?issue='+issue.id);assert.equal(result.status,404);assert.deepEqual((await call(db)).data,{issues:[]});
  }
});

test('unproven or malformed publication records and content fail closed',async()=>{
  const cases=[
    issue=>{issue.status='draft';},
    issue=>{issue.finalization=null;},
    issue=>{issue.finalization.revision++;},
    issue=>{issue.finalization.at='2026-10-24T13:00:00.000Z';},
    issue=>{issue.id='2026-10-11';issue.date='2026-10-11';},
    issue=>{issue.publications=[];},
    issue=>{issue.tasks.sermon.status='progress';},
    issue=>{issue.requests=[{resolved:false,body:'PRIVATE_UNRESOLVED'}];},
    issue=>{issue.migrationNotes=[{body:'PRIVATE_UNMAPPED'}];},
    issue=>{delete issue.sermon.title;},
    issue=>{issue.sermon.preacher={name:'PRIVATE_OBJECT'};},
    issue=>{issue.announcements=[null];},
    issue=>{issue.questions=[{number:'1'}];},
    issue=>{issue.offering.tithe='NaN';},
    issue=>{issue.sections.meals='x'.repeat(12001);},
  ];
  for(const corrupt of cases){
    const {db,issue}=seed(),snapshot=copy(issue);corrupt(snapshot);
    db.db.prepare('UPDATE issue_versions SET document=? WHERE issue_id=? AND version=?').run(JSON.stringify(snapshot),issue.id,issue.version);
    assert.equal((await call(db,'?issue='+issue.id)).status,404);
  }
  for(const corrupt of [issue=>{issue.publications[0].version++;},issue=>{issue.publications[0].at='invalid';},issue=>{issue.publications.push(copy(issue.publications[0]));},issue=>{issue.version++;},issue=>{issue.publications=null;}]){
    const {db,issue}=seed(),current=copy(issue);corrupt(current);
    db.db.prepare('UPDATE issues SET document=? WHERE id=?').run(JSON.stringify(current),issue.id);
    assert.equal((await call(db,'?issue='+issue.id)).status,404);
  }
});

test('prototype keys and unknown fields never enter the public projection',async()=>{
  const issue=finalized();
  const hostile=JSON.parse('{"__proto__":{"polluted":"PRIVATE_PROTO"},"constructor":{"secret":"PRIVATE_CONSTRUCTOR"},"prototype":{"secret":"PRIVATE_PROTOTYPE"},"extra":"PRIVATE_UNKNOWN"}');
  for(const target of [issue,...Object.values(issue).filter(value=>value&&typeof value==='object'&&!Array.isArray(value)),...issue.announcements,...issue.questions]){
    for(const [key,value]of Object.entries(hostile))Object.defineProperty(target,key,{value,enumerable:true,configurable:true});
  }
  const {db}=seed(issue),result=await call(db,'?issue='+issue.id);
  assert.equal(result.status,200);assert.doesNotMatch(JSON.stringify(result.data),/PRIVATE_|__proto__|constructor|prototype|"extra"/);assert.equal({}.polluted,undefined);
});

test('GET-only service rejects writes and invalid selectors before touching the database',async()=>{
  const db={prepare(){throw Error('Unexpected database access');}};
  for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS']){const result=await call(db,'',method);assert.equal(result.status,405);assert.equal(result.headers.get('allow'),'GET');}
  for(const query of ['?issue=','?issue=2026-02-30','?issue=2026-10-04&issue=2026-10-11','?issue=__proto__','?all=true'])assert.equal((await call(db,query)).status,400);
});

test('database failures return a generic unavailable error without internal details',async()=>{
  for(const db of [null,{prepare(){throw Error('PRIVATE_DATABASE_ERROR');}},{prepare(){return {async all(){return {};}};}}]){
    const result=await call(db);assert.equal(result.status,503);assert.doesNotMatch(JSON.stringify(result.data),/PRIVATE_|Database|SQL/);
  }
});
