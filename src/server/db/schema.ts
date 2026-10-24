import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  integer,
  boolean,
  numeric,
  bigserial,
  jsonb,
  unique,
  index,
  check,
  foreignKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
const pk = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const version = () => integer('version').notNull().default(1);
export const pharmacies = pgTable(
  'pharmacies',
  {
    id: pk(),
    name: text().notNull(),
    contact: text().notNull().default(''),
    timezone: text().notNull().default('Asia/Kolkata'),
    createdAt: created(),
  },
  (t) => [check('pharmacy_timezone', sql`${t.timezone} = 'Asia/Kolkata'`)],
);
export const users = pgTable(
  'users',
  {
    id: pk(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id),
    email: text().notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: created(),
  },
  (t) => [
    unique('one_owner_per_pharmacy').on(t.pharmacyId),
    unique('user_scope').on(t.pharmacyId, t.id),
  ],
);
export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [index('session_user_expiry').on(t.userId, t.expiresAt)],
);
export const authRateLimits = pgTable('auth_rate_limits', {
  key: text().primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  attempts: integer().notNull().default(0),
});
export const customers = pgTable(
  'customers',
  {
    id: pk(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id),
    name: text().notNull(),
    phone: text().notNull(),
    phoneNormalized: text('phone_normalized').notNull(),
    age: integer(),
    notes: text().notNull().default(''),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: version(),
    createdAt: created(),
  },
  (t) => [
    unique('customer_scope').on(t.pharmacyId, t.id),
    index('customer_name').on(t.pharmacyId, t.name),
    index('customer_phone').on(t.pharmacyId, t.phoneNormalized),
    check('customer_phone_required', sql`length(${t.phoneNormalized}) > 0`),
    check('customer_age_range', sql`${t.age} between 0 and 130`),
  ],
);
export const medicines = pgTable(
  'medicines',
  {
    id: pk(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id),
    name: text().notNull(),
    strength: text().notNull().default(''),
    form: text().notNull().default(''),
    identityKey: text('identity_key').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: version(),
    createdAt: created(),
  },
  (t) => [
    unique('medicine_scope').on(t.pharmacyId, t.id),
    unique('medicine_identity').on(t.pharmacyId, t.identityKey),
  ],
);
export const purchases = pgTable(
  'purchases',
  {
    id: pk(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id),
    customerId: uuid('customer_id').notNull(),
    sequence: bigserial({ mode: 'number' }).notNull().unique(),
    purchaseDate: date('purchase_date', { mode: 'string' }).notNull(),
    notes: text().notNull().default(''),
    status: text({ enum: ['active', 'cancelled'] })
      .notNull()
      .default('active'),
    supplyModel: text('supply_model').notNull().default('legacy'),
    reminderEnabled: boolean('reminder_enabled').notNull().default(false),
    supplyStart: date('supply_start', { mode: 'string' }),
    supplyDays: integer('supply_days'),
    runOutDate: date('run_out_date', { mode: 'string' }),
    refillOf: uuid('refill_of_purchase_id'),
    version: version(),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: created(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('purchase_scope').on(t.pharmacyId, t.id),
    foreignKey({
      columns: [t.pharmacyId, t.customerId],
      foreignColumns: [customers.pharmacyId, customers.id],
    }),
    foreignKey({
      columns: [t.pharmacyId, t.createdBy],
      foreignColumns: [users.pharmacyId, users.id],
    }),
    foreignKey({
      columns: [t.pharmacyId, t.updatedBy],
      foreignColumns: [users.pharmacyId, users.id],
    }),
    foreignKey({ columns: [t.pharmacyId, t.refillOf], foreignColumns: [t.pharmacyId, t.id] }),
    check('purchase_status', sql`${t.status} in ('active','cancelled')`),
    check('purchase_not_self', sql`${t.refillOf} is null or ${t.refillOf} <> ${t.id}`),
    check(
      'supply_valid',
      sql`not ${t.reminderEnabled} or (${t.supplyDays} is not null and ${t.supplyStart} is not null and ${t.runOutDate} is not null and ${t.supplyDays} between 1 and 365 and ${t.supplyStart} >= ${t.purchaseDate} and ${t.runOutDate} = ${t.supplyStart} + ${t.supplyDays})`,
    ),
    index('purchase_date').on(t.pharmacyId, t.purchaseDate, t.id),
    index('purchase_customer').on(t.customerId, t.purchaseDate),
  ],
);
export const purchaseItems = pgTable(
  'purchase_items',
  {
    id: pk(),
    pharmacyId: uuid('pharmacy_id').notNull(),
    purchaseId: uuid('purchase_id').notNull(),
    medicineId: uuid('medicine_id').notNull(),
    name: text().notNull(),
    strength: text().notNull(),
    form: text().notNull(),
    quantity: numeric({ precision: 12, scale: 3 }).notNull(),
    unit: text().notNull(),
    position: integer().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.pharmacyId, t.purchaseId],
      foreignColumns: [purchases.pharmacyId, purchases.id],
    }),
    foreignKey({
      columns: [t.pharmacyId, t.medicineId],
      foreignColumns: [medicines.pharmacyId, medicines.id],
    }),
    unique('item_medicine_unit').on(t.purchaseId, t.medicineId, t.unit),
    check('positive_quantity', sql`${t.quantity} > 0`),
    check(
      'known_unit',
      sql`${t.unit} in ('tablets','strips','capsules','bottles','packs','tubes','sachets','other')`,
    ),
  ],
);
export const medicineSupplies = pgTable(
  'medicine_supplies',
  {
    id: pk(),
    pharmacyId: uuid('pharmacy_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    purchaseId: uuid('purchase_id').notNull(),
    medicineId: uuid('medicine_id').notNull(),
    included: boolean().notNull().default(true),
    supplyStart: date('supply_start', { mode: 'string' }).notNull(),
    supplyDays: integer('supply_days').notNull(),
    mode: text({ enum: ['extend', 'replace'] }).notNull(),
    remainingOverride: integer('remaining_override'),
    remainingUsed: integer('remaining_used').notNull().default(0),
    runOutDate: date('run_out_date', { mode: 'string' }).notNull(),
    reminderEnabled: boolean('reminder_enabled').notNull().default(false),
    manualDate: date('manual_date', { mode: 'string' }),
    version: version(),
    createdAt: created(),
  },
  (t) => [
    unique('supply_scope').on(t.pharmacyId, t.id),
    unique('supply_purchase_medicine').on(t.purchaseId, t.medicineId),
    foreignKey({
      columns: [t.pharmacyId, t.purchaseId],
      foreignColumns: [purchases.pharmacyId, purchases.id],
    }),
    foreignKey({
      columns: [t.pharmacyId, t.customerId],
      foreignColumns: [customers.pharmacyId, customers.id],
    }),
    foreignKey({
      columns: [t.pharmacyId, t.medicineId],
      foreignColumns: [medicines.pharmacyId, medicines.id],
    }),
    check(
      'medicine_supply_days',
      sql`${t.supplyDays} between 1 and 365 and ${t.remainingUsed} >= 0 and (${t.remainingOverride} is null or ${t.remainingOverride} between 0 and 365)`,
    ),
    check('medicine_supply_mode', sql`${t.mode} in ('extend','replace')`),
    check(
      'medicine_supply_end',
      sql`${t.runOutDate} = ${t.supplyStart} + ${t.supplyDays} + ${t.remainingUsed}`,
    ),
    index('medicine_supply_customer').on(t.pharmacyId, t.customerId, t.medicineId),
  ],
);
export type PausedFollow = {
  status: 'open' | 'closed';
  nextDate: string;
  closedReason: string | null;
  closedAt: string | null;
  resolvingPurchaseId: string | null;
};
export const followUps = pgTable(
  'follow_ups',
  {
    id: pk(),
    pharmacyId: uuid('pharmacy_id').notNull(),
    purchaseId: uuid('purchase_id').notNull(),
    supplyId: uuid('supply_id').unique(),
    customerId: uuid('customer_id'),
    medicineId: uuid('medicine_id'),
    pausedState: jsonb('paused_state').$type<PausedFollow>(),
    status: text({ enum: ['open', 'closed'] })
      .notNull()
      .default('open'),
    calculatedDate: date('calculated_date', { mode: 'string' }),
    manualDate: date('manual_date', { mode: 'string' }),
    nextDate: date('next_date', { mode: 'string' }).notNull(),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedReason: text('closed_reason'),
    resolvingPurchaseId: uuid('resolving_purchase_id'),
    version: version(),
    createdAt: created(),
  },
  (t) => [
    unique('follow_scope').on(t.pharmacyId, t.id),
    uniqueIndex('legacy_follow_purchase')
      .on(t.purchaseId)
      .where(sql`${t.supplyId} is null`),
    uniqueIndex('one_open_medicine_follow')
      .on(t.pharmacyId, t.customerId, t.medicineId)
      .where(sql`${t.status} = 'open' and ${t.supplyId} is not null`),
    foreignKey({
      columns: [t.pharmacyId, t.supplyId],
      foreignColumns: [medicineSupplies.pharmacyId, medicineSupplies.id],
    }),
    check(
      'medicine_follow_identity',
      sql`(${t.supplyId} is null and ${t.customerId} is null and ${t.medicineId} is null) or (${t.supplyId} is not null and ${t.customerId} is not null and ${t.medicineId} is not null)`,
    ),
    foreignKey({
      columns: [t.pharmacyId, t.purchaseId],
      foreignColumns: [purchases.pharmacyId, purchases.id],
    }),
    foreignKey({
      columns: [t.pharmacyId, t.resolvingPurchaseId],
      foreignColumns: [purchases.pharmacyId, purchases.id],
    }),
    check(
      'follow_status',
      sql`(${t.status} = 'open' and ${t.closedAt} is null and ${t.closedReason} is null and ${t.resolvingPurchaseId} is null) or (${t.status} = 'closed' and ${t.closedAt} is not null and ${t.closedReason} is not null)`,
    ),
    index('follow_due').on(t.pharmacyId, t.status, t.nextDate, t.id),
  ],
);
export const followUpEvents = pgTable(
  'follow_up_events',
  {
    id: pk(),
    pharmacyId: uuid('pharmacy_id').notNull(),
    followUpId: uuid('follow_up_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    action: text().notNull(),
    note: text().notNull().default(''),
    before: jsonb().$type<Record<string, unknown>>(),
    after: jsonb().$type<Record<string, unknown>>(),
    createdAt: created(),
  },
  (t) => [
    foreignKey({
      columns: [t.pharmacyId, t.followUpId],
      foreignColumns: [followUps.pharmacyId, followUps.id],
    }),
    foreignKey({
      columns: [t.pharmacyId, t.actorId],
      foreignColumns: [users.pharmacyId, users.id],
    }),
    index('follow_event_time').on(t.followUpId, t.createdAt),
  ],
);
export const auditEvents = pgTable('audit_events', {
  id: pk(),
  pharmacyId: uuid('pharmacy_id')
    .notNull()
    .references(() => pharmacies.id),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id),
  entityId: uuid('entity_id').notNull(),
  entityType: text('entity_type').notNull(),
  action: text().notNull(),
  reason: text().notNull().default(''),
  changes: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(),
});
export const mutationReceipts = pgTable(
  'mutation_receipts',
  {
    id: pk(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    requestId: uuid('request_id').notNull(),
    command: text().notNull(),
    payloadHash: text('payload_hash').notNull(),
    result: jsonb().$type<{ id: string; message?: string }>().notNull(),
    createdAt: created(),
  },
  (t) => [unique('mutation_identity').on(t.pharmacyId, t.actorId, t.requestId)],
);
