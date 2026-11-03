import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Pure origin/URL policy checks. A rejecting database adapter and fetch guard
// ensure no database connection, provider request or production mutation occurs.
const keys=['APP_URL','SECURE_APP_URL','MEDIA_ALLOWED_ORIGINS','MEDIA_TEST_ORIGIN','NODE_ENV'];
const environment=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
const originalPool=globalThis.__zhixuPool,originalFetch=globalThis.fetch;
let databaseCalls=0,providerCalls=0;
globalThis.__zhixuPool={execute(){databaseCalls++;throw new Error('Database access is forbidden in this origin test');}};
globalThis.fetch=async()=>{providerCalls++;throw new Error('Provider/network access is forbidden in this origin test');};
const report={testedAt:new Date().toISOString(),scope:'Isolated actual media origin and secure-entry functions; no database, browser, services or provider calls',results:[]};
const domain='https://xuexi.yinchao1204.vip',secureIp='https://154.40.47.111:3063',httpIp='http://154.40.47.111:3060';
function baseline(){process.env.APP_URL=httpIp;process.env.SECURE_APP_URL=domain;process.env.MEDIA_ALLOWED_ORIGINS=secureIp;process.env.NODE_ENV='production';delete process.env.MEDIA_TEST_ORIGIN;}
async function test(name,run){baseline();await run();report.results.push({name,passed:true});console.log('PASS',name);}
try{
 const {mediaOrigins,requireMediaOrigin,mediaSecureUrl}=await import('../lib/media.mjs');
 await test('Configured HTTPS domain and both existing IP origins remain accepted',()=>{
  assert.deepEqual([...mediaOrigins()].sort(),[domain,secureIp,httpIp].sort());
  for(const origin of [domain,secureIp,httpIp]){assert.doesNotThrow(()=>requireMediaOrigin(origin));assert.doesNotThrow(()=>requireMediaOrigin(origin,true));}
 });
 await test('Voice requires an Origin while existing optional-Origin HTTP behavior remains unchanged',()=>{
  for(const origin of [undefined,null,'']){assert.throws(()=>requireMediaOrigin(origin,true),error=>error.status===403);assert.doesNotThrow(()=>requireMediaOrigin(origin,false));}
 });
 await test('Unconfigured domains, deceptive suffixes, wrong schemes and non-configured ports are denied',()=>{
  for(const origin of ['https://evil.example',domain+'.evil.example','https://xuexi.yinchao1204.vip.evil.example','https://evilxuexi.yinchao1204.vip',domain+':8443','http://xuexi.yinchao1204.vip','https://154.40.47.111','https://154.40.47.111:3060','null','*'])assert.throws(()=>requireMediaOrigin(origin,true),error=>error.status===403);
 });
 await test('Server configured comma-separated values trim blanks and normalize duplicate origins',()=>{
  process.env.MEDIA_ALLOWED_ORIGINS=` ${secureIp}/, , ${domain}:443/, ${secureIp} `;
  assert.deepEqual([...mediaOrigins()].sort(),[domain,secureIp,httpIp].sort());
 });
 await test('Invalid configured origins fail closed instead of accepting wildcard, path or credential patterns',()=>{
  for(const value of ['*','https://*.yinchao1204.vip','https://user:password@example.test','https://example.test/path','https://example.test?allow=all','https://example.test#fragment','file:///tmp/site','not-a-url']){process.env.MEDIA_ALLOWED_ORIGINS=value;assert.throws(()=>mediaOrigins(),error=>error.status===500);}
 });
 await test('Unset optional configuration preserves legacy IP access and returns the canonical secure media URL',()=>{
  assert.equal(mediaSecureUrl(),domain+'/user?view=media');process.env.SECURE_APP_URL=domain+'/';assert.equal(mediaSecureUrl(),domain+'/user?view=media');
  delete process.env.SECURE_APP_URL;delete process.env.MEDIA_ALLOWED_ORIGINS;assert.deepEqual([...mediaOrigins()].sort(),[httpIp,secureIp].sort());assert.equal(mediaSecureUrl(),secureIp+'/user?view=media');
 });
 await test('Test-only origins remain unavailable in production and only activate in the test environment',()=>{
  process.env.MEDIA_TEST_ORIGIN='http://127.0.0.1:3199';assert.throws(()=>requireMediaOrigin(process.env.MEDIA_TEST_ORIGIN,true),error=>error.status===403);
  process.env.NODE_ENV='test';assert.doesNotThrow(()=>requireMediaOrigin(process.env.MEDIA_TEST_ORIGIN,true));
 });
 assert.equal(databaseCalls,0);assert.equal(providerCalls,0);report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error.message);}
finally{
 for(const [key,value] of Object.entries(environment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 if(originalPool===undefined)delete globalThis.__zhixuPool;else globalThis.__zhixuPool=originalPool;
 globalThis.fetch=originalFetch;
 report.environmentRestored=keys.every(key=>process.env[key]===environment[key]);report.databaseCalls=databaseCalls;report.providerCalls=providerCalls;
 await fs.mkdir('docs/tests',{recursive:true});await fs.writeFile('docs/tests/media-origin-results.json',JSON.stringify(report,null,2));
}
