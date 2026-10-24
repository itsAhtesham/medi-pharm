import Link from 'next/link';
import { requirePage } from '@/server/session';
import { catalog } from '@/server/queries';
import { PageHeader, Pagination, Empty, pageNumber } from '@/components/shared';
import { CatalogForm, ArchiveButton } from '@/components/catalog-form';
import { Button } from '@/components/ui/button';
export default async function Customers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string; page?: string }>;
}) {
  const a = await requirePage();
  const q = await searchParams;
  const page = pageNumber(q.page);
  const data = await catalog(a, 'customer', q.q, q.archived === 'true', page);
  return (
    <>
      <PageHeader
        title="Customers"
        description="Familiar faces. All their details in one place."
        action={<CatalogForm kind="customer" />}
      />
      <form className="mb-5 flex flex-wrap gap-3">
        <input
          name="q"
          aria-label="Search by name or phone"
          placeholder="Search by name or phone"
          defaultValue={q.q}
          className="max-w-sm"
        />
        <select
          name="archived"
          aria-label="Customer status"
          defaultValue={q.archived ?? 'false'}
          className="max-w-44"
        >
          <option value="false">Active customers</option>
          <option value="true">Archived customers</option>
        </select>
        <Button variant="outline">Apply search</Button>
      </form>
      <div className="table-wrap">
        {data.rows.length ? (
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th>Age (years)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(
                (c) =>
                  'phone' in c && (
                    <tr key={c.id}>
                      <td>
                        <Link
                          href={`/customers/${c.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td>
                        <a href={`tel:${c.phoneNormalized}`}>{c.phone}</a>
                      </td>
                      <td>{c.age ?? '—'}</td>
                      <td>
                        <div className="flex gap-2">
                          <CatalogForm kind="customer" record={c} />
                          <ArchiveButton
                            kind="customer"
                            id={c.id}
                            version={c.version}
                            archived={!!c.archivedAt}
                          />
                        </div>
                      </td>
                    </tr>
                  ),
              )}
            </tbody>
          </table>
        ) : (
          <Empty
            title="No customers found"
            description="Add your first customer or try another search."
          />
        )}
      </div>
      <Pagination
        total={data.total}
        page={page}
        base="/customers"
        query={{ q: q.q ?? '', archived: q.archived ?? 'false' }}
      />
    </>
  );
}
