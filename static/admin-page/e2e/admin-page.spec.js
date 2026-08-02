import { test, expect } from '@playwright/test';

// E2E suite for the FINRA admin page. Runs against the Vite dev server with
// @forge/bridge mocked (see src/e2e-mocks/forge-bridge.js) — two seeded jira
// audit events, one sealed daily digest, and an in-memory config store.
//
// Locator notes: the app's <label> elements are not associated with their
// inputs (no htmlFor/id), so tests select by placeholder instead of label.
// Default table sort is newest-first, so evt-jira-0002 (Alex Trader) is the
// top row and evt-jira-0001 (Jordan Broker) is second.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The app shows a loading state until getConfig resolves.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('FINRA');
});

test('loads configuration from the resolver into the form', async ({ page }) => {
  // Config card reflects the mocked resolver data
  await expect(page.getByPlaceholder('e.g. FINRA-Regulated')).toHaveValue('FINRA-Regulated');
  await expect(page.getByPlaceholder('300')).toHaveValue('300');

  // All four main tabs render
  for (const label of [
    'Tracked Event Audit Log',
    'Webhook Configuration',
    'Lexicon Rules Engine',
    'Chain Integrity',
  ]) {
    await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible();
  }
});

test('audit log renders tracked events newest-first and search filters them', async ({ page }) => {
  const rows = page.locator('.logs-section tbody tr');
  await expect(rows).toHaveCount(2);
  // Newest event (evt-jira-0002) sorts to the top
  await expect(rows.first()).toContainText('Alex Trader');
  await expect(rows.nth(1)).toContainText('Jordan Broker');

  // Client-side search narrows to the matching regulated user
  await page.getByPlaceholder(/Search logs by Event Type/).fill('Jordan Broker');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Jordan Broker');
  await expect(rows.first()).toContainText('Comment Added');
});

test('triage disposition updates a log status end-to-end', async ({ page }) => {
  const firstRow = page.locator('.logs-section tbody tr').first();
  await expect(firstRow).toContainText('captured');

  await firstRow.getByRole('button', { name: 'Triage' }).click();
  const modal = page.locator('.modal-content');
  await expect(modal).toContainText('Log Triage Disposition');
  await expect(modal).toContainText('evt-jira-0002');

  await modal.locator('select').selectOption('escalated');
  await modal.locator('textarea').fill('Escalating for supervisory review.');
  await modal.getByRole('button', { name: 'Submit Disposition' }).click();

  // Modal closes, logs are refetched, and the row shows the new status
  await expect(page.locator('.modal-content')).toHaveCount(0);
  await expect(firstRow).toContainText('escalated');
});

test('chain integrity verification reports an intact hash chain', async ({ page }) => {
  await page.getByRole('button', { name: /Chain Integrity/ }).click();
  await page.getByRole('button', { name: /Run Cryptographic Verification/ }).click();

  const alert = page.locator('.alert-success');
  await expect(alert).toContainText('Hash Chain Integrity Verified');
  await expect(alert).toContainText('All 2 records');
  await expect(alert).toContainText('e3b0c44298fc1c14'); // head hash prefix

  // Sealed daily digests table renders the anchored digest
  await expect(page.getByText('Sealed Daily Digests')).toBeVisible();
  await expect(page.locator('.badge', { hasText: 'verified' })).toBeVisible();
});
