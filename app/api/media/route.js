import {NextResponse} from 'next/server';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {stat} from 'node:fs/promises';
import {AppError,assert,sessionUser,limit} from '../../../lib/security.mjs';
import {MEDIA_LIMITS,mediaConfig,requireMediaOrigin,storeMediaAsset,ownedAsset,assetPath,listMediaAssets,deleteMediaAsset,mediaHistory,mediaConversation,runMediaVision,runMediaTranscription} from '../../../lib/media.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=180;
const json=(value,status=200)=>NextResponse.json({ok:status<400,...value},{status,headers:{'Cache-Control':'no-store'}});
function fail(error){if(!(error instanceof AppError)&&!['AbortError','TimeoutError'].includes(error.name))console.error('Media API:',error.code||error.name);return json({error:error instanceof AppError?error.message:error.name==='TimeoutError'?'媒体处理超时，请重试':error.name==='AbortError'?'媒体请求已取消':'媒体服务暂时不可用，请稍后重试'},error.status||(['AbortError','TimeoutError'].includes(error.name)?504:500));}
async function boundedBody(request,maximum){assert(Number(request.headers.get('content-length')||0)<=maximum,'请求超过大小限制',413);const reader=request.body?.getReader();assert(reader,'请求为空');const chunks=[];let length=0;try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maximum){await reader.cancel();throw new AppError('请求超过大小限制',413);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}return Buffer.concat(chunks,length);}
export async function GET(request){try{const resource=request.nextUrl.searchParams.get('resource')||'config';if(resource==='config')return json(await mediaConfig());const user=await sessionUser(request);assert(user,'请先登录',401);if(resource==='history')return json({sessions:await mediaHistory(user.id)});if(resource==='conversation')return json({conversation:await mediaConversation(user.id,request.nextUrl.searchParams.get('id'))});if(resource==='assets')return json(await listMediaAssets(user.id,request.nextUrl.searchParams.get('cursor')));if(resource==='asset'){const asset=await ownedAsset(user.id,request.nextUrl.searchParams.get('id'));let size;try{size=(await stat(assetPath(asset))).size;}catch{throw new AppError('附件文件已删除',404);}return new Response(Readable.toWeb(createReadStream(assetPath(asset))),{headers:{'Content-Type':asset.mime,'Content-Length':String(size),'Content-Disposition':`inline; filename="${asset.id}.${asset.kind==='image'?'webp':'wav'}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}throw new AppError('资源不存在',404);}catch(error){return fail(error);}}
export async function POST(request){try{
 requireMediaOrigin(request.headers.get('origin'));const user=await sessionUser(request);assert(user,'请先登录',401);const type=request.headers.get('content-type')||'';
 if(type.startsWith('multipart/form-data')){
  await limit(`media-upload-body:${user.id}`,15,60000);const body=await boundedBody(request,MEDIA_LIMITS.audioBytes+1024*1024);let form;try{form=await new Response(body,{headers:{'Content-Type':type}}).formData();}catch{throw new AppError('附件上传格式无效');}
  const file=form.get('file'),kind=form.get('kind');assert(file&&typeof file.arrayBuffer==='function','请选择附件文件');assert(file.size<=(kind==='image'?MEDIA_LIMITS.imageBytes:MEDIA_LIMITS.audioBytes),'上传文件过大',413);return json({asset:await storeMediaAsset(user.id,{kind,name:file.name,bytes:Buffer.from(await file.arrayBuffer())})});
 }
 assert(type.includes('application/json'),'请求格式无效',415);const body=await boundedBody(request,40000);let data;try{data=JSON.parse(body.toString('utf8'));}catch{throw new AppError('请求 JSON 格式无效');}assert(data&&typeof data==='object'&&!Array.isArray(data),'请求格式无效');const action=data.action||data.kind;
 if(action==='vision')return json(await runMediaVision(user.id,data,request.signal));if(action==='transcribe')return json(await runMediaTranscription(user.id,data,request.signal));if(action==='asset.delete')return json(await deleteMediaAsset(user.id,data.assetId));throw new AppError('操作不存在',404);
}catch(error){return fail(error);}}
