import Link from 'next/link';
import { followUpState } from '@/lib/follow-up-state';
import { notFound } from 'next/navigation';
import { and, eq, desc } from 'drizzle-orm';
import { requirePage } from '@/server/session';
import {
  customerDetail,
  purchaseList,
  customerMedicines,
  currentMedicineSupplies,
} from '@/server/queries';
import { db } from '@/server/db';
import { followUpEvents, followUps, purchases } from '@/server/db/schema';
import { PageHeader, Empty, Pagination, pageNumber, Status } from '@/components/shared';
import { CatalogForm } from '@/components/catalog-form';
import { daysBetween } from '@/lib/medicine-supply';
import { FollowActions } from '@/components/follow-actions';
import { formatDate, pharmacyToday, TIMEZONE } from '@/lib/dates';
import { id } from '@/lib/validation';
export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; medicinePage?: string; supplyPage?: string }>;
}) {
  const a = await requirePage();
  const p = await params;
  if (!id.safeParse(p.id).success) notFound();
  const c = await customerDetail(a, p.id);
  if (!c) notFound();
  const q = await searchParams;
  const page = pageNumber(q.page);
  const medicinePage = pageNumber(q.medicinePage);
  const supplyPage = pageNumber(q.supplyPage);
  const [history, medicineHistory, currentSupply] = await Promise.all([
    purchaseList(a, { customerId: c.id, page }),
    customerMedicines(a, c.id, medicinePage),
    currentMedicineSupplies(a, c.id, supplyPage),
  ]);
  const events = await db
    .select({ event: followUpEvents, purchaseId: purchases.id })
    .from(followUpEvents)
    .innerJoin(followUps, eq(followUpEvents.followUpId, followUps.id))
    .innerJoin(purchases, eq(followUps.purchaseId, purchases.id))
    .where(and(eq(purchases.customerId, c.id), eq(purchases.pharmacyId, a.pharmacyId)))
    .orderBy(desc(followUpEvents.createdAt))
    .limit(50);
  return (
    <>
      <PageHeader
        title={c.name}
        description={`${c.phone}${c.age !== null ? ` · Age: ${c.age} years (as recorded)` : ''}${c.archivedAt ? ' · Archived customer' : ''}`}
        action={<CatalogForm kind="customer" record={c} />}
      />
      {c.notes && <p className="panel mb-6 whitespace-pre-wrap text-sm">{c.notes}</p>}
      <section className="mb-8" aria-labelledby="current-supply-title">
        <h2 id="current-supply-title" className="section-title mb-2">
          Current medicine supply
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Estimates from recorded supply, not actual consumption. Legacy purchases need individual
          durations confirmed before appearing here.
        </p>
        <div className="table-wrap">
          {currentSupply.rows.length ? (
            <table aria-label="Current medicine supply">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Estimated supply</th>
                  <th>Run-out date</th>
                  <th>Follow-up</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentSupply.rows.map(({ supply: s, follow: f, medicine }) => {
                  const left = daysBetween(pharmacyToday(), s.runOutDate);
                  return (
                    <tr key={s.id}>
                      <td>
                        <p className="font-medium">
                          {medicine.name} {medicine.strength}
                        </p>
                        <p className="text-xs text-muted-foreground">{medicine.form}</p>
                      </td>
                      <td>
                        {s.supplyStart > pharmacyToday() ? (
                          `Starts ${formatDate(s.supplyStart)}`
                        ) : left <= 0 ? (
                          'Expected to have run out'
                        ) : (
                          <span className={left <= 7 ? 'text-amber-800' : ''}>
                            About {left} days left
                          </span>
                        )}
                      </td>
                      <td>{formatDate(s.runOutDate)}</td>
                      <td>
                        {!s.reminderEnabled ? (
                          'Not requested'
                        ) : f?.status === 'open' ? (
                          <>
                            {followUpState(f).label} · {formatDate(f.nextDate)}
                          </>
                        ) : (
                          (f?.closedReason?.replaceAll('_', ' ') ?? 'Not requested')
                        )}
                      </td>
                      <td>
                        {f && (
                          <FollowActions
                            id={f.id}
                            version={f.version}
                            status={f.status}
                            nextDate={f.nextDate}
                            lastContactedAt={f.lastContactedAt}
                            purchaseId={s.purchaseId}
                            medicineId={s.medicineId}
                            eligible={s.reminderEnabled && !f.pausedState}
                          />
                        )}
                        {!(f?.status === 'open' && s.reminderEnabled && !f.pausedState) && (
                          <Link
                            href={`/purchases/new?refill=${s.purchaseId}&medicine=${s.medicineId}`}
                            className="mt-2 inline-block text-xs text-primary"
                          >
                            Record refill
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty
              title="No medicine supply estimates yet"
              description="Record days of supply for each medicine in a new purchase, or confirm them by correcting a legacy purchase."
            />
          )}
        </div>
        <Pagination
          total={currentSupply.total}
          page={supplyPage}
          pageParam="supplyPage"
          base={`/customers/${c.id}`}
          query={{ page: String(page), medicinePage: String(medicinePage) }}
        />
      </section>
      <h2 className="section-title mb-4">Purchase history</h2>
      <div className="table-wrap">
        {history.rows.length ? (
          <table aria-label="Purchase history">
            <thead>
              <tr>
                <th>Purchase</th>
                <th>Purchase date</th>
                <th>Status</th>
                <th>Next follow-up</th>
              </tr>
            </thead>
            <tbody>
              {history.rows.map(({ purchase: p, follow: f }) => (
                <tr key={p.id} className="align-top">
                  <td>
                    <Link href={`/purchases/${p.id}`} className="text-primary">
                      MP-{String(p.sequence).padStart(5, '0')}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{formatDate(p.purchaseDate)}</td>
                  <td>
                    <Status value={p.status} />
                  </td>
                  <td>
                    {f?.status === 'open' ? formatDate(f.nextDate) : f ? 'Closed' : 'Not requested'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            title="No purchases yet"
            description="This customer’s purchases will appear here."
          />
        )}
      </div>
      <Pagination
        total={history.total}
        page={page}
        base={`/customers/${c.id}`}
        query={{ medicinePage: String(medicinePage), supplyPage: String(supplyPage) }}
      />
      <section className="mt-8" aria-labelledby="medicine-history-title">
        <h2 id="medicine-history-title" className="section-title">
          Medicine history
        </h2>
        <p className="mb-4 mt-2 text-sm text-muted-foreground">
          Each medicine appears once. Open its history to see every purchase date and quantity.
        </p>
        <div className="table-wrap">
          {medicineHistory.rows.length ? (
            <table aria-label="Medicine history">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Purchases</th>
                  <th>Latest recorded date</th>
                  <th>History</th>
                </tr>
              </thead>
              <tbody>
                {medicineHistory.rows.map((medicine) => (
                  <tr key={medicine.medicineId}>
                    <td>
                      <p className="font-medium">
                        {medicine.name}
                        {medicine.strength ? ` · ${medicine.strength}` : ''}
                      </p>
                      {medicine.form && (
                        <p className="mt-1 text-xs text-muted-foreground">{medicine.form}</p>
                      )}
                    </td>
                    <td>
                      <p>
                        {medicine.purchaseCount}{' '}
                        {medicine.purchaseCount === 1 ? 'purchase' : 'purchases'}
                      </p>
                      {medicine.cancelledCount > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {medicine.cancelledCount} cancelled
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap">{formatDate(medicine.latestDate)}</td>
                    <td>
                      <Link
                        href={`/customers/${c.id}/medicines/${medicine.medicineId}`}
                        className="text-primary"
                      >
                        View dates & quantities
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty
              title="No medicine history yet"
              description="Medicines will appear here after a purchase is recorded for this customer."
            />
          )}
        </div>
        <Pagination
          total={medicineHistory.total}
          page={medicinePage}
          pageParam="medicinePage"
          base={`/customers/${c.id}`}
          query={{ page: String(page), supplyPage: String(supplyPage) }}
        />
      </section>
      <section className="panel mt-8">
        <h2 className="section-title mb-5">Contact & follow-up timeline</h2>
        {events.length ? (
          events.map(({ event: e, purchaseId }) => (
            <div key={e.id} className="border-l-2 border-secondary pb-5 pl-4">
              <Link
                href={`/purchases/${purchaseId}`}
                className="text-sm font-medium capitalize text-primary"
              >
                {e.action.replaceAll('_', ' ')}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                {e.createdAt.toLocaleString('en-IN', { timeZone: TIMEZONE })} IST
              </p>
              {e.note && <p className="mt-2 text-sm">{e.note}</p>}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            Contact notes and reminder actions will appear here.
          </p>
        )}
      </section>
    </>
  );
}
