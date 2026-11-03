import { chromium, expect, request } from '@playwright/test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { q, pool } from '../lib/db.mjs';
import { hashPassword } from '../lib/security.mjs';

// Run only after the production build/deploy has finished. This suite changes
// its two temporary accounts only: no AI calls, catalog/configuration writes,
// real accounts, payments, orders, or Android builds.
const base = (process.env.TEST_BASE_URL || 'https://154.40.47.111:3063').replace(/\/$/, '');
const stamp = Date.now();
const password = crypto.randomBytes(24).toString('base64url');
const changedPassword = crypto.randomBytes(24).toString('base64url');
const fixtures = {
  user: { id: crypto.randomUUID(), email: `portal-user-${stamp}@example.test`, name: '个人中心验收用户', role: 'user' },
  admin: { id: crypto.randomUUID(), email: `portal-admin-${stamp}@example.test`, name: '后台独立验收管理员', role: 'admin' },
};
const sections = [
  ['overview', '概览'], ['users', '用户管理'], ['models', 'AI 模型'],
  ['media', '语音与图片'], ['agents', 'Agent 管理'], ['runs', '协作监控'],
  ['usage', 'AI 调用记录'], ['plugins', '插件管理'], ['plans', '会员方案'],
  ['orders', '订单管理'], ['payment', '支付设置'], ['apk', '安卓应用'],
  ['settings', '站点设置'], ['audit', '审计日志'], ['account', '账户安全'],
];
const report = {
  startedAt: new Date().toISOString(), base, results: [], errors: [],
  adminPagePersonalRequests: [], forbiddenActions: [], screenshots: [],
  secureCookieRequired: process.env.TEST_REQUIRE_SECURE_COOKIE !== '0',
  verification: 'Production Chromium browser, real forms/API/database sessions; isolated temporary users; no provider mocks or AI/payment calls.',
};
let browser, context, page, personalPage, beforeConfiguration;
const createdIds = [];
const clean = value => [password, changedPassword].reduce((text, secret) => text.split(secret).join('[redacted]'), String(value));
const configuration = async () => crypto.createHash('sha256').update(JSON.stringify({
  settings: await q('SELECT data FROM settings ORDER BY id'),
  entities: await q('SELECT type,id,data,sort_order FROM entities ORDER BY type,id'),
})).digest('hex');
const adminPath = section => `/admin${section && section !== 'overview' ? `?section=${section}` : ''}`;
const nav = currentPage => currentPage.getByRole('navigation', { name: '后台导航', exact: true, includeHidden: true });
const sectionLink = (currentPage, section) => nav(currentPage).locator(`[data-section="${section}"]`);
async function check(name, run) {
  const started = Date.now();
  await run();
  report.results.push({ name, passed: true, durationMs: Date.now() - started });
  console.log('PASS', name);
}
async function api(client, portal, payload, expected = 200) {
  const endpoint = `${base}/api/${portal}`;
  const response = typeof payload === 'string'
    ? await client.get(endpoint + payload)
    : await client.post(endpoint, { data: payload });
  const data = await response.json();
  assert.equal(response.status(), expected, `${portal} ${typeof payload === 'string' ? payload : payload.action}: ${clean(data.error || `unexpected HTTP ${response.status()}`)}`);
  return data;
}
function monitor(currentPage) {
  currentPage.on('pageerror', error => report.errors.push({ url: currentPage.url(), message: clean(error.message) }));
  currentPage.on('request', req => {
    const url = new URL(req.url());
    if (new URL(currentPage.url()).pathname.startsWith('/admin') && url.pathname === '/api/app') {
      report.adminPagePersonalRequests.push({ page: currentPage.url(), method: req.method(), resource: url.searchParams.get('resource') });
    }
  });
}
async function noPersonalShell(currentPage) {
  for (const selector of ['.app-shell', '.sidebar', '.topbar', '.mobile-bottom', '.sidebar-tip', '.workspace-switch', '.profile-banner', '.user-features', '.account-membership']) {
    await expect(currentPage.locator(selector)).toHaveCount(0);
  }
  await expect(currentPage.getByRole('textbox', { name: '搜索功能、笔记', exact: true })).toHaveCount(0);
  for (const name of ['升级会员', '探索知序会员', '我的工作台', '我的个人中心']) {
    await expect(currentPage.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(currentPage.locator('#__next_error__')).toHaveCount(0);
}
async function noOverflow(currentPage, label) {
  const dimensions = await currentPage.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(dimensions.document <= dimensions.viewport + 1, `${label}: ${JSON.stringify(dimensions)}`);
}
async function adminReady(currentPage, section = 'overview') {
  await expect(currentPage).toHaveURL(new RegExp(`/admin(?:\\?|$)`), { timeout: 20000 });
  await expect(currentPage.locator('.admin-shell')).toBeVisible({ timeout: 20000 });
  await expect(currentPage.locator('.page-loading')).toHaveCount(0, { timeout: 20000 });
  await expect(currentPage.locator('main')).toBeVisible();
  await expect(sectionLink(currentPage, section)).toHaveAttribute('aria-current', 'page');
  const contentSelectors = {
    overview: '.admin-stats', users: '.admin-table-panel', models: '.admin-table-panel',
    agents: '.admin-table-panel', plugins: '.admin-table-panel', plans: '.admin-table-panel',
    media: 'select[name=visionModelId]', payment: 'input[name=epayUrl]',
    apk: 'input[name=packageId]', settings: 'input[name=siteName]',
    account: 'input[name=currentPassword]', orders: 'main table', runs: 'main table',
    usage: 'main table', audit: 'main table',
  };
  await expect(currentPage.locator(contentSelectors[section])).toBeVisible();
  await expect(currentPage.locator('.error-banner')).toHaveCount(0);
  assert.equal(new URL(currentPage.url()).searchParams.get('section') || 'overview', section);
  await noPersonalShell(currentPage);
}
async function loginPersonal(currentPage, fixture, secret = password) {
  await currentPage.goto(base + '/login');
  await expect(currentPage.locator('input[name=email]')).toBeVisible({ timeout: 20000 });
  await currentPage.locator('input[name=email]').fill(fixture.email);
  await currentPage.locator('input[name=password]').fill(secret);
  const responsePromise = currentPage.waitForResponse(response => response.url().endsWith('/api/app') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'auth.login');
  await currentPage.getByRole('button', { name: '登录用户中心', exact: true }).click();
  assert.equal((await responsePromise).status(), 200);
  await expect.poll(async () => (await api(context.request, 'app', '?resource=bootstrap')).user?.id).toBe(fixture.id);
  await expect(currentPage.locator('input[name=password]')).toHaveCount(0, { timeout: 20000 });
}
async function loginAdmin(currentPage, fixture = fixtures.admin, { secret = password, status = 200, section = 'overview', navigate = true } = {}) {
  if (navigate) await currentPage.goto(base + `/admin/login?next=${encodeURIComponent(adminPath(section))}`);
  await expect(currentPage.locator('input[name=email]')).toBeVisible({ timeout: 20000 });
  await noPersonalShell(currentPage);
  await currentPage.locator('input[name=email]').fill(fixture.email);
  await currentPage.locator('input[name=password]').fill(secret);
  const responsePromise = currentPage.waitForResponse(response => response.url().endsWith('/api/admin') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'auth.login');
  await currentPage.getByRole('button', { name: '登录管理后台', exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), status, `Administrator login returned HTTP ${response.status()}`);
  if (status === 200) await adminReady(currentPage, section);
  else {
    await expect(currentPage).toHaveURL(/\/admin\/login/);
    await expect(currentPage.locator('.form-error')).toBeVisible();
  }
}
async function screenshot(currentPage, filename) {
  const path = `docs/screenshots/${filename}`;
  await currentPage.screenshot({ path, fullPage: true });
  report.screenshots.push(path);
}
async function openSection(currentPage, section) {
  let link = sectionLink(currentPage, section);
  if (!await link.isVisible()) {
    await currentPage.getByRole('button', { name: '打开全部后台功能', exact: true }).click();
    link = currentPage.getByRole('dialog', { name: '全部后台功能', exact: true }).locator(`[data-section="${section}"]`);
  }
  await link.click();
  await adminReady(currentPage, section);
}

try {
  beforeConfiguration = await configuration();
  const passwordHash = await hashPassword(password);
  for (const fixture of Object.values(fixtures)) {
    await q('INSERT INTO users (id,email,name,password_hash,role,credits) VALUES (?,?,?,?,?,20)', [fixture.id, fixture.email, fixture.name, passwordHash, fixture.role]);
    createdIds.push(fixture.id);
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  report.browserVersion = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  await context.route('**/api/**', async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      const payload = req.postDataJSON();
      if (!['auth.login', 'auth.logout', 'profile.update'].includes(payload?.action)) {
        report.forbiddenActions.push(payload?.action || req.url());
        return route.abort('blockedbyclient');
      }
    }
    return route.continue();
  });
  page = await context.newPage();
  personalPage = await context.newPage();
  monitor(page); monitor(personalPage);

  await check('Anonymous admin deep link opens its independent login without any personal navigation', async () => {
    await page.goto(base + '/admin?section=models');
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 20000 });
    await expect(page.getByRole('button', { name: '登录管理后台', exact: true })).toBeVisible();
    await noPersonalShell(page);
    await noOverflow(page, 'admin login desktop');
    await screenshot(page, 'portal-admin-login.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, 'admin login mobile');
    await noPersonalShell(page);
    await screenshot(page, 'portal-admin-login-mobile.png');
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal((await api(context.request, 'admin', '?resource=bootstrap')).user, null);
    await api(context.request, 'admin', '?resource=admin', 401);
  });

  await check('Personal login and canonical user center preserve every existing feature group', async () => {
    await loginPersonal(personalPage, fixtures.user);
    await personalPage.goto(base + '/user');
    await expect(personalPage.getByRole('heading', { name: '我的个人中心', exact: true })).toBeVisible();
    await expect(personalPage.locator('.sidebar')).toBeVisible();
    await expect(personalPage.locator('.admin-shell')).toHaveCount(0);
    await expect(personalPage.locator('.feature-entry-group')).toHaveCount(4);
    await expect(personalPage.locator('.feature-entry-grid button')).toHaveCount(22);
    for (const label of ['实时语音对话', '拍照与图片助手', '录音与转写', '安卓客户端下载', '导出我的数据', '学习任务', '健康记录', 'Agent 工作室', '插件市场']) {
      await expect(personalPage.locator('.user-features').getByRole('button', { name: label })).toBeVisible();
    }
    await screenshot(personalPage, 'portal-user-center.png');
  });

  await check('An ordinary personal login cannot enter the admin portal or authenticate as an administrator', async () => {
    await page.goto(base + '/admin?section=users');
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 20000 });
    await loginAdmin(page, fixtures.user, { status: 403, navigate: false });
    assert.equal((await api(context.request, 'app', '?resource=bootstrap')).user.id, fixtures.user.id);
    assert.equal((await api(context.request, 'admin', '?resource=bootstrap')).user, null);
    assert(!(await context.cookies()).some(cookie => cookie.name === 'zhixu_admin_session'));
  });

  await check('Independent administrator login preserves the requested section and the existing personal account', async () => {
    await loginAdmin(page, fixtures.admin, { section: 'models' });
    assert.equal((await api(context.request, 'admin', '?resource=bootstrap')).user.id, fixtures.admin.id);
    assert.equal((await api(context.request, 'app', '?resource=bootstrap')).user.id, fixtures.user.id);
    const cookies = await context.cookies();
    const personal = cookies.find(cookie => cookie.name === 'zhixu_session');
    const administrative = cookies.find(cookie => cookie.name === 'zhixu_admin_session');
    assert(personal && administrative && personal.value !== administrative.value);
    report.adminCookieFlags = { httpOnly: administrative.httpOnly, secure: administrative.secure, sameSite: administrative.sameSite };
    assert(administrative.httpOnly && administrative.sameSite === 'Lax');
    if (process.env.TEST_REQUIRE_SECURE_COOKIE !== '0') assert(administrative.secure, 'HTTPS administrator cookie must be Secure');
    const scopes = await q('SELECT user_id,scope FROM sessions WHERE user_id IN (?,?)', [fixtures.user.id, fixtures.admin.id]);
    assert(scopes.some(row => row.user_id === fixtures.user.id && row.scope === 'user'));
    assert(scopes.some(row => row.user_id === fixtures.admin.id && row.scope === 'admin'));
  });

  await check('Administrative API and personal API reject crossed resources, actions, and swapped cookie tokens', async () => {
    await api(context.request, 'app', '?resource=admin', 403);
    await api(context.request, 'app', { action: 'admin.save', entity: 'user', data: { id: fixtures.admin.id, name: fixtures.admin.name } }, 403);
    await api(context.request, 'admin', '?resource=export', 404);
    await api(context.request, 'admin', { action: 'record.save', kind: 'note', title: 'Must not be created' }, 404);
    const cookies = await context.cookies();
    const personal = cookies.find(cookie => cookie.name === 'zhixu_session');
    const administrative = cookies.find(cookie => cookie.name === 'zhixu_admin_session');
    const swapped = await request.newContext({ extraHTTPHeaders: { Cookie: `zhixu_admin_session=${personal.value}; zhixu_session=${administrative.value}` } });
    try {
      await api(swapped, 'admin', '?resource=admin', 401);
      assert.equal((await api(swapped, 'app', '?resource=bootstrap')).user, null);
    } finally { await swapped.dispose(); }
  });

  await check('An administrator-only cookie does not sign in to the personal center or expose personal data', async () => {
    const isolated = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await isolated.addCookies((await context.cookies()).filter(cookie => cookie.name === 'zhixu_admin_session'));
      const isolatedPage = await isolated.newPage(); monitor(isolatedPage);
      assert.equal((await api(isolated.request, 'app', '?resource=bootstrap')).user, null);
      await api(isolated.request, 'app', '?resource=export', 401);
      assert.equal((await api(isolated.request, 'admin', '?resource=bootstrap')).user.id, fixtures.admin.id);
      await isolatedPage.goto(base + '/user');
      await expect(isolatedPage).toHaveURL(/\/login(?:\?|$)/, { timeout: 20000 });
      await expect(isolatedPage.getByRole('button', { name: '登录用户中心', exact: true })).toBeVisible();
      await expect(isolatedPage.locator('.profile-banner,.sidebar,.mobile-bottom')).toHaveCount(0);
    } finally { await isolated.close(); }
  });

  await check('Every administrative section opens from its desktop navigation without personal shell leakage', async () => {
    for (const [section] of sections) {
      await openSection(page, section);
      await noOverflow(page, `desktop ${section}`);
    }
    await openSection(page, 'overview');
    await screenshot(page, 'portal-admin-desktop.png');
  });

  await check('Administrative deep link, refresh, back and forward keep section selection synchronized', async () => {
    await page.goto(base + '/admin?section=models'); await adminReady(page, 'models');
    await page.reload(); await adminReady(page, 'models');
    await openSection(page, 'users'); await openSection(page, 'media');
    await page.goBack(); await adminReady(page, 'users');
    await page.goBack(); await adminReady(page, 'models');
    await page.goForward(); await adminReady(page, 'users');
    await page.goForward(); await adminReady(page, 'media');
  });

  for (const width of [390, 360]) await check(`All fifteen administrative sections fit ${width}px and use only administrative mobile navigation`, async () => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    for (const [section] of sections) {
      await openSection(page, section);
      await expect(page.getByRole('navigation', { name: '后台移动导航', exact: true })).toBeVisible();
      await noOverflow(page, `${width}px ${section}`);
    }
    await openSection(page, 'overview');
    if (width === 390) await screenshot(page, 'portal-admin-mobile.png');
  });

  await check('The personal center retains its personal bottom menu and all features at 390px and 360px', async () => {
    for (const width of [390, 360]) {
      await personalPage.setViewportSize({ width, height: 844 });
      await personalPage.goto(base + '/user');
      await expect(personalPage.getByRole('heading', { name: '我的个人中心', exact: true })).toBeVisible();
      await expect(personalPage.getByRole('navigation', { name: '移动端导航', exact: true })).toBeVisible();
      await expect(personalPage.locator('.feature-entry-grid button')).toHaveCount(22);
      await expect(personalPage.locator('.admin-shell')).toHaveCount(0);
      await noOverflow(personalPage, `${width}px personal center`);
      if (width === 390) await screenshot(personalPage, 'portal-user-mobile.png');
    }
  });

  await check('Old admin, personal-center, and login URLs resolve to their independent canonical routes', async () => {
    await page.goto(base + '/?view=admin'); await adminReady(page);
    await personalPage.goto(base + '/?view=user');
    await expect(personalPage).toHaveURL(base + '/user');
    await expect(personalPage.getByRole('heading', { name: '我的个人中心', exact: true })).toBeVisible();
    const response = await context.request.get(base + '/?view=login', { maxRedirects: 0 });
    assert([301, 302, 303, 307, 308].includes(response.status()));
    assert.equal(new URL(response.headers().location, base).pathname, '/login');
  });

  await check('Logging out of the backend leaves the personal session signed in', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: '退出后台', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 20000 });
    assert.equal((await api(context.request, 'admin', '?resource=bootstrap')).user, null);
    assert.equal((await api(context.request, 'app', '?resource=bootstrap')).user.id, fixtures.user.id);
    await page.goBack();
    if (new URL(page.url()).pathname.startsWith('/admin')) {
      await expect(page).toHaveURL(/\/admin\/login/, { timeout: 20000 });
      await expect(page.getByRole('button', { name: '登录管理后台', exact: true })).toBeVisible();
    }
    await page.goto(base + '/admin?section=users');
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 20000 });
    await noPersonalShell(page);
  });

  await check('Logging out of the personal center leaves the backend session signed in', async () => {
    await loginAdmin(page);
    await personalPage.goto(base + '/user');
    await expect(personalPage.getByRole('heading', { name: '我的个人中心', exact: true })).toBeVisible();
    await personalPage.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect.poll(async () => (await api(context.request, 'app', '?resource=bootstrap')).user).toBeNull();
    assert.equal((await api(context.request, 'admin', '?resource=bootstrap')).user.id, fixtures.admin.id);
    await page.reload(); await adminReady(page);
  });

  await check('The same administrator identity can sign in separately to both portals and log out independently', async () => {
    await loginPersonal(personalPage, fixtures.admin);
    assert.equal((await api(context.request, 'app', '?resource=bootstrap')).user.id, fixtures.admin.id);
    assert.equal((await api(context.request, 'admin', '?resource=bootstrap')).user.id, fixtures.admin.id);
    await page.getByRole('button', { name: '退出后台', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 20000 });
    assert.equal((await api(context.request, 'app', '?resource=bootstrap')).user.id, fixtures.admin.id);
    await api(context.request, 'app', '?resource=admin', 403);
    await loginAdmin(page, fixtures.admin, { section: 'account' });
  });

  await check('Administrator account security updates its temporary password inside the backend and revokes the old personal session', async () => {
    await page.locator('input[name=currentPassword]').fill(password);
    await page.locator('input[name=password]').fill(changedPassword);
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/admin') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'profile.update');
    await page.getByRole('button', { name: '保存后台账户', exact: true }).click();
    assert.equal((await responsePromise).status(), 200);
    await adminReady(page, 'account');
    assert.equal((await api(context.request, 'admin', '?resource=bootstrap')).user.id, fixtures.admin.id);
    assert.equal((await api(context.request, 'app', '?resource=bootstrap')).user, null);
    await page.getByRole('button', { name: '退出后台', exact: true }).click();
    await loginAdmin(page, fixtures.admin, { secret: password, status: 401 });
    await loginAdmin(page, fixtures.admin, { secret: changedPassword, section: 'account' });
  });

  await check('No browser exception, personal data request from admin pages, AI charge, or production configuration mutation occurred', async () => {
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.adminPagePersonalRequests, []);
    assert.deepEqual(report.forbiddenActions, []);
    assert.equal(await configuration(), beforeConfiguration);
    for (const fixture of Object.values(fixtures)) {
      assert.equal(Number((await q('SELECT credits FROM users WHERE id=?', [fixture.id]))[0].credits), 20);
      for (const table of ['orders', 'runs', 'records', 'conversations', 'usage_logs', 'media_assets']) assert.equal(Number((await q(`SELECT COUNT(*) count FROM ${table} WHERE user_id=?`, [fixture.id]))[0].count), 0);
    }
  });
  report.passed = true;
} catch (error) {
  report.passed = false;
  process.exitCode = 1;
  report.results.push({ passed: false, error: clean(error.stack) });
  console.error(clean(error.message));
  await page?.screenshot({ path: 'docs/screenshots/portal-separation-failure.png', fullPage: true }).catch(() => {});
} finally {
  await browser?.close();
  for (const fixtureId of createdIds) {
    for (const table of ['sessions', 'audit', 'records', 'conversations', 'usage_logs']) await q(`DELETE FROM ${table} WHERE user_id=?`, [fixtureId]);
    await q('DELETE FROM users WHERE id=?', [fixtureId]);
  }
  for (const fixture of Object.values(fixtures)) await q('DELETE FROM rate_limits WHERE id IN (?,?,?,?)', [`auth:${fixture.email}`, `admin-auth:${fixture.email}`, `user:${fixture.id}`, `admin:${fixture.id}`]);
  report.fixturesRemoved = Number((await q('SELECT COUNT(*) count FROM users WHERE id IN (?,?)', [fixtures.user.id, fixtures.admin.id]))[0].count) === 0;
  report.configurationUnchanged = beforeConfiguration === await configuration();
  report.completedAt = new Date().toISOString();
  await fs.writeFile('docs/tests/portal-separation-results.json', JSON.stringify(report, null, 2));
  await pool.end();
  console.log('RESULT', JSON.stringify({ passed: report.passed, checks: report.results.filter(item => item.passed).length, pageErrors: report.errors.length, fixturesRemoved: report.fixturesRemoved, configurationUnchanged: report.configurationUnchanged }));
}
