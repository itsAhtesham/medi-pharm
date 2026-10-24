import { Download } from 'lucide-react';
import { requirePage } from '@/server/session';
import { pharmacy } from '@/server/queries';
import { SettingsForm } from '@/components/settings-form';
import { PageHeader } from '@/components/shared';
import { Button } from '@/components/ui/button';
export default async function Settings() {
  const a = await requirePage();
  const p = await pharmacy(a);
  return (
    <>
      <PageHeader title="Settings" description="Your pharmacy, account, and data." />
      <SettingsForm name={p.name} contact={p.contact} />
      <section className="panel mt-6">
        <h2 className="section-title">Export your records</h2>
        <p className="mb-5 mt-2 text-sm text-muted-foreground">
          Download CSV files for your records. Exports do not replace database backups.
        </p>
        <div className="flex flex-wrap gap-3">
          {['customers', 'medicines', 'purchases', 'items', 'supplies', 'followups', 'events'].map(
            (kind) => (
              <Button key={kind} variant="outline" asChild>
                <a href={`/api/exports?kind=${kind}`}>
                  <Download />
                  <span className="capitalize">{kind}</span>
                </a>
              </Button>
            ),
          )}
        </div>
      </section>
    </>
  );
}
