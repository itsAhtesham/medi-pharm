import Link from 'next/link';
import { Bell, Clock, ShoppingBag, Users, ArrowUpRight, CalendarDays } from 'lucide-react';
import { requirePage } from '@/server/session';
import { dashboard, purchaseList } from '@/server/queries';
import { formatDate } from '@/lib/dates';
import { followUpState } from '@/lib/follow-up-state';
import { PageHeader, Empty } from '@/components/shared';
import { FollowActions } from '@/components/follow-actions';
import { DashboardRefresh } from '@/components/shell';
import { Button } from '@/components/ui/button';
export default async function Dashboard() {
  const a = await requirePage();
  const data = await dashboard(a, 'attention', 1, 5, true);
  const groups = [...new Set(data.cards.map((c) => c.customer.id))].map((id) => ({
    customer: data.cards.find((c) => c.customer.id === id)!.customer,
    reminders: data.cards.filter((c) => c.customer.id === id),
  }));
  const recent = await purchaseList(a);
  const metrics = [
    [
      'Due today',
      data.stats.due,
      Bell,
      'bg-secondary text-primary',
      'Ready for a conversation',
      null,
    ],
    [
      'Overdue follow-ups',
      data.stats.overdue,
      Clock,
      'bg-amber-50 text-amber-700',
      'A little attention needed',
      null,
    ],
    [
      'Purchases today',
      data.stats.purchases,
      ShoppingBag,
      'bg-sky-50 text-sky-700',
      'Recorded at your pharmacy',
      `/purchases?from=${data.today}&to=${data.today}&status=active`,
    ],
    [
      'Total customers',
      data.stats.customers,
      Users,
      'bg-emerald-50 text-emerald-700',
      'People in your care',
      '/customers',
    ],
  ] as const;
  return (
    <>
      <DashboardRefresh />
      <PageHeader
        title="A good day to care."
        description="Here’s what needs your attention at the pharmacy."
        action={
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays size={15} />
            {formatDate(data.today)}
          </span>
        }
      />
      <div className="mb-8 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {metrics.map(([label, value, Icon, color, caption, href]) => {
          const content = (
            <>
              <div className="mb-5 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{label}</span>
                <span className={'rounded-xl p-2 ' + color}>
                  <Icon size={18} />
                </span>
              </div>
              <div className="text-3xl font-semibold tracking-tight">{value}</div>
              <p className="mt-2 text-[11px] text-muted-foreground">{caption}</p>
            </>
          );
          return href ? (
            <Link
              key={label}
              href={href}
              className="panel p-5! transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {content}
            </Link>
          ) : (
            <div key={label} className="panel p-5!">
              {content}
            </div>
          );
        })}
      </div>
      <section aria-labelledby="contact-list-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="contact-list-title" className="section-title">
                Customers to contact
              </h2>
              <span
                className="badge bg-secondary text-primary"
                aria-label={`${data.customerTotal} customers need attention`}
              >
                {data.customerTotal}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.total} due or overdue reminders, grouped by customer.
            </p>
          </div>
          <Link
            href="/follow-ups"
            className="flex items-center gap-1 text-xs font-medium text-primary"
          >
            View all follow-ups
            <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="table-wrap">
          {data.cards.length ? (
            <table aria-label="Follow-ups needing attention">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Medicines & next contact</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(({ customer: c, reminders }) => (
                  <tr key={c.id} className="align-top">
                    <td>
                      <Link href={`/customers/${c.id}`} className="font-medium hover:text-primary">
                        {c.name}
                      </Link>
                      <a
                        href={`tel:${c.phoneNormalized}`}
                        className="mt-1 block text-xs text-muted-foreground"
                      >
                        {c.phone}
                      </a>
                    </td>
                    <td>
                      <div className="space-y-4">
                        {reminders.map(
                          ({ follow: f, purchase: p, items, eligible, runOutDate, note }) => (
                            <div
                              key={f.id}
                              className="flex flex-wrap items-center justify-between gap-3"
                            >
                              <div>
                                <p className="font-medium">
                                  {[...new Set(items.map((i) => `${i.name} ${i.strength}`))].join(
                                    ', ',
                                  )}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {!f.supplyId ? 'Legacy shared reminder · ' : ''}
                                  {followUpState(f, data.today).label} · {formatDate(f.nextDate)} ·
                                  Estimated run-out {formatDate(runOutDate)}
                                </p>
                                {note && (
                                  <details className="mt-2 text-xs text-muted-foreground">
                                    <summary className="cursor-pointer hover:text-primary">
                                      View latest note
                                    </summary>
                                    <p className="mt-2 whitespace-pre-wrap break-words">{note}</p>
                                  </details>
                                )}
                              </div>
                              <FollowActions
                                id={f.id}
                                version={f.version}
                                status={f.status}
                                nextDate={f.nextDate}
                                lastContactedAt={f.lastContactedAt}
                                purchaseId={p.id}
                                medicineId={f.medicineId}
                                eligible={eligible}
                              />
                            </div>
                          ),
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty
              title="You’re all caught up"
              description="Customers who need a call will appear here when their next follow-up is due."
            />
          )}
        </div>
        {data.customerTotal > groups.length && (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing {groups.length} of {data.customerTotal} customers.{' '}
            <Link href="/follow-ups" className="text-primary hover:underline">
              See the full list →
            </Link>
          </p>
        )}
      </section>
      <section className="mt-9">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="section-title">Recent purchases</h2>
          <Link href="/purchases" className="flex items-center gap-1 text-xs text-primary">
            View all
            <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="table-wrap">
          {recent.rows.length ? (
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Purchase</th>
                  <th>Date</th>
                  <th>Earliest follow-up</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recent.rows
                  .slice(0, 5)
                  .map(({ purchase: p, customer: c, follow: f, followMedicine }) => (
                    <tr key={p.id}>
                      <td className="font-medium">{c.name}</td>
                      <td className="text-muted-foreground">
                        MP-{String(p.sequence).padStart(5, '0')}
                      </td>
                      <td>{formatDate(p.purchaseDate)}</td>
                      <td>
                        <span className="badge bg-background text-muted-foreground">
                          {p.status === 'cancelled'
                            ? 'Cancelled'
                            : f
                              ? f.status === 'open'
                                ? formatDate(f.nextDate)
                                : 'Closed'
                              : 'Not requested'}
                        </span>
                        {p.status !== 'cancelled' && f?.status === 'open' && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {followMedicine}
                          </span>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/purchases/${p.id}`}
                          aria-label={`View purchase ${p.sequence}`}
                        >
                          <ArrowUpRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <Empty
              title="Your first purchase starts here"
              description="Add a customer, their medicines, and an optional refill reminder."
            >
              <Button asChild>
                <Link href="/purchases/new">Add purchase</Link>
              </Button>
            </Empty>
          )}
        </div>
      </section>
    </>
  );
}
