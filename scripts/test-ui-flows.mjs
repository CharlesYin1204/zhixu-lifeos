import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { q, pool } from '../lib/db.mjs';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3060';
const stamp = Date.now();
const fixtureName = `UI 流程验收 ${stamp}`;
const pluginName = `验收专用临时插件 ${stamp}`;
const password = crypto.randomBytes(24).toString('base64url');
const results = [], errors = [];
let userId, pluginId, orderId, timerContext;
await fs.mkdir('docs/tests', { recursive: true });
await fs.mkdir('docs/screenshots', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const options = { viewport: { width: 1440, height: 1100 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' };
const userContext = await browser.newContext(options);
const adminContext = await browser.newContext(options);
const page = await userContext.newPage();
const adminPage = await adminContext.newPage();
for (const target of [page, adminPage]) target.on('pageerror', error => errors.push(error.message));
function sanitized(value) {
  let text = String(value);
  for (const secret of [password, process.env.ADMIN_PASSWORD, process.env.AI_API_KEY, process.env.DB_PASSWORD].filter(Boolean)) text = text.split(secret).join('[redacted]');
  return text;
}
async function api(context, payload) {
  const endpoint = context === adminContext ? '/api/admin' : '/api/app';
  const response = typeof payload === 'string' ? await context.request.get(`${base}${endpoint}${payload}`) : await context.request.post(`${base}${endpoint}`, { data: payload });
  assert.equal(response.status(), 200, sanitized(await response.text()));
  return response.json();
}
const bootstrap = () => api(userContext, '?resource=bootstrap');
async function goto(target, view, kind = '') {
  await target.goto(`${base}/?view=${view}${kind ? `&kind=${kind}` : ''}`);
  await expect(target.locator('.page-loading')).toHaveCount(0, { timeout: 20000 });
  await expect(target.locator('main h1').first()).toBeVisible({ timeout: 20000 });
}
async function test(name, run) {
  const start = Date.now();
  await run();
  results.push({ name, passed: true, durationMs: Date.now() - start });
  console.log('PASS', name);
}
async function saveRecord(kind, label, title, fields) {
  await goto(page, ['health', 'event', 'habit'].includes(kind) ? 'life' : 'learning', kind);
  await page.getByRole('button', { name: `添加${label}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name=title]').fill(title);
  for (const [field, value] of Object.entries(fields)) await dialog.locator(`[name="${field}"]`).fill(String(value));
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.record-main').filter({ has: page.getByRole('heading', { name: title, exact: true }) })).toBeVisible();
  const record = (await bootstrap()).records.find(item => item.kind === kind && item.title === title);
  assert(record, `${kind} record persisted`);
  for (const [field, value] of Object.entries(fields)) assert.equal(String(record.meta[field]), String(value), `${kind}.${field}`);
  await page.locator('.record-main').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).click();
  for (const [field, value] of Object.entries(fields)) await expect(page.getByRole('dialog').locator(`[name="${field}"]`)).toHaveValue(String(value));
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  return record;
}

try {
  await test('Anonymous visitors can view and download the actual published Android release', async () => {
    const anonymous = await browser.newContext({ ...options, viewport: { width: 390, height: 844 } });
    try {
      const visitor = await anonymous.newPage();
      visitor.on('pageerror', error => errors.push(error.message));
      await goto(visitor, 'user');
      await visitor.getByRole('button', { name: '安卓客户端下载', exact: true }).click();
      await expect(visitor.locator('.apk-download')).toContainText('Android 6.0+');
      await expect(visitor.locator('.apk-download')).toContainText('需要联网');
      const info = await api(anonymous, '?resource=bootstrap');
      assert.equal(info.user, null);
      const published = info.settings.apk.published || info.settings.apk;
      await expect(visitor.getByRole('link', { name: '下载安卓 APK', exact: true })).toHaveAttribute('href', published.downloadUrl);
      await expect(visitor.locator('.apk-metadata')).toContainText(published.versionName);
      assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    } finally { await anonymous.close(); }
  });
  const registered = await api(userContext, { action: 'auth.register', name: fixtureName, email: `ui-flows-${stamp}@example.test`, password });
  userId = registered.user.id;
  await api(adminContext, { action: 'auth.login', email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert((await bootstrap()).settings.payment.manualEnabled, 'Manual payment must be enabled for this isolated order test');

  await test('Goal form saves and reopens startDate, endDate and dailyMinutes', () => saveRecord('goal', '学习目标', 'UI 验收：英语学习目标', { startDate: '2026-10-14', endDate: '2026-11-14', dailyMinutes: 35 }));
  await test('Course form saves and reopens the course URL', () => saveRecord('course', '课程管理', 'UI 验收：学习方法课程', { url: 'https://example.com/learning-course' }));
  await test('Health form saves and reopens sleep, water and exercise measurements', () => saveRecord('health', '健康记录', 'UI 验收：日常健康', { sleepHours: 7.5, waterMl: 1800, exerciseMinutes: 30 }));
  await test('Event form saves and reopens a cross-day schedule', () => saveRecord('event', '日程安排', 'UI 验收：跨天研讨会', { dueDate: '2026-10-16', endDate: '2026-10-17', startTime: '19:30', endTime: '10:15' }));

  await test('Habit frequency is editable and displayed with the persisted check-in target', async () => {
    await goto(page, 'life', 'habit');
    await page.getByRole('button', { name: '添加习惯打卡', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[name=title]').fill('UI 验收：每周阅读');
    await dialog.locator('input[name=frequency]').fill('5');
    await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const card = page.locator('.habit-card').filter({ hasText: 'UI 验收：每周阅读' });
    await expect(card).toContainText('每周 5 天');
    assert.equal((await bootstrap()).records.find(record => record.title === 'UI 验收：每周阅读')?.meta.frequency, 5);
  });
  await test('User center exposes all feature groups and course resources have a safe direct link', async () => {
    await goto(page, 'user');
    for (const label of ['学习成长', '生活管理', 'AI 与效率', '账户与应用']) await expect(page.locator('.feature-entry-group').getByRole('heading', { name: label, exact: true })).toBeVisible();
    await goto(page, 'learning', 'course');
    const link = page.getByRole('link', { name: '打开课程 UI 验收：学习方法课程', exact: true });
    await expect(link).toHaveAttribute('href', 'https://example.com/learning-course');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  await test('Actual 25/5 timer supports pause, closing, reopening and automatic focus persistence', async () => {
    timerContext = await browser.newContext({ ...options, storageState: await userContext.storageState() });
    const timerPage = await timerContext.newPage();
    timerPage.on('pageerror', error => errors.push(error.message));
    const virtualStart = Date.now();
    await timerPage.clock.install({ time: new Date(virtualStart) });
    await timerPage.clock.pauseAt(new Date(virtualStart + 1000));
    await goto(timerPage, 'learning', 'focus');
    await timerPage.getByRole('button', { name: '打开番茄钟', exact: true }).click();
    let dialog = timerPage.getByRole('dialog');
    await expect(dialog.getByRole('timer')).toHaveText('25:00');
    await dialog.locator('.field input').fill('UI 验收：完整 25 分钟专注');
    await dialog.getByRole('button', { name: '开始', exact: true }).click();
    await timerPage.clock.fastForward(120000);
    await expect(dialog.getByRole('timer')).toHaveText('23:00');
    await dialog.getByRole('button', { name: '暂停', exact: true }).click();
    await timerPage.clock.fastForward(300000);
    await expect(dialog.getByRole('timer')).toHaveText('23:00');
    await dialog.getByRole('button', { name: '开始', exact: true }).click();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await timerPage.clock.fastForward(60000);
    await expect(timerPage.locator('.focus-floating')).toContainText('22:00');
    await timerPage.locator('.focus-floating').click();
    dialog = timerPage.getByRole('dialog');
    await expect(dialog.getByRole('timer')).toHaveText('22:00');
    await timerPage.clock.fastForward(22 * 60000);
    await expect(dialog.getByRole('timer')).toHaveText('05:00', { timeout: 20000 });
    const focus = (await bootstrap()).records.filter(record => record.kind === 'focus' && record.title === 'UI 验收：完整 25 分钟专注');
    assert.equal(focus.length, 1, 'automatic completion saves exactly one record');
    assert.equal(focus[0].meta.minutes, 25);
    assert.equal(focus[0].meta.seconds, 1500);
    assert.equal(focus[0].status, 'completed');
    await dialog.getByRole('button', { name: '开始', exact: true }).click();
    await timerPage.clock.fastForward(5 * 60000);
    await expect(dialog.getByRole('timer')).toHaveText('25:00');
    assert.equal((await bootstrap()).records.filter(record => record.kind === 'focus').length, 1, 'break does not inflate focus time');
    await dialog.locator('.field input').fill('UI 验收：手动结束专注');
    await dialog.getByRole('button', { name: '开始', exact: true }).click();
    await timerPage.clock.fastForward(60000);
    await dialog.getByRole('button', { name: '完成并保存', exact: true }).click();
    await expect(dialog.getByRole('timer')).toHaveText('05:00');
    assert.equal((await bootstrap()).records.find(record => record.title === 'UI 验收：手动结束专注')?.meta.minutes, 1);
    await timerContext.close();
    timerContext = null;
  });

  await test('A real AI response survives a page reload and can be reopened from history', async () => {
    await goto(page, 'ai');
    await page.locator('.chat-agent').filter({ hasText: '学习教练' }).click();
    const prompt = '我想每天用 35 分钟学习英语，请给我三个简短且可执行的步骤，总字数控制在 180 字以内。';
    await page.getByRole('textbox', { name: '发送给 AI 的消息', exact: true }).fill(prompt);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('.message.assistant .message-bubble')).toBeVisible({ timeout: 120000 });
    const reply = await page.locator('.message.assistant .message-bubble').innerText();
    assert(reply.length > 30, 'real model response must contain useful content');
    const data = await bootstrap();
    const conversation = data.conversations.find(item => item.title === prompt.slice(0, 60));
    assert(conversation);
    assert.equal((await api(userContext, `?resource=conversation&id=${conversation.id}`)).conversation.messages.length, 2);
    await page.reload();
    await expect(page.locator('.message.assistant .message-bubble')).toHaveText(reply, { timeout: 20000 });
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    await expect(page.locator('.chat-welcome')).toBeVisible();
    await page.locator('.conversation-history summary').click();
    await page.locator('.conversation-history button').filter({ hasText: prompt.slice(0, 60) }).click();
    await expect(page.locator('.message.assistant .message-bubble')).toHaveText(reply);
    await page.screenshot({ path: 'docs/screenshots/desktop-ai-real.png', fullPage: true });
    results.push({ evidence: 'docs/screenshots/desktop-ai-real.png', conversationMessages: 2, realReplyCharacters: reply.length });
  });

  await test('Administrator creates a temporary plugin and sets its own price through the UI', async () => {
    await goto(adminPage, 'admin');
    await adminPage.getByRole('navigation', { name: '后台导航', exact: true }).getByRole('link', { name: '插件管理', exact: true }).click();
    await adminPage.getByRole('button', { name: '新增插件', exact: true }).click();
    const dialog = adminPage.getByRole('dialog');
    await dialog.locator('input[name=name]').fill(pluginName);
    await dialog.locator('input[name=category]').fill('验收临时工具');
    await dialog.locator('input[name=price]').fill('7.31');
    await dialog.locator('textarea[name=description]').fill('仅供自动化验收，测试结束即清理。');
    await dialog.locator('input[name=version]').fill('1.2.3');
    await dialog.locator('textarea[name=features]').fill('隔离测试商品\n价格设置验收');
    await dialog.locator('select[name=agentId]').selectOption('study');
    const responsePromise = adminPage.waitForResponse(response => response.url().endsWith('/api/admin') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'admin.save');
    await dialog.getByRole('button', { name: '保存配置', exact: true }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    pluginId = (await response.json()).id;
    await expect(dialog).toHaveCount(0);
    const row = adminPage.locator('tbody tr').filter({ hasText: pluginName });
    await row.getByRole('button', { name: '编辑', exact: true }).click();
    await adminPage.getByRole('dialog').locator('input[name=price]').fill('9.37');
    await adminPage.getByRole('dialog').getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(adminPage.getByRole('dialog')).toHaveCount(0);
    await expect(row).toContainText('9.37');
    const savedPlugin = (await bootstrap()).plugins.find(plugin => plugin.id === pluginId);
    assert.equal(savedPlugin?.price, 9.37);
    assert.equal(savedPlugin?.version, '1.2.3');
  });

  await test('Ordinary user creates a manual-payment order at the administrator-configured price', async () => {
    await goto(page, 'plugins');
    const card = page.locator('.plugin-card').filter({ has: page.getByRole('heading', { name: pluginName, exact: true }) });
    await card.getByRole('button', { name: '购买安装', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.checkout-total')).toContainText('9.37');
    await dialog.getByRole('button', { name: /线下转账/ }).click();
    await dialog.getByRole('button', { name: '创建订单并支付', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '订单已准备好', exact: true })).toBeVisible();
    const orders = (await bootstrap()).orders.filter(order => order.productId === pluginId);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].amount, 9.37);
    assert.equal(orders[0].status, 'pending');
    assert.equal(orders[0].paymentMethod, 'manual');
    orderId = orders[0].id;
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  });

  await test('Administrator UI confirmation grants the temporary paid plugin to that user', async () => {
    await goto(adminPage, 'admin');
    await adminPage.getByRole('navigation', { name: '后台导航', exact: true }).getByRole('link', { name: '订单管理', exact: true }).click();
    const row = adminPage.locator('tbody tr').filter({ hasText: orderId });
    adminPage.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: '确认收款', exact: true }).click();
    await expect(row).toContainText('已支付');
    const data = await bootstrap();
    assert.equal(data.orders.find(order => order.id === orderId)?.status, 'paid');
    assert(data.installed.includes(pluginId));
    await row.getByRole('button', { name: '详情', exact: true }).click();
    const detail = adminPage.getByRole('dialog');
    await expect(detail).toContainText('支付流水号');
    await expect(detail).toContainText('支付时间');
    await expect(detail.locator('.order-detail')).toContainText('manual:');
    await detail.getByRole('button', { name: '关闭', exact: true }).click();
  });

  await test('Purchased plugin can be uninstalled and reinstalled through the UI without another order', async () => {
    await goto(page, 'plugins');
    const card = page.locator('.plugin-card').filter({ has: page.getByRole('heading', { name: pluginName, exact: true }) });
    await card.getByRole('button', { name: '卸载', exact: true }).click();
    await expect(card.getByRole('button', { name: '重新安装', exact: true })).toBeVisible();
    assert(!(await bootstrap()).installed.includes(pluginId));
    await card.getByRole('button', { name: '重新安装', exact: true }).click();
    await expect(card.getByRole('button', { name: '使用', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const data = await bootstrap();
    assert(data.installed.includes(pluginId));
    assert.equal(data.orders.filter(order => order.productId === pluginId).length, 1);
  });
  assert.deepEqual(errors, []);
  results.push({ name: 'No browser runtime errors during all UI flows', passed: true });
} catch (error) {
  const text = sanitized(error.stack || error.message);
  results.push({ passed: false, error: text });
  console.error(text);
  process.exitCode = 1;
  await page.screenshot({ path: 'docs/screenshots/ui-flow-failure.png', fullPage: true }).catch(() => {});
} finally {
  if (timerContext) await timerContext.close().catch(() => {});
  // Delete only this run's fixtures, including its administrator audit entries.
  try {
    if (!userId) userId = (await q('SELECT id FROM users WHERE email=?', [`ui-flows-${stamp}@example.test`]))[0]?.id;
    if (!pluginId) pluginId = (await q("SELECT id FROM entities WHERE type='plugin' AND JSON_UNQUOTE(JSON_EXTRACT(data,'$.name'))=?", [pluginName]))[0]?.id;
    if (pluginId) {
      const orders = await q('SELECT id FROM orders WHERE product_id=?', [pluginId]);
      for (const order of orders) await q("DELETE FROM audit WHERE JSON_UNQUOTE(JSON_EXTRACT(detail,'$.orderId'))=?", [order.id]);
      await q("DELETE FROM audit WHERE action='admin.save' AND JSON_UNQUOTE(JSON_EXTRACT(detail,'$.id'))=?", [pluginId]);
      await q('DELETE FROM installs WHERE plugin_id=?', [pluginId]);
      await q('DELETE FROM orders WHERE product_id=?', [pluginId]);
      await q("DELETE FROM entities WHERE type='plugin' AND id=?", [pluginId]);
    }
    if (userId) {
      for (const table of ['sessions', 'records', 'conversations', 'runs', 'orders', 'installs', 'usage_logs', 'audit']) await q(`DELETE FROM ${table} WHERE user_id=?`, [userId]);
      await q('DELETE FROM users WHERE id=?', [userId]);
    }
    await api(adminContext, { action: 'auth.logout' });
    const remainingUsers = await q('SELECT id FROM users WHERE email=?', [`ui-flows-${stamp}@example.test`]);
    const remainingPlugins = await q("SELECT id FROM entities WHERE type='plugin' AND JSON_UNQUOTE(JSON_EXTRACT(data,'$.name'))=?", [pluginName]);
    assert.equal(remainingUsers.length, 0);
    assert.equal(remainingPlugins.length, 0);
    results.push({ name: 'Temporary user, records, conversation, plugin, order and related audit fixtures removed', passed: true });
  } catch (error) {
    results.push({ name: 'Fixture cleanup', passed: false, error: sanitized(error.message) });
    process.exitCode = 1;
  }
  await fs.writeFile('docs/tests/ui-flow-results.json', JSON.stringify({ testedAt: new Date().toISOString(), base, results, errors }, null, 2));
  await browser.close();
  await pool.end();
}
