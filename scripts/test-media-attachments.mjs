import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {q,pool,id} from '../lib/db.mjs';
import {annotateMediaReferences,mediaConversation,deleteMediaAsset,runMediaVision} from '../lib/media.mjs';
import {createAttachmentFixture,cleanupAttachmentFixture} from './media-attachment-fixture.mjs';

const report={testedAt:new Date().toISOString(),realProviderCalls:0,results:[]};let fixture;
async function test(name,run){await run();report.results.push({name,passed:true});console.log('PASS',name);}
try{
 fixture=await createAttachmentFixture();const userId=fixture.users[0];
 await test('Owned history references use canonical download URLs; foreign, absent and wrong-kind references expose no URL',async()=>{
  const absent=id(),containers=[{content:'保留文字',attachments:[{...fixture.image,url:'https://untrusted.example/file'},fixture.foreign,{id:absent,kind:'image',url:'/unsafe'},{...fixture.audio,kind:'image'}],sources:[{id:fixture.image.id,kind:'image',title:'题目',url:'https://untrusted.example/file'},{id:fixture.foreign.id,kind:'image',title:'外部引用',url:fixture.foreign.url},{id:'a-personal-note',kind:'note',title:'普通知识笔记'}]}];
  const before=JSON.stringify(containers),result=await annotateMediaReferences(userId,containers);
  assert.equal(JSON.stringify(containers),before,'read-time annotation must not mutate stored input');assert.equal(result[0].content,'保留文字');
  assert.equal(result[0].attachments[0].url,fixture.image.url);assert.equal(result[0].attachments[0].availability,'available');assert.equal(result[0].sources[0].url,fixture.image.url);
  for(const item of result[0].attachments.slice(1)){assert.equal(item.deleted,true);assert.equal(item.url,null);}assert.equal(result[0].sources[1].url,null);assert.deepEqual(result[0].sources[2],containers[0].sources[2]);
 });
 await test('Repeated references across many conversations and note metadata use one ownership query',async()=>{
  const execute=pool.execute;let lookups=0;
  pool.execute=function(sql,...args){if(typeof sql==='string'&&sql.includes('FROM media_assets'))lookups++;return execute.call(this,sql,...args);};
  try{const results=await annotateMediaReferences(userId,Array.from({length:80},()=>({attachments:[fixture.image,fixture.audio],sources:[{id:fixture.image.id,kind:'image',title:'题目'}]})));assert.equal(results.length,80);assert.equal(lookups,1);assert(results.every(item=>item.attachments.every(asset=>asset.availability==='available')));}finally{pool.execute=execute;}
 });
 await test('Deleting a photo replaces both historical preview and source with deleted state while preserving stored messages',async()=>{
  const before=await mediaConversation(userId,fixture.conversationId);assert.equal(before.messages[0].attachments[0].deleted,false);
  await deleteMediaAsset(userId,fixture.image.id);
  const after=await mediaConversation(userId,fixture.conversationId);for(const item of [after.messages[0].attachments[0],after.messages[1].sources[0]]){assert.equal(item.deleted,true);assert.equal(item.availability,'deleted');assert.equal(item.url,null);}
  assert.deepEqual(after.messages.map(message=>message.content),fixture.messages.map(message=>message.content));assert.deepEqual(JSON.parse((await q('SELECT messages FROM conversations WHERE id=?',[fixture.conversationId]))[0].messages),fixture.messages);
  await assert.rejects(mediaConversation(fixture.users[1],fixture.conversationId),error=>error.status===404);
  const beforeCredits=(await q('SELECT credits FROM users WHERE id=?',[userId]))[0].credits;
  await assert.rejects(runMediaVision(userId,{sceneId:'homework',prompt:'继续查看已删除图片',assetIds:[],conversationId:fixture.conversationId}),error=>error.status===404);
  assert.equal((await q('SELECT credits FROM users WHERE id=?',[userId]))[0].credits,beforeCredits,'missing historical media must fail before charging or provider calls');
 });
 await test('Deleted recording references in note metadata lose download URLs without changing transcript text',async()=>{
  await deleteMediaAsset(userId,fixture.audio.id);const row=(await q('SELECT content,meta FROM records WHERE id=?',[fixture.noteId]))[0];
  const [meta]=await annotateMediaReferences(userId,[JSON.parse(row.meta)]);assert.equal(meta.attachments[0].deleted,true);assert.equal(meta.sources[0].deleted,true);assert.equal(meta.attachments[0].url,null);assert.equal(meta.sources[0].url,null);assert.equal(row.content,'这是已保存的录音文字，删除附件后仍可阅读。');
 });
}catch(error){process.exitCode=1;report.results.push({passed:false,error:error.stack});console.error(error.stack);}
finally{try{await cleanupAttachmentFixture(fixture);report.cleanup='All isolated users, references, sessions and private files removed';}finally{if(process.env.MEDIA_TEST_REPORT)await fs.writeFile(process.env.MEDIA_TEST_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await pool.end();}}
