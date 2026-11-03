import {assert} from './security.mjs';

const stringFields=['category','priority','date','dueDate','startDate','endDate','startTime','endTime','url','direction','period','goalId'];
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function validateRecordMeta(meta) {
 assert(meta&&typeof meta==='object'&&!Array.isArray(meta),'记录属性格式无效');
 for(const key of stringFields)if(meta[key]!=null)assert(typeof meta[key]==='string'&&meta[key].length<=(key==='url'?2000:240),`${key} 必须为有效文本`);
 if(meta.checkedDates!==undefined){assert(Array.isArray(meta.checkedDates)&&meta.checkedDates.length<=10000&&meta.checkedDates.every(validDate),'打卡日期须为有效日期列表');meta.checkedDates=[...new Set(meta.checkedDates)].sort();}
 if(meta.tags!==undefined)assert(Array.isArray(meta.tags)&&meta.tags.length<=30&&meta.tags.every(x=>typeof x==='string'&&x.length<=64),'标签须为文本列表，最多30项');
 return meta;
}
// Keep old or externally imported malformed metadata from crashing a whole view.
export function safeRecordMeta(value) {
 const meta=value&&typeof value==='object'&&!Array.isArray(value)?{...value}:{};
 for(const key of stringFields)if(meta[key]!=null&&typeof meta[key]!=='string')meta[key]='';
 if(meta.checkedDates!==undefined)meta.checkedDates=Array.isArray(meta.checkedDates)?[...new Set(meta.checkedDates.filter(validDate))]:[];
 if(meta.tags!==undefined)meta.tags=Array.isArray(meta.tags)?meta.tags.filter(x=>typeof x==='string').slice(0,30):[];
 return meta;
}
