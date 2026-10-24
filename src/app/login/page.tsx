import { HeartHandshake, ArrowUpRight, Check } from 'lucide-react';
import { LoginForm } from '@/components/login-form';
export const dynamic = 'force-dynamic';
export default function LoginPage() {
  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[#eae5fb] p-16 lg:flex">
        <div className="flex items-center gap-3 text-xl font-bold">
          <HeartHandshake className="text-primary" />
          Medi Pharm.
        </div>
        <div className="relative z-10 max-w-lg">
          <span className="badge mb-6 bg-white/70 text-primary">Made for your pharmacy</span>
          <h1 className="text-5xl font-semibold leading-[1.12] tracking-tight">
            Good care doesn’t
            <br />
            end at the counter.
          </h1>
          <p className="mt-6 max-w-sm text-lg leading-relaxed text-muted-foreground">
            Keep your customers close, their purchases organized, and every refill follow-up on
            time.
          </p>
          <div className="mt-10 max-w-sm rotate-[-2deg] rounded-2xl border border-white bg-white/85 p-6 shadow-xl shadow-primary/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest text-primary">
                A thoughtful follow-up
              </span>
              <ArrowUpRight size={18} />
            </div>
            <p className="mt-5 text-xl font-medium">
              The right reminder.
              <br />A familiar voice.
            </p>
            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Check size={14} className="text-primary" />
              Simple tools. More personal care.
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Your private pharmacy workspace</p>
        <div className="absolute -right-32 top-1/4 h-96 w-96 rounded-full border-[60px] border-white/25" />
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-primary">
            <HeartHandshake />
          </div>
          <h2 className="text-3xl font-semibold">Welcome back</h2>
          <p className="mb-9 mt-3 text-sm text-muted-foreground">
            Sign in to take care of what comes next.
          </p>
          <LoginForm />
          <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
            Owner access only. For account recovery,
            <br />
            contact your designated support operator.
          </p>
        </div>
      </section>
    </main>
  );
}
