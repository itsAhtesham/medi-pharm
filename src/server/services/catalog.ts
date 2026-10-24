import { and, eq, sql } from 'drizzle-orm';
import { customers, medicines, followUps, purchases, purchaseItems } from '../db/schema';
import { customerInput, medicineInput, medicineKey, normalizePhone, id } from '@/lib/validation';
import { mutation, ensure, versionCheck, audit, bump, type Actor } from './core';
export async function saveCustomer(a: Actor, requestId: string, raw: unknown) {
  const v = customerInput.parse(raw);
  return mutation(a, requestId, 'customer.save', v, async (tx) => {
    const values = {
      name: v.name,
      phone: v.phone,
      phoneNormalized: normalizePhone(v.phone),
      age: v.age,
      notes: v.notes,
    };
    let result;
    if (v.id) {
      const [old] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.id, v.id), eq(customers.pharmacyId, a.pharmacyId)));
      ensure(old, 'Customer not found');
      versionCheck(old.version, v.version);
      [result] = await tx
        .update(customers)
        .set({ ...values, version: bump })
        .where(eq(customers.id, old.id))
        .returning();
    } else
      [result] = await tx
        .insert(customers)
        .values({ ...values, pharmacyId: a.pharmacyId })
        .returning();
    await audit(tx, a, 'customer', result.id, v.id ? 'updated' : 'created');
    return { id: result.id };
  });
}
export async function saveMedicine(a: Actor, requestId: string, raw: unknown) {
  const v = medicineInput.parse(raw);
  return mutation(a, requestId, 'medicine.save', v, async (tx) => {
    const identityKey = medicineKey(v);
    const [duplicate] = await tx
      .select()
      .from(medicines)
      .where(and(eq(medicines.pharmacyId, a.pharmacyId), eq(medicines.identityKey, identityKey)));
    ensure(
      !duplicate || duplicate.id === v.id,
      `This medicine already exists${duplicate?.archivedAt ? ' in archived medicines' : ''}. Select or restore the existing record.`,
    );
    let result;
    const values = { name: v.name, strength: v.strength, form: v.form, identityKey };
    if (v.id) {
      const [old] = await tx
        .select()
        .from(medicines)
        .where(and(eq(medicines.id, v.id), eq(medicines.pharmacyId, a.pharmacyId)));
      ensure(old, 'Medicine not found');
      versionCheck(old.version, v.version);
      if (medicineKey({ ...old, name: '' }) !== medicineKey({ ...v, name: '' })) {
        const [used] = await tx
          .select({ id: purchaseItems.id })
          .from(purchaseItems)
          .where(eq(purchaseItems.medicineId, old.id))
          .limit(1);
        ensure(
          !used,
          'This medicine has purchase history. Add a separate medicine for a different strength or form so supply estimates are not combined.',
        );
      }
      [result] = await tx
        .update(medicines)
        .set({ ...values, version: bump })
        .where(eq(medicines.id, old.id))
        .returning();
    } else
      [result] = await tx
        .insert(medicines)
        .values({ ...values, pharmacyId: a.pharmacyId })
        .returning();
    await audit(tx, a, 'medicine', result.id, v.id ? 'updated' : 'created');
    return { id: result.id };
  });
}
export async function archiveRecord(
  a: Actor,
  requestId: string,
  v: {
    kind: 'customer' | 'medicine';
    id: string;
    version: number;
    archived: boolean;
    confirmed?: boolean;
  },
) {
  id.parse(v.id);
  ensure(v.kind === 'customer' || v.kind === 'medicine', 'Unknown record type');
  return mutation(a, requestId, 'catalog.archive', v, async (tx) => {
    const table = v.kind === 'customer' ? customers : medicines;
    const [old] = await tx
      .select()
      .from(table)
      .where(and(eq(table.id, v.id), eq(table.pharmacyId, a.pharmacyId)));
    ensure(old, 'Record not found');
    versionCheck(old.version, v.version);
    if (v.kind === 'customer' && v.archived && !v.confirmed) {
      const [open] = await tx
        .select({ id: followUps.id })
        .from(followUps)
        .innerJoin(purchases, eq(followUps.purchaseId, purchases.id))
        .where(and(eq(purchases.customerId, v.id), eq(followUps.status, 'open')))
        .limit(1);
      ensure(
        !open,
        'This customer has open follow-ups. Confirm archiving; reminders will remain open.',
      );
    }
    await tx
      .update(table)
      .set({ archivedAt: v.archived ? new Date() : null, version: sql`version + 1` })
      .where(eq(table.id, v.id));
    await audit(tx, a, v.kind, v.id, v.archived ? 'archived' : 'restored');
    return { id: v.id };
  });
}
