import http from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import WebSocket from 'next/dist/compiled/ws/index.js';
import {q,pool} from '../lib/db.mjs';
import {AppError,assert,sessionUser,limit} from '../lib/security.mjs';
import {mediaScene} from '../lib/media-scenes.mjs';
import {requireMediaOrigin,mediaConfig,mediaSettings,createVoiceConversation,mediaConversation,reserveMediaCharge,refundMediaCharge,recoverMediaCharges,saveMediaExchange,transcribeAudio,mediaChat,synthesizeSpeech,pcmWav} from '../lib/media.mjs';
const {WebSocketServer}=WebSocket;

// PCM16 at 24 kHz. Durations are based on decoded sample counts, not arrival timing.
export class VoiceActivityDetector {
 constructor({threshold=0.012,minSpeechMs=250,silenceMs=700,maxSpeechMs=20000}={}){Object.assign(this,{threshold,minSpeechMs,silenceMs,maxSpeechMs});this.reset();}
 reset(){this.frames=[];this.pre=[];this.preBytes=0;this.active=false;this.voicedMs=0;this.elapsedMs=0;this.quietMs=0;this.cooldown=false;}
 push(pcm){
  const samples=pcm.length/2,ms=samples/24;let squares=0;for(let index=0;index<pcm.length;index+=2){const sample=pcm.readInt16LE(index)/32768;squares+=sample*sample;}const rms=Math.sqrt(squares/Math.max(1,samples)),voiced=rms>=this.threshold;let started=false;
  if(this.cooldown){this.quietMs=voiced?0:this.quietMs+ms;if(this.quietMs>=this.silenceMs)this.reset();return {rms};}
  if(!this.active){if(!voiced){this.pre.push(pcm);this.preBytes+=pcm.length;while(this.preBytes>9600&&this.pre.length>1)this.preBytes-=this.pre.shift().length;return {rms};}this.active=true;this.frames=[...this.pre];this.pre=[];this.preBytes=0;started=true;}
  this.frames.push(pcm);this.elapsedMs+=ms;if(voiced){this.voicedMs+=ms;this.quietMs=0;}else this.quietMs+=ms;
  if(this.quietMs>=this.silenceMs||this.elapsedMs>=this.maxSpeechMs){const full=this.elapsedMs>=this.maxSpeechMs,utterance=this.voicedMs>=this.minSpeechMs?Buffer.concat(this.frames):null;this.reset();this.cooldown=full;return {rms,started,utterance,maximumReached:full};}
  return {rms,started};
 }
}
function safeMessage(error){return error instanceof AppError?error.message:error?.name==='TimeoutError'?'语音处理超时，请再试一次':'语音服务暂时不可用，请稍后重试';}
const defaults={transcribeAudio,mediaChat,synthesizeSpeech,reserveMediaCharge,refundMediaCharge,saveMediaExchange,mediaConversation,mediaSettings};
export class VoiceSession {
 constructor({socket,user,scene,conversationId,services={},onEnd=()=>{}}){Object.assign(this,{socket,user,scene,conversationId,onEnd});this.services={...defaults,...services};this.detector=new VoiceActivityDetector();this.pending=null;this.active=null;this.processing=null;this.ended=false;this.messages=0;this.windowStart=Date.now();this.totalBytes=0;this.lastActivity=Date.now();}
 send(type,data={}){if(this.socket.readyState===WebSocket.OPEN&&this.socket.bufferedAmount<2*1024*1024)this.socket.send(JSON.stringify({type,...data}));else if(this.socket.bufferedAmount>=2*1024*1024)this.socket.close(1013,'Client too slow');}
 start(){this.send('ready',{conversationId:this.conversationId,voiceTransport:'cascade',sampleRate:24000,costPerTurn:1});this.send('status',{status:'listening'});}
 receive(raw){
  if(this.ended)return;this.lastActivity=Date.now();if(Date.now()-this.windowStart>=10000){this.windowStart=Date.now();this.messages=0;}assert(++this.messages<=600,'语音数据发送过快',429);
  let event;try{event=JSON.parse(String(raw));}catch{throw new AppError('语音消息格式无效');}assert(event&&typeof event==='object','语音消息格式无效');
  if(event.type==='interrupt'){this.interrupt();return;}
  if(event.type==='end'){void this.end();return;}
  assert(event.type==='audio.append','不支持的语音事件');assert(typeof event.audio==='string'&&event.audio.length>0&&event.audio.length<=64000&&/^[A-Za-z0-9+/]+={0,2}$/.test(event.audio)&&event.audio.length%4===0,'音频分片格式无效');
  const pcm=Buffer.from(event.audio,'base64');assert(pcm.length>0&&pcm.length<=48000&&pcm.length%2===0&&pcm.toString('base64')===event.audio,'音频须为 PCM16 单声道 24kHz');this.totalBytes+=pcm.length;assert(this.totalBytes<=60*1024*1024,'会话音频达到上限，请重新连接');
  const detection=this.detector.push(pcm);if(detection.started&&(this.active||this.pending))this.interrupt();if(detection.utterance){this.pending={pcm:detection.utterance,endedAt:Date.now()};this.drain();}
 }
 interrupt(){this.pending=null;if(this.active){this.active.controller.abort();this.send('interrupted');this.send('status',{status:'listening'});}}
 drain(){if(this.processing||this.ended)return;this.processing=(async()=>{while(this.pending&&!this.ended){const next=this.pending;this.pending=null;await this.turn(next);}})().catch(error=>{this.send('error',{message:safeMessage(error)});}).finally(()=>{this.processing=null;if(this.pending&&!this.ended)this.drain();});}
 async turn({pcm,endedAt}){
  const controller=new AbortController(),state={controller,chargeId:null,textSaved:false},metrics={};this.active=state;
  const live=()=>!this.ended&&this.active===state&&!controller.signal.aborted;
  try{
   const config=await this.services.mediaSettings();assert(config.voiceEnabled!==false,'语音互动已暂停',503);await limit(`media-voice-turn:${this.user.id}`,12,60000);controller.signal.throwIfAborted();state.chargeId=await this.services.reserveMediaCharge(this.user.id,'voice');controller.signal.throwIfAborted();this.send('status',{status:'thinking'});
   let start=Date.now();const recognized=await this.services.transcribeAudio({userId:this.user.id,bytes:pcmWav(pcm),signal:controller.signal,kind:'media_voice_asr',language:['english-free','travel-talk'].includes(this.scene.id)?'en':undefined});metrics.asrMs=Date.now()-start;controller.signal.throwIfAborted();this.send('user.transcript',{text:recognized.text});
   const conversation=await this.services.mediaConversation(this.user.id,this.conversationId,{sceneId:this.scene.id,mode:'voice'});start=Date.now();
   const answer=await this.services.mediaChat({userId:this.user.id,signal:controller.signal,maxTokens:350,messages:[{role:'system',content:this.scene.prompt+'\n这是语音交流，每轮只回复1–3个短句，提出一个自然追问。控制在80个英文单词或120个中文字以内；需要长篇解释时建议转到文字助手。'},...conversation.messages.slice(-20).map(message=>({role:message.role,content:message.content})),{role:'user',content:recognized.text}],onDelta:delta=>{if(live())this.send('assistant.transcript.delta',{delta});}});metrics.chatMs=Date.now()-start;controller.signal.throwIfAborted();
   await this.services.saveMediaExchange({userId:this.user.id,conversationId:this.conversationId,sceneId:this.scene.id,mode:'voice',userContent:recognized.text,assistantContent:answer.reply,chargeId:state.chargeId});state.textSaved=true;controller.signal.throwIfAborted();this.send('status',{status:'speaking'});start=Date.now();
   const speech=await this.services.synthesizeSpeech({userId:this.user.id,text:answer.reply,signal:controller.signal,onAudio:bytes=>{if(!live())return;if(metrics.firstAudioMs===undefined)metrics.firstAudioMs=Date.now()-endedAt;for(let offset=0;offset<bytes.length;offset+=48000)this.send('assistant.audio',{audio:bytes.subarray(offset,offset+48000).toString('base64'),sampleRate:24000});}});metrics.ttsMs=Date.now()-start;metrics.totalMs=Date.now()-endedAt;
   if(live())this.send('turn.completed',{conversationId:this.conversationId,audioAvailable:true,audioBytes:speech.size,metrics});
  }catch(error){if(!controller.signal.aborted&&!this.ended){this.send('error',{message:state.textSaved?'文字回复已保存，但朗读未完成。'+safeMessage(error):safeMessage(error)});if(state.textSaved)this.send('turn.completed',{conversationId:this.conversationId,audioAvailable:false,metrics});}}
  finally{if(state.chargeId&&!state.textSaved)await this.services.refundMediaCharge(state.chargeId);if(this.active===state)this.active=null;if(!this.ended&&!this.pending)this.send('status',{status:'listening'});}
 }
 async end(){if(this.ended)return;this.ended=true;this.pending=null;this.active?.controller.abort();this.detector.reset();if(this.processing)await this.processing;this.send('session.saved',{conversationId:this.conversationId});this.onEnd();if(this.socket.readyState===WebSocket.OPEN)this.socket.close(1000,'Session ended');}
}
async function socketUser(request){const cookies=Object.fromEntries(String(request.headers.cookie||'').split(';').map(value=>{const at=value.indexOf('=');return at<0?['','']:[value.slice(0,at).trim(),value.slice(at+1).trim()];}));return sessionUser({cookies:{get:key=>cookies[key]?{value:cookies[key]}:undefined}});}
export function createVoiceServer({port=Number(process.env.VOICE_PORT||3064),host='127.0.0.1',services={}}={}){
 const connections=new Map(),sessions=new Set();let stopping=false;
 const server=http.createServer((request,response)=>{if(request.url==='/health'){response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({ok:true,service:'zhixu-voice',transport:'cascade',connections:connections.size}));}else{response.writeHead(404);response.end();}});
 const sockets=new WebSocketServer({noServer:true,maxPayload:100000,perMessageDeflate:false});
 function deny(socket,status){if(!socket.destroyed){socket.write(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);socket.destroy();}}
 server.on('upgrade',async(request,socket,head)=>{
  let user,slot;
  try{
   assert(!stopping,'服务正在重启',503);const url=new URL(request.url,'http://localhost');assert(url.pathname==='/api/voice/live','路径不存在',404);requireMediaOrigin(request.headers.origin,true);user=await socketUser(request);assert(user,'请先登录',401);const scene=mediaScene(url.searchParams.get('scene')||'english-free','voice');assert(scene,'语音场景不存在');const config=await mediaConfig();assert(config.capabilities.voice,'语音服务暂未配置或已停用',503);await limit(`media-voice-connect:${user.id}`,8,60000);assert(!connections.has(user.id),'此账号已有语音会话，请先结束另一会话',409);assert(connections.size<16,'当前语音会话较多，请稍后重试',503);
   slot={};connections.set(user.id,slot);
   sockets.handleUpgrade(request,socket,head,async websocket=>{
    let session,ended=false;const cleanup=()=>{if(ended)return;ended=true;if(connections.get(user.id)===slot)connections.delete(user.id);if(session)sessions.delete(session);clearTimeout(deadline);clearInterval(accountCheck);};
    const deadline=setTimeout(()=>{session?.send('error',{message:'单次语音会话已满20分钟，请重新开始'});void session?.end();},20*60000);
    let checking=false;const accountCheck=setInterval(async()=>{if(checking||ended)return;checking=true;try{const current=await socketUser(request);if(!current){session?.send('error',{message:'登录已失效，请重新登录'});await session?.end();}else if(session&&Date.now()-session.lastActivity>120000){session.send('error',{message:'会话已空闲两分钟，请重新开始'});await session.end();}}catch{session?.send('error',{message:'账户状态暂时无法校验，请重新连接'});await session?.end();}finally{checking=false;}},30000);
    websocket.on('error',()=>{void session?.end();cleanup();});websocket.on('close',()=>{void session?.end();cleanup();});
    try{const conversationId=await createVoiceConversation(user.id,scene.id);if(websocket.readyState!==WebSocket.OPEN){cleanup();return;}session=new VoiceSession({socket:websocket,user,scene,conversationId,services,onEnd:cleanup});sessions.add(session);session.start();websocket.on('message',raw=>{try{session.receive(raw);}catch(error){session.send('error',{message:safeMessage(error)});void session.end();}});}catch(error){websocket.send(JSON.stringify({type:'error',message:safeMessage(error)}));websocket.close(1011,'Session initialization failed');cleanup();}
   });
  }catch(error){if(user&&slot&&connections.get(user.id)===slot)connections.delete(user.id);deny(socket,error.status||500);}
 });
 const recovery=setInterval(()=>recoverMediaCharges().catch(error=>console.error('Voice billing recovery:',error.code||error.name)),60000);recovery.unref();
 return {server,sockets,connections,listen:()=>new Promise(resolve=>server.listen(port,host,resolve)),close:async()=>{stopping=true;clearInterval(recovery);await Promise.allSettled([...sessions].map(session=>session.end()));for(const websocket of sockets.clients)websocket.terminate();await new Promise(resolve=>server.close(resolve));sockets.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await recoverMediaCharges();const app=createVoiceServer();await app.listen();console.log('Zhixu cascade voice server listening on 127.0.0.1:'+Number(process.env.VOICE_PORT||3064));
 let shutdown=false;const stop=async()=>{if(shutdown)return;shutdown=true;await app.close();await pool.end();process.exit(0);};process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
