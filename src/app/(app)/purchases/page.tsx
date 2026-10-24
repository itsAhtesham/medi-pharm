import Link from 'next/link';
import { requirePage } from '@/server/session';
import { purchaseList } from '@/server/queries';
import { PageHeader, Pagination, Empty, pageNumber, Status } from '@/components/shared';
import { formatDate, isDate } from '@/lib/dates';
import { DatePicker } from '@/components/ui/date-picker';
import { Button } from '@/components/ui/button';
export default async function Purchases({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; from?: string; to?: string; status?: string; page?: string }>;
}) {
  const a = await requirePage();
  const q = await searchParams;
  const page = pageNumber(q.page);
  const data = await purchaseList(a, {
    ...q,
    from: q.from && isDate(q.from) ? q.from : undefined,
    to: q.to && isDate(q.to) ? q.to : undefined,
    page,
  });
  return (
    <>
      <PageHeader
        title="Purchases"
        description="Every customer purchase, with the story that follows."
      />
      <form className="mb-5 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_170px_170px_150px_auto]">
        <div className="field">
          <label htmlFor="filter-customer">Customer</label>
          <input id="filter-customer" name="q" placeholder="Search customer" defaultValue={q.q} />
        </div>
        <div className="field">
          <label htmlFor="filter-from">Purchase date from</label>
          <DatePicker key={q.from ?? ''} id="filter-from" name="from" defaultValue={q.from} />
        </div>
        <div className="field">
          <label htmlFor="filter-to">Purchase date to</label>
          <DatePicker key={q.to ?? ''} id="filter-to" name="to" defaultValue={q.to} />
        </div>
        <div className="field">
          <label htmlFor="filter-status">Status</label>
          <select id="filter-status" name="status" defaultValue={q.status ?? ''}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <Button variant="outline">Apply filters</Button>
      </form>
      <div className="table-wrap">
        {data.rows.length ? (
          <table>
            <thead>
              <tr>
                <th>Purchase</th>
                <th>Customer</th>
                <th>Purchase date</th>
                <th>Status</th>
                <th>Earliest follow-up</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(({ purchase: p, customer: c, follow: f, followMedicine }) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/purchases/${p.id}`} className="font-medium text-primary">
                      MP-{String(p.sequence).padStart(5, '0')}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/customers/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>{formatDate(p.purchaseDate)}</td>
                  <td>
                    <Status value={p.status} />
                  </td>
                  <td>
                    {p.status === 'cancelled' ? (
                      'Cancelled'
                    ) : f?.status === 'open' ? (
                      <>
                        {formatDate(f.nextDate)}
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {followMedicine}
                        </span>
                      </>
                    ) : f ? (
                      'Closed'
                    ) : (
                      'Not requested'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            title="No purchases found"
            description="Record a purchase or adjust your filters."
          />
        )}
      </div>
      <Pagination
        total={data.total}
        page={page}
        base="/purchases"
        query={{ q: q.q ?? '', from: q.from ?? '', to: q.to ?? '', status: q.status ?? '' }}
      />
    </>
  );
}
