'use client';
import { createContext, useContext, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { command, type ActionResult } from '@/server/actions';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { LoginForm } from './login-form';
const Context = createContext<{
  reauth: () => Promise<boolean>;
  paused: boolean;
  toast: (v: string) => void;
}>({ reauth: async () => false, paused: false, toast: () => {} });
export function MutationProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((message: string) => {
    setNotice(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(''), 6000);
  }, []);
  const reauth = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpen(true);
      }),
    [],
  );
  return (
    <Context.Provider value={{ reauth, paused: open, toast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={
          notice
            ? 'fixed bottom-6 right-6 z-50 max-w-sm rounded-xl bg-foreground px-5 py-3 text-sm text-white shadow-lg'
            : 'sr-only'
        }
      >
        {notice}
      </div>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            resolver.current?.(false);
            setOpen(false);
          }
        }}
      >
        <DialogContent>
          <DialogTitle className="section-title">Sign in to continue</DialogTitle>
          <DialogDescription className="my-2 text-sm text-muted-foreground">
            Your session ended. Your unsaved entry is still here.
          </DialogDescription>
          <LoginForm
            expectedUser={userId}
            onSuccess={() => {
              setOpen(false);
              resolver.current?.(true);
            }}
          />
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}
export function useMutation() {
  const { reauth, toast } = useContext(Context);
  const router = useRouter();
  const pending = useRef<{ name: string; id: string; payload: unknown } | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  async function submit(
    name: string,
    payload: unknown,
  ): Promise<(Extract<ActionResult, { ok: true }> & { submitted: unknown }) | null> {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    setError('');
    pending.current ??= { name, id: crypto.randomUUID(), payload: structuredClone(payload) };
    try {
      const p = pending.current;
      let result = await command(p.name, p.id, p.payload);
      if (!result.ok && result.code === 'AUTH_REQUIRED') {
        if (await reauth()) result = await command(p.name, p.id, p.payload);
        else {
          setError('Sign in and retry to finish this submission.');
          setUncertain(true);
          return null;
        }
      }
      if (!result.ok) {
        setError(result.message);
        if (result.code === 'UNCERTAIN' || result.code === 'AUTH_REQUIRED') setUncertain(true);
        else {
          pending.current = null;
          setUncertain(false);
        }
        return null;
      }
      pending.current = null;
      setUncertain(false);
      toast(result.message ?? 'Saved successfully');
      router.refresh();
      return { ...result, submitted: p.payload };
    } catch {
      setUncertain(true);
      setError('The response was interrupted. Retry to confirm the original save.');
      return null;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { submit, busy, uncertain, error, setError };
}
export function MutationFeedback({ error, uncertain }: { error: string; uncertain: boolean }) {
  return error ? (
    <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
      {error}
      {uncertain && (
        <p className="mt-1">
          Your original entry is preserved. The save button retries that entry.
        </p>
      )}
    </div>
  ) : null;
}
export function useSessionState() {
  return useContext(Context);
}
