import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,statSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import B from '../frontend/core.js';
import {sectionFor} from '../lib/team-domain.mjs';
import {handleRequest} from '../worker/shared-api.mjs';
import {ACCESS_DURATION,CODE_PATTERN,SESSION_DURATION,TOKEN_PATTERN,accessStatements,createAccessRecord,hashSecret,randomSecret} from '../worker/auth.mjs';

const ORIGIN='https://dohyoungkims.github.io',NOW=Date.now();
const migration=readFileSync(new URL('../worker/migrations/0001-shared.sql',import.meta.url),'utf8');
class LocalD1{
  constructor(){this.db=new DatabaseSync(':memory:');this.db.exec('PRAGMA foreign_keys=ON');this.db.exec(migration);this.queue=Promise.resolve();}
  prepare(sql){const db=this.db;let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const result=db.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};}};}
  batch(statements){const work=this.queue.then(async()=>{this.db.exec('BEGIN');try{const values=[];for(const [index,statement]of statements.entries()){if(this.failBatch&&index===1)throw Error('PRIVATE_DB_FAILURE');values.push(await statement.run());}this.db.exec('COMMIT');return values;}catch(error){this.db.exec('ROLLBACK');throw error;}});this.queue=work.catch(()=>{});return work;}
}
async function request(db,path,{method='GET',body,raw,token,origin=ORIGIN,headers={},now=NOW,env={}}={}){
  const merged={...(origin===null?{}:{Origin:origin}),...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers};
  const response=await handleRequest(new Request('https://api.church.test'+path,{method,headers:merged,...(body!==undefined?{body:JSON.stringify(body)}:raw!==undefined?{body:raw}:{})}),{DB:db,FRONTEND_ORIGIN:ORIGIN,...env},{now});
  const text=await response.text();
  return {status:response.status,headers:response.headers,data:text?JSON.parse(text):null};
}
async function access(db,name='관리자',role='admin',now=NOW){const record=await createAccessRecord(name,role,now);await db.batch(accessStatements(db,record));return record;}
const login=(db,code,options={})=>request(db,'/api/login',{method:'POST',body:{code},...options});
async function setup(){const db=new LocalD1(),admin=await access(db),signed=await login(db,admin.code);assert.equal(signed.status,200);return {db,admin,token:signed.data.token};}
const command=(op,issue,extra={})=>({op,issueId:issue?.id,baseVersion:issue?.version,commandId:crypto.randomUUID(),...extra});

test('anonymous requests and forged identity headers cannot read or mutate editor data',async()=>{
  const db=new LocalD1();
  for(const path of ['/api/team','/api/session','/api/access']){
    assert.equal((await request(db,path)).status,401);
    assert.equal((await request(db,path,{headers:{'oai-authenticated-user-id':'administrator','oai-authenticated-user-email':'admin@church.test'}})).status,401);
  }
  assert.equal((await request(db,'/api/team',{method:'POST',body:{op:'profile',name:'Forged'},headers:{'oai-authenticated-user-id':'administrator'}})).status,401);
  assert.equal((await request(db,'/api/access',{method:'POST',body:{name:'Forged'}})).status,401);
  assert.equal((await request(db,'/api/session?token=secret',{headers:{Cookie:'session=secret'}})).status,401);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM members').get().n,0);
  assert.deepEqual((await request(db,'/api/public',{origin:null})).data,{issues:[]});
  assert.deepEqual((await request(db,'/health',{origin:null})).data,{ok:true});
});

test('codes contain 256 random bits and two devices obtain distinct hashed sessions for one identity',async()=>{
  const {db,admin,token}=await setup(),second=await login(db,admin.code);
  assert.match(admin.code,CODE_PATTERN);assert.equal(Buffer.from(admin.code.slice(8),'base64url').length,32);
  assert.match(token,TOKEN_PATTERN);assert.match(second.data.token,TOKEN_PATTERN);assert.notEqual(token,second.data.token);
  assert.equal(second.data.user.id,admin.id);assert.equal(second.data.user.name,admin.name);assert.equal(second.data.isAdmin,true);
  assert.equal(Date.parse(second.data.expiresAt)-NOW,SESSION_DURATION);
  assert.equal(Date.parse(admin.expiresAt)-NOW,ACCESS_DURATION);
  const session=await request(db,'/api/session',{token});
  assert.deepEqual(session.data,{expiresAt:second.data.expiresAt,user:second.data.user,isAdmin:true});
  const rows=db.db.prepare('SELECT * FROM access_sessions').all(),stored=db.db.prepare('SELECT * FROM editor_access').get();
  assert.equal(rows.length,2);assert.equal(stored.code_hash,await hashSecret(admin.code));
  const firstHash=await hashSecret(token);assert.ok(rows.some(row=>row.token_hash===firstHash));
  const storage=JSON.stringify({rows,stored});assert.ok(!storage.includes(admin.code));assert.ok(!storage.includes(token));assert.ok(!storage.includes(second.data.token));
});

