import fs from 'node:fs/promises';
import path from 'node:path';
import {settings} from './db.mjs';
export async function apkInfo(){try{return JSON.parse(await fs.readFile(path.join(process.cwd(),'public/downloads/build.json'),'utf8'));}catch{return {};}}
export async function publicSettings(admin=false) {
 const s=await settings(),apk=await apkInfo();
 if(apk.downloadUrl) {
  const configured=s.apk||{};
  const buildStatus=['building','failed'].includes(configured.buildStatus)?configured.buildStatus:'ready';
  const current=configured.buildStatus==='not_built'?apk:configured;
  s.apk={...apk,...current,buildStatus,status:buildStatus,published:apk};
  for(const key of ['downloadUrl','latestDownloadUrl','filename','size','sha256','certificateSha256','builtAt','minSdkVersion','targetSdkVersion','signed','signatureSchemes'])if(apk[key]!==undefined)s.apk[key]=apk[key];
 }
 const payment={...s.payment};
 for(const key of ['epayKey','stripeSecret','stripeWebhookSecret']) {
  if(admin)payment[`${key}Configured`]=Boolean(payment[key]);
  delete payment[key];
 }
 if(!admin){delete payment.epayPid;delete payment.epayUrl;}
 return {...s,payment};
}
