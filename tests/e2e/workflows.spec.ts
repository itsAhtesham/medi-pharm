import { test, expect, type Page, type Locator } from '@playwright/test';
import { format, parse, isValid } from 'date-fns';
import { Pool } from 'pg';
import { pharmacyToday, addDays, formatDate } from '../../src/lib/dates';
test.describe.configure({ mode: 'serial' });
async function chooseDate(page: Page, trigger: Locator, value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const targetMonth = format(target, 'LLLL yyyy');
  await trigger.click();
  const calendar = page.getByRole('dialog', { name: 'Choose date', exact: true });
  const grid = calendar.getByRole('grid');
  await expect(calendar).toBeVisible();
  // Navigate the visible calendar, including when a relative date crosses a month/year.
  for (let step = 0; step < 24; step++) {
    const currentLabel = await grid.getAttribute('aria-label');
    if (currentLabel === targetMonth) break;
    const currentMonth = parse(currentLabel ?? '', 'LLLL yyyy', target);
    expect(isValid(currentMonth)).toBe(true);
    await calendar
      .getByRole('button', {
        name: currentMonth > target ? 'Go to the Previous Month' : 'Go to the Next Month',
        exact: true,
      })
      .click();
    await expect(grid).not.toHaveAttribute('aria-label', currentLabel!);
  }
  await expect(grid).toHaveAttribute('aria-label', targetMonth);
  const dateName = format(target, 'PPPP').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await grid
    .getByRole('button', { name: new RegExp(`^(?:Today, )?${dateName}(?:, selected)?$`) })
    .click();
  await expect(calendar).not.toBeVisible();
  await expect(trigger).toHaveText(formatDate(value));
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A good day to care.' })).toBeVisible();
}
test('purchase, follow-up, refill, correction and export journey', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Add purchase', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Add purchase' })).toBeVisible();
  await page.getByLabel('Notes (optional)').fill('Keep this draft while adding records');
  let dropped = false;
  await page.route('**/purchases/new', async (route) => {
    const request = route.request();
    if (!dropped && request.method() === 'POST' && request.postData()?.includes('customer.save')) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Add customer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Asha Browser Test');
  await dialog.getByLabel('Phone number').fill('+12025550123');
  await dialog.getByRole('button', { name: 'Save customer' }).click();
  await expect(dialog.getByRole('button', { name: 'Retry original save' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Retry original save' }).click();
  await page.unroute('**/purchases/new');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('Notes (optional)')).toHaveValue(
    'Keep this draft while adding records',
  );
  await page.getByRole('button', { name: 'Add medicine', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Browser medicine');
  await dialog.getByLabel('Strength').fill('500 mg');
  await dialog.getByLabel('Form', { exact: true }).fill('Tablet');
  await dialog.getByRole('button', { name: 'Save medicine' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('Follow up for this medicine')).not.toBeChecked();
  await chooseDate(
    page,
    page.getByLabel('Purchase date', { exact: true }),
    addDays(pharmacyToday(), -23),
  );
  await page.getByLabel('Follow up for this medicine').check();
  await chooseDate(
    page,
    page.getByLabel('Supply starts', { exact: true }),
    addDays(pharmacyToday(), -23),
  );
  await page.getByLabel('New days of supply').fill('30');
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await expect(page).toHaveURL(/\/purchases\/[a-f0-9-]+$/);
  await expect(page.getByRole('heading', { name: /Purchase MP-/ })).toBeVisible();
  const sourceUrl = page.url();
  await page.getByRole('button', { name: 'Mark contacted' }).click();
  await dialog.getByLabel('Contact note').fill('Customer will visit tomorrow');
  const nextContact = page.getByLabel('When should we follow up again? (optional)', {
    exact: true,
  });
  await chooseDate(page, nextContact, addDays(pharmacyToday(), 1));
  await nextContact.click();
  await page
    .getByRole('dialog', { name: 'Choose date', exact: true })
    .getByRole('button', { name: 'Clear date' })
    .click();
  await expect(nextContact).toHaveText('Select date');
  await dialog.getByRole('button', { name: 'Save contact' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Customer will visit tomorrow')).toBeVisible();
  await expect(page.getByText('Contacted today', { exact: true })).toBeVisible();
  await expect(page.getByText('Awaiting refill', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark contacted', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Record refill', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Follow-up actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Record another contact' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Remind later' }).click();
  await chooseDate(
    page,
    page.getByLabel('Next follow-up date', { exact: true }),
    addDays(pharmacyToday(), 1),
  );
  await dialog.getByRole('button', { name: 'Save follow-up' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('link', { name: 'Record refill', exact: true }).click();
  await expect(page.getByLabel('Follow up for this medicine')).not.toBeChecked();
  await page.getByLabel('New days of supply').fill('11');
  await page.getByLabel('How should this purchase affect supply?').click();
  await page.getByRole('option', { name: 'Add to remaining supply', exact: true }).click();
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await expect(page).toHaveURL(/\/purchases\/[a-f0-9-]+$/);
  const refillUrl = page.url();
  await page.goto(sourceUrl);
  await expect(page.getByText('refilled', { exact: true }).first()).toBeVisible();
  await page.goto(refillUrl);
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
  await dialog.getByLabel('Reason', { exact: true }).fill('Erroneous refill');
  await dialog.getByRole('button', { name: 'Confirm cancel' }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto(sourceUrl);
  await expect(page.getByText('Contacted today', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Record refill', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Mark contacted', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Follow-up actions' }).click();
  await page.getByRole('menuitem', { name: 'Close follow-up' }).click();
  await dialog.getByLabel('Reason', { exact: true }).selectOption('declined');
  await dialog.getByRole('button', { name: 'Save follow-up' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Reopen follow-up' }).click();
  await dialog.getByLabel('Reason for reopening').fill('Closed by mistake');
  await dialog.getByRole('button', { name: 'Save follow-up' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('link', { name: 'Correct purchase' }).click();
  await page.getByLabel('Notes (optional)').fill('Corrected purchase note');
  await page.getByLabel('Reason for correction').fill('Add missing context');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page).toHaveURL(/\/purchases\/[a-f0-9-]+$/);
  await expect(page.getByText('Corrected purchase note', { exact: true })).toBeVisible();
  const response = await page.request.get('/api/exports?kind=purchases');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('Corrected purchase note');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Customers to contact' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/dashboard-desktop.png',
    fullPage: true,
    caret: 'initial',
  });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/login');
  expect((await page.request.get('/api/exports?kind=customers')).status()).toBe(401);
});
test('session expiry preserves a purchase draft and safely retries after reauthentication', async ({
  page,
}) => {
  await login(page);
  await page.goto('/purchases/new');
  await page.getByRole('button', { name: 'Select customer', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Asha Browser Test/ })
    .click();
  await page.getByRole('button', { name: 'Select medicine', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Browser medicine/ })
    .click();
  await page.getByLabel('Notes (optional)').fill('Draft survives expired session');
  await page.getByLabel('New days of supply').fill('1');
  await page.getByLabel('How should this purchase affect supply?').click();
  await page
    .getByRole('option', { name: 'Start fresh from the supply start date', exact: true })
    .click();
  await page.getByLabel('Follow up for this medicine').check();
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    await pool.query('UPDATE sessions SET revoked_at=now()');
  } finally {
    await pool.end();
  }
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await expect(page.getByLabel('Notes (optional)')).toHaveValue('Draft survives expired session');
  await dialog.getByLabel('Email address').fill('owner@example.test');
  await dialog.getByLabel('Password', { exact: true }).fill(process.env.E2E_PASSWORD!);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/purchases\/[a-f0-9-]+$/);
  await expect(page.getByText('Draft survives expired session', { exact: true })).toBeVisible();
});
test('medicine history groups repeat purchases and preserves dated snapshots, mixed units, and pagination', async ({
  page,
}) => {
  await login(page);
  await page.goto('/customers');
  await page.getByRole('link', { name: 'Asha Browser Test', exact: true }).click();
  await expect(page).toHaveURL(/\/customers\/[a-f0-9-]+$/);
  const customerUrl = page.url();
  const summary = page.getByRole('table', { name: 'Medicine history', exact: true });
  const history = page.getByRole('table', { name: 'Medicine purchase dates', exact: true });
  const purchases = page.getByRole('table', { name: 'Purchase history', exact: true });
  await expect(purchases.getByRole('columnheader', { name: 'Medicines bought' })).toHaveCount(0);
  await expect(summary.locator('tbody tr')).toHaveCount(1);
  await expect(summary).toContainText('2 purchases');
  await expect(summary).toContainText('1 cancelled');
  await summary.getByRole('link', { name: 'View dates & quantities' }).click();
  await expect(page).toHaveURL(/\/medicines\/[a-f0-9-]+$/);
  const medicineUrl = page.url();
  await expect(history.locator('tbody tr')).toHaveCount(3);
  for (const row of await history.locator('tbody tr').all()) {
    await expect(row.getByText('Browser medicine · 500 mg', { exact: true })).toBeVisible();
    await expect(row.getByText('Tablet', { exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: '1', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'strips', exact: true })).toBeVisible();
  }
  await expect(history.locator('tbody tr').last()).toContainText(
    formatDate(addDays(pharmacyToday(), -23)),
  );
  await expect(history.locator('tbody tr').filter({ hasText: 'cancelled' })).toHaveCount(1);
  await page.goto('/medicines');
  await page
    .getByRole('row')
    .filter({ hasText: 'Browser medicine' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Renamed browser medicine');
  await dialog.getByRole('button', { name: 'Save medicine' }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto(medicineUrl);
  await expect(history.getByText('Browser medicine · 500 mg', { exact: true })).toHaveCount(3);
  await expect(history.getByText('Renamed browser medicine', { exact: false })).toHaveCount(0);
  await page.goto('/purchases/new');
  await page.getByRole('button', { name: 'Select customer', exact: true }).click();
  await dialog.getByRole('button', { name: /Asha Browser Test/ }).click();
  await page.getByRole('button', { name: 'Select medicine', exact: true }).click();
  await dialog.getByRole('button', { name: /Renamed browser medicine/ }).click();
  await page.getByRole('button', { name: 'Add another medicine' }).click();
  await page.getByRole('button', { name: 'Select medicine', exact: true }).click();
  await dialog.getByRole('button', { name: /Renamed browser medicine/ }).click();
  await page.getByLabel('Quantity', { exact: true }).nth(1).fill('2');
  await page.getByLabel('Unit', { exact: true }).nth(1).selectOption('tablets');
  await expect(page.getByLabel('New days of supply')).toHaveCount(1);
  await page.getByLabel('New days of supply').fill('1');
  await page.getByLabel('How should this purchase affect supply?').click();
  await page
    .getByRole('option', { name: 'Start fresh from the supply start date', exact: true })
    .click();
  await page.getByLabel('Follow up for this medicine').check();
  await page.getByRole('button', { name: 'Save purchase', exact: true }).click();
  await expect(page).toHaveURL(/\/purchases\/[a-f0-9-]+$/);
  await page.goto(customerUrl);
  await expect(purchases.locator('tbody tr')).toHaveCount(4);
  await expect(summary.locator('tbody tr')).toHaveCount(1);
  await expect(summary).toContainText('3 purchases');
  await summary.getByRole('link', { name: 'View dates & quantities' }).click();
  await expect(history.locator('tbody tr')).toHaveCount(5);
  const latest = history.locator('tbody tr').first();
  await expect(latest).toContainText(formatDate(pharmacyToday()));
  await expect(latest.getByRole('cell', { name: '1', exact: true })).toBeVisible();
  await expect(latest.getByRole('cell', { name: 'strips', exact: true })).toBeVisible();
  const second = history.locator('tbody tr').nth(1);
  await expect(second.getByRole('cell', { name: '2', exact: true })).toBeVisible();
  await expect(second.getByRole('cell', { name: 'tablets', exact: true })).toBeVisible();
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    const {
      rows: [owner],
    } = await pool.query('SELECT id,pharmacy_id FROM users LIMIT 1');
    const {
      rows: [medicine],
    } = await pool.query('SELECT id FROM medicines WHERE name=$1', ['Renamed browser medicine']);
    await pool.query(
      `WITH added AS (
      INSERT INTO purchases(pharmacy_id,customer_id,purchase_date,created_by,updated_by)
      SELECT $1,$2,$3::date,$4,$4 FROM generate_series(1,26)
      RETURNING id,pharmacy_id
    ) INSERT INTO purchase_items(pharmacy_id,purchase_id,medicine_id,name,strength,form,quantity,unit,position)
      SELECT pharmacy_id,id,$5,'Pagination medicine','500 mg','Tablet',1,'strips',0 FROM added`,
      [owner.pharmacy_id, customerUrl.split('/').pop(), pharmacyToday(), owner.id, medicine.id],
    );
  } finally {
    await pool.end();
  }
  await page.goto(customerUrl);
  await expect(purchases.locator('tbody tr')).toHaveCount(25);
  await expect(summary.locator('tbody tr')).toHaveCount(1);
  await expect(summary).toContainText('29 purchases');
  await expect(summary).toContainText('1 cancelled');
  await page.getByRole('link', { name: 'Next' }).click();
  await expect(purchases.locator('tbody tr')).toHaveCount(5);
  await expect(summary.locator('tbody tr')).toHaveCount(1);
  await summary.getByRole('link', { name: 'View dates & quantities' }).click();
  await expect(history.locator('tbody tr')).toHaveCount(25);
  await page.getByRole('link', { name: 'Next' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(history.locator('tbody tr')).toHaveCount(6);
  await expect(history.getByText('Browser medicine · 500 mg', { exact: true })).toHaveCount(3);
  await expect(history.getByText('Renamed browser medicine · 500 mg', { exact: true })).toHaveCount(
    2,
  );
});
test('dashboard shows a compact count and list; customer accordions have their own page', async ({
  page,
}) => {
  await login(page);
  const summary = page.getByRole('region', { name: 'Customers to contact' });
  await expect(summary.getByLabel('1 customers need attention')).toHaveText('1');
  await expect(summary.getByRole('table', { name: 'Follow-ups needing attention' })).toBeVisible();
  await expect(summary.locator('tbody tr')).toHaveCount(1);
  await expect(summary.getByRole('article')).toHaveCount(0);
  await summary.getByRole('link', { name: 'View all follow-ups' }).click();
  await expect(page).toHaveURL('/follow-ups');
  await expect(page.getByRole('heading', { name: 'Follow-ups', exact: true })).toBeVisible();
  const customerAccordion = page.getByRole('button', {
    name: 'Asha Browser Test follow-ups',
    exact: true,
  });
  await expect(customerAccordion).toHaveAttribute('aria-expanded', 'false');
  await customerAccordion.click();
  await page.getByRole('button', { name: 'Mark contacted' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Contact note').fill('Contacted from the dedicated follow-ups page');
  await dialog.getByRole('button', { name: 'Save contact' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Contacted today', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark contacted', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Record refill', exact: true })).toHaveCount(1);
  await page.getByText('View latest note', { exact: true }).click();
  await expect(
    page.getByText('Contacted from the dedicated follow-ups page', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Scheduled', exact: true }).click();
  await expect(page).toHaveURL('/follow-ups?tab=scheduled');
  await expect(page.getByText('No follow-ups here yet')).toBeVisible();
  await page.getByRole('link', { name: 'Needs attention', exact: true }).click();
  await expect(customerAccordion).toHaveAttribute('aria-expanded', 'false');
  await customerAccordion.click();
  await page.getByRole('button', { name: 'Follow-up actions' }).click();
  await page.getByRole('menuitem', { name: 'Record another contact', exact: true }).click();
  await chooseDate(
    page,
    page.getByLabel('When should we follow up again? (optional)', { exact: true }),
    addDays(pharmacyToday(), 1),
  );
  await dialog.getByLabel('Contact note').fill('Call again tomorrow');
  await dialog.getByRole('button', { name: 'Save contact', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(customerAccordion).toHaveCount(0);
  await page.getByRole('link', { name: 'Scheduled', exact: true }).click();
  await customerAccordion.click();
  await expect(page.getByText('Contacted today', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Record refill', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Mark contacted', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('mobile navigation fits the viewport and keyboard focus remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add customer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Phone number')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Customers to contact' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/dashboard-mobile.png',
    fullPage: true,
    caret: 'initial',
  });
});
