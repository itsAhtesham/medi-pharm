import Link from 'next/link';
import { requirePage } from '@/server/session';
import { catalog } from '@/server/queries';
import { PageHeader, Pagination, Empty, pageNumber } from '@/components/shared';
import { CatalogForm, ArchiveButton } from '@/components/catalog-form';
import { Button } from '@/components/ui/button';
export default async function Medicines({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string; page?: string }>;
}) {
  const a = await requirePage();
  const q = await searchParams;
  const page = pageNumber(q.page);
  const data = await catalog(a, 'medicine', q.q, q.archived === 'true', page);
  return (
    <>
      <PageHeader
        title="Medicines"
        description="Your medicine catalog, ready for quick purchase entry."
        action={<CatalogForm kind="medicine" />}
      />
      <form className="mb-5 flex flex-wrap gap-3">
        <input
          name="q"
          aria-label="Search medicines"
          placeholder="Search medicines or strength"
          defaultValue={q.q}
          className="max-w-sm"
        />
        <select
          name="archived"
          aria-label="Medicine status"
          defaultValue={q.archived ?? 'false'}
          className="max-w-44"
        >
          <option value="false">Active medicines</option>
          <option value="true">Archived medicines</option>
        </select>
        <Button variant="outline">Apply search</Button>
      </form>
      <div className="table-wrap">
        {data.rows.length ? (
          <table>
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Strength</th>
                <th>Form</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(
                (m) =>
                  'strength' in m && (
                    <tr key={m.id}>
                      <td>
                        <Link
                          href={`/medicines/${m.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {m.name}
                        </Link>
                      </td>
                      <td>{m.strength || '—'}</td>
                      <td>{m.form || '—'}</td>
                      <td>
                        <div className="flex gap-2">
                          <CatalogForm kind="medicine" record={m} />
                          <ArchiveButton
                            kind="medicine"
                            id={m.id}
                            version={m.version}
                            archived={!!m.archivedAt}
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
            title="No medicines found"
            description="Add a medicine with its strength and form, or try another search."
          />
        )}
      </div>
      <Pagination
        total={data.total}
        page={page}
        base="/medicines"
        query={{ q: q.q ?? '', archived: q.archived ?? 'false' }}
      />
    </>
  );
}
