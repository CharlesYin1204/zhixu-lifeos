import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { q, pool } from '../lib/db.mjs';
import { hashPassword, createSession } from '../lib/security.mjs';

// Production UI routing regression. Only temporary accounts and sessions are
// created. No real user, AI, payment, catalog, settings, or APK mutation.
const base = (process.env.TEST_BASE_URL || 'https://154.40.47.111:3063').replace(/\/$/, '');
const stamp = Date.now(), password = crypto.randomBytes(24).toString('base64url');
const fixtures = [
  { id: crypto.randomUUID(), role: 'user', name: '首页路由验收用户', email: `landing-user-${stamp}@example.test`, credits: 20 },
  { id: crypto.randomUUID(), role: 'admin', name: '首页隔离验收管理员', email: `landing-admin-${stamp}@example.test`, credits: 20 },
  { role: 'user', name: '首页注册验收用户', email: `landing-register-${stamp}@example.test`, credits: 30 },
];
const views = [['overview', '我的工作台'], ['ai', 'AI 助手'], ['media', '语音与拍照'], ['agents', 'Agent 工作室'], ['learning', '学习计划'], ['life', '生活管理'], ['knowledge', '知识库'], ['plugins', '插件市场'], ['membership', '会员中心']];
const report = { startedAt: new Date().toISOString(), base, results: [], errors: [], forbiddenActions: [], screenshots: [], links: [], verification: 'Real production browser and login/registration forms; temporary DB fixtures; no provider mocks, AI calls, payments, or configuration writes.' };
let browser, context, page, adminContext, beforeConfiguration;
const clean = value => String(value).split(password).join('[redacted]');
const fingerprint = async () => crypto.createHash('sha256').update(JSON.stringify({ settings: await q('SELECT data FROM settings ORDER BY id'), entities: await q('SELECT type,id,data,sort_order FROM entities ORDER BY type,id') })).digest('hex');
async function check(name, run) { const started = Date.now(); await run(); report.results.push({ name, passed: true, durationMs: Date.now() - started }); console.log('PASS', name); }
async function ready(current = page) { await expect(current.locator('.page-loading')).toHaveCount(0, { timeout: 20000 }); await expect(current.locator('main')).toBeVisible({ timeout: 20000 }); await expect(current.locator('#__next_error__')).toHaveCount(0); }
async function noPersonal(current = page) {
  for (const selector of ['.app-shell', '.sidebar', '.topbar', '.mobile-bottom', '.workspace-switch', '.sidebar-profile', '.profile-banner', '.user-features', '.feature-entry-grid', '.account-membership']) await expect(current.locator(selector)).toHaveCount(0);
  await expect(current.getByRole('textbox', { name: '搜索功能、笔记', exact: true })).toHaveCount(0);
}
async function noOverflow(label, current = page) {
  const size = await current.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert(size.scroll <= size.width + 1, `${label}: ${JSON.stringify(size)}`);
}
async function landing(current = page) { await ready(current); await expect(current.locator('.public-landing')).toBeVisible(); await noPersonal(current); await expect(current.locator('.admin-shell')).toHaveCount(0); await expect(current.locator('main h1')).toHaveCount(1); }
async function loginReady(current = page) { await expect(current).toHaveURL(/\/login(?:\?|$)/, { timeout: 20000 }); await ready(current); await expect(current.getByRole('button', { name: '登录用户中心', exact: true })).toBeVisible(); await noPersonal(current); }
async function userReady(current = page) { await expect(current).toHaveURL(base + '/user', { timeout: 20000 }); await ready(current); await expect(current.getByRole('heading', { name: '我的个人中心', exact: true })).toBeVisible(); await expect(current.locator('.feature-entry-group')).toHaveCount(4); await expect(current.locator('.feature-entry-grid button')).toHaveCount(22); await expect(current.locator('.public-landing,.admin-shell')).toHaveCount(0); }
async function screenshot(name, current = page) { const path = `docs/screenshots/${name}.png`; await current.screenshot({ path, fullPage: true }); report.screenshots.push(path); }
async function login() {
  await page.goto(base + '/login'); await loginReady();
  await page.locator('input[name=email]').fill(fixtures[0].email);
  await page.locator('input[name=password]').fill(password);
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/app') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'auth.login');
  await page.getByRole('button', { name: '登录用户中心', exact: true }).click();
  assert.equal((await responsePromise).status(), 200); await userReady();
}
async function identity(client, portal = 'app') { const response = await client.get(base + `/api/${portal}?resource=bootstrap`); assert.equal(response.status(), 200); return (await response.json()).user?.id || null; }
function monitor(current) { current.on('pageerror', error => report.errors.push({ url: current.url(), message: clean(error.message) })); }