test('unrecognized, expired, or revoked invitation codes cannot start sessions',async()=>{
  const {db,admin}=await setup();
  for(const code of ['',null,{},'guess',randomSecret('kpc_inv_')])assert.equal((await login(db,code)).status,401);
  assert.equal((await login(db,admin.code,{now:Date.parse(admin.expiresAt)})).status,401);
  db.db.prepare('UPDATE editor_access SET revoked_at=? WHERE id=?').run(new Date(NOW).toISOString(),admin.id);
  assert.equal((await login(db,admin.code)).status,401);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM access_sessions').get().n,1);
});

test('admin creates named editor codes without granting admin privileges or exposing hashes',async()=>{
  const {db,token}=await setup();
  const created=await request(db,'/api/access',{method:'POST',token,body:{name:'박태진 목사'}});
  assert.equal(created.status,201);assert.match(created.data.code,CODE_PATTERN);assert.equal(created.data.name,'박태진 목사');
  const editor=await login(db,created.data.code);assert.equal(editor.status,200);assert.equal(editor.data.isAdmin,false);assert.equal(editor.data.user.id,created.data.id);
  for(const method of ['GET','POST','DELETE'])assert.equal((await request(db,'/api/access'+(method==='DELETE'?'?id='+created.data.id:''),{method,token:editor.data.token,...(method==='POST'?{body:{name:'Unauthorized'}}:{})})).status,403);
  assert.equal((await request(db,'/api/access',{method:'POST',token,body:{name:'Escalation',role:'admin'}})).status,400);
  const list=await request(db,'/api/access',{token});assert.equal(list.data.editors.length,2);
  for(const row of list.data.editors)assert.deepEqual(Object.keys(row).sort(),['id','name','role','expiresAt','revokedAt'].sort());
  const serialized=JSON.stringify(list.data);assert.ok(!serialized.includes(created.data.code));assert.doesNotMatch(serialized,/code_hash|token_hash|kpc_inv_|kpc_ses_/);
});

test('authenticated team edits use server identity and are visible on another device',async()=>{
  const {db,admin,token}=await setup(),otherDevice=(await login(db,admin.code)).data.token;
  const editor=await access(db,'다른 편집자','editor'),editorToken=(await login(db,editor.code)).data.token;
  const imported=await request(db,'/api/team',{method:'POST',token,body:command('import',null,{issue:B.createStore().issues[0]})});
  assert.equal(imported.status,200);
  const changed=await request(db,'/api/team',{method:'POST',token:editorToken,headers:{'oai-authenticated-user-id':admin.id,'oai-authenticated-user-full-name':'FORGED_ACTOR'},body:command('fields',imported.data.issue,{actorId:admin.id,actorName:'FORGED_ACTOR',changes:{'sermon.title':'다른 기기에서도 보이는 설교'}})});
  assert.equal(changed.status,200);assert.equal(changed.data.issue.history.at(-1).actorId,editor.id);assert.equal(changed.data.issue.history.at(-1).actorName,editor.name);
  const second=await request(db,'/api/team',{token:otherDevice});assert.equal(second.status,200);assert.equal(second.data.user.id,admin.id);assert.equal(second.data.issues[0].sermon.title,'다른 기기에서도 보이는 설교');
  assert.equal((await request(db,'/api/public')).data.issues.length,0);
});

test('revoking access immediately invalidates every device session and the reusable code',async()=>{
  const {db,token}=await setup(),editor=await access(db,'교역자','editor');
  const first=(await login(db,editor.code)).data.token,second=(await login(db,editor.code)).data.token;
  const revoked=await request(db,'/api/access?id='+editor.id,{method:'DELETE',token});assert.equal(revoked.status,200);
  for(const editorToken of [first,second]){
    assert.equal((await request(db,'/api/session',{token:editorToken})).status,401);
    assert.equal((await request(db,'/api/team',{method:'POST',token:editorToken,body:{op:'profile',name:'Revoked'}})).status,401);
  }
  assert.equal((await login(db,editor.code)).status,401);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM access_sessions WHERE editor_id=? AND revoked_at IS NULL').get(editor.id).n,0);
  assert.ok((await request(db,'/api/access',{token})).data.editors.find(row=>row.id===editor.id).revokedAt);
  assert.ok(!(await request(db,'/api/team',{token})).data.members.some(member=>member.id===editor.id));
});

