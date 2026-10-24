'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import { Button } from './ui/button';
export function LoginForm({
  onSuccess,
  expectedUser,
}: {
  onSuccess?: () => void;
  expectedUser?: string;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const router = useRouter();
  return (
    <form
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const data = new FormData(e.currentTarget);
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
          });
          const result = await res.json();
          if (!res.ok) throw new Error(result.message);
          if (expectedUser && result.userId !== expectedUser) {
            await fetch('/api/auth/logout', { method: 'POST' });
            throw new Error('Sign in with the account that started this entry.');
          }
          if (onSuccess) onSuccess();
          else {
            router.push('/dashboard');
            router.refresh();
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Unable to sign in.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="login-email">Email address</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@pharmacy.com"
        />
      </div>
      <div className="field">
        <label htmlFor="login-password">Password</label>
        <div className="relative">
          <input
            id="login-password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            required
            className="pr-12!"
          />
          <button
            type="button"
            className="absolute right-3 top-3 text-muted-foreground"
            aria-label={show ? 'Hide password' : 'Show password'}
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Button disabled={busy} type="submit" className="w-full">
        {busy ? 'Signing in…' : 'Sign in'}
        <ArrowRight />
      </Button>
    </form>
  );
}
