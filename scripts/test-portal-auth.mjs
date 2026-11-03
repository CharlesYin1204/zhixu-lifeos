import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// Actual Next handlers and MySQL with disposable, prefixed tables. No production
// accounts, settings, orders, provider calls, or browser sessions are touched.
const prefix=`portalauth_${crypto.randomBytes(5).toString('hex')}_`;
const schema=await fs.readFile(new URL('../database/schema.sql',import.meta.url),'utf8');
const statements=schema.split(';').map(value=>value.trim()).filter(value=>/^CREATE TABLE IF NOT EXISTS /.test(value));
const tables=statements.map(value=>value.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1]);
const pattern=new RegExp(`\\b(${tables.join('|')})\\b`,'g');
const rewrite=sql=>sql.replace(pattern,name=>prefix+name);
const underlying=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:3,charset:'utf8mb4',timezone:'+08:00',dateStrings:true});
globalThis.__zhixuPool={execute:(sql,values)=>underlying.execute(rewrite(sql),values),end:()=>underlying.end()};
const {q,id,saveSettings,settings}=await import('../lib/db.mjs');
const {hashPassword,hashToken,createSession,sessionUser,secureRequest}=await import('../lib/security.mjs');
const {ensureSessionScope}=await import('../lib/session-schema.mjs');
const {NextRequest}=await import('next/server.js');
const require=createRequire(import.meta.url);
async function loadRoute(name){
 const routeUrl=new URL(`../app/api/${name}/route.js`,import.meta.url);
 let source=await fs.readFile(routeUrl,'utf8');
 source=source.replace(/from '([^']+)'/g,(whole,specifier)=>specifier==='next/server'?`from '${pathToFileURL(require.resolve(specifier)).href}'`:specifier.startsWith('.')?`from '${new URL(specifier,routeUrl).href}'`:whole);
 source=source.replace(/import\('([^']+)'\)/g,(whole,specifier)=>specifier.startsWith('.')?`import('${new URL(specifier,routeUrl).href}')`:whole);
 return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const routes={app:await loadRoute('app'),admin:await loadRoute('admin'),media:await loadRoute('media')};
