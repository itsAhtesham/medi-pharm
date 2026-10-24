'use client';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { useMutation, MutationFeedback } from './mutation-provider';
export function SettingsForm({ name, contact }: { name: string; contact: string }) {
  const m = useMutation();
  const p = useMutation();
  const router = useRouter();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="panel space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await m.submit('settings.save', Object.fromEntries(new FormData(e.currentTarget)));
        }}
      >
        <h2 className="section-title">Pharmacy details</h2>
        <fieldset disabled={m.busy || m.uncertain} className="space-y-4">
          <div className="field">
            <label htmlFor="pharmacy-name">Pharmacy name</label>
            <input
              id="pharmacy-name"
              name="name"
              defaultValue={name}
              required
              minLength={2}
              maxLength={120}
            />
          </div>
          <div className="field">
            <label htmlFor="pharmacy-contact">Contact details</label>
            <input id="pharmacy-contact" name="contact" defaultValue={contact} maxLength={120} />
          </div>
          <div className="rounded-xl bg-background p-3 text-sm">
            Timezone: Asia/Kolkata
            <p className="hint mt-1">
              All purchase and reminder dates follow the pharmacy’s calendar.
            </p>
          </div>
        </fieldset>
        <MutationFeedback {...m} />
        <Button disabled={m.busy}>{m.uncertain ? 'Retry original save' : 'Save details'}</Button>
      </form>
      <form
        className="panel space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await p.submit('password.change', Object.fromEntries(new FormData(e.currentTarget)))
          ) {
            router.push('/login');
            router.refresh();
          }
        }}
      >
        <h2 className="section-title">Change password</h2>
        <fieldset disabled={p.busy || p.uncertain} className="space-y-4">
          <div className="field">
            <label htmlFor="current-password">Current password</label>
            <input
              id="current-password"
              type="password"
              name="current"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="new-password">New passphrase</label>
            <input
              id="new-password"
              type="password"
              name="next"
              autoComplete="new-password"
              required
            />
            <p className="hint">
              15–128 characters. Spaces and password-manager paste are welcome.
            </p>
          </div>
          <p className="hint">Changing your password signs out every existing session.</p>
        </fieldset>
        <MutationFeedback {...p} />
        <Button disabled={p.busy}>Change password</Button>
      </form>
    </div>
  );
}
