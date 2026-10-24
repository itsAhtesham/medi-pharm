import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { db, pool } from '../src/server/db';
import {
  users,
  pharmacies,
  customers,
  medicines,
  purchases,
  purchaseItems,
  medicineSupplies,
  followUps,
  followUpEvents,
  auditEvents,
  mutationReceipts,
} from '../src/server/db/schema';
import { hashPassword } from '../src/server/auth';
import { saveCustomer, saveMedicine } from '../src/server/services/catalog';
import { savePurchase, purchaseCommand } from '../src/server/services/purchases';
import { followCommand } from '../src/server/services/follow-ups';
import { supplyContext } from '../src/server/services/medicine-supplies';
import { addDays, pharmacyToday } from '../src/lib/dates';
import { medicineKey, units } from '../src/lib/validation';
import type { Actor } from '../src/server/services/core';

const demoMarker = 'Synthetic development record';
const catalog = [
  ['Metformin', '500 mg', 'Tablet'],
  ['Atorvastatin', '10 mg', 'Tablet'],
  ['Vitamin D3', '1000 IU', 'Capsule'],
  ['Amlodipine', '5 mg', 'Tablet'],
  ['Cetirizine', '10 mg', 'Tablet'],
  ['Paracetamol', '500 mg', 'Tablet'],
] as const;
const knownMedicineKeys = new Set(
  catalog.map(([name, strength, form]) => medicineKey({ name, strength, form })),
);
async function replaceDemo(a: Actor) {
  // Restrict replacement to this project's local development database and tagged
  // demo customers. Owner credentials, sessions and pharmacy settings are untouched.
  const target = new URL(process.env.DATABASE_URL!);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    target.port !== '54329' ||
    target.pathname !== '/medi_pharm'
  )
    throw new Error('--replace-demo is restricted to the local medi_pharm database on port 54329');
  return db.transaction(async (tx) => {
    await tx
      .select({ id: pharmacies.id })
      .from(pharmacies)
      .where(eq(pharmacies.id, a.pharmacyId))
      .for('update');
    const people = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.pharmacyId, a.pharmacyId), like(customers.notes, demoMarker + '%')));
    if (!people.length) return 0;
    const customerIds = people.map((c) => c.id);
    const orders = await tx
      .select({ id: purchases.id })
      .from(purchases)
      .where(inArray(purchases.customerId, customerIds));
    const orderIds = orders.map((p) => p.id);
    const removedIds = [...customerIds, ...orderIds];
    const candidateMedicines = new Set<string>();
    if (orderIds.length) {
      const items = await tx
        .select({ medicineId: purchaseItems.medicineId })
        .from(purchaseItems)
        .where(inArray(purchaseItems.purchaseId, orderIds));
      items.forEach((i) => candidateMedicines.add(i.medicineId));
      const follows = await tx
        .select({ id: followUps.id })
        .from(followUps)
        .where(inArray(followUps.purchaseId, orderIds));
      const followIds = follows.map((f) => f.id);
      removedIds.push(...followIds);
      if (followIds.length)
        await tx.delete(followUpEvents).where(inArray(followUpEvents.followUpId, followIds));
      await tx.delete(followUps).where(inArray(followUps.purchaseId, orderIds));
      await tx.delete(medicineSupplies).where(inArray(medicineSupplies.purchaseId, orderIds));
      await tx.delete(purchaseItems).where(inArray(purchaseItems.purchaseId, orderIds));
      await tx.delete(purchases).where(inArray(purchases.id, orderIds));
    }
    await tx.delete(customers).where(inArray(customers.id, customerIds));
    for (const medicineId of candidateMedicines) {
      const [medicine] = await tx
        .select()
        .from(medicines)
        .where(and(eq(medicines.id, medicineId), eq(medicines.pharmacyId, a.pharmacyId)));
      if (!medicine || !knownMedicineKeys.has(medicine.identityKey)) continue;
      const [item] = await tx
        .select({ id: purchaseItems.id })
        .from(purchaseItems)
        .where(eq(purchaseItems.medicineId, medicineId))
        .limit(1);
      const [supply] = await tx
        .select({ id: medicineSupplies.id })
        .from(medicineSupplies)
        .where(eq(medicineSupplies.medicineId, medicineId))
        .limit(1);
      if (!item && !supply) {
        await tx.delete(medicines).where(eq(medicines.id, medicineId));
        removedIds.push(medicineId);
      }
    }
    await tx
      .delete(auditEvents)
      .where(
        and(eq(auditEvents.pharmacyId, a.pharmacyId), inArray(auditEvents.entityId, removedIds)),
      );
    await tx
      .delete(mutationReceipts)
      .where(
        and(
          eq(mutationReceipts.pharmacyId, a.pharmacyId),
          inArray(sql<string>`${mutationReceipts.result}->>'id'`, removedIds),
        ),
      );
    return people.length;
  });
}

