#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateDir = join(root, 'private');
const downloadDir = join(root, 'public', 'downloads');
const manifestPath = join(downloadDir, 'build.json');
const lockPath = join(privateDir, 'apk-build.lock');
let workspace;
let ownsLock = false;
let config;

function atomicJson(path, value) {
  const next = `${path}.${process.pid}.tmp`;
  writeFileSync(next, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  renameSync(next, path);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: workspace || root,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, JAVA_TOOL_OPTIONS: '-Xmx256m' },
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command.split('/').pop()} 执行失败：${(result.error?.message || result.stderr || result.stdout || `exit ${result.status}`).slice(0, 1800)}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function xml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function androidString(value) {
  return xml(value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/@/g, '\\@').replace(/\?/g, '\\?'));
}

function findExisting(candidates, description) {
  const found = candidates.filter(Boolean).find(path => existsSync(path));
  if (!found) throw new Error(`缺少 ${description}，请按 docs/android.md 配置现有 Android 工具链。`);
  return found;
}

function readConfig() {
  const argument = process.argv[2];
  if (process.argv.length > 3) throw new Error('用法：node scripts/build-apk.mjs [config.json]');
  let provided = {};
  if (argument) {
    const file = resolve(argument);
    if (!statSync(file).isFile() || statSync(file).size > 16_384) throw new Error('配置文件必须为不超过 16KB 的 JSON 文件。');
    provided = JSON.parse(readFileSync(file, 'utf8'));
  } else if (process.env.APK_CONFIG_JSON) {
    if (process.env.APK_CONFIG_JSON.length > 16_384) throw new Error('APK_CONFIG_JSON 超出长度限制。');
    provided = JSON.parse(process.env.APK_CONFIG_JSON);
  }
  if (!provided || Array.isArray(provided) || typeof provided !== 'object') throw new Error('APK 配置必须为 JSON 对象。');
  const env = process.env;
  const selected = {
    appName: provided.appName ?? env.APK_APP_NAME ?? '知序 LifeOS',
    versionName: provided.versionName ?? env.APK_VERSION_NAME ?? '1.0.0',
    versionCode: Number(provided.versionCode ?? env.APK_VERSION_CODE ?? 1),
    serverUrl: provided.serverUrl ?? env.APK_SERVER_URL ?? env.SECURE_APP_URL ?? 'https://xuexi.yinchao1204.vip',
    packageId: provided.packageId ?? env.APK_PACKAGE_ID ?? 'com.zhixu.lifeos',
  };
  if (typeof selected.appName !== 'string' || !selected.appName.trim() || selected.appName.length > 40 || /[\u0000-\u001f\u007f]/.test(selected.appName)) throw new Error('应用名称须为 1–40 个字符，且不可含控制字符。');
  if (typeof selected.versionName !== 'string' || !/^[0-9]+(?:\.[0-9]+){0,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(selected.versionName) || selected.versionName.length > 30) throw new Error('版本名称格式无效，例如 1.0.0。');
  if (!Number.isSafeInteger(selected.versionCode) || selected.versionCode < 1 || selected.versionCode > 2_100_000_000) throw new Error('版本号须为 1–2100000000 的整数。');
  if (typeof selected.packageId !== 'string' || selected.packageId.length > 120 || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}$/.test(selected.packageId)) throw new Error('包名须包含至少三段小写 Java 标识符，例如 com.zhixu.lifeos。');
  if (typeof selected.serverUrl !== 'string' || selected.serverUrl.length > 1000) throw new Error('服务器地址格式无效。');
  const url = new URL(selected.serverUrl);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) throw new Error('服务器地址必须是无账号、密码及锚点的 HTTP/HTTPS URL。');
  selected.serverUrl = url.href;
  selected.appName = selected.appName.trim();
  return selected;
}

