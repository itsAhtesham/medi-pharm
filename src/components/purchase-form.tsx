'use client';
import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Search, Bell, ChevronDown, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { medicinePurchaseInput, units, type MedicinePurchaseInput } from '@/lib/validation';
import { formatDate, pharmacyToday, isDate } from '@/lib/dates';
import { medicineDates, daysBetween } from '@/lib/medicine-supply';
import type { SupplyContext } from '@/server/services/medicine-supplies';
import { searchOptions, getSupplyContexts } from '@/server/actions';
import { DatePicker } from '@/components/ui/date-picker';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { CatalogForm } from './catalog-form';
import { useMutation, MutationFeedback, useSessionState } from './mutation-provider';
type Option = { id: string; label: string };
function Picker({
  kind,
  value,
  onChange,
  label,
}: {
  kind: 'customer' | 'medicine';
  value: Option | null;
  onChange: (o: Option) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Option[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const { reauth } = useSessionState();
  useEffect(() => {
    if (!open) return;
    const n = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const options = await searchOptions(kind, query);
        if (n === seq.current) {
          setRows(options);
          setError('');
        }
      } catch {
        if (n === seq.current)
          setError('Could not load records. If your session ended, sign in again.');
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      seq.current = n + 1;
    };
  }, [kind, query, open]);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-11 w-full justify-between whitespace-normal text-left font-normal"
        onClick={() => setOpen(true)}
      >
        {value?.label ?? `Select ${kind}`}
        <ChevronDown className="shrink-0" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="section-title">{label}</DialogTitle>
          <DialogDescription className="mb-4 mt-2 text-sm text-muted-foreground">
            Search your active {kind === 'customer' ? 'customers' : 'medicine catalog'}.
          </DialogDescription>
          <div className="relative">
            <Search className="absolute left-3 top-3 text-muted-foreground" size={16} />
            <input
              autoFocus
              aria-label={`Search ${kind}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10!"
              placeholder="Type to search…"
            />
          </div>
          <div className="mt-3 max-h-64 overflow-auto" aria-live="polite">
            {loading ? (
              <p className="p-3 text-sm">Searching…</p>
            ) : rows.length ? (
              rows.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="block w-full rounded-lg px-3 py-3 text-left text-sm hover:bg-secondary"
                  onClick={() => {
                    onChange(o);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              ))
            ) : (
              <p className="p-3 text-sm text-muted-foreground">No matching records.</p>
            )}
            {error && (
              <div className="p-3 text-sm text-red-700">
                {error}
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    if (await reauth()) {
                      setOpen(false);
                      setTimeout(() => setOpen(true), 0);
                    }
                  }}
                >
                  Sign in again
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
type SupplyValues = Omit<
  MedicinePurchaseInput['supplies'][number],
  'medicineId' | 'expectedRevision' | 'mode'
> & { mode: '' | 'extend' | 'replace' };
const emptySupply = (): SupplyValues => ({
  supplyDays: 0,
  supplyStart: '',
  mode: '',
  remainingOverride: null,
  reminderEnabled: false,
  manualDate: '',
  lateConfirmed: false,
  reopenDisabled: false,
});
export type PurchaseFormData = {
  values: Partial<MedicinePurchaseInput>;
  customer?: Option;
  medicines?: Record<string, string>;
  legacy?: boolean;
  sourceLabel?: string;
};
export function PurchaseForm({ initial = { values: {} } }: { initial?: PurchaseFormData }) {
  const router = useRouter();
  const m = useMutation();
  const { reauth } = useSessionState();
  const [customer, setCustomer] = useState<Option | null>(initial.customer ?? null);
  const [labels, setLabels] = useState<Record<string, string>>(initial.medicines ?? {});
  const [configs, setConfigs] = useState<Record<string, SupplyValues>>(
    Object.fromEntries((initial.values.supplies ?? []).map((s) => [s.medicineId, s])),
  );
  const [contexts, setContexts] = useState<{ key: string; rows: SupplyContext[] }>({
    key: '',
    rows: [],
  });
  const [contextError, setContextError] = useState<{
    key: string;
    message: string;
    authRequired: boolean;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const form = useForm<MedicinePurchaseInput>({
    defaultValues: {
      customerId: '',
      purchaseDate: pharmacyToday(),
      notes: '',
      items: [{ medicineId: '', quantity: 1, unit: 'strips' }],
      supplies: [],
      reason: '',
      scheduleChoice: 'keep',
      convertLegacy: false,
      ...initial.values,
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  const v = useWatch({ control: form.control }) as MedicinePurchaseInput;
  const medicineIds = [...new Set(v.items.filter((i) => i.medicineId).map((i) => i.medicineId))];
  const contextKey = JSON.stringify([
    v.customerId,
    v.purchaseDate,
    medicineIds.slice().sort(),
    initial.values.id,
    refresh,
  ]);
  useEffect(() => {
    let active = true;
    const [customerId, purchaseDate, ids, purchaseId] = JSON.parse(contextKey) as [
      string,
      string,
      string[],
      string | null,
    ];
    if (!customerId || !isDate(purchaseDate) || !ids.length) return;
    getSupplyContexts({
      customerId,
      purchaseDate,
      medicineIds: ids,
      ...(purchaseId ? { purchaseId } : {}),
    })
      .then((result) => {
        if (active) {
          if (result.ok) {
            setContexts({ key: contextKey, rows: result.rows });
            setContextError(null);
          } else {
            setContextError({
              key: contextKey,
              message: result.message,
              authRequired: result.code === 'AUTH_REQUIRED',
            });
          }
        }
      })
      .catch(() => {
        if (active)
          setContextError({
            key: contextKey,
            message:
              'Could not load supply estimates. Check your connection and try Refresh estimates.',
            authRequired: false,
          });
      });
    return () => {
      active = false;
    };
  }, [contextKey]);
  const ready = contexts.key === contextKey;
  const setSupply = (id: string, patch: Partial<SupplyValues>) =>
    setConfigs((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptySupply()), ...patch } }));
  const editing = !!initial.values.id;
  const save = form.handleSubmit(async (values) => {
    if (!m.uncertain && !values.customerId) {
      m.setError('Select a customer before saving the purchase.');
      return;
    }
    if (!m.uncertain && (!values.items.length || values.items.some((item) => !item.medicineId))) {
      m.setError('Select a medicine for each row before saving the purchase.');
      return;
    }
    if (!m.uncertain && !ready) {
      m.setError('Load the current supply estimates before saving.');
      return;
    }
    const supplies = medicineIds.map((medicineId) => {
      const s = configs[medicineId] ?? emptySupply();
      const context = contexts.rows.find((c) => c.medicineId === medicineId);
      return {
        ...s,
        medicineId,
        mode: s.mode || (context?.previousRunOut ? '' : 'replace'),
        supplyStart: s.supplyStart || values.purchaseDate,
        remainingOverride: s.mode === 'extend' ? s.remainingOverride : null,
        manualDate: s.reminderEnabled ? s.manualDate : '',
        expectedRevision: context?.revision ?? '',
      };
    });
    const payload = { ...values, supplies };
    if (!m.uncertain) {
      const result = medicinePurchaseInput.safeParse(payload);
      if (!result.success) {
        m.setError(result.error.issues.map((i) => i.message).join('. '));
        return;
      }
    }
    const result = await m.submit('purchase.save', payload);
    if (result) router.push(`/purchases/${result.id}`);
  });
  const renderSupplyDetails = (medicineId: string) => {
    const s = configs[medicineId] ?? emptySupply();
    const context = ready ? contexts.rows.find((c) => c.medicineId === medicineId) : undefined;
    const start = s.supplyStart || v.purchaseDate;
    const remaining =
      context?.previousRunOut && isDate(start)
        ? Math.max(0, daysBetween(start, context.previousRunOut))
        : 0;
    const mode = s.mode || (context && !context.previousRunOut ? 'replace' : '');
    const carry = mode === 'extend' ? (s.remainingOverride ?? remaining) : 0;
    let dates: ReturnType<typeof medicineDates> | null = null;
    try {
      if (context && mode && s.supplyDays) dates = medicineDates(start, s.supplyDays, carry);
    } catch {}
    return (
      <div id={`supply-${medicineId}`} className="mt-4 scroll-mt-6 border-t pt-4">
        <h3 className="mb-3 text-sm font-semibold">Supply & reminder</h3>
        {v.items.filter((item) => item.medicineId === medicineId).length > 1 && (
          <p className="hint mb-4">
            These supply days cover all units of this medicine in this purchase.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor={`days-${medicineId}`}>New days of supply</label>
            <input
              id={`days-${medicineId}`}
              type="number"
              min={1}
              max={365}
              step={1}
              required
              value={s.supplyDays || ''}
              onChange={(e) =>
                setSupply(medicineId, {
                  supplyDays: Number(e.target.value),
                  lateConfirmed: false,
                })
              }
            />
          </div>
          <div className="field">
            <label htmlFor={`start-${medicineId}`}>Supply starts</label>
            <DatePicker
              id={`start-${medicineId}`}
              min={v.purchaseDate}
              required
              value={start}
              disabled={m.busy || m.uncertain}
              onValueChange={(date) =>
                setSupply(medicineId, { supplyStart: date, lateConfirmed: false })
              }
            />
          </div>
          {context?.previousRunOut ? (
            <>
              <p className="rounded-lg bg-secondary/60 p-3 text-sm sm:col-span-2">
                Estimated remaining at this start date: <strong>{remaining} days</strong> · Previous
                run-out {formatDate(context.previousRunOut)}
                <span className="mt-2 block text-xs">
                  Saving updates this medicine’s supply and replaces its previous refill follow-up.
                </span>
              </p>
              <div className="field sm:col-span-2">
                <label htmlFor={`mode-${medicineId}`}>
                  How should this purchase affect supply?
                </label>
                <Select
                  name={`refill-mode-${medicineId}`}
                  required
                  disabled={m.busy || m.uncertain}
                  value={mode}
                  onValueChange={(value) =>
                    setSupply(medicineId, {
                      mode: value as SupplyValues['mode'],
                      remainingOverride: null,
                      lateConfirmed: false,
                    })
                  }
                >
                  <SelectTrigger
                    id={`mode-${medicineId}`}
                    className="w-full bg-white text-base font-normal data-[size=default]:h-11"
                  >
                    <SelectValue placeholder="Choose for this medicine" />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    <SelectItem value="extend">Add to remaining supply</SelectItem>
                    <SelectItem value="replace">Start fresh from the supply start date</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <p className="hint sm:col-span-2">
              {context
                ? 'No earlier recorded medicine supply. This starts a new supply estimate.'
                : 'Select a customer and wait for the current supply estimate.'}
            </p>
          )}
          {mode === 'extend' && (
            <div className="field sm:col-span-2">
              <label htmlFor={`remaining-${medicineId}`}>Adjust remaining days (optional)</label>
              <input
                id={`remaining-${medicineId}`}
                type="number"
                min={0}
                max={365}
                step={1}
                value={s.remainingOverride ?? ''}
                placeholder={`Use estimated ${remaining} days`}
                onChange={(e) =>
                  setSupply(medicineId, {
                    remainingOverride: e.target.value === '' ? null : Number(e.target.value),
                    lateConfirmed: false,
                  })
                }
              />
              <p className="hint">
                Enter what the customer actually has left. Blank uses the recorded estimate.
              </p>
            </div>
          )}
          <label className="flex items-center gap-3 sm:col-span-2">
            <input
              type="checkbox"
              checked={s.reminderEnabled}
              onChange={(e) => setSupply(medicineId, { reminderEnabled: e.target.checked })}
            />
            Follow up for this medicine
          </label>
          {s.reminderEnabled && (
            <div className="field sm:col-span-2">
              <label htmlFor={`manual-${medicineId}`}>Change reminder date (optional)</label>
              <DatePicker
                id={`manual-${medicineId}`}
                min={v.purchaseDate}
                value={s.manualDate}
                disabled={m.busy || m.uncertain}
                onValueChange={(date) =>
                  setSupply(medicineId, {
                    manualDate: date,
                    lateConfirmed: false,
                  })
                }
              />
            </div>
          )}
          {editing && s.reminderEnabled && (
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={s.reopenDisabled}
                onChange={(e) => setSupply(medicineId, { reopenDisabled: e.target.checked })}
              />
              Reopen if this medicine’s follow-up was closed by disabling reminders.
            </label>
          )}
          {s.reminderEnabled && dates && s.manualDate >= dates.runOutDate && (
            <label className="flex items-start gap-2 text-sm text-amber-800 sm:col-span-2">
              <input
                type="checkbox"
                checked={s.lateConfirmed}
                onChange={(e) => setSupply(medicineId, { lateConfirmed: e.target.checked })}
              />
              I confirm this reminder is at or after estimated run-out.
            </label>
          )}
          {dates && (
            <div className="rounded-lg bg-secondary p-3 text-sm sm:col-span-2">
              <p>
                {carry > 0
                  ? `${carry} remaining + ${s.supplyDays} new = ${carry + s.supplyDays} days. `
                  : `${s.supplyDays} days. `}
                Estimated run-out: <strong>{formatDate(dates.runOutDate)}</strong>
              </p>
              <p className="mt-2">
                {s.reminderEnabled
                  ? `Reminder: ${formatDate(s.manualDate || dates.calculatedDate)}${s.manualDate ? ' (chosen date)' : ` · ${dates.leadDays} days before run-out`}`
                  : 'No follow-up requested for this medicine.'}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };
  return (
    <form onSubmit={save} className="grid gap-6 xl:grid-cols-[1fr_300px]">
      <fieldset disabled={m.busy || m.uncertain} className="min-w-0 space-y-6">
        <section className="panel">
          <h2 className="section-title mb-5">Customer & purchase</h2>
          {initial.legacy && (
            <p className="mb-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              This purchase uses a legacy shared reminder. Enter and confirm each medicine’s days of
              supply below. Saving will replace the shared reminder with the individual choices you
              make.
            </p>
          )}
          {initial.sourceLabel && (
            <p className="mb-5 rounded-xl bg-secondary p-4 text-sm">
              Refill for {initial.sourceLabel}. Confirm each medicine’s new duration and whether to
              carry its remaining supply. Legacy shared reminders must be closed separately when
              fulfilled.
            </p>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="field sm:col-span-2">
              <div className="flex items-center justify-between">
                <label>Customer</label>
                <CatalogForm
                  kind="customer"
                  onSaved={(o) => {
                    setCustomer(o);
                    form.setValue('customerId', o.id);
                    setConfigs({});
                  }}
                />
              </div>
              <Picker
                kind="customer"
                label="Choose a customer"
                value={customer}
                onChange={(o) => {
                  if (o.id !== v.customerId) setConfigs({});
                  setCustomer(o);
                  form.setValue('customerId', o.id);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="purchase-date">Purchase date</label>
              <DatePicker
                id="purchase-date"
                max={pharmacyToday()}
                required
                name="purchaseDate"
                value={v.purchaseDate}
                disabled={m.busy || m.uncertain}
                onValueChange={(date) =>
                  form.setValue('purchaseDate', date, { shouldDirty: true, shouldTouch: true })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="purchase-notes">Notes (optional)</label>
              <input id="purchase-notes" maxLength={2000} {...form.register('notes')} />
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="section-title">Medicines</h2>
            <CatalogForm
              kind="medicine"
              onSaved={(o) => {
                setLabels((prev) => ({ ...prev, [o.id]: o.label }));
                const empty = form.getValues('items').findIndex((i) => !i.medicineId);
                if (empty >= 0) form.setValue(`items.${empty}.medicineId`, o.id);
                else append({ medicineId: o.id, quantity: 1, unit: 'strips' });
              }}
            />
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="hint">
              Select a medicine, then enter its quantity, supply days and reminder choice together.
            </p>
            {medicineIds.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRefresh((n) => n + 1)}
              >
                Refresh estimates
              </Button>
            )}
          </div>
          {contextError?.key === contextKey && (
            <div role="alert" className="mb-4 text-sm text-red-700">
              {contextError.message}
              {contextError.authRequired && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    if (await reauth()) setRefresh((n) => n + 1);
                  }}
                >
                  Sign in again
                </Button>
              )}
            </div>
          )}
          <div className="space-y-4">
            {fields.map((field, index) => (
              <div key={field.id} className="rounded-xl border bg-background/50 p-4">
                <div className="grid grid-cols-[1fr_1fr_36px] gap-3 sm:grid-cols-[minmax(0,1fr)_90px_110px_36px]">
                  <div className="field col-span-3 sm:col-span-1">
                    <label>Medicine {index + 1}</label>
                    <Picker
                      kind="medicine"
                      label={`Choose medicine ${index + 1}`}
                      value={
                        v.items[index]?.medicineId
                          ? {
                              id: v.items[index].medicineId,
                              label: labels[v.items[index].medicineId] ?? 'Selected medicine',
                            }
                          : null
                      }
                      onChange={(o) => {
                        setLabels((prev) => ({ ...prev, [o.id]: o.label }));
                        form.setValue(`items.${index}.medicineId`, o.id);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`qty-${index}`}>Quantity</label>
                    <input
                      id={`qty-${index}`}
                      type="number"
                      min="0.001"
                      max="999999"
                      step="0.001"
                      required
                      {...form.register(`items.${index}.quantity`, { valueAsNumber: true })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`unit-${index}`}>Unit</label>
                    <select id={`unit-${index}`} {...form.register(`items.${index}.unit`)}>
                      {units.map((unit) => (
                        <option key={unit}>{unit}</option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-7"
                    aria-label={`Remove medicine ${index + 1}`}
                    disabled={fields.length === 1}
                    onClick={() => remove(index)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {v.items[index]?.medicineId &&
                  (v.items.findIndex((item) => item.medicineId === v.items[index].medicineId) ===
                  index ? (
                    renderSupplyDetails(v.items[index].medicineId)
                  ) : (
                    <p className="hint mt-4 border-t pt-3">
                      Shares supply and reminder with medicine{' '}
                      {v.items.findIndex((item) => item.medicineId === v.items[index].medicineId) +
                        1}
                      .{' '}
                      <a
                        className="text-primary hover:underline"
                        href={`#supply-${v.items[index].medicineId}`}
                      >
                        View shared supply details
                      </a>
                    </p>
                  ))}
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => append({ medicineId: '', quantity: 1, unit: 'strips' })}
          >
            <Plus />
            Add another medicine
          </Button>
          <p className="hint mt-3">
            Different units can have separate rows. Their combined days of supply and reminder are
            entered with the first row for that medicine.
          </p>
        </section>

        {editing && (
          <section className="panel">
            <h2 className="section-title mb-4">Correction details</h2>
            <div className="field">
              <label htmlFor="reason">Reason for correction</label>
              <textarea id="reason" required {...form.register('reason')} />
            </div>
            <div className="field mt-4">
              <label htmlFor="schedule-choice">Existing contact or snooze dates</label>
              <select id="schedule-choice" {...form.register('scheduleChoice')}>
                <option value="keep">Keep dates chosen for follow-up</option>
                <option value="recalculate">
                  Use recalculated reminder dates for affected medicines
                </option>
              </select>
            </div>
            <p className="hint mt-3">
              Later supplies are recalculated. A later “start fresh” purchase resets coverage;
              entered remaining-day adjustments stay as recorded.
            </p>
            {initial.legacy && (
              <label className="mt-4 flex items-start gap-2">
                <input type="checkbox" required {...form.register('convertLegacy')} />I confirm
                these individual medicine durations and reminder choices.
              </label>
            )}
          </section>
        )}
      </fieldset>
      <aside>
        <div className="panel sticky top-6">
          <Bell className="mb-4 text-primary" />
          <h2 className="section-title">Purchase summary</h2>
          <p className="mt-4 text-sm">{customer?.label ?? 'Select a customer'}</p>
          <p className="mt-3 text-sm">
            {medicineIds.length} distinct medicines ·{' '}
            {medicineIds.filter((id) => configs[id]?.reminderEnabled).length} reminders selected
          </p>
          <p className="hint mt-4">
            Reminder notice is 25% of the new supply days, rounded, with a minimum of 1 day and a
            maximum of 7 days. Remaining supply changes the run-out date.
          </p>
          <MutationFeedback {...m} />
          <Button type="submit" className="mt-5 w-full" disabled={m.busy}>
            {m.busy
              ? 'Saving…'
              : m.uncertain
                ? 'Retry original save'
                : editing
                  ? 'Save correction'
                  : 'Save purchase'}
          </Button>
          <Button asChild variant="ghost" className="mt-2 w-full">
            <Link href="/purchases">
              <ArrowLeft />
              Back to purchases
            </Link>
          </Button>
        </div>
      </aside>
    </form>
  );
}
