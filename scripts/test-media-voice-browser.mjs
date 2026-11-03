import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {q,pool,id} from '../lib/db.mjs';
import {createSession} from '../lib/security.mjs';

const base='https://154.40.47.111:3063',userId=id(),report={startedAt:new Date().toISOString(),scope:'Real deployed browser voice chain with synthetic English WAV as Chromium microphone input; no physical audio device or human listening verification',errors:[]};
const wav=path.resolve(`private/browser-english-${Date.now()}.wav`);
execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-i','docs/tests/media-fixtures/speech-gpt-4o-mini-tts.mp3','-af','adelay=4000,apad=pad_dur=30','-ac','1','-ar','24000','-c:a','pcm_s16le',wav]);
await fs.chmod(wav,0o600);
await q('INSERT INTO users (id,email,name,password_hash,credits) VALUES (?,?,?,?,?)',[userId,`voice-ui-${userId}@example.test`,'英语语音验收','!no-password-login',20]);
const token=await createSession(userId);
const browser=await chromium.launch({headless:true,executablePath:'/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${wav}`]});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',permissions:['microphone']});
await context.addCookies([{name:'zhixu_session',value:token,url:base,httpOnly:true,secure:true,sameSite:'Lax'}]);
await context.addInitScript(()=>{
 window.__voiceEvidence={audioStarts:0,samples:0,nonzeroSamples:0,events:[],completed:null};
 const originalStart=AudioBufferSourceNode.prototype.start;
 AudioBufferSourceNode.prototype.start=function(...args){const result=originalStart.apply(this,args);window.__voiceEvidence.audioStarts++;window.__voiceEvidence.samples+=this.buffer?.length||0;window.__voiceEvidence.nonzeroSamples+=(this.buffer?Array.from(this.buffer.getChannelData(0)).filter(x=>Math.abs(x)>0.001).length:0);return result;};
 const Original=window.WebSocket;window.WebSocket=class extends Original{constructor(...args){super(...args);this.addEventListener('message',event=>{let data;try{data=JSON.parse(event.data);}catch{return;}const out=window.__voiceEvidence;if(data.type!=='assistant.audio'&&data.type!=='assistant.transcript.delta')out.events.push({type:data.type,status:data.status,text:data.text,message:data.message});if(data.type==='turn.completed')out.completed=data;});}};
});
const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
try{
 await page.goto(base+'/?view=media');await expect(page.getByRole('button',{name:'开始语音对话',exact:true})).toBeEnabled({timeout:20000});
 await page.getByRole('button',{name:'开始语音对话',exact:true}).click();await expect(page.getByRole('heading',{name:'正在聆听',exact:true})).toBeVisible({timeout:20000});
 await expect.poll(()=>page.evaluate(()=>window.__voiceEvidence.completed),{timeout:70000,intervals:[250,500,1000]}).toBeTruthy();
 report.playback=await page.evaluate(()=>window.__voiceEvidence);assert(report.playback.completed.audioAvailable);assert(report.playback.audioStarts>0);assert(report.playback.nonzeroSamples>100);assert(report.playback.events.some(event=>event.type==='user.transcript'&&/english/i.test(event.text||'')));assert(!report.playback.events.some(event=>event.type==='error'));
 await expect(page.locator('.media-message.assistant')).not.toHaveCount(0);await page.screenshot({path:'docs/screenshots/media-mobile-real-conversation.png',fullPage:true});
 await page.getByRole('button',{name:'结束对话',exact:true}).click();await expect(page.getByRole('button',{name:'开始语音对话',exact:true})).toBeEnabled({timeout:10000});
 const conversation=(await q('SELECT messages FROM conversations WHERE user_id=?',[userId]))[0];const messages=JSON.parse(conversation.messages);assert.equal(messages.length,2);assert(messages.every(message=>message.content.length>0));report.messages=messages.map(({role,content})=>({role,content}));report.creditsAfter=Number((await q('SELECT credits FROM users WHERE id=?',[userId]))[0].credits);assert.equal(report.creditsAfter,19);assert.deepEqual(report.errors,[]);report.passed=true;console.log('PASS real browser ASR → reply → nonzero PCM playback, history and one-credit billing');
}catch(error){report.passed=false;report.error=error.stack;report.playback=await page.evaluate(()=>window.__voiceEvidence).catch(()=>null);process.exitCode=1;console.error(error.message);await page.screenshot({path:'docs/screenshots/media-real-voice-failure.png',fullPage:true}).catch(()=>{});}
finally{await browser.close();await new Promise(resolve=>setTimeout(resolve,500));for(const table of ['media_operations','sessions','conversations','usage_logs','audit'])await q(`DELETE FROM ${table} WHERE user_id=?`,[userId]);await q('DELETE FROM users WHERE id=?',[userId]);await fs.rm(wav,{force:true});report.completedAt=new Date().toISOString();await fs.writeFile('docs/tests/media-voice-browser-results.json',JSON.stringify(report,null,2));await pool.end();}
