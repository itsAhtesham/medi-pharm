import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, verifyToken } from './auth';
import { AppError } from './services/core';
export async function actor() {
  const value = (await cookies()).get(COOKIE)?.value;
  return value ? verifyToken(value) : null;
}
export async function requirePage() {
  const user = await actor();
  if (!user) redirect('/login');
  return user;
}
export async function requireAction() {
  const h = await headers();
  assertOrigin(h.get('origin'));
  const user = await actor();
  if (!user) throw new AppError('Your session has expired. Sign in to continue.', 'AUTH_REQUIRED');
  return user;
}
export function assertOrigin(origin: string | null) {
  if (!process.env.APP_URL || origin !== new URL(process.env.APP_URL).origin)
    throw new AppError('Request origin is not allowed.', 'FORBIDDEN');
}
