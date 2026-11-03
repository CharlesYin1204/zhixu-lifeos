import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {q,pool} from '../lib/db.mjs';

const base='http://127.0.0.1:3060';
const stateFile='private/restart-verification.json';
const pid=service=>Number(execFileSync('systemctl',['show',service,'--property=MainPID','--value'],{encoding:'utf8'}).trim());
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let cookie='';
async function api(body){const get=typeof body==='string';const r=await fetch(base+'/api/app'+(get?body:''),{method:get?'GET':'POST',headers:{'Content-Type':'application/json',cookie},...(!get?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200);const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return r.json();}

if(process.argv[2]==='prepare'){
 const account=await api({action:'auth.register',name:'重启持久化验收',email:`restart-${Date.now()}@example.test`,password:crypto.randomBytes(24).toString('base64url')});
 const {record}=await api({action:'record.save',kind:'note',title:'重启前保存的验收记录',content:'服务重启后，这段内容与登录会话必须保留。'});
 await fs.writeFile(stateFile,JSON.stringify({cookie,userId:account.user.id,recordId:record.id,content:record.content,webPid:pid('zhixu-web'),workerPid:pid('zhixu-worker'),preparedAt:new Date().toISOString()}),{mode:0o600});
 console.log('Persistent record and session prepared; credentials were not printed.');
}else if(process.argv[2]==='verify'){
 const saved=JSON.parse(await fs.readFile(stateFile,'utf8'));cookie=saved.cookie;
 const results=[];
 try{
  const webPid=pid('zhixu-web'),workerPid=pid('zhixu-worker');
  assert(webPid>0&&webPid!==saved.webPid);assert(workerPid>0&&workerPid!==saved.workerPid);
  results.push({name:'Production deployment restarted web and worker processes',passed:true,before:{webPid:saved.webPid,workerPid:saved.workerPid},after:{webPid,workerPid}});
  const data=await api('?resource=bootstrap');
  assert.equal(data.user.id,saved.userId);assert.equal(data.records.find(r=>r.id===saved.recordId)?.content,saved.content);
  results.push({name:'Database record and authenticated session survive service restart',passed:true});
  execFileSync('systemctl',['kill','--kill-who=main','--signal=SIGKILL','zhixu-web.service']);
  let recovered=false,newPid=0;
  for(let attempt=0;attempt<30;attempt++){
   await delay(1000);
   try{newPid=pid('zhixu-web');if(newPid&&newPid!==webPid&&(await api('?resource=health')).ok){recovered=true;break;}}catch{}
  }
  assert(recovered,'Web service did not automatically recover');
  const after=await api('?resource=bootstrap');assert.equal(after.user.id,saved.userId);assert(after.records.some(r=>r.id===saved.recordId));
  results.push({name:'systemd automatically recovers an unexpectedly terminated web process',passed:true,beforePid:webPid,afterPid:newPid});
  const publicHealth=await fetch('http://154.40.47.111:3060/api/app?resource=health');assert.equal(publicHealth.status,200);assert.equal((await publicHealth.json()).database,'connected');
  results.push({name:'Advertised IP and port serve healthy database-connected API after recovery',passed:true,requestOrigin:'deployment server'});
 }catch(error){results.push({name:'Restart verification',passed:false,error:error.message});process.exitCode=1;}
 finally{
  for(const table of ['sessions','records','conversations','runs','orders','installs','usage_logs','audit'])await q(`DELETE FROM ${table} WHERE user_id=?`,[saved.userId]);
  await q('DELETE FROM users WHERE id=?',[saved.userId]);await fs.rm(stateFile,{force:true});
  await fs.writeFile('docs/tests/restart-results.json',JSON.stringify({testedAt:new Date().toISOString(),preparedAt:saved.preparedAt,results},null,2));
  console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length}));
 }
}else throw new Error('Usage: node scripts/test-restart.mjs prepare|verify');
await pool.end();
