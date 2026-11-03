import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {callModel} from '../lib/ai.mjs';
import {entities,id,pool,q} from '../lib/db.mjs';

// Deterministic transport regressions. No provider calls or production settings changes.
const originalFetch=globalThis.fetch,userId=id(),report=[];
const model=(await entities('model')).find(m=>m.isDefault);
await q('INSERT INTO users (id,email,name,password_hash,status) VALUES (?,?,?,?,?)',[userId,`ai-client-${userId}@example.test`,'AI 客户端回归','!disabled','disabled']);
async function scenario(name,responses,check) {
 const requests=[];
 globalThis.fetch=async(_url,options)=>{
  requests.push(JSON.parse(options.body));
  const result=responses[requests.length-1];
  assert(result,'Retry count exceeded the scenario budget');
  return Response.json(result.body,{status:result.status||200});
 };
 const start=Date.now();
 await check(()=>callModel({modelId:model.id,userId,kind:'ai-regression',messages:[{role:'user',content:'本地测试，不应发送网络请求。'}],maxTokens:1000}),requests);
 report.push({name,passed:true,requests:requests.length,ms:Date.now()-start});
 console.log('PASS',name);
}
const answer={choices:[{message:{content:'完整的最终回答。'},finish_reason:'stop'}],usage:{total_tokens:10}};
try {
 await scenario('Temporary upstream errors recover with one retry',[{status:503,body:{error:{type:'unavailable'}}},{body:answer}],async(call,requests)=>{
  const result=await call();assert.equal(requests.length,2);assert.equal(result.reply,'完整的最终回答。');
 });
 await scenario('Truncated reasoning is retried with increased budget and cumulative usage',[
  {body:{choices:[{message:{content:'',reasoning_content:'PRIVATE REASONING MUST NEVER BE RETURNED'},finish_reason:'length'}],usage:{total_tokens:1000}}},{body:answer}
 ],async(call,requests)=>{
  const result=await call();assert.equal(requests.length,2);assert(requests[1].max_tokens>requests[0].max_tokens);assert.equal(result.tokens,1010);assert.equal(result.reply,'完整的最终回答。');
  const rows=await q('SELECT tokens,status FROM usage_logs WHERE user_id=? ORDER BY created_at DESC',[userId]);assert(rows.some(row=>row.tokens===1010&&row.status==='success'));
 });
 await scenario('Empty successful responses are retried once',[{body:{choices:[{message:{content:''},finish_reason:'stop'}]}},{body:answer}],async(call,requests)=>{
  assert.equal((await call()).reply,'完整的最终回答。');assert.equal(requests.length,2);
 });
 await scenario('Persistent empty or truncated responses remain real failures',[
  {body:{choices:[{message:{content:''},finish_reason:'length'}]}},{body:{choices:[{message:{content:'未完成的答案'},finish_reason:'length'}]}}
 ],async(call,requests)=>{await assert.rejects(call(),/长度上限/);assert.equal(requests.length,2);});
 await scenario('Authentication errors do not retry',[{status:401,body:{error:{type:'unauthorized'}}}],async(call,requests)=>{await assert.rejects(call(),/401/);assert.equal(requests.length,1);});
 await scenario('Provider refusals do not retry or expose reasoning',[{body:{choices:[{message:{content:null,refusal:'refused',reasoning_content:'private'},finish_reason:'content_filter'}]}}],async(call,requests)=>{await assert.rejects(call(),/有效内容/);assert.equal(requests.length,1);});
 await scenario('Reasoning blocks are omitted from structured message content',[{body:{choices:[{message:{content:[{type:'thinking',text:'private'},{type:'text',text:'可见答案'}]},finish_reason:'stop'}]}}],async(call)=>{assert.equal((await call()).reply,'可见答案');});
 await scenario('Missing provider usage stays unknown while a reported zero remains zero',[
  {body:{choices:answer.choices}},{body:{...answer,usage:{total_tokens:0}}}
 ],async(call,requests)=>{
  const unknown=await call();assert.equal(unknown.tokens,null);assert.equal(unknown.usage.complete,false);assert.equal(unknown.usage.reportedTokens,null);
  const zero=await call();assert.equal(zero.tokens,0);assert.equal(zero.usage.complete,true);assert.equal(zero.usage.reportedTokens,0);assert.equal(requests.length,2);
  const rows=await q('SELECT tokens,status FROM usage_logs WHERE user_id=?',[userId]);assert(rows.some(row=>row.status==='success'&&row.tokens===null));assert(rows.some(row=>row.status==='success'&&row.tokens===0));
 });
 await scenario('A retry with partial usage never reports a complete token total',[
  {body:{choices:[{message:{content:''},finish_reason:'length'}],usage:{total_tokens:1000}}},{body:{choices:answer.choices}}
 ],async(call,requests)=>{
  const result=await call();assert.equal(requests.length,2);assert.equal(result.tokens,null);assert.equal(result.usage.complete,false);assert.equal(result.usage.reportedTokens,1000);assert.equal(result.usage.reportedRequests,1);assert.equal(result.usage.unreportedRequests,1);
 });
} catch(error) {
 report.push({passed:false,error:error.message});process.exitCode=1;console.error(error);
} finally {
 globalThis.fetch=originalFetch;
 await q('DELETE FROM usage_logs WHERE user_id=?',[userId]);await q('DELETE FROM users WHERE id=?',[userId]);await pool.end();
 await writeFile('docs/tests/ai-client-results.json',JSON.stringify({testedAt:new Date().toISOString(),providerCalls:0,results:report},null,2)+'\n');
}
