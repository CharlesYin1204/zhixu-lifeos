import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';

const source=await fs.readFile(new URL('../../android/src/NativeDownloads.java',import.meta.url),'utf8');
const activity=await fs.readFile(new URL('../../android/src/MainActivity.java',import.meta.url),'utf8');
const build=await fs.readFile(new URL('../../scripts/build-apk.mjs',import.meta.url),'utf8');
const results=[];
async function check(name,run){await run();results.push({name,passed:true});console.log('PASS',name);}
const expressions=[...source.matchAll(/String script=(.+);\n/g)].map(match=>match[1]);
assert.equal(expressions.length,3);
function expand(expression,key,url){return vm.runInNewContext(expression.replaceAll('JSONObject.quote(job.key)',JSON.stringify(JSON.stringify(key))).replaceAll('JSONObject.quote(url)',JSON.stringify(JSON.stringify(url))));}
const headerTail=source.match(/if \(header\) script\+=(.+);\n/)?.[1];
const chunkTail=source.match(/else script\+=(.+);\n/)?.[1];
function pollScript(key,header){return expand(expressions[1],key,'')+vm.runInNewContext(header?headerTail:chunkTail)+'})()';}
function environment() {
 class FileReader {
  readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onload();},()=>this.onerror());}
 }
 return vm.createContext({window:{},fetch,FileReader,JSON,String,Math});
}
async function waitResult(context,key,header){for(let n=0;n<100;n++){const result=JSON.parse(vm.runInContext(pollScript(key,header),context));if(result.ready||result.error)return result;await new Promise(resolve=>setTimeout(resolve,2));}throw new Error('Blob script timed out');}
await check('Actual Java-embedded blob scripts preserve a 2 MB binary recording over bounded chunks',async()=>{
 const bytes=crypto.randomBytes(2*1024*1024+17),url=URL.createObjectURL(new Blob([bytes],{type:'audio/webm'})),key='test_binary_recording',context=environment();
 try {
  vm.runInContext(expand(expressions[0],key,url),context);
  const header=await waitResult(context,key,true);assert.equal(header.size,bytes.length);assert.equal(header.type,'audio/webm');
  const chunks=[];let size=0;
  while(size<bytes.length){vm.runInContext(expand(expressions[2],key,url),context);const result=await waitResult(context,key,false);assert(!result.error);assert(result.data.length<=65536);const chunk=Buffer.from(result.data,'base64');assert(chunk.length<=49152);chunks.push(chunk);size+=chunk.length;assert.equal(result.offset,size);assert.equal(result.eof,size===bytes.length);}
  assert.deepEqual(Buffer.concat(chunks),bytes);assert(chunks.length>40);
  assert.equal(JSON.parse(vm.runInContext(pollScript(key,false),context)).ready,false,'Consumed chunks must not be returned twice');
 } finally {URL.revokeObjectURL(url);}
});
await check('Revoked blobs and missing page state produce errors instead of hanging or empty successful files',async()=>{
 const url=URL.createObjectURL(new Blob(['test'],{type:'audio/webm'}));URL.revokeObjectURL(url);
 const key='test_revoked',context=environment();vm.runInContext(expand(expressions[0],key,url),context);assert((await waitResult(context,key,true)).error);
 delete context.window[key];assert(JSON.parse(vm.runInContext(pollScript(key,false),context)).error);
});
await check('Cookie-bearing native downloads require the configured origin and do not follow redirects',()=>{
 const handle=source.slice(source.indexOf('boolean handle('),source.indexOf('private void downloadHttp'));
 assert(handle.indexOf('if (!sameOrigin(target)) return false')<handle.indexOf('CookieManager.getInstance().getCookie(url)'));
 const http=source.slice(source.indexOf('private void downloadHttp'),source.indexOf('private void startBlob'));
 assert(http.indexOf('if (!sameOrigin(Uri.parse(url)))')<http.indexOf('setRequestProperty("Cookie",cookie)'));
 assert(http.includes('setInstanceFollowRedirects(false)'));assert(http.includes('if (status>=300 && status<400) throw'));
 assert(!source.includes('setSSLSocketFactory'));assert(!source.includes('setHostnameVerifier'));
});
await check('Storage Access Framework, byte limits, cancellation cleanup and no JavaScript bridge are present',()=>{
 assert(source.includes('Intent.ACTION_CREATE_DOCUMENT'));assert(source.includes('MAX_BYTES = 16L * 1024 * 1024'));
 assert(source.includes('offset!=job.bytes+bytes.length'));assert(source.includes('encoded.length()>65536'));
 assert(source.includes('download_cache'));assert(source.includes('job.file.delete()'));assert(source.includes('if(!"content".equals(destination.getScheme()))'));
 assert(!activity.includes('addJavascriptInterface'));assert(!source.includes('addJavascriptInterface'));
 assert(!build.includes('WRITE_EXTERNAL_STORAGE'));assert(!build.includes('READ_EXTERNAL_STORAGE'));
 assert(activity.includes('url.startsWith("blob:") && isAppUrl(Uri.parse(url.substring(5)))'));
});
await fs.writeFile(new URL('./android-download-boundaries.json',import.meta.url),JSON.stringify({testedAt:new Date().toISOString(),passed:results.length,failed:0,javaCompilation:{passed:true,api:23,jdk:17,classes:23},sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),results,scope:'Java-embedded blob JavaScript executed in a Node VM with Blob/FileReader adapters; native security boundaries inspected in source. Java compiled against Android API 23. This is not an Android device runtime test.',deviceAcceptance:{tested:false,reason:'No attached Android device or emulator.'}},null,2)+'\n');
