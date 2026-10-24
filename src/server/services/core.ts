import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, type Tx } from '../db';
import { pharmacies, mutationReceipts, auditEvents } from '../db/schema';
import { id } from '@/lib/validation';
export type Actor = { id: string; pharmacyId: string; sessionId?: string };
export class AppError extends Error {
  constructor(
    message: string,
    public code = 'VALIDATION',
  ) {
    super(message);
  }
}
export function ensure(value: unknown, message: string, code = 'VALIDATION'): asserts value {
  if (!value) throw new AppError(message, code);
}
export function versionCheck(actual: number, expected: number | undefined) {
  ensure(actual === expected, 'This record changed. Reload and review before saving.', 'CONFLICT');
}
export async function audit(
  tx: Tx,
  a: Actor,
  entityType: string,
  entityId: string,
  action: string,
  reason = '',
  changes: Record<string, unknown> = {},
) {
  await tx.insert(auditEvents).values({
    pharmacyId: a.pharmacyId,
    actorId: a.id,
    entityType,
    entityId,
    action,
    reason,
    changes,
  });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
export async function mutation(
  a: Actor,
  requestId: string,
  command: string,
  payload: unknown,
  work: (tx: Tx) => Promise<{ id: string; message?: string }>,
) {
  id.parse(requestId);
  const payloadHash = createHash('sha256').update(canonical(payload)).digest('hex');
  return db.transaction(async (tx) => {
    // One owner: serialize business mutations per pharmacy. This also provides a
    // single stable lock order for linked corrections, cancellation and completion.
    const [scope] = await tx
      .select({ id: pharmacies.id })
      .from(pharmacies)
      .where(eq(pharmacies.id, a.pharmacyId))
      .for('update');
    ensure(scope, 'Pharmacy not found');
    const [receipt] = await tx
      .select()
      .from(mutationReceipts)
      .where(
        and(
          eq(mutationReceipts.pharmacyId, a.pharmacyId),
          eq(mutationReceipts.actorId, a.id),
          eq(mutationReceipts.requestId, requestId),
        ),
      );
    if (receipt) {
      ensure(
        receipt.command === command && receipt.payloadHash === payloadHash,
        'This request identifier belongs to a different submission.',
        'CONFLICT',
      );
      return receipt.result;
    }
    const result = await work(tx);
    await tx
      .insert(mutationReceipts)
      .values({ pharmacyId: a.pharmacyId, actorId: a.id, requestId, command, payloadHash, result });
    return result;
  });
}
export const bump = sql`version + 1`;
