import { and, eq } from 'drizzle-orm';
import { followUps, purchases, medicineSupplies } from '../db/schema';
import { followInput } from '@/lib/validation';
import { pharmacyToday } from '@/lib/dates';
import { mutation, ensure, versionCheck, bump, type Actor } from './core';
import { recordFollowEvent } from './purchases';
export async function followCommand(a: Actor, requestId: string, raw: unknown) {
  const v = followInput.parse(raw);
  return mutation(a, requestId, 'follow.' + v.action, v, async (tx) => {
    const [f] = await tx
      .select()
      .from(followUps)
      .where(and(eq(followUps.id, v.id), eq(followUps.pharmacyId, a.pharmacyId)));
    ensure(f, 'Follow-up not found');
    versionCheck(f.version, v.version);
    const [p] = await tx.select().from(purchases).where(eq(purchases.id, f.purchaseId));
    const [supply] = f.supplyId
      ? await tx.select().from(medicineSupplies).where(eq(medicineSupplies.id, f.supplyId))
      : [];
    ensure(
      p.status === 'active' &&
        (supply ? supply.included && supply.reminderEnabled && !f.pausedState : p.reminderEnabled),
      'Only the current active medicine supply with reminders enabled can be followed up',
    );
    const today = pharmacyToday();
    let patch: Partial<typeof followUps.$inferInsert> = {};
    if (v.action === 'reopen') {
      ensure(f.status === 'closed', 'Follow-up is already open');
      ensure(v.note && v.date && v.date >= today, 'Provide a reason and a date of today or later');
      patch = {
        status: 'open',
        nextDate: v.date,
        closedAt: null,
        closedReason: null,
        resolvingPurchaseId: null,
      };
    } else {
      ensure(f.status === 'open', 'Follow-up is already closed');
      if (v.action === 'contact') {
        if (v.date) ensure(v.date >= today, 'Next contact cannot be in the past');
        patch = {
          lastContactedAt: new Date(),
          // Without a next appointment, keep this in Needs attention awaiting a refill,
          // including when the owner contacts someone ahead of their scheduled date.
          nextDate: v.date || (f.nextDate > today ? today : f.nextDate),
        };
      }
      if (v.action === 'snooze') {
        ensure(v.date && v.date > today, 'Choose a future date');
        patch = { nextDate: v.date };
      }
      if (v.action === 'close') {
        ensure(v.reason, 'Choose a closure reason');
        ensure(v.reason !== 'other' || v.note, 'Add a note for Other');
        patch = {
          status: 'closed',
          closedAt: new Date(),
          closedReason: v.reason,
          resolvingPurchaseId: null,
        };
      }
    }
    await tx
      .update(followUps)
      .set({ ...patch, version: bump })
      .where(eq(followUps.id, f.id));
    await recordFollowEvent(tx, a, f, v.action, v.note, patch);
    return { id: f.id };
  });
}
