import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {q,pool,id,parse,entity} from '../lib/db.mjs';
import {hashPassword,createSession} from '../lib/security.mjs';

// Run after the production build containing the record contracts has been deployed.
// Only isolated test accounts/records are changed. No AI, payment, settings or worker calls.
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3060';
const stamp=crypto.randomUUID(),fixtures=[],results=[],password=crypto.randomBytes(24).toString('base64url');
const report={startedAt:new Date().toISOString(),base,scope:'Live HTTP record contracts, isolated fixture users, zero AI calls',results};
let a,b,admin;

function client(token,scope='user') {
 let cookie=`${scope==='admin'?'zhixu_admin_session':'zhixu_session'}=${token}`;
 const endpoint=scope==='admin'?'/api/admin':'/api/app';
 return async function request(body,expected=200) {
  const get=typeof body==='string';
  const response=await fetch(base+endpoint+(get?body:''),{method:get?'GET':'POST',headers:{'Content-Type':'application/json',cookie},...(get?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  const updated=response.headers.get('set-cookie');if(updated)cookie=updated.split(';')[0];
  const data=await response.json();
  assert.equal(response.status,expected,`${get?body:body.action}: expected HTTP ${expected}, got ${response.status}; ${data.error||'unexpected response'}`);
  return data;
 };
}
async function createFixture(label,role='user') {
 const userId=id(),email=`record-contract-${stamp}-${label}@example.test`;
 await q('INSERT INTO users (id,email,name,password_hash,role) VALUES (?,?,?,?,?)',[userId,email,`记录契约验收 ${label}`,await hashPassword(password),role]);
 const fixture={id:userId,email,role};fixtures.push(fixture);
 const scope=role==='admin'?'admin':'user';
 return {...fixture,request:client(await createSession(userId,scope),scope)};
}
async function test(name,fn) {
 const started=Date.now();
 try{const evidence=await fn();results.push({name,passed:true,ms:Date.now()-started,...(evidence?{evidence}:{})});console.log('PASS',name);}
 catch(error){results.push({name,passed:false,ms:Date.now()-started,error:error.message});process.exitCode=1;console.error('FAIL',name,error.message);}
}
const recordCount=async(userId,kind)=>Number((await q('SELECT COUNT(*) AS count FROM records WHERE user_id=? AND kind=?',[userId,kind]))[0].count);
const row=async recordId=>(await q('SELECT * FROM records WHERE id=?',[recordId]))[0];
const save=(fixture,kind,title,meta={},extra={})=>fixture.request({action:'record.save',kind,title,meta,...extra});

try {
 const created=await Promise.allSettled([createFixture('a'),createFixture('b'),createFixture('admin','admin')]);
 assert(created.every(result=>result.status==='fulfilled'),'Fixture account creation failed');
 [a,b,admin]=created.map(result=>result.value);
 await test('Goal links accept only an owned goal, for both creation and update',async()=>{
  const goalA=(await save(a,'goal','A 的学习目标',{progress:0})).record;
  const goalB=(await save(b,'goal','B 的学习目标',{progress:0})).record;
  const note=(await save(a,'note','目标类型校验')).record;
  const before=await recordCount(b.id,'course');
  await b.request({action:'record.save',kind:'course',title:'跨用户目标拒绝',meta:{goalId:goalA.id}},400);
  await a.request({action:'record.save',kind:'course',title:'错误目标类型拒绝',meta:{goalId:note.id}},400);
  await a.request({action:'record.save',kind:'course',title:'不存在目标拒绝',meta:{goalId:id()}},400);
  assert.equal(await recordCount(b.id,'course'),before);
  const own=(await save(a,'course','合法目标课程',{goalId:goalA.id,progress:10})).record;
  assert.equal(own.meta.goalId,goalA.id);assert.equal(parse((await row(own.id)).meta).goalId,goalA.id);
  await a.request({action:'record.save',id:own.id,meta:{goalId:goalB.id,progress:10}},400);
  assert.equal(parse((await row(own.id)).meta).goalId,goalA.id);
  return {crossUserCreateRejected:true,crossUserUpdateRejected:true,validLinkPersisted:true};
 });

 await test('Events reject reversed or equal times and invalid calendar dates',async()=>{
  const before=await recordCount(a.id,'event');
  for(const meta of [{startTime:'18:00',endTime:'17:59'},{startTime:'18:00',endTime:'18:00'},{dueDate:'2026-02-30'},{dueDate:'2026-13-01'},{startDate:'2026-02-29'},{endDate:'not-a-date'},{dueDate:'2026-1-01'}]){
   await a.request({action:'record.save',kind:'event',title:'非法日程拒绝',meta},400);
  }
  assert.equal(await recordCount(a.id,'event'),before);
  const valid=(await save(a,'event','合法闰日日程',{dueDate:'2028-02-29',startTime:'18:00',endTime:'18:01'})).record;
  assert.equal(valid.meta.dueDate,'2028-02-29');assert.equal(valid.meta.endTime,'18:01');
  await a.request({action:'record.save',id:valid.id,meta:{dueDate:'2028-02-30',startTime:'18:00',endTime:'18:01'}},400);
  assert.equal(parse((await row(valid.id)).meta).dueDate,'2028-02-29');
  const overnight=(await save(a,'event','跨日活动',{dueDate:'2026-10-14',endDate:'2026-10-15',startTime:'23:30',endTime:'00:30'})).record;
  assert.equal(overnight.meta.endDate,'2026-10-15');assert.equal(overnight.meta.endTime,'00:30');
  assert.equal(parse((await row(overnight.id)).meta).dueDate,'2026-10-14');
  await a.request({action:'record.save',kind:'event',title:'倒置跨日活动',meta:{dueDate:'2026-10-15',endDate:'2026-10-14',startTime:'23:30',endTime:'00:30'}},400);
  return {invalidCases:9,validLeapDayAccepted:true,overnightEventAccepted:true};
 });

 await test('Goal end dates cannot precede their start dates',async()=>{
  await a.request({action:'record.save',kind:'goal',title:'目标日期倒置',meta:{startDate:'2026-10-15',endDate:'2026-10-14'}},400);
  const same=(await save(a,'goal','同日目标',{startDate:'2026-10-14',endDate:'2026-10-14'})).record;
  assert.equal(same.meta.startDate,same.meta.endDate);
 });

 for(const kind of ['goal','course'])await test(`${kind} completion status and 100% progress stay synchronized`,async()=>{
  const byStatus=(await save(a,kind,`${kind} 完成状态`,{progress:27},{status:'completed'})).record;
  assert.equal(byStatus.status,'completed');assert.equal(byStatus.meta.progress,100);
  const byProgress=(await save(a,kind,`${kind} 完成进度`,{progress:100},{status:'active'})).record;
  assert.equal(byProgress.status,'completed');assert.equal(Number(byProgress.meta.progress),100);
  const updated=(await save(a,kind,`${kind} 待完成`,{progress:40})).record;
  const marked=(await a.request({action:'record.save',id:updated.id,status:'completed'})).record;
  assert.equal(marked.status,'completed');assert.equal(marked.meta.progress,100);
  const throughProgress=(await save(a,kind,`${kind} 进度更新`,{progress:30})).record;
  const reached=(await a.request({action:'record.save',id:throughProgress.id,meta:{progress:100}})).record;
  assert.equal(reached.status,'completed');assert.equal(parse((await row(reached.id)).meta).progress,100);
  return {createByStatus:true,createByProgress:true,updateByStatus:true,updateByProgress:true};
 });

 await test('Expense amounts reject zero and sub-cent values while preserving one cent',async()=>{
  const before=await recordCount(a.id,'expense');
  for(const amount of [0,0.001])await a.request({action:'record.save',kind:'expense',title:'小额校验',meta:{amount,direction:'expense'}},400);
  assert.equal(await recordCount(a.id,'expense'),before);
  const expense=(await save(a,'expense','一分钱记账',{amount:0.01,direction:'expense'})).record;
  assert.equal(expense.meta.amount,0.01);assert.equal(expense.meta.amountCents,1);
  await a.request({action:'record.save',id:expense.id,meta:{amount:0}},400);
  assert.equal(parse((await row(expense.id)).meta).amountCents,1);
  return {rejected:[0,0.001],acceptedAmount:0.01,storedCents:1};
 });

 await test('Habit frequency accepts the 1–7 day boundaries and rejects invalid counts',async()=>{
  const before=await recordCount(a.id,'habit');
  for(const frequency of [0,8,-1,1.5,'invalid'])await a.request({action:'record.save',kind:'habit',title:'频率边界拒绝',meta:{frequency}},400);
  assert.equal(await recordCount(a.id,'habit'),before);
  for(const frequency of [1,7]){const record=(await save(a,'habit',`每周 ${frequency} 天`,{frequency})).record;assert.equal(record.meta.frequency,frequency);}
  return {accepted:[1,7],rejected:[0,8,-1,1.5,'invalid']};
 });

 await test('Concurrent focus retries persist one record and one duration per user',async()=>{
  const requestId=`focus_${stamp.replaceAll('-','')}`,minutes=25;
  const beforeA=(await a.request('?resource=bootstrap')).stats.focusMinutes,beforeB=(await b.request('?resource=bootstrap')).stats.focusMinutes;
  const initialA=await recordCount(a.id,'focus'),initialB=await recordCount(b.id,'focus');
  const payload={action:'record.save',kind:'focus',title:'并发专注验收',requestId,meta:{minutes}};
  const savedA=await Promise.all(Array.from({length:3},()=>a.request(payload)));
  assert.equal(new Set(savedA.map(result=>result.record.id)).size,1);assert.equal(await recordCount(a.id,'focus'),initialA+1);
  assert.equal((await a.request('?resource=bootstrap')).stats.focusMinutes,beforeA+minutes);
  const savedB=await Promise.all(Array.from({length:3},()=>b.request(payload)));
  assert.equal(new Set(savedB.map(result=>result.record.id)).size,1);assert.notEqual(savedA[0].record.id,savedB[0].record.id);assert.equal(await recordCount(b.id,'focus'),initialB+1);
  assert.equal((await b.request('?resource=bootstrap')).stats.focusMinutes,beforeB+minutes);
  await a.request(payload);assert.equal(await recordCount(a.id,'focus'),initialA+1);assert.equal((await a.request('?resource=bootstrap')).stats.focusMinutes,beforeA+minutes);
  return {parallelRequestsPerUser:3,recordsAddedPerUser:1,minutesAddedPerUser:minutes,replayedRequestAddedMinutes:0,usersHaveDistinctRecordIds:true};
 });

 await test('Administrator account disabling blocks existing sessions and restoring access works',async()=>{
  const before=await recordCount(b.id,'note');
  await admin.request({action:'admin.save',entity:'user',data:{id:b.id,status:'disabled'}});
  try {
   assert.equal((await b.request('?resource=bootstrap')).user,null);
   await b.request('?resource=export',401);
   await b.request({action:'record.save',kind:'note',title:'停用账户不得新增',meta:{}},401);
   await b.request({action:'profile.update',name:'不应生效'},401);
   await client('')({action:'auth.login',email:b.email,password},403);
   assert.equal(await recordCount(b.id,'note'),before);
   assert.equal(Number((await q('SELECT COUNT(*) AS count FROM sessions WHERE user_id=?',[b.id]))[0].count),0);
  } finally {await admin.request({action:'admin.save',entity:'user',data:{id:b.id,status:'active'}});}
  assert.equal((await b.request('?resource=bootstrap')).user,null,'Restoring an account must not revive revoked sessions');
  await b.request({action:'auth.login',email:b.email,password});
  assert.equal((await b.request('?resource=bootstrap')).user.id,b.id);
  await save(b,'note','恢复账户可新增');assert.equal(await recordCount(b.id,'note'),before+1);
  return {disabledExistingSessionDenied:true,disabledLoginDenied:true,oldSessionRevoked:true,restoredLoginWorks:true};
 });

 await test('A disabled administrator session cannot read administration or update users',async()=>{
  const before=Number((await q('SELECT credits FROM users WHERE id=?',[a.id]))[0].credits);
  // Disable only this isolated fixture administrator, never the production owner.
  await q("UPDATE users SET status='disabled' WHERE id=?",[admin.id]);
  try {
   await admin.request('?resource=admin',401);
   await admin.request({action:'admin.save',entity:'user',data:{id:a.id,credits:before+1}},401);
   assert.equal(Number((await q('SELECT credits FROM users WHERE id=?',[a.id]))[0].credits),before);
  } finally {await q("UPDATE users SET status='active' WHERE id=?",[admin.id]);}
  const restored=await admin.request('?resource=admin');assert(restored.users.some(user=>user.id===admin.id));
  return {disabledAdminReadDenied:true,disabledAdminWriteDenied:true,restoredAdminWorks:true};
 });

 await test('Credits can be edited on an expired membership when its existing expiry is unchanged',async()=>{
  assert(await entity('plan','pro'),'The configured pro membership is required for this fixture');
  await q("UPDATE users SET plan_id='pro',plan_expires=DATE_SUB(NOW(),INTERVAL 2 DAY) WHERE id=?",[a.id]);
  const before=(await q('SELECT credits,plan_expires FROM users WHERE id=?',[a.id]))[0],newCredits=Number(before.credits)+17;
  // Do not bootstrap as the target user here: that intentionally expires its membership.
  await admin.request({action:'admin.save',entity:'user',data:{id:a.id,planId:'pro',planExpires:before.plan_expires,credits:newCredits}});
  const after=(await q('SELECT credits,plan_id,plan_expires FROM users WHERE id=?',[a.id]))[0];
  assert.equal(Number(after.credits),newCredits);assert.equal(after.plan_id,'pro');assert.equal(after.plan_expires,before.plan_expires);
  return {creditsChanged:true,expiredDatePreserved:true,noExtraMembershipCredits:true};
 });

 const placeholders=fixtures.map(()=>'?').join(','),fixtureIds=fixtures.map(user=>user.id);
 const aiUsage=Number((await q(`SELECT COUNT(*) AS count FROM usage_logs WHERE user_id IN (${placeholders})`,fixtureIds))[0].count);
 assert.equal(aiUsage,0,'Record contract tests must not invoke AI');report.aiProviderCalls=0;
} catch(error) {
 results.push({name:'Fixture setup or suite verification',passed:false,error:error.message});process.exitCode=1;console.error(error.message);
} finally {
 const cleanup=[];
 for(const fixture of fixtures) {
  try {
   for(const table of ['sessions','records','conversations','runs','orders','installs','usage_logs','audit'])await q(`DELETE FROM ${table} WHERE user_id=?`,[fixture.id]);
   await q('DELETE FROM rate_limits WHERE id IN (?,?,?,?)',[`auth:${fixture.email}`,`user:${fixture.id}`,`ai:${fixture.id}`,`run:${fixture.id}`]);
   await q('DELETE FROM users WHERE id=?',[fixture.id]);
   const remaining=Number((await q('SELECT COUNT(*) AS count FROM users WHERE id=?',[fixture.id]))[0].count);
   cleanup.push({id:fixture.id,removed:remaining===0});
  } catch(error){cleanup.push({id:fixture.id,removed:false,error:error.message});process.exitCode=1;}
 }
 report.cleanup=cleanup;report.passed=results.length>0&&results.every(result=>result.passed)&&cleanup.every(item=>item.removed);report.finishedAt=new Date().toISOString();
 await mkdir('docs/tests',{recursive:true});await writeFile('docs/tests/record-contract-results.json',JSON.stringify(report,null,2)+'\n');await pool.end();
 console.log(JSON.stringify({passed:report.passed,passedChecks:results.filter(result=>result.passed).length,totalChecks:results.length,fixtureUsersRemoved:cleanup.filter(item=>item.removed).length,evidence:'docs/tests/record-contract-results.json'}));
}
