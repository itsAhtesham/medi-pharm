import Link from 'next/link';
import { Phone, CheckCheck } from 'lucide-react';
import { requirePage } from '@/server/session';
import { dashboard } from '@/server/queries';
import { formatDate } from '@/lib/dates';
import { followUpState } from '@/lib/follow-up-state';
import { PageHeader, Empty, Pagination, pageNumber } from '@/components/shared';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { FollowActions } from '@/components/follow-actions';
import { DashboardRefresh } from '@/components/shell';
export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const a = await requirePage();
  const q = await searchParams;
  const page = pageNumber(q.page);
  const tab = ['scheduled', 'closed'].includes(q.tab ?? '') ? q.tab! : 'attention';
  const data = await dashboard(a, tab, page, 12, true);
  const groups = [...new Set(data.cards.map((card) => card.customer.id))].map((customerId) => ({
    customer: data.cards.find((card) => card.customer.id === customerId)!.customer,
    reminders: data.cards.filter((card) => card.customer.id === customerId),
  }));
  return (
    <>
      <DashboardRefresh />
      <PageHeader
        title="Follow-ups"
        description="Review reminders, contact customers, and keep every next step organized."
      />
      <section>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="section-title">
              Follow-up queue{' '}
              <span className="badge ml-2 bg-secondary text-primary">
                {data.customerTotal} {data.customerTotal === 1 ? 'customer' : 'customers'}
              </span>
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.total} {data.total === 1 ? 'follow-up' : 'follow-ups'} ·{' '}
              {tab === 'attention'
                ? 'Due and overdue follow-ups, earliest first.'
                : tab === 'scheduled'
                  ? 'Upcoming conversations with your customers.'
                  : 'Completed and closed follow-ups.'}
            </p>
          </div>
          <div className="flex rounded-xl border bg-white p-1">
            {[
              ['attention', 'Needs attention'],
              ['scheduled', 'Scheduled'],
              ['closed', 'Closed'],
            ].map(([key, label]) => (
              <Link
                key={key}
                href={`?tab=${key}`}
                aria-current={tab === key ? 'page' : undefined}
                className={
                  'rounded-lg px-3 py-2 text-xs ' +
                  (tab === key
                    ? 'bg-secondary font-semibold text-primary'
                    : 'text-muted-foreground')
                }
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
        {data.cards.length ? (
          <Accordion
            type="multiple"
            key={tab}
            className="overflow-hidden rounded-xl border bg-white"
          >
            {groups.map(({ customer: c, reminders }) => {
              const overdue = reminders.filter(
                (r) =>
                  r.follow.status === 'open' &&
                  r.follow.nextDate < data.today &&
                  !followUpState(r.follow, data.today).awaitingRefill,
              ).length;
              const due = reminders.filter(
                (r) =>
                  r.follow.status === 'open' &&
                  r.follow.nextDate === data.today &&
                  !followUpState(r.follow, data.today).awaitingRefill,
              ).length;
              const scheduled = reminders.filter(
                (r) => r.follow.status === 'open' && r.follow.nextDate > data.today,
              ).length;
              const closed = reminders.filter((r) => r.follow.status === 'closed').length;
              const awaiting = reminders.filter(
                (r) => followUpState(r.follow, data.today).awaitingRefill,
              ).length;
              return (
                <AccordionItem key={c.id} value={c.id}>
                  <AccordionTrigger aria-label={`${c.name} follow-ups`}>
                    <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-2">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="font-semibold break-words [overflow-wrap:anywhere]">
                          {c.name}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                          <Phone size={12} aria-hidden />
                          {c.phone}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-2">
                        {awaiting > 0 && (
                          <span className="badge bg-emerald-50 text-emerald-800">
                            {awaiting} awaiting refill
                          </span>
                        )}
                        {overdue > 0 && (
                          <span className="badge bg-amber-50 text-amber-800">
                            {overdue} overdue
                          </span>
                        )}
                        {due > 0 && (
                          <span className="badge bg-secondary text-primary">{due} due today</span>
                        )}
                        {scheduled > 0 && (
                          <span className="badge bg-emerald-50 text-emerald-800">
                            {scheduled} scheduled
                          </span>
                        )}
                        {closed > 0 && (
                          <span className="badge bg-muted text-muted-foreground">
                            {closed} closed
                          </span>
                        )}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="mb-2 flex flex-wrap gap-x-5 gap-y-2 border-t pt-3 text-xs text-primary">
                      <Link href={`/customers/${c.id}`} className="hover:underline">
                        View customer
                      </Link>
                      <a href={`tel:${c.phoneNormalized}`} className="hover:underline">
                        Call {c.phone}
                      </a>
                    </div>
                    <div
                      aria-hidden
                      className="hidden gap-4 border-b py-2 text-xs text-muted-foreground xl:grid xl:grid-cols-[minmax(0,1fr)_150px_160px_230px]"
                    >
                      <span>Medicine</span>
                      <span>Estimated run-out</span>
                      <span>Next contact</span>
                      <span>Actions</span>
                    </div>
                    <ul className="divide-y">
                      {reminders.map(
                        ({ follow: f, purchase: p, items, note, eligible, runOutDate }) => (
                          <li
                            key={f.id}
                            className="grid grid-cols-2 items-start gap-x-4 gap-y-3 py-3 xl:grid-cols-[minmax(0,1fr)_150px_160px_230px]"
                          >
                            <div className="col-span-2 min-w-0 xl:col-span-1">
                              <p className="font-medium break-words">
                                {items.map((i) => `${i.name} ${i.strength}`).join(', ')}
                              </p>
                              {!f.supplyId && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Legacy shared reminder
                                </p>
                              )}
                              {note && (
                                <details className="mt-2 text-xs text-muted-foreground">
                                  <summary className="cursor-pointer hover:text-primary">
                                    View latest note
                                  </summary>
                                  <p className="mt-2 whitespace-pre-wrap break-words">{note}</p>
                                </details>
                              )}
                            </div>
                            <div>
                              <span className="mb-1 block text-xs text-muted-foreground xl:sr-only">
                                Estimated run-out
                              </span>
                              {formatDate(runOutDate)}
                            </div>
                            <div>
                              <span className="mb-1 block text-xs text-muted-foreground xl:sr-only">
                                Next contact
                              </span>
                              {f.status === 'closed' ? (
                                <>
                                  <span className="badge bg-muted text-muted-foreground">
                                    Closed
                                  </span>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {f.closedReason?.replaceAll('_', ' ')}
                                  </p>
                                </>
                              ) : (
                                <>
                                  <p>{formatDate(f.nextDate)}</p>
                                  <span
                                    className={
                                      'mt-1 inline-block text-xs ' +
                                      (followUpState(f, data.today).awaitingRefill
                                        ? 'text-emerald-700'
                                        : f.nextDate < data.today
                                          ? 'text-amber-800'
                                          : f.nextDate === data.today
                                            ? 'text-primary'
                                            : 'text-muted-foreground')
                                    }
                                  >
                                    {followUpState(f, data.today).label}
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="col-span-2 xl:col-span-1">
                              <FollowActions
                                id={f.id}
                                version={f.version}
                                status={f.status}
                                nextDate={f.nextDate}
                                lastContactedAt={f.lastContactedAt}
                                purchaseId={p.id}
                                eligible={eligible}
                                medicineId={f.medicineId}
                              />
                            </div>
                          </li>
                        ),
                      )}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        ) : (
          <div className="panel">
            <Empty
              title={tab === 'attention' ? 'You’re all caught up' : 'No follow-ups here yet'}
              description={
                tab === 'attention'
                  ? 'Customers who need a call will appear here when their next follow-up is due.'
                  : 'Enable a reminder when recording a purchase to plan the next conversation.'
              }
            >
              <CheckCheck className="mx-auto text-primary" />
            </Empty>
          </div>
        )}
        <Pagination
          total={data.customerTotal}
          page={page}
          size={12}
          itemName="customer"
          base="/follow-ups"
          query={{ tab }}
        />
      </section>
    </>
  );
}
