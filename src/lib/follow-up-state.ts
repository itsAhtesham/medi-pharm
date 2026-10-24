import { pharmacyToday } from './dates';

export function followUpState(
  follow: { status: string; nextDate: string; lastContactedAt: Date | string | null },
  today = pharmacyToday(),
) {
  const contactedOn = follow.lastContactedAt
    ? pharmacyToday(new Date(follow.lastContactedAt))
    : null;
  const open = follow.status === 'open';
  const scheduled = open && follow.nextDate > today;
  // A later contact date becoming due asks for another call. Recording that call
  // resets this comparison, so the button immediately acknowledges the contact.
  const followAgain = !!(
    open &&
    contactedOn &&
    follow.nextDate > contactedOn &&
    follow.nextDate <= today
  );
  const awaitingRefill = open && !!contactedOn && !scheduled && !followAgain;
  const label = !open
    ? 'Closed'
    : awaitingRefill
      ? 'Contacted · Awaiting refill'
      : scheduled
        ? 'Scheduled'
        : followAgain
          ? 'Follow up again'
          : follow.nextDate < today
            ? 'Overdue'
            : 'Due today';
  return { contactedOn, scheduled, followAgain, awaitingRefill, label };
}
