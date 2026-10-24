import Link from 'next/link';
import { formatDate, TIMEZONE } from '@/lib/dates';
function Fields({ value }: { value: Record<string, unknown> }) {
  const items = Array.isArray(value.items) ? (value.items as Record<string, unknown>[]) : [];
  const supplies = Array.isArray(value.supplies)
    ? (value.supplies as Record<string, unknown>[])
    : [];
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      {typeof value.status === 'string' && <p>Status: {value.status}</p>}
      {typeof value.purchaseDate === 'string' && (
        <p>Purchase date: {formatDate(value.purchaseDate)}</p>
      )}
      {typeof value.supplyStart === 'string' && (
        <p>Supply starts: {formatDate(value.supplyStart)}</p>
      )}
      {typeof value.supplyDays === 'number' && <p>Supply: {value.supplyDays} days</p>}
      {typeof value.runOutDate === 'string' && (
        <p>Estimated run-out: {formatDate(value.runOutDate)}</p>
      )}
      {typeof value.remainingUsed === 'number' && <p>Carried supply: {value.remainingUsed} days</p>}
      {typeof value.remainingOverride === 'number' && (
        <p>Remaining supply adjusted to: {value.remainingOverride} days</p>
      )}
      {typeof value.mode === 'string' && (
        <p>Refill choice: {value.mode === 'extend' ? 'Add to remaining supply' : 'Start fresh'}</p>
      )}
      {typeof value.nextDate === 'string' && <p>Next follow-up: {formatDate(value.nextDate)}</p>}
      {typeof value.calculatedDate === 'string' && (
        <p>Calculated reminder: {formatDate(value.calculatedDate)}</p>
      )}
      {typeof value.manualDate === 'string' && (
        <p>Chosen reminder: {formatDate(value.manualDate)}</p>
      )}
      {typeof value.reminderEnabled === 'boolean' && (
        <p>Reminders: {value.reminderEnabled ? 'Enabled' : 'Disabled'}</p>
      )}
      {typeof value.closedReason === 'string' && (
        <p>Closure: {value.closedReason.replaceAll('_', ' ')}</p>
      )}
      {value.lastContactedAt != null && (
        <p>
          Contacted:{' '}
          {new Date(String(value.lastContactedAt)).toLocaleString('en-IN', { timeZone: TIMEZONE })}{' '}
          IST
        </p>
      )}
      {typeof value.resolvingPurchaseId === 'string' && (
        <Link className="block text-primary" href={`/purchases/${value.resolvingPurchaseId}`}>
          View resolving refill →
        </Link>
      )}
      {typeof value.notes === 'string' && value.notes && (
        <p className="whitespace-pre-wrap">Notes: {value.notes}</p>
      )}
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item, index) => (
            <li key={index}>
              {typeof item.name === 'string' ? item.name : 'Medicine'}{' '}
              {typeof item.strength === 'string' ? item.strength : ''} · {Number(item.quantity)}{' '}
              {String(item.unit)}
            </li>
          ))}
        </ul>
      )}
      {supplies.map((s, index) => {
        const item = items.find((i) => i.medicineId === s.medicineId);
        return (
          <div key={index} className="rounded-lg border p-2">
            <p className="mb-2 font-medium">
              {item ? `${item.name} ${item.strength}` : 'Medicine supply'}
            </p>
            <Fields value={s} />
          </div>
        );
      })}
    </div>
  );
}
export function HistoryDetails({ value }: { value: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) return null;
  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer">Change details</summary>
      {value.after && typeof value.after === 'object' ? (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {value.before && typeof value.before === 'object' ? (
            <div>
              <h4 className="mb-2 font-semibold text-foreground">Before</h4>
              <Fields value={value.before as Record<string, unknown>} />
            </div>
          ) : null}
          <div>
            <h4 className="mb-2 font-semibold text-foreground">
              {value.before ? 'After' : 'Recorded details'}
            </h4>
            <Fields value={value.after as Record<string, unknown>} />
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Fields value={value} />
        </div>
      )}
    </details>
  );
}
