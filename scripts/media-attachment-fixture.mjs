import fs from 'node:fs/promises';
import {q,pool,id} from '../lib/db.mjs';
import {storeMediaAsset,assetPath,pcmWav,MEDIA_DIRECTORY} from '../lib/media.mjs';

// Isolated, zero-provider-call fixtures shared by the backend and post-deploy UI checks.
export async function createAttachmentFixture(){
 const fixture={users:[],conversationId:id(),noteId:id(),title:`附件留存验收 ${Date.now()}`,noteTitle:`录音附件验收 ${Date.now()}`};
 try{
  for(let index=0;index<2;index++){const userId=id();await q('INSERT INTO users (id,email,name,password_hash,credits) VALUES (?,?,?,?,?)',[userId,`media-attachment-${userId}@example.test`,'附件状态验收','!no-password-login',30]);fixture.users.push(userId);}
  const image=await fs.readFile('docs/tests/media-fixtures/linear-equation.png');
  fixture.image=await storeMediaAsset(fixture.users[0],{kind:'image',name:'历史题目.png',bytes:image});
  fixture.foreign=await storeMediaAsset(fixture.users[1],{kind:'image',name:'另一用户题目.png',bytes:image});
  fixture.audio=await storeMediaAsset(fixture.users[0],{kind:'audio',name:'历史录音.wav',bytes:pcmWav(Buffer.alloc(24000))});
  // A root-run fixture must remain readable by the existing service account.
  if(process.getuid?.()===0){const owner=await fs.stat(MEDIA_DIRECTORY);for(const asset of await q('SELECT * FROM media_assets WHERE user_id IN (?,?)',fixture.users))await fs.chown(assetPath(asset),owner.uid,owner.gid);}
  fixture.messages=[{role:'user',content:'请保留题目文字：2x + 5 = 17',attachments:[fixture.image]},{role:'assistant',content:'解得 x = 6。删除附件后仍保留这段回答。',sources:[{id:fixture.image.id,kind:'image',title:fixture.image.name,url:fixture.image.url}]}];
  fixture.noteMeta={mediaAssetId:fixture.audio.id,attachments:[fixture.audio],sources:[{id:fixture.audio.id,kind:'audio',title:fixture.audio.name,url:fixture.audio.url}]};
  await q('INSERT INTO conversations (id,user_id,agent_id,title,messages) VALUES (?,?,?,?,?)',[fixture.conversationId,fixture.users[0],'media.image:homework',fixture.title,JSON.stringify(fixture.messages)]);
  await q('INSERT INTO records (id,user_id,kind,title,content,meta) VALUES (?,?,?,?,?,?)',[fixture.noteId,fixture.users[0],'note',fixture.noteTitle,'这是已保存的录音文字，删除附件后仍可阅读。',JSON.stringify(fixture.noteMeta)]);
  return fixture;
 }catch(error){await cleanupAttachmentFixture(fixture);throw error;}
}

export async function cleanupAttachmentFixture(fixture){
 for(const userId of fixture?.users||[]){
  for(const asset of await q('SELECT * FROM media_assets WHERE user_id=?',[userId]))await fs.unlink(assetPath(asset)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const connection=await pool.getConnection();
  try{await connection.beginTransaction();for(const table of ['media_assets','media_operations','sessions','records','conversations','runs','orders','installs','usage_logs','audit'])await connection.execute(`DELETE FROM ${table} WHERE user_id=?`,[userId]);await connection.execute('DELETE FROM rate_limits WHERE id LIKE ?',['%:'+userId]);await connection.execute('DELETE FROM users WHERE id=?',[userId]);await connection.commit();}
  catch(error){await connection.rollback();throw error;}finally{connection.release();}
 }
}
