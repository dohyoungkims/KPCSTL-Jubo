import {teamApi} from '../lib/team-service.mjs';
import {publicBulletinApi} from '../lib/public-bulletin.mjs';
import {CODE_PATTERN,SESSION_DURATION,accessStatements,authenticate,createAccessRecord,hashSecret,randomSecret,sessionView,validAccess} from './auth.mjs';

const METHODS={
  '/health':['GET'],
  '/api/login':['POST'],
  '/api/session':['GET'],
  '/api/logout':['POST'],
  '/api/access':['GET','POST','DELETE'],
  '/api/team':['GET','POST'],
  '/api/public':['GET'],
};
const UNAVAILABLE='공유 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});

class HttpError extends Error{
  constructor(status,message){super(message);this.status=status;}
}

function frontendOrigin(value){
  if(typeof value!=='string')return null;
  try{
    const url=new URL(value);
    const secure=url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname));
    return secure&&url.origin===value&&!url.username&&!url.password?value:null;
  }catch{return null;}
}

function cors(response,origin,allowed){
  const headers=new Headers(response.headers);
  headers.set('vary','Origin');
  if(origin===allowed)headers.set('access-control-allow-origin',allowed);
  return new Response(response.body,{status:response.status,headers});
}

async function readJson(request,fields){
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new HttpError(415,'JSON 형식으로 요청해 주세요.');
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>8192))throw new HttpError(413,'전송할 내용이 너무 큽니다.');
  const reader=request.body?.getReader();
  if(!reader)throw new HttpError(400,'요청 내용을 확인해 주세요.');
  const decoder=new TextDecoder();let size=0,raw='';
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>8192){await reader.cancel();throw new HttpError(413,'전송할 내용이 너무 큽니다.');}
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }finally{reader.releaseLock();}
  let value;
  try{value=JSON.parse(raw);}catch{throw new HttpError(400,'요청 내용을 확인해 주세요.');}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))throw new HttpError(400,'요청 내용을 확인해 주세요.');
  return value;
}

async function login(request,db,now){
  const input=await readJson(request,['code']);
  const code=typeof input.code==='string'?input.code.trim():'';
  const invalid=()=>json({error:'접속 코드를 확인해 주세요.'},401);
  if(!CODE_PATTERN.test(code))return invalid();
  const codeHash=await hashSecret(code);
  const access=await db.prepare(`SELECT a.id,a.role,a.expires_at AS expiresAt,a.revoked_at AS revokedAt,m.name
    FROM editor_access AS a JOIN members AS m ON m.id=a.id WHERE a.code_hash=?`).bind(codeHash).first();
  if(!validAccess(access,now))return invalid();
  const token=randomSecret('kpc_ses_'),tokenHash=await hashSecret(token);
  const createdAt=new Date(now).toISOString(),expiresAt=new Date(Math.min(now+SESSION_DURATION,Date.parse(access.expiresAt))).toISOString();
  // Recheck access inside the insert so a concurrent revoke cannot issue a session.
  const result=await db.prepare(`INSERT INTO access_sessions (token_hash,editor_id,created_at,expires_at,revoked_at)
    SELECT ?,id,?,?,NULL FROM editor_access WHERE id=? AND code_hash=? AND revoked_at IS NULL AND expires_at>?`)
    .bind(tokenHash,createdAt,expiresAt,access.id,codeHash,createdAt).run();
  if(result.meta.changes!==1)return invalid();
  return json({token,...sessionView({...access,sessionExpiresAt:expiresAt})});
}

async function accessApi(request,db,session,now){
  if(session.role!=='admin')return json({error:'관리자만 편집 권한을 관리할 수 있습니다.'},403);
  if(request.method==='GET'){
    const rows=await db.prepare(`SELECT a.id,m.name,a.role,a.expires_at AS expiresAt,a.revoked_at AS revokedAt
      FROM editor_access AS a JOIN members AS m ON m.id=a.id ORDER BY a.created_at,a.id`).all();
    return json({editors:rows.results.map(row=>({id:row.id,name:row.name,role:row.role,expiresAt:row.expiresAt,revokedAt:row.revokedAt}))});
  }
  if(request.method==='POST'){
    const input=await readJson(request,['name']);let access;
    try{access=await createAccessRecord(input.name,'editor',now);}catch{return json({error:'표시할 이름을 1–60자로 입력해 주세요.'},400);}
    await db.batch(accessStatements(db,access));
    return json({code:access.code,id:access.id,name:access.name},201);
  }
  const params=new URL(request.url).searchParams,id=params.get('id');
  if(params.getAll('id').length!==1||[...params.keys()].some(key=>key!=='id')||typeof id!=='string'||!/^editor_[0-9a-f-]{36}$/.test(id))return json({error:'편집자를 확인해 주세요.'},400);
  if(id===session.id)return json({error:'현재 로그인한 관리자의 권한은 해제할 수 없습니다.'},403);
  const exists=await db.prepare('SELECT id FROM editor_access WHERE id=?').bind(id).first();
  if(!exists)return json({error:'편집자를 찾을 수 없습니다.'},404);
  const coordinatorGuard="SELECT 1 FROM issues WHERE CASE WHEN json_valid(document) THEN json_extract(document,'$.coordinatorId') END=?";
  const coordinatorMessage='담당 주보의 최종 담당자를 먼저 변경해 주세요.';
  if(await db.prepare(coordinatorGuard+' LIMIT 1').bind(id).first())return json({error:coordinatorMessage},403);
  const at=new Date(now).toISOString();
  const results=await db.batch([
    db.prepare('UPDATE editor_access SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND NOT EXISTS ('+coordinatorGuard+')').bind(at,id,id),
    db.prepare('UPDATE access_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE editor_id=? AND EXISTS (SELECT 1 FROM editor_access WHERE id=? AND revoked_at IS NOT NULL)').bind(at,id,id),
  ]);
  if(!results[0].meta.changes)return json({error:coordinatorMessage},403);
  return json({revoked:true,id});
}

