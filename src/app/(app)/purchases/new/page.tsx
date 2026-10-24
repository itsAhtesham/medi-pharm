import { notFound } from 'next/navigation';
import { requirePage } from '@/server/session';
import { purchaseDetail } from '@/server/queries';
import { PageHeader } from '@/components/shared';
import { PurchaseForm, type PurchaseFormData } from '@/components/purchase-form';
import { id, units } from '@/lib/validation';
export default async function NewPurchase({
  searchParams,
}: {
  searchParams: Promise<{ refill?: string; medicine?: string }>;
}) {
  const a = await requirePage();
  const q = await searchParams;
  let initial: PurchaseFormData = { values: {} };
  if (q.refill) {
    if (!id.safeParse(q.refill).success) notFound();
    const d = await purchaseDetail(a, q.refill);
    if (!d || d.purchase.status !== 'active') notFound();
    if (
      q.medicine &&
      (!id.safeParse(q.medicine).success || !d.items.some((i) => i.medicineId === q.medicine))
    )
      notFound();
    initial = {
      sourceLabel: `MP-${String(d.purchase.sequence).padStart(5, '0')}`,
      customer: { id: d.customer.id, label: d.customer.name },
      medicines: Object.fromEntries(d.items.map((i) => [i.medicineId, `${i.name} ${i.strength}`])),
      values: {
        customerId: d.customer.id,
        items: d.items
          .filter((i) => !q.medicine || i.medicineId === q.medicine)
          .map((i) => ({
            medicineId: i.medicineId,
            quantity: Number(i.quantity),
            unit: i.unit as (typeof units)[number],
          })),
      },
    };
  }
  return (
    <>
      <PageHeader
        title={q.refill ? 'Record a refill' : 'Add purchase'}
        description="A few details now. A thoughtful follow-up later."
      />
      <PurchaseForm initial={initial} />
    </>
  );
}
