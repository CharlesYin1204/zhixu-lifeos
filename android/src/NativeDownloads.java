package com.zhixu.lifeos.shell;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.widget.Toast;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Saves first-party downloads using the system document picker, without storage permission. */
final class NativeDownloads {
    private static final int SAVE_DOCUMENT = 4301;
    private static final long MAX_BYTES = 16L * 1024 * 1024;
    private final Activity activity;
    private final WebView webView;
    private final Handler handler = new Handler();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile Job active;
    private volatile boolean closed;

    private static final class Job {
        File file;
        String name, mime, key;
        long bytes, expected, started = System.currentTimeMillis();
        boolean choosing;
    }

    NativeDownloads(Activity activity, WebView webView, Bundle state) {
        this.activity=activity;this.webView=webView;
        if (state!=null) {
            String cached=state.getString("download_cache");
            if (cached!=null && cached.matches("download-[a-f0-9-]{36}\\.tmp")) {
                File file=new File(directory(),cached);
                if (file.isFile() && file.length()>0 && file.length()<=MAX_BYTES) {
                    Job job=new Job();job.file=file;job.name=safeName(state.getString("download_name"));job.mime=safeMime(state.getString("download_mime"));job.choosing=true;active=job;
                }
            }
        }
    }

    private File directory() {File dir=new File(activity.getCacheDir(),"downloads");dir.mkdirs();return dir;}
    private boolean sameOrigin(Uri uri) {
        Uri site=Uri.parse(BuildConfig.SERVER_URL);
        return site.getScheme().equalsIgnoreCase(uri.getScheme()) && site.getHost().equalsIgnoreCase(uri.getHost()) && port(site)==port(uri) && uri.getUserInfo()==null;
    }
    private int port(Uri uri) {return uri.getPort()!=-1?uri.getPort():"https".equalsIgnoreCase(uri.getScheme())?443:80;}
    private boolean currentSite() {return webView.getUrl()!=null && sameOrigin(Uri.parse(webView.getUrl()));}
    private boolean live(Job job) {return !closed && active==job;}
    private String safeMime(String mime) {if(mime!=null)mime=mime.split(";",2)[0].trim();return mime!=null && mime.matches("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+")?mime:"application/octet-stream";}
    private String safeName(String name) {
        if (name==null) name="知序下载";
        name=name.replaceAll("[\\\\/\\x00-\\x1f\\x7f]","_").trim();
        return name.length()==0?"知序下载":name.substring(0,Math.min(120,name.length()));
    }

    boolean handle(final String url, final String userAgent, String disposition, String mime, long length) {
        final boolean blob=url!=null && url.startsWith("blob:");
        Uri target=Uri.parse(blob?url.substring(5):url==null?"":url);
        if (!sameOrigin(target)) return false; // External URLs never receive account cookies.
        if (!currentSite()) {toast("请在应用页面内发起下载");return true;}
        if (active!=null) {toast("请先完成或取消当前保存");return true;}
        if (length>MAX_BYTES) {toast("文件超过 16MB，请在浏览器中下载");return true;}
        final Job job=new Job();job.mime=safeMime(mime);job.name=safeName(URLUtil.guessFileName(url,disposition,job.mime));
        job.file=new File(directory(),"download-"+UUID.randomUUID().toString()+".tmp");
        active=job;
        if (blob) startBlob(job,url);
        else {
            final String cookie=CookieManager.getInstance().getCookie(url);
            io.execute(new Runnable(){@Override public void run(){downloadHttp(job,url,userAgent,cookie);}});
        }
        return true;
    }

