'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Bell,
  Users,
  Pill,
  ShoppingBag,
  Settings,
  LogOut,
  Plus,
  Search,
  Menu,
  HeartHandshake,
} from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { useSessionState } from './mutation-provider';
const links = [
  ['/dashboard', 'Dashboard', LayoutDashboard],
  ['/follow-ups', 'Follow-ups', Bell],
  ['/customers', 'Customers', Users],
  ['/medicines', 'Medicines', Pill],
  ['/purchases', 'Purchases', ShoppingBag],
] as const;
export function Shell({ children, name }: { children: React.ReactNode; name: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobile, setMobile] = useState(false);
  const { toast } = useSessionState();
  return (
    <div className="min-h-screen">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r bg-white px-5 py-7 transition-transform lg:translate-x-0',
          mobile ? 'visible translate-x-0' : 'invisible -translate-x-full lg:visible',
        )}
      >
        <Link href="/dashboard" className="flex items-center gap-2.5 px-2 text-xl font-bold">
          <span className="rounded-xl bg-primary p-2 text-white">
            <HeartHandshake size={22} />
          </span>
          Medi Pharm<span className="text-primary">.</span>
        </Link>
        <p className="mb-7 mt-10 px-3 text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">
          Workspace
        </p>
        <nav className="grid gap-2">
          {links.map(([href, label, Icon]) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobile(false)}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-3 text-sm',
                pathname.startsWith(href)
                  ? 'bg-secondary font-semibold text-primary'
                  : 'text-muted-foreground hover:bg-background',
              )}
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="mb-5 rounded-xl bg-background p-4">
            <span className="mb-2 block h-2 w-2 rounded-full bg-emerald-500" />
            <p className="text-sm font-medium">{name}</p>
            <p className="mt-1 text-xs text-muted-foreground">A little care, right on time.</p>
          </div>
          <Link
            href="/settings"
            onClick={() => setMobile(false)}
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-muted-foreground"
          >
            <Settings size={18} />
            Settings
          </Link>
          <button
            className="flex w-full items-center gap-3 px-3 py-3 text-sm text-muted-foreground"
            onClick={async () => {
              try {
                const res = await fetch('/api/auth/logout', { method: 'POST' });
                if (!res.ok) throw new Error();
                router.push('/login');
                router.refresh();
              } catch {
                toast('Could not sign out. Please retry.');
              }
            }}
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
        />
      )}
      <div className="lg:pl-60">
        <header className="flex h-20 items-center justify-between gap-4 border-b bg-white/80 px-5 sm:px-9">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu />
          </Button>
          <form action="/customers" className="relative hidden w-72 sm:block">
            <Search className="absolute left-3 top-3 text-muted-foreground" size={17} />
            <input
              name="q"
              aria-label="Search customers"
              placeholder="Search customers…"
              className="border-none! bg-background! pl-10! text-sm!"
            />
          </form>
          <div className="ml-auto flex items-center gap-4">
            <Button asChild>
              <Link href="/purchases/new">
                <Plus />
                Add purchase
              </Link>
            </Button>
            <div className="hidden border-l pl-4 sm:block">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary">
                  {name.slice(0, 1)}
                </div>
                <div>
                  <p className="text-xs font-semibold">Pharmacy owner</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Your workspace</p>
                </div>
              </div>
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-7xl px-5 py-8 sm:px-9">
          {children}
        </main>
      </div>
    </div>
  );
}
export function DashboardRefresh() {
  const router = useRouter();
  const { paused } = useSessionState();
  useEffect(() => {
    if (paused) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [router, paused]);
  return null;
}
