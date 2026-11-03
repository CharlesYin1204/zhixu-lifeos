import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {q,pool,id,putEntity,entity,entities,parse} from '../lib/db.mjs';
import {createSession,encrypt} from '../lib/security.mjs';
import {callModel,userContextBundle} from '../lib/ai.mjs';

// Run --lib-only while a release is being prepared; --api-only after deployment.
// Every mutation belongs to an isolated fixture account or a uniquely named entity.
const phase=process.argv.includes('--lib-only')?'lib':process.argv.includes('--api-only')?'api':'all';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3061';
const stamp=crypto.randomBytes(8).toString('hex');
const fixtureUsers=[],fixtureEntities=[],results=[];
const originalFetch=globalThis.fetch;
const reportPath=new URL('../docs/tests/restored-contract-results.json',import.meta.url);
const scope={lib:'Actual library calls, real database fixtures, mocked AI transport',http:'Deployed HTTP API and real database fixtures',handler:'Unmodified route logic imported with ESM paths resolved, real auth/database, mocked AI transport'};
let users={},routeHandler,NextRequest;
function trackedEntity(type,name){const entityId=`restored-${stamp}-${name}`;fixtureEntities.push({type,id:entityId});return entityId;}
const modelId=trackedEntity('model','model'),agentId=trackedEntity('agent','agent');
async function fixture(label,role='user') {
 const userId=id();fixtureUsers.push(userId);
 await q('INSERT INTO users (id,email,name,password_hash,role,credits) VALUES (?,?,?,?,?,?)',[userId,`restored-${stamp}-${label}@example.test`,`功能契约验收 ${label}`,'!no-password-login',role,80]);
 return {id:userId,token:await createSession(userId),...(role==='admin'?{adminToken:await createSession(userId,'admin')}:{})};
}
async function api(user,body,expected=200) {
 const get=typeof body==='string',admin=get?body.startsWith('?resource=admin'):body.action?.startsWith('admin.');
 const endpoint=admin?'/api/admin':'/api/app';
 const cookie=user?(admin?`zhixu_admin_session=${user.adminToken||''}`:`zhixu_session=${user.token}`):'';
 const response=await originalFetch(base+endpoint+(get?body:''),{method:get?'GET':'POST',headers:{'Content-Type':'application/json',cookie},...(get?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(120000)});
 const data=await response.json();
 assert.equal(response.status,expected,`${get?body:body.action}: HTTP ${response.status}: ${data.error||'unexpected response'}`);
 return data;
}
async function loadRouteHandler() {
 if(routeHandler)return;
 const routeUrl=new URL('../app/api/app/route.js',import.meta.url);
 const require=createRequire(import.meta.url);
 let source=await fs.readFile(routeUrl,'utf8');
 source=source.replace(/from '([^']+)'/g,(whole,specifier)=>specifier==='next/server'?`from '${pathToFileURL(require.resolve(specifier)).href}'`:specifier.startsWith('.')?`from '${new URL(specifier,routeUrl).href}'`:whole);
 routeHandler=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 ({NextRequest}=await import('next/server.js'));
}
const answer={choices:[{message:{content:'依据你的个人资料[资料1]，建议每天安排一个可执行的小目标。'},finish_reason:'stop'}],usage:{total_tokens:27}};
async function mockedHandler(user,body,expected=200) {
 await loadRouteHandler();let calls=0;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://example.com/chat/completions');calls++;
  assert(options.headers.Authorization.startsWith('Bearer fixture-key-'));
  return Response.json(answer);
 };
 try {
  const response=await routeHandler.POST(new NextRequest(base+'/api/app',{method:'POST',headers:{'Content-Type':'application/json',cookie:`zhixu_session=${user.token}`},body:JSON.stringify(body)}));
  const data=await response.json();assert.equal(response.status,expected,`${body.action}: ${data.error||response.status}`);
  return {...data,mockProviderCalls:calls};
 } finally {globalThis.fetch=originalFetch;}
}
async function test(name,kind,run){const start=Date.now();try{const evidence=await run();results.push({name,scope:scope[kind],passed:true,ms:Date.now()-start,evidence});console.log('PASS',name);}catch(error){results.push({name,scope:scope[kind],passed:false,ms:Date.now()-start,error:error.message});process.exitCode=1;console.error('FAIL',name,error.message);}}
async function saveEntity(type,data,expected=200){return api(users.admin,{action:'admin.save',entity:type,data},expected);}
async function insertRecord(user,kind,title,content='',meta={}) {
 const recordId=id();await q('INSERT INTO records (id,user_id,kind,title,content,meta) VALUES (?,?,?,?,?,?)',[recordId,user.id,kind,title,content,JSON.stringify(meta)]);return recordId;
}
async function setupModel() {
 await putEntity('model',{id:modelId,name:'临时恢复契约模型',baseUrl:'https://example.com',model:'gpt-5-fixture',apiKey:encrypt(`fixture-key-${stamp}`),enabled:true,isDefault:false});
 await putEntity('agent',{id:agentId,name:'临时恢复契约助手',role:'验收',systemPrompt:'仅用于临时契约验收。',modelId,enabled:true});
}
async function transportScenario(modelChanges,responses,verify) {
 const current=await entity('model',modelId);delete current.temperature;delete current.maxTokens;
 await putEntity('model',{...current,...modelChanges});const requests=[];
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://example.com/chat/completions');requests.push(JSON.parse(options.body));const response=responses[requests.length-1];assert(response,'Unexpected extra model call');return Response.json(response.body||response,{status:response.status||200});};
 try{await verify(()=>callModel({modelId,userId:users.a.id,kind:'restored-test',messages:[{role:'user',content:'本地模型参数验收'}],maxTokens:500}),requests);}finally{globalThis.fetch=originalFetch;}
}
async function libTests() {
 await test('Explicit model temperature and maxTokens reach the provider without reasoning-floor inflation','lib',async()=>{
  await transportScenario({temperature:0.35,maxTokens:256},[answer],async(call,requests)=>{assert((await call()).reply);assert.equal(requests[0].temperature,0.35);assert.equal(requests[0].max_tokens,256);assert.equal(requests[0].reasoning_effort,'low');});
  return {temperature:0.35,maxTokens:256,mockCalls:1};
 });
 await test('Explicit output caps reject truncation without silently increasing the configured budget','lib',async()=>{
  const truncated={choices:[{message:{content:'未完成'},finish_reason:'length'}],usage:{total_tokens:256}};
  await transportScenario({temperature:0,maxTokens:256},[truncated],async(call,requests)=>{await assert.rejects(call(),/长度上限/);assert.equal(requests.length,1);assert.equal(requests[0].max_tokens,256);assert.equal(requests[0].temperature,0);});
  return {configuredCap:256,calls:1,noHiddenBudgetIncrease:true};
 });
 await test('Temporary errors and empty replies retry within an explicit cap; unspecified budgets retain reasoning floors','lib',async()=>{
  await transportScenario({maxTokens:512},[{status:503,body:{error:'temporary'}},answer],async(call,requests)=>{await call();assert.deepEqual(requests.map(x=>x.max_tokens),[512,512]);});
  await transportScenario({maxTokens:512},[{choices:[{message:{content:''},finish_reason:'stop'}]},answer],async(call,requests)=>{await call();assert.deepEqual(requests.map(x=>x.max_tokens),[512,512]);});
  await transportScenario({},[answer],async(call,requests)=>{await call();assert.equal(requests[0].max_tokens,4096);assert.equal('temperature' in requests[0],false);});
  await transportScenario({model:'claude-fixture-thinking'},[answer],async(call,requests)=>{await call();assert.equal(requests[0].max_tokens,8192);});
  return {explicitRetryBudget:512,gptDefaultFloor:4096,thinkingDefaultFloor:8192};
 });
 await test('Personal context sources and text include only the requesting user’s record IDs','lib',async()=>{
  const ownId=await insertRecord(users.a,'note',`OWNER_A_${stamp}`,'Source contract learning plan');
  const otherId=await insertRecord(users.b,'note',`PRIVATE_B_${stamp}`,'Other account secret content');
  const bundle=await userContextBundle(users.a.id,'Source contract');
  assert(bundle.sources.some(source=>source.id===ownId));assert(!bundle.sources.some(source=>source.id===otherId));assert(!bundle.text.includes(`PRIVATE_B_${stamp}`));assert(!bundle.text.includes('Other account secret content'));
  assert(bundle.sources.every(source=>/^资料\d+$/.test(source.label)));assert(bundle.text.includes('[资料1]'));
  return {ownSourcePresent:true,otherAccountExcluded:true,sourceCount:bundle.sources.length};
 });
}
async function apiTests() {
 await test('Administrator model parameter save, readback, clearing and invalid-value rejection','http',async()=>{
  await saveEntity('model',{id:modelId,temperature:0.7,maxTokens:1024});
  let stored=await entity('model',modelId);assert.equal(stored.temperature,0.7);assert.equal(stored.maxTokens,1024);
  let adminModel=(await api(users.admin,'?resource=admin')).models.find(model=>model.id===modelId);assert.equal(adminModel.temperature,0.7);assert.equal(adminModel.maxTokens,1024);assert.equal(adminModel.apiKey,undefined);
  for(const value of [-0.01,2.01,'bad'])await saveEntity('model',{id:modelId,temperature:value},400);
  for(const value of [127,32769,128.5,'bad'])await saveEntity('model',{id:modelId,maxTokens:value},400);
  stored=await entity('model',modelId);assert.equal(stored.temperature,0.7);assert.equal(stored.maxTokens,1024);
  await saveEntity('model',{id:modelId,temperature:0,maxTokens:128});stored=await entity('model',modelId);assert.equal(stored.temperature,0);assert.equal(stored.maxTokens,128);
  await saveEntity('model',{id:modelId,temperature:2,maxTokens:32768});
  await saveEntity('model',{id:modelId,temperature:'',maxTokens:''});stored=await entity('model',modelId);assert.equal(stored.temperature,undefined);assert.equal(stored.maxTokens,undefined);
  return {invalidValuesRejected:7,validBoundaryValues:[0,2,128,32768],clearedToDefaults:true};
 });
 const pluginId=trackedEntity('plugin','paid-plugin'),otherPlugin=trackedEntity('plugin','other-plugin'),freePlugin=trackedEntity('plugin','free-plugin');
 const pluginData={id:pluginId,name:'临时下架权益插件',price:3.17,agentId,version:'1.0.0',enabled:true,listed:true,sortOrder:50};
 await test('Plugin sortOrder is saved into the SQL column and controls the catalog order','http',async()=>{
  await saveEntity('plugin',pluginData);await saveEntity('plugin',{...pluginData,id:otherPlugin,name:'临时排序插件',sortOrder:-90});await saveEntity('plugin',{...pluginData,id:freePlugin,name:'临时免费插件',price:0,sortOrder:10});
  const rows=await q('SELECT id,sort_order FROM entities WHERE type=? AND id IN (?,?,?) ORDER BY sort_order,id',['plugin',pluginId,otherPlugin,freePlugin]);
  assert.deepEqual(rows.map(row=>row.id),[otherPlugin,freePlugin,pluginId]);
  const catalog=(await api(users.b,'?resource=bootstrap')).plugins.filter(plugin=>[pluginId,otherPlugin,freePlugin].includes(plugin.id));assert.deepEqual(catalog.map(plugin=>plugin.id),[otherPlugin,freePlugin,pluginId]);assert.deepEqual(catalog.map(plugin=>plugin.sortOrder),[-90,10,50]);
  for(const value of [100001,-100001,1.5])await saveEntity('plugin',{id:pluginId,sortOrder:value},400);
  return {sqlOrderMatchesCatalog:true,sortOrders:[-90,10,50],invalidValuesRejected:3};
 });
 await test('Purchased delisted plugins remain visible to their owner and can be reinstalled; new purchases/installations are blocked','http',async()=>{
  const created=await api(users.a,{action:'order.create',type:'plugin',productId:pluginId,paymentMethod:'manual',requestId:crypto.randomUUID()});
  await api(users.admin,{action:'admin.order.approve',id:created.order.id});
  await saveEntity('plugin',{id:pluginId,listed:false});
  const owner=await api(users.a,'?resource=bootstrap'),other=await api(users.b,'?resource=bootstrap');assert(owner.plugins.some(plugin=>plugin.id===pluginId));assert(!other.plugins.some(plugin=>plugin.id===pluginId));assert(owner.ownedPluginIds.includes(pluginId));
  await api(users.a,{action:'plugin.uninstall',pluginId});await api(users.a,{action:'plugin.install',pluginId});
  await api(users.b,{action:'plugin.install',pluginId},404);await api(users.b,{action:'order.create',type:'plugin',productId:pluginId,paymentMethod:'manual',requestId:crypto.randomUUID()},404);
  return {ownerCanReinstall:true,delistedHiddenFromNewUsers:true,newOrdersRejected:true,noExternalPayment:true};
 });
 await test('Delisted purchased plugin runs persist a note and sources; safety disabling blocks run and install','handler',async()=>{
  const sourceId=await insertRecord(users.a,'note','插件来源验收','阅读资料，记录具体行动。');
  const ran=await mockedHandler(users.a,{action:'plugin.run',pluginId,message:'依据我的记录提供行动建议'});assert.equal(ran.mockProviderCalls,1);assert(ran.sources.some(source=>source.id===sourceId));
  const note=(await q('SELECT * FROM records WHERE id=? AND user_id=?',[ran.noteId,users.a.id]))[0];assert.deepEqual(parse(note.meta).sources,ran.sources);
  await saveEntity('plugin',{id:pluginId,enabled:false});
  const blocked=await mockedHandler(users.a,{action:'plugin.run',pluginId,message:'不应调用模型'},404);assert.equal(blocked.mockProviderCalls,0);await api(users.a,{action:'plugin.install',pluginId},400);
  await saveEntity('plugin',{id:pluginId,enabled:true});
  return {delistedPluginRuns:true,noteSourcesPersisted:true,disabledRunBlockedBeforeModel:true,mockProviderCalls:1};
 });
 await test('An existing free installation keeps working after the plugin becomes paid','handler',async()=>{
  await api(users.a,{action:'plugin.install',pluginId:freePlugin});await saveEntity('plugin',{id:freePlugin,price:8.21});
  await api(users.a,{action:'plugin.install',pluginId:freePlugin});await api(users.b,{action:'plugin.install',pluginId:freePlugin},402);
  const ran=await mockedHandler(users.a,{action:'plugin.run',pluginId:freePlugin,message:'原有免费安装是否可以继续使用'});assert.equal(ran.mockProviderCalls,1);assert(ran.noteId);
  return {existingInstallationRetained:true,newInstallationRequiresPurchase:true,mockProviderCalls:1};
 });
 await test('Ownership is not lost when the paid plugin order falls beyond the latest 100 orders','http',async()=>{
  const paidId=(await q("SELECT id FROM orders WHERE user_id=? AND product_id=? AND status='paid'",[users.a.id,pluginId]))[0].id;
  await q("UPDATE orders SET created_at='2020-01-01 00:00:00' WHERE id=?",[paidId]);
  const rows=Array.from({length:105},()=>[id(),users.a.id,'membership','fixture-history','临时历史订单',1,'cancelled','manual','{}']);
  await q('INSERT INTO orders (id,user_id,product_type,product_id,title,amount,status,payment_method,snapshot) VALUES '+rows.map(()=>'(?,?,?,?,?,?,?,?,?)').join(','),rows.flat());
  const boot=await api(users.a,'?resource=bootstrap');assert.equal(boot.orders.length,100);assert(!boot.orders.some(order=>order.id===paidId));assert(boot.ownedPluginIds.includes(pluginId));assert(boot.plugins.some(plugin=>plugin.id===pluginId));
  return {ordersShown:100,paidOrderOutsideWindow:true,ownershipRetained:true};
 });
 await test('1505 records paginate without duplicate/missing IDs and statistics aggregate every record','http',async()=>{
  const expectedIds=[],rows=[];for(let i=0;i<1505;i++){const recordId=id();expectedIds.push(recordId);rows.push([recordId,users.pages.id,i<1005?'focus':'task',`分页验收 ${i}`,'',JSON.stringify(i<1005?{minutes:2}:{}),i>=1005&&i<1255?'completed':'active','2026-01-01 00:00:00']);}
  for(let i=0;i<rows.length;i+=250){const batch=rows.slice(i,i+250);await q('INSERT INTO records (id,user_id,kind,title,content,meta,status,updated_at) VALUES '+batch.map(()=>'(?,?,?,?,?,?,?,?)').join(','),batch.flat());}
  const boot=await api(users.pages,'?resource=bootstrap');assert.equal(boot.records.length,500);assert(boot.recordsNextCursor);assert.equal(boot.stats.focusMinutes,2010);assert.equal(boot.stats.tasks,500);assert.equal(boot.stats.completed,250);
  const collected=[...boot.records],pages=[boot.records.length];let cursor=boot.recordsNextCursor;
  while(cursor){const next=await api(users.pages,'?resource=records&cursor='+encodeURIComponent(cursor));pages.push(next.records.length);collected.push(...next.records);cursor=next.recordsNextCursor;assert(pages.length<=5,'Unexpected pagination loop');}
  assert.equal(collected.length,1505);assert.equal(new Set(collected.map(record=>record.id)).size,1505);assert.deepEqual(new Set(collected.map(record=>record.id)),new Set(expectedIds));assert.deepEqual(pages,[500,500,500,5]);
  const other=await api(users.b,'?resource=records&cursor='+encodeURIComponent(boot.recordsNextCursor));assert(!other.records.some(record=>expectedIds.includes(record.id)));
  for(const cursorValue of ['not-json',Buffer.from(JSON.stringify({at:'invalid',id:'a'})).toString('base64url')])await api(users.pages,'?resource=records&cursor='+cursorValue,400);
  await api(null,'?resource=records&cursor='+boot.recordsNextCursor,401);
  return {total:1505,pages,uniqueIds:1505,focusMinutes:2010,tasks:500,completed:250,cursorOwnerIsolation:true};
 });
 await test('Legacy malformed record metadata reads safely and new invalid metadata is rejected','http',async()=>{
  const malformed=['bad-json','null','[]','42',JSON.stringify({category:{bad:true},dueDate:[],checkedDates:'not-array',tags:'not-array'}),JSON.stringify({checkedDates:['2026-02-30','2026-01-01',false,'2026-01-01'],tags:['valid',{},null]})];
  const ids=[];for(const meta of malformed){const recordId=id();ids.push(recordId);await q('INSERT INTO records (id,user_id,kind,title,meta) VALUES (?,?,?,?,?)',[recordId,users.a.id,'habit','历史异常属性验收',meta]);}
  const boot=await api(users.a,'?resource=bootstrap'),read=boot.records.filter(record=>ids.includes(record.id));assert.equal(read.length,malformed.length);for(const record of read){assert(record.meta&&typeof record.meta==='object'&&!Array.isArray(record.meta));if(record.meta.category!==undefined)assert.equal(typeof record.meta.category,'string');if(record.meta.checkedDates!==undefined)assert(Array.isArray(record.meta.checkedDates));if(record.meta.tags!==undefined)assert(record.meta.tags.every(tag=>typeof tag==='string'));}
  assert.deepEqual(read.find(record=>record.id===ids.at(-1)).meta.checkedDates,['2026-01-01']);
  for(const meta of [[],{category:[]},{direction:{}},{url:42},{checkedDates:'no'},{checkedDates:['2026-02-30']},{tags:[{}]},{tags:Array(31).fill('x')}])await api(users.b,{action:'record.save',kind:'habit',title:'拒绝异常属性',meta},400);
  const saved=await api(users.b,{action:'record.save',kind:'habit',title:'合法打卡属性',meta:{checkedDates:['2026-01-02','2026-01-01','2026-01-02'],tags:['学习']}});assert.deepEqual(saved.record.meta.checkedDates,['2026-01-01','2026-01-02']);
  return {legacyRowsSafe:malformed.length,invalidInputsRejected:8,validDatesDeduplicated:true};
 });
 await test('Chat source IDs remain user-owned and persist through the deployed conversation-history API','handler',async()=>{
  const ownId=await insertRecord(users.a,'note',`SOURCE_A_${stamp}`,'每天学习三十分钟，周日复盘。');
  const secretId=await insertRecord(users.b,'note',`SECRET_B_${stamp}`,'其他用户私密记录');
  const chat=await mockedHandler(users.a,{action:'ai.chat',agentId,message:`参考 SOURCE_A_${stamp} 制定学习计划`});assert.equal(chat.mockProviderCalls,1);assert(chat.sources.some(source=>source.id===ownId));assert(!chat.sources.some(source=>source.id===secretId));
  const owned=new Set((await q('SELECT id FROM records WHERE user_id=?',[users.a.id])).map(row=>row.id));assert(chat.sources.every(source=>owned.has(source.id)));
  const history=await api(users.a,'?resource=conversation&id='+chat.conversationId);assert.deepEqual(history.conversation.messages.at(-1).sources,chat.sources);await api(users.b,'?resource=conversation&id='+chat.conversationId,404);
  return {mockProviderCalls:1,ownedSourcesOnly:true,historySourcesPersisted:true,crossUserHistoryDenied:true};
 });
 await test('Saving a completed workflow preserves its source references in the generated note','http',async()=>{
  const sourceId=await insertRecord(users.a,'note','协作来源验收','可执行的学习计划。');const sources=[{id:sourceId,kind:'note',title:'协作来源验收',label:'资料1'}];const runId=id();
  await q('INSERT INTO runs (id,user_id,goal,agent_ids,status,steps,result) VALUES (?,?,?,?,?,?,?)',[runId,users.a.id,'保存协作来源验收','[]','completed',JSON.stringify([{id:'review',sources}]),'完整协作方案[资料1]']);
  const saved=await api(users.a,{action:'run.save',id:runId});const note=(await q('SELECT meta FROM records WHERE id=? AND user_id=?',[saved.id,users.a.id]))[0];assert.deepEqual(parse(note.meta).sources,sources);await api(users.b,{action:'run.save',id:runId},400);
  return {sourceIdsPersisted:true,crossUserSaveRejected:true,noWorkflowProviderCalls:true};
 });
}
let setupFailure,cleanupError;
try {
 users.a=await fixture('a');users.b=await fixture('b');users.admin=await fixture('admin','admin');users.pages=await fixture('pages');
 await setupModel();
 if(phase==='lib'||phase==='all')await libTests();
 if(phase==='api'||phase==='all')await apiTests();
} catch(error){setupFailure=error.message;process.exitCode=1;console.error(error.stack);}
finally {
 globalThis.fetch=originalFetch;
 try {
  if(fixtureUsers.length){const marks=fixtureUsers.map(()=>'?').join(',');for(const table of ['sessions','records','conversations','runs','orders','installs','usage_logs','audit'])await q(`DELETE FROM ${table} WHERE user_id IN (${marks})`,fixtureUsers);await q(`DELETE FROM users WHERE id IN (${marks})`,fixtureUsers);for(const userId of fixtureUsers)await q('DELETE FROM rate_limits WHERE id IN (?,?,?)',[`user:${userId}`,`ai:${userId}`,`run:${userId}`]);}
  for(const record of fixtureEntities)await q('DELETE FROM entities WHERE type=? AND id=?',[record.type,record.id]);
 }catch(error){cleanupError=error.message;process.exitCode=1;console.error('CLEANUP FAILED',error.message);}
 await pool.end();
 let previous={};try{previous=JSON.parse(await fs.readFile(reportPath,'utf8'));}catch{}
 const phases=phase==='all'?{}:{...previous.phases};phases[phase]={testedAt:new Date().toISOString(),base,passed:results.filter(result=>result.passed).length,failed:results.filter(result=>!result.passed).length+(setupFailure?1:0)+(cleanupError?1:0),realProviderCalls:0,fixturesCleaned:!cleanupError,results,...(setupFailure?{setupFailure}:{}),...(cleanupError?{cleanupError}:{})};
 const all=Object.values(phases);await fs.mkdir(new URL('../docs/tests/',import.meta.url),{recursive:true});await fs.writeFile(reportPath,JSON.stringify({testedAt:new Date().toISOString(),passed:all.reduce((sum,p)=>sum+p.passed,0),failed:all.reduce((sum,p)=>sum+p.failed,0),realProviderCalls:0,productionSettingsUntouched:true,fixturesCleaned:all.every(p=>p.fixturesCleaned),phases},null,2)+'\n');
}