    private void downloadHttp(final Job job,String url,String userAgent,String cookie) {
        HttpURLConnection connection=null;
        try {
            if (!sameOrigin(Uri.parse(url))) throw new Exception("下载地址不属于本站");
            connection=(HttpURLConnection)new URL(url).openConnection();
            connection.setInstanceFollowRedirects(false); // Never forward cookies across redirects.
            connection.setConnectTimeout(20000);connection.setReadTimeout(20000);
            connection.setRequestProperty("Accept-Encoding","identity");
            if (userAgent!=null) connection.setRequestProperty("User-Agent",userAgent);
            if (cookie!=null && cookie.length()>0) connection.setRequestProperty("Cookie",cookie);
            int status=connection.getResponseCode();
            if (status==401 || status==403) throw new Exception("请登录有权访问此附件的账户后重试");
            if (status>=300 && status<400) throw new Exception("附件地址发生跳转，请返回应用重新打开");
            if (status!=200) throw new Exception("附件下载失败，请稍后重试");
            String size=connection.getHeaderField("Content-Length");
            long expected=size==null?-1:Long.parseLong(size);
            if (expected>MAX_BYTES) throw new Exception("文件超过 16MB");
            job.mime=safeMime(connection.getContentType()==null?job.mime:connection.getContentType().split(";")[0]);
            job.name=safeName(URLUtil.guessFileName(url,connection.getHeaderField("Content-Disposition"),job.mime));
            try(InputStream input=connection.getInputStream();OutputStream output=new FileOutputStream(job.file)) {
                byte[] buffer=new byte[32768];int count;
                while((count=input.read(buffer))!=-1) {
                    if (!live(job)) throw new Exception("下载已取消");
                    job.bytes+=count;
                    if (job.bytes>MAX_BYTES || System.currentTimeMillis()-job.started>120000) throw new Exception("下载超过大小或时间限制");
                    output.write(buffer,0,count);
                }
            }
            if (job.bytes==0 || expected>=0 && job.bytes!=expected) throw new Exception("附件下载不完整，请重试");
            activity.runOnUiThread(new Runnable(){@Override public void run(){chooseDocument(job);}});
        } catch(final Exception error) {activity.runOnUiThread(new Runnable(){@Override public void run(){fail(job,error.getMessage());}});}
        finally {if(connection!=null)connection.disconnect();}
    }

    private void startBlob(final Job job,String url) {
        job.key="__zhixu_download_"+UUID.randomUUID().toString().replace("-","");
        String script="(function(){var s={ready:false,offset:0};window["+JSONObject.quote(job.key)+"]=s;fetch("+JSONObject.quote(url)+").then(function(r){return r.blob();}).then(function(b){s.blob=b;s.ready=true;}).catch(function(){s.error='无法读取本地录音';});return true;})()";
        webView.evaluateJavascript(script,new ValueCallback<String>(){@Override public void onReceiveValue(String ignored){pollBlob(job,true);}});
    }

    private void pollBlob(final Job job,final boolean header) {
        if (!live(job)) return;
        if (!currentSite() || System.currentTimeMillis()-job.started>120000) {fail(job,"下载已中断，请重新选择文件");return;}
        String script="(function(){var s=window["+JSONObject.quote(job.key)+"];if(!s)return JSON.stringify({error:'页面已更新'});if(s.error)return JSON.stringify({error:s.error});";
        if (header) script+="return JSON.stringify(s.ready?{ready:true,size:s.blob.size,type:s.blob.type}:{ready:false});";
        else script+="if(s.chunk!=null){var d=s.chunk;s.chunk=null;return JSON.stringify({ready:true,data:d,offset:s.offset,eof:s.offset>=s.blob.size});}return JSON.stringify({ready:false});";
        script+="})()";
        webView.evaluateJavascript(script,new ValueCallback<String>(){@Override public void onReceiveValue(String value){
            if (!live(job)) return;
            try {
                Object decoded=new JSONTokener(value).nextValue();
                JSONObject result=decoded instanceof String?new JSONObject((String)decoded):(JSONObject)decoded;
                if (result.has("error")) {fail(job,result.getString("error"));return;}
                if (!result.optBoolean("ready")) {handler.postDelayed(new Runnable(){@Override public void run(){pollBlob(job,header);}},25);return;}
                if (header) {
                    job.expected=result.getLong("size");
                    if (job.expected<=0 || job.expected>MAX_BYTES) {fail(job,"录音为空或超过 16MB");return;}
                    job.mime=safeMime(result.optString("type",job.mime));
                    String extension=MimeTypeMap.getSingleton().getExtensionFromMimeType(job.mime);
                    if(extension==null)extension="webm";
                    job.name="知序录音-"+System.currentTimeMillis()+"."+extension;
                    readBlobChunk(job);
                } else appendBlob(job,result);
            } catch(Exception error) {fail(job,"读取本地录音失败，请重试");}
        }});
    }

