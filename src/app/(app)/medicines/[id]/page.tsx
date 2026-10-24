import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/server/session';
import { medicineDetail, medicinePurchaseHistory } from '@/server/queries';
import { PageHeader, Empty, Pagination, pageNumber, Status } from '@/components/shared';
import { CatalogForm, ArchiveButton } from '@/components/catalog-form';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { formatDate, isDate } from '@/lib/dates';
import { id } from '@/lib/validation';

export default async function MedicinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePage();
  const p = await params;
  if (!id.safeParse(p.id).success) notFound();
  const medicine = await medicineDetail(actor, p.id);
  if (!medicine) notFound();
  const raw = await searchParams;
  const param = (key: string) => (typeof raw[key] === 'string' ? raw[key] : '');
  const q = param('q').trim().slice(0, 120);
  const from = param('from');
  const to = param('to');
  const page = pageNumber(param('page'));
  const dateError =
    (from && !isDate(from)) || (to && !isDate(to))
      ? 'Enter valid purchase dates.'
      : from && to && from > to
        ? 'Purchase date from must be on or before purchase date to.'
        : '';
  const data = dateError
    ? { rows: [], total: 0 }
    : await medicinePurchaseHistory(actor, medicine.id, { q, from, to, page });
  const base = `/medicines/${medicine.id}`;
  return (
    <>
      <Link
        href={medicine.archivedAt ? '/medicines?archived=true' : '/medicines'}
        className="mb-5 inline-block text-sm text-primary"
      >
        ← Back to medicines
      </Link>
      <PageHeader
        title={medicine.name}
        description={[
          medicine.strength,
          medicine.form,
          medicine.archivedAt ? 'Archived medicine' : 'Active medicine',
        ]
          .filter(Boolean)
          .join(' · ')}
        action={
          <div className="flex gap-2">
            <CatalogForm kind="medicine" record={medicine} />
            <ArchiveButton
              kind="medicine"
              id={medicine.id}
              version={medicine.version}
              archived={!!medicine.archivedAt}
            />
          </div>
        }
      />
      <h2 className="section-title">Purchase history</h2>
      <p className="mb-5 mt-2 text-sm text-muted-foreground">
        Who bought this medicine and when, newest first. Repeat purchases and different units remain
        separate entries; cancelled purchases are marked.
      </p>
      <form
        key={`${q}:${from}:${to}`}
        className="mb-5 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_180px_180px_auto_auto]"
      >
        <div className="field">
          <label htmlFor="medicine-customer">Customer</label>
          <input
            id="medicine-customer"
            name="q"
            placeholder="Search customer name or phone"
            maxLength={120}
            defaultValue={q}
          />
        </div>
        <div className="field">
          <label htmlFor="medicine-date-from">Purchase date from</label>
          <DatePicker key={from ?? ''} id="medicine-date-from" name="from" defaultValue={from} />
        </div>
        <div className="field">
          <label htmlFor="medicine-date-to">Purchase date to</label>
          <DatePicker key={to ?? ''} id="medicine-date-to" name="to" defaultValue={to} />
        </div>
        <Button variant="outline">Apply filters</Button>
        {(q || from || to) && (
          <Button variant="ghost" asChild>
            <Link href={base}>Clear filters</Link>
          </Button>
        )}
      </form>
      {dateError && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {dateError}
        </p>
      )}
      <div className="table-wrap">
        {data.rows.length ? (
          <table aria-label="Medicine purchase history">
            <thead>
              <tr>
                <th>Date bought</th>
                <th>Customer</th>
                <th>Quantity</th>
                <th>Unit</th>
                <th>Purchase</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(({ item, purchase, customer }) => (
                <tr key={item.id} className="align-top">
                  <td className="whitespace-nowrap">{formatDate(purchase.purchaseDate)}</td>
                  <td>
                    <Link
                      href={`/customers/${customer.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {customer.name}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {customer.phone}
                      {customer.archivedAt ? ' · Archived' : ''}
                    </p>
                  </td>
                  <td>{Number(item.quantity)}</td>
                  <td>{item.unit}</td>
                  <td>
                    <Link
                      href={`/purchases/${purchase.id}`}
                      className="text-primary hover:underline"
                    >
                      MP-{String(purchase.sequence).padStart(5, '0')}
                    </Link>
                    {(item.name !== medicine.name ||
                      item.strength !== medicine.strength ||
                      item.form !== medicine.form) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Recorded as:{' '}
                        {[item.name, item.strength, item.form].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </td>
                  <td>
                    <Status value={purchase.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            title={dateError ? 'Check the date filters' : 'No purchases found'}
            description={
              dateError
                ? 'Correct the dates above and apply filters again.'
                : q || from || to
                  ? 'Try another customer or date range, or clear the filters.'
                  : page > 1
                    ? 'Use Previous to return to earlier entries.'
                    : 'Purchases of this medicine will appear here once recorded.'
            }
          />
        )}
      </div>
      {!dateError && (
        <Pagination total={data.total} page={page} base={base} query={{ q, from, to }} />
      )}
    </>
  );
}
