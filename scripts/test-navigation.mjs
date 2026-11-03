import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {q,pool} from '../lib/db.mjs';
const base=process.env.TEST_BASE_URL||'http://154.40.47.111:3060',stamp=Date.now(),report={startedAt:new Date().toISOString(),pageerrors:[],console:[],failed:[],responses:[],steps:[]};
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox','--disable-dev-shm-usage']});
report.browserVersion=browser.version();
const expectedHeadings={overview:'导航诊断账户，今天也在向前。',ai:'一个好问题，是改变的开始。',agents:'一个目标，一支 AI 团队。',learning:'让每一份努力，都有方向。',life:'认真生活，也照顾自己。',knowledge:'让好想法，有一个归处。',plugins:'给你的成长，添一件好工具。',membership:'为持续成长，留一点空间。',user:'我的个人中心'};
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai'}),page=await context.newPage();let userId;
page.on('pageerror',e=>{report.pageerrors.push({url:page.url(),message:e.message,stack:e.stack});console.log('PAGEERROR',e.message);});
page.on('console',m=>{if(['error','warning'].includes(m.type()))report.console.push({url:page.url(),type:m.type(),message:m.text()});});
page.on('requestfailed',r=>report.failed.push({url:r.url(),error:r.failure()?.errorText,type:r.resourceType()}));
page.on('response',r=>{const headers=r.request().headers();if(r.status()>=400||headers.rsc||r.url().includes('_rsc'))report.responses.push({url:r.url(),status:r.status(),rsc:headers.rsc||null,contentType:r.headers()['content-type']});});
async function snapshot(label){await page.waitForTimeout(600);const info=await page.evaluate(()=>({url:location.href,title:document.title,h1:document.querySelector('h1')?.textContent,historyKeys:Object.keys(history.state||{}),error:document.documentElement.id==='__next_error__',body:document.body.innerText.slice(0,400)}));report.steps.push({label,...info});console.log('PASS',label);const url=new URL(info.url);const view=url.searchParams.get('view')||(url.pathname==='/user'?'user':'overview');if(info.h1!==expectedHeadings[view])throw new Error('URL and rendered view diverged at '+label+': '+info.h1);if(info.error){await page.screenshot({path:`docs/screenshots/navigation-error-chromium${report.browserVersion.split('.')[0]}.png`,fullPage:true});throw new Error('Global error at '+label);}}
async function call(data){const r=await context.request.post(base+'/api/app',{data});if(r.status()!==200)throw new Error('API '+data.action+' HTTP '+r.status());return r.json();}
try{
userId=(await call({action:'auth.register',name:'导航诊断账户',email:`navigation-${stamp}@example.test`,password:crypto.randomBytes(20).toString('hex')})).user.id;
const cid=crypto.randomUUID();await q('INSERT INTO conversations (id,user_id,agent_id,title,messages) VALUES (?,?,?,?,?)',[cid,userId,'study','导航恢复诊断会话',JSON.stringify([{role:'user',content:'导航恢复诊断问题'},{role:'assistant',content:'这是临时账户的历史记录，仅用于验证页面导航与恢复，不是实际模型答复。'}])]);
await page.goto(base+'/user?view=ai');await expect(page.getByRole('heading',{name:'一个好问题，是改变的开始。'})).toBeVisible();await snapshot('direct AI');
await page.goto(base+'/user?view=overview');await expect(page.getByRole('heading',{name:'导航诊断账户，今天也在向前。'})).toBeVisible();await snapshot('home');
const views=[['ai','AI 助手'],['agents','Agent 工作室'],['learning','学习计划'],['life','生活管理'],['knowledge','知识库'],['plugins','插件市场'],['membership','会员中心'],['user','用户中心'],['overview','我的工作台']];
for(let cycle=0;cycle<2;cycle++)for(const [view,label]of views){await page.locator('.sidebar').getByRole('button',{name:label}).click();await snapshot('sidebar '+cycle+' '+view);if(view==='ai'&&cycle===0){await page.locator('.conversation-history summary').click();await page.locator('.conversation-history button').filter({hasText:'导航恢复诊断会话'}).click();await expect(page.locator('.message.assistant')).toContainText('这是临时账户');await snapshot('history loaded');}}
for(let i=0;i<10;i++){await page.goBack();await snapshot('back '+i);}
for(let i=0;i<10;i++){await page.goForward();await snapshot('forward '+i);}
await page.locator('.sidebar').getByRole('button',{name:'AI 助手',exact:true}).click();await expect(page.locator('.message.assistant')).toContainText('这是临时账户');await snapshot('AI restored after SPA navigation');
await page.reload();await expect(page.locator('.message.assistant')).toContainText('这是临时账户');await snapshot('AI restored after reload');
await page.setViewportSize({width:390,height:844});for(const [view,label]of views){await page.getByRole('button',{name:'打开菜单',exact:true}).click();await page.locator('.sidebar').getByRole('button',{name:label}).click();await snapshot('mobile sidebar '+view);}
if(report.pageerrors.length||report.failed.length)throw new Error('Browser errors or failed requests during navigation');report.passed=true;
}catch(e){report.passed=false;process.exitCode=1;report.error=e.stack;console.error(e.message);await page.screenshot({path:`docs/screenshots/navigation-error-chromium${report.browserVersion.split('.')[0]}.png`,fullPage:true}).catch(()=>{});}
finally{if(userId){for(const table of ['sessions','records','conversations','runs','orders','installs','usage_logs','audit'])await q(`DELETE FROM ${table} WHERE user_id=?`,[userId]);await q('DELETE FROM users WHERE id=?',[userId]);}report.completedAt=new Date().toISOString();await fs.writeFile(`docs/tests/navigation-diagnostic-chromium${report.browserVersion.split('.')[0]}.json`,JSON.stringify(report,null,2));await browser.close();await pool.end();console.log('RESULT',JSON.stringify({passed:report.passed,steps:report.steps.length,pageerrors:report.pageerrors.length,console:report.console.length,failed:report.failed.length,rsc:report.responses.length}));}