try {
  beforeConfiguration = await fingerprint();
  report.release = (await fs.readFile('private/web-runtime.env', 'utf8')).match(/NEXT_DIST_DIR=['"]?([^\s'"]+)/)?.[1] || 'unknown';
  const hash = await hashPassword(password);
  for (const fixture of fixtures.slice(0, 2)) await q('INSERT INTO users (id,email,name,password_hash,role,credits) VALUES (?,?,?,?,?,?)', [fixture.id, fixture.email, fixture.name, hash, fixture.role, fixture.credits]);
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  report.browserVersion = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  await context.route('**/api/**', async route => {
    const req = route.request();
    if (req.method() === 'POST') { const action = req.postDataJSON()?.action; if (!['auth.login', 'auth.register', 'auth.logout'].includes(action)) { report.forbiddenActions.push(action || req.url()); return route.abort('blockedbyclient'); } }
    return route.continue();
  });
  page = await context.newPage(); monitor(page);

  await check('Anonymous root is a public introduction page with no personal workspace or user menus', async () => {
    await page.goto(base + '/'); await landing(); await noOverflow('public desktop');
    await expect(page.locator('.public-landing a[href="/login"]').first()).toBeVisible();
    await screenshot('public-landing-desktop');
    assert.equal(await identity(context.request), null);
  });

  await check('Public links have accessible names, concrete destinations, and existing section anchors', async () => {
    const links = await page.locator('.public-landing a').evaluateAll(nodes => nodes.map(node => ({ href: node.getAttribute('href') || '', label: (node.getAttribute('aria-label') || node.textContent || node.getAttribute('title') || '').trim() })));
    assert(links.length > 3);
    for (const link of links) {
      assert(link.label, `Unnamed public link: ${link.href}`);
      assert(link.href && link.href !== '#' && !/^javascript:/i.test(link.href), `Unusable public link: ${link.href}`);
      if (link.href.startsWith('#')) assert(await page.locator(`[id="${link.href.slice(1)}"]`).count(), `Missing public section ${link.href}`);
      else {
        const target = new URL(link.href, base);
        assert(['http:', 'https:', 'mailto:'].includes(target.protocol));
        if (target.origin === new URL(base).origin) {
          const response = await context.request.get(target.href, { maxRedirects: 0 });
          assert(response.status() < 400, `${target.pathname} returned HTTP ${response.status()}`);
          report.links.push({ path: target.pathname + target.search, status: response.status() });
        }
      }
    }
  });

  await check('Public introduction fits 390px and 360px without exposing personal bottom navigation', async () => {
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 }); await page.goto(base + '/'); await landing(); await noOverflow(`public ${width}px`);
      const menu = page.locator('summary[aria-label="打开官网导航"]');
      await menu.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('navigation', { name: '手机官网导航', exact: true })).toBeVisible();
      await noOverflow(`public menu ${width}px`); await menu.click();
      if (width === 390) await screenshot('public-landing-mobile');
    }
  });

  await check('Public login CTA opens an independent login screen at desktop and both mobile widths', async () => {
    await page.locator('.landing-hero-actions a[href="/login?mode=register"]').click(); await ready();
    await expect(page.getByRole('button', { name: '创建我的账户', exact: true })).toBeVisible();
    await expect(page.locator('input[name=name]')).toBeVisible(); await noPersonal();
    await page.goto(base + '/'); await landing();
    await page.locator('.public-landing a[href="/login"]').first().click(); await loginReady();
    for (const width of [1440, 390, 360]) { await page.setViewportSize({ width, height: 900 }); await noOverflow(`login ${width}px`); await noPersonal(); if (width === 390) await screenshot('public-login-mobile'); }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await check('Every anonymous canonical personal route requires login before showing workspace content', async () => {
    const paths = ['/user', ...views.map(([view]) => `/user?view=${view}`), '/user?view=media&kind=image', '/user?view=learning&kind=task'];
    for (const path of paths) { await page.goto(base + path); await loginReady(); }
  });

  await check('Legacy personal links redirect through the protected user route; the old admin link remains separate', async () => {
    for (const [view] of [...views, ['user']]) {
      const response = await context.request.get(base + `/?view=${view}`, { maxRedirects: 0 });
      assert([301, 302, 303, 307, 308].includes(response.status()), view);
      const next = new URL(response.headers().location, base); assert.equal(next.pathname, '/user');
      if (view !== 'user') assert.equal(next.searchParams.get('view'), view);
      await page.goto(base + `/?view=${view}`); await loginReady();
    }
    await page.goto(base + '/?view=admin'); await expect(page).toHaveURL(/\/admin\/login/, { timeout: 20000 });
    await expect(page.getByRole('button', { name: '登录管理后台', exact: true })).toBeVisible(); await noPersonal();
  });

  await check('Successful personal login lands at /user with all 22 feature entries', async () => {
    await login(); assert.equal(await identity(context.request), fixtures[0].id);
    await expect(page.locator('.sidebar')).toBeVisible(); await expect(page.locator('.topbar')).toBeVisible();
    await screenshot('public-authenticated-user');
  });

  await check('Authenticated root still shows the public introduction and its enter-user-center link works', async () => {
    await page.goto(base + '/'); await landing();
    await page.locator('.public-landing a[href="/user"]').first().click(); await userReady();
    await page.goto(base + '/login'); await userReady();
  });

  await check('Every personal navigation item stays below /user and renders its existing functional page', async () => {
    for (const [view, label] of views) {
      await page.locator('.sidebar').getByRole('button', { name: new RegExp(`^${label}(?:\\s|$)`) }).click();
      await ready(); const url = new URL(page.url()); assert.equal(url.pathname, '/user'); assert.equal(url.searchParams.get('view'), view);
      await expect(page.locator('main')).toHaveClass(new RegExp(`view-${view}(?:\\s|$)`));
      await expect(page.locator('main h1')).toBeVisible(); await expect(page.locator('.public-landing')).toHaveCount(0);
    }
    await page.goto(base + '/user?view=ai'); await ready(); await expect(page.locator('main')).toHaveClass(/view-ai/);
    await page.reload(); await ready(); await expect(page.locator('main')).toHaveClass(/view-ai/);
    await page.locator('.sidebar').getByRole('button', { name: '学习计划', exact: true }).click();
    await page.goBack(); await expect(page.locator('main')).toHaveClass(/view-ai/);
    await page.goForward(); await expect(page.locator('main')).toHaveClass(/view-learning/);
  });

  await check('Authenticated mobile center preserves all features and its five personal navigation items', async () => {
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 }); await page.goto(base + '/user'); await userReady();
      await expect(page.getByRole('navigation', { name: '移动端导航', exact: true })).toBeVisible();
      await expect(page.locator('.mobile-bottom button')).toHaveCount(5); await noOverflow(`user ${width}px`);
      for (const label of ['工作台', 'AI 助手', '学习', '生活', '我的']) { await page.locator('.mobile-bottom').getByRole('button', { name: label, exact: true }).click(); await ready(); assert.equal(new URL(page.url()).pathname, '/user'); }
      await userReady();
      if (width === 390) await screenshot('public-authenticated-user-mobile');
    }
  });

  await check('Logout from another tab clears the mounted personal workspace when it regains focus', async () => {
    const response = await context.request.post(base + '/api/app', { data: { action: 'auth.logout' } });
    assert.equal(response.status(), 200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await loginReady();
    await expect(page.locator('.profile-banner,.user-features,.sidebar,.mobile-bottom')).toHaveCount(0);
    assert.equal(await identity(context.request), null);
    await login();
  });

  await check('Personal logout removes access to user pages while leaving the public introduction available', async () => {
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect.poll(() => identity(context.request)).toBeNull();
    await page.goto(base + '/user?view=ai'); await loginReady();
    await page.goto(base + '/'); await landing();
  });

  await check('New registration also lands directly in the protected user center', async () => {
    await page.goto(base + '/login'); await loginReady();
    await page.getByRole('button', { name: '注册账户', exact: true }).click();
    await page.locator('input[name=name]').fill(fixtures[2].name);
    await page.locator('input[name=email]').fill(fixtures[2].email);
    await page.locator('input[name=password]').fill(password);
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/app') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'auth.register');
    await page.getByRole('button', { name: '创建我的账户', exact: true }).click(); assert.equal((await responsePromise).status(), 200);
    await userReady(); fixtures[2].id = (await q('SELECT id FROM users WHERE email=?', [fixtures[2].email]))[0]?.id; assert(fixtures[2].id);
    assert.equal(await identity(context.request), fixtures[2].id);
  });

  await check('An admin-only session still cannot open personal pages, and the independent backend remains intact', async () => {
    const token = await createSession(fixtures[1].id, 'admin');
    adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    await adminContext.addCookies([{ name: 'zhixu_admin_session', value: token, url: base, httpOnly: true, secure: true, sameSite: 'Lax' }]);
    const adminPage = await adminContext.newPage(); monitor(adminPage);
    await adminPage.goto(base + '/'); await landing(adminPage);
    await adminPage.goto(base + '/user'); await loginReady(adminPage);
    assert.equal(await identity(adminContext.request), null); assert.equal(await identity(adminContext.request, 'admin'), fixtures[1].id);
    await adminPage.goto(base + '/admin?section=models');
    await expect(adminPage.locator('.admin-shell')).toBeVisible(); await expect(adminPage.locator('.admin-table-panel')).toBeVisible({ timeout: 20000 });
    await expect(adminPage.getByRole('navigation', { name: '后台导航', exact: true }).locator('[data-section]')).toHaveCount(15);
    await expect(adminPage.locator('.public-landing')).toHaveCount(0); await noPersonal(adminPage);
  });

  await check('No browser exception, unexpected mutation, AI debit, or configuration change occurred', async () => {
    assert.deepEqual(report.errors, []); assert.deepEqual(report.forbiddenActions, []); assert.equal(await fingerprint(), beforeConfiguration);
    for (const fixture of fixtures) {
      const user = (await q('SELECT id,credits FROM users WHERE email=?', [fixture.email]))[0]; assert(user); assert.equal(Number(user.credits), fixture.credits);
      for (const table of ['records', 'runs', 'orders', 'conversations', 'usage_logs', 'media_assets']) assert.equal(Number((await q(`SELECT COUNT(*) count FROM ${table} WHERE user_id=?`, [user.id]))[0].count), 0);
    }
  });
  report.passed = true;
} catch (error) { report.passed = false; process.exitCode = 1; report.results.push({ passed: false, error: clean(error.stack) }); console.error(clean(error.message)); await page?.screenshot({ path: 'docs/screenshots/public-landing-failure.png', fullPage: true }).catch(() => {}); }
finally {
  await browser?.close();
  for (const fixture of fixtures) {
    const row = (await q('SELECT id FROM users WHERE email=?', [fixture.email]))[0];
    if (row) { for (const table of ['sessions', 'audit']) await q(`DELETE FROM ${table} WHERE user_id=?`, [row.id]); await q('DELETE FROM users WHERE id=?', [row.id]); await q('DELETE FROM rate_limits WHERE id IN (?,?)', [`user:${row.id}`, `admin:${row.id}`]); }
    await q('DELETE FROM rate_limits WHERE id IN (?,?)', [`auth:${fixture.email}`, `admin-auth:${fixture.email}`]);
  }
  report.fixturesRemoved = Number((await q('SELECT COUNT(*) count FROM users WHERE email IN (?,?,?)', fixtures.map(item => item.email)))[0].count) === 0;
  report.configurationUnchanged = beforeConfiguration === await fingerprint();
  report.completedAt = new Date().toISOString();
  await fs.writeFile('docs/tests/public-landing-results.json', JSON.stringify(report, null, 2));
  await pool.end(); console.log('RESULT', JSON.stringify({ passed: report.passed, checks: report.results.filter(item => item.passed).length, pageErrors: report.errors.length, fixturesRemoved: report.fixturesRemoved, configurationUnchanged: report.configurationUnchanged, release: report.release }));
}
