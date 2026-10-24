import { requirePage } from '@/server/session';
import { pharmacy } from '@/server/queries';
import { Shell } from '@/components/shell';
import { MutationProvider } from '@/components/mutation-provider';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const a = await requirePage();
  const p = await pharmacy(a);
  return (
    <MutationProvider userId={a.id}>
      <Shell name={p.name}>{children}</Shell>
    </MutationProvider>
  );
}
