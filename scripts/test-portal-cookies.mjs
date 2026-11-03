import {chromium,expect,request} from '@playwright/test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {q,pool} from '../lib/db.mjs';
import {hashPassword} from '../lib/security.mjs';

// Run after deployment. Two disposable accounts only; no AI, payments, shared
// configuration changes, or Android builds. HTTPS uses real browser login forms.
const httpsBase=(process.env.TEST_HTTPS_BASE_URL||'https://154.40.47.111:3063').replace(/\/$/,'');
const httpBase=(process.env.TEST_HTTP_BASE_URL||'http://154.40.47.111:3060').replace(/\/$/,'');
const stamp=crypto.randomBytes(8).toString('hex'),password=crypto.randomBytes(24).toString('base64url');
const fixtures=Object.fromEntries(['user','admin'].map(role=>[role,{id:crypto.randomUUID(),email:`portal-cookie-${role}-${stamp}@example.test`,name:`Cookie 隔离验收 ${role}`,role}]));
const report={testedAt:new Date().toISOString(),checks:[],pageErrors:[]};
const created=[];let browser,context,httpClient,adminPage,userPage;
const clean=value=>String(value).split(password).join('[redacted]');
async function check(name,run){await run();report.checks.push({name,passed:true});console.log('PASS',name);}
async function api(client,base,portal,body){
 const response=typeof body==='string'?await client.get(`${base}/api/${portal}${body}`):await client.post(`${base}/api/${portal}`,{data:body});
 const data=await response.json();assert.equal(response.status(),200,clean(data.error||`HTTP ${response.status()}`));return {response,data};
}
function cookieHeader(response,name,secure){
 const header=response.headers()['set-cookie']||'';
 assert.match(header,new RegExp(`(?:^|,\\s*)${name}=`));
 assert.match(header,/;\s*HttpOnly(?:;|$)/i);assert.match(header,/;\s*SameSite=Lax(?:;|$)/i);
 assert.equal(/;\s*Secure(?:;|$)/i.test(header),secure);
 return header;
}
async function browserLogin(page,portal){
 const admin=portal==='admin',fixture=fixtures[admin?'admin':'user'];
 await page.goto(httpsBase+(admin?'/admin/login':'/login'));
 await page.locator('input[name=email]').fill(fixture.email);
 await page.locator('input[name=password]').fill(password);
 const pending=page.waitForResponse(response=>response.url()===`${httpsBase}/api/${portal}`&&response.request().method()==='POST'&&response.request().postDataJSON()?.action==='auth.login');
 await page.getByRole('button',{name:admin?'登录管理后台':'登录用户中心',exact:true}).click();
 const response=await pending;assert.equal(response.status(),200);await expect(page).toHaveURL(httpsBase+(admin?'/admin':'/user'),{timeout:20000});
 if(!admin)await expect(page.getByRole('heading',{name:'我的个人中心',exact:true})).toBeVisible();
 return response;
}
async function browserLogout(page,portal){
 const pending=page.waitForResponse(response=>response.url()===`${httpsBase}/api/${portal}`&&response.request().method()==='POST'&&response.request().postDataJSON()?.action==='auth.logout');
 await page.getByRole('button',{name:portal==='admin'?'退出后台':'退出登录',exact:true}).click();
 const response=await pending;assert.equal(response.status(),200);return response;
}
async function bootstrap(client,base,portal){return (await api(client,base,portal,'?resource=bootstrap')).data.user;}
try{
 try{report.release=(await fs.readFile('private/web-runtime.env','utf8')).match(/^NEXT_DIST_DIR=(.+)$/m)?.[1];}catch{}
 const hashed=await hashPassword(password);
 for(const fixture of Object.values(fixtures)){await q('INSERT INTO users (id,email,name,password_hash,role) VALUES (?,?,?,?,?)',[fixture.id,fixture.email,fixture.name,hashed,fixture.role]);created.push(fixture.id);}
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox','--disable-dev-shm-usage']});report.browser=browser.version();
 context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
 adminPage=await context.newPage();userPage=await context.newPage();for(const page of [adminPage,userPage])page.on('pageerror',error=>report.pageErrors.push(clean(error.message)));
 await check('HTTPS admin browser login issues Secure HttpOnly SameSite=Lax cookie',async()=>{
  const response=await browserLogin(adminPage,'admin');cookieHeader(response,'zhixu_admin_session',true);
  const cookie=(await context.cookies(httpsBase)).find(item=>item.name==='zhixu_admin_session');assert(cookie?.secure&&cookie.httpOnly&&cookie.sameSite==='Lax');assert.equal((await bootstrap(context.request,httpsBase,'admin')).id,fixtures.admin.id);
 });
 await check('HTTPS user browser login issues Secure HttpOnly SameSite=Lax cookie',async()=>{
  const response=await browserLogin(userPage,'app');cookieHeader(response,'zhixu_session',true);
  const cookie=(await context.cookies(httpsBase)).find(item=>item.name==='zhixu_session');assert(cookie?.secure&&cookie.httpOnly&&cookie.sameSite==='Lax');assert.equal((await bootstrap(context.request,httpsBase,'app')).id,fixtures.user.id);assert.equal((await bootstrap(context.request,httpsBase,'admin')).id,fixtures.admin.id);
 });
 await check('HTTPS logout expires only its own cookie and retains Secure',async()=>{
  const adminResponse=await browserLogout(adminPage,'admin');assert.match(cookieHeader(adminResponse,'zhixu_admin_session',true),/Max-Age=0/i);
  assert.equal(await bootstrap(context.request,httpsBase,'admin'),null);assert.equal((await bootstrap(context.request,httpsBase,'app')).id,fixtures.user.id);
  await browserLogin(adminPage,'admin');const userResponse=await browserLogout(userPage,'app');assert.match(cookieHeader(userResponse,'zhixu_session',true),/Max-Age=0/i);
  assert.equal(await bootstrap(context.request,httpsBase,'app'),null);assert.equal((await bootstrap(context.request,httpsBase,'admin')).id,fixtures.admin.id);
 });
 httpClient=await request.newContext();
 await check('HTTP admin API login remains compatible with scoped non-Secure cookie',async()=>{
  const {response}=await api(httpClient,httpBase,'admin',{action:'auth.login',email:fixtures.admin.email,password});cookieHeader(response,'zhixu_admin_session',false);
  const cookie=(await httpClient.storageState()).cookies.find(item=>item.name==='zhixu_admin_session');assert(cookie&&cookie.secure===false&&cookie.httpOnly);assert.equal((await bootstrap(httpClient,httpBase,'admin')).id,fixtures.admin.id);assert.equal(await bootstrap(httpClient,httpBase,'app'),null);
 });
 await check('HTTP user API login remains compatible with scoped non-Secure cookie',async()=>{
  const {response}=await api(httpClient,httpBase,'app',{action:'auth.login',email:fixtures.user.email,password});cookieHeader(response,'zhixu_session',false);
  const cookie=(await httpClient.storageState()).cookies.find(item=>item.name==='zhixu_session');assert(cookie&&cookie.secure===false&&cookie.httpOnly);assert.equal((await bootstrap(httpClient,httpBase,'app')).id,fixtures.user.id);assert.equal((await bootstrap(httpClient,httpBase,'admin')).id,fixtures.admin.id);
 });
 await check('HTTP logout remains isolated and clears its own cookie',async()=>{
  const adminLogout=await api(httpClient,httpBase,'admin',{action:'auth.logout'});assert.match(cookieHeader(adminLogout.response,'zhixu_admin_session',false),/Max-Age=0/i);assert.equal(await bootstrap(httpClient,httpBase,'admin'),null);assert.equal((await bootstrap(httpClient,httpBase,'app')).id,fixtures.user.id);
  await api(httpClient,httpBase,'admin',{action:'auth.login',email:fixtures.admin.email,password});const userLogout=await api(httpClient,httpBase,'app',{action:'auth.logout'});assert.match(cookieHeader(userLogout.response,'zhixu_session',false),/Max-Age=0/i);assert.equal(await bootstrap(httpClient,httpBase,'app'),null);assert.equal((await bootstrap(httpClient,httpBase,'admin')).id,fixtures.admin.id);
 });
 assert.deepEqual(report.pageErrors,[]);
 for(const fixture of Object.values(fixtures)){assert.equal(Number((await q('SELECT COUNT(*) n FROM usage_logs WHERE user_id=?',[fixture.id]))[0].n),0);assert.equal(Number((await q('SELECT COUNT(*) n FROM orders WHERE user_id=?',[fixture.id]))[0].n),0);}
 report.passed=true;
}catch(error){report.passed=false;report.error=clean(error.stack);process.exitCode=1;console.error(clean(error.message));}
finally{
 await httpClient?.dispose();await browser?.close();
 try{
  for(const userId of created){for(const table of ['sessions','audit'])await q(`DELETE FROM ${table} WHERE user_id=?`,[userId]);await q('DELETE FROM users WHERE id=?',[userId]);}
  for(const fixture of Object.values(fixtures))await q('DELETE FROM rate_limits WHERE id IN (?,?,?,?)',[`auth:${fixture.email}`,`admin-auth:${fixture.email}`,`user:${fixture.id}`,`admin:${fixture.id}`]);
  report.cleanup='Temporary accounts, sessions, audit and rate limits removed; no AI or payments invoked';
 }catch(error){report.passed=false;report.cleanupError=clean(error.message);process.exitCode=1;}
 await pool.end();await fs.mkdir('docs/tests',{recursive:true});await fs.writeFile('docs/tests/portal-cookie-results.json',JSON.stringify(report,null,2));
 console.log('RESULT',JSON.stringify({passed:report.passed,checks:report.checks.length,pageErrors:report.pageErrors.length}));
}
