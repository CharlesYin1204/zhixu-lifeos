import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {q,pool,id,entity,entities,putEntity,settings,saveSettings} from '../lib/db.mjs';
import {encrypt,passwordValue,hashPassword,checkPassword} from '../lib/security.mjs';
import {enqueueRun,executeRun,failRun,callModel} from '../lib/ai.mjs';
import {epaySign} from '../lib/payments.mjs';

// Pause the workflow worker first: these tests create queued fixtures and never call an AI provider.
assert.equal(process.env.REGRESSION_WORKER_PAUSED,'1','请先暂停工作流 worker，再设置 REGRESSION_WORKER_PAUSED=1 运行回归。');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3060';
const stamp=Date.now(),report=[],temporaryEntities=[],temporaryOrders=[];
let userId,originalSettings;
function client(endpoint='/api/app') {
 let cookie='';
 return async function request(body,expected=200) {
  const get=typeof body==='string';
  const response=await fetch(base+endpoint+(get?body:''),{
   method:get?'GET':'POST',headers:{'Content-Type':'application/json',cookie},
   ...(get?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)
  });
  const session=response.headers.get('set-cookie');
  if(session)cookie=session.split(';')[0];
  const data=await response.json();
  assert.equal(response.status,expected,JSON.stringify(data));
  return data;
 };
}
const user=client(),admin=client('/api/admin');
const credits=async()=>Number((await q('SELECT credits FROM users WHERE id=?',[userId]))[0].credits);
async function test(name,run) {
 const started=Date.now();
 await run();
 report.push({name,passed:true,ms:Date.now()-started});
 console.log('PASS',name);
}
try {
 originalSettings=await settings();
 await admin({action:'auth.login',email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});
 const email=`regression-${stamp}@example.test`;
 const initialPassword=' OriginalSpace987! ',newPassword=' ChangedSpace987! ';
 userId=(await user({action:'auth.register',name:'回归验收',email,password:initialPassword})).user.id;

 await test('Passwords retain leading/trailing spaces across register, update and login',async()=>{
  await user({action:'auth.logout'});
  await user({action:'auth.login',email,password:initialPassword});
  await user({action:'auth.login',email,password:initialPassword.trim()},401);
  await user({action:'profile.update',password:newPassword,currentPassword:initialPassword});
  await user({action:'auth.logout'});
  await user({action:'auth.login',email,password:newPassword});
  await user({action:'auth.login',email,password:newPassword.trim()},401);
 });

 await test('bcrypt input is limited by UTF-8 bytes, without silent truncation',async()=>{
  assert.throws(()=>passwordValue('a'.repeat(73)));
  assert.throws(()=>passwordValue('学'.repeat(25)));
  assert.equal(passwordValue('学'.repeat(24)).length,24);
  const hash=await hashPassword('a'.repeat(72));
  assert.equal(await checkPassword('a'.repeat(72),hash),true);
  assert.equal(await checkPassword('a'.repeat(72)+'suffix',hash),false);
  await user({action:'profile.update',password:'学'.repeat(25),currentPassword:newPassword},400);
 });

 await test('Empty or unknown workflow specialists are rejected before charging',async()=>{
  const before=await credits();
  await user({action:'ai.run',goal:'不应入队',agentIds:[]},400);
  await user({action:'ai.run',goal:'不应入队',agentIds:['missing-agent']},400);
  assert.equal(await credits(),before);
  assert.equal((await q('SELECT id FROM runs WHERE user_id=?',[userId])).length,0);
 });

 await test('Queue insertion failure rolls back the reserved credits',async()=>{
  const before=await credits();
  // An undefined bind deliberately fails the INSERT after the debit, without changing the schema.
  await assert.rejects(enqueueRun(userId,undefined,['study']));
  assert.equal(await credits(),before);
  assert.equal((await q('SELECT id FROM runs WHERE user_id=?',[userId])).length,0);
 });

 await test('Concurrent submissions enforce two active jobs and exact credit debits',async()=>{
  const before=await credits();
  const results=await Promise.allSettled(Array.from({length:6},(_,index)=>enqueueRun(userId,`并发队列回归 ${index}`,['study'])));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,2);
  assert.equal(results.filter(result=>result.status==='rejected').length,4);
  assert.equal(await credits(),before-10);
  const runs=await q('SELECT id,status FROM runs WHERE user_id=?',[userId]);
  assert.equal(runs.length,2);
  assert(runs.every(run=>run.status==='queued'));
  await q("UPDATE runs SET status='running' WHERE user_id=?",[userId]);
  const refunds=await Promise.all([failRun(runs[0].id,'并发退款测试'),failRun(runs[0].id,'重复退款测试'),failRun(runs[0].id,'再次退款测试')]);
  assert.equal(refunds.filter(Boolean).length,1);
  assert.equal(await credits(),before-5);
  assert.equal(await failRun(runs[1].id,'测试完成'),true);
  assert.equal(await credits(),before);
 });

 await test('Workflow preflight errors fail the task and refund exactly once',async()=>{
  const before=await credits(),runId=id();
  await q('UPDATE users SET credits=credits-5 WHERE id=?',[userId]);
  await q("INSERT INTO runs (id,user_id,goal,agent_ids,steps,status) VALUES (?,?,?,'[]','[]','running')",[runId,userId,'无 Agent 的历史坏任务']);
  const run=(await q('SELECT * FROM runs WHERE id=?',[runId]))[0];
  await executeRun(run);
  await executeRun(run);
  assert.equal((await q('SELECT status FROM runs WHERE id=?',[runId]))[0].status,'failed');
  assert.equal(await credits(),before);
 });

 await test('A verified late online payment fulfills a cancelled order only once',async()=>{
  const secret=crypto.randomBytes(24).toString('hex');
  await saveSettings({...originalSettings,payment:{...originalSettings.payment,epayEnabled:true,epayPid:'regression-merchant',epayKey:encrypt(secret)}});
  const orderId=`REG${stamp}`,before=await credits();
  temporaryOrders.push(orderId);
  await q("INSERT INTO orders (id,user_id,product_type,product_id,title,amount,payment_method,snapshot,status) VALUES (?,?,?,?,?,?,?,?,'cancelled')",[orderId,userId,'membership','pro','取消后付款回归',100,'epay',JSON.stringify({days:2,credits:17})]);
  const params={pid:'regression-merchant',trade_no:`REGTRADE${stamp}`,out_trade_no:orderId,type:'alipay',name:'取消后付款回归',money:'1.00',trade_status:'TRADE_SUCCESS'};
  params.sign=epaySign(params,secret);params.sign_type='MD5';
  for(let repeat=0;repeat<2;repeat++) {
   const response=await fetch(base+'/api/payments/notify?provider=epay&'+new URLSearchParams(params));
   assert.equal(response.status,200);
   assert.equal(await response.text(),'success');
  }
  assert.equal((await q('SELECT status FROM orders WHERE id=?',[orderId]))[0].status,'paid');
  assert.equal(await credits(),before+17);
  await saveSettings(originalSettings);
 });

 await test('Manual approval cannot revive a cancelled offline order',async()=>{
  const orderId=`REGMANUAL${stamp}`,before=await credits();
  temporaryOrders.push(orderId);
  await q("INSERT INTO orders (id,user_id,product_type,product_id,title,amount,payment_method,snapshot,status) VALUES (?,?,?,?,?,?,?,?,'cancelled')",[orderId,userId,'membership','pro','取消线下订单回归',100,'manual',JSON.stringify({days:2,credits:17})]);
  await admin({action:'admin.order.approve',id:orderId},400);
  assert.equal(await credits(),before);
 });

 await test('Plugins reject missing agents when configured, purchased and executed',async()=>{
  const pluginId=`reg-plugin-${stamp}`;
  temporaryEntities.push(['plugin',pluginId]);
  await admin({action:'admin.save',entity:'plugin',data:{id:pluginId,name:'回归插件',price:0,agentId:'missing-agent'}},400);
  assert.equal(await entity('plugin',pluginId),null);
  await admin({action:'admin.save',entity:'plugin',data:{id:pluginId,name:'回归插件',price:0,agentId:'study'}});
  await user({action:'plugin.install',pluginId});
  const plugin=await entity('plugin',pluginId);
  await putEntity('plugin',{...plugin,price:10,agentId:'missing-agent'});
  const before=await credits();
  await user({action:'plugin.run',pluginId,message:'不应调用模型'},503);
  await user({action:'order.create',type:'plugin',productId:pluginId,paymentMethod:'manual'},503);
  assert.equal(await credits(),before);
 });

 await test('APK manifest does not hide a current build or failed configuration',async()=>{
  for(const state of ['building','failed']) {
   await saveSettings({...originalSettings,apk:{...originalSettings.apk,versionName:'9.8.7',buildStatus:state}});
   const apk=(await user('?resource=bootstrap')).settings.apk;
   assert.equal(apk.buildStatus,state);
   assert.equal(apk.versionName,'9.8.7');
   assert(apk.downloadUrl.startsWith('/api/download?'));
  }
  await saveSettings({...originalSettings,apk:{...originalSettings.apk,buildStatus:'not_built'}});
  assert.equal((await user('?resource=bootstrap')).settings.apk.buildStatus,'ready');
  await saveSettings(originalSettings);
 });

 await test('Expired membership falls back to free without removing purchased credits',async()=>{
  const before=await credits();
  await q("UPDATE users SET plan_id='pro',plan_expires=DATE_SUB(NOW(),INTERVAL 1 DAY) WHERE id=?",[userId]);
  const account=(await user('?resource=bootstrap')).user;
  assert.equal(account.planId,'free');
  assert.equal(account.credits,before);
 });

 await test('Administrator membership edits persist expiry without double granting credits',async()=>{
  const before=await credits();
  await admin({action:'admin.save',entity:'user',data:{id:userId,planId:'pro',credits:before}});
  let account=(await user('?resource=bootstrap')).user;
  assert.equal(account.planId,'pro');
  assert(account.planExpires);
  assert.equal(account.credits,before);
  const expiration=new Date(Date.now()+10*86400000).toISOString();
  await admin({action:'admin.save',entity:'user',data:{id:userId,planId:'pro',planExpires:expiration,credits:before}});
  account=(await user('?resource=bootstrap')).user;
  const actual=new Date(account.planExpires.replace(' ','T')+'+08:00').getTime();
  assert(Math.abs(actual-Date.parse(expiration))<2000);
  await admin({action:'admin.save',entity:'user',data:{id:userId,planId:'free',credits:before}});
  account=(await user('?resource=bootstrap')).user;
  assert.equal(account.planId,'free');
  assert.equal(account.planExpires,null);
  assert.equal(account.credits,before);
 });

 await test('Agents can follow the default model and administrators can inspect runs',async()=>{
  const agentId=`reg-agent-${stamp}`;
  temporaryEntities.push(['agent',agentId]);
  await admin({action:'admin.save',entity:'agent',data:{id:agentId,name:'默认模型回归',modelId:'',systemPrompt:'测试配置，不调用模型'}});
  assert.equal((await entity('agent',agentId)).modelId,'');
  const data=await admin('?resource=admin');
  assert(data.runs.some(run=>run.userId===userId&&run.email));
  assert(data.audit.every(entry=>Object.hasOwn(entry,'userId')));
  const total=Number((await q('SELECT COUNT(*) AS count FROM users'))[0].count);
  assert.equal(data.stats.users,total);
 });

 await test('Record ranges and external course URLs reject invalid values',async()=>{
  for(const meta of [{amount:-1},{progress:101},{sleepHours:25},{waterMl:20001},{exerciseMinutes:1441},{dailyMinutes:-1},{url:'javascript:alert(1)'},{startTime:'25:00'},{endTime:'12:80'}]) {
   await user({action:'record.save',kind:'course',title:'字段校验回归',meta},400);
  }
  await user({action:'record.save',kind:'course',title:'有效课程回归',meta:{progress:50,dailyMinutes:30,url:'https://example.com/course',startTime:'09:00',endTime:'10:30'}});
  const expense=(await user({action:'record.save',kind:'expense',title:'金额分值回归',meta:{amount:12.345,direction:'expense'}})).record;
  assert.equal(expense.meta.amount,12.35);
  assert.equal(expense.meta.amountCents,1235);
 });

 await test('Model retries are bounded and never retry authentication failures',async()=>{
  const actualFetch=globalThis.fetch,model=(await entities('model'))[0];
  let requests=0;
  try {
   globalThis.fetch=async()=>{
    requests++;
    return requests===1?Response.json({error:'temporary'},{status:503}):Response.json({choices:[{message:{content:'回归测试本地模拟响应，无模型网络调用。'}}],usage:{total_tokens:1}});
   };
   await callModel({modelId:model.id,userId,kind:'regression',messages:[{role:'user',content:'test'}]});
   assert.equal(requests,2);
   requests=0;
   globalThis.fetch=async()=>{requests++;return Response.json({error:'unauthorized'},{status:401});};
   await assert.rejects(callModel({modelId:model.id,userId,kind:'regression',messages:[]}),/401/);
   assert.equal(requests,1);
   requests=0;
   globalThis.fetch=async()=>{requests++;return Response.json({error:'temporary'},{status:500});};
   await assert.rejects(callModel({modelId:model.id,userId,kind:'regression',messages:[]}),/500/);
   assert.equal(requests,2);
  } finally {
   globalThis.fetch=actualFetch;
  }
 });
} catch(error) {
 report.push({passed:false,error:error.stack});
 console.error(error);
 process.exitCode=1;
} finally {
 if(originalSettings)await saveSettings(originalSettings);
 for(const [type,key] of temporaryEntities)await q('DELETE FROM entities WHERE type=? AND id=?',[type,key]);
 if(userId) {
  for(const table of ['sessions','records','conversations','runs','orders','installs','usage_logs','audit'])await q(`DELETE FROM ${table} WHERE user_id=?`,[userId]);
  await q('DELETE FROM users WHERE id=?',[userId]);
 }
 for(const orderId of temporaryOrders)await q("DELETE FROM audit WHERE action='order.paid' AND JSON_UNQUOTE(JSON_EXTRACT(detail,'$.orderId'))=?",[orderId]);
 await q("DELETE FROM audit WHERE action='admin.save' AND JSON_UNQUOTE(JSON_EXTRACT(detail,'$.id')) LIKE ?",[`reg-%-${stamp}`]);
 await q("DELETE FROM audit WHERE action='admin.save' AND JSON_UNQUOTE(JSON_EXTRACT(detail,'$.id'))=?",[userId||'']);
 await pool.end();
 console.log(JSON.stringify({testedAt:new Date().toISOString(),passed:report.filter(test=>test.passed).length,failed:report.filter(test=>!test.passed).length,results:report},null,2));
}
