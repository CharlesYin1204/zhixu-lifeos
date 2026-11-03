import {AppError} from './security.mjs';

const fields={foods:{count:12,length:60},uncertainties:{count:6,length:180},suggestions:{count:4,length:240}};
const foodNarrative=/(?:我|本人|我们|今天|昨天|早餐|午餐|晚餐|感到|感觉|享用)|\b(?:i|we|my|our|today|yesterday|breakfast|lunch|dinner|felt|enjoyed)\b/i;
const experience=/(?:我|我们|你|您|用户)[^。！？\n]{0,14}(?:感到|感觉|吃了|享用|饱腹|精力充沛)|\b(?:i|we|you)\s+(?:(?:have|had|really)\s+)?(?:felt|ate|enjoyed|tasted|was satisfied|were satisfied)\b/i;
const invalid=()=>new AppError('饮食识别未返回有效的事实记录，请重试或补充更清晰的图片。本次不会扣除额度。',502);
export function parseMealFacts(text){
 if(typeof text!=='string'||text.length>12000)throw invalid();
 let value;try{value=JSON.parse(text);}catch{throw invalid();}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==3||Object.keys(value).some(key=>!Object.hasOwn(fields,key)))throw invalid();
 const result={};
 for(const [key,limit] of Object.entries(fields)){
  if(!Array.isArray(value[key])||value[key].length>limit.count)throw invalid();
  result[key]=value[key].map(item=>{
   if(typeof item!=='string'||/[\u0000-\u001f\u007f\u2028\u2029]/u.test(item))throw invalid();
   const clean=item.trim();
   if(!clean||clean.length>limit.length||(key==='foods'?foodNarrative:experience).test(clean))throw invalid();
   return clean;
  });
 }
 return result;
}
const escapeMarkdown=text=>text.replace(/[\\`*_{}\[\]()#+.!|>~<>]/g,'\\$&');
export function renderMealLog(input){
 const facts=parseMealFacts(JSON.stringify(input));
 const list=values=>values.map(value=>`- ${escapeMarkdown(value)}`).join('\n');
 const foods=facts.foods.map(escapeMarkdown).join('、')||'未能清楚识别，请补充图片或手动填写';
 return `## 可见食物\n\n${facts.foods.length?list(facts.foods):'未能清楚识别食物，请补充清晰图片。'}\n\n## 饮食记录草稿\n\n- 食物：${foods}\n- 用餐日期与时间：待补充\n- 实际食用量：待补充\n- 个人感受：待补充\n\n请确认食物名称，并按实际情况补充记录。照片不能确认实际食用量或个人感受。\n\n## 需要确认\n\n${facts.uncertainties.length?list(facts.uncertainties):'食物种类及具体成分仍需本人确认。'}\n\n## 一般搭配建议\n\n${facts.suggestions.length?list(facts.suggestions):'可结合实际饮食情况补充搭配信息。'}`;
}
