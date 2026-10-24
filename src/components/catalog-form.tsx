'use client';
import { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
import { useMutation, MutationFeedback } from './mutation-provider';
type RecordData = {
  id: string;
  version: number;
  name: string;
  phone?: string;
  age?: number | null;
  notes?: string;
  strength?: string;
  form?: string;
};
export function CatalogForm({
  kind,
  record,
  onSaved,
}: {
  kind: 'customer' | 'medicine';
  record?: RecordData;
  onSaved?: (value: { id: string; label: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const m = useMutation();
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!m.busy && !m.uncertain) setOpen(v);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={record ? 'outline' : 'default'} size={record ? 'sm' : 'default'}>
          {record ? <Pencil /> : <Plus />}
          {record ? 'Edit' : `Add ${kind}`}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="section-title">
          {record ? 'Edit' : 'New'} {kind}
        </DialogTitle>
        <DialogDescription className="mb-5 mt-2 text-sm text-muted-foreground">
          {kind === 'customer'
            ? 'Keep contact details ready for the next follow-up.'
            : 'Add a medicine to your pharmacy catalog.'}
        </DialogDescription>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            const result = await m.submit(kind + '.save', {
              ...data,
              ...(record ? { id: record.id, version: record.version } : {}),
            });
            if (result) {
              onSaved?.({
                id: result.id,
                label: String((result.submitted as { name: string }).name),
              });
              setOpen(false);
            }
          }}
        >
          <fieldset disabled={m.busy || m.uncertain} className="grid gap-4">
            <div className="field">
              <label htmlFor={`${kind}-name`}>Name</label>
              <input
                id={`${kind}-name`}
                name="name"
                defaultValue={record?.name}
                required
                minLength={2}
                maxLength={120}
              />
            </div>
            {kind === 'customer' ? (
              <>
                <div className="field">
                  <label htmlFor="customer-phone">Phone number</label>
                  <input
                    id="customer-phone"
                    name="phone"
                    type="tel"
                    defaultValue={record?.phone}
                    required
                    placeholder="10-digit number or +country code"
                  />
                  <p className="hint">
                    Required for all customers. Shared family numbers are allowed.
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="customer-age">Age in years (optional)</label>
                  <input
                    id="customer-age"
                    name="age"
                    type="number"
                    min={0}
                    max={130}
                    step={1}
                    defaultValue={record?.age ?? ''}
                    placeholder="e.g. 45"
                  />
                  <p className="hint">Age as recorded; update it when needed.</p>
                </div>
                <div className="field">
                  <label htmlFor="customer-notes">
                    Notes <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <textarea
                    id="customer-notes"
                    name="notes"
                    defaultValue={record?.notes}
                    maxLength={2000}
                    rows={3}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="medicine-strength">Strength</label>
                  <input
                    id="medicine-strength"
                    name="strength"
                    defaultValue={record?.strength}
                    placeholder="e.g. 500 mg"
                    maxLength={80}
                  />
                </div>
                <div className="field">
                  <label htmlFor="medicine-form">Form</label>
                  <input
                    id="medicine-form"
                    name="form"
                    defaultValue={record?.form}
                    placeholder="e.g. Tablet"
                    maxLength={80}
                  />
                </div>
              </>
            )}
          </fieldset>
          <MutationFeedback {...m} />
          <Button type="submit" disabled={m.busy}>
            {m.busy ? 'Saving…' : m.uncertain ? 'Retry original save' : `Save ${kind}`}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function ArchiveButton({
  kind,
  id,
  version,
  archived,
}: {
  kind: 'customer' | 'medicine';
  id: string;
  version: number;
  archived: boolean;
}) {
  const [open, setOpen] = useState(false);
  const m = useMutation();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {archived ? 'Restore' : 'Archive'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="section-title">
          {archived ? 'Restore' : 'Archive'} {kind}?
        </DialogTitle>
        <DialogDescription className="my-4 text-sm text-muted-foreground">
          {archived
            ? 'This record will be available for new purchases again.'
            : 'Purchase history is kept. Any open customer follow-ups remain active; archiving does not close them.'}
        </DialogDescription>
        <MutationFeedback {...m} />
        <Button
          className="mt-4"
          disabled={m.busy}
          onClick={async () => {
            if (
              await m.submit('catalog.archive', {
                kind,
                id,
                version,
                archived: !archived,
                confirmed: true,
              })
            )
              setOpen(false);
          }}
        >
          Confirm {archived ? 'restore' : 'archive'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
