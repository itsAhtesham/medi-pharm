import { describe, it, expect, vi, afterEach } from 'vitest';
import { addDays, reminderDates, pharmacyToday, isDate } from '../src/lib/dates';
import { purchaseInput, password, normalizePhone, customerInput } from '../src/lib/validation';
import { csvCell } from '../src/lib/csv';
const base = {
  customerId: 'fdf16459-48b3-475c-b019-c4f26f844c5a',
  purchaseDate: '2026-11-01',
  items: [{ medicineId: 'a0dd1e53-24f6-45c9-9654-419159c4070e', quantity: 1, unit: 'strips' }],
  reminderEnabled: true,
  supplyStart: '2026-11-01',
  supplyDays: 30,
};
afterEach(() => vi.useRealTimers());
describe('calendar dates', () => {
  it.each([
    [2, 1],
    [3, 1],
    [7, 2],
    [10, 3],
    [15, 4],
    [26, 7],
    [30, 7],
    [45, 7],
    [60, 7],
    [90, 7],
    [365, 7],
  ])('calculates %i days with %i lead', (days, lead) =>
    expect(reminderDates('2026-11-01', days).leadDays).toBe(lead),
  );
  it('keeps the exclusive end and November example', () =>
    expect(reminderDates('2026-11-01', 30)).toMatchObject({
      runOutDate: '2026-12-01',
      lastCoveredDate: '2026-11-30',
      calculatedDate: '2026-11-24',
    }));
  it('handles leap day, year and month boundaries', () => {
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(isDate('2026-02-29')).toBe(false);
  });
  it('uses Kolkata midnight irrespective of process timezone', () => {
    expect(pharmacyToday(new Date('2026-11-23T18:45:00Z'))).toBe('2026-11-24');
    expect(pharmacyToday(new Date('2026-11-23T18:29:59Z'))).toBe('2026-11-23');
  });
  it.each([0, -1, 1.5, 366])('rejects invalid duration %i', (days) =>
    expect(() => reminderDates('2026-11-01', days)).toThrow(),
  );
});
describe('purchase validation', () => {
  function parse(extra: Record<string, unknown>) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T00:00:00Z'));
    return purchaseInput.safeParse({ ...base, ...extra });
  }
  it('requires manual confirmation for one day', () => {
    expect(parse({ supplyDays: 1 }).success).toBe(false);
    expect(parse({ supplyDays: 1, manualDate: '2026-11-01', oneDayConfirmed: true }).success).toBe(
      true,
    );
  });
  it('accepts no duration without reminder', () =>
    expect(
      parse({ reminderEnabled: false, supplyDays: undefined, supplyStart: undefined }).success,
    ).toBe(true));
  it('accepts future supply start, rejects future purchase', () => {
    expect(parse({ supplyStart: '2026-12-01' }).success).toBe(true);
    expect(parse({ purchaseDate: '2026-12-01' }).success).toBe(false);
  });
  it('returns validation errors for malformed calendar dates', () => {
    expect(parse({ supplyStart: '2026-13-40', manualDate: '2026-11-20' }).success).toBe(false);
  });
  it('requires explicit confirmation for late follow-up', () => {
    expect(parse({ manualDate: '2026-12-02' }).success).toBe(false);
    expect(parse({ manualDate: '2026-12-02', lateConfirmed: true }).success).toBe(true);
  });
  it('supports mixed units but rejects duplicate medicine/unit', () => {
    expect(parse({ items: [...base.items, { ...base.items[0], unit: 'tablets' }] }).success).toBe(
      true,
    );
    expect(parse({ items: [...base.items, ...base.items] }).success).toBe(false);
  });
});
describe('credentials, phone and export', () => {
  it.each([14, 129])('rejects password length %i', (n) =>
    expect(password.safeParse('a'.repeat(n)).success).toBe(false),
  );
  it.each([15, 128])('accepts password length %i', (n) =>
    expect(password.safeParse('😀'.repeat(n)).success).toBe(true),
  );
  it('preserves spaces', () =>
    expect(password.parse('  a long passphrase  ')).toBe('  a long passphrase  '));
  it('requires phones and accepts shared format', () => {
    expect(customerInput.safeParse({ name: 'Asha', phone: '' }).success).toBe(false);
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+1 (202) 555-0101')).toBe('+12025550101');
  });
  it.each(['=HYPERLINK("x")', '+SUM(A1)', '-1+2', '@SUM(A1)', '\t=cmd', '   =cmd'])(
    'neutralizes spreadsheet formula %s',
    (v) => expect(csvCell(v)).toMatch(/^"'/),
  );
});