const base='http://127.0.0.1:3061',results=[],created=[];
const fixtures={user:{id:id(),email:'portal-user@example.test'},admin:{id:id(),email:'portal-admin@example.test'},other:{id:id(),email:'portal-other@example.test'}};
const password=crypto.randomBytes(18).toString('base64url');
let failure;
async function invoke(portal,request,cookies={},status=200,headers={},requestBase=base){
 const get=typeof request==='string';
 const req=new NextRequest(`${requestBase}/api/${portal}${get?request:''}`,{method:get?'GET':'POST',headers:{cookie:Object.entries(cookies).map(([key,value])=>`${key}=${value}`).join('; '),...(get?{}:{'Content-Type':'application/json'}),...headers},...(get?{}:{body:JSON.stringify(request)})});
 const response=await routes[portal][get?'GET':'POST'](req),data=await response.json();
 assert.equal(response.status,status,`${portal} ${get?request:request.action}: ${data.error||response.status}`);
 return {data,response};
}
const cookieValue=(response,name)=>response.cookies.get(name)?.value;
async function test(name,run){const start=Date.now();const evidence=await run();results.push({name,passed:true,ms:Date.now()-start,evidence});console.log('PASS',name);}
async function countSessions(userId){return Number((await q('SELECT COUNT(*) n FROM sessions WHERE user_id=?',[userId]))[0].n);}
try{
 for(let index=0;index<statements.length;index++){
  // Exercise the real additive migration against the old schema.
  const statement=tables[index]==='sessions'?statements[index].replace("scope VARCHAR(16) NOT NULL DEFAULT 'user',",''):statements[index];
  await underlying.execute(rewrite(statement));created.push(tables[index]);
 }
 const passwordHash=await hashPassword(password);
 for(const [kind,account] of Object.entries(fixtures))await q('INSERT INTO users (id,email,name,password_hash,role) VALUES (?,?,?,?,?)',[account.id,account.email,kind,passwordHash,kind==='user'?'user':'admin']);
 await saveSettings({siteName:'独立入口验收',description:'fixture',supportContact:'support@example.test',payment:{manualEnabled:true,epayKey:'fixture-secret',epayPid:'fixture-pid',epayUrl:''},apk:{}});
 const legacyToken=crypto.randomBytes(32).toString('hex');
 await q('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 1 DAY))',[hashToken(legacyToken),fixtures.user.id]);
 await test('Additive session migration preserves legacy personal login and is idempotent',async()=>{
  await ensureSessionScope(q);await ensureSessionScope(q);
  const row=(await q('SELECT scope,user_id FROM sessions WHERE token_hash=?',[hashToken(legacyToken)]))[0];assert.equal(row.scope,'user');assert.equal(row.user_id,fixtures.user.id);
  const {data}=await invoke('app','?resource=bootstrap',{zhixu_session:legacyToken});assert.equal(data.user.id,fixtures.user.id);
  return {legacyPreserved:true,migrationRuns:2};
 });
 await test('Anonymous admin bootstrap exposes identity branding only and protected data returns 401',async()=>{
  const {data}=await invoke('admin','?resource=bootstrap');assert.deepEqual(Object.keys(data).sort(),['ok','settings','user']);assert.equal(data.user,null);assert.deepEqual(Object.keys(data.settings).sort(),['description','siteName','supportContact']);
  await invoke('admin','?resource=admin',{},401);await invoke('admin',{action:'admin.save',entity:'settings',data:{siteName:'blocked'}},{},401);
  return {noPersonalCollections:true,protectedStatus:401};
 });
 await test('Cookie transport helper follows actual HTTPS and nginx proxy protocol without using APP_URL',async()=>{
  const cases=[['http://example.test',undefined,false],['https://example.test',undefined,true],['http://example.test','https',true],['http://example.test','http',false],['https://example.test','http',true],['http://example.test','https, http',false]];
  for(const [url,forwarded,expected] of cases)assert.equal(secureRequest(new NextRequest(url,{headers:forwarded?{'x-forwarded-proto':forwarded}:{}})),expected);
  return {cases:cases.length,trustedProxyHeader:'X-Forwarded-Proto overwritten by deployed nginx',ambiguousHeaderRejected:true};
 });
 await test('Both login and logout handlers issue Secure cookies for HTTPS while preserving HTTP compatibility',async()=>{
  const originalAppUrl=process.env.APP_URL;
  const modes=[{base,headers:{},secure:false},{base,headers:{'x-forwarded-proto':'http'},secure:false},{base,headers:{'x-forwarded-proto':'https'},secure:true},{base:'https://127.0.0.1:3063',headers:{},secure:true}];
  for(const portal of ['app','admin'])for(const mode of modes){
   const name=portal==='admin'?'zhixu_admin_session':'zhixu_session';
   const {response}=await invoke(portal,{action:'auth.login',email:fixtures.admin.email,password},{},200,mode.headers,mode.base);
   const cookie=response.cookies.get(name);assert(cookie?.value);assert.equal(Boolean(cookie.secure),mode.secure);assert.equal(cookie.httpOnly,true);assert.equal(cookie.sameSite,'lax');
   const cleared=await invoke(portal,{action:'auth.logout'},{[name]:cookie.value},200,mode.headers,mode.base);assert.equal(Boolean(cleared.response.cookies.get(name).secure),mode.secure);assert.equal(cookieValue(cleared.response,name),'');
  }
  assert.equal(process.env.APP_URL,originalAppUrl);assert.equal(await countSessions(fixtures.admin.id),0);
  return {loginAndLogoutPairs:8,portals:2,transportModes:4,appUrlUnchanged:true};
 });
 await test('Ordinary credentials cannot create an admin session or register via the admin endpoint',async()=>{
  const before=await countSessions(fixtures.user.id);
  const {response}=await invoke('admin',{action:'auth.login',email:fixtures.user.email,password},{},403);assert.equal(response.headers.get('set-cookie'),null);assert.equal(await countSessions(fixtures.user.id),before);
  await invoke('admin',{action:'auth.register',email:'new@example.test',password},{},404);
  return {deniedStatus:403,noSessionCreated:true,registrationStatus:404};
 });
 await test('Administrator login creates a dedicated server-side admin scope and cookie',async()=>{
  const {response,data}=await invoke('admin',{action:'auth.login',email:fixtures.admin.email,password});fixtures.admin.adminToken=cookieValue(response,'zhixu_admin_session');assert(fixtures.admin.adminToken);assert.equal(response.cookies.get('zhixu_session'),undefined);assert.equal(data.user.role,'admin');assert(!('password_hash' in data.user));
  assert.deepEqual(Object.keys(data.user).sort(),['createdAt','email','id','name','role','status']);const row=(await q('SELECT scope FROM sessions WHERE token_hash=?',[hashToken(fixtures.admin.adminToken)]))[0];assert.equal(row.scope,'admin');assert.match(response.headers.get('set-cookie'),/HttpOnly/i);
  return {scope:'admin',cookie:'zhixu_admin_session',httpOnly:true};
 });
 await test('Same account personal login remains a separate personal session',async()=>{
  const {response}=await invoke('app',{action:'auth.login',email:fixtures.admin.email,password});fixtures.admin.userToken=cookieValue(response,'zhixu_session');assert(fixtures.admin.userToken);assert.equal(response.cookies.get('zhixu_admin_session'),undefined);
  assert.equal((await q('SELECT scope FROM sessions WHERE token_hash=?',[hashToken(fixtures.admin.userToken)]))[0].scope,'user');assert.equal(await countSessions(fixtures.admin.id),2);
  return {scope:'user',separateSessions:2};
 });
 await test('Copying tokens between cookie names cannot cross either portal scope',async()=>{
  await invoke('admin','?resource=admin',{zhixu_admin_session:fixtures.admin.userToken},401);
  await invoke('admin','?resource=admin',{zhixu_session:fixtures.admin.userToken},401);
  const {data}=await invoke('app','?resource=bootstrap',{zhixu_session:fixtures.admin.adminToken});assert.equal(data.user,null);
  await invoke('app','?resource=export',{zhixu_session:fixtures.admin.adminToken},401);
  return {bidirectionalScopeEnforced:true};
 });
 await test('Personal API refuses every administrative route even with valid admin sessions',async()=>{
  const both={zhixu_session:fixtures.admin.userToken,zhixu_admin_session:fixtures.admin.adminToken},before=await settings();
  await invoke('app','?resource=admin',both,403);await invoke('app',{action:'admin.save',entity:'settings',data:{siteName:'blocked'}},both,403);await invoke('app',{action:'admin.model.test',id:'missing'},both,403);await invoke('app',{action:'admin.apk.build'},both,403);assert.deepEqual(await settings(),before);
  return {deniedRoutes:4,settingsUnchanged:true};
 });
 await test('Admin API refuses personal records, chat, order and media activity',async()=>{
  const cookie={zhixu_admin_session:fixtures.admin.adminToken};
  for(const resource of ['records','conversation','run','export'])await invoke('admin',`?resource=${resource}`,cookie,404);
  for(const action of ['record.save','ai.chat','ai.run','order.create','plugin.install'])await invoke('admin',{action},cookie,404);
  await invoke('media','?resource=history',cookie,401);await invoke('media',{action:'vision'},cookie,401,{origin:new URL(process.env.APP_URL).origin});
  assert.equal(Number((await q('SELECT COUNT(*) n FROM records'))[0].n),0);return {personalActionsDenied:11,noPersonalMutation:true};
 });
 await test('Valid admin read/save uses admin cookie, masks secrets and preserves personal bootstrap',async()=>{
  const cookie={zhixu_admin_session:fixtures.admin.adminToken};
  const {data}=await invoke('admin','?resource=admin',cookie);assert.equal(data.users.length,3);assert.equal(data.settings.payment.epayKey,undefined);assert.equal(data.settings.payment.epayKeyConfigured,true);
  await invoke('admin',{action:'admin.save',entity:'settings',data:{description:'saved through admin'}},cookie);assert.equal((await settings()).description,'saved through admin');
  const bootstrap=(await invoke('admin','?resource=bootstrap',cookie)).data;assert(!('records' in bootstrap)&&!('orders' in bootstrap)&&!('conversations' in bootstrap));
  await invoke('app',{action:'record.save',kind:'task',title:'personal record'},{zhixu_session:fixtures.admin.userToken});
  const personal=(await invoke('app','?resource=bootstrap',{zhixu_session:fixtures.admin.userToken})).data;assert.equal(personal.records.length,1);assert.equal(personal.settings.payment.epayPid,undefined);
  return {adminWriteReadback:true,privateSecretsMasked:true,personalRecordPreserved:true};
 });
 await test('Admin logout revokes only the admin token and does not affect the personal session',async()=>{
  const {response}=await invoke('admin',{action:'auth.logout'},{zhixu_session:fixtures.admin.userToken,zhixu_admin_session:fixtures.admin.adminToken});assert.equal(cookieValue(response,'zhixu_admin_session'),'');assert.equal(response.cookies.get('zhixu_session'),undefined);
  await invoke('admin','?resource=admin',{zhixu_admin_session:fixtures.admin.adminToken},401);assert.equal((await invoke('app','?resource=bootstrap',{zhixu_session:fixtures.admin.userToken})).data.user.id,fixtures.admin.id);
  fixtures.admin.adminToken=await createSession(fixtures.admin.id,'admin');return {personalLoginPreserved:true};
 });
 await test('Personal logout revokes only the personal token and does not affect admin login',async()=>{
  const {response}=await invoke('app',{action:'auth.logout'},{zhixu_session:fixtures.admin.userToken,zhixu_admin_session:fixtures.admin.adminToken});assert.equal(cookieValue(response,'zhixu_session'),'');assert.equal(response.cookies.get('zhixu_admin_session'),undefined);
  await invoke('admin','?resource=admin',{zhixu_admin_session:fixtures.admin.adminToken});assert.equal((await invoke('app','?resource=bootstrap',{zhixu_session:fixtures.admin.userToken})).data.user,null);
  fixtures.admin.userToken=await createSession(fixtures.admin.id);return {adminLoginPreserved:true};
 });
 await test('Swapped-cookie logout cannot revoke a token belonging to the opposite scope',async()=>{
  await invoke('admin',{action:'auth.logout'},{zhixu_admin_session:fixtures.admin.userToken});await invoke('app',{action:'auth.logout'},{zhixu_session:fixtures.admin.adminToken});
  assert.equal(await countSessions(fixtures.admin.id),2);return {sessionsPreserved:2};
 });
 await test('Disabled, demoted and expired admin sessions are rechecked on every request',async()=>{
  const token=await createSession(fixtures.other.id,'admin'),cookie={zhixu_admin_session:token};
  await q("UPDATE users SET role='user' WHERE id=?",[fixtures.other.id]);await invoke('admin','?resource=admin',cookie,403);await invoke('admin','?resource=bootstrap',cookie,403);await invoke('admin',{action:'profile.update',name:'blocked'},cookie,403);
  await q("UPDATE users SET role='admin',status='disabled' WHERE id=?",[fixtures.other.id]);await invoke('admin','?resource=admin',cookie,401);await invoke('admin',{action:'auth.login',email:fixtures.other.email,password},{},403);
  await q("UPDATE users SET status='active' WHERE id=?",[fixtures.other.id]);await q('UPDATE sessions SET expires_at=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE token_hash=?',[hashToken(token)]);await invoke('admin','?resource=admin',cookie,401);
  return {demotedStatus:403,disabledOrExpiredStatus:401};
 });
 await test('Admin password update revokes both portal sessions and renews only admin scope',async()=>{
  const newPassword=crypto.randomBytes(18).toString('base64url'),cookie={zhixu_admin_session:fixtures.admin.adminToken};
  await invoke('admin',{action:'profile.update',currentPassword:'incorrect',password:newPassword},cookie,400);
  const {response}=await invoke('admin',{action:'profile.update',name:'updated admin',currentPassword:password,password:newPassword},cookie);const renewed=cookieValue(response,'zhixu_admin_session');assert(renewed&&renewed!==fixtures.admin.adminToken);assert.equal(response.cookies.get('zhixu_session'),undefined);assert.equal(await countSessions(fixtures.admin.id),1);
  await invoke('admin','?resource=admin',cookie,401);assert.equal((await invoke('app','?resource=bootstrap',{zhixu_session:fixtures.admin.userToken})).data.user,null);await invoke('admin','?resource=admin',{zhixu_admin_session:renewed});
  const userRequest={cookies:{get:name=>name==='zhixu_session'?{value:renewed}:undefined}};assert.equal(await sessionUser(userRequest),null);return {bothOldSessionsRevoked:true,replacementScope:'admin'};
 });
 await test('Admin mutating operations enforce origin checks before authentication or database writes',async()=>{
  const before=await settings();await invoke('admin',{action:'auth.login',email:fixtures.admin.email,password},{},403,{origin:'https://untrusted.example.test'});assert.deepEqual(await settings(),before);return {crossOriginStatus:403};
 });
}catch(error){failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{
 for(const name of [...created].reverse())await underlying.execute(`DROP TABLE IF EXISTS ${prefix}${name}`);
 await underlying.end();
 await fs.writeFile(new URL('../docs/tests/portal-auth-results.json',import.meta.url),JSON.stringify({testedAt:new Date().toISOString(),scope:'Actual Next route handlers and isolated MySQL tables; no production data mutations, paid calls or browser interactions',passed:results.length,results,failure,cleanup:'All prefixed fixture tables removed'},null,2));
}
