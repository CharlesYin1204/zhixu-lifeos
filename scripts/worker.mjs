import {q} from '../lib/db.mjs';
import {executeRun,failRun} from '../lib/ai.mjs';
// Restart recovery: a worker owns one task at a time; interrupted jobs are marked, never silently lost.
const abandoned=await q("SELECT id,user_id FROM runs WHERE status='running'");
for(const r of abandoned)await failRun(r.id,'服务重启导致任务中断，额度已退回，请重新提交。');
console.log('LifeOS multi-agent worker ready');
for(;;){try{const rows=await q("SELECT * FROM runs WHERE status='queued' ORDER BY created_at LIMIT 1");if(rows[0]){const claimed=await q("UPDATE runs SET status='running' WHERE id=? AND status='queued'",[rows[0].id]);if(claimed.affectedRows)await executeRun(rows[0]);}else await new Promise(r=>setTimeout(r,1800));}catch(e){console.error('Worker error:',e.message);await new Promise(r=>setTimeout(r,3000));}}
