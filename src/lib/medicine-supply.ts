import { addDays, isDate } from './dates';

export function daysBetween(start: string, end: string) {
  if (!isDate(start) || !isDate(end)) throw new Error('Invalid calendar date');
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000);
}
export function medicineDates(start: string, newDays: number, remainingDays = 0) {
  if (
    !Number.isInteger(newDays) ||
    newDays < 1 ||
    newDays > 365 ||
    !Number.isInteger(remainingDays) ||
    remainingDays < 0
  )
    throw new Error('Enter 1–365 whole days of new supply and a valid remaining supply');
  const leadDays = Math.min(7, Math.max(1, Math.floor(newDays * 0.25 + 0.5)));
  const runOutDate = addDays(start, newDays + remainingDays);
  if (!isDate(runOutDate)) throw new Error('Supply extends beyond the supported calendar');
  return { leadDays, runOutDate, calculatedDate: addDays(runOutDate, -leadDays) };
}
