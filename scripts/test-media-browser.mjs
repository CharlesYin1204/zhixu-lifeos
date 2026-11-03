import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {q,pool,id} from '../lib/db.mjs';
import {createSession} from '../lib/security.mjs';

const base=process.env.TEST_BASE_URL||'https://154.40.47.111:3063';
const results=[],errors=[],fixtureId=id(),stamp=Date.now();
const audioPath=path.resolve(`private/media-browser-silence-${stamp}.wav`);
const header=Buffer.alloc(44),pcm=Buffer.alloc(48000*5);
header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
await fs.writeFile(audioPath,Buffer.concat([header,pcm]),{mode:0o600});
await q('INSERT INTO users (id,email,name,password_hash,role,credits) VALUES (?,?,?,?,?,?)',[fixtureId,`media-browser-${stamp}@example.test`,'媒体浏览器验收','!no-password-login','admin',20]);
const token=await createSession(fixtureId),adminToken=await createSession(fixtureId,'admin');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${audioPath}`]});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',permissions:['microphone']});
await context.addCookies([{name:'zhixu_session',value:token,url:base,httpOnly:true,sameSite:'Lax',secure:true},{name:'zhixu_admin_session',value:adminToken,url:base,httpOnly:true,sameSite:'Lax',secure:true}]);
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{window.__mediaStreams=[];const original=navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);if(original)navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await original(constraints);window.__mediaStreams.push(stream);return stream;};});
async function test(name,fn){const started=Date.now();await fn();results.push({name,passed:true,ms:Date.now()-started});console.log('PASS',name);}
async function goto(view,kind=''){const route=view==='admin'?'/admin':view==='user'?'/user':`/?view=${view}${kind?'&kind='+kind:''}`;await page.goto(base+route);await expect(page.locator('.page-loading')).toHaveCount(0,{timeout:20000});await expect(page.locator('main h1')).toBeVisible({timeout:20000});}
async function mode(label){await page.getByRole('tab',{name:new RegExp(label)}).click();}
async function tracksStopped(){await expect.poll(()=>page.evaluate(()=>window.__mediaStreams.flatMap(stream=>stream.getTracks()).every(track=>track.readyState==='ended'))).toBe(true);}
try{
 await test('Trusted HTTPS exposes microphone capture and all 13 configured scenarios',async()=>{
  await goto('media');assert.equal(await page.evaluate(()=>window.isSecureContext),true);assert.equal(await page.evaluate(()=>window.scrollY),0);await expect(page.getByRole('button',{name:'开始语音对话',exact:true})).toBeEnabled();
  for(const [label,count]of [['实时语音',5],['图片助手',6],['录音转写',2]]){await mode(label);await expect(page.locator('.media-scene-list button')).toHaveCount(count);}
  await mode('实时语音');await page.screenshot({path:'docs/screenshots/media-desktop-voice.png',fullPage:true});
 });
 await test('Voice connects through production WSS, mutes, interrupts and ends without leaking microphone tracks',async()=>{
  await page.getByRole('button',{name:'开始语音对话',exact:true}).click();await expect(page.getByRole('heading',{name:'正在聆听',exact:true})).toBeVisible({timeout:25000});
  await page.getByRole('button',{name:'静音',exact:true}).click();await expect(page.getByRole('button',{name:'取消静音',exact:true})).toHaveAttribute('aria-pressed','true');
  assert.equal(await page.evaluate(()=>window.__mediaStreams.at(-1).getAudioTracks().every(track=>!track.enabled)),true);
  await page.getByRole('button',{name:'打断回答',exact:true}).click();await page.getByRole('button',{name:'结束对话',exact:true}).click();await expect(page.getByRole('button',{name:'开始语音对话',exact:true})).toBeEnabled({timeout:15000});await tracksStopped();
 });
 await test('Actual browser MediaRecorder supports pause/resume, local preview and deletion before any upload',async()=>{
  await mode('录音转写');await page.getByRole('button',{name:'开始录音',exact:true}).click();await expect(page.getByRole('button',{name:'停止并试听',exact:true})).toBeVisible();
  await page.waitForTimeout(1200);await page.getByRole('button',{name:'暂停',exact:true}).click();await expect(page.locator('.media-recorder')).toContainText('录音已暂停');
  await page.getByRole('button',{name:'继续录音',exact:true}).click();await page.waitForTimeout(700);await page.getByRole('button',{name:'停止并试听',exact:true}).click();
  await expect(page.locator('.media-record-preview audio')).toHaveAttribute('src',/^blob:/);await expect(page.locator('.media-record-preview')).toContainText('尚未上传');await expect(page.getByRole('button',{name:'上传转写并保存',exact:true})).toBeEnabled();await tracksStopped();
  assert.equal((await q('SELECT COUNT(*) count FROM media_assets WHERE user_id=?',[fixtureId]))[0].count,0);
  await page.screenshot({path:'docs/screenshots/media-desktop-recording.png',fullPage:true});await page.getByRole('button',{name:'删除录音',exact:true}).click();await expect(page.locator('.media-record-preview')).toHaveCount(0);
 });
 await test('Photo selection uploads a real image, gives preview and removes the private asset',async()=>{
  await mode('图片助手');await page.locator('input[type=file][multiple]').setInputFiles('docs/tests/media-fixtures/linear-equation.png');await expect(page.locator('.media-upload-item.ready')).toHaveCount(1,{timeout:25000});
  await expect(page.getByRole('button',{name:'开始解析',exact:true})).toBeEnabled();assert.equal((await q('SELECT COUNT(*) count FROM media_assets WHERE user_id=?',[fixtureId]))[0].count,1);await page.screenshot({path:'docs/screenshots/media-desktop-image.png',fullPage:true});
  await page.getByRole('button',{name:'移除 linear-equation.png',exact:true}).click();await expect(page.locator('.media-upload-item')).toHaveCount(0);await expect.poll(async()=>Number((await q('SELECT COUNT(*) count FROM media_assets WHERE user_id=?',[fixtureId]))[0].count)).toBe(0);
 });
 await test('Actual saved photo answer displays readable equations and Markdown in personal history',async()=>{
  const answer=JSON.parse(await fs.readFile('docs/tests/media-live-results.json','utf8')).vision?.answer||'**解题：**\\(x=6\\)';
  await q('INSERT INTO conversations (id,user_id,agent_id,title,messages) VALUES (?,?,?,?,?)',[id(),fixtureId,'media.image:homework','真实题解排版验收',JSON.stringify([{role:'user',content:'请解方程 2x + 5 = 17'},{role:'assistant',content:answer}])]);
  await goto('media','image');await page.locator('.media-history-list button').filter({hasText:'真实题解排版验收'}).click();await expect(page.locator('.media-rich-answer .katex').first()).toBeVisible();await expect(page.locator('.media-rich-answer strong').first()).toBeVisible();await page.screenshot({path:'docs/screenshots/media-desktop-math.png',fullPage:true});
 });
 await test('User center entries open each media workspace and ordinary AI pages remain healthy',async()=>{
  await goto('user');for(const [entry,tab]of [['实时语音','实时语音'],['拍照与图片助手','图片助手'],['录音与转写','录音转写']]){const button=page.locator('.feature-entry-grid').getByRole('button',{name:new RegExp(entry)});await button.click();await expect(page.getByRole('tab',{name:new RegExp(tab)})).toHaveAttribute('aria-selected','true');await goto('user');}
  for(const view of ['ai','agents','learning','life','plugins','membership'])await goto(view);
 });
 await test('Administrator media settings show actual model bindings and valid capabilities',async()=>{
  await goto('admin');const nav=page.getByRole('navigation',{name:'后台导航',exact:true});await nav.locator('[data-section=media]').click();await expect(page.locator('select[name=visionModelId]')).toHaveValue('media-gpt4o-mini');await expect(page.locator('select[name=transcriptionModelId]')).toHaveValue('media-transcribe');await expect(page.locator('select[name=ttsModelId]')).toHaveValue('media-tts');await expect(nav.locator('[data-section]')).toHaveCount(15);await expect(page.locator('.sidebar,.topbar,.mobile-bottom')).toHaveCount(0);await page.screenshot({path:'docs/screenshots/media-admin.png',fullPage:true});
 });
 await test('All media workspaces fit mobile widths and preserve bottom navigation',async()=>{
  await page.setViewportSize({width:390,height:844});for(const kind of ['voice','image','recording']){await goto('media',kind);if(kind==='image'){await page.locator('.media-history-list button').filter({hasText:'真实题解排版验收'}).click();await expect(page.locator('.media-rich-answer .katex').first()).toBeVisible();}await expect(page.locator('.mobile-bottom')).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,kind);await page.screenshot({path:`docs/screenshots/media-mobile-${kind}.png`,fullPage:true});}
  await page.setViewportSize({width:360,height:800});await goto('media');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 });
 await test('Navigation away from an active microphone session releases capture',async()=>{
  await page.getByRole('button',{name:'开始语音对话',exact:true}).click();await expect(page.getByRole('heading',{name:'正在聆听',exact:true})).toBeVisible({timeout:25000});await page.locator('.mobile-bottom button').last().click();await tracksStopped();
 });
 assert.deepEqual(errors,[]);assert.equal(Number((await q('SELECT credits FROM users WHERE id=?',[fixtureId]))[0].credits),20);
 results.push({name:'No browser exceptions or AI charges during silent media UI verification',passed:true});
}catch(error){process.exitCode=1;results.push({passed:false,error:error.stack});console.error(error.message);await page.screenshot({path:'docs/screenshots/media-browser-failure.png',fullPage:true}).catch(()=>{});}
finally{
 await browser.close();const assets=await q('SELECT filename FROM media_assets WHERE user_id=?',[fixtureId]);for(const asset of assets)await fs.rm(path.join('private/media',asset.filename),{force:true});for(const table of ['media_operations','media_assets','sessions','records','conversations','usage_logs','audit'])await q(`DELETE FROM ${table} WHERE user_id=?`,[fixtureId]);await q('DELETE FROM users WHERE id=?',[fixtureId]);await fs.rm(audioPath,{force:true});await fs.writeFile('docs/tests/media-browser-results.json',JSON.stringify({testedAt:new Date().toISOString(),base,browser:browser.version(),capture:'Chromium fake-device silent WAV through actual getUserMedia/MediaRecorder/AudioWorklet; no physical microphone test',results,errors},null,2));await pool.end();
}
