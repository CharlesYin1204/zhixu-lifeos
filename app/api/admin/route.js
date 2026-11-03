import {NextResponse} from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {q,id,parse,entity,entities,putEntity,settings,saveSettings,audit,cleanUser,cleanRun,cleanOrder} from '../../../lib/db.mjs';
import {AppError,assert,sessionUser,checkPassword,hashPassword,createSession,hashToken,limit,validateOrigin,textValue,passwordValue,encrypt,safeURL,secureRequest} from '../../../lib/security.mjs';
import {callModel} from '../../../lib/ai.mjs';
import {fulfill} from '../../../lib/payments.mjs';
import {apkInfo,publicSettings} from '../../../lib/site-settings.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=180;
const json=(data,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
function fail(error){console.error('Admin API:',error.message);return json({ok:false,error:error instanceof AppError?error.message:'管理服务暂时不可用，请稍后重试'},error.status||500);}
const requireAdmin=user=>{assert(user,'请登录管理员账号',401);assert(user.role==='admin','需要管理员权限',403);};
const adminIdentity=user=>user?{id:user.id,name:user.name,email:user.email,role:user.role,status:user.status,createdAt:user.created_at}:null;
const safeModel=model=>({...model,apiKey:undefined,hasKey:!!model.apiKey});
function apkConfig(input) {
 const c=Object.fromEntries(['appName','packageId','versionName','versionCode','serverUrl'].map(key=>[key,input[key]]));
 assert(typeof c.appName==='string'&&c.appName.trim()&&c.appName.length<=40&&!/[\u0000-\u001f\u007f]/.test(c.appName),'应用名称须为 1–40 个有效字符');
 assert(typeof c.packageId==='string'&&c.packageId.length<=120&&/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}$/.test(c.packageId),'包名须包含至少三段小写标识符');
 assert(typeof c.versionName==='string'&&c.versionName.length<=30&&/^[0-9]+(?:\.[0-9]+){0,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(c.versionName),'版本名称格式无效');
 c.versionCode=Number(c.versionCode);assert(Number.isSafeInteger(c.versionCode)&&c.versionCode>=1&&c.versionCode<=2100000000,'版本号须为有效正整数');
 let url;try{url=new URL(c.serverUrl);}catch{throw new AppError('站点地址无效');}
 assert(typeof c.serverUrl==='string'&&c.serverUrl.length<=1000&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.hash,'站点地址须为不含密码的 HTTP/HTTPS 地址');
 c.appName=c.appName.trim();c.serverUrl=url.href;return c;
}

export async function GET(req){try{
 const user=await sessionUser(req,'admin');
 const resource=req.nextUrl.searchParams.get('resource')||'bootstrap';
 if(resource==='bootstrap'){
  if(user)requireAdmin(user);
  const site=await settings();
  return json({ok:true,user:adminIdentity(user),settings:{siteName:site.siteName,description:site.description,supportContact:site.supportContact||''}});
 }
 if(resource==='admin'){requireAdmin(user);const [users,models,agents,plugins,plans,orders,logs,usage,s,adminRuns]=await Promise.all([q('SELECT * FROM users ORDER BY created_at DESC LIMIT 500'),entities('model',true),entities('agent',true),entities('plugin',true),entities('plan',true),q('SELECT o.*,u.email FROM orders o JOIN users u ON o.user_id=u.id ORDER BY o.created_at DESC LIMIT 300'),q('SELECT a.*,u.name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 100'),q('SELECT * FROM usage_logs ORDER BY created_at DESC LIMIT 100'),publicSettings(true),q('SELECT r.*,u.email,u.name FROM runs r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 100')]);const summary=await q("SELECT COUNT(*) AS count,COALESCE(SUM(IF(status='paid',amount,0)),0) AS revenue FROM orders");const rc=await q('SELECT COUNT(*) AS count FROM runs');const uc=await q('SELECT COUNT(*) AS count FROM users');return json({ok:true,users:users.map(cleanUser),models:models.map(safeModel),agents,plugins,plans,orders:orders.map(cleanOrder),settings:s,runs:adminRuns.map(cleanRun),audit:logs.map(x=>({...x,userId:x.user_id,detail:parse(x.detail),createdAt:x.created_at})),usage,stats:{users:Number(uc[0].count),revenue:Number(summary[0].revenue)/100,orders:summary[0].count,aiRuns:rc[0].count,models:models.length,plugins:plugins.length},builds:[s.apk]});}

 throw new AppError('管理资源不存在',404);
}catch(error){return fail(error);}}

export async function POST(req){try{
 validateOrigin(req);
 assert(Number(req.headers.get('content-length')||0)<250000,'请求内容过大',413);
 const raw=await req.text();assert(raw.length<250000,'请求内容过大',413);
 let b;try{b=JSON.parse(raw);}catch{throw new AppError('请求格式无效');}
 assert(b&&typeof b==='object'&&!Array.isArray(b),'请求格式无效');
 const action=b.action;assert(typeof action==='string','操作格式无效');
 assert(['auth.login','auth.logout','profile.update'].includes(action)||action.startsWith('admin.'),'管理操作不存在',404);
 const user=await sessionUser(req,'admin');let result={},cookie;
 if(action==='auth.login'){
  const email=textValue(b.email,190).toLowerCase(),password=passwordValue(b.password,1);
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'请输入正确邮箱');
  await limit(`auth:${email}`,12,900000);
  const account=(await q('SELECT * FROM users WHERE email=?',[email]))[0];
  assert(account&&await checkPassword(password,account.password_hash),'邮箱或密码错误',401);
  assert(account.status==='active','账户已被停用',403);
  assert(account.role==='admin','此账号没有管理员权限，请使用用户登录入口',403);
  cookie=await createSession(account.id,'admin');result={user:adminIdentity(account)};
 }else if(action==='auth.logout'){
  const token=req.cookies.get('zhixu_admin_session')?.value;
  if(token)await q('DELETE FROM sessions WHERE token_hash=? AND scope=?',[hashToken(token),'admin']);
  cookie='';
 }else{
  requireAdmin(user);await limit(`admin:${user.id}`,120,60000);
  if(action==='profile.update'){
   const name=textValue(b.name||user.name,80);
   if(b.password){passwordValue(b.password);assert(await checkPassword(b.currentPassword||'',user.password_hash),'当前密码不正确');await q('UPDATE users SET password_hash=? WHERE id=?',[await hashPassword(b.password),user.id]);await q('DELETE FROM sessions WHERE user_id=?',[user.id]);cookie=await createSession(user.id,'admin');}
   await q('UPDATE users SET name=? WHERE id=?',[name,user.id]);result={user:adminIdentity({...user,name})};
  }else {
 if(action==='admin.model.test'){const m=await entity('model',b.id);assert(m,'模型不存在');result=['transcription','speech'].includes(m.capability)?await (await import('../../../lib/media.mjs')).testMediaModel(m,user.id):await callModel({modelId:b.id,userId:user.id,kind:'test',messages:[{role:'user',content:'请用中文一句话介绍你如何帮助用户学习和生活。'}],maxTokens:200});await audit(user.id,action,{modelId:b.id,status:'success',latency:result.latency});}
 else if(action==='admin.order.approve'){const o=(await q('SELECT * FROM orders WHERE id=?',[b.id]))[0];assert(o?.payment_method==='manual','只能人工确认线下收款订单');await fulfill(b.id,'manual:'+user.id,user.id);}
 else if(action==='admin.save'){const type=b.entity,d=b.data;assert(d&&typeof d==='object','配置数据无效');assert(['model','agent','plugin','plan','settings','user'].includes(type),'配置类型无效');
  if(type==='settings'){const old=await settings();const payment={...old.payment,...d.payment};for(const k of ['epayKey','stripeSecret','stripeWebhookSecret']){if(d.payment?.[k])payment[k]=encrypt(d.payment[k]);else payment[k]=old.payment[k]||'';delete payment[`${k}Configured`];}if(payment.epayUrl)await safeURL(payment.epayUrl);if(payment.epayEnabled)assert(payment.epayUrl&&payment.epayPid&&payment.epayKey,'请填写易支付网关、商户ID和密钥');if(payment.stripeEnabled)assert(payment.stripeSecret&&payment.stripeWebhookSecret,'请填写Stripe密钥与Webhook密钥');const apk=d.apk?{...old.apk,...apkConfig({...old.apk,...d.apk})}:old.apk;let media=old.media;if(d.media){media={...old.media,...d.media};for(const key of ['voiceEnabled','imageEnabled','recordingEnabled'])assert(typeof media[key]==='boolean','媒体开关须为有效布尔值');for(const [key,capability] of [['visionModelId','chat'],['chatModelId','chat'],['transcriptionModelId','transcription'],['ttsModelId','speech']]){assert(typeof media[key]==='string','请选择有效模型');const model=await entity('model',media[key]);assert(model&&model.enabled!==false&&((model.capability||'chat')===capability||(capability==='chat'&&model.capability==='vision')),'媒体模型用途或启用状态不匹配');}assert(['alloy','echo','fable','onyx','nova','shimmer','coral','sage'].includes(media.voice),'请选择有效音色');}await saveSettings({...old,media,siteName:d.siteName||old.siteName,description:d.description??old.description,supportContact:String(d.supportContact??old.supportContact??'').slice(0,1000),announcement:d.announcement??old.announcement,payment,apk});}
  else if(type==='user') {
   assert(d.id,'用户ID缺失');
   const account=(await q('SELECT * FROM users WHERE id=?',[d.id]))[0];
   assert(account,'用户不存在');
   const status=d.status||account.status,role=d.role||account.role;
   assert(['active','disabled'].includes(status)&&['admin','user'].includes(role),'用户配置无效');
   assert(!(account.id===user.id&&(role!=='admin'||status!=='active')),'不能停用或降级当前管理员');
   const credits=d.credits==null?account.credits:Number(d.credits);
   assert(Number.isInteger(credits)&&credits>=0&&credits<=10000000,'额度无效');
   const planId=d.planId??account.plan_id;
   let expiration='plan_expires',expirationValues=[];
   if(planId==='free')expiration='NULL';
   else if(planId!==account.plan_id||(d.planExpires!==undefined&&d.planExpires!==account.plan_expires)) {
    const plan=await entity('plan',planId);
    assert(plan&&plan.enabled!==false,'请选择有效的会员方案');
    if(d.planExpires) {
     let input=String(d.planExpires).replace(' ','T');
     if(/^\d{4}-\d{2}-\d{2}$/.test(input))input+='T23:59:59+08:00';
     else if(!/(?:Z|[+-]\d{2}:\d{2})$/i.test(input))input+='+08:00';
     const date=new Date(input);
     assert(Number.isFinite(date.getTime())&&date.getTime()>Date.now(),'会员到期时间必须是有效的未来时间');
     expiration='?';
     expirationValues=[new Date(date.getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ')];
    } else {
     assert(Number.isInteger(Number(plan.days))&&Number(plan.days)>0,'此会员方案没有有效期限');
     expiration='DATE_ADD(NOW(), INTERVAL ? DAY)';
     expirationValues=[Number(plan.days)];
    }
   }
   await q(`UPDATE users SET name=?,role=?,status=?,credits=?,plan_id=?,plan_expires=${expiration} WHERE id=?`,[textValue(d.name||account.name,80),role,status,credits,planId,...expirationValues,account.id]);
   if(status==='disabled')await q('DELETE FROM sessions WHERE user_id=?',[account.id]);
  }
  else{const old=d.id?await entity(type,d.id):null;const data={...old,...d,id:d.id||id()};data.name=textValue(data.name,100);data.enabled=data.enabled!==false;
   if(type==='model'){data.baseUrl=await safeURL(textValue(data.baseUrl,500));data.model=textValue(data.model,120);data.apiKey=d.apiKey?encrypt(textValue(d.apiKey,1000)):old?.apiKey;assert(data.apiKey,'请配置 API Key');delete data.hasKey;data.capability=data.capability||'chat';assert(['chat','vision','transcription','speech'].includes(data.capability),'模型用途无效');assert(!data.isDefault||['chat','vision'].includes(data.capability),'默认模型须支持对话');for(const key of ['temperature','maxTokens']){if(data[key]===undefined||data[key]===null||data[key]==='')delete data[key];else{data[key]=Number(data[key]);assert(Number.isFinite(data[key])&&(key==='temperature'?data[key]>=0&&data[key]<=2:Number.isInteger(data[key])&&data[key]>=128&&data[key]<=32768),key==='temperature'?'温度须为0–2之间的数字':'输出预算须为128–32768的整数');}}if(data.isDefault){for(const model of await entities('model',true))if(model.id!==data.id&&model.isDefault)await putEntity('model',{...model,isDefault:false});}}
   if(type==='agent'){data.systemPrompt=textValue(data.systemPrompt||'你是一位耐心且务实的个人成长助手。',8000);data.modelId=typeof data.modelId==='string'?data.modelId.trim():'';if(data.modelId){const model=await entity('model',data.modelId);assert(model&&model.enabled!==false&&(!model.capability||['chat','vision'].includes(model.capability)),'请选择启用的对话模型');}}
   if(type==='plugin'||type==='plan'){data.price=Number(data.price);assert(Number.isFinite(data.price)&&data.price>=0&&data.price<=100000,'价格无效');data.price=Math.round(data.price*100)/100;data.features=Array.isArray(data.features)?data.features:[];}
   if(type==='plugin'){const agent=await entity('agent',data.agentId);assert(agent&&agent.enabled!==false,'请选择启用的 AI 助手');data.version=textValue(data.version||'1.0.0',40);data.listed=data.listed!==false;data.sortOrder=Number(data.sortOrder??0);assert(Number.isInteger(data.sortOrder)&&data.sortOrder>=-100000&&data.sortOrder<=100000,'排序须为-100000至100000的整数');}
   if(type==='plan'){data.days=Number(data.days);data.credits=Number(data.credits);assert(Number.isInteger(data.days)&&data.days>=0&&data.days<=3660&&Number.isInteger(data.credits)&&data.credits>=0&&data.credits<=1000000,'会员天数或额度无效');}
   await putEntity(type,data);result={id:data.id};
  }await audit(user.id,action,{entity:type,id:d.id||result.id});
 }
 else if(action==='admin.apk.build') {
  const s=await settings();
  assert(s.apk.buildStatus!=='building','APK 正在构建中');
  const config=apkConfig({...s.apk,...b.config});
  const input=path.join(process.cwd(),`private/apk-config-${crypto.randomUUID()}.json`);
  await fs.writeFile(input,JSON.stringify(config),{mode:0o600});
  await saveSettings({...s,apk:{...config,buildStatus:'building',buildStartedAt:new Date().toISOString(),error:''}});
  const log=await fs.open(path.join(process.cwd(),'private/apk-build.log'),'a',0o600);
  let buildError='';
  const child=spawn(process.execPath,['scripts/build-apk.mjs',input],{cwd:process.cwd(),stdio:['ignore',log.fd,'pipe'],env:{...process.env,PATH:'/usr/bin:/bin:'+path.dirname(process.execPath)}});
  child.stderr.on('data',chunk=>{buildError=(buildError+String(chunk)).slice(-3000);log.write(chunk).catch(()=>{});});
  child.once('error',error=>{buildError=error.message;console.error('APK process failed:',error.message);});
  child.once('close',async code=>{
   try {
    const current=await settings();
    const manifest=code===0?await apkInfo():{};
    await saveSettings({...current,apk:{...current.apk,...manifest,buildStatus:code===0?'ready':'failed',error:code===0?'':(buildError.trim()||'构建进程意外退出，请重试').slice(-2000)}});
   } catch(error) {
    console.error('APK status update failed:',error.message);
   } finally {
    await log.close().catch(()=>{});
    await fs.unlink(input).catch(()=>{});
   }
  });
  await audit(user.id,action,{versionName:config.versionName});
  result={status:'building'};
 }

 else throw new AppError('管理操作不存在',404);
  }
 }
 const response=json({ok:true,...result});
 if(cookie!==undefined)response.cookies.set('zhixu_admin_session',cookie,{httpOnly:true,sameSite:'lax',secure:secureRequest(req),path:'/',maxAge:cookie?14*24*3600:0});
 return response;
}catch(error){return fail(error);}}