test('admin cannot revoke self and logout invalidates only the current device',async()=>{
  const {db,admin,token}=await setup(),second=(await login(db,admin.code)).data.token;
  assert.equal((await request(db,'/api/access?id='+admin.id,{method:'DELETE',token})).status,403);
  assert.equal((await request(db,'/api/session',{token})).status,200);
  assert.deepEqual((await request(db,'/api/logout',{method:'POST',token})).data,{loggedOut:true});
  assert.equal((await request(db,'/api/session',{token})).status,401);
  assert.equal((await request(db,'/api/session',{token:second})).status,200);
  assert.equal((await login(db,admin.code)).status,200);
});

test('coordinator must transfer responsibility before an administrator can revoke access',async()=>{
  const {db,admin,token}=await setup(),editor=await access(db,'최종 담당자','editor'),editorToken=(await login(db,editor.code)).data.token;
  const imported=await request(db,'/api/team',{method:'POST',token:editorToken,body:command('import',null,{issue:B.createStore().issues[0]})});
  assert.equal(imported.status,200);assert.equal(imported.data.issue.coordinatorId,editor.id);
  const blocked=await request(db,'/api/access?id='+editor.id,{method:'DELETE',token});assert.equal(blocked.status,403);assert.equal(blocked.data.error,'담당 주보의 최종 담당자를 먼저 변경해 주세요.');
  assert.equal((await request(db,'/api/session',{token:editorToken})).status,200);
  const moved=await request(db,'/api/team',{method:'POST',token:editorToken,body:command('coordinator',imported.data.issue,{memberId:admin.id})});assert.equal(moved.status,200);
  assert.equal((await request(db,'/api/access?id='+editor.id,{method:'DELETE',token})).status,200);
});

test('server-verified admin can recover an expired coordinator but forged admin claims cannot',async()=>{
  const {db,admin,token}=await setup(),owner=await access(db,'Former coordinator','editor'),other=await access(db,'Active editor','editor');
  const ownerToken=(await login(db,owner.code)).data.token,otherToken=(await login(db,other.code)).data.token;
  let issue=(await request(db,'/api/team',{method:'POST',token:ownerToken,body:command('import',null,{issue:B.createStore().issues[0]})})).data.issue;
  const forged=await request(db,'/api/team',{method:'POST',token:otherToken,headers:{'oai-authenticated-user-id':admin.id},body:command('coordinator',issue,{memberId:other.id,isAdmin:true,actor:{id:other.id,isAdmin:true}})});
  assert.equal(forged.status,400);
  assert.equal((await request(db,'/api/team',{method:'POST',token,body:command('finalize',issue)})).status,400);
  db.db.prepare('UPDATE editor_access SET expires_at=? WHERE id=?').run('1970-01-01T00:00:00.000Z',owner.id);
  const state=await request(db,'/api/team',{token});assert.ok(!state.data.members.some(member=>member.id===owner.id));assert.ok(state.data.issues[0].activity.some(event=>event.actorName===owner.name));
  assert.equal((await request(db,'/api/team',{method:'POST',token,body:command('coordinator',issue,{memberId:owner.id})})).status,400);
  assert.equal((await request(db,'/api/team',{method:'POST',token,body:command('task',issue,{section:'sermon',assigneeId:owner.id})})).status,400);
  const recovered=await request(db,'/api/team',{method:'POST',token,body:command('coordinator',issue,{memberId:admin.id})});assert.equal(recovered.status,200);issue=recovered.data.issue;
  assert.equal(issue.coordinatorId,admin.id);assert.equal(issue.activity.at(-1).actorId,admin.id);assert.equal(issue.activity.at(-1).actorName,admin.name);
  assert.equal((await request(db,'/api/access?id='+owner.id,{method:'DELETE',token})).status,200);
});

test('inherited task names cannot mutate Object.prototype and request sections stay plain text',async()=>{
  const {db,token}=await setup();let issue=(await request(db,'/api/team',{method:'POST',token,body:command('import',null,{issue:B.createStore().issues[0]})})).data.issue;
  for(const section of ['__proto__','constructor','toString','hasOwnProperty']){
    assert.equal(sectionFor(section),null);
    const result=await request(db,'/api/team',{method:'POST',token,body:command('task',issue,{section,status:'done'})});assert.equal(result.status,400);
    assert.equal({}.status,undefined);assert.equal({}.assigneeId,undefined);assert.equal({}.updatedBy,undefined);
    const added=await request(db,'/api/team',{method:'POST',token,body:command('request',issue,{section,body:'Section lookup test'})});assert.equal(added.status,200);issue=added.data.issue;assert.equal(issue.requests.at(-1).section,'주보');
  }
});

