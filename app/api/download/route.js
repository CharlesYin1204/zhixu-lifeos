import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public Android distribution only. Never accept arbitrary paths or private files.
const allowedFile = /^(?:build\.json|zhixu-lifeos(?:-[0-9]+(?:\.[0-9]+){0,3}(?:[-+][A-Za-z0-9.-]+)?-[1-9][0-9]*)?\.apk)$/;

export async function GET(request) {
  const filename = new URL(request.url).searchParams.get('file') || 'zhixu-lifeos.apk';
  if (filename.length > 150 || !allowedFile.test(filename)) {
    return Response.json({ error: '下载文件不存在' }, { status: 404 });
  }
  let handle;
  try {
    const directory = await realpath(path.join(process.cwd(), 'public', 'downloads'));
    const file = await realpath(path.join(directory, filename));
    if (path.dirname(file) !== directory) {
      return Response.json({ error: '下载文件不存在' }, { status: 404 });
    }
    handle = await open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) {
      await handle.close();
      return Response.json({ error: '下载文件不存在' }, { status: 404 });
    }
    const json = filename === 'build.json';
    const stream = Readable.toWeb(handle.createReadStream({ autoClose: true }));
    handle = undefined; // The response stream owns and closes the file descriptor.
    return new Response(stream, {
      headers: {
        'Content-Type': json ? 'application/json; charset=utf-8' : 'application/vnd.android.package-archive',
        'Content-Disposition': `${json ? 'inline' : 'attachment'}; filename="${filename}"`,
        'Content-Length': String(stat.size),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    if (handle) await handle.close().catch(() => {});
    return Response.json({ error: '安装包尚未生成，请稍后重试' }, { status: 404 });
  }
}
