# Operations runbook

The application is implemented and tested locally. Production hosting, Neon credentials, domain, account ownership, backup destination, and named operators still need to be configured before launch. Nothing in this repository provisions paid services or deploys automatically.

## Local development with Docker Compose

Requirements: Node.js 22 LTS or newer supported LTS, pnpm 10, Docker Engine with Compose. The package supports Node 20.19+, but choose a supported LTS for a new installation.

```bash
pnpm install --frozen-lockfile
pnpm setup:env
pnpm db:up
pnpm db:migrate
pnpm run owner bootstrap
pnpm dev
```

Open `http://localhost:3000`. Bootstrap asks for an email, a hidden 15–128-character passphrase and a pharmacy name. There is no public registration or default owner password. `setup:env` generates separate local secrets and preserves existing configuration.

Compose binds PostgreSQL to loopback port **54329**, with a named volume for development records. Its credentials are local-only placeholders, not production secrets. `pnpm db:down` stops the container without deleting its volume. Do not add `--volumes` unless deliberately discarding local data. The optional `db-test` profile binds port **54330** and stores its disposable data in tmpfs.

Optional synthetic records, after owner bootstrap:

```bash
pnpm seed --confirm-development
```

The seed normally refuses a nonempty customer catalog and always refuses `NODE_ENV=production`. To replace earlier demo records locally, run `pnpm run seed --confirm-development --replace-demo`. Replacement is restricted to `medi_pharm` on localhost port 54329 and removes only customers marked `Synthetic development record` and their related history, plus unused associated demo medicines. It preserves untagged customers, the owner login, sessions, and pharmacy settings. The new dataset contains eight fictional customers with ages, six medicine types, and thirteen purchases covering per-medicine durations, both early-refill choices, adjusted remaining days, mixed units, opt-out, contact, snooze, cancellation and closed follow-ups. It never sends messages. For isolated automated previews only, `SEED_OWNER_PASSWORD` can provision `owner@example.test` when no owner exists; never use this option in production.

## Configuration