test('session and access expiry are enforced on every authenticated request',async()=>{
  const {db,admin,token}=await setup();
  assert.equal((await request(db,'/api/session',{token,now:NOW+SESSION_DURATION-1})).status,200);
  assert.equal((await request(db,'/api/session',{token,now:NOW+SESSION_DURATION})).status,401);
  const nearEnd=Date.parse(admin.expiresAt)-1000,lateLogin=await login(db,admin.code,{now:nearEnd});
  assert.equal(lateLogin.data.expiresAt,admin.expiresAt);
  assert.equal((await request(db,'/api/session',{token:lateLogin.data.token,now:Date.parse(admin.expiresAt)})).status,401);
  db.db.prepare('UPDATE editor_access SET expires_at=? WHERE id=?').run(new Date(NOW-1).toISOString(),admin.id);
  assert.equal((await request(db,'/api/team',{token})).status,401);
});

test('CORS allows exactly the configured origin and never cookies or arbitrary headers',async()=>{
  const {db,token}=await setup();
  const good=await request(db,'/api/session',{token});assert.equal(good.headers.get('access-control-allow-origin'),ORIGIN);assert.equal(good.headers.get('access-control-allow-credentials'),null);assert.equal(good.headers.get('vary'),'Origin');
  const bad=await request(db,'/api/session',{token,origin:'https://attacker.test'});assert.equal(bad.status,403);assert.equal(bad.headers.get('access-control-allow-origin'),null);
  const preflight=await request(db,'/api/team',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type, Authorization'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),ORIGIN);assert.equal(preflight.headers.get('access-control-allow-methods'),'GET, POST');
  for(const headers of [{'Access-Control-Request-Method':'PUT'},{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'oai-authenticated-user-id'}])assert.equal((await request(db,'/api/team',{method:'OPTIONS',headers})).status,403);
  assert.equal((await request(db,'/api/team',{method:'OPTIONS',origin:null,headers:{'Access-Control-Request-Method':'POST'}})).status,403);
  for(const origin of [null,'null','https://dohyoungkims.github.io.attacker.test',ORIGIN+'/KPCSTL-Jubo/'])assert.equal((await request(db,'/api/team',{method:'POST',token,origin,body:{op:'profile',name:'Should not save'}})).status,403);
  assert.equal((await request(db,'/api/login',{method:'POST',origin:null,body:{code:'anything'}})).status,403);
});

test('invalid deployment origin fails closed and valid localhost development remains isolated',async()=>{
  const db=new LocalD1();
  for(const origin of [undefined,'*',ORIGIN+'/',ORIGIN+'/KPCSTL-Jubo/','http://example.com','https://user:pass@church.test'])assert.equal((await request(db,'/api/public',{env:{FRONTEND_ORIGIN:origin}})).status,503);
  const result=await request(db,'/api/public',{origin:'http://127.0.0.1:5189',env:{FRONTEND_ORIGIN:'http://127.0.0.1:5189'}});assert.equal(result.status,200);assert.equal(result.headers.get('access-control-allow-origin'),'http://127.0.0.1:5189');
});

test('auth bodies are bounded and malformed input does not echo values or create access',async()=>{
  const {db,token}=await setup();
  for(const options of [
    {raw:'{PRIVATE_INVALID_JSON',headers:{'Content-Type':'application/json'}},
    {body:[]},{body:{name:'PRIVATE_UNKNOWN_FIELD'}},{body:{code:'x',role:'admin'}},
  ]){const result=await request(db,'/api/login',{method:'POST',...options});assert.equal(result.status,400);assert.doesNotMatch(JSON.stringify(result.data),/PRIVATE_|admin/);}
  assert.equal((await request(db,'/api/login',{method:'POST',raw:'code=secret'})).status,415);
  assert.equal((await request(db,'/api/login',{method:'POST',body:{code:'x'.repeat(9000)}})).status,413);
  for(const name of ['',null,'<script>','x'.repeat(61)])assert.equal((await request(db,'/api/access',{method:'POST',token,body:{name}})).status,400);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM editor_access').get().n,1);
});

test('database errors remain generic and failed access creation rolls back atomically',async()=>{
  const db={prepare(){throw Error('PRIVATE_DATABASE_CREDENTIALS');}};
  const result=await login(db,randomSecret('kpc_inv_'));assert.equal(result.status,503);assert.doesNotMatch(JSON.stringify(result.data),/PRIVATE_|SQL|token|code/);
  const ready=await setup();ready.db.failBatch=true;
  assert.equal((await request(ready.db,'/api/access',{method:'POST',token:ready.token,body:{name:'Rollback'}})).status,503);
  assert.equal(ready.db.db.prepare('SELECT COUNT(*) AS n FROM members').get().n,1);assert.equal(ready.db.db.prepare('SELECT COUNT(*) AS n FROM editor_access').get().n,1);
});

test('standalone team storage failures are generic 503s while domain validation and conflicts retain their status',async()=>{
  const {db,token}=await setup();
  assert.equal((await request(db,'/api/team',{method:'POST',token,body:{op:'profile',name:''}})).status,400);
  assert.equal((await request(db,'/api/team',{method:'POST',token,body:null})).status,400);
  const imported=await request(db,'/api/team',{method:'POST',token,body:command('import',null,{issue:B.createStore().issues[0]})});assert.equal(imported.status,200);
  const change=command('fields',imported.data.issue,{changes:{'sermon.title':'Changed'}});
  assert.equal((await request(db,'/api/team',{method:'POST',token,body:change})).status,200);
  assert.equal((await request(db,'/api/team',{method:'POST',token,body:{...change,commandId:crypto.randomUUID()}})).status,409);
  const prepare=db.prepare.bind(db);db.prepare=sql=>{
    if(sql.startsWith('SELECT m.id,m.name,m.created_at'))return {bind(){return this;},async all(){throw Error('PRIVATE_SQL_CONNECTION_DETAIL');}};
    return prepare(sql);
  };
  const failed=await request(db,'/api/team',{token});assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(failed.data),/PRIVATE_|SQL/);
  db.prepare=prepare;
  db.db.prepare('UPDATE issues SET document=?').run('{PRIVATE_BAD_STORAGE');
  const corrupt=await request(db,'/api/team',{token});assert.equal(corrupt.status,503);assert.doesNotMatch(JSON.stringify(corrupt.data),/PRIVATE_/);
});

