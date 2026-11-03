import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {q,pool,id,parse} from '../lib/db.mjs';
import {storeMediaAsset,assetPath,runMediaVision,mediaConversation} from '../lib/media.mjs';
import {renderMealLog} from '../lib/meal-log.mjs';
const userId=id(),realFetch=globalThis.fetch,results=[];let body,reply='unstructured meal diary';
const facts={foods:['rice','broccoli','tomatoes'],uncertainties:['Exact ingredients are uncertain.'],suggestions:['Consider adding a protein source.']};
const credits=async()=>Number((await q('SELECT credits FROM users WHERE id=?',[userId]))[0].credits);
globalThis.fetch=async(url,options)=>{assert(new URL(url).pathname.endsWith('/chat/completions'));body=JSON.parse(options.body);return Response.json({choices:[{message:{content:reply},finish_reason:'stop'}],usage:{total_tokens:30}});};
async function test(name,run){await run();results.push({name,passed:true});console.log('PASS',name);}
try{
 await q('INSERT INTO users(id,email,name,password_hash,credits) VALUES (?,?,?,?,?)',[userId,`meal-contract-${userId}@example.test`,'饮食契约临时验收','!no-login',20]);
 const image=await storeMediaAsset(userId,{kind:'image',name:'equation-test.png',bytes:await fs.readFile('docs/tests/media-fixtures/linear-equation.png')});
 await test('Unstructured upstream diary is rejected before saving and the reserved credit is refunded exactly once',async()=>{
  await assert.rejects(runMediaVision(userId,{sceneId:'meal-log',prompt:'Draft a diary.',assetIds:[image.id]}),error=>error.status===502);assert.deepEqual(body.response_format,{type:'json_object'});assert.equal(await credits(),20);assert.equal(Number((await q('SELECT COUNT(*) n FROM conversations WHERE user_id=?',[userId]))[0].n),0);assert.deepEqual((await q('SELECT status FROM media_operations WHERE user_id=?',[userId])).map(x=>x.status),['refunded']);
 });
 await test('Structured facts produce the fixed draft, persist the same safe text and charge one credit',async()=>{
  reply=JSON.stringify(facts);const result=await runMediaVision(userId,{sceneId:'meal-log',prompt:'Draft a diary.',assetIds:[image.id]});assert.equal(result.reply,renderMealLog(facts));assert.equal(await credits(),19);const c=await mediaConversation(userId,result.conversationId);assert.equal(c.messages.at(-1).content,result.reply);assert.equal(c.messages.at(-1).sources[0].id,image.id);assert(!result.reply.includes('"foods"'));assert(result.reply.includes('个人感受：待补充'));
 });
 await test('Extra narrative fields from the provider are rejected without a charge or extra history',async()=>{
  reply=JSON.stringify({...facts,diary:'For lunch I felt energized.'});await assert.rejects(runMediaVision(userId,{sceneId:'meal-log',assetIds:[image.id]}),error=>error.status===502);assert.equal(await credits(),19);assert.equal(Number((await q('SELECT COUNT(*) n FROM conversations WHERE user_id=?',[userId]))[0].n),1);
 });
 await test('Other image scenes retain their normal free-text answer and do not request JSON mode',async()=>{
  reply='2x + 5 = 17, so x = 6.';const result=await runMediaVision(userId,{sceneId:'homework',assetIds:[image.id]});assert.equal(result.reply,reply);assert.equal(body.response_format,undefined);assert.equal(await credits(),18);
 });
}catch(error){results.push({passed:false,error:error.message});process.exitCode=1;console.error(error.message);}
finally{
 globalThis.fetch=realFetch;for(const asset of await q('SELECT * FROM media_assets WHERE user_id=?',[userId]))await fs.unlink(assetPath(asset)).catch(()=>{});
 for(const table of ['media_assets','media_operations','conversations','usage_logs','sessions','audit'])await q(`DELETE FROM ${table} WHERE user_id=?`,[userId]);await q('DELETE FROM rate_limits WHERE id LIKE ?',['%:'+userId]);await q('DELETE FROM users WHERE id=?',[userId]);await pool.end();
 await fs.writeFile('docs/tests/meal-log-contract-results.json',JSON.stringify({testedAt:new Date().toISOString(),scope:'Actual media service/database fixtures; captured mock provider transport, no real AI call',results,cleanup:'Temporary user, assets, histories, charges, usage and rate limits removed'},null,2));
}
