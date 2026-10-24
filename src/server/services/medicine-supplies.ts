import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db, type Tx } from '../db';
import {
  customers,
  purchases,
  purchaseItems,
  medicineSupplies,
  followUps,
  type PausedFollow,
} from '../db/schema';
import { medicinePurchaseInput } from '@/lib/validation';
import { medicineDates, daysBetween } from '@/lib/medicine-supply';
import { mutation, ensure, versionCheck, audit, bump, type Actor } from './core';
import { recordFollowEvent, saveItems } from './purchases';

type Connection = typeof db | Tx;
type Purchase = typeof purchases.$inferSelect;
type Follow = typeof followUps.$inferSelect;
async function supplyRows(cx: Connection, a: Actor, customerId: string, medicineId: string) {
  return cx
    .select({ supply: medicineSupplies, purchase: purchases, follow: followUps })
    .from(medicineSupplies)
    .innerJoin(purchases, eq(purchases.id, medicineSupplies.purchaseId))
    .leftJoin(followUps, eq(followUps.supplyId, medicineSupplies.id))
    .where(
      and(
        eq(medicineSupplies.pharmacyId, a.pharmacyId),
        eq(medicineSupplies.customerId, customerId),
        eq(medicineSupplies.medicineId, medicineId),
      ),
    )
    .orderBy(asc(purchases.purchaseDate), asc(purchases.sequence));
}
const revision = (rows: Awaited<ReturnType<typeof supplyRows>>) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        rows.map((r) => [r.supply.id, r.supply.version, r.purchase.version, r.follow?.version]),
      ),
    )
    .digest('hex');
