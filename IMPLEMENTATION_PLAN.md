# Pharmacy refill follow up application implementation plan

Build a private web application for one small pharmacy. The owner records customer purchases, optionally enables a refill reminder, and follows up before the expected supply runs out. The first release succeeds when purchase entry is quick, reminder dates are predictable, and every follow-up has a clear next action.

Planning date: 24 October 2026. This document defines the implementation; no application has been built yet. The agreed choices are Next.js, Neon PostgreSQL, email/password login with JWT sessions, shadcn/ui, and the supplied lavender dashboard reference. Additional implementation defaults below can be adjusted without changing the agreed product scope.

## 1 Product scope and defaults

| Area | First release decision |
| --- | --- |
| Business | One pharmacy and one owner account |
| Customers | Records managed by the owner; customers do not log in |
| Customer phone | Required for every customer, including purchases without reminders |
| Purchases | A customer's purchase from the pharmacy; this is not a supplier purchase |
| Reminder eligibility | Checkbox on each purchase, unchecked by default |
| Supply duration | One duration for the entire purchase, not one per medicine |
| Reminder rule | For 2–365 days, approximately 25% remaining, rounded to a whole day, minimum 1 and maximum 7 days before run-out; a one-day supply requires a manually chosen follow-up date |
| Reopening | Owner can explicitly reopen a closed follow-up or reverse an incorrect refill completion, with a reason and history |
| Mixed units | Separate rows for each medicine/unit combination; no unit conversion |
| Contact | Owner contacts customers manually and records the outcome |
| Operation | Online web application, optimized for desktop with usable mobile layouts |
| Dates | Pharmacy calendar dates in Asia/Kolkata |
| Language | English initially |
| Appearance | Light theme, soft lavender accents, readable dark text |

Include customer and medicine creation/editing, purchase entry/history/correction/cancellation, reminder actions, customer contact history, account settings, export, and operational recovery.

Defer stock counts, batches, medicine expiry management, barcode scanning, invoices, prices/tax calculations, payments, supplier management, accounting, prescriptions, clinical advice, automated messages, offline synchronization, public signup, and multiple pharmacies. Quantity is recorded for purchase history; it does not calculate dosage or reduce inventory. Do not show revenue or adherence statistics because the application does not collect the underlying data.

## 2 Owner workflows

### Record a purchase

1. Choose **Add purchase** from any main screen.
2. Search for a customer by name or phone, or use **Add customer** in a dialog. Preserve the unfinished purchase and select the new customer automatically.
3. Confirm purchase date, defaulting to today. Backdated purchases are supported; future purchase dates are rejected.
4. Add one or more medicine rows using search, quantity, and purchase unit. Allow adding a missing medicine in a dialog without losing the form. Select the new medicine automatically.
5. Optionally tick **Remind me for a refill**. If unchecked, no supply duration or reminder is required.
6. If checked, enter days of supply and supply start date, defaulting to the purchase date. Display the expected run-out and reminder dates immediately, with **Change reminder date** available.
7. Save once. Persist the purchase, items, and optional follow-up together. Display a success confirmation and open purchase details.

If different medicines have different durations, create separate purchases. State this beside the duration field. Supply start must be on or after the purchase date; a future start is allowed because a customer may buy before their existing supply ends.

### Work through reminders

1. Open the dashboard and see unresolved follow-ups due today or earlier.
2. Read the customer contact number, purchase summary, expected supply end, and latest contact note.
3. Choose **Mark contacted**, **Remind later**, **Record refill**, or **Close follow-up**.
4. Mark contacted records an event and optional note; it does not resolve the reminder. Allow a next contact date in the same dialog.
5. Remind later requires a future calendar date. Keep the original calculated reminder date for history.
6. Close follow-up requires a reason: declined, no longer needed, purchased elsewhere, unable to reach, or other. Require a note for other.

Phone numbers can expose a click-to-call link on supported devices. Never send messages or initiate external communication automatically.

### Record a repeat purchase

1. Open **Record refill** from the prior follow-up.
2. Prefill the customer, medicines, quantities, units, and previous duration for review. Use today's purchase/start dates, explicitly highlighting that the start date may need adjustment for an early refill.
3. Require explicit confirmation of the new purchase's reminder checkbox; it remains unchecked by default.
4. Offer **This purchase completes the previous follow-up**, unchecked until confirmed. A partial refill can leave the previous follow-up open.
5. Save the new purchase and any completion of the previous follow-up in the same transaction.

A new unrelated purchase never closes an existing reminder. Cancelling a refill reopens the previous follow-up only if it is still resolved by that refill and the original purchase remains active with reminders enabled. Set an immediate next action date and record the reversal. If the original purchase is cancelled or reminders are disabled, leave the follow-up closed, clear the invalid current resolution, and record why it was not reopened. If a different purchase now resolves it, leave that resolution intact.

### Correct refill relationships