try {
  config = readConfig();
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  mkdirSync(downloadDir, { recursive: true });
  try {
    const fd = openSync(lockPath, 'wx', 0o600);
    writeFileSync(fd, `${process.pid}\n`);
    closeSync(fd);
    ownsLock = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('另一个 APK 构建正在运行。若进程已中断，请检查 private/apk-build.lock 后删除过期锁文件。');
  }

  const sdkTools = findExisting([
    process.env.ANDROID_BUILD_TOOLS,
    '/opt/gaoqiu-android/android-15',
    '/usr/lib/android-sdk/build-tools/debian',
  ], 'Android build-tools');
  const androidJar = findExisting([
    process.env.ANDROID_JAR,
    '/usr/lib/android-sdk/platforms/android-23/android.jar',
    '/usr/share/java/com.android.android-23.jar',
  ], 'android.jar');
  for (const tool of ['aapt', 'd8', 'zipalign', 'apksigner']) {
    if (!existsSync(join(sdkTools, tool))) throw new Error(`Android 工具链缺少 ${tool}。`);
  }

  workspace = mkdtempSync(join(privateDir, 'apk-build-'));
  chmodSync(workspace, 0o700);
  const resources = join(workspace, 'res');
  mkdirSync(join(resources, 'drawable'), { recursive: true });
  mkdirSync(join(resources, 'values'), { recursive: true });
  mkdirSync(join(workspace, 'classes'));
  mkdirSync(join(workspace, 'dex'));
  copyFileSync(join(root, 'android', 'res', 'drawable', 'ic_launcher.xml'), join(resources, 'drawable', 'ic_launcher.xml'));
  writeFileSync(join(resources, 'values', 'strings.xml'), `<?xml version="1.0" encoding="utf-8"?><resources><string name="app_name">${androidString(config.appName)}</string></resources>`);
  writeFileSync(join(workspace, 'AndroidManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${xml(config.packageId)}" android:versionCode="${config.versionCode}" android:versionName="${xml(config.versionName)}">
  <uses-sdk android:minSdkVersion="23" android:targetSdkVersion="28" />
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-feature android:name="android.hardware.microphone" android:required="false" />
  <uses-feature android:name="android.hardware.camera" android:required="false" />
  <uses-feature android:name="android.hardware.camera.any" android:required="false" />
  <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
  <application android:label="@string/app_name" android:icon="@drawable/ic_launcher" android:theme="@android:style/Theme.Material.Light.NoActionBar" android:allowBackup="false" android:usesCleartextTraffic="${new URL(config.serverUrl).protocol === 'http:'}" android:supportsRtl="true">
    <activity android:name="com.zhixu.lifeos.shell.MainActivity" android:exported="true" android:configChanges="keyboardHidden|orientation|screenSize" android:windowSoftInputMode="adjustResize">
      <intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter>
    </activity>
    <provider android:name="com.zhixu.lifeos.shell.MainActivity$CaptureProvider" android:authorities="${xml(config.packageId)}.capture" android:exported="false" android:grantUriPermissions="true" />
  </application>
</manifest>`);
  writeFileSync(join(workspace, 'BuildConfig.java'), `package com.zhixu.lifeos.shell; final class BuildConfig { static final String SERVER_URL = ${JSON.stringify(config.serverUrl)}; static final String VERSION_NAME = ${JSON.stringify(config.versionName)}; }`);

  run(join(sdkTools, 'aapt'), ['package', '-f', '-M', join(workspace, 'AndroidManifest.xml'), '-S', resources, '-I', androidJar, '-F', join(workspace, 'unsigned.apk')]);
  const sources = readdirSync(join(root, 'android', 'src')).filter(file => file.endsWith('.java')).map(file => join(root, 'android', 'src', file));
  run('javac', ['-J-Xmx256m', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', androidJar, '-d', join(workspace, 'classes'), ...sources, join(workspace, 'BuildConfig.java')]);
  const classDir = join(workspace, 'classes', 'com', 'zhixu', 'lifeos', 'shell');
  const classes = readdirSync(classDir).filter(file => file.endsWith('.class')).map(file => join(classDir, file));
  run(join(sdkTools, 'd8'), ['--release', '--min-api', '23', '--lib', androidJar, '--output', join(workspace, 'dex'), ...classes]);
  copyFileSync(join(workspace, 'dex', 'classes.dex'), join(workspace, 'classes.dex'));
  run(join(sdkTools, 'aapt'), ['add', join(workspace, 'unsigned.apk'), 'classes.dex']);
  run(join(sdkTools, 'zipalign'), ['-p', '-f', '4', join(workspace, 'unsigned.apk'), join(workspace, 'aligned.apk')]);

  const keystore = join(privateDir, 'android-signing.jks');
  const passwordFile = join(privateDir, 'android-signing.pass');
  if (!existsSync(keystore)) {
    if (!existsSync(passwordFile)) writeFileSync(passwordFile, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
    run('keytool', ['-genkeypair', '-noprompt', '-keystore', keystore, '-storetype', 'JKS', '-storepass:file', passwordFile, '-keypass:file', passwordFile, '-alias', 'zhixu-lifeos', '-keyalg', 'RSA', '-keysize', '2048', '-sigalg', 'SHA256withRSA', '-validity', '10000', '-dname', 'CN=Zhixu LifeOS, OU=Application, O=Zhixu, C=CN']);
  }
  if (!existsSync(passwordFile)) throw new Error('签名密钥存在，但签名密码文件缺失。请恢复原有密码文件以保留应用更新能力。');
  chmodSync(keystore, 0o600);
  chmodSync(passwordFile, 0o600);
  run(join(sdkTools, 'apksigner'), ['sign', '--ks', keystore, '--ks-key-alias', 'zhixu-lifeos', '--ks-pass', `file:${passwordFile}`, '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', '--out', join(workspace, 'signed.apk'), join(workspace, 'aligned.apk')]);
  const verification = run(join(sdkTools, 'apksigner'), ['verify', '--verbose', '--print-certs', join(workspace, 'signed.apk')]);
  run(join(sdkTools, 'zipalign'), ['-c', '-p', '4', join(workspace, 'signed.apk')]);
  const certificateSha256 = verification.match(/certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1];
  if (!certificateSha256 || !/Verified using v2 scheme .*true/.test(verification)) throw new Error('APK v2 签名校验未通过。');
  const apkBytes = readFileSync(join(workspace, 'signed.apk'));
  const sha256 = createHash('sha256').update(apkBytes).digest('hex');
  const fileName = `zhixu-lifeos-${config.versionName}-${config.versionCode}.apk`;
  const temporaryApk = join(downloadDir, `.apk-${process.pid}.tmp`);
  copyFileSync(join(workspace, 'signed.apk'), temporaryApk);
  chmodSync(temporaryApk, 0o644);
  renameSync(temporaryApk, join(downloadDir, fileName));
  const latestTemp = join(downloadDir, `.latest-${process.pid}.tmp`);
  copyFileSync(join(downloadDir, fileName), latestTemp);
  renameSync(latestTemp, join(downloadDir, 'zhixu-lifeos.apk'));
  const manifest = {
    ...config,
    buildStatus: 'ready',
    status: 'ready',
    builtAt: new Date().toISOString(),
    downloadUrl: `/api/download?file=${encodeURIComponent(fileName)}`,
    latestDownloadUrl: '/api/download?file=zhixu-lifeos.apk',
    filename: fileName,
    size: apkBytes.byteLength,
    sha256,
    certificateSha256,
    minSdkVersion: 23,
    targetSdkVersion: 28,
    signed: true,
    signatureSchemes: ['v1', 'v2', 'v3'].filter(version => new RegExp(`Verified using ${version} scheme .*true`).test(verification)),
  };
  atomicJson(manifestPath, manifest);
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
} catch (error) {
  process.stderr.write(`APK 构建失败：${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  if (ownsLock) rmSync(lockPath, { force: true });
}