export async function supplyContext(
  cx: Connection,
  a: Actor,
  customerId: string,
  medicineId: string,
  purchaseDate: string,
  editing?: Purchase,
) {
  const rows = await supplyRows(cx, a, customerId, medicineId);
  const before = rows.filter(
    (r) =>
      r.purchase.status === 'active' &&
      r.supply.included &&
      r.purchase.id !== editing?.id &&
      (r.purchase.purchaseDate < purchaseDate ||
        (r.purchase.purchaseDate === purchaseDate &&
          (!editing || r.purchase.sequence < editing.sequence))),
  );
  const previous = before.at(-1);
  let previousRunOut: string | null = null;
  for (const row of before) {
    const s = row.supply;
    const remaining: number =
      s.mode === 'replace'
        ? 0
        : (s.remainingOverride ??
          (previousRunOut ? Math.max(0, daysBetween(s.supplyStart, previousRunOut)) : 0));
    previousRunOut = medicineDates(s.supplyStart, s.supplyDays, remaining).runOutDate;
  }
  return {
    medicineId,
    revision: revision(rows),
    previousRunOut,
    previousStart: previous?.supply.supplyStart ?? null,
    previousPurchaseId: previous?.purchase.id ?? null,
  };
}
export type SupplyContext = Awaited<ReturnType<typeof supplyContext>>;
function snapshot(f: Follow): PausedFollow {
  return {
    status: f.status,
    nextDate: f.nextDate,
    closedReason: f.closedReason,
    closedAt: f.closedAt?.toISOString() ?? null,
    resolvingPurchaseId: f.resolvingPurchaseId,
  };
}
async function patchFollow(
  tx: Tx,
  a: Actor,
  f: Follow,
  patch: Partial<typeof followUps.$inferInsert>,
  action: string,
  reason: string,
) {
  const changed = Object.entries(patch).some(
    ([key, value]) => JSON.stringify(f[key as keyof Follow]) !== JSON.stringify(value),
  );
  if (!changed) return;
  await tx
    .update(followUps)
    .set({ ...patch, version: bump })
    .where(eq(followUps.id, f.id));
  await recordFollowEvent(tx, a, f, action, reason, patch);
}
// Rebuild only the affected customer's medicine chain. Later "start fresh" entries
// reset coverage; explicit remaining-day adjustments remain owner assertions.
export async function reconcileSupply(
  tx: Tx,
  a: Actor,
  customerId: string,
  medicineId: string,
  reason: string,
  options: { scheduleChoice?: 'keep' | 'recalculate'; reopenSupplyIds?: string[] } = {},
) {
  const rows = await supplyRows(tx, a, customerId, medicineId);
  const active = rows.filter((r) => r.supply.included && r.purchase.status === 'active');
  let previous: typeof medicineSupplies.$inferSelect | undefined;
  for (const row of active) {
    const s = row.supply;
    ensure(
      !previous || s.supplyStart >= previous.supplyStart,
      'Supply start dates must follow purchase order for this medicine. Correct the conflicting start date.',
    );
    const remainingUsed =
      s.mode === 'replace'
        ? 0
        : (s.remainingOverride ??
          (previous ? Math.max(0, daysBetween(s.supplyStart, previous.runOutDate)) : 0));
    const dates = medicineDates(s.supplyStart, s.supplyDays, remainingUsed);
    if (remainingUsed !== s.remainingUsed || dates.runOutDate !== s.runOutDate) {
      await tx
        .update(medicineSupplies)
        .set({ remainingUsed, runOutDate: dates.runOutDate, version: bump })
        .where(eq(medicineSupplies.id, s.id));
      await audit(tx, a, 'purchase', s.purchaseId, 'medicine_supply_recalculated', reason, {
        medicineId,
        before: { runOutDate: s.runOutDate, remainingUsed: s.remainingUsed },
        after: { runOutDate: dates.runOutDate, remainingUsed },
      });
      s.remainingUsed = remainingUsed;
      s.runOutDate = dates.runOutDate;
    }
    previous = s;
  }
  const current = active.at(-1);
  // Close superseded cycles before reopening the current one (unique open follow-up).
  for (const row of rows.filter((r) => r.supply.id !== current?.supply.id)) {
    const { supply: s, follow: f } = row;
    const next = active.find(
      (r) =>
        r.purchase.purchaseDate > row.purchase.purchaseDate ||
        (r.purchase.purchaseDate === row.purchase.purchaseDate &&
          r.purchase.sequence > row.purchase.sequence),
    );
    const closedReason =
      row.purchase.status === 'cancelled'
        ? 'purchase_cancelled'
        : !s.included
          ? 'medicine_removed'
          : 'refilled';
    const resolvingPurchaseId = closedReason === 'refilled' ? (next?.purchase.id ?? null) : null;
    if (f) {
      await patchFollow(
        tx,
        a,
        f,
        {
          status: 'closed',
          closedAt: f.closedAt ?? new Date(),
          closedReason,
          resolvingPurchaseId,
          pausedState: f.pausedState ?? snapshot(f),
        },
        closedReason,
        reason,
      );
    } else if (s.reminderEnabled) {
      const dates = medicineDates(s.supplyStart, s.supplyDays, s.remainingUsed);
      const nextDate = s.manualDate || dates.calculatedDate;
      const [created] = await tx
        .insert(followUps)
        .values({
          pharmacyId: a.pharmacyId,
          purchaseId: s.purchaseId,
          supplyId: s.id,
          customerId,
          medicineId,
          status: 'closed',
          calculatedDate: dates.calculatedDate,
          manualDate: s.manualDate,
          nextDate,
          closedAt: new Date(),
          closedReason,
          resolvingPurchaseId,
          pausedState: {
            status: 'open',
            nextDate,
            closedReason: null,
            closedAt: null,
            resolvingPurchaseId: null,
          },
        })
        .returning();
      await recordFollowEvent(tx, a, created, 'historical_supply_recorded', reason, {
        medicineId,
        runOutDate: s.runOutDate,
      });
    }
  }
  if (!current) return;
  const { supply: s, follow: f } = current;
  const dates = medicineDates(s.supplyStart, s.supplyDays, s.remainingUsed);
  const next = s.manualDate || dates.calculatedDate;
  if (!f) {
    if (!s.reminderEnabled) return;
    const [created] = await tx
      .insert(followUps)
      .values({
        pharmacyId: a.pharmacyId,
        purchaseId: s.purchaseId,
        supplyId: s.id,
        customerId,
        medicineId,
        calculatedDate: dates.calculatedDate,
        manualDate: s.manualDate,
        nextDate: next,
      })
      .returning();
    await recordFollowEvent(tx, a, created, 'medicine_reminder_created', reason, {
      medicineId,
      runOutDate: s.runOutDate,
      nextDate: next,
    });
    return;
  }
  const restored = f.pausedState;
  const state = restored ?? snapshot(f);
  let nextDate = state.nextDate;
  const wasAutomatic = state.nextDate === (f.manualDate || f.calculatedDate);
  if (wasAutomatic || options.scheduleChoice === 'recalculate') nextDate = next;
  const patch: Partial<typeof followUps.$inferInsert> = {
    customerId,
    medicineId,
    calculatedDate: dates.calculatedDate,
    manualDate: s.manualDate,
    nextDate,
    status: state.status,
    closedReason: state.closedReason,
    closedAt: state.closedAt ? new Date(state.closedAt) : null,
    resolvingPurchaseId: state.resolvingPurchaseId,
    pausedState: null,
  };
  if (!s.reminderEnabled && patch.status === 'open') {
    patch.status = 'closed';
    patch.closedReason = 'reminder_disabled';
    patch.closedAt = new Date();
    patch.resolvingPurchaseId = null;
  } else if (
    s.reminderEnabled &&
    patch.closedReason === 'reminder_disabled' &&
    options.reopenSupplyIds?.includes(s.id)
  ) {
    patch.status = 'open';
    patch.closedReason = null;
    patch.closedAt = null;
    patch.resolvingPurchaseId = null;
    patch.nextDate = next;
  }
  await patchFollow(
    tx,
    a,
    f,
    patch,
    restored ? 'medicine_supply_restored' : 'medicine_schedule_updated',
    reason,
  );
}
export async function saveMedicinePurchase(a: Actor, requestId: string, raw: unknown) {
  const v = medicinePurchaseInput.parse(raw);
  return mutation(a, requestId, 'purchase.save', v, async (tx) => {
    const [old] = v.id
      ? await tx
          .select()
          .from(purchases)
          .where(and(eq(purchases.pharmacyId, a.pharmacyId), eq(purchases.id, v.id)))
      : [];
    if (v.id) {
      ensure(old, 'Purchase not found');
      versionCheck(old.version, v.version);
      ensure(old.status === 'active', 'Cancelled purchases cannot be edited');
    }
    const [customer] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, v.customerId), eq(customers.pharmacyId, a.pharmacyId)));
    ensure(
      customer && (!customer.archivedAt || old?.customerId === customer.id),
      'Select an active customer',
    );
    if (old?.supplyModel === 'legacy') {
      ensure(
        v.convertLegacy,
        'Confirm individual medicine durations to convert this legacy purchase',
      );
      const [child] = await tx
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.refillOf, old.id))
        .limit(1);
      ensure(
        !old.refillOf && !child,
        'Detach the legacy refill links before converting this purchase',
      );
    }
    const oldSupplies = old
      ? await tx.select().from(medicineSupplies).where(eq(medicineSupplies.purchaseId, old.id))
      : [];
    const contexts = new Map<string, SupplyContext>();
    for (const s of v.supplies) {
      const context = await supplyContext(tx, a, customer.id, s.medicineId, v.purchaseDate, old);
      ensure(
        context.revision === s.expectedRevision,
        'Medicine supply changed. Refresh the supply estimates and review the refill choices before saving.',
        'CONFLICT',
      );
      contexts.set(s.medicineId, context);
    }
    const data = {
      customerId: customer.id,
      purchaseDate: v.purchaseDate,
      notes: v.notes,
      supplyModel: 'medicine',
      reminderEnabled: false,
      supplyStart: null,
      supplyDays: null,
      runOutDate: null,
      updatedBy: a.id,
      updatedAt: new Date(),
    };
    const [saved] = old
      ? await tx
          .update(purchases)
          .set({ ...data, version: bump })
          .where(eq(purchases.id, old.id))
          .returning()
      : await tx
          .insert(purchases)
          .values({ ...data, pharmacyId: a.pharmacyId, createdBy: a.id })
          .returning();
    const oldItems = old
      ? await tx.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, old.id))
      : [];
    const savedItems = await saveItems(tx, a, saved.id, v, oldItems);
    if (old?.supplyModel === 'legacy') {
      const [legacy] = await tx.select().from(followUps).where(eq(followUps.purchaseId, old.id));
      if (legacy)
        await patchFollow(
          tx,
          a,
          legacy,
          {
            status: 'closed',
            closedAt: new Date(),
            closedReason: 'converted_to_medicine',
            resolvingPurchaseId: null,
          },
          'converted_to_medicine',
          v.reason,
        );
    }
    const pairs = new Map(
      oldSupplies.map((s) => [
        s.customerId + ':' + s.medicineId,
        { customerId: s.customerId, medicineId: s.medicineId },
      ]),
    );
    const reopenSupplyIds: string[] = [];
    for (const s of oldSupplies) {
      if (!v.supplies.some((n) => n.medicineId === s.medicineId))
        await tx
          .update(medicineSupplies)
          .set({ included: false, version: bump })
          .where(eq(medicineSupplies.id, s.id));
    }
    for (const s of v.supplies) {
      const context = contexts.get(s.medicineId)!;
      const remainingUsed =
        s.mode === 'replace'
          ? 0
          : (s.remainingOverride ??
            (context.previousRunOut
              ? Math.max(0, daysBetween(s.supplyStart, context.previousRunOut))
              : 0));
      const dates = medicineDates(s.supplyStart, s.supplyDays, remainingUsed);
      ensure(
        !s.reminderEnabled || !s.manualDate || s.manualDate < dates.runOutDate || s.lateConfirmed,
        'Confirm a reminder at or after estimated run-out',
      );
      const prior = oldSupplies.find((o) => o.medicineId === s.medicineId);
      const values = {
        pharmacyId: a.pharmacyId,
        customerId: customer.id,
        purchaseId: saved.id,
        medicineId: s.medicineId,
        included: true,
        supplyStart: s.supplyStart,
        supplyDays: s.supplyDays,
        mode: s.mode,
        remainingOverride: s.remainingOverride,
        remainingUsed,
        runOutDate: dates.runOutDate,
        reminderEnabled: s.reminderEnabled,
        manualDate: s.reminderEnabled ? s.manualDate || null : null,
      };
      const [supply] = prior
        ? await tx
            .update(medicineSupplies)
            .set({ ...values, version: bump })
            .where(eq(medicineSupplies.id, prior.id))
            .returning()
        : await tx.insert(medicineSupplies).values(values).returning();
      // Move an existing follow-up's scope together with a corrected customer.
      if (prior && prior.customerId !== customer.id) {
        const [f] = await tx.select().from(followUps).where(eq(followUps.supplyId, prior.id));
        if (f)
          await patchFollow(
            tx,
            a,
            f,
            {
              status: 'closed',
              closedAt: new Date(),
              closedReason: 'customer_corrected',
              resolvingPurchaseId: null,
              pausedState: f.pausedState ?? snapshot(f),
              customerId: customer.id,
            },
            'customer_corrected',
            v.reason,
          );
      }
      if (s.reopenDisabled) reopenSupplyIds.push(supply.id);
      pairs.set(customer.id + ':' + s.medicineId, {
        customerId: customer.id,
        medicineId: s.medicineId,
      });
    }
    for (const pair of pairs.values())
      await reconcileSupply(
        tx,
        a,
        pair.customerId,
        pair.medicineId,
        v.reason || 'New medicine supply recorded',
        { scheduleChoice: v.scheduleChoice, reopenSupplyIds },
      );
    await audit(tx, a, 'purchase', saved.id, old ? 'corrected' : 'created', v.reason, {
      before: old ? { ...old, supplies: oldSupplies, items: oldItems } : null,
      after: {
        customerId: saved.customerId,
        purchaseDate: saved.purchaseDate,
        items: savedItems,
        supplies: v.supplies.map((s) => ({
          medicineId: s.medicineId,
          supplyDays: s.supplyDays,
          supplyStart: s.supplyStart,
          mode: s.mode,
          remainingOverride: s.remainingOverride,
          reminderEnabled: s.reminderEnabled,
          manualDate: s.manualDate,
        })),
      },
    });
    return { id: saved.id };
  });
}
export async function cancelMedicinePurchase(tx: Tx, a: Actor, p: Purchase, reason: string) {
  await tx
    .update(purchases)
    .set({ status: 'cancelled', version: bump, updatedBy: a.id, updatedAt: new Date() })
    .where(eq(purchases.id, p.id));
  const rows = await tx
    .select()
    .from(medicineSupplies)
    .where(eq(medicineSupplies.purchaseId, p.id));
  for (const s of rows) await reconcileSupply(tx, a, s.customerId, s.medicineId, reason);
}
