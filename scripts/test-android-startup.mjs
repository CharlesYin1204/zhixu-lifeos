#!/usr/bin/env node
/** Executes extracted production Java callbacks with small deterministic JVM doubles.
 * This does not execute Android framework code, WebView, TLS, or a physical device.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'android/src/MainActivity.java'), 'utf8');
const fixture = readFileSync(join(root, 'android/tests/StartupHarness.java.template'), 'utf8');
const androidJar = process.env.ANDROID_JAR || '/usr/lib/android-sdk/platforms/android-23/android.jar';
const workspace = mkdtempSync(join(tmpdir(), 'zhixu-android-startup-'));
const reportPath = join(root, 'docs/tests/android-startup-results.json');
const report = {
  testedAt: new Date().toISOString(),
  scope: 'Real MainActivity Java methods and callbacks extracted unchanged, executed on JVM with deterministic test doubles; complete Android source separately compiled against API23. Not Android runtime or device validation.',
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  androidJar,
  limitations: ['No Android device or emulator was available.', 'The doubles do not implement Chromium, Android rendering/lifecycle scheduling, TLS or certificate trust.', 'DOM results are controlled callback values; actual page rendering requires browser/device verification.'],
  results: [],
};

// Lexical brace scanner ignores braces in Java strings, character literals and comments.
function balancedBlock(start) {
  const open = source.indexOf('{', start);
  assert.ok(open >= start, `No block at ${start}`);
  let depth = 0, quote = '', comment = '';
  for (let i = open; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (comment === '//') { if (c === '\n') comment = ''; continue; }
    if (comment === '/*') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '/' && (n === '/' || n === '*')) { comment = c + n; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Unbalanced Java source');
}
function method(name) {
  const re = new RegExp(`(?:private|protected|public) (?:[A-Za-z0-9_<>\\[\\]]+ )?${name}\\(`, 'g');
  const matches = [...source.matchAll(re)];
  assert.equal(matches.length, 1, `Expected one production method ${name}`);
  return balancedBlock(matches[0].index);
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error(`${command}: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout;
}

try {
  const methods = ['loadPage', 'beginLoading', 'cancelLoadTimeout', 'inspectPage', 'sameDocument', 'isMainResource', 'networkErrorText', 'sslErrorText', 'diagnosticHost', 'isAppUrl', 'effectivePort', 'isDownload', 'openExternal', 'createErrorView', 'showError', 'onSaveInstanceState', 'onPause', 'onBackPressed', 'onDestroy'];
  const callbackStart = source.indexOf('new WebViewClient() {');
  assert.ok(callbackStart >= 0, 'Production WebViewClient must exist');
  const savedStart = source.indexOf('Bundle saved = state == null ? null : state.getBundle("web_state");');
  const savedEnd = source.indexOf('\n        } catch (RuntimeException error)', savedStart);
  assert.ok(savedStart >= 0 && savedEnd > savedStart, 'Production saved state restoration block must exist');
  const harness = fixture.replace('/* PRODUCTION_METHODS */', methods.map(method).join('\n\n'))
    .replace('/* PRODUCTION_CLIENT */', balancedBlock(callbackStart))
    .replace('/* PRODUCTION_RESTORE */', source.slice(savedStart, savedEnd));
  writeFileSync(join(workspace, 'StartupHarness.java'), harness);
  mkdirSync(join(workspace, 'harness-classes'));
  run('javac', ['-J-Xmx128m', '-encoding', 'UTF-8', '-classpath', androidJar, '-d', join(workspace, 'harness-classes'), join(workspace, 'StartupHarness.java')]);
  const output = run('java', ['-Xmx128m', '-classpath', `${join(workspace, 'harness-classes')}:${androidJar}`, 'StartupHarness']);
  for (const line of output.trim().split('\n')) {
    const [status, ...name] = line.split('\t');
    assert.equal(status, 'PASS', line);
    report.results.push({ name: name.join('\t'), passed: true });
  }
  // Separately compile unmodified production source with the same platform and Java target as APK builds.
  mkdirSync(join(workspace, 'production-classes'));
  writeFileSync(join(workspace, 'BuildConfig.java'), 'package com.zhixu.lifeos.shell; final class BuildConfig { static final String SERVER_URL="https://xuexi.yinchao1204.vip/"; static final String VERSION_NAME="1.1.2"; }\n');
  const sources = readdirSync(join(root, 'android/src')).filter(x => x.endsWith('.java')).map(x => join(root, 'android/src', x));
  run('javac', ['-J-Xmx128m', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', androidJar, '-d', join(workspace, 'production-classes'), ...sources, join(workspace, 'BuildConfig.java')]);
  assert.equal(readFileSync(join(root, 'android/src/MainActivity.java'), 'utf8'), source, 'Source changed during test; rerun after edits finish');
  report.results.push({ name: 'Complete real Android sources compile against API23 with Java8 bytecode target', passed: true });
  report.extractedMethods = methods;
  report.passed = report.results.length;
  report.failed = 0;
} catch (error) {
  report.passed = report.results.length;
  report.failed = 1;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  rmSync(workspace, { recursive: true, force: true });
  report.temporaryWorkspaceRemoved = true;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
