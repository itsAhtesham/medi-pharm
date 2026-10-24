'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal, Phone, ArrowUpRight } from 'lucide-react';
import { DatePicker } from '@/components/ui/date-picker';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { useMutation, MutationFeedback } from './mutation-provider';
import { addDays, formatDate, pharmacyToday } from '@/lib/dates';
import { followUpState } from '@/lib/follow-up-state';
export function FollowActions({
  id,
  version,
  status,
  purchaseId,
  eligible,
  medicineId,
  nextDate,
  lastContactedAt,
}: {
  id: string;
  version: number;
  status: string;
  purchaseId: string;
  eligible: boolean;
  medicineId?: string | null;
  nextDate: string;
  lastContactedAt: Date | string | null;
}) {
  const [action, setAction] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const m = useMutation();
  const today = pharmacyToday();
  const { contactedOn, scheduled, followAgain, awaitingRefill } = followUpState(
    { status, nextDate, lastContactedAt },
    today,
  );
  const refillHref = `/purchases/new?refill=${purchaseId}${medicineId ? `&medicine=${medicineId}` : ''}`;
  const refillPrimary = !!contactedOn && !followAgain;
  return (
    <>
      <div className="space-y-2">
        {contactedOn && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-emerald-700">
              {contactedOn === today ? 'Contacted today' : `Contacted ${formatDate(contactedOn)}`}
            </span>
            {awaitingRefill && <span className="block mt-1">Awaiting refill</span>}
            {scheduled && <span className="block mt-1">Next contact {formatDate(nextDate)}</span>}
          </p>
        )}
        <div className="flex items-center gap-2">
          {status === 'open' &&
            eligible &&
            (refillPrimary ? (
              <Button asChild size="sm" variant="outline">
                <Link href={refillHref}>Record refill</Link>
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setAction('contact')}>
                <Phone />
                {followAgain ? 'Follow up again' : 'Mark contacted'}
              </Button>
            ))}
          {status === 'closed' && eligible && (
            <Button size="sm" variant="outline" onClick={() => setAction('reopen')}>
              Reopen follow-up
            </Button>
          )}
          <Button asChild size="sm" variant="ghost">
            <Link href={`/purchases/${purchaseId}`} aria-label="View purchase">
              <ArrowUpRight />
            </Link>
          </Button>
          {status === 'open' && eligible && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Follow-up actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {contactedOn && (
                  <DropdownMenuItem onSelect={() => setAction('contact')}>
                    Record another contact
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setAction('snooze')}>
                  Remind later
                </DropdownMenuItem>
                {!refillPrimary && (
                  <DropdownMenuItem asChild>
                    <Link href={refillHref}>Record refill</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setAction('close')}>
                  Close follow-up
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <Dialog
        open={!!action}
        onOpenChange={(v) => {
          if (!v && !m.busy && !m.uncertain) setAction(null);
        }}
      >
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
        >
          <DialogTitle ref={titleRef} tabIndex={-1} className="section-title outline-none">
            {action === 'contact'
              ? 'Record contact'
              : action === 'snooze'
                ? 'Remind later'
                : action === 'reopen'
                  ? 'Reopen follow-up'
                  : 'Close follow-up'}
          </DialogTitle>
          <DialogDescription className="mb-5 mt-2 text-sm text-muted-foreground">
            {action === 'reopen'
              ? 'This reverses any current completion. The reason and previous resolution stay in history.'
              : action === 'contact'
                ? 'Record your conversation. Contacting does not close the follow-up.'
                : 'Keep a clear next step for this customer.'}
          </DialogDescription>
          <form
            key={action}
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = Object.fromEntries(new FormData(e.currentTarget));
              if (await m.submit('follow.command', { ...data, id, version, action })) {
                setAction(null);
              }
            }}
          >
            <fieldset disabled={m.busy || m.uncertain} className="grid gap-4">
              {action === 'close' ? (
                <div className="field">
                  <label htmlFor="close-reason">Reason</label>
                  <select id="close-reason" name="reason" required>
                    <option value="">Select reason</option>
                    <option value="declined">Declined</option>
                    <option value="no_longer_needed">No longer needed</option>
                    <option value="purchased_elsewhere">Purchased elsewhere</option>
                    <option value="unable_to_reach">Unable to reach</option>
                    <option value="other">Other (add a note)</option>
                  </select>
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="next-date">
                    {action === 'contact'
                      ? 'When should we follow up again? (optional)'
                      : 'Next follow-up date'}
                  </label>
                  <DatePicker
                    id="next-date"
                    name="date"
                    disabled={m.busy || m.uncertain}
                    required={action !== 'contact'}
                    min={action === 'snooze' ? addDays(pharmacyToday(), 1) : pharmacyToday()}
                    defaultValue={
                      action === 'contact'
                        ? ''
                        : action === 'snooze'
                          ? addDays(pharmacyToday(), 1)
                          : pharmacyToday()
                    }
                  />
                  {action === 'contact' && (
                    <p className="hint">
                      Choose a future date to move this reminder to Scheduled. Leave blank to keep
                      it in Needs attention as contacted, awaiting refill.
                    </p>
                  )}
                </div>
              )}
              <div className="field">
                <label htmlFor="follow-note">
                  {action === 'reopen' ? 'Reason for reopening' : 'Contact note'}
                </label>
                <textarea
                  id="follow-note"
                  name="note"
                  rows={3}
                  maxLength={2000}
                  required={action === 'reopen'}
                />
              </div>
            </fieldset>
            <MutationFeedback {...m} />
            <Button type="submit" disabled={m.busy}>
              {m.busy
                ? 'Saving…'
                : m.uncertain
                  ? 'Retry original save'
                  : action === 'contact'
                    ? 'Save contact'
                    : 'Save follow-up'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function PurchaseCommands({
  id,
  version,
  status,
  linked,
}: {
  id: string;
  version: number;
  status: string;
  linked: boolean;
}) {
  const [action, setAction] = useState<'cancel' | 'detach' | null>(null);
  const m = useMutation();
  return (
    <>
      <div className="flex gap-2">
        {linked && (
          <Button variant="outline" onClick={() => setAction('detach')}>
            Correct refill links
          </Button>
        )}
        {status === 'active' && (
          <Button variant="outline" onClick={() => setAction('cancel')}>
            Cancel purchase
          </Button>
        )}
      </div>
      <Dialog
        open={!!action}
        onOpenChange={(v) => {
          if (!v && !m.busy && !m.uncertain) setAction(null);
        }}
      >
        <DialogContent>
          <DialogTitle className="section-title">
            {action === 'cancel' ? 'Cancel this purchase?' : 'Detach refill links?'}
          </DialogTitle>
          <DialogDescription className="my-3 text-sm text-muted-foreground">
            {action === 'cancel'
              ? 'The purchase remains in history. A prior follow-up resolved by this refill will reopen only if still eligible.'
              : 'This removes links to this purchase and its source, and reverses affected completions. Use this before correcting a linked customer.'}
          </DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const reason = new FormData(e.currentTarget).get('reason');
              if (await m.submit('purchase.command', { id, version, action, reason }))
                setAction(null);
            }}
          >
            <div className="field">
              <label htmlFor="correction-reason">Reason</label>
              <textarea
                id="correction-reason"
                name="reason"
                required
                maxLength={2000}
                disabled={m.busy || m.uncertain}
              />
            </div>
            <MutationFeedback {...m} />
            <Button variant="destructive" disabled={m.busy}>
              Confirm {action}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
