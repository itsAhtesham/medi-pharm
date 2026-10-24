# Medi Pharm

A private web application for a small pharmacy to record customer purchases and follow up before a customer's estimated medicine supply runs out.

**Status: implemented for local development and verification.** The repository includes the Next.js application, PostgreSQL migrations, tests, Docker Compose databases, and operating tools. Production deployment and owner acceptance remain launch steps.

## Documentation

- [Implementation plan](IMPLEMENTATION_PLAN.md): detailed workflows, business rules, architecture, data model, implementation phases, acceptance checks, and launch requirements. This is the source of truth for implementation.
- [Verification record](docs/VERIFICATION.md): checks performed and remaining launch work.
- [Operations runbook](docs/RUNBOOK.md): local setup, migrations, account recovery, encrypted backups, restoration, and launch responsibilities.
- [Dashboard inspiration](docs/references/dashboard-inspiration.png): the visual reference for the lavender and white interface.

## Who it is for

The first release serves **one pharmacy with one owner account**. The owner manages customers, medicines, purchases, and refill follow-ups. Customers do not log in.

In this project, a **purchase** means a customer's purchase from the pharmacy, not a purchase from a supplier.

## Core workflow

1. Select an existing customer or add one while entering a purchase.
2. Add medicines, quantities, and units, creating missing medicines without leaving the form.
3. Enter **new days of supply** for each distinct medicine, combining its different units. Enable **Follow up for this medicine** only when needed.
4. For repeat medicines, choose **Add to remaining supply** or **Start fresh**. Optionally correct the estimated remaining days, then review each run-out and reminder date.
5. Use the dashboard to see customers who need contacting, record contact notes, snooze, close, or record a refill.

The owner contacts customers manually. Marking a customer as contacted does not complete their follow-up, and an unrelated purchase does not close it automatically.

After recording contact, the reminder shows the last contact date and offers **Record refill**. Without a next contact date, it stays in **Needs attention** as **Contacted · Awaiting refill**. Choosing a future date moves it to **Scheduled**; when that date arrives, the main action becomes **Follow up again**. **Record another contact** remains available in the actions menu. Each medicine keeps its own contact status.

## Agreed business rules

- Every customer must have a phone number, including customers whose purchases have no reminders.
- Each medicine has its own supply duration (1–365 new days) and optional reminder. Mixed units of the same medicine share one duration.
- Early refills either add to estimated remaining days or start fresh. Remaining days may be explicitly adjusted; the choice is recorded in history.
- Customer profiles show current estimated supply separately from dated medicine purchase history.
- Click a medicine name in the catalog to see who bought it, when, and in what quantity/unit, with customer/date filters, pagination, and links to customers and purchases.
- Existing purchase-level reminders remain labelled as legacy. Correcting a legacy purchase requires confirming individual durations; no automatic copying occurs.
- The same medicine can appear in separate rows for different units, such as one strip and two tablets. There is no unit conversion or inventory deduction.
- The supply start defaults to the purchase date. Early refills can carry the remaining days; future supply starts are also supported. Future purchase dates are not allowed.
- A closed follow-up for the current medicine supply can be explicitly reopened with a reason. Superseded follow-ups stay in history; correct or cancel the resolving purchase to restore the previous supply.
- Purchase corrections and cancellations must preserve valid refill relationships and contact history.
- Business dates use the pharmacy's calendar in **Asia/Kolkata**.

### Reminder calculation

For newly purchased supplies of **1–365 days**, calculate the lead time as approximately 25% of the duration, rounded to the nearest whole day, with a minimum of one day and a maximum of seven days:

```text
lead_days = min(7, max(1, floor(new_days * 0.25 + 0.5)))
remaining_days = 0 for start fresh; estimated/adjusted remaining days for add
run_out_date = supply_start_date + remaining_days + new_days
reminder_date = run_out_date - lead_days
```

These are calendar-day calculations. The run-out date is the first day beyond the recorded supply period.

| Supply duration | Remind before run-out | Reminder after supply start |
| --------------- | --------------------- | --------------------------- |
| 7 days          | 2 days                | 5 days                      |
| 15 days         | 4 days                | 11 days                     |
| 30 days         | 7 days                | 23 days                     |
| 45 days         | 7 days                | 38 days                     |

