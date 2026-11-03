import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import dns from 'node:dns/promises';
import net from 'node:net';
import { q } from './db.mjs';
export class AppError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export const assert=(test,message,status=400)=>{if(!test)throw new AppError(message,status);};
const key=()=>crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
export function encrypt(value){if(!value)return '';const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return `enc:${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${data.toString('hex')}`;}
export function decrypt(value){if(!value)return '';if(!value.startsWith('enc:'))return value;const [,iv,tag,data]=value.split(':');const d=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'hex'));d.setAuthTag(Buffer.from(tag,'hex'));return d.update(Buffer.from(data,'hex'),'binary','utf8')+d.final('utf8');}
export function passwordValue(value,minLength=8){assert(typeof value==='string'&&value.length>=minLength&&Buffer.byteLength(value,'utf8')<=72,`密码至少 ${minLength} 位，且 UTF-8 编码不超过 72 字节`);return value;}
export const hashPassword=p=>bcrypt.hash(passwordValue(p),12);
export const checkPassword=(p,h)=>typeof p==='string'&&Buffer.byteLength(p,'utf8')<=72?bcrypt.compare(p,h):Promise.resolve(false);
export const hashToken=t=>crypto.createHash('sha256').update(t).digest('hex');
// Next listens on loopback behind our nginx configs, which overwrite this header
// from the actual transport (never forward a client-supplied protocol value).
export function secureRequest(req){return req.nextUrl.protocol==='https:'||req.headers.get('x-forwarded-proto')==='https';}
export function sessionCookie(scope='user'){assert(['user','admin'].includes(scope),'会话范围无效');return scope==='admin'?'zhixu_admin_session':'zhixu_session';}
export async function sessionUser(req,scope='user') {
 const token=req.cookies.get(sessionCookie(scope))?.value;
 if(!token)return null;
 const rows=await q('SELECT u.*,IF(u.plan_expires IS NOT NULL AND u.plan_expires<=NOW(),1,0) AS plan_expired FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.scope=? AND s.expires_at>NOW() AND u.status=?',[hashToken(token),scope,'active']);
 let user=rows[0]||null;
 if(scope==='user'&&user&&user.plan_id!=='free'&&user.plan_expired) {
  const expired=await q("UPDATE users SET plan_id='free' WHERE id=? AND plan_id<>'free' AND plan_expires<=NOW()",[user.id]);
  if(expired.affectedRows)user.plan_id='free';
  else user=(await q('SELECT * FROM users WHERE id=?',[user.id]))[0]||null;
 }
 return user;
}
export async function createSession(userId,scope='user'){sessionCookie(scope);const t=crypto.randomBytes(32).toString('hex');await q('INSERT INTO sessions (token_hash,user_id,scope,expires_at) VALUES (?,?,?,DATE_ADD(NOW(), INTERVAL 14 DAY))',[hashToken(t),userId,scope]);return t;}
export async function limit(key,max=20,window=60000){const now=Date.now();await q('INSERT INTO rate_limits (id,hits,window_start) VALUES (?,1,?) ON DUPLICATE KEY UPDATE hits=IF(window_start<?,1,hits+1),window_start=IF(window_start<?,VALUES(window_start),window_start)',[key,now,now-window,now-window]);const r=await q('SELECT hits FROM rate_limits WHERE id=?',[key]);assert(r[0].hits<=max,'操作太频繁，请稍后重试',429);}
export function validateOrigin(req){const o=req.headers.get('origin');if(!o)return;const allowed=new Set([new URL(process.env.APP_URL).origin,req.nextUrl.origin]);const host=req.headers.get('host');if(host)allowed.add(`${req.nextUrl.protocol}//${host}`);assert(allowed.has(o),'请求来源不被允许',403);}
export function textValue(v,max=2000){assert(typeof v==='string'&&v.trim()&&v.length<=max,`请输入有效内容（最多 ${max} 字）`);return v.trim();}
export function publicAddress(ip){if(net.isIP(ip)===6)return !(/^(::|fc|fd|fe80|ff)/i.test(ip))&&!ip.toLowerCase().includes('ffff:');return !/^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|224\.|240\.)/.test(ip);}
export async function safeURL(raw){let url;try{url=new URL(raw);}catch{throw new AppError('URL 格式不正确');}assert(url.protocol==='https:'&&!url.username&&!url.password,'API 和支付网关必须使用 HTTPS 公网地址');const addresses=await dns.lookup(url.hostname,{all:true});assert(addresses.length&&addresses.every(a=>publicAddress(a.address)),'不能连接内部网络地址');return url.toString().replace(/\/$/,'');}