- A refill link must reference an earlier-created purchase for the same customer and pharmacy, never itself. Earlier creation refers to persisted record order, not the editable purchase date; new or corrected links must not create cycles.
- A follow-up can have at most one current resolving purchase. That purchase must be active and linked to the follow-up's source purchase. Historical completions remain in events after reversal.
- Reject customer changes on either end of an existing refill link. To correct the customer, explicitly remove affected links first through a correction action that also reverses any affected completion and records a reason. Then permit the customer correction. Do not silently transfer links to another customer.
- Editing medicines, quantities, units, or supply coverage on either end of a current completion requires an explicit **Keep completed** or **Reverse completion** choice and reason. Names/notes alone do not require this choice. Keep completed records the owner's confirmation; no automatic medicine-matching system is introduced.
- Reversing clears current resolution fields and reopens only an eligible source purchase. If the source is cancelled or disabled, leave it closed with the applicable reason (`purchase_cancelled` or `reminder_disabled`). Preserve the original completion and reversal in events.
- Apply the correction, affected links, resolution fields, and events atomically. Lock involved purchases/follow-ups in stable ID order, validate versions after locking, and reject a conflicting action for review rather than overwriting it.

### Reopen a follow up

Closed follow-ups expose **Reopen follow-up**. Require a reason and a next action date of today or later. Reopening a refill completion explicitly confirms that its recorded resolution is being reversed. Clear current closure/resolution fields, retain all previous events, and leave the refill purchase itself intact.

The original purchase must be active with reminders enabled. A cancelled purchase cannot be reopened. If reminders are disabled, first enable them and then use the applicable reopening rule below. This is an owner correction action, not an automatic consequence of editing a purchase.

## 3 Reminder calculation and lifecycle

Use calendar-date arithmetic, not elapsed milliseconds or the browser's timezone. Business dates travel as validated `YYYY-MM-DD` strings through PostgreSQL, Drizzle (`date({ mode: 'string' })`), server actions, and form state. A date-picker adapter may use a local calendar object for display, but must reconstruct the same year/month/day string without timestamp conversion. Never round-trip a business date through `new Date(dateString).toISOString()`.

