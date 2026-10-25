import B from '../frontend/core.js';
import {actorName,initializeIssue,applyCommand} from './team-domain.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
class StorageFailure extends Error{}
class PayloadLimit extends Error{}
function guardedDatabase(db){
  const statements=new WeakMap();
  const wrap=statement=>{
    const result={
      bind(...values){try{return wrap(statement.bind(...values));}catch{throw new StorageFailure();}},
      async first(...args){try{return await statement.first(...args);}catch{throw new StorageFailure();}},
      async all(...args){try{return await statement.all(...args);}catch{throw new StorageFailure();}},
      async run(...args){try{return await statement.run(...args);}catch{throw new StorageFailure();}},
    };
    statements.set(result,statement);return result;
  };
  return {
    prepare(sql){try{return wrap(db.prepare(sql));}catch{throw new StorageFailure();}},
    async batch(items){try{return await db.batch(items.map(item=>statements.get(item)||item));}catch{throw new StorageFailure();}},
  };
}
async function readBoundedBody(request){
  const maximum=2000000,declared=request.headers.get('content-length');
  if(declared!==null&&Number(declared)>maximum)throw new PayloadLimit();
  const reader=request.body?.getReader();if(!reader)return '';
  const decoder=new TextDecoder();let size=0,raw='';
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw new PayloadLimit();}raw+=decoder.decode(value,{stream:true});}
    return raw+decoder.decode();
  }finally{reader.releaseLock();}
}
export function identity(request){
  const id=request.headers.get('oai-authenticated-user-id');if(!id)return null;
  let name=request.headers.get('oai-authenticated-user-full-name')||'';
  if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8')try{name=decodeURIComponent(name);}catch{name='';}
  return {id,name,email:request.headers.get('oai-authenticated-user-email')||''};
}
export async function teamApi(request,db,options={}){
  // External hosts supply a verified identity explicitly. The default is only
  // for the original Sites dispatch boundary, which injects trusted headers.
  const user=Object.hasOwn(options,'trustedUser')?options.trustedUser:identity(request);if(!user)return json({error:'로그인이 필요합니다.'},401);
  if(!db)return json({error:'공유 저장소 연결을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'},503);
  const standalone=Object.hasOwn(options,'trustedUser');if(standalone)db=guardedDatabase(db);
  const storedDocument=value=>{try{return JSON.parse(value);}catch(error){if(standalone)throw new StorageFailure();throw error;}};
  try{
    const allMembers=async()=> (await (standalone
      ?db.prepare('SELECT m.id,m.name,m.created_at AS createdAt,m.updated_at AS updatedAt FROM members AS m JOIN editor_access AS a ON a.id=m.id WHERE a.revoked_at IS NULL AND a.expires_at>? ORDER BY m.created_at').bind(new Date().toISOString())
      :db.prepare('SELECT id,name,created_at AS createdAt,updated_at AS updatedAt FROM members ORDER BY created_at')).all()).results;
    const getIssue=async id=>{const r=await db.prepare('SELECT document FROM issues WHERE id=?').bind(id).first();return r?storedDocument(r.document):null;};
    if(request.method==='GET'){
      const url=new URL(request.url),version=url.searchParams.get('version'),id=url.searchParams.get('issue');
      if(version&&id){const r=await db.prepare('SELECT document FROM issue_versions WHERE issue_id=? AND version=?').bind(id,Number(version)).first();return r?json({issue:storedDocument(r.document)}):json({error:'해당 기록을 찾을 수 없습니다.'},404);}
      const [members,rows]=await Promise.all([allMembers(),db.prepare('SELECT document FROM issues ORDER BY id DESC').all()]);
      return json({user,profile:members.find(m=>m.id===user.id)||null,members,issues:rows.results.map(r=>storedDocument(r.document))});
    }
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    const origin=request.headers.get('origin');if(origin&&origin!==(options.allowedOrigin||new URL(request.url).origin))return json({error:'같은 사이트에서 요청해 주세요.'},403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
    const raw=await readBoundedBody(request),command=JSON.parse(raw),now=new Date().toISOString();
    if(!command||typeof command!=='object'||Array.isArray(command))throw Error('요청 내용을 확인해 주세요.');
    if(command.op==='coordinator'&&standalone&&user.isSharedEditor===true&&command.memberId!==user.id)return json({error:'공유 편집팀의 최종 담당자는 관리자만 변경할 수 있습니다.'},403);
    if(command.op==='profile'){
      if(standalone&&user.isSharedEditor===true)return json({error:'공유 편집팀 이름은 변경할 수 없습니다.'},403);
      const name=actorName(command.name);
      await db.prepare('INSERT INTO members (id,name,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at').bind(user.id,name,now,now).run();
      return json({profile:{id:user.id,name},members:await allMembers()});
    }
    const members=await allMembers(),member=members.find(m=>m.id===user.id);if(!member)return json({error:'먼저 표시 이름을 등록해 주세요.'},428);
    const actor={...member,...(standalone&&user.isAdmin===true?{isAdmin:true}:{})};
    if(typeof command.commandId!=='string'||command.commandId.length>100||!command.commandId)return json({error:'변경 식별자가 필요합니다.'},400);
    if(command.op==='import'){
      const i=initializeIssue(command.issue,actor,now),doc=JSON.stringify(i),mutation=crypto.randomUUID();
      const results=await db.batch([
        db.prepare('INSERT OR IGNORE INTO issues (id,version,document,mutation_id,updated_at) VALUES (?,?,?,?,?)').bind(i.id,1,doc,mutation,now),
        db.prepare('INSERT INTO issue_versions (issue_id,version,document,actor_id,created_at) SELECT id,version,document,?,? FROM issues WHERE id=? AND mutation_id=?').bind(actor.id,now,i.id,mutation)
      ]);
      if(!results[0].meta.changes)return json({error:'같은 날짜의 공유 주보가 이미 있습니다. 기존 주보를 덮어쓰지 않았습니다.',current:await getIssue(i.id)},409);
      return json({issue:i});
    }
    const previous=await getIssue(command.issueId);if(!previous)return json({error:'주보를 찾을 수 없습니다.'},404);
    if(command.op==='new-week'){
      const temp={schemaVersion:1,serial:0,current:previous.id,issues:[previous]},next=B.duplicate(temp,previous.id,command.date).issues[1];
      const i=initializeIssue(next,actor,now);i.coordinatorId=previous.coordinatorId;
      for(const key of Object.keys(i.tasks))i.tasks[key].assigneeId=previous.tasks[key]?.assigneeId||null;
      const mutation=crypto.randomUUID(),doc=JSON.stringify(i);
      const results=await db.batch([
        db.prepare('INSERT OR IGNORE INTO issues (id,version,document,mutation_id,updated_at) VALUES (?,?,?,?,?)').bind(i.id,1,doc,mutation,now),
        db.prepare('INSERT INTO issue_versions (issue_id,version,document,actor_id,created_at) SELECT id,version,document,?,? FROM issues WHERE id=? AND mutation_id=?').bind(actor.id,now,i.id,mutation)
      ]);
      if(!results[0].meta.changes)return json({error:'이미 같은 주의 주보가 있습니다.'},409);
      return json({issue:i});
    }
    let result;
    try{result=applyCommand(previous,command,actor,members,now);}catch(e){if(e.status===409)return json({error:e.message,current:previous},409);throw e;}
    if(result.duplicate)return json({issue:previous});
    const i=result.issue,mutation=crypto.randomUUID(),doc=JSON.stringify(i);
    const results=await db.batch([
      db.prepare('UPDATE issues SET version=?,document=?,mutation_id=?,updated_at=? WHERE id=? AND version=?').bind(i.version,doc,mutation,now,i.id,previous.version),
      db.prepare('INSERT INTO issue_versions (issue_id,version,document,actor_id,created_at) SELECT id,version,document,?,? FROM issues WHERE id=? AND mutation_id=?').bind(actor.id,now,i.id,mutation)
    ]);
    if(!results[0].meta.changes)return json({error:'다른 분의 변경이 먼저 저장됐습니다. 최신 내용과 비교해 주세요.',current:await getIssue(i.id)},409);
    return json({issue:i});
  }catch(e){
    if(e instanceof PayloadLimit)return json({error:'전송할 내용이 너무 큽니다.'},413);
    if(standalone&&(e instanceof StorageFailure||e instanceof TypeError||e instanceof RangeError))return json({error:'공유 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'},503);
    return json({error:e instanceof SyntaxError?'잘못된 요청 형식입니다.':e.message||'저장하지 못했습니다.'},400);
  }
}
