import {actorName} from '../lib/team-domain.mjs';

export const SESSION_DURATION=30*24*60*60*1000;
export const ACCESS_DURATION=365*24*60*60*1000;
export const CODE_PATTERN=/^kpc_inv_[A-Za-z0-9_-]{43}$/;
export const TOKEN_PATTERN=/^kpc_ses_[A-Za-z0-9_-]{43}$/;

export function randomSecret(prefix){
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const encoded=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  return prefix+encoded;
}

export async function hashSecret(secret){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function createAccessRecord(name,role='editor',now=Date.now()){
  const cleanName=actorName(name);
  if(!['admin','editor'].includes(role)||!Number.isFinite(now))throw Error('Invalid access details');
  const code=randomSecret('kpc_inv_');
  return {
    id:'editor_'+crypto.randomUUID(),name:cleanName,role,code,
    codeHash:await hashSecret(code),
    createdAt:new Date(now).toISOString(),expiresAt:new Date(now+ACCESS_DURATION).toISOString(),
  };
}

export function accessStatements(db,access){
  return [
    db.prepare('INSERT INTO members (id,name,created_at,updated_at) VALUES (?,?,?,?)').bind(access.id,access.name,access.createdAt,access.createdAt),
    db.prepare('INSERT INTO editor_access (id,role,code_hash,created_at,expires_at,revoked_at) VALUES (?,?,?,?,?,NULL)').bind(access.id,access.role,access.codeHash,access.createdAt,access.expiresAt),
  ];
}

export function validAccess(row,now){
  if(!row||typeof row.id!=='string'||!row.id.startsWith('editor_')||!['admin','editor'].includes(row.role)||row.revokedAt!==null)return false;
  if(typeof row.expiresAt!=='string'||!Number.isFinite(Date.parse(row.expiresAt))||Date.parse(row.expiresAt)<=now)return false;
  try{return actorName(row.name)===row.name;}catch{return false;}
}

export function sessionView(session){
  return {expiresAt:session.sessionExpiresAt,user:{id:session.id,name:session.name},isAdmin:session.role==='admin'};
}

export async function authenticate(request,db,now){
  const authorization=request.headers.get('authorization')||'';
  if(!authorization.startsWith('Bearer '))return null;
  const token=authorization.slice(7);
  if(!TOKEN_PATTERN.test(token))return null;
  const tokenHash=await hashSecret(token);
  const row=await db.prepare(`SELECT a.id,a.role,a.expires_at AS expiresAt,a.revoked_at AS revokedAt,
    m.name,s.expires_at AS sessionExpiresAt,s.revoked_at AS sessionRevokedAt
    FROM access_sessions AS s JOIN editor_access AS a ON a.id=s.editor_id
    JOIN members AS m ON m.id=a.id WHERE s.token_hash=?`).bind(tokenHash).first();
  if(!validAccess(row,now)||row.sessionRevokedAt!==null||typeof row.sessionExpiresAt!=='string'||!Number.isFinite(Date.parse(row.sessionExpiresAt))||Date.parse(row.sessionExpiresAt)<=now)return null;
  return {...row,tokenHash};
}
