# Medi Pharm

A private web application for a small pharmacy to record customer purchases and follow up before a customer's estimated medicine supply runs out.

**Status: planning complete; application development has not started.** This repository currently contains the implementation plan and dashboard design reference. There is no runnable application or development setup yet.

## Documentation

- [Implementation plan](IMPLEMENTATION_PLAN.md): detailed workflows, business rules, architecture, data model, implementation phases, acceptance checks, and launch requirements. This is the source of truth for implementation.
- [Dashboard inspiration](docs/references/dashboard-inspiration.png): the visual reference for the lavender and white interface.

## Who it is for

The first release serves **one pharmacy with one owner account**. The owner manages customers, medicines, purchases, and refill follow-ups. Customers do not log in.

In this project, a **purchase** means a customer's purchase from the pharmacy, not a purchase from a supplier.

## Core workflow

1. Select an existing customer or add one while entering a purchase.
2. Add medicines, quantities, and units, creating missing medicines without leaving the form.
3. Optionally enable **Remind me for a refill**, which is unchecked by default.
4. Enter the supply start date and days of supply for the whole purchase, then review the reminder date.
5. Use the dashboard to see customers who need contacting, record contact notes, snooze, close, or record a refill.

The owner contacts customers manually. Marking a customer as contacted does not complete their follow-up, and an unrelated purchase does not close it automatically.

## Agreed business rules

- Every customer must have a phone number, including customers whose purchases have no reminders.
- Supply duration applies to the entire purchase. Medicines with different durations require separate purchases.
- The same medicine can appear in separate rows for different units, such as one strip and two tablets. There is no unit conversion or inventory deduction.
- The supply start defaults to the purchase date and can be later for an early refill. Future purchase dates are not allowed.
- Follow-ups can be explicitly reopened, including reversal of an incorrect refill completion, with a reason and preserved history.
- Purchase corrections and cancellations must preserve valid refill relationships and contact history.
- Business dates use the pharmacy's calendar in **Asia/Kolkata**.

### Reminder calculation

For supplies of **2–365 days**, calculate the lead time as approximately 25% of the duration, rounded to the nearest whole day, with a minimum of one day and a maximum of seven days:

```text
lead_days = min(7, max(1, floor(days_of_supply * 0.25 + 0.5)))
run_out_date = supply_start_date + days_of_supply
reminder_date = run_out_date - lead_days
```

These are calendar-day calculations. The run-out date is the first day beyond the recorded supply period.

| Supply duration | Remind before run-out | Reminder after supply start |
| --- | --- | --- |
| 7 days | 2 days | 5 days |
| 15 days | 4 days | 11 days |
| 30 days | 7 days | 23 days |
| 45 days | 7 days | 38 days |

A **one-day supply requires a manually selected follow-up date**, which may be the supply start day. The owner can also override other reminder dates under the validation rules in the implementation plan.

For example, a 30-day supply starting on 1 November 2026 has an expected run-out date of 1 December and a reminder date of 24 November.

The dashboard shows open follow-ups whose next action date is today or earlier. Dashboard reminders do not require a scheduled job. Supply dates are estimates based on the recorded duration, not a measure of actual medicine consumption.

## Planned technology

| Area | Choice |
| --- | --- |
| Application | Next.js App Router and TypeScript, with server logic in the same application |
| Database | Neon PostgreSQL |
| Database access | Drizzle ORM, `pg` connection pooling, and SQL migrations |
| Authentication | Email/password, Argon2id password hashing, and JWTs in secure HttpOnly cookies backed by revocable database sessions |
| Interface | shadcn/ui, Tailwind CSS, and Lucide icons |
| Forms and validation | React Hook Form and Zod |
| Testing | Vitest, PostgreSQL integration tests, and Playwright |
| Package manager | pnpm |
| Proposed hosting | Vercel commercial plan and Neon; production provisioning is pending |

These are planned choices, not installed dependencies. Package versions, environment variable names, and runnable commands will be documented when the application is scaffolded.

## Interface direction

Use soft lavender surfaces, white rounded cards, subtle borders, and readable text. The main navigation will contain Dashboard, Customers, Medicines, and Purchases, with Settings and sign out below.

The dashboard prioritizes customers to contact, with summary counts and two-column reminder cards on desktop. The [reference image](docs/references/dashboard-inspiration.png) guides the visual style; its clinical metrics and features are outside this product's scope.

## Outside the first release

Inventory and stock tracking, batches and expiry management, billing and invoices, prices and taxes, payments, supplier management, barcode scanning, prescriptions, clinical advice, automated messaging, offline synchronization, public signup, and multiple pharmacies are deferred.

## Development and launch

Follow the phased delivery and acceptance checks in the [implementation plan](IMPLEMENTATION_PLAN.md). Setup instructions will be added with the first working application scaffold.

Before launch, settle production account ownership, domain and hosting costs, recovery operators, backup responsibilities, and accepted recovery targets. Backup restoration must include resetting the owner's password and revoking restored sessions before reopening access.

Use synthetic customer data during development. Keep production credentials, database backups, and real customer records out of source control.