type SampleSupply = {
  medicine: number;
  days: number;
  remind?: boolean;
  mode?: 'replace' | 'extend';
  remaining?: number;
  startOffset?: number;
  rows?: { quantity: number; unit: (typeof units)[number] }[];
};
async function main() {
  if (process.env.NODE_ENV === 'production' || !process.argv.includes('--confirm-development'))
    throw new Error('Synthetic seed requires --confirm-development and a non-production database');
  try {
    let [owner] = await db.select().from(users).limit(1);
    if (!owner) {
      if (!process.env.SEED_OWNER_PASSWORD)
        throw new Error(
          'Bootstrap the owner first, or supply SEED_OWNER_PASSWORD for an isolated development database',
        );
      const [p] = await db
        .insert(pharmacies)
        .values({ name: 'Lavender Pharmacy · Development' })
        .returning();
      [owner] = await db
        .insert(users)
        .values({
          pharmacyId: p.id,
          email: 'owner@example.test',
          passwordHash: await hashPassword(process.env.SEED_OWNER_PASSWORD),
        })
        .returning();
    }
    const a = { id: owner.id, pharmacyId: owner.pharmacyId };
    if (process.argv.includes('--replace-demo')) {
      const removed = await replaceDemo(a);
      console.log(`Removed ${removed} tagged demo customers and their related demo history.`);
    } else if (
      (
        await db
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.pharmacyId, a.pharmacyId))
          .limit(1)
      ).length
    ) {
      throw new Error(
        'Seed requires an empty customer catalog. Use --replace-demo only to replace tagged local demo records.',
      );
    }
    const meds: string[] = [];
    for (const [name, strength, form] of catalog) {
      const [existing] = await db
        .select()
        .from(medicines)
        .where(
          and(
            eq(medicines.pharmacyId, a.pharmacyId),
            eq(medicines.identityKey, medicineKey({ name, strength, form })),
          ),
        );
      if (existing?.archivedAt) throw new Error(`Restore ${name} before seeding demo purchases`);
      meds.push(existing?.id ?? (await saveMedicine(a, randomUUID(), { name, strength, form })).id);
    }
    const today = pharmacyToday();
    const people: string[] = [];
    for (const [i, [name, age]] of (
      [
        ['Aarav Mehta', 42],
        ['Priya Sharma', 58],
        ['Rahul Kumar', 36],
        ['Neha Singh', 61],
        ['Sanjay Patel', 47],
        ['Ananya Rao', 29],
        ['Karan Shah', 52],
        ['Jaya Iyer', 65],
      ] as const
    ).entries()) {
      const c = await saveCustomer(a, randomUUID(), {
        name,
        age,
        phone: `+1202555011${i}`,
        notes: `${demoMarker} — not a real customer. Per-medicine supply demo; durations are fictional, not medical guidance.`,
      });
      people.push(c.id);
    }
    let purchaseCount = 0;
    async function buy(person: number, offset: number, supplies: SampleSupply[], note: string) {
      const purchaseDate = addDays(today, offset);
      const inputs = [];
      for (const s of supplies) {
        const medicineId = meds[s.medicine];
        const context = await supplyContext(db, a, people[person], medicineId, purchaseDate);
        inputs.push({
          medicineId,
          supplyDays: s.days,
          supplyStart: addDays(today, s.startOffset ?? offset),
          mode: s.mode ?? 'replace',
          remainingOverride: s.remaining ?? null,
          reminderEnabled: s.remind ?? true,
          expectedRevision: context.revision,
        });
      }
      const p = await savePurchase(a, randomUUID(), {
        customerId: people[person],
        purchaseDate,
        notes: `Synthetic demo: ${note}`,
        items: supplies.flatMap((s) =>
          (s.rows ?? [{ quantity: 1, unit: 'strips' as const }]).map((row) => ({
            ...row,
            medicineId: meds[s.medicine],
          })),
        ),
        supplies: inputs,
      });
      purchaseCount++;
      return p.id;
    }
    async function follow(
      purchaseId: string,
      medicine: number,
      action: 'contact' | 'snooze' | 'close',
      note: string,
      date?: string,
    ) {
      const [f] = await db
        .select()
        .from(followUps)
        .where(and(eq(followUps.purchaseId, purchaseId), eq(followUps.medicineId, meds[medicine])));
      if (!f) throw new Error('Expected a demo follow-up');
      await followCommand(a, randomUUID(), {
        id: f.id,
        version: f.version,
        action,
        note,
        date,
        ...(action === 'close' ? { reason: 'declined' } : {}),
      });
    }
    await buy(
      0,
      -23,
      [
        {
          medicine: 0,
          days: 30,
          rows: [
            { quantity: 2, unit: 'strips' },
            { quantity: 4, unit: 'tablets' },
          ],
        },
        { medicine: 1, days: 15 },
        { medicine: 2, days: 45 },
      ],
      'Different medicine durations; mixed units share one supply. Metformin due today, Atorvastatin overdue, Vitamin D3 scheduled.',
    );
    const priya = await buy(
      1,
      -26,
      [
        { medicine: 3, days: 30 },
        { medicine: 4, days: 7, remind: false },
      ],
      'Overdue Amlodipine contact; no follow-up for the one-time Cetirizine purchase.',
    );
    await follow(priya, 3, 'contact', 'Sample note: customer contacted; refill not yet confirmed.');
    await buy(
      2,
      -3,
      [{ medicine: 0, days: 7 }],
      'Initial seven-day supply for the add-to-remaining example.',
    );
    await buy(
      2,
      0,
      [{ medicine: 0, days: 11, mode: 'extend' }],
      'Four days remaining plus eleven new days = fifteen days; reminder twelve days from today.',
    );
    const accidental = await buy(
      2,
      0,
      [{ medicine: 0, days: 5 }],
      'Accidental duplicate; cancelled to restore the preceding supply and reminder.',
    );
    const [accidentalPurchase] = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, accidental));
    await purchaseCommand(a, randomUUID(), {
      id: accidental,
      version: accidentalPurchase.version,
      action: 'cancel',
      reason: 'Synthetic example: duplicate entry cancelled.',
    });
    await buy(
      3,
      -3,
      [{ medicine: 3, days: 7 }],
      'Initial seven-day supply for the start-fresh example.',
    );
    await buy(
      3,
      0,
      [{ medicine: 3, days: 11, mode: 'replace' }],
      'Discard four estimated remaining days; eleven days from today, reminder in eight days.',
    );
    const sanjay = await buy(
      4,
      -35,
      [{ medicine: 0, days: 30 }],
      'Estimated supply has ended; contact deliberately snoozed.',
    );
    await follow(sanjay, 0, 'contact', 'Sample note: customer asked for a call in two days.');
    await follow(sanjay, 0, 'snooze', 'Sample agreed callback.', addDays(today, 2));
    await buy(
      5,
      0,
      [
        { medicine: 4, days: 1 },
        { medicine: 2, days: 7, startOffset: 3 },
      ],
      'One-day supply reminder due today; second medicine starts in three days.',
    );
    await buy(
      6,
      -3,
      [{ medicine: 2, days: 7 }],
      'Initial seven-day supply before an adjusted remaining-day refill.',
    );
    await buy(
      6,
      0,
      [{ medicine: 2, days: 11, mode: 'extend', remaining: 2 }],
      'Owner records two days actually remaining instead of the estimated four; total thirteen days.',
    );
    const jaya = await buy(
      7,
      -8,
      [{ medicine: 2, days: 7 }],
      'Example of an explicitly closed medicine follow-up.',
    );
    await follow(jaya, 2, 'close', 'Sample note: customer declined further refill contact.');
    await buy(
      7,
      0,
      [{ medicine: 5, days: 5, remind: false }],
      'One-time purchase; supply is visible but no reminder is requested.',
    );
    console.log(
      `Created ${people.length} demo customers with ages, ${catalog.length} medicine types, and ${purchaseCount} purchases with individual supply histories.`,
    );
    console.log(
      'Examples include due/overdue/scheduled reminders, both early-refill choices, a remaining-day adjustment, mixed units, opt-out, contact, snooze, closed follow-up and cancellation.',
    );
    console.log('Owner login and pharmacy settings preserved.');
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
});
