import { NextRequest, NextResponse } from 'next/server';
import { login, COOKIE, type LoginStage } from '@/server/auth';
import { loginFailureDetails } from '@/server/login-diagnostics';
import { assertOrigin } from '@/server/session';
import { AppError } from '@/server/services/core';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  let stage: LoginStage | 'origin' | 'request_body' | 'response' = 'origin';
  try {
    assertOrigin(req.headers.get('origin'));
    stage = 'request_body';
    const data = await req.json();
    const ip =
      process.env.TRUSTED_PROXY === 'vercel'
        ? (req.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() ?? 'unknown')
        : 'shared-local';
    const result = await login(data.email, data.password, ip, (nextStage) => {
      stage = nextStage;
    });
    stage = 'response';
    const res = NextResponse.json(
      { ok: true, userId: result.userId },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    res.cookies.set(COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: result.expiresAt,
    });
    return res;
  } catch (error) {
    const known = error instanceof AppError;
    if (!known) {
      console.error('auth.login_failed', { stage, ...loginFailureDetails(error) });
    }
    return NextResponse.json(
      { ok: false, message: known ? error.message : 'Unable to sign in. Please try again.' },
      { status: known && error.code === 'RATE_LIMIT' ? 429 : known ? 401 : 500 },
    );
  }
}