    private void readBlobChunk(final Job job) {
        if (!live(job)) return;
        String script="(function(){var s=window["+JSONObject.quote(job.key)+"];if(!s||!s.blob)return;var end=Math.min(s.offset+49152,s.blob.size),r=new FileReader();r.onload=function(){s.chunk=String(r.result).split(',')[1];s.offset=end;};r.onerror=function(){s.error='无法读取本地录音';};r.readAsDataURL(s.blob.slice(s.offset,end));})()";
        webView.evaluateJavascript(script,new ValueCallback<String>(){@Override public void onReceiveValue(String ignored){pollBlob(job,false);}});
    }

    private void appendBlob(final Job job,JSONObject result) throws Exception {
        String encoded=result.getString("data");
        if (encoded.length()>65536) throw new Exception("Invalid chunk size");
        final byte[] bytes=Base64.decode(encoded,Base64.DEFAULT);
        final long offset=result.getLong("offset");final boolean eof=result.getBoolean("eof");
        if (bytes.length==0 || offset!=job.bytes+bytes.length || offset>job.expected || offset>MAX_BYTES || eof!=(offset==job.expected)) throw new Exception("Invalid blob chunk");
        io.execute(new Runnable(){@Override public void run(){
            try {
                if(!live(job))return;
                try(OutputStream output=new FileOutputStream(job.file,true)){output.write(bytes);}
                activity.runOnUiThread(new Runnable(){@Override public void run(){if(!live(job))return;job.bytes=offset;if(eof){clearBlob(job);chooseDocument(job);}else readBlobChunk(job);}});
            } catch(Exception error) {activity.runOnUiThread(new Runnable(){@Override public void run(){fail(job,"无法准备录音文件，请重试");}});}
        }});
    }

    private void chooseDocument(Job job) {
        if (!live(job)) return;
        try {
            Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT);
            save.addCategory(Intent.CATEGORY_OPENABLE);save.setType(job.mime);save.putExtra(Intent.EXTRA_TITLE,job.name);
            job.choosing=true;activity.startActivityForResult(save,SAVE_DOCUMENT);
        }catch(Exception error){fail(job,"当前设备没有可用的文件保存程序");}
    }

    boolean onActivityResult(int code,int result,Intent data) {
        if(code!=SAVE_DOCUMENT)return false;
        final Job job=active;if(job==null)return true;
        job.choosing=false;
        if(result!=Activity.RESULT_OK || data==null || data.getData()==null){clear(job);return true;}
        final Uri destination=data.getData();
        if(!"content".equals(destination.getScheme())){fail(job,"文件保存位置无效");return true;}
        io.execute(new Runnable(){@Override public void run(){
            try(InputStream input=new FileInputStream(job.file);OutputStream output=activity.getContentResolver().openOutputStream(destination,"wt")) {
                if(output==null)throw new Exception("No output stream");
                byte[] buffer=new byte[32768];int count;
                while((count=input.read(buffer))!=-1){if(!live(job))throw new Exception("Cancelled");output.write(buffer,0,count);}
                output.flush();
                activity.runOnUiThread(new Runnable(){@Override public void run(){if(live(job)){toast("已保存到所选位置");clear(job);}}});
            }catch(Exception error){activity.runOnUiThread(new Runnable(){@Override public void run(){fail(job,"保存未完成，请重新下载并选择可写入的位置");}});}
        }});
        return true;
    }

    void saveState(Bundle state) {
        Job job=active;
        if(job!=null && job.choosing){state.putString("download_cache",job.file.getName());state.putString("download_name",job.name);state.putString("download_mime",job.mime);}
    }
    void destroy(boolean finishing) {
        Job job=active;if(job!=null && (finishing || !job.choosing))clear(job);
        closed=true;handler.removeCallbacksAndMessages(null);io.shutdownNow();
    }
    private void clearBlob(Job job) {if(job.key!=null && !closed){webView.evaluateJavascript("delete window["+JSONObject.quote(job.key)+"]",null);job.key=null;}}
    private void clear(Job job) {clearBlob(job);if(job.file!=null)job.file.delete();if(active==job)active=null;}
    private void fail(Job job,String message) {if(live(job))toast(message==null?"下载失败，请重试":message);clear(job);}
    private void toast(String message) {Toast.makeText(activity,message,Toast.LENGTH_LONG).show();}
}
