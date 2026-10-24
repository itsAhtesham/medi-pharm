import Link from 'next/link';
import { HistoryDetails } from '@/components/history-details';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { requirePage } from '@/server/session';
import { purchaseDetail } from '@/server/queries';
import { db } from '@/server/db';
import { purchases } from '@/server/db/schema';
import { PageHeader, Status } from '@/components/shared';
import { FollowActions, PurchaseCommands } from '@/components/follow-actions';
import { Button } from '@/components/ui/button';
import { formatDate, TIMEZONE } from '@/lib/dates';
import { id } from '@/lib/validation';
export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const a = await requirePage();
  const paramsValue = await params;
  if (!id.safeParse(paramsValue.id).success) notFound();
  const d = await purchaseDetail(a, paramsValue.id);
  if (!d) notFound();
  const { purchase: p, customer: c, follow: f } = d;
  const children = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(and(eq(purchases.refillOf, p.id), eq(purchases.pharmacyId, a.pharmacyId)))
    .limit(1);
  return (
    <>
      <PageHeader
        title={`Purchase MP-${String(p.sequence).padStart(5, '0')}`}
        description={`Recorded for ${c.name} · ${formatDate(p.purchaseDate)}`}
        action={
          <div className="flex gap-2">
            <Status value={p.status} />
            {p.status === 'active' && (
              <Button variant="outline" asChild>
                <Link href={`/purchases/${p.id}/edit`}>Correct purchase</Link>
              </Button>
            )}
          </div>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Quantity</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id}>
                    <td className="font-medium">
                      {i.name}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {i.strength} · {i.form}
                      </span>
                    </td>
                    <td>{Number(i.quantity)}</td>
                    <td>{i.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.supplyModel === 'medicine' && (
            <section className="panel">
              <h2 className="section-title mb-4">Medicine supplies & reminders</h2>
              <div className="space-y-5">
                {d.supplies.map(({ supply: s, follow }) => {
                  const item = d.items.find((i) => i.medicineId === s.medicineId);
                  return (
                    <article key={s.id} className="rounded-xl border p-4">
                      <h3 className="font-semibold">
                        {item?.name} {item?.strength}
                      </h3>
                      <p className="mt-2 text-sm">
                        {s.supplyDays} new days
                        {s.mode === 'extend'
                          ? ` + ${s.remainingUsed} carried days`
                          : ' · Started fresh'}{' '}
                        · Starts {formatDate(s.supplyStart)}
                      </p>
                      {s.remainingOverride !== null && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Remaining supply adjusted to {s.remainingOverride} days by the owner.
                        </p>
                      )}
                      <p className="mt-2 text-sm">
                        Estimated run-out: <strong>{formatDate(s.runOutDate)}</strong>
                      </p>
                      <p className="mt-2 text-sm">
                        {follow
                          ? `Follow-up: ${follow.status === 'open' ? formatDate(follow.nextDate) : follow.closedReason?.replaceAll('_', ' ')}`
                          : 'No follow-up requested'}
                      </p>
                      {follow && (
                        <div className="mt-3">
                          <FollowActions
                            id={follow.id}
                            version={follow.version}
                            status={follow.status}
                            nextDate={follow.nextDate}
                            lastContactedAt={follow.lastContactedAt}
                            purchaseId={p.id}
                            medicineId={s.medicineId}
                            eligible={
                              p.status === 'active' && s.reminderEnabled && !follow.pausedState
                            }
                          />
                        </div>
                      )}
                      {p.status === 'active' &&
                        !(
                          follow?.status === 'open' &&
                          s.reminderEnabled &&
                          !follow.pausedState
                        ) && (
                          <Link
                            className="mt-3 inline-block text-sm text-primary"
                            href={`/purchases/new?refill=${p.id}&medicine=${s.medicineId}`}
                          >
                            Record another purchase of this medicine →
                          </Link>
                        )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {p.notes && (
            <section className="panel">
              <h2 className="section-title">Purchase notes</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{p.notes}</p>
            </section>
          )}
          <section className="panel">
            <h2 className="section-title mb-5">Activity & history</h2>
            {[
              ...d.events.map((e) => ({
                id: e.id,
                action: e.action,
                note: e.note,
                createdAt: e.createdAt,
                detail: e.after,
              })),
              ...d.audit.map((e) => ({
                id: e.id,
                action: e.action,
                note: e.reason,
                createdAt: e.createdAt,
                detail: e.changes,
              })),
            ]
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .map((e) => (
                <div key={e.id} className="border-l-2 border-secondary pb-5 pl-4">
                  <p className="text-sm font-medium capitalize">{e.action.replaceAll('_', ' ')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {e.createdAt.toLocaleString('en-IN', { timeZone: TIMEZONE })} IST
                  </p>
                  {e.note && <p className="mt-2 whitespace-pre-wrap text-sm">{e.note}</p>}
                  <HistoryDetails value={e.detail} />
                </div>
              ))}
          </section>
        </div>
        <aside className="space-y-6">
          <section className="panel">
            <h2 className="section-title">Customer</h2>
            <Link href={`/customers/${c.id}`} className="mt-4 block font-medium text-primary">
              {c.name}
            </Link>
            <a href={`tel:${c.phoneNormalized}`} className="mt-2 block text-sm">
              {c.phone}
            </a>
          </section>
          {p.supplyModel === 'legacy' && (
            <section className="panel">
              <h2 className="section-title mb-4">Legacy shared follow-up</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                This uses one duration for the old purchase. Correct the purchase to confirm
                individual medicine durations.
              </p>
              {f ? (
                <>
                  <Status value={f.status} />
                  <dl className="my-5 space-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Supply start</dt>
                      <dd>{formatDate(p.supplyStart)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Expected run-out</dt>
                      <dd>{formatDate(p.runOutDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Calculated reminder</dt>
                      <dd>{formatDate(f.calculatedDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Manual reminder</dt>
                      <dd>{formatDate(f.manualDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Next action</dt>
                      <dd>{formatDate(f.nextDate)}</dd>
                    </div>
                    {f.closedReason && (
                      <div>
                        <dt className="text-xs text-muted-foreground">Closed reason</dt>
                        <dd>{f.closedReason.replaceAll('_', ' ')}</dd>
                      </div>
                    )}
                  </dl>
                  <FollowActions
                    id={f.id}
                    version={f.version}
                    status={f.status}
                    nextDate={f.nextDate}
                    lastContactedAt={f.lastContactedAt}
                    purchaseId={p.id}
                    eligible={p.status === 'active' && p.reminderEnabled}
                  />
                  {f.resolvingPurchaseId && (
                    <Link
                      className="mt-4 block text-xs text-primary"
                      href={`/purchases/${f.resolvingPurchaseId}`}
                    >
                      View resolving refill →
                    </Link>
                  )}
                  {p.status === 'active' && !(f.status === 'open' && p.reminderEnabled) && (
                    <Button asChild variant="outline" className="mt-4 w-full">
                      <Link href={`/purchases/new?refill=${p.id}`}>Record refill</Link>
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No reminder requested for this purchase.
                </p>
              )}
              {p.refillOf && (
                <Link className="mt-4 block text-xs text-primary" href={`/purchases/${p.refillOf}`}>
                  View original purchase →
                </Link>
              )}
            </section>
          )}
        </aside>
      </div>
      <div className="mt-6">
        <PurchaseCommands
          id={p.id}
          version={p.version}
          status={p.status}
          linked={!!p.refillOf || children.length > 0}
        />
      </div>
    </>
  );
}
