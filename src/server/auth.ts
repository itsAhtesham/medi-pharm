import { randomUUID, createHmac } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
import { and, eq, isNull, gt } from 'drizzle-orm';
import { db } from './db';
import { users, sessions, authRateLimits, auditEvents } from './db/schema';
import { email, password } from '@/lib/validation';
import { AppError, ensure, type Actor } from './services/core';
export const COOKIE = 'medi_session';
const issuer = 'medi-pharm',
  audience = 'pharmacy-owner';
function secret(name: string) {
  const v = process.env[name];
  if (!v || v.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return v;
}
export const hashPassword = (p: string) =>
  hash(password.parse(p), { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export async function verifyToken(token: string): Promise<Actor | null> {
  let claims;
  try {
    claims = (
      await jwtVerify(token, new TextEncoder().encode(secret('JWT_SECRET')), {
        algorithms: ['HS256'],
        issuer,
        audience,
      })
    ).payload;
  } catch {
    return null;
  }
  if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') return null;
  const [row] = await db
    .select({ id: users.id, pharmacyId: users.pharmacyId, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, claims.sid),
        eq(users.id, claims.sub),
        eq(users.isActive, true),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}
let dummyHash: Promise<string> | undefined;
export type LoginStage =
  | 'configuration'
  | 'rate_limit'
  | 'user_lookup'
  | 'password_verification'
  | 'session_creation'
  | 'token_signing';
export async function login(
  rawEmail: string,
  rawPassword: string,
  ip: string,
  onStage?: (stage: LoginStage) => void,
) {
  const normalized = email.safeParse(rawEmail);
  if (
    !normalized.success ||
    typeof rawPassword !== 'string' ||
    Array.from(rawPassword).length > 128
  )
    throw new AppError('Email or password is incorrect.', 'LOGIN');
  onStage?.('configuration');
  // Validate signing configuration before writing a session that cannot be used.
  const signingSecret = secret('JWT_SECRET');
  const rateLimitSecret = secret('RATE_LIMIT_SECRET');
  const keys = [
    ['email:' + normalized.data, 5],
    ['ip:' + ip, 30],
  ] as const;
  const limiter = keys
    .map(([v, limit]) => ({
      key: createHmac('sha256', rateLimitSecret).update(v).digest('hex'),
      limit,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  onStage?.('rate_limit');
  const allowed = await db.transaction(async (tx) => {
    let ok = true;
    for (const { key, limit } of limiter) {
      const now = new Date();
      await tx
        .insert(authRateLimits)
        .values({ key, windowStart: now, attempts: 0 })
        .onConflictDoNothing();
      const [r] = await tx
        .select()
        .from(authRateLimits)
        .where(eq(authRateLimits.key, key))
        .for('update');
      const expired = now.getTime() - r.windowStart.getTime() >= 900000;
      const attempts = expired ? 0 : r.attempts;
      if (attempts >= limit) {
        ok = false;
        continue;
      }
      await tx
        .update(authRateLimits)
        .set({ windowStart: expired ? now : r.windowStart, attempts: attempts + 1 })
        .where(eq(authRateLimits.key, key));
    }
    return ok;
  });
  if (!allowed) throw new AppError('Too many attempts. Try again in 15 minutes.', 'RATE_LIMIT');
  onStage?.('user_lookup');
  const [user] = await db.select().from(users).where(eq(users.email, normalized.data));
  onStage?.('password_verification');
  dummyHash ??= hash('unused-dummy-password-' + randomUUID(), {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const matches = await verify(user?.passwordHash ?? (await dummyHash), rawPassword).catch(
    () => false,
  );
  if (!user || !user.isActive || !matches)
    throw new AppError('Email or password is incorrect.', 'LOGIN');
  const expiresAt = new Date(Date.now() + 8 * 3600000);
  onStage?.('session_creation');
  const session = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, user.id)).for('update');
    ensure(
      current.isActive && current.passwordHash === user.passwordHash,
      'Credentials changed. Sign in again.',
      'LOGIN',
    );
    const [s] = await tx.insert(sessions).values({ userId: user.id, expiresAt }).returning();
    await tx
      .delete(authRateLimits)
      .where(eq(authRateLimits.key, limiter.find((k) => k.limit === 5)!.key));
    return s;
  });
  onStage?.('token_signing');
  const token = await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(new TextEncoder().encode(signingSecret));
  return { token, expiresAt, userId: user.id };
}
export async function revokeSession(a: Actor) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, a.sessionId!), eq(sessions.userId, a.id)));
}
export async function changePassword(a: Actor, currentPassword: string, newPassword: string) {
  password.parse(newPassword);
  await db.transaction(async (tx) => {
    const [u] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, a.id), eq(users.pharmacyId, a.pharmacyId)))
      .for('update');
    ensure(
      u && (await verify(u.passwordHash, currentPassword).catch(() => false)),
      'Current password is incorrect',
    );
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword) })
      .where(eq(users.id, u.id));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, u.id));
    await tx.insert(auditEvents).values({
      pharmacyId: a.pharmacyId,
      actorId: a.id,
      entityId: a.id,
      entityType: 'account',
      action: 'password_changed',
    });
  });
}

/** Operator-only recovery; deliberately not exposed as an HTTP endpoint/action. */
export async function recoverOwner(address: string, newPassword: string) {
  const normalized = email.parse(address);
  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.email, normalized)).for('update');
    ensure(u, 'Owner not found');
    await tx.update(users).set({ passwordHash, isActive: true }).where(eq(users.id, u.id));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, u.id));
    await tx.insert(auditEvents).values({
      pharmacyId: u.pharmacyId,
      actorId: u.id,
      entityId: u.id,
      entityType: 'account',
      action: 'operator_recovery',
    });
  });
}