| Variable               | Purpose                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`         | Runtime connection: pooled Neon URL in production                              |
| `DATABASE_DIRECT_URL`  | Direct/unpooled database URL for migrations, owner commands, and backup        |
| `JWT_SECRET`           | Separate cryptographically random signing secret, at least 32 characters       |
| `RATE_LIMIT_SECRET`    | Separate cryptographically random HMAC key for login limiter identifiers       |
| `APP_URL`              | Exact application origin; cookie mutation requests must match it               |
| `TRUSTED_PROXY`        | `vercel` only on Vercel; otherwise `none` uses a shared conservative IP bucket |
| `TEST_DATABASE_URL`    | Disposable database whose name ends in `_test`; test suites erase it           |
| `BACKUP_DIRECTORY`     | Absolute path on restricted off-database archive storage                       |
| `BACKUP_GPG_RECIPIENT` | Full, verified fingerprint of the custodian's GPG public key                   |
| `RESTORE_DATABASE_URL` | Explicit empty, isolated, direct PostgreSQL restore target                     |

Keep `.env.local`, `.env.test.local`, private keys and database exports out of Git. The application never stores JWTs or purchase drafts in localStorage. `pg` validates TLS using the supplied connection configuration; use Neon's provided connection strings without disabling certificate verification.

The local CLI scripts load `.env.local`. On an operations runner, inject the same variable names through its secret store and invoke `pnpm exec tsx scripts/<command>.ts` without `--env-file`; do not copy production secrets into source files or command arguments.

## Verification

```bash
pnpm db:test:up
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm lint
pnpm typecheck
pnpm build
```

`pnpm setup:env` creates `.env.test.local` from the supplied example. Unit tests run without a database, and integration tests are explicitly skipped if `TEST_DATABASE_URL` is absent. Browser tests require it. Do not run integration and browser suites concurrently: both own and reset the same disposable database.

Playwright starts and stops its own Next.js server on port 3100 (development by default; use `E2E_PRODUCTION=1 pnpm test:e2e` after `pnpm build` to test the production build), provisions a synthetic owner with a random password, and covers purchase/refill/correction, uncertain-response retries, session expiry and mobile keyboard navigation. It accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for an installed Chromium/Chrome executable. Traces and screenshots under `test-results/` are ignored by Git.

For the encrypted backup and credential-recovery rehearsal, install GnuPG and PostgreSQL client tools (same or newer major version than the database), then run:

```bash
pnpm test:recovery
```

This requires the local Compose test database. It creates two uniquely named temporary databases and a temporary encryption key, verifies backup/restore and old-credential rejection, then removes only those temporary resources. It also checks nonzero exits for stale and failed backups. Actual production job notifications still need an operator rehearsal.

## Deployment

1. Create separate Neon development/preview and production databases. Select supported PostgreSQL versions; local Compose uses PostgreSQL 17.
2. Configure a commercial hosting account and application region close to the database. Set all runtime secrets and the production HTTPS `APP_URL`. Only configure `TRUSTED_PROXY=vercel` on Vercel.
3. Run checks and `pnpm build`. Apply reviewed migrations using the **direct** production connection from a controlled operator environment. Do not run schema push or migrations inside request handling.
4. Bootstrap the sole owner once using the hidden-prompt command. No fixture seed runs during build or deployment.
5. Deploy, verify HTTPS and secure cookies, then smoke-test login, purchase, follow-up, export and logout with clearly identified temporary records. Archive/cancel those records through the application.
6. Configure the host's error and job notifications. Logs contain operation/request identifiers and error types, not customer payloads, tokens or credentials. Send alerts to the assigned support operator.
7. Complete backup, restore and access-recovery rehearsals before owner handover.

`next.config.ts` configures security headers. Protected pages use dynamic rendering. Every data read/action checks the session and pharmacy scope; the database pool is bounded and attached to Vercel's lifecycle when running there.

## Migrations and rollback

Schema source: `src/server/db/schema.ts`. Generate with `pnpm db:generate`, review SQL under `drizzle/`, then apply with `pnpm db:migrate`. Check migrations into source control; never edit an already deployed migration. Test them against a restored staging database before production use.

Prefer additive, backward-compatible migrations. Roll the application back to the previous compatible release through the host. If a destructive migration is unavoidable, document a separate reviewed recovery procedure and create a verified backup first. The repository does not automatically run destructive rollbacks.

## Owner access recovery and secret rotation

Use the established owner-verification channel, never a phone/email address supplied only by an unknown requester. In a trusted terminal with the target direct connection:

```bash
pnpm run owner recover
```

The command prompts for email and a hidden new passphrase, asks for `RESET`, updates the password, enables the owner account, revokes all sessions, and records an audit event. The same password validator is used for bootstrap, owner password changes and operator recovery. Changing a password inside the application also revokes every session.

Rotate `JWT_SECRET` to invalidate all signed tokens, and revoke live database sessions as part of the response. Rotate database credentials and update both pooled and direct secrets together; verify migrations and the backup runner still connect. Rotate `RATE_LIMIT_SECRET` separately; it changes hashed limiter keys, so monitor login failures during the transition.

## Encrypted daily backups

The runner needs `pg_dump` of the same or newer major version than the server and GnuPG. Import the custodian's public key and verify its full fingerprint out of band. The private key should be held separately with a documented recovery path.

Configure `BACKUP_DIRECTORY` on durable off-database storage. The backup command does not upload a local directory to cloud storage; the selected operator must provide a mounted archive destination or an additional verified transfer step before declaring the backup offsite.

```bash
pnpm backup
pnpm backup --check-stale
```

The command uses `DATABASE_DIRECT_URL`, streams a custom-format PostgreSQL dump directly into GPG encryption, writes an encrypted archive and SHA-256 sidecar, and atomically records `last-success.json`. It retains matching archives for 30 days. It never writes a plaintext dump to disk or puts the database password in process arguments. Partial failures leave no success marker.

Schedule backup once daily, and the independent freshness check at least hourly. Configure the runner's failure notification for **both** jobs. A missing or older-than-26-hour success record exits nonzero; a runner that never executes cannot alert by itself, so use the platform's missed-job notifications too. Rehearse failure by using an intentionally unavailable test connection and confirm the named recipient actually receives the runner's alert.

## Restore into isolation

Keep application traffic away from the restore target throughout this process. Use a fresh empty database and direct connection. The restore command refuses a database containing application tables.

```bash
# RESTORE_DATABASE_URL is supplied through the operator's secret environment.
pnpm restore /secure/archive/medi-pharm-<timestamp>.dump.gpg --confirm-isolated-restore
```

The command verifies the encrypted checksum, decrypts into `pg_restore`, then disables restored owners and revokes restored sessions. The GPG decryption key must already be available through the custodian's secure process. A failed restore target remains isolated and must be discarded or investigated before reuse.

Before traffic is reopened:

1. Point `DATABASE_DIRECT_URL` at the restored database and run `pnpm run owner recover` to choose a **new** password. This re-enables the owner only after resetting credentials.
2. Verify that the old password, the backup-era password, and restored JWTs fail; verify the new password works.
3. Verify migrations, purchase/item counts, customer data, refill relationships, event history and mutation receipts. Run the application smoke checks against the isolated database.
4. Update the runtime connection and reopen traffic only after these checks succeed. Record the archive, restore time, operator, checks and outcome.

Restoring a backup can restore an old compromised password hash; revoking sessions alone is insufficient. Daily backups imply up to 24 hours of lost data. A one-business-day recovery target is only a proposal until the named operators and pharmacy owner accept it and rehearse the procedure.

## Routine cleanup

```bash
pnpm ops cleanup
```

Schedule this daily through the selected operations runner. It removes limiter windows older than one day and sessions expired for more than 30 days. Business mutation receipts are retained. Dashboard reminder dates are queried at read time and do not depend on any scheduled task.

## Launch ownership record

Fill this in with the owner before launch:

| Responsibility                                  | Assigned detail              |
| ----------------------------------------------- | ---------------------------- |
| Primary recovery operator and support hours     | Pending                      |
| Backup operator / secondary contact             | Pending                      |
| Verified owner contact and verification method  | Pending                      |
| Production hosting, Neon, and domain owners     | Pending                      |
| Daily backup runner and archive destination     | Pending                      |
| GPG private-key custodian and recovery access   | Pending                      |
| Failure/missed-job notification recipient       | Pending                      |
| Accepted data-loss and restoration targets      | Pending                      |
| Last full restore and access-recovery rehearsal | Pending production rehearsal |
| Owner walkthrough and acceptance                | Pending                      |
