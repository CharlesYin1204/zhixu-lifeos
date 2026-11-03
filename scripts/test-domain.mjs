import { chromium, expect, request } from '@playwright/test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import WebSocket from 'next/dist/compiled/ws/index.js';
import { q, pool } from '../lib/db.mjs';
import { hashPassword } from '../lib/security.mjs';
import { assetPath } from '../lib/media.mjs';

// Run after deployment. The voice test sends only {type:'end'} after 'ready':
// no microphone, audio data, AI model call, purchase, or production setting write.
const base = (process.env.TEST_DOMAIN_URL || 'https://xuexi.yinchao1204.vip').replace(/\/$/, '');
const origin = new URL(base).origin;
const stamp = Date.now(), password = crypto.randomBytes(24).toString('base64url');
const fixtures = ['user', 'admin'].map(role => ({ id: crypto.randomUUID(), role, email: `domain-${role}-${stamp}@example.test`, name: role === 'admin' ? '域名验收管理员' : '域名验收用户' }));
const report = { startedAt: new Date().toISOString(), base, results: [], pageErrors: [], staticResponses: [], staticFailures: [], origins: [], forbiddenActions: [], screenshots: [], verification: 'Actual trusted domain HTTPS, real browser login forms/upload and native WebSocket handshake; temporary accounts; no audio frames, AI requests, payments, or settings/catalog writes.' };
let browser, context, page, anonymous, baseline;
const created = [];
const clean = value => String(value).split(password).join('[redacted]');
const fingerprint = async () => crypto.createHash('sha256').update(JSON.stringify({ settings: await q('SELECT data FROM settings ORDER BY id'), entities: await q('SELECT type,id,data,sort_order FROM entities ORDER BY type,id') })).digest('hex');
async function check(name, run) { const started = Date.now(); await run(); report.results.push({ name, passed: true, durationMs: Date.now() - started }); console.log('PASS', name); }
async function identity(portal, client = context.request, root = base) { const res = await client.get(root + `/api/${portal}?resource=bootstrap`); assert.equal(res.status(), 200); return (await res.json()).user?.id || null; }
async function screenshot(name) { const path = `docs/screenshots/${name}.png`; await page.screenshot({ path, fullPage: true }); report.screenshots.push(path); }
async function noPersonal() { await expect(page.locator('.app-shell,.sidebar,.topbar,.mobile-bottom,.user-features')).toHaveCount(0); }
async function login(portal) {
  const fixture = fixtures[portal === 'admin' ? 1 : 0];
  await page.goto(base + (portal === 'admin' ? '/admin/login' : '/login'));
  await expect(page.locator('input[name=email]')).toBeVisible({ timeout: 20000 });
  await noPersonal();
  await page.locator('input[name=email]').fill(fixture.email);
  await page.locator('input[name=password]').fill(password);
  const waiting = page.waitForResponse(res => res.url().endsWith(`/api/${portal}`) && res.request().method() === 'POST' && res.request().postDataJSON()?.action === 'auth.login');
  await page.getByRole('button', { name: portal === 'admin' ? '登录管理后台' : '登录用户中心', exact: true }).click();
  const res = await waiting; assert.equal(res.status(), 200);
  assert.equal(res.request().headers().origin, origin);
  await expect(page).toHaveURL(base + (portal === 'admin' ? '/admin' : '/user'), { timeout: 20000 });
  if (portal === 'admin') await expect(page.locator('.admin-stats')).toBeVisible({ timeout: 20000 });
  else await expect(page.getByRole('heading', { name: '我的个人中心', exact: true })).toBeVisible({ timeout: 20000 });
  const cookie = (await context.cookies(base)).find(item => item.name === (portal === 'admin' ? 'zhixu_admin_session' : 'zhixu_session'));
  assert(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Lax');
  assert.equal(cookie.domain.replace(/^\./, ''), new URL(base).hostname);
  report.cookieFlags ??= []; report.cookieFlags.push({ portal, secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, domain: cookie.domain });
}
async function rejectedUpgrade(url, headers, expected) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(url, { headers, handshakeTimeout: 10000 });
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); socket.terminate(); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error('Rejected WebSocket handshake timed out')), 12000);
    socket.on('unexpected-response', (_req, res) => { res.resume(); finish(res.statusCode === expected ? null : new Error(`WebSocket returned ${res.statusCode}, expected ${expected}`)); });
    socket.on('open', () => finish(new Error('Unauthorized WebSocket was accepted')));
    socket.on('error', error => { if (!settled) finish(error); });
  });
}

