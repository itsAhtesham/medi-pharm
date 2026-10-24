import { z } from 'zod';
import { isDate, reminderDates, pharmacyToday } from './dates';
export const id = z.string().uuid();
export const day = z.string().refine(isDate, 'Enter a valid calendar date');
export const password = z
  .string()
  .refine(
    (v) => Array.from(v).length >= 15 && Array.from(v).length <= 128,
    'Use a passphrase of 15–128 characters',
  );
export const email = z.string().trim().toLowerCase().email().max(254);
export function normalizePhone(value: string) {
  const clean = value.replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(clean)) return '+91' + clean;
  if (/^\+[1-9]\d{7,14}$/.test(clean)) return clean;
  throw new Error('Enter a 10-digit Indian number or an international number with +country code');
}
export const customerInput = z.object({
  id: id.optional(),
  version: z.number().int().optional(),
  name: z.string().trim().min(2).max(120),
  age: z.preprocess(
    (value) => (value == null || (typeof value === 'string' && value.trim() === '') ? null : value),
    z.coerce.number().int().min(0).max(130).nullable(),
  ),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => {
      try {
        normalizePhone(v);
        return true;
      } catch {
        return false;
      }
    }, 'Enter a valid phone number'),
  notes: z.string().trim().max(2000).default(''),
});
export const medicineInput = z.object({
  id: id.optional(),
  version: z.number().int().optional(),
  name: z.string().trim().min(2).max(120),
  strength: z.string().trim().max(80).default(''),
  form: z.string().trim().max(80).default(''),
});
export const units = [
  'tablets',
  'strips',
  'capsules',
  'bottles',
  'packs',
  'tubes',
  'sachets',
  'other',
] as const;
export const purchaseInput = z
  .object({
    id: id.optional(),
    version: z.number().int().optional(),
    customerId: id,
    purchaseDate: day,
    notes: z.string().trim().max(2000).default(''),
    items: z
      .array(
        z.object({
          medicineId: id,
          quantity: z.coerce.number().positive().max(999999).multipleOf(0.001),
          unit: z.enum(units),
        }),
      )
      .min(1)
      .max(100),
    reminderEnabled: z.boolean(),
    supplyStart: day.or(z.literal('')).optional(),
    supplyDays: z.coerce.number().optional(),
    manualDate: day.or(z.literal('')).optional(),
    lateConfirmed: z.boolean().default(false),
    oneDayConfirmed: z.boolean().default(false),
    refillOf: id.optional(),
    completePrevious: z.boolean().default(false),
    sourceVersion: z.number().int().optional(),
    reason: z.string().trim().max(2000).default(''),
    scheduleChoice: z.enum(['keep', 'recalculate']).optional(),
    completionChoice: z.enum(['keep', 'reverse']).optional(),
    reopenDisabled: z.boolean().default(false),
    reopenDate: day.or(z.literal('')).optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.purchaseDate > pharmacyToday())
      issue('purchaseDate', 'Purchase date cannot be in the future');
    if (v.id && !v.reason) issue('reason', 'Explain this correction');
    const keys = v.items.map((i) => i.medicineId + ':' + i.unit);
    if (new Set(keys).size !== keys.length)
      issue('items', 'Combine rows with the same medicine and unit');
    if (v.reminderEnabled) {
      if (!v.supplyStart || v.supplyStart < v.purchaseDate)
        issue('supplyStart', 'Supply must start on or after purchase');
      if (!Number.isInteger(v.supplyDays) || v.supplyDays! < 1 || v.supplyDays! > 365)
        issue('supplyDays', 'Use 1–365 whole days');
      if (v.supplyDays === 1 && (!v.manualDate || !v.oneDayConfirmed))
        issue('manualDate', 'Choose and confirm a follow-up date for a one-day supply');
      if (v.manualDate && v.manualDate < v.purchaseDate)
        issue('manualDate', 'Reminder cannot precede purchase');
      if (
        v.supplyStart &&
        isDate(v.supplyStart) &&
        v.supplyDays &&
        v.supplyDays >= 1 &&
        v.supplyDays <= 365 &&
        Number.isInteger(v.supplyDays) &&
        v.manualDate
      ) {
        if (
          v.manualDate >= reminderDates(v.supplyStart, v.supplyDays).runOutDate &&
          !v.lateConfirmed
        )
          issue('lateConfirmed', 'Confirm this follow-up is at or after expected run-out');
      }
    }
  });
export type PurchaseInput = z.infer<typeof purchaseInput>;
export const medicinePurchaseInput = z
  .object({
    id: id.optional(),
    version: z.number().int().optional(),
    customerId: id,
    purchaseDate: day,
    notes: z.string().trim().max(2000).default(''),
    items: z
      .array(
        z.object({
          medicineId: id,
          quantity: z.coerce.number().positive().max(999999).multipleOf(0.001),
          unit: z.enum(units),
        }),
      )
      .min(1)
      .max(100),
    supplies: z
      .array(
        z.object({
          medicineId: id,
          supplyStart: day,
          supplyDays: z.coerce.number().int().min(1).max(365),
          mode: z.enum(['extend', 'replace']),
          remainingOverride: z.preprocess(
            (v) => (v === '' || v == null ? null : v),
            z.coerce.number().int().min(0).max(365).nullable(),
          ),
          reminderEnabled: z.boolean(),
          manualDate: day.or(z.literal('')).default(''),
          lateConfirmed: z.boolean().default(false),
          expectedRevision: z.string().min(1),
          reopenDisabled: z.boolean().default(false),
        }),
      )
      .min(1)
      .max(100),
    reason: z.string().trim().max(2000).default(''),
    scheduleChoice: z.enum(['keep', 'recalculate']).default('keep'),
    convertLegacy: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (v.purchaseDate > pharmacyToday()) issue('Purchase date cannot be in the future');
    if (v.id && !v.reason) issue('Explain this correction');
    const items = new Set(v.items.map((i) => i.medicineId));
    if (new Set(v.items.map((i) => i.medicineId + ':' + i.unit)).size !== v.items.length)
      issue('Combine rows with the same medicine and unit');
    if (
      new Set(v.supplies.map((s) => s.medicineId)).size !== v.supplies.length ||
      v.supplies.length !== items.size ||
      v.supplies.some((s) => !items.has(s.medicineId))
    )
      issue('Enter one supply duration for each distinct medicine, combining its units');
    for (const s of v.supplies) {
      if (s.supplyStart < v.purchaseDate) issue('Supply cannot start before purchase');
      if (s.manualDate && s.manualDate < v.purchaseDate) issue('Reminder cannot precede purchase');
      if (s.mode === 'replace' && s.remainingOverride !== null)
        issue('Start fresh does not carry remaining days');
    }
  });
export type MedicinePurchaseInput = z.infer<typeof medicinePurchaseInput>;
export const followInput = z.object({
  id,
  version: z.number().int(),
  action: z.enum(['contact', 'snooze', 'close', 'reopen']),
  note: z.string().trim().max(2000).default(''),
  date: day.or(z.literal('')).optional(),
  reason: z
    .enum(['declined', 'no_longer_needed', 'purchased_elsewhere', 'unable_to_reach', 'other'])
    .optional(),
});
export function medicineKey(v: { name: string; strength: string; form: string }) {
  return [v.name, v.strength, v.form]
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');
}
