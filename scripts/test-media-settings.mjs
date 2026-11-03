import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import WebSocket from 'next/dist/compiled/ws/index.js';

// Actual route, database and media services; isolated tables and a captured provider transport.
const prefix=`medcfg_${crypto.randomBytes(6).toString('hex')}_`;
const schema=await fs.readFile(new URL('../database/schema.sql',import.meta.url),'utf8');
const statements=schema.split(';').map(x=>x.trim()).filter(x=>/^CREATE TABLE IF NOT EXISTS /.test(x));
const tables=statements.map(x=>x.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1]);
const pattern=new RegExp(`\\b(${tables.join('|')})\\b`,'g');
const rewrite=sql=>sql.replace(pattern,name=>prefix+name);
const underlying=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:3,charset:'utf8mb4',timezone:'+08:00',dateStrings:true});
globalThis.__zhixuPool={execute:(sql,values)=>underlying.execute(rewrite(sql),values),async getConnection(){const c=await underlying.getConnection();return {execute:(sql,values)=>c.execute(rewrite(sql),values),beginTransaction:()=>c.beginTransaction(),commit:()=>c.commit(),rollback:()=>c.rollback(),release:()=>c.release()};},end:()=>underlying.end()};
const {q,id,putEntity,settings,saveSettings,entity}=await import('../lib/db.mjs');
const {encrypt,createSession}=await import('../lib/security.mjs');
const media=await import('../lib/media.mjs');
const {VoiceSession}=await import('./voice-server.mjs');
const {mediaScene}=await import('../lib/media-scenes.mjs');
const {callModel}=await import('../lib/ai.mjs');
const require=createRequire(import.meta.url);
async function loadRoute(portal){const routeUrl=new URL(`../app/api/${portal}/route.js`,import.meta.url);const source=(await fs.readFile(routeUrl,'utf8')).replace(/from '([^']+)'/g,(whole,specifier)=>specifier==='next/server'?`from '${pathToFileURL(require.resolve(specifier)).href}'`:specifier.startsWith('.')?`from '${new URL(specifier,routeUrl).href}'`:whole);return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);}
const routes={app:await loadRoute('app'),admin:await loadRoute('admin')};
const {NextRequest}=await import('next/server.js');
const created=[],results=[],requests=[],originalFetch=globalThis.fetch;
const config={voiceEnabled:true,imageEnabled:true,recordingEnabled:true,visionModelId:'chat-a',chatModelId:'chat-a',transcriptionModelId:'asr-a',ttsModelId:'tts-a',voice:'alloy'};
const admin={id:id()},user={id:id()};let failure;
async function api(actor,body,expected=200){const get=typeof body==='string',portal=(get?body.includes('resource=admin'):body.action?.startsWith('admin.'))?'admin':'app';const req=new NextRequest(`http://127.0.0.1:3061/api/${portal}${get?body:''}`,{method:get?'GET':'POST',headers:{cookie:`${portal==='admin'?'zhixu_admin_session':'zhixu_session'}=${actor.token}`,...(get?{}:{'Content-Type':'application/json'})},...(get?{}:{body:JSON.stringify(body)})});const res=await routes[portal][get?'GET':'POST'](req),data=await res.json();assert.equal(res.status,expected,`${get?body:body.action}: ${data.error||res.status}`);return data;}
async function save(data,expected=200,actor=admin){return api(actor,{action:'admin.save',entity:'settings',data},expected);}
async function test(name,requirements,run){const start=Date.now();const evidence=await run();results.push({name,requirements,passed:true,ms:Date.now()-start,evidence});console.log('PASS',name);}
globalThis.fetch=async(url,options)=>{
 const u=new URL(url);assert.equal(u.origin,'https://example.com','Test must never contact a real AI provider');
 const body=options.body instanceof FormData?Object.fromEntries([...options.body.entries()].filter(([key])=>key!=='file')):JSON.parse(options.body);
 requests.push({path:u.pathname,...body});
 if(u.pathname.endsWith('/audio/transcriptions'))return Response.json({text:'Fixture speech transcript.',usage:{total_tokens:8}});
 if(u.pathname.endsWith('/audio/speech'))return new Response(Buffer.from([0,1,0,2,0,3,0,4]),{headers:{'Content-Type':'audio/pcm'}});
 return Response.json({choices:[{message:{content:'Fixture assistant reply.'},finish_reason:'stop'}],usage:{total_tokens:12}});
};
try{
 for(let i=0;i<statements.length;i++){await underlying.execute(rewrite(statements[i]));created.push(tables[i]);}
 for(const [actor,role] of [[admin,'admin'],[user,'user']]){await q('INSERT INTO users (id,email,name,password_hash,role,credits) VALUES (?,?,?,?,?,?)',[actor.id,role+'@example.test','配置隔离验收','!no-login',role,20]);actor.token=await createSession(actor.id,role==='admin'?'admin':'user');}
 for(const suffix of ['a','b'])for(const [kind,capability] of [['chat','chat'],['asr','transcription'],['tts','speech']])await putEntity('model',{id:`${kind}-${suffix}`,name:`Fixture ${kind} ${suffix}`,baseUrl:'https://example.com/v1',model:`fixture-${kind}-${suffix}`,capability,enabled:true,isDefault:kind==='chat'&&suffix==='a',apiKey:encrypt('fixture-no-network-key')});
 await saveSettings({siteName:'配置验收',description:'original',payment:{manualEnabled:true},media:config,apk:{}});
 await test('Ordinary users cannot change media settings and rejected writes preserve configuration',['F-084','F-161'],async()=>{await save({media:{...config,voice:'nova'}},401,user);assert.deepEqual((await settings()).media,config);return {httpStatus:401,unchanged:true};});
 await test('Invalid switches, voices, missing/disabled models and mismatched capabilities are rejected atomically',['F-161','F-162','F-163'],async()=>{
  await putEntity('model',{...(await entity('model','chat-b')),enabled:false});
  for(const change of [{voiceEnabled:'false'},{voice:'invalid'},{visionModelId:'missing'},{chatModelId:'chat-b'},{ttsModelId:'asr-a'},{transcriptionModelId:'tts-a'}]){await save({media:{...config,...change}},400);assert.deepEqual((await settings()).media,config);}
  await putEntity('model',{...(await entity('model','chat-b')),enabled:true});return {invalidWrites:6,unchanged:true};
 });
 await test('Each capability can be disabled and enabled independently through the actual settings handler',['F-162'],async()=>{
  const fields=[['voiceEnabled','voice'],['imageEnabled','image'],['recordingEnabled','transcribe']];
  for(const [field,capability] of fields){await save({media:{...config,[field]:false}});assert.deepEqual((await media.mediaConfig()).capabilities,{voice:true,image:true,transcribe:true,[capability]:false});const read=(await api(admin,'?resource=admin')).settings.media;assert.equal(read[field],false);await save({media:config});assert.deepEqual((await media.mediaConfig()).capabilities,{voice:true,image:true,transcribe:true});}
  return {independentToggles:3,readback:true};
 });
 await test('Disabled image, recording and already connected voice turns stop before provider requests or charging',['F-162'],async()=>{
  await save({media:{...config,voiceEnabled:false,imageEnabled:false,recordingEnabled:false}});const before=requests.length;
  await assert.rejects(media.runMediaVision(user.id,{sceneId:'homework',assetIds:[]}),error=>error.status===503);
  await assert.rejects(media.runMediaTranscription(user.id,{sceneId:'class-notes',assetId:id()}),error=>error.status===503);
  const events=[],socket={readyState:WebSocket.OPEN,bufferedAmount:0,send:raw=>events.push(JSON.parse(raw)),close:()=>{}};
  const session=new VoiceSession({socket,user,scene:mediaScene('english-free'),conversationId:id()});await session.turn({pcm:Buffer.alloc(24000),endedAt:Date.now()});await session.end();
  assert(events.some(event=>event.type==='error'&&event.message.includes('已暂停')));assert.equal(requests.length,before);assert.equal(Number((await q('SELECT credits FROM users WHERE id=?',[user.id]))[0].credits),20);assert.equal(Number((await q('SELECT COUNT(*) n FROM media_operations'))[0].n),0);
  await save({media:config});return {providerCalls:0,reservations:0,creditsUnchanged:true};
 });
 await test('Changing all model bindings and voice affects the next actual service invocation without a process restart',['F-161','F-163'],async()=>{
  for(const suffix of ['a','b']){
   const voice=suffix==='a'?'alloy':'nova';await save({media:{...config,visionModelId:`chat-${suffix}`,chatModelId:`chat-${suffix}`,transcriptionModelId:`asr-${suffix}`,ttsModelId:`tts-${suffix}`,voice}});
   const start=requests.length;await media.mediaChat({userId:user.id,messages:[{role:'user',content:'fixture image'}],vision:true});await media.mediaChat({userId:user.id,messages:[{role:'user',content:'fixture voice'}]});await media.transcribeAudio({userId:user.id,bytes:media.pcmWav(Buffer.alloc(9600))});await media.synthesizeSpeech({userId:user.id,text:'Fixture.'});
   const captured=requests.slice(start);assert.deepEqual(captured.map(x=>x.model),[`fixture-chat-${suffix}`,`fixture-chat-${suffix}`,`fixture-asr-${suffix}`,`fixture-tts-${suffix}`]);assert.equal(captured[3].voice,voice);assert.equal(captured[3].response_format,'pcm');
  }
  return {modelBindingChanges:4,voices:['alloy','nova'],capturedProviderCalls:8,transport:'mocked; no paid AI calls'};
 });
 await test('Disabled bound model makes the corresponding public capabilities unavailable',['F-104','F-161'],async()=>{
  await putEntity('model',{...(await entity('model','chat-b')),enabled:false});assert.deepEqual((await media.mediaConfig()).capabilities,{voice:false,image:false,transcribe:true});const before=requests.length;await assert.rejects(media.mediaChat({userId:user.id,messages:[{role:'user',content:'blocked'}]}),error=>error.status===503);assert.equal(requests.length,before);await putEntity('model',{...(await entity('model','chat-b')),enabled:true});return {providerCallsWhileDisabled:0};
 });
 await test('Replacing the default model clears the previous default and the next ordinary chat uses the replacement',['F-105'],async()=>{
  await api(admin,{action:'admin.save',entity:'model',data:{id:'chat-b',isDefault:true}});assert.equal((await entity('model','chat-a')).isDefault,false);assert.equal((await entity('model','chat-b')).isDefault,true);const start=requests.length;await callModel({userId:user.id,messages:[{role:'user',content:'Default model fixture'}],maxTokens:128});assert.equal(requests[start].model,'fixture-chat-b');return {uniqueDefault:true,transport:'mocked provider'};
 });
 await test('Site settings persist and appear in the public bootstrap without replacing media or payment configuration',['F-114'],async()=>{
  const before=await settings();const updated={siteName:'隔离站点名称',description:'隔离描述',announcement:'隔离公告',supportContact:'support@example.test'};await save(updated);const next=await settings();for(const [key,value] of Object.entries(updated))assert.equal(next[key],value);assert.deepEqual(next.media,before.media);assert.deepEqual(next.payment,before.payment);const publicData=await api(user,'?resource=bootstrap');for(const [key,value] of Object.entries(updated))assert.equal(publicData.settings[key],value);return {fieldsSaved:4,unrelatedSettingsPreserved:true};
 });
}catch(error){failure={message:error.message,stack:error.stack};console.error(error.stack);process.exitCode=1;}
finally{
 globalThis.fetch=originalFetch;for(const name of [...created].reverse())await underlying.execute(`DROP TABLE IF EXISTS ${prefix}${name}`);await underlying.end();
 await fs.writeFile(new URL('../docs/tests/media-settings-results.json',import.meta.url),JSON.stringify({testedAt:new Date().toISOString(),scope:'Actual Next route handler and database/service logic using isolated MySQL tables; provider transport captured, no browser or real AI inference',results,passed:results.length,failure,cleanup:'All isolated tables removed; production configuration and accounts unchanged'},null,2));
}
