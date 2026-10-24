'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { requireAction } from './session';
import { saveCustomer, saveMedicine, archiveRecord } from './services/catalog';
import { savePurchase, purchaseCommand } from './services/purchases';
import { followCommand } from './services/follow-ups';
import { mutation, audit, AppError } from './services/core';
import { changePassword } from './auth';
import { pharmacies, purchases, customers } from './db/schema';
import { db } from './db';
import { day, id, medicinePurchaseInput } from '@/lib/validation';
import { supplyContext, type SupplyContext } from './services/medicine-supplies';
export type ActionResult =
  { ok: true; id: string; message?: string } | { ok: false; code: string; message: string };
export async function command(
  name: string,
  requestId: string,
  payload: unknown,
): Promise<ActionResult> {
  try {
    const a = await requireAction();
    let result: { id: string; message?: string };
    switch (name) {
      case 'customer.save':
        result = await saveCustomer(a, requestId, payload);
        break;
      case 'medicine.save':
        result = await saveMedicine(a, requestId, payload);
        break;
      case 'catalog.archive':
        result = await archiveRecord(
          a,
          requestId,
          z
            .object({
              kind: z.enum(['customer', 'medicine']),
              id: z.string().uuid(),
              version: z.number().int(),
              archived: z.boolean(),
              confirmed: z.boolean().optional(),
            })
            .parse(payload),
        );
        break;
      case 'purchase.save':
        result = await savePurchase(a, requestId, medicinePurchaseInput.parse(payload));
        break;
      case 'purchase.command':
        result = await purchaseCommand(
          a,
          requestId,
          z
            .object({
              id: z.string().uuid(),
              version: z.number().int(),
              action: z.enum(['cancel', 'detach']),
              reason: z.string().trim().min(1).max(2000),
            })
            .parse(payload),
        );
        break;
      case 'follow.command':
        result = await followCommand(a, requestId, payload);
        break;
      case 'settings.save': {
        const v = z
          .object({ name: z.string().trim().min(2).max(120), contact: z.string().trim().max(120) })
          .parse(payload);
        result = await mutation(a, requestId, name, v, async (tx) => {
          await tx.update(pharmacies).set(v).where(eq(pharmacies.id, a.pharmacyId));
          await audit(tx, a, 'pharmacy', a.pharmacyId, 'updated');
          return { id: a.pharmacyId };
        });
        break;
      }
      case 'password.change': {
        const v = z
          .object({ current: z.string().max(512), next: z.string().max(512) })
          .parse(payload);
        await changePassword(a, v.current, v.next);
        return { ok: true, id: a.id, message: 'Password changed. Sign in with your new password.' };
      }
      default:
        throw new AppError('Unknown command');
    }
    revalidatePath('/', 'layout');
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof z.ZodError)
      return {
        ok: false,
        code: 'VALIDATION',
        message: error.issues.map((i) => i.message).join('. '),
      };
    if (error instanceof AppError) return { ok: false, code: error.code, message: error.message };
    console.error('Business command failed', {
      command: name,
      requestId,
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return {
      ok: false,
      code: 'UNCERTAIN',
      message: 'Unable to confirm this save. Retry the original submission.',
    };
  }
}

export async function searchOptions(kind: 'customer' | 'medicine', query: string) {
  const a = await requireAction();
  const { catalog } = await import('./queries');
  const result = await catalog(a, kind, query.slice(0, 120));
  return result.rows.map((row) => ({
    id: row.id,
    label: row.name + ('phone' in row ? ` · ${row.phone}` : ` · ${row.strength} ${row.form}`),
  }));
}

export async function getSupplyContexts(
  raw: unknown,
): Promise<{ ok: true; rows: SupplyContext[] } | { ok: false; code: string; message: string }> {
  try {
    const a = await requireAction();
    const v = z
      .object({
        customerId: id,
        medicineIds: z.array(id).max(100),
        purchaseDate: day,
        purchaseId: id.optional(),
      })
      .parse(raw);
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, v.customerId), eq(customers.pharmacyId, a.pharmacyId)));
    if (!customer) throw new AppError('Customer not found');
    const [editing] = v.purchaseId
      ? await db
          .select()
          .from(purchases)
          .where(and(eq(purchases.id, v.purchaseId), eq(purchases.pharmacyId, a.pharmacyId)))
      : [];
    if (v.purchaseId && !editing) throw new AppError('Purchase not found');
    const rows = await Promise.all(
      [...new Set(v.medicineIds)].map((medicineId) =>
        supplyContext(db, a, v.customerId, medicineId, v.purchaseDate, editing),
      ),
    );
    return { ok: true, rows };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, code: error.code, message: error.message };
    if (error instanceof z.ZodError)
      return {
        ok: false,
        code: 'VALIDATION',
        message: 'Select a valid customer, medicines and purchase date to load supply estimates.',
      };
    console.error('Supply estimates failed', {
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return {
      ok: false,
      code: 'UNAVAILABLE',
      message: 'Could not load supply estimates. Try Refresh estimates.',
    };
  }
}