A shared `pharmacyToday(now)` helper derives the date explicitly in `Asia/Kolkata`. Purchase defaults, future-date validation, reminder queries, dashboard counts, and refresh logic use this helper and the same request-level clock value. Do not use server-local dates or unqualified database `CURRENT_DATE`. Raw `pg` queries must preserve SQL dates as strings as well. Events and sessions use `timestamptz` and actual UTC instants. These choices avoid the default process-timezone conversion documented by [node-postgres](https://node-postgres.com/features/types); [Drizzle supports string-mode dates](https://orm.drizzle.team/docs/column-types/pg).

```text
D = whole-number days of supply
S = supply start date
run_out_date = S + D calendar days
last_covered_date = run_out_date - 1 day

For D >= 2:
  lead_days = min(7, max(1, floor(D * 0.25 + 0.5)))
  calculated_reminder_date = run_out_date - lead_days

effective_reminder_date = manual override, otherwise calculated date
next_follow_up_date = effective_reminder_date initially
```

| Days of supply | Lead days | Reminder after start |
| --- | --- | --- |
| 1 | Manual date required | Owner chooses, including start day |
| 2 | 1 | 1 day |
| 3 | 1 | 2 days |
| 7 | 2 | 5 days |
| 10 | 3 | 7 days |
| 15 | 4 | 11 days |
| 26 | 7 | 19 days |
| 30 | 7 | 23 days |
| 45 | 7 | 38 days |
| 60 | 7 | 53 days |
| 90 | 7 | 83 days |
| 365 | 7 | 358 days |

For a 30-day supply starting 1 November 2026: last covered day is 30 November, expected run-out is 1 December, and reminder is 24 November. Present **Expected to run out on 1 December**, avoiding claims about actual medicine consumption.

Rules:

- Duration must be a positive integer. Default validation range: 1–365 days, explained in the form and configurable in code.
- A one-day supply with reminders enabled requires a manually selected follow-up date, which may be the supply start date. This is the explicit exception to the percentage rule discussed during requirements; do not silently create a same-day reminder. Its calculated reminder date is null and its manual override is required. If a duration is corrected to one day, require explicit date confirmation before saving, even if another date was previously stored.
- Manual reminder dates cannot precede the recorded purchase date. Allow a later date, including after expected run-out, with a clear confirmation explaining that it is a late follow-up.
- An enabled reminder whose date is already past becomes immediately actionable after saving.
- A purchase without reminders does not appear in reminder counts or cards.
- Keep one follow-up record per eligible purchase. Never create duplicates on page load or date changes.
- The dashboard selects open follow-ups with `next_follow_up_date <= today`. A scheduled job is unnecessary for this feature.
- Refresh the dashboard after mutations, when the window regains focus, and every 60 seconds while visible so an open screen updates after midnight.
- On supply-date/duration edits, recalculate automatic dates. Preserve a manual override unless explicitly reset. If a follow-up has been contacted or snoozed, require an explicit choice to retain its next action date or use the revised date. Preserve history.
- Disabling reminders closes only an open follow-up with reason `reminder_disabled`; it does not overwrite an existing closure reason or completed refill resolution. Record the disable action in history in either case.
- Re-enabling reuses the existing record and offers reopening only when its closure reason is `reminder_disabled`, with a confirmed next action date. Other closed reasons remain closed until the owner uses **Reopen follow-up**. A cancelled purchase cannot be re-enabled.
- Cancelling a purchase closes its own open follow-up and makes all its closed follow-ups ineligible for reopening. Reverse any completion it provides to an earlier purchase using the conditional cancellation rules. Corrections never silently reopen completed follow-ups.

Store only `open` or `closed` as the follow-up's lifecycle status. Derive **Due today**, **Overdue follow-up**, and **Scheduled** from its next action date. Store contacted/snoozed/refilled/closed actions as events; contacting is not completion.

“Overdue follow-up” means the owner missed the follow-up date. “Expected supply ended” is a separate calculation using run-out date. Show these distinctions explicitly.

## 4 Screens and interaction design

Visual reference: [provided dashboard screenshot](docs/references/dashboard-inspiration.png). Use the lavender/white visual treatment, rounded cards, subtle borders, and compact sidebar as inspiration. Create our own layout and assets; do not include the reference's clinical features, branding, product photography, or decorative browser frame.

Suggested initial tokens: page background `#F7F7FC`, white surface, primary `#6D5BD0`, primary text `#20212B`, muted text `#606575`, border `#E6E5EF`. Verify contrast in the implemented theme. Use at least 14px for important table content and comfortable 16px form inputs. Color must accompany text, never replace it.

| Route | Content and primary actions |
| --- | --- |
| `/login` | Email, password, show/hide password, generic failure state |
| `/dashboard` | Summary counts, follow-up filters/cards, recent purchases, Add purchase |
| `/customers` | Search by name/phone, pagination, Add customer, archived filter |
| `/customers/[id]` | Contact details, purchase history, follow-up/contact timeline, Edit/archive |
| `/medicines` | Searchable catalog, Add/edit/archive, duplicate warnings |
| `/purchases` | Customer/date/status filters, pagination, Add purchase |
| `/purchases/new` | Dedicated entry page with customer, medicines, and reminder sections |
| `/purchases/[id]` | Historical item snapshots, reminder dates/history, correction/cancellation/refill/reopen actions |
| `/purchases/[id]/edit` | Prefilled correction form, reason for change, explicit reminder rescheduling/completion choice, refill link correction |
| `/settings` | Pharmacy name/contact, fixed timezone display, owner password change, data export |

Sidebar: Dashboard, Customers, Medicines, Purchases. Settings and sign out at the bottom. The header provides customer search and Add purchase. Root redirects to dashboard or login based on session.

Dashboard decisions:

- Four small summary cards: **Due today** (open next action today), **Overdue follow-ups** (open next action before today), **Purchases today** (non-cancelled purchases dated today), and **Total customers** (active customer records).
- Largest section: **Customers to contact**, with Needs attention, Scheduled, and Closed tabs. Counts and data use the same predicates.
- Show up to 12 follow-up cards per page. Start with two columns on desktop and one on mobile. Validate long names and realistic notes at laptop widths before introducing a third column. Sort actionable follow-ups by next action date ascending, then expected run-out date and stable ID.
- Each card prioritizes customer name, phone, next follow-up date, and a short medicine summary. Show purchase date and expected supply end as secondary details, and truncate the latest note with an accessible expand/detail action. Keep Mark contacted visible and put snooze, close, refill, and reopen in the contextual menu where applicable.
- Optional progress bar: clamp `remaining calendar days / supply days` to 0–100%; label it **Estimated supply remaining**. Before start it is 100%, after run-out it is 0%. Do not interpret this as adherence.
- Recent purchases appear below the reminders. Avoid charts until there is a concrete question supported by collected data.

Use shadcn Sidebar, Card, Badge, Tabs, Combobox, Dialog, Sheet, Checkbox, Calendar/Date Picker, Alert Dialog, and table patterns. Use a dedicated purchase page to avoid nested large dialogs. Small add-customer/add-medicine dialogs must restore focus and preserve the parent form.

Every list/form needs loading, empty, validation, saving, success, and failure states. A failed request preserves entered values and its submission identifier/payload for safe retry. If a mutation reports session expiry, keep the form mounted and open a reauthentication dialog; do not redirect away. Retrying after successful login uses the same submission identifier. See the authentication contract below. Keyboard navigation and labelled controls are required. On narrow screens provide compact list cards or controlled table scrolling without hiding primary actions.

## 5 Technical architecture

| Concern | Implementation default |
| --- | --- |
| Application | Next.js App Router and TypeScript, one deployable application |
| Runtime | Supported Node.js LTS; server/database/auth operations use Node runtime |
| Package management | pnpm with committed lockfile; select compatible stable packages at setup |
| UI | shadcn/ui, Tailwind CSS, Lucide icons |
| Forms | React Hook Form and Zod; shared validation schemas, always enforced server-side |
| Database | Neon PostgreSQL, separate development and production databases/branches |
| Database access | Drizzle ORM with `pg` Pool and Neon's pooled connection string; SQL migrations checked into the repository |
| Auth | `jose` JWT signing/verification; Argon2id password hashing through a maintained Node-compatible package |
| Tables | TanStack Table when sorting/filtering needs justify it; server-side pagination/search |
| Verification | Vitest for business rules, real PostgreSQL integration tests, Playwright for essential user journeys |
| Hosting default | Vercel commercial plan plus Neon; account ownership and recurring costs settled before production provisioning |

Use Server Components for initial reads, Client Components for interactive forms, and Server Actions for authenticated mutations. Use Route Handlers for login/logout and downloads where a direct HTTP response is useful. Do not introduce a second public REST API or a separate backend service for internal screens.

Read database records directly through the server data-access layer. Every protected read/action checks the session and pharmacy ownership. Do not rely on layout redirects alone. Keep database modules server-only and avoid shared caching of private records. Revalidate affected screens after writes.

Use transactions for purchase/items/follow-up saves, refills, cancellations, and password/session changes. Keep production migrations separate from request handling; never run schema push on startup.

Reuse a bounded `pg` pool per application instance, release transaction clients in `finally`, and configure the hosting platform's supported pool lifecycle handling during setup. Use the pooled Neon URL for application requests and a separate direct Neon URL for controlled migrations and database dump/restore operations. Never open a new pool per request.

Suggested organization:

```text
src/
  app/
    (auth)/login/
    (app)/dashboard/
    (app)/customers/
    (app)/medicines/
    (app)/purchases/
    (app)/settings/
    api/auth/
    api/exports/
  components/
    ui/
    layout/
    customers/
    medicines/
    purchases/
    reminders/
  server/
    auth/
    db/schema/
    queries/
    services/
    actions/
  lib/
    validation/
    dates/
    reminders/
drizzle/
scripts/
tests/unit/
tests/integration/
tests/e2e/
docs/
```

## 6 Data model and integrity

Use UUID primary keys, `timestamptz` for `created_at`/`updated_at`, events, and sessions, and SQL `date` columns mapped to strings for business dates. Follow the shared Asia/Kolkata date contract in section 3. One pharmacy row is seeded; there is no pharmacy switcher or multi-business onboarding.

| Table | Core fields and purpose |
| --- | --- |
| `pharmacies` | `id`, `name`, optional contact, `timezone` fixed to Asia/Kolkata initially |
| `users` | `id`, `pharmacy_id`, normalized unique `email`, `password_hash`, owner role, `is_active` |
| `sessions` | `id`, `user_id`, `expires_at`, `revoked_at`, created timestamp; supports JWT revocation |
| `auth_rate_limits` | Hashed identifier, window start, attempt count, blocked-until; persistent login throttling |
| `customers` | `id`, `pharmacy_id`, `name`, phone display/normalized values, optional notes, `archived_at` |
| `medicines` | `id`, `pharmacy_id`, name, strength, form, normalized identity key, `archived_at` |
| `purchases` | `id`, `pharmacy_id`, `customer_id`, immutable creation sequence, display number, purchase date, notes, active/cancelled status, reminder enabled, nullable supply start/days/run-out, nullable `refill_of_purchase_id`, version, created/updated by |
| `purchase_items` | `id`, `purchase_id`, `medicine_id`, medicine name/strength/form snapshots, positive quantity, unit, position |
| `follow_ups` | `id`, unique `purchase_id`, open/closed, nullable calculated reminder date, manual override date, next follow-up date, last contacted timestamp, closed timestamp/reason, nullable resolving purchase ID, version |
| `follow_up_events` | `id`, `follow_up_id`, actor ID, action, note, previous/new date or status, timestamp |
| `audit_events` | Actor, pharmacy, entity ID/type, action, allowlisted before/after changes, reason, timestamp |
| `mutation_receipts` | Pharmacy, actor, command type, request UUID, payload hash, affected entity/event IDs, compact committed result, timestamp; unique on pharmacy/actor/request UUID |

Data rules:

- Customer name and contact number are required for every customer, as confirmed by the owner, including purchases without reminders. Normalize Indian numbers with +91 as the default while accepting explicitly supplied international numbers. Multiple customers can share a phone; warn instead of blocking.
- Medicine identity includes name, strength, and form. Show duplicate suggestions before saving; reject an exact normalized duplicate within the pharmacy and offer the existing record.
- Quantity must be positive; store decimal quantity and a unit such as tablets, strips, bottles, packs, or other. No automatic unit conversions in this release.
- Preserve item snapshots so editing a catalog label does not rewrite purchase history.
- Foreign keys prevent orphan records. Validate that all referenced records belong to the signed-in owner's pharmacy; enforce matching pharmacy references with composite constraints where applicable.
- Require at least one item. Use transactions so no purchase can be committed with missing items or a partially created reminder.
- Permit separate rows for the same medicine in different units, such as one strip plus two tablets. Enforce one row per `(purchase_id, medicine_id, normalized_unit)`; combine quantities only when both medicine and unit match. Controlled unit choices avoid spelling variants. No conversion or inventory logic is added.
- Support idempotent business mutations through a small PostgreSQL receipt table, not an external queue/service. Cover customer/medicine inline creation, purchase creation/correction/cancellation, follow-up contact/snooze/close/reopen, and refill completion. Create the receipt and business changes in the same transaction with database uniqueness so a lost response cannot duplicate a committed operation.
- Retain the request UUID and submitted payload in the mounted form while a response is uncertain. Resolve or replay that exact submission before sending edited values as a new command. The same UUID/command/hash returns its original committed result; a reused UUID with a different payload/command is rejected. Authenticate before replay, and check for a committed receipt before treating a replay as a stale version conflict. A genuine new action uses a new UUID.
- Store only the payload hash and minimal result identifiers/outcome in receipts, not complete customer data or auth secrets. Keep committed receipts for the first release; database restore recovers them alongside their mutations. Failed rolled-back writes leave no success receipt. Use the authenticated actor, not the session ID, so reauthentication does not break replay.
- Use version checks for edits and follow-up mutations; reject stale saves with a reload/review message. Serialize completion, cancellation, corrections, and reopening with stable lock ordering and the section 2 relationship invariants. Two different refill completions cannot both win; a losing transaction returns a conflict and does not leave an unrequested partial save.
- Archive customer/medicine catalog records rather than deleting history. Warn before archiving a customer with open follow-ups; archiving does not silently close them. Archived records remain visible on historical purchases but cannot be selected for new purchases until restored.
- Record meaningful purchase corrections, cancellations, reminder actions, and account changes in history. Do not put passwords, hashes, JWTs, or secrets in audit entries.

Indexes: customer pharmacy/name and normalized phone; medicine pharmacy/identity; purchase pharmacy/date/ID and customer/date; follow-up status/next-date/ID; events follow-up/time; sessions user/expiry. Fetch list counts and rows efficiently and load only the current page. Default page sizes: 25 list rows, 12 dashboard cards.

## 7 Email password and JWT authentication

Create the first owner through a one-time server-side bootstrap command using a hidden password prompt. No public signup and no built-in demo credentials in production.

Use one password validator for bootstrap, change, and operator recovery: 15–128 Unicode code points, spaces allowed, password-manager paste allowed, no composition rules, and no silent truncation or trimming. Reject out-of-bounds input before hashing. Validate the same rules server-side for every entry point. The minimum follows [OWASP's password-only authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html); the 128-character maximum is our implementation limit.

1. Login normalizes email, validates input, checks persistent rate limits, and verifies the Argon2id password hash. Use a generic error for incorrect credentials.
2. Successful login creates a database session and signs a JWT with `sub`, `sid`, `iat`, `exp`, issuer, and audience. JWTs contain identifiers only.
3. Default session lifetime is 8 hours without automatic renewal; reauthentication starts another session. This keeps the initial implementation simple.
4. Store it in a cookie with HttpOnly, Secure in production, SameSite=Lax, Path=/, and matching expiry. No JWTs in localStorage or browser-readable application state.
5. Every protected operation verifies signature/algorithm/issuer/audience/expiry, then verifies the session is live and the owner is active. Never trust unverified claims for access decisions.
6. Logout revokes the session before clearing the cookie. Password change requires the existing password, updates the hash, and revokes all sessions in one transaction.
7. Forgotten password recovery initially uses a documented operator command after owner identity verification. It resets the password through a hidden prompt and revokes sessions. Self-service recovery email is a later feature; no email service is required for release one.

For expired sessions during entry, mutations return a structured `AUTH_REQUIRED` result (or HTTP 401 for handlers) before writing, without redirecting the page. Retain form state, request UUID, and submitted payload in memory; pause background refreshes while reauthentication is needed. The dialog uses the normal login endpoint and rate limits. After the same owner successfully logs in, retry explicitly with the original command, then refresh affected views. A committed write whose response was lost is recovered through its receipt. A different identity must not receive/replay the former owner's form data. A fresh direct visit to a protected page can still redirect to login. This preserves an open form through expiry, not through closing/reloading the browser; do not persist patient data in localStorage.

Default throttling: 5 failed attempts per normalized email per 15 minutes and 30 attempts per trusted client IP per 15 minutes. Keep counters in PostgreSQL so separate application instances share them. Store HMAC-derived identifiers rather than raw email/IP in the limiter. Reject requests while blocked and show a retry message. Periodically clean expired limiter/session rows through an operations command; reminder correctness does not depend on cleanup.

Validate request origin for cookie-authenticated mutations and use the framework's action protections. Only accept trusted deployment proxy headers for rate-limit IP extraction. Keep JWT signing secrets and database credentials server-side. Never log credentials, tokens, phone numbers, or full purchase payloads. Auth screens and private routes must not be publicly cached.

## 8 Build sequence and completion gates

Implement in this order. The product decisions in section 1 and lifecycle contracts in sections 2–3 must be reflected in the schema before phase 2 is complete. Each phase ends with a working flow and the checks relevant to that phase; do not defer date, retry, auth, or concurrency verification until phase 6. Estimates are planning allowances for one experienced developer, not a fixed delivery promise.

| Phase | Deliverables | Completion gate | Effort |
| --- | --- | --- | --- |
| 1 Foundation and design | Next.js setup, styling tokens, responsive shell, sidebar, fixture dashboard and purchase form, loading/empty states | Owner can review realistic two-column cards and complete a simulated purchase flow | 2–3 days |
| 2 Database and login | Migrations, development fixtures, owner bootstrap, JWT/session logic, throttling, password validation, reauthentication dialog, date mapping | Authorization/revocation/password checks pass; date strings survive a database round trip under different process timezones | 2–3 days |
| 3 Customers and medicines | Search, pagination, create/edit/archive/restore, duplicate detection, inline add dialogs and mutation receipts | Mandatory phones enforced; uncertain-response retries create one record and preserve purchase form values | 2–3 days |
| 4 Purchases and dates | Transactional order creation, snapshots, mixed units, opt-in reminders, date preview/override, purchase history/detail/edit/cancel | Date boundaries, rollback, duplicate retry, and session expiry during entry pass | 3–4 days |
| 5 Follow-up operations | Dashboard queries/cards/counts, contact/snooze/close/reopen, refill linking/corrections, customer timeline | Full purchase → contact → refill journey and conditional reversals pass, including races and replayed contact events | 2–3 days |
| 6 Verification and usability | Business-rule tests, integration tests, browser journeys, keyboard/mobile review, export | Critical acceptance matrix below passes; error/retry behavior is demonstrated | 2–3 days |
| 7 Deployment and handover | Production configuration, migrations, owner onboarding, named recovery responsibilities, backup/restore rehearsal, runbook | Restored old password/session rejected; recovery and backup failure path rehearsed; owner walkthrough completed | 1–2 days |

Allow roughly 14–21 focused development days plus feedback and contingency; a 4–6 week calendar window is a reasonable initial allowance for this narrower product scope. Re-estimate if billing, inventory, messaging, or offline operation enters scope.

## 9 Acceptance and testing matrix

Automate the date rules, permissions, transactional behavior, and critical journeys. Use fixtures and an isolated test database; never point tests at production customer data.

| Scenario | Expected result |
| --- | --- |
| 30-day supply from 1 November 2026 | Run-out 1 December; reminder 24 November |
| 2, 7, 10, 15, 26, 45, 90, 365 days | Matches the rule table, including 2.5 and 6.5 rounding upward and the 7-day cap |
| One-day supply | Explicit exception: reminder-enabled save requires a chosen date; supply-start date is a valid choice |
| Change an existing reminder to one-day duration | Date must be explicitly confirmed before save; no stale automatic date survives silently |
| Zero, negative, decimal, or 366-day duration | Clear validation error on client and server |
| Month end, year end, leap day | Correct calendar-date addition without timezone shifts |
| User browser in a different timezone | Pharmacy reminder date remains unchanged |
| 00:15 Asia/Kolkata with UTC server and a different browser timezone | Today's default is the Kolkata date; same-day purchase is accepted; newly due follow-up appears in matching counts/list |
| SQL date through Drizzle, raw query, form, and save | `YYYY-MM-DD` survives unchanged under UTC and non-UTC process timezones |
| Reminder unchecked | Purchase saved; no follow-up; omitted supply fields are accepted |
| Backdated reminder | Immediately visible under Needs attention |
| Future supply start | Calculation uses start date, not purchase date |
| Contact without next date | Contact event saved; follow-up remains actionable |
| Snooze until tomorrow | Leaves Needs attention today; appears tomorrow; original date retained |
| Mark closed | Leaves active counts; closure reason and history are visible |
| New unrelated purchase | Prior follow-up stays open |
| Partial refill | Prior follow-up stays open unless explicitly completed |
| Confirmed refill | New purchase and old completion commit together |
| Cancel resolving refill while source is active and enabled | Old follow-up reopens today with reversal history and cleared current resolution |
| Cancel refill while source is cancelled/disabled | Old follow-up remains closed; invalid current resolution cleared; reason/history retained |
| Cancel a former refill after a different purchase resolves the follow-up | Current resolution remains intact; no automatic reopening |
| Edit customer on a linked source or refill | Rejected until affected links/resolutions are explicitly corrected |
| Self-link, cross-customer link, or cyclic refill link | Rejected atomically without changing history or current resolution |
| Edit items/coverage involved in a current completion | Explicit keep-completed/reverse choice with reason; affected records update atomically |
| Disable/re-enable an open follow-up | Closed as reminder_disabled; re-enabling offers explicit reopen with next date |
| Disable/re-enable a manually closed or refill-completed follow-up | Existing closure/resolution preserved; no implicit reopen |
| Explicitly reopen a manual closure or reverse completion | Reason/date recorded; current resolution cleared; historical purchase and completion retained |
| Reopen a cancelled purchase's follow-up | Rejected |
| Edit duration after contact/snooze | Owner explicitly keeps or replaces next date; contact history survives |
| Double-click, network retry | One purchase and one follow-up only |
| Inline customer or medicine create commits but response is lost | Same request UUID replays original record; no duplicate, including shared-phone customers |
| Contact/snooze/close/reopen commits but response is lost | Retry returns original result and creates exactly one event |
| Retry identifier reused with changed payload | Rejected; uncertain original submission resolved before a new command is sent |
| Failed item/follow-up write | Entire purchase save rolls back |
| Concurrent changes | Stale version cannot overwrite newer data |
| Two simultaneous refill completions | One completion wins; other transaction reports conflict without a partial new purchase |
| Completion racing with cancellation/correction | Stable locks and revalidation preserve relationship invariants; no follow-up is resolved by a cancelled purchase |
| Rename/archive medicine or customer | Purchase history remains intact |
| Add customer/medicine inline | New selection populated; existing purchase fields preserved |
| Create/edit customer without phone, including non-reminder purchase flow | Rejected with a clear required-field message |
| Same medicine as one strip plus two tablets | Two distinct medicine/unit rows accepted; matching units must be combined |
| Expired/revoked/tampered JWT | Protected pages, actions, and exports reject access |
| Session expires while purchase/inline dialog is open | Form and request UUID remain mounted; login dialog succeeds; original submission safely retries once |
| Change password/logout | Old sessions cannot be reused |
| Bootstrap/change/recovery password boundaries | Reject 14 and 129 code points; accept valid 15–128-character passphrases, spaces and paste without truncation |
| Repeated failed logins | Database-backed rate limits apply across instances |
| Authenticated cross-pharmacy object reference in test fixtures | Access denied, including by guessed ID |
| Lost connection during save | Input retained; safe retry succeeds without duplication |
| Export opened in spreadsheet | Dangerous formula prefixes escaped; no account secrets exported |
| Restore a backup containing an older password and sessions | Before traffic resumes, reset owner password and revoke sessions; old password and restored tokens fail |
| Backup job fails or does not run | Named operator receives failure/staleness signal; last-success record makes the gap visible |

Browser tests cover login, create customer/medicine, save an opt-in purchase, work a due reminder, snooze, record refill, cancel, and logout. Include one mobile viewport and keyboard operation through the entry form. Run formatting/linting, type checks, unit/integration tests, browser smoke tests, and production build before release.

## 10 Deployment and operating plan

1. Establish separate development/test and production database connections. Keep synthetic fixtures out of production and production credentials out of preview deployments.
2. Choose a hosting region near the Neon database. Use a commercial hosting plan for this business application. [Vercel Hobby](https://vercel.com/docs/plans/hobby) is documented for personal, non-commercial use; Vercel Pro is the default proposal, with costs confirmed before purchase.
3. Configure server-only pooled application database URL, direct operations database URL, JWT signing secret, rate-limit HMAC secret, and application URL. The direct URL is used for migrations and `pg_dump`/`pg_restore`; Neon explicitly requires an unpooled connection for its [logical backup/restore workflow](https://neon.com/docs/manage/backup-pg-dump). Commit `.env.example` with names and descriptions only; exclude actual secrets from source control.
4. Apply reviewed SQL migrations through a controlled release step, provision the pharmacy/owner, configure HTTPS/domain, and verify secure cookies.
5. Run production smoke checks using clearly identified temporary records, then remove/archive those records through the documented procedure.
6. Configure error monitoring and structured operational logs without patient/contact details. Include request IDs so support can investigate failures.
7. Enable a Neon plan/configuration with an appropriate restore window for production and document its limits. Supplement with an automated encrypted daily database backup in separate storage, retained for 30 days. Record the last successful completion time, archive location, and integrity check. Notify the named operator on job failure or if no success is recorded within 26 hours, using the selected runner/platform's notification capability. This operations schedule is separate from dashboard reminders.
8. Before launch, restore a backup into an isolated database and verify customers, purchases, schema, mutation receipts, and follow-up relationships. A production restore stays inaccessible to application traffic until the operator resets the sole owner's password through the shared validator and revokes all restored sessions. A database backup can restore a previously compromised password hash, so session revocation alone is insufficient. Rehearse rejection of both the old password and restored tokens before reopening access. Proposed recovery objectives: at most 24 hours of lost data if relying on the daily backup, and restoration within one business day. Owner acceptance and a supporting execution path are required before launch.
9. Provide authenticated CSV exports for customers, medicines, purchases/items, and follow-up history. Exports are for portability; they do not replace full database backups. Escape spreadsheet formula prefixes and exclude password/session/auth tables.
10. Prepare a runbook covering deployment, migrations, rollback, backups/restores, owner bootstrap/recovery, secret rotation, limiter/session cleanup, and support. Prefer backward-compatible migrations so the prior application release remains a safe rollback target.

Client inputs needed before launch: pharmacy display name/contact details, owner email, domain choice, production account ownership, hosting/backup budget, and any initial records to import. Branding can use a temporary text name during development. Bulk migration is separately estimated once source data is available.

Record the following in the operating runbook before launch. These are outstanding operational assignments; they do not block product development, but must not be assumed to be covered by an unspecified developer.

| Responsibility | Required launch detail |
| --- | --- |
| Account/database recovery | Named primary operator and backup contact, support hours, and secure access to the recovery command |
| Owner verification | Agreed verification procedure using a pre-established owner contact/channel before any password reset |
| Backup execution | Named scheduled-job runner, daily schedule, direct connection secret location, and restricted off-database archive destination |
| Encryption | Key custodian, secure recovery access, and how the backup operator obtains decryption access during restoration |
| Failure handling | Named recipient for failures/stale backups, notification channel, and last-success check location |
| Recovery commitment | Explicit owner acceptance or revision of the proposed data-loss/restoration window, supported by the operator's availability |

Use the chosen platform's scheduling and notifications where available; no separate monitoring stack is required. Rehearse owner access recovery and a simulated backup failure in addition to restoring data. Record the rehearsal date and outcome.

## 11 Final release checklist

- [ ] Owner can log in securely and recover access through the documented process.
- [ ] Customer and medicine management work with mandatory customer phone numbers, search, duplicate handling, and archive/restore.
- [ ] Purchase entry supports inline creation without losing state.
- [ ] Reminder checkbox is unchecked by default and controls the entire purchase.
- [ ] Automatic and manually overridden dates match the agreed business rules.
- [ ] Dashboard prioritizes due follow-ups and distinguishes missed follow-ups from expected supply exhaustion.
- [ ] Contact, snooze, close, explicit reopen, refill correction, and conditional cancellation preserve history and valid relationships.
- [ ] Mixed-unit rows work without implicit conversion.
- [ ] Duplicate submissions across business mutations, uncertain responses, partial writes, and stale updates are handled safely.
- [ ] Session expiry preserves an open purchase form and its retry identity; password rules apply consistently.
- [ ] Reference-inspired UI remains readable, responsive, and keyboard usable.
- [ ] Critical checks pass against an isolated database and the production build succeeds.
- [ ] Production credentials, hosting, domain, migrations, monitoring, exports, and backups are configured.
- [ ] Recovery operator, verification method, backup runner/destination, encryption custodian, and failure recipient are assigned; recovery targets are accepted.
- [ ] Restoration rejects restored credentials and sessions; backup failure/access recovery rehearsals and an owner walkthrough are completed.
- [ ] README, environment instructions, migrations, and operating runbook are delivered.

## 12 Implementation references

The implementation choices above are project decisions. Use these official references for integration details and recheck package compatibility and service plans at setup:

- [Next.js server and backend capabilities](https://nextjs.org/docs/app/guides/backend-for-frontend)
- [Next.js authentication guidance](https://nextjs.org/docs/app/guides/authentication)
- [Neon with Next.js](https://neon.com/docs/guides/nextjs)
- [Drizzle with Next.js and Neon](https://orm.drizzle.team/docs/tutorials/drizzle-nextjs-neon)
- [Drizzle PostgreSQL date and timestamp types](https://orm.drizzle.team/docs/column-types/pg)
- [node-postgres date parsing](https://node-postgres.com/features/types)
- [OWASP password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [shadcn/ui components](https://ui.shadcn.com/docs)
- [shadcn dashboard blocks](https://ui.shadcn.com/blocks)
- [Neon pricing and plan features](https://neon.com/pricing)
- [Neon direct-connection backup and restore](https://neon.com/docs/manage/backup-pg-dump)
- [Vercel Hobby usage limits](https://vercel.com/docs/plans/hobby)

The supplied screenshot is retained locally only as the design reference for this project.