async function sharedEditor(env,now){
  // Open editing is an explicit deployment choice, never a client assertion.
  const id=env.SHARED_EDITOR_ID;
  if(env.OPEN_EDITING!=='true'||typeof id!=='string'||!id||id.length>120)return null;
  const row=await env.DB.prepare(`SELECT a.id,a.role,a.expires_at AS expiresAt,a.revoked_at AS revokedAt,m.name
    FROM editor_access AS a JOIN members AS m ON m.id=a.id WHERE a.id=?`).bind(id).first();
  if(!validAccess(row,now)||row.role!=='editor')return null;
  return {...row,sharedEditing:true,sessionExpiresAt:null};
}

async function route(request,env,allowed,now){
  const path=new URL(request.url).pathname;
  if(path==='/health')return json({ok:true});
  if(!env.DB)return json({error:UNAVAILABLE},503);
  if(path==='/api/public')return publicBulletinApi(request,env.DB);
  if(path==='/api/login')return login(request,env.DB,now);
  let session=await authenticate(request,env.DB,now);
  // A supplied but invalid/expired token must remain a 401. Only an absent
  // Authorization header may select the common, non-admin editor identity.
  if(!session&&!request.headers.has('authorization')&&['/api/session','/api/team'].includes(path))session=await sharedEditor(env,now);
  if(!session)return json({error:'로그인이 필요합니다.'},401);
  if(path==='/api/session')return json({...sessionView(session),...(session.sharedEditing?{sharedEditing:true}:{})});
  if(path==='/api/logout'){
    await env.DB.prepare('UPDATE access_sessions SET revoked_at=? WHERE token_hash=?').bind(new Date(now).toISOString(),session.tokenHash).run();
    return json({loggedOut:true});
  }
  if(path==='/api/access')return accessApi(request,env.DB,session,now);
  if(path==='/api/team')return teamApi(request,env.DB,{trustedUser:{id:session.id,name:session.name,email:'',isAdmin:session.role==='admin',isSharedEditor:session.sharedEditing===true||(session.role==='editor'&&session.id===env.SHARED_EDITOR_ID)},allowedOrigin:allowed});
  return json({error:'Not found'},404);
}

export async function handleRequest(request,env,{now=Date.now()}={}){
  const origin=request.headers.get('origin'),allowed=frontendOrigin(env.FRONTEND_ORIGIN);
  if(!allowed)return json({error:UNAVAILABLE},503);
  const respond=response=>cors(response,origin,allowed);
  if(origin!==null&&origin!==allowed)return respond(json({error:'허용된 앱에서 요청해 주세요.'},403));
  const methods=METHODS[new URL(request.url).pathname];
  if(!methods)return respond(json({error:'Not found'},404));
  if(request.method==='OPTIONS'){
    const requestedMethod=request.headers.get('access-control-request-method');
    const requestedHeaders=(request.headers.get('access-control-request-headers')||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean);
    if(origin!==allowed||!methods.includes(requestedMethod)||requestedHeaders.some(header=>!['authorization','content-type'].includes(header)))return respond(json({error:'허용되지 않은 요청입니다.'},403));
    return respond(new Response(null,{status:204,headers:{'access-control-allow-methods':methods.join(', '),'access-control-allow-headers':'Authorization, Content-Type','access-control-max-age':'600','cache-control':'no-store'}}));
  }
  if(!methods.includes(request.method))return respond(json({error:'Method not allowed'},405,{allow:methods.join(', ')}));
  if(request.method!=='GET'&&origin!==allowed)return respond(json({error:'허용된 앱에서 요청해 주세요.'},403));
  try{return respond(await route(request,env,allowed,now));}
  catch(error){return respond(error instanceof HttpError?json({error:error.message},error.status):json({error:UNAVAILABLE},503));}
}

export default {fetch:(request,env)=>handleRequest(request,env)};
