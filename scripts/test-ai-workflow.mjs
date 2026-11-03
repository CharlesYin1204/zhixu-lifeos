import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {enqueueRun} from '../lib/ai.mjs';
import {id,parse,pool,q} from '../lib/db.mjs';

// This integration test uses the configured real models and the running systemd worker.
// It leaves a disabled verification account and its run/logs for database audit evidence.
execFileSync('systemctl',['is-active','--quiet','zhixu-worker']);
const userId=id(),report={startedAt:new Date().toISOString(),source:'live provider + systemd worker',userId,observations:[]};
let runId,terminal=false;
await q('INSERT INTO users (id,email,name,password_hash,credits) VALUES (?,?,?,?,?)',[userId,`ai-workflow-${userId}@example.test`,'真实多 Agent 验收','!disabled',30]);
try {
 runId=await enqueueRun(userId,'我每天晚上有60分钟，想学习英语并养成轻度运动习惯。请协作为我制定可执行的三天计划。',['study','life','wellness']);
 report.runId=runId;
 await writeFile('docs/tests/ai-workflow-pending.json',JSON.stringify(report,null,2)+'\n');
 const started=Date.now();let run,last='';
 while(Date.now()-started<600000) {
  run=(await q('SELECT * FROM runs WHERE id=?',[runId]))[0];
  const steps=parse(run.steps,[]),state=JSON.stringify([run.status,...steps.map(step=>step.status)]);
  if(state!==last){report.observations.push({at:new Date().toISOString(),status:run.status,steps:steps.map(({id,status})=>({id,status}))});console.log('RUN',run.status,steps.map(step=>`${step.id}:${step.status}`).join(' '));last=state;}
  if(['completed','partial','failed'].includes(run.status)){terminal=true;break;}
  await new Promise(resolve=>setTimeout(resolve,1200));
 }
 assert(terminal,'Observation timed out; the live run remains untouched and can be polled by runId.');
 report.status=run.status;report.steps=parse(run.steps,[]);report.result=run.result;report.error=run.error;
 report.logs=await q('SELECT model_id,kind,tokens,latency,status,created_at FROM usage_logs WHERE user_id=? ORDER BY created_at',[userId]);
 report.creditsAfter=Number((await q('SELECT credits FROM users WHERE id=?',[userId]))[0].credits);
 assert.equal(run.status,'completed',run.error||'Workflow did not fully complete');
 assert.equal(report.steps.length,5);assert(report.steps.every(step=>step.status==='completed'&&step.content.length>20&&(Number.isFinite(step.tokens)&&step.tokens>=0||step.tokens===null&&step.usage?.complete===false)));
 const [planner,...remaining]=report.steps,specialists=remaining.slice(0,3),reviewer=remaining.at(-1);
 assert(specialists.every(step=>Date.parse(step.startedAt)>=Date.parse(planner.completedAt)));
 assert(Math.max(...specialists.map(step=>Date.parse(step.startedAt)))<Math.min(...specialists.map(step=>Date.parse(step.completedAt))),'Specialists did not overlap');
 assert(specialists.every(step=>Date.parse(step.completedAt)<=Date.parse(reviewer.startedAt)));
 assert.equal(report.logs.length,5);assert(report.logs.every(log=>log.status==='success'&&(log.tokens===null||Number.isFinite(log.tokens)&&log.tokens>=0)));assert.equal(report.creditsAfter,25);assert(run.result.length>100);
 report.passed=true;console.log('PASS real five-stage workflow, parallel specialists, persisted outputs and exact credits');
} catch(error) {
 report.passed=false;report.failure=error.message;process.exitCode=1;console.error(error.message);
} finally {
 report.finishedAt=new Date().toISOString();
 if(terminal)await q("UPDATE users SET status='disabled' WHERE id=?",[userId]);
 await writeFile('docs/tests/ai-workflow-results.json',JSON.stringify(report,null,2)+'\n');await pool.end();
}
