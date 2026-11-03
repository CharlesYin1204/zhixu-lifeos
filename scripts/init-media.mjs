import fs from 'node:fs/promises';
import path from 'node:path';
import {q,pool,entities,entity,putEntity} from '../lib/db.mjs';
import {MEDIA_DEFAULTS} from '../lib/media.mjs';
const schema=await fs.readFile(new URL('../database/schema.sql',import.meta.url),'utf8');
try{
 for(const statement of schema.split(';').map(s=>s.trim()).filter(s=>/^CREATE TABLE IF NOT EXISTS media_/.test(s)))await q(statement);
 const models=await entities('model'),source=models.find(model=>model.isDefault&&model.apiKey)||models.find(model=>model.apiKey);if(!source)throw new Error('请先配置默认模型');
 for(const seed of [{id:'media-gpt4o-mini',name:'多模态学习助手',model:'gpt-4o-mini',capability:'chat'},{id:'media-transcribe',name:'语音识别 GPT-4o',model:'gpt-4o-transcribe',capability:'transcription'},{id:'media-whisper',name:'录音识别 Whisper',model:'whisper-1',capability:'transcription'},{id:'media-tts',name:'自然语音朗读',model:'gpt-4o-mini-tts',capability:'speech'}])if(!await entity('model',seed.id))await putEntity('model',{...seed,baseUrl:source.baseUrl,apiKey:source.apiKey,enabled:true,isDefault:false});
 const connection=await pool.getConnection();try{await connection.beginTransaction();const [rows]=await connection.execute('SELECT data FROM settings WHERE id=1 FOR UPDATE');const settings=JSON.parse(rows[0].data);settings.media={...MEDIA_DEFAULTS,...settings.media};await connection.execute('UPDATE settings SET data=? WHERE id=1',[JSON.stringify(settings)]);await connection.commit();}catch(error){await connection.rollback();throw error;}finally{connection.release();}
 await fs.mkdir('private/media',{recursive:true,mode:0o700});await fs.mkdir('private/media-test',{recursive:true,mode:0o700});const sample=path.join(process.cwd(),'private/media-test/english-sample.mp3');try{await fs.access(sample);}catch{await fs.copyFile('docs/tests/media-fixtures/speech-gpt-4o-mini-tts.mp3',sample);await fs.chmod(sample,0o600);}
 console.log('Media schema, non-default models, settings and synthetic speech test sample ready.');
}finally{await pool.end();}
