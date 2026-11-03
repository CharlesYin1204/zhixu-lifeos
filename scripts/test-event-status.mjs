import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { q, pool, id, parse } from '../lib/db.mjs';
import { createSession } from '../lib/security.mjs';

// Run only after deploying the event-status UI:
// TEST_BASE_URL=https://154.40.47.111:3063 node --env-file=.env.local scripts/test-event-status.mjs
// Uses one temporary ordinary account; no AI, payment, administrator or settings calls.
const base = process.env.TEST_BASE_URL || 'https://154.40.47.111:3063';
const fixtureId = id();
const results = [], errors = [], forbiddenActions = [];
const firstTitle = '日程状态验收 · 跨天读书会';
const secondTitle = '日程状态验收 · 已结束复盘';
const eventMeta = { dueDate: '2026-10-14', endDate: '2026-10-15', startTime: '23:30', endTime: '00:30', category: '学习交流' };
const report = { startedAt: new Date().toISOString(), base, scope: 'Production browser event status, persistence, filters and mobile controls; isolated ordinary user; zero AI/payment calls', results, errors, forbiddenActions };
let browser, context, page, activeTest;

async function test(name, run) {
  activeTest = name;
  const started = Date.now();
  await run();
  results.push({ name, passed: true, durationMs: Date.now() - started });
  console.log('PASS', name);
  activeTest = undefined;
}
async function openEvents() {
  await page.goto(`${base}/?view=life&kind=event`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.page-loading')).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByRole('button', { name: '添加日程安排', exact: true })).toBeVisible();
}
const row = title => page.locator('.record-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
async function savedRecord(title) {
  const rows = await q('SELECT * FROM records WHERE user_id=? AND kind=? AND title=?', [fixtureId, 'event', title]);
  assert.equal(rows.length, 1, 'Exactly one owned event must persist');
  return { ...rows[0], meta: parse(rows[0].meta) };
}
async function assertSaved(title, status, expectedMeta) {
  const record = await savedRecord(title);
  assert.equal(record.status, status);
  if (expectedMeta) for (const [key, value] of Object.entries(expectedMeta)) assert.equal(record.meta[key], value, `event.meta.${key} preserved`);
  return record;
}
async function selectFilter(label, count) {
  const button = page.locator('.filter-pills').getByRole('button', { name: label, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.record-row')).toHaveCount(count);
}
async function addEvent(title, status, meta = eventMeta) {
  await page.getByRole('button', { name: '添加日程安排', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[name=title]').fill(title);
  await expect(dialog.locator('select[name=status]')).toHaveValue('active');
  await dialog.locator('select[name=status]').selectOption(status);
  for (const [key, value] of Object.entries(meta)) await dialog.locator(`[name=${key}]`).fill(value);
  await dialog.locator('textarea[name=content]').fill('临时验收记录；日程状态改变不得丢失日期、时间或说明。');
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(title)).toBeVisible();
  await assertSaved(title, status, meta);
}
async function editStatus(title, status) {
  await row(title).getByRole('button', { name: '编辑记录', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('select[name=status]').selectOption(status);
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await assertSaved(title, status, eventMeta);
}
async function verifyReopened(title, status) {
  await openEvents();
  await row(title).getByRole('button', { name: '编辑记录', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('select[name=status]')).toHaveValue(status);
  for (const [key, value] of Object.entries(eventMeta)) await expect(dialog.locator(`[name=${key}]`)).toHaveValue(value);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
}

try {
  await q('INSERT INTO users (id,email,name,password_hash,role,credits) VALUES (?,?,?,?,?,?)', [fixtureId, `event-status-${fixtureId}@example.test`, '日程状态临时验收', '!no-password-login', 'user', 20]);
  const token = await createSession(fixtureId);
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  report.browser = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  context.setDefaultTimeout(10000);
  context.setDefaultNavigationTimeout(20000);
  await context.addCookies([{ name: 'zhixu_session', value: token, url: base, httpOnly: true, sameSite: 'Lax', secure: new URL(base).protocol === 'https:' }]);
  await context.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    const action = request.postDataJSON()?.action;
    if (new URL(request.url()).pathname === '/api/app' && action === 'record.save') return route.continue();
    forbiddenActions.push(action || request.url());
    await route.abort('blockedbyclient');
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));

  await test('Event create form defaults to active and persists an explicit completed state', async () => {
    await openEvents();
    await addEvent(firstTitle, 'active');
    await addEvent(secondTitle, 'completed');
    await verifyReopened(secondTitle, 'completed');
    await selectFilter('进行中', 1);
    await expect(row(firstTitle)).toBeVisible();
    await selectFilter('已完成', 1);
    await expect(row(secondTitle)).toBeVisible();
    await selectFilter('全部', 2);
  });

  await test('Desktop quick completion persists across reload without losing cross-day details', async () => {
    await row(firstTitle).getByRole('button', { name: `完成日程 ${firstTitle}`, exact: true }).click();
    await expect(row(firstTitle).getByRole('button', { name: `恢复日程 ${firstTitle}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await assertSaved(firstTitle, 'completed', eventMeta);
    await verifyReopened(firstTitle, 'completed');
    await expect(row(firstTitle)).toContainText('2026-10-14 23:30 — 2026-10-15 00:30');
    await selectFilter('进行中', 0);
    await selectFilter('已完成', 2);
  });

  await test('Quick restore removes the event from completed results and restores active results', async () => {
    await row(firstTitle).getByRole('button', { name: `恢复日程 ${firstTitle}`, exact: true }).click();
    await expect(row(firstTitle)).toHaveCount(0);
    await assertSaved(firstTitle, 'active', eventMeta);
    await selectFilter('进行中', 1);
    await expect(row(firstTitle).getByRole('button', { name: `完成日程 ${firstTitle}`, exact: true })).toHaveAttribute('aria-pressed', 'false');
    await verifyReopened(firstTitle, 'active');
    await selectFilter('已完成', 1);
    await selectFilter('全部', 2);
  });

  await test('Event edit form completes and restores records with status and date fields retained on reload', async () => {
    await editStatus(firstTitle, 'completed');
    await verifyReopened(firstTitle, 'completed');
    await selectFilter('已完成', 2);
    await editStatus(firstTitle, 'active');
    await expect(row(firstTitle)).toHaveCount(0);
    await verifyReopened(firstTitle, 'active');
  });

  await test('Legacy done events display as completed and can be restored through the same UI', async () => {
    const legacyId = id(), title = '日程状态验收 · 旧完成值';
    await q('INSERT INTO records (id,user_id,kind,title,content,status,meta) VALUES (?,?,?,?,?,?,?)', [legacyId, fixtureId, 'event', title, '临时旧状态兼容验收', 'done', JSON.stringify(eventMeta)]);
    await openEvents();
    await selectFilter('已完成', 2);
    await row(title).getByRole('button', { name: '编辑记录', exact: true }).click();
    await expect(page.getByRole('dialog').locator('select[name=status]')).toHaveValue('completed');
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await row(title).getByRole('button', { name: `恢复日程 ${title}`, exact: true }).click();
    await expect(row(title)).toHaveCount(0);
    await assertSaved(title, 'active', eventMeta);
    await selectFilter('进行中', 2);
    await expect(row(title)).toBeVisible();
  });

  await test('Mobile event completion, restore and all three filters remain usable without horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEvents();
    await expect(page.locator('.mobile-bottom')).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await selectFilter('进行中', 2);
    await row(firstTitle).getByRole('button', { name: `完成日程 ${firstTitle}`, exact: true }).click();
    await expect(row(firstTitle)).toHaveCount(0);
    await assertSaved(firstTitle, 'completed', eventMeta);
    await selectFilter('已完成', 2);
    await row(firstTitle).getByRole('button', { name: `恢复日程 ${firstTitle}`, exact: true }).click();
    await expect(row(firstTitle)).toHaveCount(0);
    await assertSaved(firstTitle, 'active', eventMeta);
    await selectFilter('进行中', 2);
    await expect(row(firstTitle)).toBeVisible();
    await selectFilter('全部', 3);
    await fs.mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/screenshots/event-status-mobile.png', fullPage: true });
  });

  await test('No browser exceptions, disallowed operations or AI credit changes occurred', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(forbiddenActions, []);
    assert.equal(Number((await q('SELECT credits FROM users WHERE id=?', [fixtureId]))[0].credits), 20);
  });
} catch (error) {
  process.exitCode = 1;
  results.push({ name: activeTest || 'Browser/fixture setup', passed: false, error: error.message });
  console.error('FAIL', activeTest || 'setup', error.message);
} finally {
  await browser?.close().catch(() => {});
  try {
    for (const table of ['sessions', 'records', 'audit']) await q(`DELETE FROM ${table} WHERE user_id=?`, [fixtureId]);
    await q('DELETE FROM users WHERE id=?', [fixtureId]);
    await q('DELETE FROM rate_limits WHERE id IN (?,?,?)', [`user:${fixtureId}`, `ai:${fixtureId}`, `run:${fixtureId}`]);
    assert.equal(Number((await q('SELECT COUNT(*) count FROM rate_limits WHERE id IN (?,?,?)', [`user:${fixtureId}`, `ai:${fixtureId}`, `run:${fixtureId}`]))[0].count), 0);
    for (const table of ['sessions', 'records', 'audit']) assert.equal(Number((await q(`SELECT COUNT(*) count FROM ${table} WHERE user_id=?`, [fixtureId]))[0].count), 0);
    assert.equal((await q('SELECT id FROM users WHERE id=?', [fixtureId])).length, 0);
    results.push({ name: 'Temporary ordinary user, session, events and audit records removed', passed: true });
  } catch (error) {
    process.exitCode = 1;
    results.push({ name: 'Fixture cleanup', passed: false, error: error.message });
    console.error('FAIL fixture cleanup', error.message);
  }
  report.finishedAt = new Date().toISOString();
  report.passed = results.every(result => result.passed);
  try {
    await fs.mkdir('docs/tests', { recursive: true });
    await fs.writeFile('docs/tests/event-status-results.json', JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}
