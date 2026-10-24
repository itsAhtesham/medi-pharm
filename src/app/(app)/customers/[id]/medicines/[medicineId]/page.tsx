import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePage } from '@/server/session';
import { customerDetail, customerMedicineHistory } from '@/server/queries';
import { PageHeader, Empty, Pagination, pageNumber, Status } from '@/components/shared';
import { formatDate } from '@/lib/dates';
import { id } from '@/lib/validation';

export default async function MedicineHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; medicineId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const actor = await requirePage();
  const p = await params;
  if (!id.safeParse(p.id).success || !id.safeParse(p.medicineId).success) notFound();
  const customer = await customerDetail(actor, p.id);
  if (!customer) notFound();
  const page = pageNumber((await searchParams).page);
  const history = await customerMedicineHistory(actor, customer.id, p.medicineId, page);
  if (!history.total) notFound();
  return (
    <>
      <Link
        href={`/customers/${customer.id}#medicine-history-title`}
        className="mb-5 inline-block text-sm text-primary"
      >
        ← Back to {customer.name}
      </Link>
      <PageHeader
        title="Medicine purchase dates"
        description={`${customer.name} · Each entry shows the medicine label, quantity and unit recorded at that purchase.`}
      />
      <p className="mb-4 text-sm text-muted-foreground">
        Newest first. Different units remain separate entries. Cancelled purchases are marked below.
      </p>
      <div className="table-wrap">
        {history.rows.length ? (
          <table aria-label="Medicine purchase dates">
            <thead>
              <tr>
                <th>Date bought</th>
                <th>Medicine at purchase</th>
                <th>Quantity</th>
                <th>Unit</th>
                <th>Purchase</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.rows.map(({ item, purchaseId, sequence, purchaseDate, status }) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap">{formatDate(purchaseDate)}</td>
                  <td>
                    <p className="font-medium">
                      {item.name}
                      {item.strength ? ` · ${item.strength}` : ''}
                    </p>
                    {item.form && <p className="mt-1 text-xs text-muted-foreground">{item.form}</p>}
                  </td>
                  <td>{Number(item.quantity)}</td>
                  <td>{item.unit}</td>
                  <td>
                    <Link href={`/purchases/${purchaseId}`} className="text-primary">
                      MP-{String(sequence).padStart(5, '0')}
                    </Link>
                  </td>
                  <td>
                    <Status value={status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            title="No entries on this page"
            description="Use Previous to return to earlier pages."
          />
        )}
      </div>
      <Pagination
        total={history.total}
        page={page}
        base={`/customers/${customer.id}/medicines/${p.medicineId}`}
      />
    </>
  );
}
