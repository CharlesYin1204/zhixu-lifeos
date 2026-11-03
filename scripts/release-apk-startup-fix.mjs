import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {q,pool,settings} from '../lib/db.mjs';
import {createSession,hashToken} from '../lib/security.mjs';

// Publishes the authorized Android repair through the real administrator API.
// No user records, provider calls, payment settings or signing keys are changed.
const base='https://xuexi.yinchao1204.vip';
const config={versionName:'1.1.2',versionCode:5,serverUrl:base+'/'};
const sdk=process.env.ANDROID_BUILD_TOOLS||'/opt/gaoqiu-android/android-15';
const report={startedAt:new Date().toISOString(),base,results:[],deviceAcceptance:{tested:false,reason:'No attached Android device or emulator. Device-specific blank-page cause remains unconfirmed.'}};
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
let token,artifact,previous,unchangedSettings;
async function check(name,run){const evidence=await run();report.results.push({name,passed:true,evidence});console.log('PASS',name);}
async function api(body){const read=typeof body==='string';const response=await fetch(base+'/api/admin'+(read?body:''),{method:read?'GET':'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:'zhixu_admin_session='+token},...(read?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});const data=await response.json();assert.equal(response.status,200,data.error||'Administrator request failed');return data;}
const tool=(name,args)=>execFileSync(path.join(sdk,name),args,{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
try{
 previous=JSON.parse(await fs.readFile('public/downloads/build.json','utf8'));
 assert(config.versionCode>previous.versionCode,'Refusing to overwrite or downgrade an existing published version');
 const before=await settings();const {apk,...other}=before;unchangedSettings=JSON.stringify(other);
 await fs.mkdir('private/apk-startup-repair',{recursive:true,mode:0o700});
 await fs.writeFile('private/apk-startup-repair/previous-manifest.json',JSON.stringify(previous,null,2),{mode:0o600});
 await fs.writeFile('private/apk-startup-repair/previous-apk-settings.json',JSON.stringify(apk,null,2),{mode:0o600});
 const user=(await q("SELECT id FROM users WHERE email=? AND role='admin' AND status='active'",[process.env.ADMIN_EMAIL]))[0];
 assert(user,'Configured administrator is unavailable');token=await createSession(user.id,'admin');
 await check('Production administrator build publishes the domain-based upgrade asynchronously',async()=>{
  const start=await api({action:'admin.apk.build',config:{...config,appName:previous.appName,packageId:previous.packageId}});assert.equal(start.status,'building');
  report.buildStates=[{status:'building',at:new Date().toISOString()}];
  for(let attempt=0;attempt<120;attempt++){
   await new Promise(resolve=>setTimeout(resolve,1000));
   const current=(await api('?resource=admin')).settings.apk;
   if(current.buildStatus==='ready'){artifact=current.published||current;report.buildStates.push({status:'ready',at:new Date().toISOString()});break;}
   assert.equal(current.buildStatus,'building',current.error||'Build failed');
  }
  assert(artifact,'Build timed out');for(const [key,value] of Object.entries(config))assert.equal(artifact[key],value);
  assert.equal(artifact.packageId,previous.packageId);assert.equal(artifact.certificateSha256,previous.certificateSha256);
  assert.equal((await fs.stat('public/downloads/'+artifact.filename)).uid,Number(execFileSync('id',['-u','zhixu'],{encoding:'utf8'}).trim()));
  return {versionName:artifact.versionName,versionCode:artifact.versionCode,serverUrl:artifact.serverUrl,productionServiceAccount:true};
 });
 const file=path.resolve('public/downloads',artifact.filename);
 await check('Signing certificate is unchanged and v1/v2/v3 signatures and alignment verify',async()=>{
  const text=tool('apksigner',['verify','--verbose','--print-certs',file]);
  for(const scheme of ['v1','v2','v3'])assert(new RegExp(`Verified using ${scheme} scheme .*true`).test(text));
  assert(text.includes(previous.certificateSha256));tool('zipalign',['-c','-p','4',file]);
  return {certificateSha256:artifact.certificateSha256,signatureSchemes:artifact.signatureSchemes,samePackageUpgrade:true};
 });
 await check('Manifest and DEX retain launch, media permissions and embed the new HTTPS domain',async()=>{
  const badging=tool('aapt',['dump','badging',file]);assert(badging.includes("versionCode='5'"));assert(badging.includes("launchable-activity: name='com.zhixu.lifeos.shell.MainActivity'"));
  for(const permission of ['INTERNET','RECORD_AUDIO','CAMERA'])assert(badging.includes('android.permission.'+permission));
  const xml=tool('aapt',['dump','xmltree',file,'AndroidManifest.xml']);assert(/usesCleartextTraffic.*0x0/.test(xml));
  const dex=execFileSync('unzip',['-p',file,'classes.dex'],{maxBuffer:4*1024*1024}).toString('latin1');
  assert(dex.includes(config.serverUrl));assert(!dex.includes('https://154.40.47.111:3063'));
  for(const marker of ['onReceivedHttpError','onReceivedSslError','onRequestPermissionsResult','onShowFileChooser','android.intent.action.CREATE_DOCUMENT'])assert(dex.includes(marker),marker);
  return {minSdk:artifact.minSdkVersion,targetSdk:artifact.targetSdkVersion,serverUrl:artifact.serverUrl,cleartextDisabled:true};
 });
 await check('Public versioned download, latest alias and manifest return identical new bytes',async()=>{
  const expected=await fs.readFile(file);assert.equal(digest(expected),artifact.sha256);assert.equal(expected.length,artifact.size);
  const urls=[artifact.downloadUrl,artifact.latestDownloadUrl];
  for(const url of urls){const response=await fetch(base+url);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-type'),'application/vnd.android.package-archive');assert.equal(digest(Buffer.from(await response.arrayBuffer())),artifact.sha256);}
  assert.deepEqual(await(await fetch(base+'/api/download?file=build.json')).json(),artifact);
  return {urls,sha256:artifact.sha256,size:artifact.size};
 });
 await check('Homepage and public/account metadata advertise the new release while the previous APK remains intact',async()=>{
  const html=await(await fetch(base+'/')).text();assert(html.includes(artifact.downloadUrl.replaceAll('&','&amp;')));assert(html.includes(artifact.versionName));
  const publicData=await(await fetch(base+'/api/app?resource=bootstrap')).json();const visible=publicData.settings.apk.published||publicData.settings.apk;assert.equal(visible.sha256,artifact.sha256);
  const old=await fs.readFile(path.join('public/downloads',previous.filename));assert.equal(digest(old),previous.sha256);
  const current=await settings();const {apk,...other}=current;assert.equal(JSON.stringify(other),unchangedSettings);assert.equal(apk.serverUrl,config.serverUrl);assert.equal(apk.versionCode,config.versionCode);
  return {publicVersion:visible.versionName,previousArtifactRetained:true,otherSettingsUnchanged:true};
 });
 report.passed=true;report.artifact=artifact;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error.message);}
finally{
 if(token)await q('DELETE FROM sessions WHERE token_hash=? AND scope=?',[hashToken(token),'admin']);
 report.administratorTestSessionRemoved=true;report.completedAt=new Date().toISOString();
 await fs.writeFile('docs/tests/apk-startup-release-results.json',JSON.stringify(report,null,2));await pool.end();
 console.log('RESULT',JSON.stringify({passed:report.passed,checks:report.results.length,version:artifact?.versionName,deviceTested:false}));
}
