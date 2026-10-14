import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
function recording() {
  const samples = 16000 * 8;
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples * 2, 40);
  return b;
}
test('landing, responsive layout and isolated demo interactions', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', (r) => {
    if (!['localhost', '127.0.0.1'].includes(new URL(r.url()).hostname)) outbound.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SAME PEOPLE. DEEPER WORK.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/landing-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Explore the demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Write a post' }).fill('A browser-only demo update.');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('A browser-only demo update.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('A browser-only demo update.')).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  await page.getByRole('textbox', { name: 'Space name' }).fill('Research');
  await page.getByRole('button', { name: 'Create space', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Research' })).toBeVisible();
  await page.getByRole('button', { name: 'Meeting minutes' }).click();
  await page.getByRole('button', { name: /Weekly product sync/ }).click();
  await page.getByRole('button', { name: 'Edit minutes', exact: true }).click();
  await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('Edited demo summary.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Edited demo summary.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SAME PEOPLE. DEEPER WORK.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/landing-mobile.png', fullPage: true });
  await page.goto('/app?demo=1');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'Meeting minutes' })).toBeVisible();
  expect(outbound).toEqual([]);
});
test('real API: setup, realtime post, recording review and publication', async ({ page, browser }) => {
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Make yourself at home.' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Organisation name' }).fill('Browser Test Studio');
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Browser Reviewer');
  await page.getByRole('textbox', { name: 'Work email' }).fill('reviewer@example.test');
  await page.getByLabel('Password · at least 12 characters').fill('Browser test password 2026');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  const other = await browser.newContext({ storageState: await page.context().storageState() });
  const second = await other.newPage();
  await second.goto('http://localhost:3000/app');
  await expect(second.getByRole('heading', { name: 'General' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Write a post' }).fill('A real-time team update from the browser.');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(second.getByText('A real-time team update from the browser.')).toBeVisible();
  await page.getByRole('button', { name: 'Meeting minutes' }).click();
  await page.getByRole('button', { name: 'Upload recording' }).click();
  await page
    .getByLabel('Meeting recording')
    .setInputFiles({ name: 'fixture.wav', mimeType: 'audio/wav', buffer: recording() });
  await page.getByRole('textbox', { name: 'Meeting title' }).fill('Browser acceptance meeting');
  await page.getByRole('button', { name: 'Upload & generate' }).click();
  await expect(page.getByRole('button', { name: 'Edit minutes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit minutes', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Summary', exact: true })
    .fill('Human-reviewed browser acceptance summary.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & publish', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Word document' })).toBeVisible();
  const doc = await page.request.get(
    (await page.getByRole('link', { name: 'Word document' }).getAttribute('href')) || '',
  );
  expect(doc.ok()).toBe(true);
  expect((await doc.body()).subarray(0, 2).toString()).toBe('PK');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByText('Human-reviewed browser acceptance summary.')).toBeVisible();
  await second.reload();
  await expect(second.getByText('Human-reviewed browser acceptance summary.')).toBeVisible();
  await other.close();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Work email' }).fill('reviewer@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Browser test password 2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
});
