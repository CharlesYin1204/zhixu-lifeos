import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {q,pool} from '../lib/db.mjs';

const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3061';
const report=[],root=process.cwd(),stamp=Date.now();
const sdk=process.env.ANDROID_BUILD_TOOLS||'/opt/gaoqiu-android/android-15';
const manifestPath=path.join(root,'public/downloads/build.json');
const releaseConfig={versionName:process.env.APK_RELEASE_VERSION_NAME||'1.1.2',versionCode:Number(process.env.APK_RELEASE_VERSION_CODE||5),serverUrl:process.env.APK_RELEASE_SERVER_URL||'https://xuexi.yinchao1204.vip/'};
const sentinel=path.join(root,`private/apk-download-sentinel-${stamp}`);
const symlink=path.join(root,'public/downloads/zhixu-lifeos-9.9.9-999999.apk');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
let userId,artifact,buildStates=[],fixturesCleaned=false;
function client(endpoint='/api/app') {
 let cookie='';
 return async function request(body,expected=200) {
  const get=typeof body==='string';
  const response=await fetch(base+endpoint+(get?body:''),{
   method:get?'GET':'POST',headers:{'Content-Type':'application/json',cookie},
   ...(get?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)
  });
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  const data=await response.json();
  assert.equal(response.status,expected,JSON.stringify(data));
  return data;
 };
}
const anon=client('/api/admin'),user=client(),admin=client('/api/admin');
async function test(name,fn) {
 const started=Date.now();
 const evidence=await fn();
 report.push({name,passed:true,ms:Date.now()-started,...(evidence?{evidence}:{})});
 console.log('PASS',name);
}
function tool(name,args) {
 return execFileSync(path.join(sdk,name),args,{encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024});
}
try {
 await test('Only administrators can trigger Android builds',async()=>{
  await anon({action:'admin.apk.build'},401);
  const account=await user({action:'auth.register',email:`apk-qa-${stamp}@example.test`,name:'安卓验收临时用户',password:crypto.randomBytes(24).toString('base64url')});
  userId=account.user.id;
  await user({action:'admin.apk.build'},403);
  await user('?resource=admin',403);
  await admin({action:'auth.login',email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});
  return {anonymousStatus:401,userStatus:403,administratorLogin:true};
 });
 await test('Invalid APK configuration is rejected before saving or starting a build',async()=>{
  await admin({action:'admin.save',entity:'settings',data:{apk:{versionCode:0}}},400);
  await admin({action:'admin.apk.build',config:{serverUrl:'javascript:alert(1)'}},400);
  return {invalidConfigurationStatus:400};
 });
 await test('A failed build reports its error and retains the true published release metadata',async()=>{
  const release=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  const lock=path.join(root,'private/apk-build.lock');
  await fs.writeFile(lock,String(process.pid),{flag:'wx',mode:0o600});
  try {
   await admin({action:'admin.apk.build',config:{versionName:'9.9.9',versionCode:999999}});
   let state;
   for(let n=0;n<30;n++){state=(await admin('?resource=admin')).settings.apk;if(state.buildStatus!=='building')break;await new Promise(resolve=>setTimeout(resolve,500));}
   assert.equal(state.buildStatus,'failed');
   assert(state.error.includes('另一个 APK 构建正在运行'));
   assert.equal(state.versionName,'9.9.9');
   assert.equal(state.published.versionName,release.versionName);
   assert.equal(state.published.sha256,release.sha256);
   assert.equal(await fs.readFile(manifestPath,'utf8'),JSON.stringify(release,null,2)+'\n');
   const response=await fetch(base+state.published.downloadUrl);
   assert.equal(digest(Buffer.from(await response.arrayBuffer())),release.sha256);
   return {buildStatus:state.buildStatus,errorReported:true,publishedVersion:release.versionName,releaseUnchanged:true};
  } finally {await fs.rm(lock,{force:true});}
 });
 await test('Administrator build completes asynchronously under production service account',async()=>{
  const before=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  const config={...Object.fromEntries(['appName','packageId'].map(key=>[key,before[key]])),...releaseConfig};
  assert(config.versionCode>=before.versionCode,'The APK test must not downgrade a newer published release');
  assert.equal(new URL(config.serverUrl).protocol,'https:');
  const result=await admin({action:'admin.apk.build',config});
  assert.equal(result.status,'building');
  buildStates.push({status:result.status,source:'build-response',at:new Date().toISOString()});
  const started=Date.now();
  while(Date.now()-started<120000) {
   const current=(await admin('?resource=admin')).settings.apk;
   if(buildStates.at(-1).status!==current.buildStatus)buildStates.push({status:current.buildStatus,source:'admin-resource',at:new Date().toISOString()});
   if(current.buildStatus==='ready') {artifact=current.published||current;break;}
   assert.equal(current.buildStatus,'building',JSON.stringify(current));
   await new Promise(resolve=>setTimeout(resolve,750));
  }
  assert(artifact,'Build did not finish in 120 seconds');
  assert.notEqual(artifact.builtAt,before.builtAt);
  assert.equal(artifact.certificateSha256,before.certificateSha256);
  for(const [key,value] of Object.entries(config))assert.equal(artifact[key],value);
  const owner=await fs.stat(path.join(root,'public/downloads',artifact.filename));
  const uid=Number(execFileSync('id',['-u','zhixu'],{encoding:'utf8'}).trim());
  assert.equal(owner.uid,uid);
  return {buildStates,uid,versionName:artifact.versionName,versionCode:artifact.versionCode};
 });
 await test('Actual APK hashes match manifest and latest version',async()=>{
  artifact=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  const version=await fs.readFile(path.join(root,'public/downloads',artifact.filename));
  const latest=await fs.readFile(path.join(root,'public/downloads/zhixu-lifeos.apk'));
  assert.equal(version.byteLength,artifact.size);
  assert.equal(digest(version),artifact.sha256);
  assert.equal(digest(latest),artifact.sha256);
  return {sha256:artifact.sha256,size:artifact.size};
 });
 await test('APK v1 v2 v3 signatures verify with the retained certificate',async()=>{
  const output=tool('apksigner',['verify','--verbose','--print-certs',path.join(root,'public/downloads',artifact.filename)]);
  for(const version of ['v1','v2','v3'])assert(new RegExp(`Verified using ${version} scheme .*true`).test(output));
  assert.equal(output.match(/certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1],artifact.certificateSha256);
  return {certificateSha256:artifact.certificateSha256,signatureSchemes:['v1','v2','v3'],verifierOutput:output.trim()};
 });
 await test('APK alignment and Android package metadata match configured values',async()=>{
  const file=path.join(root,'public/downloads',artifact.filename);
  tool('zipalign',['-c','-p','4',file]);
  const badging=tool('aapt',['dump','badging',file]);
  assert(badging.includes(`name='${artifact.packageId}' versionCode='${artifact.versionCode}' versionName='${artifact.versionName}'`));
  assert(badging.includes(`application-label:'${artifact.appName}'`));
  assert(badging.includes("sdkVersion:'23'"));
  assert(badging.includes("targetSdkVersion:'28'"));
  assert.deepEqual([...badging.matchAll(/uses-permission: name='([^']+)'/g)].map(match=>match[1]).sort(),['android.permission.CAMERA','android.permission.INTERNET','android.permission.RECORD_AUDIO']);
  for(const feature of ['android.hardware.microphone','android.hardware.camera','android.hardware.camera.any','android.hardware.camera.autofocus'])assert(badging.includes(`uses-feature-not-required: name='${feature}'`),`Optional feature missing: ${feature}`);
  return {alignmentBytes:4,packageMetadata:badging.trim()};
 });
 await test('HTTPS manifest and DEX contain scoped media permissions, private capture provider and state restoration',async()=>{
  const file=path.join(root,'public/downloads',artifact.filename);
  const xml=tool('aapt',['dump','xmltree',file,'AndroidManifest.xml']);
  assert(/android:usesCleartextTraffic[^\n]*0x0\b/.test(xml),'HTTPS APK must disable cleartext traffic');
  const provider=xml.slice(xml.indexOf('E: provider'));
  assert(provider.includes('com.zhixu.lifeos.shell.MainActivity$CaptureProvider'));
  assert(provider.includes(`${artifact.packageId}.capture`));
  assert(/android:exported[^\n]*0x0\b/.test(provider));
  assert(/android:grantUriPermissions[^\n]*0xffffffff\b/.test(provider));
  const dex=execFileSync('unzip',['-p',file,'classes.dex'],{maxBuffer:4*1024*1024}).toString('latin1');
  for(const marker of ['Lcom/zhixu/lifeos/shell/MainActivity$CaptureProvider;','Lcom/zhixu/lifeos/shell/NativeDownloads;','android.webkit.resource.AUDIO_CAPTURE','android.webkit.resource.VIDEO_CAPTURE','onRequestPermissionsResult','restoreState','saveState','pending_capture','android.intent.action.CREATE_DOCUMENT','setInstanceFollowRedirects','download_cache','readAsDataURL'])assert(dex.includes(marker),`DEX capability missing: ${marker}`);
  assert(dex.includes(artifact.serverUrl));assert(dex.includes(`ZhixuLifeOS/${artifact.versionName}`));
  return {serverUrl:artifact.serverUrl,cleartextDisabled:true,providerExported:false,scopedUriGrants:true,mediaPermissionCallbacksPresent:true,webViewStateRestorationPresent:true,deviceExecutionTested:false};
 });
 await test('Signing material stays private and invalid configs do not replace the released APK',async()=>{
  const files=['private/android-signing.jks','private/android-signing.pass'];
  for(const file of files)assert.equal((await fs.stat(file)).mode&0o777,0o600);
  const before=await fs.readFile(manifestPath,'utf8');
  for(const config of [{versionName:'../../escape'},{serverUrl:'javascript:alert(1)'},{versionCode:0}]) {
   const child=spawnSync(process.execPath,['scripts/build-apk.mjs'],{cwd:root,encoding:'utf8',timeout:10000,env:{...process.env,APK_CONFIG_JSON:JSON.stringify(config)}});
   assert.equal(child.status,1);
   assert(child.stderr.includes('APK 构建失败'));
  }
  assert.equal(await fs.readFile(manifestPath,'utf8'),before);
  return {signingFilesMode:'0600',rejectedInputs:3,releaseUnchanged:true};
 });
 await test('Public download returns freshly generated version and latest alias with identical hashes',async()=>{
  const downloads=[];
  for(const url of [artifact.downloadUrl,artifact.latestDownloadUrl]) {
   const response=await fetch(base+url,{signal:AbortSignal.timeout(20000)});
   assert.equal(response.status,200);
   assert.equal(response.headers.get('content-type'),'application/vnd.android.package-archive');
   assert.equal(response.headers.get('cache-control'),'no-store');
   assert(response.headers.get('content-disposition').startsWith('attachment;'));
   const bytes=Buffer.from(await response.arrayBuffer());
   assert.equal(bytes.byteLength,artifact.size);
   assert.equal(digest(bytes),artifact.sha256);
   downloads.push({url,status:response.status,size:bytes.byteLength,sha256:digest(bytes)});
  }
  const manifest=await fetch(base+'/api/download?file=build.json');
  assert.equal(manifest.status,200);
  assert.deepEqual(await manifest.json(),artifact);
  return {downloads,manifestMatches:true};
 });
 await test('Public download rejects directory traversal, arbitrary files and symlink escape',async()=>{
  const denied=['../private/android-signing.pass','../../.env.local','android-signing.jks','/etc/passwd','missing.apk'];
  for(const file of denied)assert.equal((await fetch(base+'/api/download?file='+encodeURIComponent(file))).status,404);
  await fs.writeFile(sentinel,'non-secret APK download test sentinel',{mode:0o644,flag:'wx'});
  await fs.symlink(sentinel,symlink);
  assert.equal((await fetch(base+'/api/download?file='+path.basename(symlink))).status,404);
  return {deniedNames:denied,symlinkEscapeStatus:404};
 });
 await test('Configured public server serves the released APK through its advertised address',async()=>{
  const url=new URL(artifact.downloadUrl,artifact.serverUrl).href;
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(digest(bytes),artifact.sha256);
  assert.equal(bytes.byteLength,artifact.size);
  return {url,status:response.status,sha256:digest(bytes),size:bytes.byteLength};
 });
 await admin({action:'auth.logout'});
} catch(error) {
 report.push({passed:false,error:error.stack});
 console.error(error);
 process.exitCode=1;
} finally {
 await fs.rm(symlink,{force:true});
 await fs.rm(sentinel,{force:true});
 if(userId) {
  for(const table of ['sessions','audit'])await q(`DELETE FROM ${table} WHERE user_id=?`,[userId]);
  await q('DELETE FROM users WHERE id=?',[userId]);
 }
 fixturesCleaned=true;
 await fs.mkdir('docs/tests',{recursive:true});
 const result={
  testedAt:new Date().toISOString(),base,command:'TEST_BASE_URL='+base+' node --env-file=.env.local scripts/test-apk.mjs',
  passed:report.filter(item=>item.passed).length,failed:report.filter(item=>item.passed===false).length,
  fixturesCleaned,artifact,results:report,
  deviceAcceptance:{tested:false,reason:'No attached Android device or emulator; installation and native device behavior have not been claimed.'}
 };
 await fs.writeFile('docs/tests/apk-results.json',JSON.stringify(result,null,2)+'\n');
 await fs.writeFile('docs/tests/android-release-results.json',JSON.stringify(result,null,2)+'\n');
 await pool.end();
}
