import fs from 'node:fs/promises';
import {q,pool,putEntity,entities,saveSettings,settings,id} from '../lib/db.mjs';
import {hashPassword,encrypt} from '../lib/security.mjs';
import {ensureSessionScope} from '../lib/session-schema.mjs';
const sql=await fs.readFile(new URL('../database/schema.sql',import.meta.url),'utf8');
for(const s of sql.split(';').map(x=>x.trim()).filter(Boolean))await q(s);
await ensureSessionScope(q);
if(!(await q('SELECT id FROM users WHERE email=?',[process.env.ADMIN_EMAIL])).length)await q('INSERT INTO users (id,email,name,password_hash,role,credits) VALUES (?,?,?,?,?,?)',[id(),process.env.ADMIN_EMAIL,'知序管理员',await hashPassword(process.env.ADMIN_PASSWORD),'admin',10000]);
if(!(await entities('model',true)).length){for(const [i,model] of ['gpt-5.6-luna','claude-opus-5-thinking'].entries())await putEntity('model',{id:`model-${i+1}`,name:i?'Claude 深度思考':'GPT 智能助理',baseUrl:process.env.AI_BASE_URL,model,apiKey:encrypt(process.env.AI_API_KEY),enabled:true,isDefault:!i});}
const agentSeeds=[
 ['planner','知序管家','目标规划','将复杂目标拆解为可执行步骤，协调你的学习与生活。','Compass','#12695b','你是知序的目标规划师。根据目标给出清晰可执行的拆解、时间预算和验收标准。优先尊重用户约束，不臆造已完成的操作。'],
 ['study','学习教练','学习成长','制定学习路径，讲解知识点，生成练习与复习方案。','GraduationCap','#6961b9','你是学习教练。运用主动回忆、间隔复习和循序渐进原则，给出具体的学习路线、练习和检查方法。'],
 ['life','生活管家','生活管理','安排日程、整理家务，让生活井然有序。','Coffee','#bd8057','你是生活规划助手。帮助组织日程、家务、旅行与人际沟通，给出务实行动建议。'],
 ['wellness','健康伙伴','运动健康','平衡运动、睡眠与饮食，建立健康生活习惯。','Heart','#cd6883','你是一般健康与习惯助手。提供温和可执行的运动睡眠饮食建议，不作诊断或处方，遇到严重症状建议专业就医。'],
 ['finance','财务助手','收支预算','梳理日常收支，制定个人预算和储蓄计划。','Wallet','#5686bd','你是个人预算助手。帮助记录和分析收支，制定储蓄计划；不要承诺投资回报或替用户交易。'],
 ['reviewer','复盘顾问','复盘审阅','汇总协作结果，检查冲突，找到下一步行动。','ScanLine','#588b77','你是严格的复盘与审阅顾问。检查各专家建议的冲突、时间与预算可行性，输出统一的可执行计划和检查清单。'],
 ['language','语言陪练','语言学习','英语口语、写作纠错与情景练习。','Languages','#9672b3','你是语言教练，依据用户水平提供对话练习、纠错、词汇和逐步反馈。'],
 ['career','成长顾问','职业成长','职业路线、求职准备与表达训练。','Briefcase','#a38951','你是职业成长教练，帮助制定技能路线、简历结构和面试练习。']
];
if(!(await entities('agent',true)).length)for(const [aid,name,role,description,icon,color,systemPrompt] of agentSeeds)await putEntity('agent',{id:aid,name,role,description,icon,color,systemPrompt,modelId:'model-1',enabled:true});
if(!(await entities('plan',true)).length)for(const plan of [
 {id:'free',name:'自由探索',price:0,days:0,credits:30,features:['30 次 AI 调用额度','学习与生活全部基础工具','免费插件','多 Agent 协作体验']},
 {id:'pro',name:'成长会员',price:29,days:30,credits:600,features:['每次开通增加 600 次 AI 额度','30 天成长会员标识','学习与生活记录','所有免费工具']},
 {id:'year',name:'年度伙伴',price:249,days:365,credits:8000,features:['每次开通增加 8,000 次 AI 额度','365 天会员有效期','全部基础功能','多 Agent 任务记录']}
])await putEntity('plan',{...plan,enabled:true});
const plugins=[['reading','深度阅读','知识学习',0,'BookOpen','study','把笔记整理成摘要、关键观点与复习问题。',['笔记总结','主动回忆','阅读复盘']],['focus','专注番茄钟','效率工具',0,'Timer','planner','用专注时段保护注意力，沉淀每日投入。',['专注计时','时长记录','计划联动']],['habit','习惯养成','生活健康',0,'Sprout','wellness','从小行动开始，记录每一次坚持。',['每日打卡','习惯记录','AI 建议']],['english','英语私教','知识学习',19,'Languages','language','围绕真实场景练习表达，获得逐句反馈。',['情景对话','写作纠错','学习计划']],['budget','预算分析师','生活财务',12,'Wallet','finance','基于自己的账本整理预算与节流建议。',['收支分析','预算建议','储蓄计划']],['career','职业成长教练','职业成长',29,'Briefcase','career','将职业目标转化为技能路线和练习。',['简历建议','面试训练','能力路线']],['review','周复盘助手','效率工具',9,'ChartNoAxesCombined','reviewer','把一周的记录整理为收获与改进动作。',['周报生成','目标回顾','下一步行动']],['meal','一周饮食计划','生活健康',9,'Utensils','wellness','按个人偏好生成均衡的饮食与购物建议。',['饮食计划','采购清单','偏好定制']]];
if(!(await entities('plugin',true)).length)for(const [pid,name,category,price,icon,agentId,description,features] of plugins)await putEntity('plugin',{id:pid,name,category,price,icon,agentId,description,features,color:agentSeeds.find(a=>a[0]===agentId)?.[5]||'#12695b',enabled:true});
if(!(await settings()).siteName)await saveSettings({siteName:'知序 LifeOS',description:'让成长有方向，让生活有秩序。',announcement:'欢迎来到知序，从一个小目标开始。',payment:{manualEnabled:true,manualInstructions:'请联系平台管理员获取收款方式。付款后由管理员核验并确认订单，系统不会自动标记为已支付。',epayEnabled:false,epayUrl:'',epayPid:'',epayKey:'',stripeEnabled:false,stripeSecret:'',stripeWebhookSecret:''},apk:{appName:'知序 LifeOS',versionName:'1.0.0',versionCode:1,serverUrl:process.env.APP_URL,packageId:'com.zhixu.lifeos',downloadUrl:'',buildStatus:'not_built'}});
for(const [index, key] of ['planner','study','life','wellness','finance','reviewer','language','career'].entries())await q('UPDATE entities SET sort_order=? WHERE type=? AND id=?',[index,'agent',key]);
for(const [index, key] of ['reading','focus','habit','english','budget','career','review','meal'].entries())await q('UPDATE entities SET sort_order=? WHERE type=? AND id=?',[index,'plugin',key]);
console.log('Database schema and seed ready; administrator credentials are in private/admin-credentials.txt.');await pool.end();
