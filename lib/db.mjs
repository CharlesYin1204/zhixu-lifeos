import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import {safeRecordMeta} from './record-meta.mjs';
const g = globalThis;
export const pool = g.__zhixuPool ||= mysql.createPool({host:process.env.DB_HOST || '127.0.0.1',port:Number(process.env.DB_PORT || 3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:6,charset:'utf8mb4',timezone:'+08:00',dateStrings:true});
export async function q(sql, params=[]) { const [rows] = await pool.execute(sql,params); return rows; }
export const id = () => crypto.randomUUID();
export function parse(s, fallback={}) { try { return typeof s==='string'?JSON.parse(s):s??fallback; } catch { return fallback; } }
export async function entities(type, all=false) { return (await q('SELECT id,data,sort_order FROM entities WHERE type=? ORDER BY sort_order,id',[type])).map(r=>({...parse(r.data),id:r.id,sortOrder:r.sort_order})).filter(r=>all || r.enabled!==false); }
export async function entity(type,key) { const r=await q('SELECT data,sort_order FROM entities WHERE type=? AND id=?',[type,key]);return r[0]?{...parse(r[0].data),id:key,sortOrder:r[0].sort_order}:null; }
export async function putEntity(type,data) { const key=data.id || id();const sortOrder=Number.isInteger(data.sortOrder)?data.sortOrder:0;await q('INSERT INTO entities (id,type,data,sort_order) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),sort_order=VALUES(sort_order)',[key,type,JSON.stringify({...data,id:key}),sortOrder]);return key; }
export async function settings() { const r=await q('SELECT data FROM settings WHERE id=1');return parse(r[0]?.data); }
export async function saveSettings(data) { await q('INSERT INTO settings (id,data) VALUES (1,?) ON DUPLICATE KEY UPDATE data=VALUES(data)',[JSON.stringify(data)]); }
export async function audit(userId,action,detail={}) { await q('INSERT INTO audit (id,user_id,action,detail) VALUES (?,?,?,?)',[id(),userId||null,action,JSON.stringify(detail)]); }
export function cleanUser(u) { if(!u)return null;return {id:u.id,email:u.email,name:u.name,role:u.role,planId:u.plan_id,planExpires:u.plan_expires,credits:u.credits,status:u.status,createdAt:u.created_at}; }
export function cleanRecord(r) { return {...r,user_id:undefined,meta:safeRecordMeta(parse(r.meta)),createdAt:r.created_at,updatedAt:r.updated_at}; }
export function cleanRun(r) { return {...r,user_id:undefined,userId:r.user_id,steps:parse(r.steps,[]),agentIds:parse(r.agent_ids,[]),createdAt:r.created_at}; }
export function cleanOrder(r) { return {...r,user_id:undefined,userId:r.user_id,type:r.product_type,productId:r.product_id,amount:Number(r.amount)/100,paymentMethod:r.payment_method,createdAt:r.created_at}; }
