import { and, eq, inArray, or } from 'drizzle-orm';
import {
  customers,
  medicines,
  purchases,
  purchaseItems,
  followUps,
  followUpEvents,
} from '../db/schema';
import type { Tx } from '../db';
import { purchaseInput, type PurchaseInput } from '@/lib/validation';
import { pharmacyToday, reminderDates } from '@/lib/dates';
import { mutation, ensure, versionCheck, audit, bump, type Actor } from './core';
type Follow = typeof followUps.$inferSelect;
async function event(
  tx: Tx,
  a: Actor,
  f: Follow,
  action: string,
  note: string,
  after: Record<string, unknown>,
) {
  await tx.insert(followUpEvents).values({
    pharmacyId: a.pharmacyId,
    actorId: a.id,
    followUpId: f.id,
    action,
    note,
    before: {
      status: f.status,
      nextDate: f.nextDate,
      resolvingPurchaseId: f.resolvingPurchaseId,
      closedReason: f.closedReason,
    },
    after,
  });
}
export async function reverseResolution(tx: Tx, a: Actor, f: Follow, reason: string) {
  const [source] = await tx
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, f.purchaseId), eq(purchases.pharmacyId, a.pharmacyId)));
  ensure(source, 'Source purchase not found');
  const eligible = source.status === 'active' && source.reminderEnabled;
  const patch = {
    status: eligible ? ('open' as const) : ('closed' as const),
    nextDate: eligible ? pharmacyToday() : f.nextDate,
    closedAt: eligible ? null : new Date(),
    closedReason: eligible
      ? null
      : source.status === 'cancelled'
        ? 'purchase_cancelled'
        : 'reminder_disabled',
    resolvingPurchaseId: null,
  };
  await tx
    .update(followUps)
    .set({ ...patch, version: bump })
    .where(eq(followUps.id, f.id));
  await event(tx, a, f, 'completion_reversed', reason, patch);
}
export async function saveItems(
  tx: Tx,
  a: Actor,
  purchaseId: string,
  v: Pick<PurchaseInput, 'items'>,
  existing?: (typeof purchaseItems.$inferSelect)[],
) {
  const selected = await tx
    .select()
    .from(medicines)
    .where(
      and(
        eq(medicines.pharmacyId, a.pharmacyId),
        inArray(
          medicines.id,
          v.items.map((i) => i.medicineId),
        ),
      ),
    );
  const rows = v.items.map((item, position) => {
    const m = selected.find((m) => m.id === item.medicineId);
    const prior = existing?.find((i) => i.medicineId === item.medicineId);
    ensure(m && (!m.archivedAt || prior), 'Select active medicines from this pharmacy');
    return {
      pharmacyId: a.pharmacyId,
      purchaseId,
      medicineId: m.id,
      name: prior?.name ?? m.name,
      strength: prior?.strength ?? m.strength,
      form: prior?.form ?? m.form,
      quantity: String(item.quantity),
      unit: item.unit,
      position,
    };
  });
  await tx.delete(purchaseItems).where(eq(purchaseItems.purchaseId, purchaseId));
  await tx.insert(purchaseItems).values(rows);
  return rows;
}
export async function savePurchase(a: Actor, requestId: string, raw: unknown) {
  if (raw && typeof raw === 'object' && 'supplies' in raw) {
    const { saveMedicinePurchase } = await import('./medicine-supplies');
    return saveMedicinePurchase(a, requestId, raw);
  }
  const v = purchaseInput.parse(raw);
  return mutation(a, requestId, 'purchase.save', v, async (tx) => {
    const [customer] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, v.customerId), eq(customers.pharmacyId, a.pharmacyId)));
    ensure(customer, 'Customer not found');
    const [old] = v.id
      ? await tx
          .select()
          .from(purchases)
          .where(and(eq(purchases.id, v.id), eq(purchases.pharmacyId, a.pharmacyId)))
      : [];
    if (v.id) {
      ensure(old, 'Purchase not found');
      versionCheck(old.version, v.version);
      ensure(old.status === 'active', 'Cancelled purchases cannot be edited');
      ensure(old.supplyModel === 'legacy', 'Reload this purchase to edit its medicine supplies');
    }
    ensure(
      !customer.archivedAt || old?.customerId === customer.id,
      'Restore this customer before recording a purchase',
    );
    const dates = v.reminderEnabled ? reminderDates(v.supplyStart!, v.supplyDays!) : null;
    const data = {
      customerId: v.customerId,
      purchaseDate: v.purchaseDate,
      notes: v.notes,
      reminderEnabled: v.reminderEnabled,
      supplyStart: v.reminderEnabled ? v.supplyStart! : null,
      supplyDays: v.reminderEnabled ? v.supplyDays! : null,
      runOutDate: dates?.runOutDate ?? null,
      updatedBy: a.id,
      updatedAt: new Date(),
    };
    const [oldFollow] = old
      ? await tx.select().from(followUps).where(eq(followUps.purchaseId, old.id))
      : [];
    const oldItems = old
      ? await tx.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, old.id))
      : [];
    if (old) {
      ensure(
        (v.refillOf ?? null) === old.refillOf,
        'Use the explicit detach action to correct refill relationships',
      );
      if (old.customerId !== v.customerId) {
        const [child] = await tx
          .select({ id: purchases.id })
          .from(purchases)
          .where(eq(purchases.refillOf, old.id))
          .limit(1);
        ensure(
          !old.refillOf && !child,
          'Detach existing refill links before changing the customer',
        );
      }
      const signature = (
        items: { medicineId: string; quantity: string | number; unit: string }[],
      ) =>
        items
          .map((i) => `${i.medicineId}:${Number(i.quantity)}:${i.unit}`)
          .sort()
          .join('|');
      const relevant =
        signature(oldItems) !== signature(v.items) ||
        old.supplyStart !== data.supplyStart ||
        old.supplyDays !== data.supplyDays;
      if (relevant) {
        const resolved = await tx
          .select()
          .from(followUps)
          .where(
            and(
              eq(followUps.pharmacyId, a.pharmacyId),
              or(eq(followUps.resolvingPurchaseId, old.id), eq(followUps.purchaseId, old.id)),
            ),
          );
        for (const f of resolved.filter((f) => f.resolvingPurchaseId)) {
          ensure(
            v.completionChoice,
            'Choose Keep completed or Reverse completion for this correction',
          );
          if (v.completionChoice === 'reverse') await reverseResolution(tx, a, f, v.reason);
          else
            await event(tx, a, f, 'completion_confirmed', v.reason, {
              resolvingPurchaseId: f.resolvingPurchaseId,
            });
        }
      }
    }
    const [source] =
      !old && v.refillOf
        ? await tx
            .select()
            .from(purchases)
            .where(and(eq(purchases.id, v.refillOf), eq(purchases.pharmacyId, a.pharmacyId)))
        : [];
    let sourceFollow: Follow | undefined;
    if (!old && v.refillOf) {
      ensure(
        source && source.customerId === v.customerId && source.status === 'active',
        'A refill must link to an active purchase for the same customer',
      );
      [sourceFollow] = await tx.select().from(followUps).where(eq(followUps.purchaseId, source.id));
      ensure(sourceFollow, 'Source has no follow-up');
      versionCheck(sourceFollow.version, v.sourceVersion);
      if (v.completePrevious)
        ensure(
          sourceFollow.status === 'open' && source.reminderEnabled,
          'The previous follow-up is no longer open',
          'CONFLICT',
        );
    }
    ensure(!v.completePrevious || !!source, 'Select a source purchase to complete');
    const [saved] = old
      ? await tx
          .update(purchases)
          .set({ ...data, version: bump })
          .where(eq(purchases.id, old.id))
          .returning()
      : await tx
          .insert(purchases)
          .values({
            ...data,
            pharmacyId: a.pharmacyId,
            createdBy: a.id,
            refillOf: source?.id ?? null,
          })
          .returning();
    const savedItems = await saveItems(tx, a, saved.id, v, oldItems);
    // Re-read after explicit completion reversal so subsequent schedule changes preserve it.
    const [current] = oldFollow
      ? await tx.select().from(followUps).where(eq(followUps.id, oldFollow.id))
      : [];
    if (v.reminderEnabled) {
      const next = v.manualDate || dates!.calculatedDate;
      ensure(next, 'Choose a reminder date');
      if (!current) {
        const [f] = await tx
          .insert(followUps)
          .values({
            pharmacyId: a.pharmacyId,
            purchaseId: saved.id,
            calculatedDate: dates!.calculatedDate,
            manualDate: v.manualDate || null,
            nextDate: next,
          })
          .returning();
        await event(tx, a, f, 'created', '', { nextDate: next });
      } else {
        const scheduleChanged =
          old!.supplyStart !== data.supplyStart ||
          old!.supplyDays !== data.supplyDays ||
          (v.manualDate || null) !== current.manualDate;
        const [touch] = await tx
          .select({ id: followUpEvents.id })
          .from(followUpEvents)
          .where(
            and(
              eq(followUpEvents.followUpId, current.id),
              inArray(followUpEvents.action, ['contact', 'snooze']),
            ),
          )
          .limit(1);
        if (scheduleChanged && touch)
          ensure(
            v.scheduleChoice,
            'Choose whether to keep the next action date or use the new reminder date',
          );
        const reopen =
          current.status === 'closed' &&
          current.closedReason === 'reminder_disabled' &&
          v.reopenDisabled;
        if (reopen)
          ensure(
            v.reopenDate && v.reopenDate >= pharmacyToday(),
            'Choose a reopening date of today or later',
          );
        const patch = {
          calculatedDate: dates!.calculatedDate,
          manualDate: v.manualDate || null,
          nextDate: reopen
            ? v.reopenDate!
            : scheduleChanged && v.scheduleChoice !== 'keep' && current.status === 'open'
              ? next
              : current.nextDate,
          ...(reopen
            ? {
                status: 'open' as const,
                closedAt: null,
                closedReason: null,
                resolvingPurchaseId: null,
              }
            : {}),
        };
        await tx
          .update(followUps)
          .set({ ...patch, version: bump })
          .where(eq(followUps.id, current.id));
        await event(tx, a, current, reopen ? 'reopened' : 'schedule_updated', v.reason, patch);
      }
    } else if (current) {
      const patch =
        current.status === 'open'
          ? {
              status: 'closed' as const,
              closedAt: new Date(),
              closedReason: 'reminder_disabled',
              resolvingPurchaseId: null,
            }
          : {};
      await tx
        .update(followUps)
        .set({ ...patch, version: bump })
        .where(eq(followUps.id, current.id));
      await event(tx, a, current, 'reminder_disabled', v.reason, patch);
    }
    if (sourceFollow && v.completePrevious) {
      const patch = {
        status: 'closed' as const,
        closedAt: new Date(),
        closedReason: 'refilled',
        resolvingPurchaseId: saved.id,
      };
      await tx
        .update(followUps)
        .set({ ...patch, version: bump })
        .where(eq(followUps.id, sourceFollow.id));
      await event(tx, a, sourceFollow, 'refilled', v.notes, {
        resolvingPurchaseId: saved.id,
        status: 'closed',
      });
    }
    await audit(tx, a, 'purchase', saved.id, old ? 'corrected' : 'created', v.reason, {
      before: old
        ? {
            customerId: old.customerId,
            purchaseDate: old.purchaseDate,
            reminderEnabled: old.reminderEnabled,
            supplyStart: old.supplyStart,
            supplyDays: old.supplyDays,
            items: oldItems.map((i) => ({
              medicineId: i.medicineId,
              name: i.name,
              strength: i.strength,
              quantity: i.quantity,
              unit: i.unit,
            })),
          }
        : null,
      after: {
        customerId: saved.customerId,
        purchaseDate: saved.purchaseDate,
        reminderEnabled: saved.reminderEnabled,
        supplyStart: saved.supplyStart,
        supplyDays: saved.supplyDays,
        items: savedItems.map((i) => ({
          name: i.name,
          strength: i.strength,
          quantity: i.quantity,
          unit: i.unit,
        })),
      },
    });
    return { id: saved.id };
  });
}
export async function purchaseCommand(
  a: Actor,
  requestId: string,
  v: { id: string; version: number; action: 'cancel' | 'detach'; reason: string },
) {
  ensure(v.reason?.trim(), 'A reason is required');
  ensure(v.action === 'cancel' || v.action === 'detach', 'Unknown action');
  return mutation(a, requestId, 'purchase.' + v.action, v, async (tx) => {
    const [p] = await tx
      .select()
      .from(purchases)
      .where(and(eq(purchases.id, v.id), eq(purchases.pharmacyId, a.pharmacyId)));
    ensure(p, 'Purchase not found');
    versionCheck(p.version, v.version);
    if (p.supplyModel === 'medicine') {
      ensure(v.action === 'cancel', 'Medicine refills are corrected through their supply choices');
      ensure(p.status === 'active', 'Purchase is already cancelled');
      const { cancelMedicinePurchase } = await import('./medicine-supplies');
      await cancelMedicinePurchase(tx, a, p, v.reason);
      await audit(tx, a, 'purchase', p.id, 'cancel', v.reason);
      return { id: p.id };
    }
    if (v.action === 'cancel') {
      ensure(p.status === 'active', 'Purchase is already cancelled');
      await tx
        .update(purchases)
        .set({ status: 'cancelled', version: bump, updatedBy: a.id, updatedAt: new Date() })
        .where(eq(purchases.id, p.id));
      const [own] = await tx.select().from(followUps).where(eq(followUps.purchaseId, p.id));
      if (own) {
        const patch =
          own.status === 'open'
            ? {
                status: 'closed' as const,
                closedAt: new Date(),
                closedReason: 'purchase_cancelled',
                resolvingPurchaseId: null,
              }
            : {};
        await tx
          .update(followUps)
          .set({ ...patch, version: bump })
          .where(eq(followUps.id, own.id));
        await event(tx, a, own, 'purchase_cancelled', v.reason, patch);
      }
      const resolved = await tx
        .select()
        .from(followUps)
        .where(eq(followUps.resolvingPurchaseId, p.id));
      for (const f of resolved) await reverseResolution(tx, a, f, v.reason);
    } else {
      const children = await tx.select().from(purchases).where(eq(purchases.refillOf, p.id));
      const links = [...children, ...(p.refillOf ? [p] : [])];
      ensure(links.length, 'No refill links to detach');
      for (const linked of links) {
        const resolved = await tx
          .select()
          .from(followUps)
          .where(eq(followUps.resolvingPurchaseId, linked.id));
        for (const f of resolved) await reverseResolution(tx, a, f, v.reason);
        await tx
          .update(purchases)
          .set({ refillOf: null, version: bump, updatedBy: a.id, updatedAt: new Date() })
          .where(eq(purchases.id, linked.id));
        await audit(tx, a, 'purchase', linked.id, 'refill_detached', v.reason, {
          previousSource: linked.refillOf,
        });
      }
      if (!links.some((x) => x.id === p.id))
        await tx.update(purchases).set({ version: bump }).where(eq(purchases.id, p.id));
    }
    await audit(tx, a, 'purchase', p.id, v.action, v.reason);
    return { id: p.id };
  });
}
export { event as recordFollowEvent };
