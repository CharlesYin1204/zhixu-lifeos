import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { q, pool, entity } from '../lib/db.mjs';

// Only temporary accounts and catalog entries are changed. No real AI or payment call.
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3060';
const stamp = Date.now();
const prefix = `后台验收 ${stamp}`;
const password = crypto.randomBytes(24).toString('base64url');
const fakeKey = `fixture-no-network-${crypto.randomBytes(24).toString('hex')}`;
const actorEmail = `admin-contract-actor-${stamp}@example.test`;
const subjectEmail = `admin-contract-subject-${stamp}@example.test`;
const fixtureUsers = [], fixtureEntities = [], results = [], errors = [], forbiddenActions = [];
let subjectId, actorId, modelId, agentId, planId, pluginId;
const originalSettings = (await q('SELECT data FROM settings WHERE id=1'))[0].data;
const originalEntities = await q('SELECT type,id,data,sort_order FROM entities ORDER BY type,id');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const options = { viewport: { width: 1440, height: 1100 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' };
const adminContext = await browser.newContext(options), subjectContext = await browser.newContext(options);
const adminPage = await adminContext.newPage(), subjectPage = await subjectContext.newPage();
for (const page of [adminPage, subjectPage]) {
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => {
    if (!/\/api\/(app|admin)$/.test(request.url()) || request.method() !== 'POST') return;
    const action = request.postDataJSON()?.action;
    if (/^ai\./.test(action) || ['plugin.run', 'admin.model.test', 'order.create', 'admin.order.approve'].includes(action)) forbiddenActions.push(action);
  });
}
function clean(text) {
  let value = String(text);
  for (const secret of [password, fakeKey, process.env.ADMIN_PASSWORD, process.env.AI_API_KEY].filter(Boolean)) value = value.split(secret).join('[redacted]');
  return value;
}
async function api(context, payload, expected = 200) {
  const endpoint = (typeof payload === 'string' ? payload === '?resource=admin' : payload.action?.startsWith('admin.')) ? '/api/admin' : '/api/app';
  const response = typeof payload === 'string' ? await context.request.get(base + endpoint + payload) : await context.request.post(base + endpoint, { data: payload });
  assert.equal(response.status(), expected, clean(await response.text()));
  return response.json();
}
async function test(name, requirements, run, verification = 'real-browser-ui-with-persistence-assertions') {
  const start = Date.now();
  await run();
  results.push({ name, requirements, verification, passed: true, durationMs: Date.now() - start });
  console.log('PASS', name);
}
async function goto(page, view) {
  await page.goto(`${base}/?view=${view}`);
  await expect(page.locator('.page-loading')).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator('main')).toBeVisible();
}
async function loginUI(page, email, admin = false) {
  if (admin) await page.goto(base + '/admin/login'); else await goto(page, 'login');
  await page.locator('input[name=email]').fill(email);
  await page.locator('input[name=password]').fill(password);
  await page.getByRole('button', { name: admin ? '登录管理后台' : '登录用户中心', exact: true }).click();
  await expect(page).toHaveURL(base + (admin ? '/admin' : '/user'), { timeout: 20000 });
  await expect(page.locator('main h1')).toBeVisible({ timeout: 20000 });
}
async function tab(name) {
  await adminPage.getByRole('navigation', { name: '后台导航', exact: true }).getByRole('link', { name, exact: true }).click();
  await expect(adminPage.locator('.page-loading')).toHaveCount(0);
}
const row = name => adminPage.locator('tbody tr').filter({ hasText: name });
const dialog = () => adminPage.getByRole('dialog');
async function submit(expected = 200) {
  const responsePromise = adminPage.waitForResponse(r => r.url().endsWith('/api/admin') && r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'admin.save');
  responsePromise.catch(() => {});
  await dialog().getByRole('button', { name: '保存配置', exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), expected, clean(await response.text()));
  const data = await response.json();
  if (expected === 200) await expect(dialog()).toHaveCount(0);
  return data;
}
async function toggle(name, label) {
  const responsePromise = adminPage.waitForResponse(r => r.url().endsWith('/api/admin') && r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'admin.save');
  responsePromise.catch(() => {});
  await row(name).getByRole('button', { name: label, exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, clean(await response.text()));
  const next = { 停用: '启用', 启用: '停用', 上架: '下架', 下架: '上架' }[label];
  await expect(row(name).getByRole('button', { name: next, exact: true })).toBeVisible();
}
try {
  actorId = (await api(adminContext, { action: 'auth.register', name: '后台隔离管理员', email: actorEmail, password })).user.id;
  fixtureUsers.push(actorId);
  await q("UPDATE users SET role='admin' WHERE id=?", [actorId]);
  subjectId = (await api(subjectContext, { action: 'auth.register', name: '后台隔离用户', email: subjectEmail, password })).user.id;
  fixtureUsers.push(subjectId);
  await api(adminContext, { action: 'auth.logout' });
  await loginUI(adminPage, actorEmail, true);
  await goto(adminPage, 'admin');
  await expect(adminPage.getByRole('navigation', { name: '后台导航', exact: true })).toBeVisible();

  await test('Ordinary account sees the administrative access denial and cannot read administrator API', ['F-084'], async () => {
    await goto(subjectPage, 'admin');
    await expect(subjectPage.getByRole('button', { name: '登录管理后台', exact: true })).toBeVisible();
    await api(subjectContext, '?resource=admin', 401);
  });
  await test('Administrator overview counters match persisted users, orders, paid revenue and workflow count', ['F-085'], async () => {
    const data = await api(adminContext, '?resource=admin');
    const counts = (await q("SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM orders) orders,(SELECT COALESCE(SUM(amount),0)/100 FROM orders WHERE status='paid') revenue,(SELECT COUNT(*) FROM runs) runs"))[0];
    for (const [label, key, apiKey] of [['注册用户', 'users', 'users'], ['全部订单', 'orders', 'orders'], ['协作任务', 'runs', 'aiRuns'], ['累计收入', 'revenue', 'revenue']]) {
      assert.equal(Number(data.stats[apiKey]), Number(counts[key]));
      const card = adminPage.locator('.admin-stats section').filter({ has: adminPage.getByText(label, { exact: true }) });
      const displayed = (await card.locator('strong').innerText()).replace(/[¥,\s]/g, '');
      assert.equal(Number(displayed), Number(counts[key]));
    }
  }, 'read-only-browser-ui-and-database-reconciliation');
  const modelName = `${prefix}模型`, agentName = `${prefix}助手`, planName = `${prefix}套餐`, pluginName = `${prefix}插件`;

  await test('New model form rejects a missing key before creating a catalog entry', ['F-102', 'F-103'], async () => {
    await tab('AI 模型');
    await adminPage.getByRole('button', { name: '新增AI 模型', exact: true }).click();
    await dialog().locator('[name=name]').fill(modelName);
    await dialog().locator('[name=baseUrl]').fill('https://example.com/v1');
    await dialog().locator('[name=model]').fill('fixture-never-called');
    await dialog().locator('[name=enabled]').uncheck();
    await submit(400);
    await expect(dialog().locator('.form-error')).toContainText('请配置 API Key');
    assert.equal((await q("SELECT id FROM entities WHERE type='model' AND JSON_EXTRACT(data,'$.name')=?", [modelName])).length, 0);
  });
  await test('Model creation stores a test-only key encrypted and reopening never discloses it', ['F-102', 'F-103'], async () => {
    await dialog().locator('[name=apiKey]').fill(fakeKey);
    modelId = (await submit()).id;
    fixtureEntities.push(['model', modelId]);
    const saved = await entity('model', modelId);
    assert.equal(saved.enabled, false);
    assert.equal(saved.isDefault, false);
    assert(saved.apiKey.startsWith('enc:'));
    assert(!saved.apiKey.includes(fakeKey));
    const info = (await api(adminContext, '?resource=admin')).models.find(item => item.id === modelId);
    assert.equal(info.hasKey, true);
    assert(!Object.hasOwn(info, 'apiKey'));
    await row(modelName).getByRole('button', { name: '编辑', exact: true }).click();
    await expect(dialog().locator('[name=apiKey]')).toHaveValue('');
    await expect(dialog()).toContainText('已配置密钥；留空保持不变');
    await dialog().locator('[name=model]').fill('fixture-edited-never-called');
    await submit();
    const edited = await entity('model', modelId);
    assert.equal(edited.apiKey, saved.apiKey);
    assert.equal(edited.model, 'fixture-edited-never-called');
  });
  await test('Temporary model can be enabled and disabled without changing the production default', ['F-104'], async () => {
    const before = (await api(adminContext, '?resource=admin')).models.filter(m => m.isDefault).map(m => m.id);
    await toggle(modelName, '启用');
    assert.equal((await entity('model', modelId)).enabled, true);
    await toggle(modelName, '停用');
    assert.equal((await entity('model', modelId)).enabled, false);
    assert.deepEqual((await api(adminContext, '?resource=admin')).models.filter(m => m.isDefault).map(m => m.id), before);
  });
  await test('Agent form persists role, prompt, default-model binding, icon and color across edit and reload', [], async () => {
    await tab('Agent 管理');
    await adminPage.getByRole('button', { name: '新增Agent', exact: true }).click();
    await dialog().locator('[name=name]').fill(agentName);
    await dialog().locator('[name=role]').fill('隔离验收规划助手');
    await dialog().locator('[name=description]').fill('测试完清理；不执行 AI 调用');
    await dialog().locator('[name=systemPrompt]').fill('仅用于配置持久化验收，不执行模型请求。');
    await dialog().locator('[name=icon]').selectOption('book');
    await dialog().locator('[name=color]').selectOption('purple');
    agentId = (await submit()).id;
    fixtureEntities.push(['agent', agentId]);
    let saved = await entity('agent', agentId);
    assert.equal(saved.modelId, '');
    assert.equal(saved.role, '隔离验收规划助手');
    assert.equal(saved.icon, 'book');
    assert.equal(saved.color, 'purple');
    const enabledModel = (await api(adminContext, '?resource=admin')).models.find(m => m.enabled && m.isDefault);
    assert(enabledModel);
    await row(agentName).getByRole('button', { name: '编辑', exact: true }).click();
    await dialog().locator('[name=modelId]').selectOption(enabledModel.id);
    await dialog().locator('[name=systemPrompt]').fill('修改后的隔离验收提示词，不执行模型请求。');
    await submit();
    await adminPage.reload();
    await expect(adminPage.getByRole('navigation', { name: '后台导航', exact: true })).toBeVisible();
    await tab('Agent 管理');
    await row(agentName).getByRole('button', { name: '编辑', exact: true }).click();
    await expect(dialog().locator('[name=modelId]')).toHaveValue(enabledModel.id);
    await expect(dialog().locator('[name=systemPrompt]')).toHaveValue('修改后的隔离验收提示词，不执行模型请求。');
    await dialog().getByRole('button', { name: '取消', exact: true }).click();
  });
  await test('Stopping a temporary Agent removes it from user assistant choices; enabling restores it', [], async () => {
    await goto(subjectPage, 'ai');
    await expect(subjectPage.locator('.chat-agent').filter({ hasText: agentName })).toBeVisible();
    await toggle(agentName, '停用');
    await subjectPage.reload();
    await expect(subjectPage.locator('.chat-welcome')).toBeVisible();
    await expect(subjectPage.locator('.chat-agent').filter({ hasText: agentName })).toHaveCount(0);
    await toggle(agentName, '启用');
    await subjectPage.reload();
    await expect(subjectPage.locator('.chat-agent').filter({ hasText: agentName })).toBeVisible();
    await toggle(agentName, '停用');
  });
  await test('Member plan creation and editing persist price, duration, credits and separate benefit lines', ['F-089', 'F-090'], async () => {
    await tab('会员方案');
    await adminPage.getByRole('button', { name: '新增会员', exact: true }).click();
    await dialog().locator('[name=name]').fill(planName);
    await dialog().locator('[name=price]').fill('23.47');
    await dialog().locator('[name=days]').fill('11');
    await dialog().locator('[name=credits]').fill('37');
    await dialog().locator('[name=features]').fill('隔离验收权益一\n隔离验收权益二');
    planId = (await submit()).id;
    fixtureEntities.push(['plan', planId]);
    await row(planName).getByRole('button', { name: '编辑', exact: true }).click();
    await dialog().locator('[name=price]').fill('27.39');
    await dialog().locator('[name=days]').fill('12');
    await dialog().locator('[name=credits]').fill('41');
    await submit();
    const plan = await entity('plan', planId);
    assert.equal(plan.price, 27.39);
    assert.equal(plan.days, 12);
    assert.equal(plan.credits, 41);
    assert.deepEqual(plan.features, ['隔离验收权益一', '隔离验收权益二']);
    await expect(row(planName)).toContainText('27.39');
    await expect(row(planName)).toContainText('12 天');
  });
  await test('Stopping a temporary plan removes its user-facing purchase card and enabling restores it', ['F-091'], async () => {
    await goto(subjectPage, 'membership');
    await expect(subjectPage.getByRole('heading', { name: planName, exact: true })).toBeVisible();
    await toggle(planName, '停用');
    await subjectPage.reload();
    await expect(subjectPage.locator('main h1')).toBeVisible();
    await expect(subjectPage.getByRole('heading', { name: planName, exact: true })).toHaveCount(0);
    await toggle(planName, '启用');
    await subjectPage.reload();
    await expect(subjectPage.getByRole('heading', { name: planName, exact: true })).toBeVisible();
  });
  await test('User search and profile edit apply name, custom membership expiry and an exact AI balance', ['F-086', 'F-088'], async () => {
    await tab('用户管理');
    await adminPage.getByRole('textbox', { name: '搜索管理记录', exact: true }).fill(subjectEmail);
    await expect(adminPage.locator('tbody tr')).toHaveCount(1);
    await row(subjectEmail).getByRole('button', { name: '编辑', exact: true }).click();
    await dialog().locator('[name=name]').fill('后台资料已编辑');
    await dialog().locator('[name=planId]').selectOption(planId);
    const expiry = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await dialog().locator('[name=planExpires]').fill(expiry);
    await dialog().locator('[name=credits]').fill('123');
    await submit();
    const account = (await api(subjectContext, '?resource=bootstrap')).user;
    assert.equal(account.name, '后台资料已编辑');
    assert.equal(account.planId, planId);
    assert.equal(account.credits, 123);
    assert(account.planExpires.startsWith(expiry));
    await goto(subjectPage, 'user');
    await expect(subjectPage.locator('.profile-banner h2')).toContainText('后台资料已编辑');
    await expect(subjectPage.locator('.account-membership')).toContainText(planName);
    await expect(subjectPage.locator('.profile-credits strong')).toHaveText('123');
  });
  await test('Promoted account signs into the independent admin portal; demotion revokes its admin access', ['F-088'], async () => {
    await row(subjectEmail).getByRole('button', { name: '编辑', exact: true }).click();
    await dialog().locator('[name=role]').selectOption('admin');
    await submit();
    await loginUI(subjectPage, subjectEmail, true);
    await expect(subjectPage.getByRole('navigation', { name: '后台导航', exact: true })).toBeVisible();
    await row(subjectEmail).getByRole('button', { name: '编辑', exact: true }).click();
    await dialog().locator('[name=role]').selectOption('user');
    await submit();
    await subjectPage.reload();
    await expect(subjectPage.getByRole('button', { name: '登录管理后台', exact: true })).toBeVisible();
    await api(subjectContext, '?resource=admin', 403);
  });
  await test('Disabling a temporary account revokes its session and prevents login; reactivation permits a new login', ['F-087'], async () => {
    await row(subjectEmail).getByRole('button', { name: '编辑', exact: true }).click();
    await dialog().locator('[name=status]').selectOption('disabled');
    await submit();
    await expect(row(subjectEmail)).toContainText('账户已停用');
    assert.equal((await api(subjectContext, '?resource=bootstrap')).user, null);
    assert.equal((await q('SELECT token_hash FROM sessions WHERE user_id=?', [subjectId])).length, 0);
    await goto(subjectPage, 'login');
    await subjectPage.locator('input[name=email]').fill(subjectEmail);
    await subjectPage.locator('input[name=password]').fill(password);
    await subjectPage.getByRole('button', { name: '登录用户中心', exact: true }).click();
    await expect(subjectPage.locator('.form-error')).toContainText('账户已被停用');
    await row(subjectEmail).getByRole('button', { name: '编辑', exact: true }).click();
    await dialog().locator('[name=status]').selectOption('active');
    await submit();
    await loginUI(subjectPage, subjectEmail);
    assert.equal((await api(subjectContext, '?resource=bootstrap')).user?.id, subjectId);
    await tab('会员方案');
    await toggle(planName, '停用');
  });
  await test('Plugin publish and unpublish actions control the actual user catalog', ['F-095'], async () => {
    await tab('插件管理');
    await adminPage.getByRole('button', { name: '新增插件', exact: true }).click();
    await dialog().locator('[name=name]').fill(pluginName);
    await dialog().locator('[name=category]').fill('隔离验收');
    await dialog().locator('[name=description]').fill('测试专用插件；不执行模型请求。');
    await dialog().locator('[name=price]').fill('0');
    await dialog().locator('[name=agentId]').selectOption('study');
    await dialog().locator('[name=listed]').uncheck();
    pluginId = (await submit()).id;
    fixtureEntities.push(['plugin', pluginId]);
    await goto(subjectPage, 'plugins');
    await expect(subjectPage.getByRole('heading', { name: pluginName, exact: true })).toHaveCount(0);
    await toggle(pluginName, '上架');
    await subjectPage.reload();
    const card = subjectPage.locator('.plugin-card').filter({ has: subjectPage.getByRole('heading', { name: pluginName, exact: true }) });
    await expect(card.getByRole('button', { name: '免费安装', exact: true })).toBeVisible();
    await toggle(pluginName, '下架');
    await subjectPage.reload();
    await expect(subjectPage.locator('main h1')).toBeVisible();
    await expect(subjectPage.getByRole('heading', { name: pluginName, exact: true })).toHaveCount(0);
    await api(subjectContext, { action: 'plugin.install', pluginId }, 404);
  });
  await test('Audit UI shows the temporary actor and target identifiers without including key material', ['F-115'], async () => {
    await tab('审计日志');
    const logs = (await api(adminContext, '?resource=admin')).audit.filter(log => log.userId === actorId && log.action === 'admin.save');
    assert(logs.length >= 15);
    for (const target of [modelId, agentId, planId, pluginId, subjectId]) assert(logs.some(log => log.detail.id === target));
    const visible = await adminPage.locator('main').innerText();
    assert(visible.includes(actorEmail));
    assert(visible.includes(modelId));
    assert(!visible.includes(fakeKey));
    assert(!JSON.stringify(logs).includes(fakeKey));
    results.push({ evidence: 'temporary administrative actions', auditedActions: logs.length, keysDisclosed: false });
  });
  await test('Site settings fields display the existing stored values without altering live configuration', ['F-114'], async () => {
    await tab('站点设置');
    const settings = JSON.parse(originalSettings);
    for (const key of ['siteName', 'description', 'supportContact', 'announcement']) await expect(adminPage.locator(`main [name=${key}]`)).toHaveValue(settings[key] || '');
    assert.equal((await q('SELECT data FROM settings WHERE id=1'))[0].data, originalSettings);
  }, 'read-only-browser-form-values; saving intentionally not tested against shared live settings');
  await test('Existing catalog configurations remain byte-identical and no AI or payment action occurred', [], async () => {
    const current = await q('SELECT type,id,data,sort_order FROM entities ORDER BY type,id');
    for (const previous of originalEntities) assert.deepEqual(current.find(item => item.id === previous.id && item.type === previous.type), previous);
    assert.equal((await q('SELECT data FROM settings WHERE id=1'))[0].data, originalSettings);
    assert.deepEqual(forbiddenActions, []);
    assert.equal((await q('SELECT id FROM usage_logs WHERE user_id IN (?,?)', fixtureUsers)).length, 0);
    assert.equal((await q('SELECT id FROM orders WHERE user_id IN (?,?)', fixtureUsers)).length, 0);
    assert.deepEqual(errors, []);
  }, 'database-and-network-invariant');
} catch (error) {
  results.push({ passed: false, error: clean(error.stack) });
  console.error(clean(error.stack));
  process.exitCode = 1;
} finally {
  await browser.close();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const userId of fixtureUsers) {
      for (const table of ['sessions', 'records', 'conversations', 'runs', 'orders', 'installs', 'usage_logs', 'audit']) await connection.execute(`DELETE FROM ${table} WHERE user_id=?`, [userId]);
      await connection.execute('DELETE FROM rate_limits WHERE id IN (?,?,?,?)', [`user:${userId}`, `ai:${userId}`, `admin:${userId}`, `auth:${userId === actorId ? actorEmail : subjectEmail}`]);
      await connection.execute('DELETE FROM users WHERE id=?', [userId]);
    }
    for (const [type, id] of fixtureEntities) await connection.execute('DELETE FROM entities WHERE type=? AND id=?', [type, id]);
    await connection.commit();
    const remainingUsers = (await q('SELECT id FROM users WHERE email IN (?,?)', [actorEmail, subjectEmail])).length;
    const remainingEntities = [];
    for (const [type, id] of fixtureEntities) if (await entity(type, id)) remainingEntities.push({ type, id });
    assert.equal(remainingUsers, 0);
    assert.deepEqual(remainingEntities, []);
    results.push({ name: 'All temporary accounts, entity configurations and their related rows removed transactionally', verification: 'database-cleanup', passed: true });
  } catch (error) {
    await connection.rollback();
    results.push({ passed: false, cleanupError: clean(error.stack) });
    console.error('Cleanup failed:', clean(error.message));
    process.exitCode = 1;
  } finally { connection.release(); }
  await fs.mkdir('docs/tests', { recursive: true });
  await fs.writeFile(process.env.ADMIN_CONTRACT_REPORT || 'docs/tests/admin-portal-contract-results.json', JSON.stringify({ testedAt: new Date().toISOString(), base, browserMajor: 156, fixturePolicy: 'Two temporary accounts; new temporary catalog entries only; original entities and settings byte-identical; transactional cleanup', limits: ['No model connectivity call', 'No actual money collected', 'Default model replacement not tested', 'Site settings saving not tested'], results, errors, forbiddenActions }, null, 2));
  await pool.end();
}
