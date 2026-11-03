import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
const dir=path.join(process.cwd(),'database/backups');fs.mkdirSync(dir,{recursive:true,mode:0o700});
const filename=`xuexi-${new Date().toISOString().replace(/[:.]/g,'-')}.sql.gz`,file=path.join(dir,filename);
const child=spawn('mysqldump',['--single-transaction','--no-tablespaces','--skip-comments','--set-gtid-purged=OFF','-h',process.env.DB_HOST||'127.0.0.1','-u',process.env.DB_USER,process.env.DB_NAME],{env:{...process.env,MYSQL_PWD:process.env.DB_PASSWORD},stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',b=>{errors+=b;});const exit=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Database backup failed: '+errors.replaceAll(process.env.DB_PASSWORD,'***'))));});try{await Promise.all([pipeline(child.stdout,createGzip(),fs.createWriteStream(file,{mode:0o600})),exit]);console.log(`Backup saved: ${file}`);const files=fs.readdirSync(dir).filter(n=>/^xuexi-.*\.sql\.gz$/.test(n)).sort().reverse();for(const old of files.slice(30))fs.unlinkSync(path.join(dir,old));}catch(e){fs.rmSync(file,{force:true});throw e;}