test('team payload limit counts streamed UTF-8 bytes and cancels before reading the whole body',async()=>{
  const {db,token}=await setup();let pulls=0,cancelled=false;
  const stream=new ReadableStream({
    pull(controller){pulls++;if(pulls<=100)controller.enqueue(new Uint8Array(65536).fill(120));else controller.close();},
    cancel(){cancelled=true;},
  });
  const response=await handleRequest(new Request('https://api.church.test/api/team',{method:'POST',headers:{Origin:ORIGIN,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:stream,duplex:'half'}),{DB:db,FRONTEND_ORIGIN:ORIGIN},{now:NOW});
  assert.equal(response.status,413);assert.equal(cancelled,true);assert.ok(pulls<40);
  const unicode=await request(db,'/api/team',{method:'POST',token,body:{op:'profile',name:'한'.repeat(700000)}});assert.equal(unicode.status,413);
  assert.equal(db.db.prepare('SELECT name FROM members').get().name,'관리자');
});

test('initial admin CLI creates private files with hash-only SQL and never prints secrets',async()=>{
  const stdout=execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/manage-access.mjs',import.meta.url)),'--name',"CLI ' 관리자"],{encoding:'utf8'});
  const privatePath=stdout.match(/^Access file: (.+)$/m)?.[1],sqlPath=stdout.match(/^Seed SQL: (.+)$/m)?.[1];
  assert.ok(privatePath&&sqlPath);
  try{
    const saved=JSON.parse(readFileSync(privatePath,'utf8')),sql=readFileSync(sqlPath,'utf8');
    assert.match(saved.code,CODE_PATTERN);assert.equal(saved.role,'admin');assert.equal(statSync(privatePath).mode&0o777,0o600);assert.equal(statSync(sqlPath).mode&0o777,0o600);
    assert.ok(!stdout.includes(saved.code));assert.ok(!sql.includes(saved.code));assert.ok(sql.includes(await hashSecret(saved.code)));
    const db=new LocalD1();db.db.exec(sql);
    const result=await login(db,saved.code,{now:Date.parse(saved.createdAt)});assert.equal(result.status,200);assert.equal(result.data.user.name,"CLI ' 관리자");assert.equal(result.data.isAdmin,true);
  }finally{unlinkSync(privatePath);unlinkSync(sqlPath);}
});
