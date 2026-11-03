import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { q, pool, id } from '../lib/db.mjs';
import { createSession } from '../lib/security.mjs';

// Run after deployment, with no other Chromium test running:
// TEST_BASE_URL=https://154.40.47.111:3063 node --env-file=.env.local scripts/test-restored-ui.mjs
// One temporary ordinary account, one pending manual order and owned records only.
// No payment is submitted/approved; existing catalog entries and settings are never changed.
const base = process.env.TEST_BASE_URL || 'https://154.40.47.111:3063';
const fixtureId = id(), results = [], errors = [], forbiddenActions = [], routeErrors = [];
const orderBodies = [], orderIds = [], paginationResponses = [];
const report = { startedAt: new Date().toISOString(), base, scope: 'Production browser checkout lost-response retry, 1505-record auto-pagination and owned source navigation; no actual payment or AI call', results, errors, forbiddenActions };
let browser, context, page, activeTest, expectedProductId, loseNextOrderResponse = true, capturePagination = false;

async function test(name, run) {
  activeTest = name;
  const started = Date.now();
  const evidence = await run();
  results.push({ name, passed: true, durationMs: Date.now() - started, ...(evidence ? { evidence } : {}) });
  console.log('PASS', name);
  activeTest = undefined;
}
async function open(view, kind = '') {
  await page.goto(`${base}/?view=${view}${kind ? `&kind=${kind}` : ''}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.page-loading')).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator('main h1').first()).toBeVisible();
}
async function bootstrap() {
  const response = await context.request.get(`${base}/api/app?resource=bootstrap`);
  assert.equal(response.status(), 200);
  return response.json();
}

try {
  await q('INSERT INTO users (id,email,name,password_hash,role,credits) VALUES (?,?,?,?,?,?)', [fixtureId, `restored-ui-${fixtureId}@example.test`, '恢复契约临时验收', '!no-password-login', 'user', 20]);
  const token = await createSession(fixtureId);
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  report.browser = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  context.setDefaultTimeout(12000);
  context.setDefaultNavigationTimeout(25000);
  await context.addCookies([{ name: 'zhixu_session', value: token, url: base, httpOnly: true, sameSite: 'Lax', secure: new URL(base).protocol === 'https:' }]);
  await context.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    const payload = request.postDataJSON();
    if (new URL(request.url()).pathname !== '/api/app' || payload?.action !== 'order.create' || payload.paymentMethod !== 'manual' || payload.type !== 'membership' || payload.productId !== expectedProductId) {
      forbiddenActions.push(payload?.action || request.url());
      return route.abort('blockedbyclient');
    }
    orderBodies.push({ requestId: payload.requestId, productId: payload.productId, paymentMethod: payload.paymentMethod });
    if (!loseNextOrderResponse) return route.continue();
    loseNextOrderResponse = false;
    try {
      // The production server commits the first order, but its response never reaches the UI.
      const response = await route.fetch({ timeout: 25000 });
      assert.equal(response.status(), 200, 'First server-side pending order must be created before simulating response loss');
      const data = await response.json();
      assert.equal(data.order?.status, 'pending');
      assert(!data.paymentUrl, 'Manual orders must not open an external provider');
      orderIds.push(data.order.id);
    } catch (error) {
      routeErrors.push(error.message);
    }
    await route.abort('failed');
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (!capturePagination || response.request().method() !== 'GET') return;
    const url = new URL(response.url());
    if (url.pathname !== '/api/app' || !['bootstrap', 'records'].includes(url.searchParams.get('resource'))) return;
    paginationResponses.push(response.json().then(body => ({ resource: url.searchParams.get('resource'), records: body.records, next: body.recordsNextCursor })));
  });

  await test('Lost checkout response retries the same requestId and leaves exactly one pending manual order', async () => {
    const before = await bootstrap();
    assert.equal(before.settings.payment?.manualEnabled, true, 'An existing manual channel is required; this test never changes payment settings');
    const plan = before.plans.find(item => item.enabled !== false && Number(item.price) > 0);
    assert(plan, 'An existing paid plan is required for the unpaid fixture order');
    expectedProductId = plan.id;
    await open('membership');
    await page.locator('.plan-card').filter({ has: page.getByRole('heading', { name: plan.name, exact: true }) }).getByRole('button').click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('.payment-methods').getByRole('button', { name: /线下转账/ }).click();
    await dialog.getByRole('button', { name: '创建订单并支付', exact: true }).click();
    await expect(dialog.locator('.form-error')).toBeVisible({ timeout: 30000 });
    await expect(dialog.getByRole('button', { name: '创建订单并支付', exact: true })).toBeEnabled();
    assert.deepEqual(routeErrors, []);
    assert.equal(orderIds.length, 1);
    await dialog.getByRole('button', { name: '创建订单并支付', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '订单已准备好', exact: true })).toBeVisible({ timeout: 25000 });
    assert.equal(orderBodies.length, 2);
    assert.equal(typeof orderBodies[0].requestId, 'string');
    assert(orderBodies[0].requestId.length >= 8);
    assert.deepEqual(orderBodies[0], orderBodies[1]);
    const orders = await q('SELECT id,status,payment_method,paid_at FROM orders WHERE user_id=?', [fixtureId]);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].id, orderIds[0]);
    assert.equal(orders[0].status, 'pending');
    assert.equal(orders[0].payment_method, 'manual');
    assert.equal(orders[0].paid_at, null);
    await expect(dialog.locator('.order-number')).toContainText(orders[0].id);
    const requests = await q('SELECT request_key,order_id FROM order_requests WHERE user_id=?', [fixtureId]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].request_key, orderBodies[0].requestId);
    assert.equal(requests[0].order_id, orders[0].id);
    await dialog.getByRole('button', { name: '前往用户中心查看订单', exact: true }).click();
    return { browserSubmissions: 2, sameRequestId: true, databaseOrders: 1, paidOrders: 0, paymentMethod: 'manual' };
  });

  await test('The production UI loads every record through all four pages beyond the previous 1500-record boundary', async () => {
    const fixtures = Array.from({ length: 1505 }, (_, index) => ({ id: id(), title: `分页验收 ${String(index + 1).padStart(4, '0')}`, timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString().slice(0, 19).replace('T', ' ') }));
    for (let offset = 0; offset < fixtures.length; offset += 250) {
      const batch = fixtures.slice(offset, offset + 250);
      await q(`INSERT INTO records (id,user_id,kind,title,content,status,meta,updated_at) VALUES ${batch.map(() => '(?,?,?,?,?,?,?,?)').join(',')}`, batch.flatMap(record => [record.id, fixtureId, 'task', record.title, '自动分页临时验收记录', 'active', '{}', record.timestamp]));
    }
    capturePagination = true;
    await open('learning', 'task');
    await expect(page.locator('.record-row')).toHaveCount(1505, { timeout: 30000 });
    capturePagination = false;
    const pages = await Promise.all(paginationResponses);
    assert.deepEqual(pages.map(item => item.records?.length), [500, 500, 500, 5]);
    const returnedIds = pages.flatMap(item => item.records.map(record => record.id));
    assert.equal(new Set(returnedIds).size, 1505);
    assert.deepEqual([...returnedIds].sort(), fixtures.map(record => record.id).sort());
    assert.equal(pages.at(-1).next, null);
    await page.getByRole('textbox', { name: '搜索记录', exact: true }).fill('分页验收 0001');
    await expect(page.locator('.record-row')).toHaveCount(1);
    await expect(page.locator('.record-row h3')).toHaveText('分页验收 0001');
    await page.locator('.record-row').getByRole('button', { name: '编辑记录', exact: true }).click();
    await expect(page.getByRole('dialog').locator('input[name=title]')).toHaveValue('分页验收 0001');
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    return { pages: pages.map(item => item.records.length), uniqueOwnedRecords: returnedIds.length, oldestRecordSearchAndEdit: true };
  });

  await test('Reference links open the exact owned record and deleted attachments remain readable without a clickable link', async () => {
    const sourceId = id(), resultId = id(), deletedAssetId = id();
    const sourceTitle = '来源验收 · 我的原始笔记', resultTitle = '来源验收 · 已保存的整理结果';
    const sourceBody = '仅此测试账户拥有的原始内容，来源按钮应打开这一条记录。';
    await q('INSERT INTO records (id,user_id,kind,title,content,status,meta) VALUES (?,?,?,?,?,?,?),(?,?,?,?,?,?,?)', [sourceId, fixtureId, 'note', sourceTitle, sourceBody, 'active', '{}', resultId, fixtureId, 'note', resultTitle, '测试保存结果的来源交互，不调用 AI。', 'active', JSON.stringify({ sources: [{ id: sourceId, kind: 'note', title: sourceTitle, label: '知识笔记' }, { id: deletedAssetId, kind: 'image', title: '来源验收 · 已删除图片', url: `/api/media?resource=asset&id=${deletedAssetId}` }] })]);
    await open('knowledge');
    await page.locator('.note-card').filter({ has: page.getByRole('heading', { name: resultTitle, exact: true }) }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('.ai-sources summary').click();
    const deleted = dialog.locator('.ai-sources li').filter({ hasText: '来源验收 · 已删除图片' });
    await expect(deleted).toContainText('附件已删除');
    await expect(deleted.locator('button,a')).toHaveCount(0);
    await dialog.locator('.ai-sources').getByRole('button', { name: new RegExp(sourceTitle) }).click();
    await expect(page).toHaveURL(new RegExp('view=knowledge&kind=note'));
    await expect(page.getByRole('dialog').locator('input[name=title]')).toHaveValue(sourceTitle);
    await expect(page.getByRole('dialog').locator('textarea[name=content]')).toHaveValue(sourceBody);
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    return { exactOwnedSourceRecordOpened: true, deletedSourceTitlePreserved: true, deletedSourceClickable: false };
  });

  await test('No browser exception, disallowed action, actual payment or AI credit change occurred', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(routeErrors, []);
    assert.deepEqual(forbiddenActions, []);
    assert.equal(Number((await q('SELECT credits FROM users WHERE id=?', [fixtureId]))[0].credits), 20);
    assert.equal(Number((await q("SELECT COUNT(*) count FROM orders WHERE user_id=? AND status='paid'", [fixtureId]))[0].count), 0);
  });
} catch (error) {
  process.exitCode = 1;
  results.push({ name: activeTest || 'Browser/fixture setup', passed: false, error: error.message });
  console.error('FAIL', activeTest || 'setup', error.message);
} finally {
  await browser?.close().catch(() => {});
  try {
    for (const table of ['order_requests', 'orders', 'sessions', 'records', 'audit']) await q(`DELETE FROM ${table} WHERE user_id=?`, [fixtureId]);
    await q('DELETE FROM users WHERE id=?', [fixtureId]);
    await q('DELETE FROM rate_limits WHERE id IN (?,?,?)', [`user:${fixtureId}`, `ai:${fixtureId}`, `run:${fixtureId}`]);
    assert.equal(Number((await q('SELECT COUNT(*) count FROM rate_limits WHERE id IN (?,?,?)', [`user:${fixtureId}`, `ai:${fixtureId}`, `run:${fixtureId}`]))[0].count), 0);
    for (const table of ['order_requests', 'orders', 'sessions', 'records', 'audit']) assert.equal(Number((await q(`SELECT COUNT(*) count FROM ${table} WHERE user_id=?`, [fixtureId]))[0].count), 0);
    assert.equal((await q('SELECT id FROM users WHERE id=?', [fixtureId])).length, 0);
    results.push({ name: 'Temporary ordinary user, unpaid order, request key, session and all owned records removed', passed: true });
  } catch (error) {
    process.exitCode = 1;
    results.push({ name: 'Fixture cleanup', passed: false, error: error.message });
    console.error('FAIL fixture cleanup', error.message);
  }
  report.finishedAt = new Date().toISOString();
  report.passed = results.every(result => result.passed);
  try {
    await fs.mkdir('docs/tests', { recursive: true });
    await fs.writeFile('docs/tests/restored-ui-results.json', JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}
