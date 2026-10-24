import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, and, sql, count } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const url = process.env.TEST_DATABASE_URL;
if (url) {
  if (!new URL(url).pathname.endsWith('_test'))
    throw new Error('Integration database name must end in _test');
  process.env.DATABASE_URL = url;
}
process.env.JWT_SECRET ??= 'test-only-secret-not-for-deployment-123456';
process.env.RATE_LIMIT_SECRET ??= 'test-only-rate-secret-not-for-deployment-123456';
const suite = describe.skipIf(!url);
suite('PostgreSQL workflows', () => {
  let db: typeof import('../src/server/db').db,
    pool: typeof import('../src/server/db').pool,
    s: typeof import('../src/server/db/schema');
  let cat: typeof import('../src/server/services/catalog'),
    buy: typeof import('../src/server/services/purchases'),
    follow: typeof import('../src/server/services/follow-ups'),
    auth: typeof import('../src/server/auth');
  let a: { id: string; pharmacyId: string },
    foreign: { id: string; pharmacyId: string },
    customerId: string,
    medicineId: string;
  const today = '2020-01-01';
  const base = () => ({
    customerId,
    purchaseDate: today,
    items: [{ medicineId, quantity: 2, unit: 'strips' }],
    reminderEnabled: true,
    supplyStart: today,
    supplyDays: 30,
  });
  const get = async (id: string) =>
    (await db.select().from(s.followUps).where(eq(s.followUps.purchaseId, id)))[0];
  const purchase = async (id: string) =>
    (await db.select().from(s.purchases).where(eq(s.purchases.id, id)))[0];
  const create = async () => buy.savePurchase(a, randomUUID(), base());
  beforeAll(async () => {
    const mp = new Pool({ connectionString: url, max: 1 });
    await migrate(drizzle(mp), { migrationsFolder: './drizzle' });
    await mp.end();
    ({ db, pool } = await import('../src/server/db'));
    s = await import('../src/server/db/schema');
    cat = await import('../src/server/services/catalog');
    buy = await import('../src/server/services/purchases');
    follow = await import('../src/server/services/follow-ups');
    auth = await import('../src/server/auth');
    // This suite owns this explicitly named isolated test database.
    await db.execute(sql`truncate pharmacies, auth_rate_limits cascade`);
    const [p] = await db.insert(s.pharmacies).values({ name: 'Test Pharmacy' }).returning();
    const [u] = await db
      .insert(s.users)
      .values({
        pharmacyId: p.id,
        email: 'owner@test.example',
        passwordHash: await auth.hashPassword('a test only passphrase'),
      })
      .returning();
    a = { id: u.id, pharmacyId: p.id };
    const [other] = await db.insert(s.pharmacies).values({ name: 'Other scope' }).returning();
    const [ou] = await db
      .insert(s.users)
      .values({
        pharmacyId: other.id,
        email: 'other@test.example',
        passwordHash: await auth.hashPassword('another test passphrase'),
      })
      .returning();
    foreign = { id: ou.id, pharmacyId: other.id };
    customerId = (
      await cat.saveCustomer(a, randomUUID(), { name: 'Synthetic Customer', phone: '+12025550101' })
    ).id;
    medicineId = (
      await cat.saveMedicine(a, randomUUID(), {
        name: 'Test medicine',
        strength: '10 mg',
        form: 'Tablet',
      })
    ).id;
  });
  afterAll(async () => {
    await pool?.end();
  });
  it('preserves date-only round trips under alternate database/process zones', async () => {
    const result = await create();
    const p = await purchase(result.id);
    expect(p.purchaseDate).toBe(today);
    expect(p.runOutDate).toBe('2020-01-31');
    const old = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const result = await pool.query("select '2026-11-24'::date as d");
      expect(result.rows[0].d).toBe('2026-11-24');
    } finally {
      process.env.TZ = old;
    }
  });
  it('replays inline creates and refuses identifier reuse', async () => {
    const key = randomUUID(),
      v = { name: 'Shared phone', phone: '+12025550101' };
    const one = await cat.saveCustomer(a, key, v);
    expect(await cat.saveCustomer(a, key, v)).toEqual(one);
    await expect(
      cat.saveCustomer(a, key, { ...v, name: 'Edited during uncertainty' }),
    ).rejects.toThrow('different submission');
  });
  it('replays purchase and contact saves without duplicates', async () => {
    const key = randomUUID();
    const one = await buy.savePurchase(a, key, base());
    expect(await buy.savePurchase(a, key, base())).toEqual(one);
    const f = await get(one.id);
    const ck = randomUUID();
    const command = { id: f.id, version: f.version, action: 'contact', note: 'Reached customer' };
    await follow.followCommand(a, ck, command);
    await follow.followCommand(a, ck, command);
    expect((await get(one.id)).status).toBe('open');
    const [n] = await db
      .select({ count: count() })
      .from(s.followUpEvents)
      .where(and(eq(s.followUpEvents.followUpId, f.id), eq(s.followUpEvents.action, 'contact')));
    expect(n.count).toBe(1);
  });
  it('rolls back all writes for an invalid medicine or foreign customer', async () => {
    const [before] = await db.select({ count: count() }).from(s.purchases);
    await expect(
      buy.savePurchase(a, randomUUID(), {
        ...base(),
        items: [{ medicineId: randomUUID(), quantity: 1, unit: 'strips' }],
      }),
    ).rejects.toThrow();
    await expect(buy.savePurchase(foreign, randomUUID(), base())).rejects.toThrow(
      'Customer not found',
    );
    const [after] = await db.select({ count: count() }).from(s.purchases);
    expect(after.count).toBe(before.count);
  });
  it('accepts mixed units and keeps medicine snapshots after catalog rename', async () => {
    const r = await buy.savePurchase(a, randomUUID(), {
      ...base(),
      items: [...base().items, { medicineId, quantity: 2, unit: 'tablets' }],
    });
    const [med] = await db.select().from(s.medicines).where(eq(s.medicines.id, medicineId));
    await cat.saveMedicine(a, randomUUID(), {
      id: medicineId,
      version: med.version,
      name: 'Renamed test medicine',
      strength: med.strength,
      form: med.form,
    });
    const items = await db
      .select()
      .from(s.purchaseItems)
      .where(eq(s.purchaseItems.purchaseId, r.id));
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe('Test medicine');
  });
  it('only explicitly completed refills close a follow-up; cancellation reopens', async () => {
    const source = await create(),
      f = await get(source.id);
    await buy.savePurchase(a, randomUUID(), {
      ...base(),
      refillOf: source.id,
      sourceVersion: f.version,
    });
    expect((await get(source.id)).status).toBe('open');
    const refill = await buy.savePurchase(a, randomUUID(), {
      ...base(),
      refillOf: source.id,
      sourceVersion: f.version,
      completePrevious: true,
    });
    expect((await get(source.id)).resolvingPurchaseId).toBe(refill.id);
    await buy.purchaseCommand(a, randomUUID(), {
      id: refill.id,
      version: 1,
      action: 'cancel',
      reason: 'Entry error',
    });
    expect(await get(source.id)).toMatchObject({ status: 'open', resolvingPurchaseId: null });
  });
  it('two concurrent refill completions produce one winner and no orphan purchase', async () => {
    const source = await create(),
      f = await get(source.id);
    const [before] = await db.select({ count: count() }).from(s.purchases);
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        buy.savePurchase(a, randomUUID(), {
          ...base(),
          refillOf: source.id,
          sourceVersion: f.version,
          completePrevious: true,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [after] = await db.select({ count: count() }).from(s.purchases);
    expect(after.count).toBe(before.count + 1);
  });
  it('completion racing cancellation leaves no resolution to an invalid purchase', async () => {
    const source = await create(),
      f = await get(source.id);
    await Promise.allSettled([
      buy.savePurchase(a, randomUUID(), {
        ...base(),
        refillOf: source.id,
        sourceVersion: f.version,
        completePrevious: true,
      }),
      buy.purchaseCommand(a, randomUUID(), {
        id: source.id,
        version: 1,
        action: 'cancel',
        reason: 'Cancelled source',
      }),
    ]);
    const sf = await get(source.id);
    expect(sf.status).toBe('closed');
    if (sf.resolvingPurchaseId)
      expect((await purchase(sf.resolvingPurchaseId)).status).toBe('active');
  });
  it('cancelling a refill does not reopen a cancelled source', async () => {
    const source = await create(),
      f = await get(source.id);
    const refill = await buy.savePurchase(a, randomUUID(), {
      ...base(),
      refillOf: source.id,
      sourceVersion: f.version,
      completePrevious: true,
    });
    await buy.purchaseCommand(a, randomUUID(), {
      id: source.id,
      version: 1,
      action: 'cancel',
      reason: 'Cancelled source',
    });
    await buy.purchaseCommand(a, randomUUID(), {
      id: refill.id,
      version: 1,
      action: 'cancel',
      reason: 'Cancelled refill',
    });
    expect(await get(source.id)).toMatchObject({
      status: 'closed',
      resolvingPurchaseId: null,
      closedReason: 'purchase_cancelled',
    });
  });
  it('preserves current resolution when a former refill is cancelled', async () => {
    const source = await create();
    let f = await get(source.id);
    const old = await buy.savePurchase(a, randomUUID(), {
      ...base(),
      refillOf: source.id,
      sourceVersion: f.version,
      completePrevious: true,
    });
    f = await get(source.id);
    await follow.followCommand(a, randomUUID(), {
      id: f.id,
      version: f.version,
      action: 'reopen',
      date: '2099-01-01',
      note: 'Wrong completion',
    });
    f = await get(source.id);
    const current = await buy.savePurchase(a, randomUUID(), {
      ...base(),
      refillOf: source.id,
      sourceVersion: f.version,
      completePrevious: true,
    });
    await buy.purchaseCommand(a, randomUUID(), {
      id: old.id,
      version: 1,
      action: 'cancel',
      reason: 'Old entry',
    });
    expect((await get(source.id)).resolvingPurchaseId).toBe(current.id);
  });
  it('rejects customer changes on linked purchases; explicit detach reverses completion', async () => {
    const source = await create(),
      f = await get(source.id);
    const refill = await buy.savePurchase(a, randomUUID(), {
      ...base(),
      refillOf: source.id,
      sourceVersion: f.version,
      completePrevious: true,
    });
    const other = (
      await cat.saveCustomer(a, randomUUID(), { name: 'Another customer', phone: '+12025550102' })
    ).id;
    await expect(
      buy.savePurchase(a, randomUUID(), {
        ...base(),
        id: refill.id,
        version: 1,
        refillOf: source.id,
        customerId: other,
        reason: 'Wrong customer',
      }),
    ).rejects.toThrow('Detach');
    await buy.purchaseCommand(a, randomUUID(), {
      id: refill.id,
      version: 1,
      action: 'detach',
      reason: 'Wrong link',
    });
    expect((await get(source.id)).status).toBe('open');
    expect((await purchase(refill.id)).refillOf).toBeNull();
  });
  it('requires explicit completion correction decisions', async () => {
    const source = await create(),
      f = await get(source.id);
    const refill = await buy.savePurchase(a, randomUUID(), {
      ...base(),
      refillOf: source.id,
      sourceVersion: f.version,
      completePrevious: true,
    });
    const changed = {
      ...base(),
      id: refill.id,
      version: 1,
      refillOf: source.id,
      supplyDays: 45,
      reason: 'Correct coverage',
    };
    await expect(buy.savePurchase(a, randomUUID(), changed)).rejects.toThrow('Keep completed');
    await buy.savePurchase(a, randomUUID(), { ...changed, completionChoice: 'reverse' });
    expect((await get(source.id)).status).toBe('open');
  });
  it('disable/re-enable distinguishes disabled from manually closed', async () => {
    const source = await create();
    let f = await get(source.id);
    await follow.followCommand(a, randomUUID(), {
      id: f.id,
      version: f.version,
      action: 'close',
      reason: 'declined',
    });
    await buy.savePurchase(a, randomUUID(), {
      ...base(),
      id: source.id,
      version: 1,
      reminderEnabled: false,
      reason: 'Disable',
    });
    await buy.savePurchase(a, randomUUID(), {
      ...base(),
      id: source.id,
      version: 2,
      reason: 'Enable',
      reopenDisabled: true,
      reopenDate: '2099-01-01',
    });
    f = await get(source.id);
    expect(f).toMatchObject({ status: 'closed', closedReason: 'declined' });
    await follow.followCommand(a, randomUUID(), {
      id: f.id,
      version: f.version,
      action: 'reopen',
      note: 'Customer changed mind',
      date: '2099-01-01',
    });
    expect((await get(source.id)).status).toBe('open');
  });
  it('disabled source stays closed when its resolving refill is cancelled', async () => {
    const source = await create(),
      f = await get(source.id);
    const refill = await buy.savePurchase(a, randomUUID(), {
      ...base(),
      refillOf: source.id,
      sourceVersion: f.version,
      completePrevious: true,
    });
    await buy.savePurchase(a, randomUUID(), {
      ...base(),
      id: source.id,
      version: 1,
      reminderEnabled: false,
      completionChoice: 'keep',
      reason: 'Stop reminders',
    });
    await buy.purchaseCommand(a, randomUUID(), {
      id: refill.id,
      version: 1,
      action: 'cancel',
      reason: 'Correct refill',
    });
    expect(await get(source.id)).toMatchObject({
      status: 'closed',
      closedReason: 'reminder_disabled',
      resolvingPurchaseId: null,
    });
  });
  it('rejects stale saves and cross-scope follow-up actions', async () => {
    const source = await create(),
      f = await get(source.id);
    await follow.followCommand(a, randomUUID(), {
      id: f.id,
      version: f.version,
      action: 'contact',
    });
    await expect(
      follow.followCommand(a, randomUUID(), { id: f.id, version: f.version, action: 'contact' }),
    ).rejects.toThrow('changed');
    await expect(
      follow.followCommand(foreign, randomUUID(), {
        id: f.id,
        version: f.version,
        action: 'contact',
      }),
    ).rejects.toThrow('not found');
  });
  it('supports opt-out and the explicit one-day exception', async () => {
    const plain = await buy.savePurchase(a, randomUUID(), {
      ...base(),
      reminderEnabled: false,
      supplyDays: undefined,
      supplyStart: undefined,
    });
    expect(await get(plain.id)).toBeUndefined();
    await expect(buy.savePurchase(a, randomUUID(), { ...base(), supplyDays: 1 })).rejects.toThrow();
    const one = await buy.savePurchase(a, randomUUID(), {
      ...base(),
      supplyDays: 1,
      manualDate: today,
      oneDayConfirmed: true,
    });
    expect(await get(one.id)).toMatchObject({
      calculatedDate: null,
      manualDate: today,
      nextDate: today,
    });
  });
  it('snoozing preserves the calculation and requires a scheduling decision after correction', async () => {
    const source = await create();
    let f = await get(source.id);
    const calculated = f.calculatedDate;
    await follow.followCommand(a, randomUUID(), {
      id: f.id,
      version: f.version,
      action: 'snooze',
      date: '2099-01-01',
    });
    const change = {
      ...base(),
      id: source.id,
      version: 1,
      supplyDays: 45,
      reason: 'Correct duration',
    };
    await expect(buy.savePurchase(a, randomUUID(), change)).rejects.toThrow('keep the next action');
    await buy.savePurchase(a, randomUUID(), { ...change, scheduleChoice: 'keep' });
    f = await get(source.id);
    expect(f.nextDate).toBe('2099-01-01');
    expect(f.calculatedDate).not.toBe(calculated);
  });
  it('offers explicit reopening for a disabled follow-up', async () => {
    const source = await create();
    await buy.savePurchase(a, randomUUID(), {
      ...base(),
      id: source.id,
      version: 1,
      reminderEnabled: false,
      reason: 'Disable',
    });
    expect(await get(source.id)).toMatchObject({
      status: 'closed',
      closedReason: 'reminder_disabled',
    });
    await buy.savePurchase(a, randomUUID(), {
      ...base(),
      id: source.id,
      version: 2,
      reason: 'Enable',
    });
    expect((await get(source.id)).status).toBe('closed');
    await buy.savePurchase(a, randomUUID(), {
      ...base(),
      id: source.id,
      version: 3,
      reason: 'Reopen disabled',
      reopenDisabled: true,
      reopenDate: '2099-01-01',
    });
    expect(await get(source.id)).toMatchObject({
      status: 'open',
      closedReason: null,
      nextDate: '2099-01-01',
    });
  });
  it('rejects cross-customer refill links and reopening cancelled purchases', async () => {
    const source = await create(),
      f = await get(source.id);
    const other = (
      await cat.saveCustomer(a, randomUUID(), { name: 'Link test customer', phone: '+12025550103' })
    ).id;
    await expect(
      buy.savePurchase(a, randomUUID(), {
        ...base(),
        customerId: other,
        refillOf: source.id,
        sourceVersion: f.version,
      }),
    ).rejects.toThrow('same customer');
    await buy.purchaseCommand(a, randomUUID(), {
      id: source.id,
      version: 1,
      action: 'cancel',
      reason: 'Cancel',
    });
    const closed = await get(source.id);
    await expect(
      follow.followCommand(a, randomUUID(), {
        id: closed.id,
        version: closed.version,
        action: 'reopen',
        date: '2099-01-01',
        note: 'Try reopening',
      }),
    ).rejects.toThrow('active');
  });
  it('archives without losing history and rejects exact medicine duplicates', async () => {
    const cid = (
      await cat.saveCustomer(a, randomUUID(), { name: 'Archive customer', phone: '+12025550104' })
    ).id;
    const source = await buy.savePurchase(a, randomUUID(), { ...base(), customerId: cid });
    await expect(
      cat.archiveRecord(a, randomUUID(), { kind: 'customer', id: cid, version: 1, archived: true }),
    ).rejects.toThrow('open follow-ups');
    await cat.archiveRecord(a, randomUUID(), {
      kind: 'customer',
      id: cid,
      version: 1,
      archived: true,
      confirmed: true,
    });
    expect((await get(source.id)).status).toBe('open');
    await expect(buy.savePurchase(a, randomUUID(), { ...base(), customerId: cid })).rejects.toThrow(
      'Restore',
    );
    await cat.archiveRecord(a, randomUUID(), {
      kind: 'customer',
      id: cid,
      version: 2,
      archived: false,
    });
    const [med] = await db.select().from(s.medicines).where(eq(s.medicines.id, medicineId));
    await expect(
      cat.saveMedicine(a, randomUUID(), {
        name: med.name.toUpperCase(),
        strength: med.strength,
        form: med.form,
      }),
    ).rejects.toThrow('already exists');
  });
  it('authenticates with revocable JWTs and revokes all sessions on password change', async () => {
    const session = await auth.login('OWNER@test.example', 'a test only passphrase', 'test-ip');
    expect(await auth.verifyToken(session.token)).toMatchObject(a);
    expect(await auth.verifyToken(session.token + 'x')).toBeNull();
    await auth.changePassword(a, 'a test only passphrase', 'a changed test passphrase');
    expect(await auth.verifyToken(session.token)).toBeNull();
    await expect(
      auth.login('owner@test.example', 'a test only passphrase', 'test-ip'),
    ).rejects.toThrow('incorrect');
    const fresh = await auth.login('owner@test.example', 'a changed test passphrase', 'test-ip');
    expect(await auth.verifyToken(fresh.token)).toMatchObject(a);
  });
  it('operator recovery re-enables a restored owner and rejects backup-era credentials', async () => {
    const oldSession = await auth.login(
      'owner@test.example',
      'a changed test passphrase',
      'restore-ip',
    );
    const backupHash = await auth.hashPassword('a test only passphrase');
    await db
      .update(s.users)
      .set({ passwordHash: backupHash, isActive: false })
      .where(eq(s.users.id, a.id));
    expect(await auth.verifyToken(oldSession.token)).toBeNull();
    await expect(
      auth.login('owner@test.example', 'a test only passphrase', 'restore-ip'),
    ).rejects.toThrow('incorrect');
    await auth.recoverOwner('owner@test.example', 'a recovery test passphrase');
    await expect(
      auth.login('owner@test.example', 'a test only passphrase', 'restore-ip'),
    ).rejects.toThrow('incorrect');
    await expect(
      auth.login('owner@test.example', 'a changed test passphrase', 'restore-ip'),
    ).rejects.toThrow('incorrect');
    expect(await auth.verifyToken(oldSession.token)).toBeNull();
    const fresh = await auth.login(
      'owner@test.example',
      'a recovery test passphrase',
      'restore-ip',
    );
    expect(await auth.verifyToken(fresh.token)).toMatchObject(a);
  });
  it('throttles persistent failed login attempts', async () => {
    for (let i = 0; i < 5; i++)
      await expect(
        auth.login('missing@test.example', 'wrong passphrase', 'limiter-ip'),
      ).rejects.toThrow('incorrect');
    await expect(
      auth.login('missing@test.example', 'wrong passphrase', 'limiter-ip'),
    ).rejects.toThrow('Too many');
  });
});
