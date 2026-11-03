package com.zhixu.lifeos.shell;

import android.app.Activity;
import android.Manifest;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Parcel;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ConsoleMessage;
import android.webkit.DownloadListener;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/** Small native Android host. All account and application data stays on the server. */
public final class MainActivity extends Activity {
    private static final int FILE_REQUEST = 4201;
    private static final int MEDIA_PERMISSION = 4202;
    private static final int CAMERA_PERMISSION = 4203;
    private WebView webView;
    private LinearLayout errorView;
    private ProgressBar progress;
    private ValueCallback<Uri[]> fileCallback;
    private boolean loadFailed;
    private PermissionRequest mediaPermission;
    private Uri captureUri;
    private NativeDownloads downloads;
    private TextView errorTitle;
    private TextView errorBody;
    private final Handler loadHandler = new Handler();
    private Runnable loadTimeout;
    private int loadGeneration;
    private boolean destroyed;
    private boolean initializationFailed;
    private boolean scriptError;
    private boolean pageReady;
    private String loadingUrl = BuildConfig.SERVER_URL;
    private String webViewVersion = "未知";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(27, 78, 65));
        getWindow().setNavigationBarColor(Color.rgb(246, 247, 243));
        FrameLayout root = new FrameLayout(this);
        errorView = createErrorView();
        root.addView(errorView, new FrameLayout.LayoutParams(-1, -1));
        errorView.setVisibility(View.GONE);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP);
        root.addView(progress, progressParams);
        setContentView(root);
        try {
        webView = new WebView(this);
        root.addView(webView, 0, new FrameLayout.LayoutParams(-1, -1));
        downloads = new NativeDownloads(this,webView,state);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Android's system document picker.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        String userAgent = settings.getUserAgentString();
        java.util.regex.Matcher version = java.util.regex.Pattern.compile("Chrome/([0-9.]+)").matcher(userAgent == null ? "" : userAgent);
        if (version.find()) webViewVersion = version.group(1);
        settings.setUserAgentString(userAgent + " ZhixuLifeOS/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri target = Uri.parse(url);
                if (url.startsWith("blob:") && isAppUrl(Uri.parse(url.substring(5)))) return false;
                if (isAppUrl(target) && !isDownload(target)) return false;
                openExternal(target);
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                beginLoading(url);
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (destroyed || !isMainResource(url)) return;
                progress.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
                if (!loadFailed) inspectPage(loadGeneration, 0);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !loadFailed && isMainResource(request.getUrl().toString())) {
                    showError("网页暂时无法打开", networkErrorText(error.getErrorCode()), "网络连接");
                }
            }
            @SuppressWarnings("deprecation")
            @Override public void onReceivedError(WebView view, int code, String description, String failingUrl) {
                if (!loadFailed && isMainResource(failingUrl)) {
                    showError("网页暂时无法打开", networkErrorText(code), "网络连接");
                }
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && !loadFailed && isMainResource(request.getUrl().toString())) {
                    showError("网页暂时无法打开", "服务器返回 HTTP " + response.getStatusCode() + "。请稍后重试。", "服务器响应");
                }
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                // A failed image or other subresource must not replace the entire page.
                if (!loadFailed && isMainResource(error.getUrl())) {
                    showError("无法建立安全连接", sslErrorText(error.getPrimaryError()), "安全连接");
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) scriptError = true;
                // Console text may contain private URLs or data; only retain the error category.
                return false;
            }
            @Override public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() { @Override public void run() {
                    if (!isAppUrl(request.getOrigin()) || !"https".equalsIgnoreCase(request.getOrigin().getScheme())) { request.deny(); return; }
                    if (mediaPermission != null) mediaPermission.deny();
                    mediaPermission = request;
                    java.util.ArrayList<String> missing = new java.util.ArrayList<String>();
                    for (String resource : request.getResources()) {
                        String permission = permissionFor(resource);
                        if (permission != null && checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
                    }
                    if (missing.isEmpty()) resolveMediaPermission();
                    else requestPermissions(missing.toArray(new String[missing.size()]), MEDIA_PERMISSION);
                }});
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (mediaPermission == request) mediaPermission = null;
            }
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                if (value == 100) progress.setVisibility(View.GONE);
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                       FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                releaseCapture(true);
                fileCallback = callback;
                if (view.getUrl() == null || !isAppUrl(Uri.parse(view.getUrl()))) {
                    fileCallback.onReceiveValue(null);fileCallback=null;
                    return true;
                }
                boolean image = false;
                for (String type : params.getAcceptTypes()) if (type != null && type.startsWith("image/")) image = true;
                if (image && params.isCaptureEnabled()) {
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchCamera();
                    else requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION);
                    return true;
                }
                Intent picker = new Intent(Intent.ACTION_GET_CONTENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType(image ? "image/*" : "*/*");
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(Intent.createChooser(picker, "选择文件"), FILE_REQUEST);
                } catch (ActivityNotFoundException exception) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "当前设备没有可用的文件选择器", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
        webView.setDownloadListener(new DownloadListener() {
            @Override public void onDownloadStart(String url, String userAgent, String disposition,
                                                  String mimeType, long length) {
                if (!downloads.handle(url,userAgent,disposition,mimeType,length)) openExternal(Uri.parse(url));
            }
        });
        String pendingCapture = state == null ? null : state.getString("pending_capture");
        if (pendingCapture != null) {
            Uri pending = Uri.parse(pendingCapture);
            if (captureFile(pending) != null) captureUri = pending;
        }
        Bundle saved = state == null ? null : state.getBundle("web_state");
        String url = state == null ? null : state.getString("current_url");
        boolean currentOrigin = url != null && isAppUrl(Uri.parse(url));
        // An updated APK may move from an IP address to its canonical domain.
        // Do not resurrect a previous release's origin through WebView saved history.
        if (saved == null || !currentOrigin || webView.restoreState(saved) == null) {
            loadPage(currentOrigin ? url : BuildConfig.SERVER_URL);
        } else {
            beginLoading(url);
            inspectPage(loadGeneration, 0);
        }
        } catch (RuntimeException error) {
            initializationFailed = true;
            showError("系统网页组件暂不可用", "网页组件初始化失败（" + error.getClass().getSimpleName() + "）。可重试或使用系统浏览器。", "组件初始化");
        } catch (LinkageError error) {
            initializationFailed = true;
            showError("系统网页组件暂不可用", "设备网页组件加载失败。可更新系统网页组件后重试，或使用系统浏览器。", "组件初始化");
        }
    }

    private String permissionFor(String resource) {
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return Manifest.permission.RECORD_AUDIO;
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return Manifest.permission.CAMERA;
        return null;
    }

    private void resolveMediaPermission() {
        PermissionRequest request = mediaPermission;
        mediaPermission = null;
        if (request == null) return;
        if (!isAppUrl(request.getOrigin()) || webView.getUrl() == null || !isAppUrl(Uri.parse(webView.getUrl()))) { request.deny(); return; }
        java.util.ArrayList<String> granted = new java.util.ArrayList<String>();
        for (String resource : request.getResources()) {
            String permission = permissionFor(resource);
            if (permission != null && checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) granted.add(resource);
        }
        if (granted.isEmpty()) request.deny();
        else request.grant(granted.toArray(new String[granted.size()]));
    }

    private void launchCamera() {
        if (fileCallback == null) return;
        try {
            java.io.File directory = new java.io.File(getCacheDir(), "capture");
            directory.mkdirs();
            java.io.File[] oldFiles = directory.listFiles();
            if (oldFiles != null) for (java.io.File file : oldFiles) if (System.currentTimeMillis()-file.lastModified()>86400000L) file.delete();
            java.io.File photo = new java.io.File(directory, java.util.UUID.randomUUID().toString()+".jpg");
            photo.createNewFile();
            captureUri = new Uri.Builder().scheme("content").authority(getPackageName()+".capture").appendPath(photo.getName()).build();
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, captureUri);
            camera.setClipData(android.content.ClipData.newRawUri("photo", captureUri));
            camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            startActivityForResult(camera, FILE_REQUEST);
        } catch (Exception error) {
            fileCallback.onReceiveValue(null);fileCallback=null;releaseCapture(true);
            Toast.makeText(this, "无法打开相机，请选择已有照片", Toast.LENGTH_SHORT).show();
        }
    }

    private java.io.File captureFile(Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme()) || !(getPackageName()+".capture").equals(uri.getAuthority())) return null;
        String name=uri.getLastPathSegment();
        if (name==null || !name.matches("[a-f0-9-]{36}\\.jpg") || uri.getPathSegments().size()!=1) return null;
        return new java.io.File(new java.io.File(getCacheDir(),"capture"),name);
    }

    private void releaseCapture(boolean deleteFile) {
        if (captureUri == null) return;
        revokeUriPermission(captureUri,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        java.io.File photo=captureFile(captureUri);
        if (deleteFile && photo!=null) photo.delete();
        captureUri=null;
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == MEDIA_PERMISSION) resolveMediaPermission();
        if (code == CAMERA_PERMISSION) {
            if (results.length>0 && results[0]==PackageManager.PERMISSION_GRANTED) launchCamera();
            else if (fileCallback != null) { fileCallback.onReceiveValue(null);fileCallback=null; }
        }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (webView == null || initializationFailed) return;
        String url=webView.getUrl();
        if (!loadFailed && url!=null && isAppUrl(Uri.parse(url))) state.putString("current_url",url);
        if (captureUri!=null) state.putString("pending_capture",captureUri.toString());
        if (downloads != null) downloads.saveState(state);
        if (loadFailed) return;
        Bundle saved=new Bundle();webView.saveState(saved);
        Parcel parcel=Parcel.obtain();
        try { parcel.writeBundle(saved);if(parcel.dataSize()<350000)state.putBundle("web_state",saved); }
        finally { parcel.recycle(); }
    }

    @Override protected void onPause() {
        if (webView != null && !initializationFailed) CookieManager.getInstance().flush();
        super.onPause();
    }

    /** Only explicitly granted camera intents can access a single opaque capture URI. */
    public static final class CaptureProvider extends ContentProvider {
        @Override public boolean onCreate(){return true;}
        private java.io.File file(Uri uri) throws java.io.FileNotFoundException {
            String name=uri.getLastPathSegment();
            if(name==null || !name.matches("[a-f0-9-]{36}\\.jpg") || uri.getPathSegments().size()!=1)throw new java.io.FileNotFoundException();
            return new java.io.File(new java.io.File(getContext().getCacheDir(),"capture"),name);
        }
        @Override public ParcelFileDescriptor openFile(Uri uri,String mode) throws java.io.FileNotFoundException {return ParcelFileDescriptor.open(file(uri),ParcelFileDescriptor.parseMode(mode));}
        @Override public String getType(Uri uri){return "image/jpeg";}
        @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String order){
            String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;
            MatrixCursor cursor=new MatrixCursor(columns);
            try {java.io.File item=file(uri);Object[] values=new Object[columns.length];for(int i=0;i<columns.length;i++)values[i]=OpenableColumns.DISPLAY_NAME.equals(columns[i])?item.getName():OpenableColumns.SIZE.equals(columns[i])?item.length():null;cursor.addRow(values);}catch(java.io.FileNotFoundException ignored){}
            return cursor;
        }
        @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
        @Override public int update(Uri uri,ContentValues values,String selection,String[] args){throw new UnsupportedOperationException();}
        @Override public int delete(Uri uri,String selection,String[] args){throw new UnsupportedOperationException();}
    }

    private void loadPage(String url) {
        if (destroyed) return;
        if (webView == null || initializationFailed) { recreate(); return; }
        beginLoading(url);
        try {
            webView.loadUrl(url);
        } catch (RuntimeException error) {
            showError("网页暂时无法打开", "网页组件未能开始加载。请重试或使用系统浏览器。", "开始加载");
        }
    }

    private void beginLoading(String url) {
        if (destroyed) return;
        loadingUrl = url == null ? BuildConfig.SERVER_URL : url;
        loadFailed = false;
        scriptError = false;
        pageReady = false;
        final int generation = ++loadGeneration;
        cancelLoadTimeout();
        errorView.setVisibility(View.GONE);
        if (webView != null) webView.setVisibility(View.VISIBLE);
        progress.setVisibility(View.VISIBLE);
        progress.setProgress(0);
        loadTimeout = new Runnable() {
            @Override public void run() {
                if (!destroyed && generation == loadGeneration && !loadFailed && !pageReady) {
                    showError("页面加载时间较长", "30 秒内未能显示页面。请检查网络后重试，或用系统浏览器打开。", "加载超时");
                }
            }
        };
        loadHandler.postDelayed(loadTimeout, 30000);
    }

    private void cancelLoadTimeout() {
        if (loadTimeout != null) loadHandler.removeCallbacks(loadTimeout);
        loadTimeout = null;
    }

    /** Finishing an HTTP request does not mean a client-rendered page displayed successfully. */
    private void inspectPage(final int generation, final int attempt) {
        if (destroyed || loadFailed || pageReady || webView == null || generation != loadGeneration) return;
        loadHandler.postDelayed(new Runnable() {
            @Override public void run() {
                if (destroyed || loadFailed || pageReady || webView == null || generation != loadGeneration) return;
                String check = "(function(){try{var b=document.body;if(!b)return 'empty';var t=(b.innerText||'').replace(/\\s+/g,'');return t.length>24||b.querySelector('a,button,input,textarea,select,canvas,img,video')?'content':'empty';}catch(e){return 'unknown';}})()";
                try {
                    webView.evaluateJavascript(check, new ValueCallback<String>() {
                        @Override public void onReceiveValue(String result) {
                            if (destroyed || loadFailed || pageReady || generation != loadGeneration) return;
                            if ("\"content\"".equals(result)) {
                                pageReady = true;
                                cancelLoadTimeout();
                            } else if (attempt < 3) {
                                inspectPage(generation, attempt + 1);
                            } else {
                                showError("页面未能显示", scriptError
                                    ? "网页文件已加载，但页面脚本出现错误。请重试，或用系统浏览器打开。"
                                    : "网页加载后仍没有显示内容。请重试，或用系统浏览器打开。",
                                    scriptError ? "页面脚本" : "页面显示");
                            }
                        }
                    });
                } catch (RuntimeException error) {
                    showError("页面未能显示", "系统网页组件暂时无法显示内容。请重试，或用系统浏览器打开。", "页面显示");
                }
            }
        }, attempt == 0 ? 600 : 2500);
    }

    private boolean sameDocument(String first, String second) {
        if (first == null || second == null) return false;
        return Uri.parse(first).buildUpon().fragment(null).build().toString()
                .equals(Uri.parse(second).buildUpon().fragment(null).build().toString());
    }

    private boolean isMainResource(String url) {
        // getUrl() can still name the previous document while a new navigation starts.
        return !destroyed && sameDocument(url, loadingUrl);
    }

    private String networkErrorText(int code) {
        switch (code) {
            case WebViewClient.ERROR_HOST_LOOKUP: return "无法解析站点地址。请检查网络或稍后重试。";
            case WebViewClient.ERROR_CONNECT: return "无法连接站点。请切换网络后重试，或用系统浏览器打开。";
            case WebViewClient.ERROR_TIMEOUT: return "连接超时。请检查网络后重试。";
            case WebViewClient.ERROR_FAILED_SSL_HANDSHAKE: return "安全连接未能建立。请检查设备日期与网络，或用系统浏览器查看。";
            default: return "网页连接未完成（错误 " + code + "）。请重试，或用系统浏览器打开。";
        }
    }

    private String sslErrorText(int code) {
        switch (code) {
            case SslError.SSL_EXPIRED: return "站点证书已过期，已停止连接。请稍后重试。";
            case SslError.SSL_IDMISMATCH: return "站点地址与证书不匹配，已停止连接。";
            case SslError.SSL_UNTRUSTED: return "设备无法验证站点证书，已停止连接。请检查设备日期或使用系统浏览器查看。";
            case SslError.SSL_NOTYETVALID:
            case SslError.SSL_DATE_INVALID: return "证书日期校验未通过。请检查设备日期与时间后重试。";
            default: return "站点证书校验未通过，已停止连接。请稍后重试。";
        }
    }

    private String diagnosticHost() {
        Uri uri = Uri.parse(loadingUrl == null ? BuildConfig.SERVER_URL : loadingUrl);
        String host = uri.getHost();
        if (host == null) return "已配置站点";
        return uri.getScheme() + "://" + host + (uri.getPort() == -1 ? "" : ":" + uri.getPort());
    }

    private boolean isAppUrl(Uri uri) {
        if (uri == null) return false;
        Uri app = Uri.parse(BuildConfig.SERVER_URL);
        return app.getScheme().equalsIgnoreCase(uri.getScheme())
                && app.getHost().equalsIgnoreCase(uri.getHost())
                && effectivePort(app) == effectivePort(uri);
    }

    private int effectivePort(Uri uri) {
        if (uri.getPort() != -1) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private boolean isDownload(Uri uri) {
        String path = uri.getPath();
        if (path == null) return false;
        String lower = path.toLowerCase(java.util.Locale.ROOT);
        String download = uri.getQueryParameter("file");
        return lower.startsWith("/downloads/") || lower.endsWith(".apk")
                || (lower.equals("/api/download") && download != null && download.endsWith(".apk"));
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)
                || "mailto".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme))) {
            Toast.makeText(this, "此链接暂不支持，请在浏览器中操作", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException exception) {
            Toast.makeText(this, "请安装可打开此链接的浏览器或应用", Toast.LENGTH_SHORT).show();
        }
    }

    private LinearLayout createErrorView() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(dp(30), dp(30), dp(30), dp(30));
        layout.setBackgroundColor(Color.rgb(246, 247, 243));
        errorTitle = new TextView(this);
        errorTitle.setText("暂时无法连接");
        errorTitle.setTextSize(24);
        errorTitle.setTextColor(Color.rgb(27, 78, 65));
        errorTitle.setGravity(Gravity.CENTER);
        layout.addView(errorTitle, new LinearLayout.LayoutParams(-1, -2));
        errorBody = new TextView(this);
        errorBody.setTextSize(14);
        errorBody.setTextColor(Color.rgb(104, 118, 112));
        errorBody.setGravity(Gravity.CENTER);
        errorBody.setTextIsSelectable(true);
        errorBody.setPadding(0, dp(18), 0, dp(24));
        layout.addView(errorBody, new LinearLayout.LayoutParams(-1, -2));
        Button retry = new Button(this);
        retry.setText("重新连接");
        retry.setTextColor(Color.rgb(27, 78, 65));
        retry.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                loadPage(BuildConfig.SERVER_URL);
            }
        });
        layout.addView(retry, new LinearLayout.LayoutParams(dp(220), -2));
        Button browser = new Button(this);
        browser.setText("在浏览器中打开");
        browser.setTextColor(Color.rgb(27, 78, 65));
        browser.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                openExternal(Uri.parse(BuildConfig.SERVER_URL));
            }
        });
        layout.addView(browser, new LinearLayout.LayoutParams(dp(220), -2));
        return layout;
    }

    private void showError(String title, String reason, String phase) {
        if (destroyed) return;
        loadFailed = true;
        pageReady = false;
        cancelLoadTimeout();
        errorTitle.setText(title);
        errorBody.setText(reason + "\n\n站点：" + diagnosticHost()
                + "\n阶段：" + phase + "\n应用 " + BuildConfig.VERSION_NAME
                + " · Android " + Build.VERSION.RELEASE + "\nWebView " + webViewVersion);
        if (progress != null) progress.setVisibility(View.GONE);
        if (webView != null) {
            webView.setVisibility(View.GONE);
            try { webView.stopLoading(); } catch (RuntimeException ignored) {}
        }
        errorView.setVisibility(View.VISIBLE);
    }

    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density + 0.5f); }

    @Override public void onBackPressed() {
        if (webView != null && !initializationFailed && webView.canGoBack() && !loadFailed) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (downloads != null && downloads.onActivityResult(requestCode,resultCode,data)) return;
        if (requestCode != FILE_REQUEST) return;
        if (fileCallback == null) { releaseCapture(true); return; }
        Uri[] result = null;
        if (resultCode == RESULT_OK && captureUri != null) {
            java.io.File photo=captureFile(captureUri);
            if (photo!=null && photo.isFile() && photo.length()>0) result = new Uri[]{captureUri};
            else Toast.makeText(this, "未获取到照片，请重试或选择已有照片", Toast.LENGTH_SHORT).show();
        }
        else if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                result = new Uri[count];
                for (int i = 0; i < count; i++) result[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) result = new Uri[]{data.getData()};
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
        // The WebView reads a successful photo asynchronously after this callback.
        releaseCapture(result == null);
    }

    @Override protected void onDestroy() {
        destroyed = true;
        cancelLoadTimeout();
        loadHandler.removeCallbacksAndMessages(null);
        if (mediaPermission != null) {mediaPermission.deny();mediaPermission=null;}
        if (fileCallback != null) {fileCallback.onReceiveValue(null);fileCallback=null;}
        if (isFinishing()) releaseCapture(true);
        if (downloads != null) downloads.destroy(isFinishing());
        if (webView != null) {
            if (webView.getParent() instanceof ViewGroup) ((ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
