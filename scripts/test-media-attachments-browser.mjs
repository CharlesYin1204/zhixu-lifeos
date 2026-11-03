import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {q,pool} from '../lib/db.mjs';
import {createSession} from '../lib/security.mjs';
import {createAttachmentFixture,cleanupAttachmentFixture} from './media-attachment-fixture.mjs';

// Run only after deployment. One browser, zero AI/provider requests, temporary data.
const base=(process.env.TEST_BASE_URL||'https://154.40.47.111:3063').replace(/\/$/,''),report={testedAt:new Date().toISOString(),base,realProviderCalls:0,results:[],pageErrors:[]};
let fixture,browser,page,context;
async function test(name,run){await run();report.results.push({name,passed:true});console.log('PASS',name);}
async function openHistory(){await page.goto(base+'/?view=media&kind=image');await expect(page.locator('.media-history-list button').filter({hasText:fixture.title})).toBeVisible({timeout:20000});await page.locator('.media-history-list button').filter({hasText:fixture.title}).click();await expect(page.locator('.media-transcript')).toContainText('解得 x = 6');}
async function api(path,body){const response=body===undefined?await context.request.get(base+path):await context.request.post(base+path,{data:body,headers:{Origin:base}});assert.equal(response.status(),200,await response.text());return response.json();}
try{
 fixture=await createAttachmentFixture();const token=await createSession(fixture.users[0]);
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox','--disable-dev-shm-usage']});
 context=await browser.newContext({viewport:{width:1365,height:950},locale:'zh-CN',timezoneId:'Asia/Shanghai'});await context.addCookies([{name:'zhixu_session',value:token,url:base,httpOnly:true,sameSite:'Lax',secure:base.startsWith('https:')}]);page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));
 await test('Available historical image renders a working owner-only preview and source link',async()=>{
  await openHistory();await expect(page.locator('.media-message-images img')).toHaveCount(1);await expect.poll(()=>page.locator('.media-message-images img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await page.locator('.media-sources summary').click();await expect(page.locator('.media-sources a')).toHaveAttribute('href',fixture.image.url);
 });
 await test('Deleting the currently displayed photo immediately replaces its preview and source without losing text',async()=>{
  await page.locator('.media-attachments>summary').click();await page.getByRole('button',{name:`删除附件 ${fixture.image.name}`,exact:true}).click();
  await expect(page.locator('.media-attachment-deleted')).toContainText('附件已删除');await expect(page.locator('.media-message-images img')).toHaveCount(0);await expect(page.locator('.media-sources a')).toHaveCount(0);await expect(page.locator('.media-source-unavailable')).toContainText('附件已删除');await expect(page.locator('.media-transcript')).toContainText('删除附件后仍保留这段回答');await expect(page.locator(`a[href*="${fixture.image.id}"]`)).toHaveCount(0);
  const conversation=(await api('/api/media?resource=conversation&id='+fixture.conversationId)).conversation;assert.equal(conversation.messages[0].attachments[0].deleted,true);assert.equal(conversation.messages[0].attachments[0].url,null);assert.equal(conversation.messages[1].sources[0].deleted,true);
 });
 await test('Reloaded mobile history shows the deleted placeholder and makes no request to the removed image',async()=>{
  const removedRequests=[];const watch=request=>{if(request.url().includes('resource=asset')&&request.url().includes(fixture.image.id))removedRequests.push(request.url());};page.on('request',watch);await page.setViewportSize({width:390,height:844});await openHistory();
  await expect(page.locator('.media-attachment-deleted')).toContainText('附件已删除');await expect(page.locator('.media-message-images img')).toHaveCount(0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(removedRequests,[]);page.off('request',watch);
 });
 await test('Deleting a recording updates note metadata returned by bootstrap and removes clickable sources in the note UI',async()=>{
  await api('/api/media',{action:'asset.delete',assetId:fixture.audio.id});const data=await api('/api/app?resource=bootstrap'),note=data.records.find(record=>record.id===fixture.noteId);assert(note);assert.equal(note.meta.attachments[0].url,null);assert.equal(note.meta.sources[0].deleted,true);assert.equal(note.meta.sources[0].availability,'deleted');assert.equal(note.meta.sources[0].url,null);
  await page.goto(base+'/?view=knowledge');await page.locator('.note-card').filter({hasText:fixture.noteTitle}).click();const modal=page.getByRole('dialog');await expect(modal.locator('textarea[name=content]')).toHaveValue('这是已保存的录音文字，删除附件后仍可阅读。');await modal.locator('.ai-sources summary').click();await expect(modal.locator('.ai-sources')).toContainText('附件已删除');await expect(modal.locator('.ai-sources button,.ai-sources a')).toHaveCount(0);
 });
 await test('Production record pagination and account export also remove deleted recording URLs',async()=>{
  const cursor=Buffer.from(JSON.stringify({at:'2099-01-01 00:00:00',id:'ffffffff-ffff-4fff-bfff-ffffffffffff'})).toString('base64url');report.recordResponses=[];
  for(const resource of ['bootstrap','records&cursor='+cursor,'export']){const data=await api('/api/app?resource='+resource),note=data.records.find(record=>record.id===fixture.noteId);assert(note);assert.equal(note.meta.sources[0].deleted,true);assert.equal(note.meta.sources[0].url,null);assert.equal(note.meta.attachments[0].deleted,true);assert.equal(note.meta.attachments[0].url,null);assert.equal(note.content,'这是已保存的录音文字，删除附件后仍可阅读。');report.recordResponses.push({resource:resource.split('&')[0],deleted:true,url:null,transcriptPreserved:true});}
 });
 assert.deepEqual(report.pageErrors,[]);assert.equal((await q('SELECT credits FROM users WHERE id=?',[fixture.users[0]]))[0].credits,30);report.browser=browser.version();
}catch(error){process.exitCode=1;report.results.push({passed:false,error:error.stack});console.error(error.stack);}
finally{
 await browser?.close();try{await cleanupAttachmentFixture(fixture);report.cleanup='All isolated users, sessions, notes, conversations and private files removed';}finally{await fs.writeFile(process.env.MEDIA_TEST_REPORT||'/tmp/zhixu-media-attachments-browser-results.json',JSON.stringify(report,null,2));await pool.end();}
}