try {
  baseline = await fingerprint();
  report.release = (await fs.readFile('private/web-runtime.env', 'utf8')).match(/NEXT_DIST_DIR=['"]?([^\s'"]+)/)?.[1] || 'unknown';
  const hash = await hashPassword(password);
  for (const fixture of fixtures) { await q('INSERT INTO users (id,email,name,password_hash,role,credits) VALUES (?,?,?,?,?,20)', [fixture.id, fixture.email, fixture.name, hash, fixture.role]); created.push(fixture.id); }
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  report.browserVersion = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  anonymous = await request.newContext();
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === 'POST') {
      const multipart = (req.headers()['content-type'] || '').startsWith('multipart/form-data');
      const action = multipart ? 'upload' : req.postDataJSON()?.action;
      const allowed = ['auth.login', 'auth.logout'].includes(action) || url.pathname === '/api/media' && ['upload', 'asset.delete'].includes(action);
      report.origins.push({ endpoint: url.pathname, action, origin: req.headers().origin || null });
      if (!allowed) { report.forbiddenActions.push(action || req.url()); return route.abort('blockedbyclient'); }
    }
    return route.continue();
  });
  page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(clean(error.message)));
  page.on('response', res => { const url = new URL(res.url()); if (url.origin === origin && url.pathname.startsWith('/_next/static/')) { const item = { path: url.pathname, status: res.status() }; report.staticResponses.push(item); if (res.status() >= 400) report.staticFailures.push(item); } });

  await check('Trusted domain HTTPS serves the public homepage and its JavaScript/CSS without 400 or static failures', async () => {
    const res = await page.goto(base + '/'); assert.equal(res.status(), 200);
    report.tls = await res.securityDetails();
    assert.equal(await page.evaluate(() => window.isSecureContext), true);
    await expect(page.locator('.public-landing')).toBeVisible(); await noPersonal();
    await expect(page.locator('main h1')).toBeVisible(); await screenshot('domain-landing');
  });

  await check('Anonymous domain access to personal pages is gated by the independent login', async () => {
    await page.goto(base + '/user?view=ai'); await expect(page).toHaveURL(base + '/login', { timeout: 20000 });
    await expect(page.getByRole('button', { name: '登录用户中心', exact: true })).toBeVisible(); await noPersonal();
    assert.equal(await identity('app'), null);
  });

  await check('Domain browser login accepts the real domain Origin and issues a secure personal cookie', async () => {
    await login('app'); assert.equal(await identity('app'), fixtures[0].id);
    await expect(page.locator('.feature-entry-grid button')).toHaveCount(22);
    await screenshot('domain-user-center');
  });

  await check('Domain backend login has its own secure session and does not replace personal identity', async () => {
    await login('admin'); assert.equal(await identity('admin'), fixtures[1].id); assert.equal(await identity('app'), fixtures[0].id);
    await noPersonal(); await expect(page.getByRole('navigation', { name: '后台导航', exact: true }).locator('[data-section]')).toHaveCount(15);
  });

  await check('A real image upload and private download work through the domain and deletion removes the asset', async () => {
    await page.goto(base + '/user?view=media&kind=image');
    await expect(page.getByRole('tab', { name: /图片助手/ })).toHaveAttribute('aria-selected', 'true');
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 35, g: 128, b: 95 } } }).png().toBuffer();
    await page.locator('input[type=file][multiple]').setInputFiles({ name: 'domain-proxy.png', mimeType: 'image/png', buffer: image });
    await expect(page.locator('.media-upload-item.ready')).toHaveCount(1, { timeout: 20000 });
    const assets = await q('SELECT * FROM media_assets WHERE user_id=?', [fixtures[0].id]); assert.equal(assets.length, 1);
    const asset = assets[0]; assert.equal(asset.mime, 'image/webp');
    const url = base + `/api/media?resource=asset&id=${asset.id}`;
    const owned = await context.request.get(url); assert.equal(owned.status(), 200); assert.match(owned.headers()['content-type'], /^image\/webp/);
    assert((await owned.body()).length > 0); assert.equal((await anonymous.get(url)).status(), 401);
    report.upload = { inputBytes: image.length, storedBytes: Number(asset.bytes), mime: asset.mime, private: true };
    await page.getByRole('button', { name: '移除 domain-proxy.png', exact: true }).click();
    await expect(page.locator('.media-upload-item')).toHaveCount(0);
    await expect.poll(async () => Number((await q('SELECT COUNT(*) count FROM media_assets WHERE user_id=?', [fixtures[0].id]))[0].count)).toBe(0);
    assert.equal((await context.request.get(url)).status(), 404);
    assert.equal(await fs.access(assetPath(asset)).then(() => true, () => false), false);
  });

  await check('Native domain WSS receives ready and ends cleanly without any audio frame or provider operation', async () => {
    const url = base.replace(/^http/, 'ws') + '/api/voice/live?scene=english-free';
    report.voice = await page.evaluate(socketUrl => new Promise((resolve, reject) => {
      const events = [], socket = new WebSocket(socketUrl); window.__domainSmokeSocket = socket;
      let ready = false, saved = false, error;
      const timeout = setTimeout(() => { socket.close(); reject(new Error('Voice handshake/end timed out')); }, 15000);
      socket.addEventListener('message', message => {
        const event = JSON.parse(message.data); events.push(event.type);
        if (event.type === 'error') { error = event.message; socket.close(); }
        if (event.type === 'ready') { ready = true; socket.send(JSON.stringify({ type: 'end' })); }
        if (event.type === 'session.saved') saved = true;
      });
      socket.addEventListener('error', () => { error = 'Native domain WebSocket failed'; });
      socket.addEventListener('close', event => { clearTimeout(timeout); error || !ready || !saved || event.code !== 1000 ? reject(new Error(error || `Incomplete voice session: ${events.join(',')} (${event.code})`)) : resolve({ ready, saved, closeCode: event.code, events, audioFramesSent: 0 }); });
    }), url);
    const rows = await q("SELECT messages FROM conversations WHERE user_id=? AND agent_id LIKE 'media.voice:%'", [fixtures[0].id]);
    assert.equal(rows.length, 1); assert.deepEqual(JSON.parse(rows[0].messages), []);
    assert.equal(Number((await q('SELECT COUNT(*) count FROM media_operations WHERE user_id=?', [fixtures[0].id]))[0].count), 0);
  });

  await check('The domain rejects anonymous and foreign-origin media/WebSocket requests', async () => {
    const cookie = (await context.cookies(base)).find(item => item.name === 'zhixu_session');
    const fakeAssetId = crypto.randomUUID(), data = { action: 'asset.delete', assetId: fakeAssetId };
    assert.equal((await anonymous.post(base + '/api/media', { data, headers: { Origin: origin } })).status(), 401);
    assert.equal((await context.request.post(base + '/api/media', { data, headers: { Origin: 'https://untrusted.example' } })).status(), 403);
    assert.equal((await context.request.post(base + '/api/app', { data: { action: 'profile.update', name: fixtures[0].name }, headers: { Origin: 'https://untrusted.example' } })).status(), 403);
    const url = base.replace(/^http/, 'ws') + '/api/voice/live?scene=english-free';
    await rejectedUpgrade(url, { Origin: origin }, 401);
    await rejectedUpgrade(url, { Origin: 'https://untrusted.example', Cookie: `zhixu_session=${cookie.value}` }, 403);
    await rejectedUpgrade('wss://154.40.47.111:3063/api/voice/live?scene=english-free', { Origin: 'https://154.40.47.111:3063' }, 401);
    report.ipVoiceCompatibility = { origin: 'https://154.40.47.111:3063', anonymousHandshakeStatus: 401, retainedAllowedOrigin: true, audioFramesSent: 0 };
  });

  await check('The original HTTPS IP and HTTP IP remain readable and domain sessions stay host-scoped', async () => {
    report.ipCompatibility = [];
    for (const target of ['https://154.40.47.111:3063', 'http://154.40.47.111:3060']) {
      const root = await context.request.get(target + '/'); assert.equal(root.status(), 200); assert((await root.text()).includes('public-landing'));
      const health = await context.request.get(target + '/api/app?resource=health'); assert.equal(health.status(), 200); assert.equal((await health.json()).database, 'connected');
      assert.equal(await identity('app', context.request, target), null);
      report.ipCompatibility.push({ base: target, homepage: root.status(), database: 'connected', domainCookieSent: false });
    }
  });

  await check('Domain backend logout leaves its separate personal session intact', async () => {
    await page.goto(base + '/admin'); await expect(page.locator('.admin-stats')).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: '退出后台', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 20000 });
    assert.equal(await identity('admin'), null); assert.equal(await identity('app'), fixtures[0].id);
  });

  await check('No page errors, static failures, cross-origin browser posts, AI debit, or production configuration mutation occurred', async () => {
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.staticFailures, []); assert(report.staticResponses.length > 0);
    assert.deepEqual(report.forbiddenActions, []); assert(report.origins.length >= 5); assert(report.origins.every(item => item.origin === origin));
    assert.equal(await fingerprint(), baseline);
    for (const fixture of fixtures) {
      assert.equal(Number((await q('SELECT credits FROM users WHERE id=?', [fixture.id]))[0].credits), 20);
      for (const table of ['usage_logs', 'media_operations', 'orders', 'runs']) assert.equal(Number((await q(`SELECT COUNT(*) count FROM ${table} WHERE user_id=?`, [fixture.id]))[0].count), 0);
    }
  });
  report.passed = true;
} catch (error) { report.passed = false; process.exitCode = 1; report.results.push({ passed: false, error: clean(error.stack) }); console.error(clean(error.message)); await page?.screenshot({ path: 'docs/screenshots/domain-failure.png', fullPage: true }).catch(() => {}); }
finally {
  await page?.evaluate(() => { const socket = window.__domainSmokeSocket; if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'end' })); }).catch(() => {});
  await browser?.close(); await anonymous?.dispose();
  for (const id of created) {
    for (const asset of await q('SELECT * FROM media_assets WHERE user_id=?', [id])) await fs.rm(assetPath(asset), { force: true });
    for (const table of ['media_assets', 'media_operations', 'conversations', 'sessions', 'audit']) await q(`DELETE FROM ${table} WHERE user_id=?`, [id]);
    await q('DELETE FROM rate_limits WHERE id LIKE ?', [`%:${id}`]); await q('DELETE FROM users WHERE id=?', [id]);
  }
  for (const fixture of fixtures) await q('DELETE FROM rate_limits WHERE id IN (?,?)', [`auth:${fixture.email}`, `admin-auth:${fixture.email}`]);
  report.fixturesRemoved = Number((await q('SELECT COUNT(*) count FROM users WHERE id IN (?,?)', fixtures.map(item => item.id)))[0].count) === 0;
  report.configurationUnchanged = baseline === await fingerprint(); report.completedAt = new Date().toISOString();
  await fs.writeFile('docs/tests/domain-results.json', JSON.stringify(report, null, 2));
  await pool.end(); console.log('RESULT', JSON.stringify({ passed: report.passed, checks: report.results.filter(item => item.passed).length, pageErrors: report.pageErrors.length, staticFailures: report.staticFailures.length, fixturesRemoved: report.fixturesRemoved, configurationUnchanged: report.configurationUnchanged, release: report.release }));
}