A **one-day supply has a one-day reminder lead**. With no remaining supply, its reminder is due on its start date. The owner can override reminder dates; a date at or after run-out needs confirmation.

Example: on 4 November, four remaining days plus an 11-day refill run out on 19 November, with a reminder on 16 November. Starting fresh runs out on 15 November, with a reminder on 12 November. The lead is three days in both cases.

For example, a 30-day supply starting on 1 November 2026 has an expected run-out date of 1 December and a reminder date of 24 November.

The dashboard shows open follow-ups whose next action date is today or earlier. Dashboard reminders do not require a scheduled job. Supply dates are estimates based on the recorded duration, not a measure of actual medicine consumption.

## Technology

| Area                        | Choice                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Application                 | Next.js App Router and TypeScript, with server logic in the same application                                         |
| Database                    | Neon PostgreSQL                                                                                                      |
| Database access             | Drizzle ORM, `pg` connection pooling, and SQL migrations                                                             |
| Authentication              | Email/password, Argon2id password hashing, and JWTs in secure HttpOnly cookies backed by revocable database sessions |
| Interface                   | shadcn/ui, Tailwind CSS, and Lucide icons                                                                            |
| Forms and validation        | React Hook Form and Zod                                                                                              |
| Testing                     | Vitest, PostgreSQL integration tests, and Playwright                                                                 |
| Package manager             | pnpm                                                                                                                 |
| Production hosting proposal | Vercel commercial plan and Neon; production provisioning is pending                                                  |

Installed dependency versions are recorded in `package.json` and `pnpm-lock.yaml`. Local PostgreSQL runs through Docker Compose; production is configured for Neon.

## Interface direction

Use soft lavender surfaces, white rounded cards, subtle borders, and readable text. The main navigation contains Dashboard, Follow-ups, Customers, Medicines, and Purchases, with Settings and sign out below.

The dashboard shows a compact list of up to five customers with due follow-ups, grouping their medicines together, and the total customer/reminder counts. The dedicated Follow-ups page contains the reminder cards, status tabs, and pagination. The [reference image](docs/references/dashboard-inspiration.png) guides the visual style; its clinical metrics and features are outside this product's scope.

## Outside the first release

Inventory and stock tracking, batches and expiry management, billing and invoices, prices and taxes, payments, supplier management, barcode scanning, prescriptions, clinical advice, automated messaging, offline synchronization, public signup, and multiple pharmacies are deferred.

## Development and launch

Use Node.js 22 LTS, pnpm 10, and Docker with Compose:

```bash
pnpm install --frozen-lockfile
pnpm setup:env
pnpm db:up
pnpm db:migrate
pnpm run owner bootstrap
pnpm dev
```

Open `http://localhost:3000`. The bootstrap command prompts for the owner email, a hidden passphrase, and the pharmacy name. There are no default production credentials. Optional synthetic data: `pnpm run seed --confirm-development` after bootstrap. To replace tagged demo data in the local Docker database while preserving owner access and manually added customers, use `pnpm run seed --confirm-development --replace-demo`.

Docker Compose keeps development data in a named volume on loopback port 54329. A separate disposable test database uses port 54330. `pnpm db:down` stops development containers without deleting the volume.

```bash
pnpm db:test:up
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm lint
pnpm typecheck
pnpm build
```

Tests use `.env.test.local`, created by `pnpm setup:env`. Integration and browser tests reset the disposable test database; run those suites sequentially. Integration tests are skipped when `TEST_DATABASE_URL` is missing.

See the [runbook](docs/RUNBOOK.md) for environment variables, database operations, recovery, and release verification. The [implementation plan](IMPLEMENTATION_PLAN.md) retains the agreed scope and acceptance rules.

Before launch, settle production account ownership, domain and hosting costs, recovery operators, backup responsibilities, and accepted recovery targets. Backup restoration must include resetting the owner's password and revoking restored sessions before reopening access.

Use synthetic customer data during development. Keep production credentials, database backups, and real customer records out of source control.
