export const TIMEZONE = 'Asia/Kolkata';
export function pharmacyToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1900 || y > 9998) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
export function addDays(value: string, days: number): string {
  if (!isDate(value) || !Number.isInteger(days)) throw new Error('Invalid calendar date');
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
export function reminderDates(start: string, days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 365)
    throw new Error('Supply must be 1–365 whole days');
  const runOutDate = addDays(start, days);
  const leadDays = days === 1 ? null : Math.min(7, Math.max(1, Math.floor(days * 0.25 + 0.5)));
  return {
    runOutDate,
    lastCoveredDate: addDays(runOutDate, -1),
    leadDays,
    calculatedDate: leadDays === null ? null : addDays(runOutDate, -leadDays),
  };
}
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
