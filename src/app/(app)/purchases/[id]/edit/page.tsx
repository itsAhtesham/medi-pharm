import { notFound } from 'next/navigation';
import { requirePage } from '@/server/session';
import { purchaseDetail } from '@/server/queries';
import { PageHeader } from '@/components/shared';
import { PurchaseForm } from '@/components/purchase-form';
import { id, units } from '@/lib/validation';
export default async function EditPurchase({ params }: { params: Promise<{ id: string }> }) {
  const a = await requirePage();
  const p = await params;
  if (!id.safeParse(p.id).success) notFound();
  const d = await purchaseDetail(a, p.id);
  if (!d || d.purchase.status !== 'active') notFound();
  return (
    <>
      <PageHeader
        title="Correct purchase"
        description="Review changes to each medicine’s supply and record why they are needed."
      />
      <PurchaseForm
        initial={{
          legacy: d.purchase.supplyModel === 'legacy',
          customer: { id: d.customer.id, label: d.customer.name },
          medicines: Object.fromEntries(
            d.items.map((i) => [i.medicineId, `${i.name} ${i.strength}`]),
          ),
          values: {
            id: d.purchase.id,
            version: d.purchase.version,
            customerId: d.customer.id,
            purchaseDate: d.purchase.purchaseDate,
            notes: d.purchase.notes,
            items: d.items.map((i) => ({
              medicineId: i.medicineId,
              quantity: Number(i.quantity),
              unit: i.unit as (typeof units)[number],
            })),
            supplies: d.supplies.map(({ supply: s }) => ({
              medicineId: s.medicineId,
              supplyStart: s.supplyStart,
              supplyDays: s.supplyDays,
              mode: s.mode,
              remainingOverride: s.remainingOverride,
              reminderEnabled: s.reminderEnabled,
              manualDate: s.manualDate ?? '',
              lateConfirmed: false,
              reopenDisabled: false,
              expectedRevision: '',
            })),
          },
        }}
      />
    </>
  );
}
