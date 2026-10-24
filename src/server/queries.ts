import 'server-only';
import {
  and,
  eq,
  ilike,
  isNull,
  isNotNull,
  or,
  desc,
  asc,
  count,
  countDistinct,
  type SQLWrapper,
  lte,
  gt,
  inArray,
  sql,
} from 'drizzle-orm';
import { db } from './db';
import {
  customers,
  medicines,
  purchases,
  purchaseItems,
  medicineSupplies,
  followUps,
  followUpEvents,
  pharmacies,
  auditEvents,
} from './db/schema';
import type { Actor } from './services/core';
import { pharmacyToday } from '@/lib/dates';
export async function pharmacy(a: Actor) {
  return (await db.select().from(pharmacies).where(eq(pharmacies.id, a.pharmacyId)))[0];
}
export async function catalog(
  a: Actor,
  kind: 'customer' | 'medicine',
  q = '',
  archived = false,
  page = 1,
) {
  const table = kind === 'customer' ? customers : medicines;
  const term = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  const where = and(
    eq(table.pharmacyId, a.pharmacyId),
    archived ? isNotNull(table.archivedAt) : isNull(table.archivedAt),
    q
      ? kind === 'customer'
        ? or(ilike(customers.name, term), ilike(customers.phoneNormalized, term))
        : or(ilike(medicines.name, term), ilike(medicines.strength, term))
      : undefined,
  );
  const rows = await db
    .select()
    .from(table)
    .where(where)
    .orderBy(asc(table.name))
    .limit(25)
    .offset((page - 1) * 25);
  const [total] = await db.select({ count: count() }).from(table).where(where);
  return { rows, total: total.count };
}
export async function customerDetail(a: Actor, id: string) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.pharmacyId, a.pharmacyId)));
  return customer;
}
export async function medicineDetail(a: Actor, id: string) {
  const [medicine] = await db
    .select()
    .from(medicines)
    .where(and(eq(medicines.id, id), eq(medicines.pharmacyId, a.pharmacyId)));
  return medicine;
}
export async function medicinePurchaseHistory(
  a: Actor,
  medicineId: string,
  filter: { q?: string; from?: string; to?: string; page?: number } = {},
) {
  const term = '%' + (filter.q ?? '').replace(/[\\%_]/g, '\\$&') + '%';
  const where = and(
    eq(purchaseItems.pharmacyId, a.pharmacyId),
    eq(purchases.pharmacyId, a.pharmacyId),
    eq(customers.pharmacyId, a.pharmacyId),
    eq(purchaseItems.medicineId, medicineId),
    filter.q ? or(ilike(customers.name, term), ilike(customers.phoneNormalized, term)) : undefined,
    filter.from ? sql`${purchases.purchaseDate} >= ${filter.from}` : undefined,
    filter.to ? sql`${purchases.purchaseDate} <= ${filter.to}` : undefined,
  );
  const rows = await db
    .select({ item: purchaseItems, purchase: purchases, customer: customers })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
    .innerJoin(customers, eq(purchases.customerId, customers.id))
    .where(where)
    .orderBy(desc(purchases.purchaseDate), desc(purchases.sequence), asc(purchaseItems.position))
    .limit(25)
    .offset(((filter.page ?? 1) - 1) * 25);
  const [total] = await db
    .select({ count: count() })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
    .innerJoin(customers, eq(purchases.customerId, customers.id))
    .where(where);
  return { rows, total: total.count };
}
export async function purchaseList(
  a: Actor,
  filter: {
    customerId?: string;
    q?: string;
    from?: string;
    to?: string;
    status?: string;
    page?: number;
  } = {},
) {
  const where = and(
    eq(purchases.pharmacyId, a.pharmacyId),
    filter.customerId ? eq(purchases.customerId, filter.customerId) : undefined,
    filter.q ? ilike(customers.name, '%' + filter.q.replace(/[\\%_]/g, '\\$&') + '%') : undefined,
    filter.from ? sql`${purchases.purchaseDate} >= ${filter.from}` : undefined,
    filter.to ? sql`${purchases.purchaseDate} <= ${filter.to}` : undefined,
    filter.status === 'active' || filter.status === 'cancelled'
      ? eq(purchases.status, filter.status)
      : undefined,
  );
  const rows = await db
    .select({ purchase: purchases, customer: customers })
    .from(purchases)
    .innerJoin(customers, eq(purchases.customerId, customers.id))
    .where(where)
    .orderBy(
      ...(filter.customerId
        ? [desc(purchases.purchaseDate), desc(purchases.sequence)]
        : [desc(purchases.sequence)]),
    )
    .limit(25)
    .offset(((filter.page ?? 1) - 1) * 25);
  const [total] = await db
    .select({ count: count() })
    .from(purchases)
    .innerJoin(customers, eq(purchases.customerId, customers.id))
    .where(where);
  const follows = rows.length
    ? await db
        .select()
        .from(followUps)
        .where(
          inArray(
            followUps.purchaseId,
            rows.map((r) => r.purchase.id),
          ),
        )
        .orderBy(asc(followUps.nextDate), asc(followUps.id))
    : [];
  const items = rows.length
    ? await db
        .select({
          purchaseId: purchaseItems.purchaseId,
          medicineId: purchaseItems.medicineId,
          name: purchaseItems.name,
          strength: purchaseItems.strength,
          form: purchaseItems.form,
        })
        .from(purchaseItems)
        .where(
          and(
            eq(purchaseItems.pharmacyId, a.pharmacyId),
            inArray(
              purchaseItems.purchaseId,
              rows.map((r) => r.purchase.id),
            ),
          ),
        )
    : [];
  return {
    rows: rows.map((r) => {
      const matching = follows.filter((f) => f.purchaseId === r.purchase.id);
      const follow = matching.find((f) => f.status === 'open') ?? matching[0] ?? null;
      const medicine = follow?.medicineId
        ? items.find((i) => i.purchaseId === r.purchase.id && i.medicineId === follow.medicineId)
        : null;
      return {
        ...r,
        follow,
        followMedicine: medicine
          ? [medicine.name, medicine.strength, medicine.form].filter(Boolean).join(' ')
          : follow && !follow.medicineId
            ? 'Shared purchase reminder'
            : null,
      };
    }),
    total: total.count,
  };
}
export async function customerMedicines(a: Actor, customerId: string, page = 1) {
  const where = and(
    eq(purchases.pharmacyId, a.pharmacyId),
    eq(purchaseItems.pharmacyId, a.pharmacyId),
    eq(purchases.customerId, customerId),
  );
  const latestLabel = (column: SQLWrapper) =>
    sql<string>`(array_agg(${column} ORDER BY ${purchases.purchaseDate} DESC, ${purchases.sequence} DESC, ${purchaseItems.position} ASC))[1]`;
  const rows = await db
    .select({
      medicineId: purchaseItems.medicineId,
      name: latestLabel(purchaseItems.name),
      strength: latestLabel(purchaseItems.strength),
      form: latestLabel(purchaseItems.form),
      purchaseCount:
        sql<number>`count(distinct ${purchases.id}) filter (where ${purchases.status} = 'active')`.mapWith(
          Number,
        ),
      cancelledCount:
        sql<number>`count(distinct ${purchases.id}) filter (where ${purchases.status} = 'cancelled')`.mapWith(
          Number,
        ),
      latestDate: sql<string>`max(${purchases.purchaseDate})::text`,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
    .where(where)
    .groupBy(purchaseItems.medicineId)
    .orderBy(desc(sql`max(${purchases.purchaseDate})`), asc(purchaseItems.medicineId))
    .limit(25)
    .offset((page - 1) * 25);
  const [total] = await db
    .select({ count: countDistinct(purchaseItems.medicineId) })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
    .where(where);
  return { rows, total: total.count };
}
export async function customerMedicineHistory(
  a: Actor,
  customerId: string,
  medicineId: string,
  page = 1,
) {
  const where = and(
    eq(purchases.pharmacyId, a.pharmacyId),
    eq(purchaseItems.pharmacyId, a.pharmacyId),
    eq(purchases.customerId, customerId),
    eq(purchaseItems.medicineId, medicineId),
  );
  const rows = await db
    .select({
      item: purchaseItems,
      purchaseId: purchases.id,
      sequence: purchases.sequence,
      purchaseDate: purchases.purchaseDate,
      status: purchases.status,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
    .where(where)
    .orderBy(desc(purchases.purchaseDate), desc(purchases.sequence), asc(purchaseItems.position))
    .limit(25)
    .offset((page - 1) * 25);
  const [total] = await db
    .select({ count: count() })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
    .where(where);
  return { rows, total: total.count };
}
export async function purchaseDetail(a: Actor, id: string) {
  const [row] = await db
    .select({ purchase: purchases, customer: customers, follow: followUps })
    .from(purchases)
    .innerJoin(customers, eq(purchases.customerId, customers.id))
    .leftJoin(followUps, and(eq(purchases.id, followUps.purchaseId), isNull(followUps.supplyId)))
    .where(and(eq(purchases.id, id), eq(purchases.pharmacyId, a.pharmacyId)));
  if (!row) return null;
  const items = await db
    .select()
    .from(purchaseItems)
    .where(eq(purchaseItems.purchaseId, id))
    .orderBy(purchaseItems.position);
  const supplies = await db
    .select({ supply: medicineSupplies, follow: followUps })
    .from(medicineSupplies)
    .leftJoin(followUps, eq(followUps.supplyId, medicineSupplies.id))
    .where(and(eq(medicineSupplies.purchaseId, id), eq(medicineSupplies.included, true)));
  const allFollows = await db
    .select({ id: followUps.id })
    .from(followUps)
    .where(eq(followUps.purchaseId, id));
  const events = allFollows.length
    ? await db
        .select()
        .from(followUpEvents)
        .where(
          inArray(
            followUpEvents.followUpId,
            allFollows.map((f) => f.id),
          ),
        )
        .orderBy(desc(followUpEvents.createdAt))
        .limit(100)
    : [];
  const audit = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, id), eq(auditEvents.pharmacyId, a.pharmacyId)))
    .orderBy(desc(auditEvents.createdAt))
    .limit(100);
  return { ...row, items, supplies, events, audit };
}
export async function dashboard(
  a: Actor,
  tab = 'attention',
  page = 1,
  pageSize = 12,
  groupCustomers = false,
) {
  const today = pharmacyToday();
  const condition =
    tab === 'closed'
      ? eq(followUps.status, 'closed')
      : and(
          eq(followUps.status, 'open'),
          tab === 'scheduled' ? gt(followUps.nextDate, today) : lte(followUps.nextDate, today),
        );
  const where = and(eq(followUps.pharmacyId, a.pharmacyId), condition);
  const selectedCustomers = groupCustomers
    ? await db
        .select({ id: purchases.customerId, next: sql<string>`min(${followUps.nextDate})` })
        .from(followUps)
        .innerJoin(purchases, eq(followUps.purchaseId, purchases.id))
        .where(where)
        .groupBy(purchases.customerId)
        .orderBy(asc(sql`min(${followUps.nextDate})`), asc(purchases.customerId))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
    : [];
  const cardsQuery = db
    .select({
      follow: followUps,
      purchase: purchases,
      customer: customers,
      supply: medicineSupplies,
    })
    .from(followUps)
    .innerJoin(purchases, eq(followUps.purchaseId, purchases.id))
    .innerJoin(customers, eq(purchases.customerId, customers.id))
    .leftJoin(medicineSupplies, eq(followUps.supplyId, medicineSupplies.id))
    .where(
      and(
        where,
        groupCustomers
          ? selectedCustomers.length
            ? inArray(
                purchases.customerId,
                selectedCustomers.map((c) => c.id),
              )
            : sql`false`
          : undefined,
      ),
    )
    .orderBy(asc(followUps.nextDate), asc(followUps.id))
    .$dynamic();
  const cards = await (groupCustomers
    ? cardsQuery
    : cardsQuery.limit(pageSize).offset((page - 1) * pageSize));
  const [customerTotal] = await db
    .select({ count: countDistinct(purchases.customerId) })
    .from(followUps)
    .innerJoin(purchases, eq(followUps.purchaseId, purchases.id))
    .where(where);
  const [total] = await db.select({ count: count() }).from(followUps).where(where);
  const [stats] = await db
    .select({
      due: sql<number>`count(*) filter (where status='open' and next_date=${today})::int`,
      overdue: sql<number>`count(*) filter (where status='open' and next_date<${today})::int`,
    })
    .from(followUps)
    .where(eq(followUps.pharmacyId, a.pharmacyId));
  const [buy] = await db
    .select({ count: count() })
    .from(purchases)
    .where(
      and(
        eq(purchases.pharmacyId, a.pharmacyId),
        eq(purchases.purchaseDate, today),
        eq(purchases.status, 'active'),
      ),
    );
  const [people] = await db
    .select({ count: count() })
    .from(customers)
    .where(and(eq(customers.pharmacyId, a.pharmacyId), isNull(customers.archivedAt)));
  const items = cards.length
    ? await db
        .select()
        .from(purchaseItems)
        .where(
          inArray(
            purchaseItems.purchaseId,
            cards.map((c) => c.purchase.id),
          ),
        )
        .orderBy(purchaseItems.position)
    : [];
  const latest = cards.length
    ? await db
        .selectDistinctOn([followUpEvents.followUpId])
        .from(followUpEvents)
        .where(
          and(
            inArray(
              followUpEvents.followUpId,
              cards.map((c) => c.follow.id),
            ),
            sql`${followUpEvents.note} <> ''`,
            inArray(followUpEvents.action, ['contact', 'snooze', 'close', 'reopen']),
          ),
        )
        .orderBy(followUpEvents.followUpId, desc(followUpEvents.createdAt))
    : [];
  return {
    today,
    cards: cards.map((c) => ({
      ...c,
      items: items
        .filter(
          (i) =>
            i.purchaseId === c.purchase.id && (!c.supply || i.medicineId === c.supply.medicineId),
        )
        .filter(
          (item, index, matching) =>
            matching.findIndex((i) => i.medicineId === item.medicineId) === index,
        ),
      eligible:
        c.purchase.status === 'active' &&
        (c.supply
          ? c.supply.included && c.supply.reminderEnabled && !c.follow.pausedState
          : c.purchase.reminderEnabled),
      runOutDate: c.supply?.runOutDate ?? c.purchase.runOutDate,
      note: latest.find((e) => e.followUpId === c.follow.id)?.note,
    })),
    total: total.count,
    customerTotal: customerTotal.count,
    stats: { ...stats, purchases: buy.count, customers: people.count },
  };
}

export async function currentMedicineSupplies(a: Actor, customerId: string, page = 1) {
  const where = and(
    eq(medicineSupplies.pharmacyId, a.pharmacyId),
    eq(medicineSupplies.customerId, customerId),
    eq(medicineSupplies.included, true),
    eq(purchases.status, 'active'),
  );
  const rows = await db
    .selectDistinctOn([medicineSupplies.medicineId], {
      supply: medicineSupplies,
      follow: followUps,
      medicine: medicines,
    })
    .from(medicineSupplies)
    .innerJoin(purchases, eq(purchases.id, medicineSupplies.purchaseId))
    .innerJoin(medicines, eq(medicines.id, medicineSupplies.medicineId))
    .leftJoin(followUps, eq(followUps.supplyId, medicineSupplies.id))
    .where(where)
    .orderBy(medicineSupplies.medicineId, desc(purchases.purchaseDate), desc(purchases.sequence))
    .limit(25)
    .offset((page - 1) * 25);
  const [total] = await db
    .select({ count: countDistinct(medicineSupplies.medicineId) })
    .from(medicineSupplies)
    .innerJoin(purchases, eq(purchases.id, medicineSupplies.purchaseId))
    .where(where);
  return { rows, total: total.count };
}
