import { NextRequest, NextResponse } from 'next/server';
import { COOKIE, revokeSession } from '@/server/auth';
import { actor, assertOrigin } from '@/server/session';
export async function POST(req: NextRequest) {
  try {
    assertOrigin(req.headers.get('origin'));
    const a = await actor();
    if (a) await revokeSession(a);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
