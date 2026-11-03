import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

// Real MySQL transactions and indexes, isolated tables; no production users or settings.
const prefix=`ordqa_${crypto.randomBytes(6).toString('hex')}_`;
const tables=['users','entities','settings','orders','order_requests','installs','audit'];
const rewrite=sql=>sql.replace(/\b(users|entities|settings|orders|order_requests|installs|audit)\b/g,name=>prefix+name);
const underlying=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:6,charset:'utf8mb4',timezone:'+08:00',dateStrings:true});
const created=[];
globalThis.__zhixuPool={
 execute:(sql,params)=>underlying.execute(rewrite(sql),params),
 async getConnection(){
  const conn=await underlying.getConnection();
  return {
   execute:(sql,params)=>conn.execute(rewrite(sql),params),
   beginTransaction:()=>conn.beginTransaction(),commit:()=>conn.commit(),rollback:()=>conn.rollback(),release:()=>conn.release(),
  };
 },
 end:()=>underlying.end(),
};
const {q,putEntity,saveSettings}=await import('../lib/db.mjs');
const {encrypt}=await import('../lib/security.mjs');
const {createOrder,fulfill,epaySign}=await import('../lib/payments.mjs');
const results=[];
const actualFetch=globalThis.fetch;
const stripeCalls=[];
let failStripe=0;
globalThis.fetch=async(url,options)=>{
 assert.equal(url,'https://api.stripe.com/v1/checkout/sessions','No external service may be contacted in this test');
 stripeCalls.push({idempotencyKey:options.headers['Idempotency-Key'],body:options.body.toString()});
 if(failStripe-- > 0)return new Response(JSON.stringify({error:{message:'fixture outage'}}),{status:502});
 await new Promise(resolve=>setTimeout(resolve,25));
 const key=options.headers['Idempotency-Key'];
 return new Response(JSON.stringify({id:`cs_fixture_${key}`,url:`https://checkout.stripe.example/session/${key}`}));
};
const userA={id:crypto.randomUUID()},userB={id:crypto.randomUUID()};
const epaySecret=`epay-fixture-${crypto.randomUUID()}`;
const stripeSecret=`stripe-fixture-${crypto.randomUUID()}`;
const fixtureSettings={payment:{manualEnabled:true,manualInstructions:'fixture instructions',epayEnabled:true,epayUrl:'https://example.com',epayPid:'fixture-pid',epayKey:encrypt(epaySecret),stripeEnabled:true,stripeSecret:encrypt(stripeSecret),stripeWebhookSecret:encrypt('fixture-webhook')}};
const product={id:'fixture-plan',name:'幂等验收套餐',enabled:true,listed:true,price:12.34,days:3,credits:17};
const request=(extra={})=>({type:'membership',productId:product.id,paymentMethod:'manual',requestId:crypto.randomUUID(),...extra});
const count=async()=>Number((await q('SELECT COUNT(*) AS count FROM orders'))[0].count);
async function test(name,run){const start=Date.now();const evidence=await run();results.push({name,passed:true,ms:Date.now()-start,evidence});console.log('PASS',name);}
let failure,cleaned=false;
try {
 const schema=await fs.readFile(new URL('../database/schema.sql',import.meta.url),'utf8');
 for(const statement of schema.split(';').map(value=>value.trim()).filter(Boolean)) {
  const name=statement.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
  if(!tables.includes(name))continue;
  await underlying.execute(rewrite(statement));created.push(name);
 }
 for(const [i,user] of [userA,userB].entries())await q('INSERT INTO users (id,email,name,password_hash,credits) VALUES (?,?,?,?,?)',[user.id,`fixture-${i}@example.test`,'幂等隔离验收','disabled-fixture-password',30]);
 await saveSettings(fixtureSettings);
 await putEntity('plan',product);
 await putEntity('plan',{...product,id:'fixture-other-plan'});
 await putEntity('agent',{id:'fixture-agent',enabled:true});
 await putEntity('plugin',{...product,id:'fixture-plugin',agentId:'fixture-agent'});

 await test('Sequential retries return the same order, snapshot and instructions',async()=>{
  const b=request(),before=await count();const first=await createOrder(userA,b),second=await createOrder(userA,b);
  assert.deepEqual(second,first);assert.equal(await count(),before+1);
  return {sameOrder:true,amount:first.order.amount,ordersCreated:1};
 });
 await test('16 concurrent submissions create exactly one order across six database connections',async()=>{
  const b=request(),before=await count();const responses=await Promise.all(Array.from({length:16},()=>createOrder(userA,b)));
  assert.equal(new Set(responses.map(x=>x.order.id)).size,1);assert.equal(await count(),before+1);
  assert(responses.every(x=>x.order.amount===12.34));return {requests:16,uniqueOrders:1};
 });
 await test('Request keys are scoped to the authenticated user and preserve case',async()=>{
  const b=request({requestId:'FixtureKey-AbC'}),before=await count();
  const [a,bOther,aLower]=await Promise.all([createOrder(userA,b),createOrder(userB,b),createOrder(userA,{...b,requestId:b.requestId.toLowerCase()})]);
  assert.equal(new Set([a.order.id,bOther.order.id,aLower.order.id]).size,3);assert.equal(await count(),before+3);
  return {sameKeyAcrossUsers:'separate orders',caseSensitive:true};
 });
 await test('A reused key rejects changed product, payment method or Alipay/WeChat channel',async()=>{
  const b=request();await createOrder(userA,b);const before=await count();
  for(const change of [{productId:'fixture-other-plan'},{paymentMethod:'stripe'},{type:'plugin',productId:'fixture-plugin'}])await assert.rejects(createOrder(userA,{...b,...change}),error=>error.status===409);
  const epay=request({paymentMethod:'epay',channel:'alipay'});await createOrder(userA,epay);
  await assert.rejects(createOrder(userA,{...epay,channel:'wxpay'}),error=>error.status===409);
  assert.equal(await count(),before+1);return {rejectedConflicts:4,status:409};
 });
 await test('Retries retain original price/title after repricing, delisting and channel disablement',async()=>{
  const b=request(),first=await createOrder(userA,b);
  await putEntity('plan',{...product,price:88.88,name:'已修改套餐',listed:false,enabled:false});
  await saveSettings({payment:{...fixtureSettings.payment,manualEnabled:false,manualInstructions:'changed'}});
  const retry=await createOrder(userA,b);assert.deepEqual(retry,first);
  await assert.rejects(createOrder(userA,request()),error=>error.status===404);
  await putEntity('plan',{...product,listed:false});
  await assert.rejects(createOrder(userA,request()),error=>error.status===404);
  await putEntity('plan',product);await saveSettings(fixtureSettings);
  return {originalAmount:retry.order.amount,retriesIgnoreCatalogChanges:true,newDelistedPurchaseRejected:true};
 });
 await test('Listed and enabled are independent new-plugin purchase gates',async()=>{
  const b=request({type:'plugin',productId:'fixture-plugin'}),first=await createOrder(userA,b);
  await putEntity('plugin',{...product,id:'fixture-plugin',agentId:'fixture-agent',listed:false});
  assert.equal((await createOrder(userA,b)).order.id,first.order.id);
  await assert.rejects(createOrder(userA,{...b,requestId:crypto.randomUUID()}),error=>error.status===404);
  await putEntity('plugin',{...product,id:'fixture-plugin',agentId:'fixture-agent',enabled:false});
  await assert.rejects(createOrder(userA,{...b,requestId:crypto.randomUUID()}),error=>error.status===404);
  return {existingRetryPreserved:true,newUnlistedRejected:true,newDisabledRejected:true};
 });
 await test('Old callers without requestId still create independent orders',async()=>{
  const b=request();delete b.requestId;const a=await createOrder(userA,b),other=await createOrder(userA,b);
  assert.notEqual(a.order.id,other.order.id);return {legacyCompatible:true};
 });
 await test('Invalid request identifiers and unsupported channels write no orders',async()=>{
  const before=await count();for(const requestId of [null,42,'x','has spaces','a'.repeat(129),'😀'.repeat(8)])await assert.rejects(createOrder(userA,request({requestId})),error=>error.status===400);
  await assert.rejects(createOrder(userA,request({paymentMethod:'epay',channel:'invalid'})),error=>error.status===400);
  assert.equal(await count(),before);return {invalidInputsRejected:7};
 });
 await test('Paid and cancelled retries return original state without granting benefits again',async()=>{
  const b=request(),first=await createOrder(userA,b);const before=Number((await q('SELECT credits FROM users WHERE id=?',[userA.id]))[0].credits);
  await fulfill(first.order.id,'fixture-manual-payment',userB.id);await fulfill(first.order.id,'fixture-manual-payment',userB.id);
  const retry=await createOrder(userA,b);assert.equal(retry.order.status,'paid');assert.equal(retry.paymentUrl,null);
  assert.equal(Number((await q('SELECT credits FROM users WHERE id=?',[userA.id]))[0].credits),before+17);
  const cancelled=request(),cancelledOrder=await createOrder(userA,cancelled);await q("UPDATE orders SET status='cancelled' WHERE id=?",[cancelledOrder.order.id]);
  const cancelledRetry=await createOrder(userA,cancelled);assert.equal(cancelledRetry.order.id,cancelledOrder.order.id);assert.equal(cancelledRetry.order.status,'cancelled');assert.equal(cancelledRetry.paymentUrl,null);
  return {paidStatePreserved:true,cancelledStatePreserved:true,creditIncrease:17};
 });
 await test('Epay retries preserve the exact signed jump despite merchant configuration changes',async()=>{
  const b=request({paymentMethod:'epay',channel:'alipay'}),first=await createOrder(userA,b);
  const params=Object.fromEntries(new URL(first.paymentUrl).searchParams);assert.equal(params.sign,epaySign(params,epaySecret));
  await saveSettings({payment:{...fixtureSettings.payment,epayEnabled:false,epayPid:'changed',epayKey:encrypt('changed')}});
  const retry=await createOrder(userA,b);assert.equal(retry.paymentUrl,first.paymentUrl);assert.equal(retry.order.id,first.order.id);
  assert(!JSON.stringify(retry).includes(epaySecret));assert(!JSON.stringify(retry).includes('enc:'));
  await saveSettings(fixtureSettings);return {exactUrlPreserved:true,signatureValid:true,secretsAbsent:true};
 });
 await test('Concurrent Stripe requests call the mocked gateway once and share one session',async()=>{
  const b=request({paymentMethod:'stripe'}),before=stripeCalls.length;const responses=await Promise.all(Array.from({length:12},()=>createOrder(userA,b)));
  assert.equal(stripeCalls.length,before+1);assert.equal(new Set(responses.map(x=>x.order.id)).size,1);assert.equal(new Set(responses.map(x=>x.paymentUrl)).size,1);
  assert(!JSON.stringify(responses).includes(stripeSecret));assert(!JSON.stringify(responses).includes('enc:'));
  return {requests:12,gatewayCalls:1,uniqueCheckoutUrls:1,mocked:true};
 });
 await test('Failed gateway initialization retries the same order and immutable provider parameters',async()=>{
  const b=request({paymentMethod:'stripe'}),before=await count(),callStart=stripeCalls.length;failStripe=1;
  await assert.rejects(createOrder(userA,b),error=>error.status===502);
  const [stored]=await q('SELECT * FROM order_requests WHERE user_id=? AND request_key=?',[userA.id,b.requestId]);assert.equal(stored.ready,0);assert(stored.order_id);
  assert(!stored.checkout.includes(stripeSecret));assert(JSON.parse(stored.checkout).secret.startsWith('enc:'));
  await putEntity('plan',{...product,price:99.99,enabled:false,listed:false});
  await saveSettings({payment:{...fixtureSettings.payment,stripeEnabled:false,stripeSecret:encrypt('rotated-secret')}});
  const retry=await createOrder(userA,b);assert.equal(retry.order.id,stored.order_id);assert.equal(retry.order.amount,12.34);assert.equal(await count(),before+1);
  assert.deepEqual(stripeCalls[callStart],stripeCalls[callStart+1]);assert.equal((await createOrder(userA,b)).paymentUrl,retry.paymentUrl);assert.equal(stripeCalls.length,callStart+2);
  await putEntity('plan',product);await saveSettings(fixtureSettings);
  return {ordersCreated:1,originalAmount:retry.order.amount,sameProviderIdempotencyKey:true,identicalProviderParameters:true,mocked:true};
 });
 await test('Pre-reservation validation failures do not poison a request key',async()=>{
  const b=request({productId:'fixture-later-plan'});await assert.rejects(createOrder(userA,b),error=>error.status===404);
  assert.equal((await q('SELECT * FROM order_requests WHERE user_id=? AND request_key=?',[userA.id,b.requestId])).length,0);
  await putEntity('plan',{...product,id:b.productId});assert.equal((await createOrder(userA,b)).order.amount,12.34);
  return {failedReservationRolledBack:true,sameRequestCanRetry:true};
 });
 await test('Deleting fixture orders cascades their idempotency mapping',async()=>{
  const b=request(),createdOrder=await createOrder(userA,b);await q('DELETE FROM orders WHERE id=?',[createdOrder.order.id]);
  assert.equal((await q('SELECT * FROM order_requests WHERE user_id=? AND request_key=?',[userA.id,b.requestId])).length,0);return {foreignKeyCascadeVerified:true};
 });
} catch(error) {
 failure=error;console.error(error.stack);process.exitCode=1;
} finally {
 globalThis.fetch=actualFetch;
 for(const name of created.reverse())await underlying.execute(`DROP TABLE ${prefix}${name}`);
 cleaned=true;
 await underlying.end();
 await fs.mkdir(new URL('../docs/tests/',import.meta.url),{recursive:true});
 await fs.writeFile(new URL('../docs/tests/order-idempotency-results.json',import.meta.url),JSON.stringify({testedAt:new Date().toISOString(),passed:results.length,failed:failure?1:0,isolatedTables:true,productionSettingsUntouched:true,realPaymentRequests:0,fixturesCleaned:cleaned,results,...(failure?{error:failure.message}:{})},null,2)+'\n');
}
