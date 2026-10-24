# Local implementation verification

**Current medicine-level reminder revision:** lint and production build passed at the owner’s request. The automated test results below predate this business-rule change and do not validate the new supply lifecycle. Existing browser journeys have been adapted to the per-medicine fields, mixed-unit supply grouping, shadcn calendar selection and clearing, contacted/awaiting-refill actions, scheduled repeat contact, and removal of duplicate refill links, but have not been run. Additional lifecycle cases in the implementation plan remain unverified.

Previously verified on 24 October 2026 using the repository's Docker Compose PostgreSQL 17 test database. Production services have not been provisioned or deployed.

| Check                                   | Result                                                              |
| --------------------------------------- | ------------------------------------------------------------------- |
| Unit tests                              | 36 passed                                                           |
| PostgreSQL integration tests            | 23 passed                                                           |
| Chromium browser journeys               | 5 passed against production; original 3 also checked in development |
| Encrypted backup and recovery rehearsal | Passed using temporary databases and a temporary GPG key            |
| TypeScript                              | Passed                                                              |
| ESLint                                  | Passed                                                              |
| Prettier                                | Passed                                                              |
| Production build                        | Passed                                                              |
| Production dependency audit             | No known vulnerabilities reported at verification time              |

## Covered behavior

- Reminder rounding, one-day manual confirmation, duration bounds, leap/month/year boundaries, malformed dates, and Kolkata midnight.
- Date-only database round trips, opt-out purchases, mixed-unit rows, medicine snapshots, catalog archival, and duplicate detection.
- Purchase/refill transactions, stale version rejection, scope enforcement, retries after lost responses, and rollback of invalid purchases.
- Contact/snooze/close/reopen, explicit completion reversal, linked-customer corrections, conditional cancellation, and concurrent refill completion/cancellation.
- Password bounds, revocable JWT sessions, password-change revocation, persistent throttling, and recovery from restored credentials.
- Customer medicine history groups repeat purchases by medicine identity, counts mixed-unit purchases once, separates cancelled counts, and links to paginated purchase dates/quantities/units with unchanged historical labels after catalog renaming.
- Browser purchase entry with inline customer/medicine creation, preserved form values, deliberately dropped save response, refill/cancellation/correction, CSV export, logout, mobile layout and keyboard focus.
- Expired session during purchase entry: reauthentication keeps the draft and reuses the original submission identifier.
- Encrypted backup creation and checksum, stale/failure detection, isolated restore, restored-owner disablement, old-password/session rejection, and successful recovered login.

Screenshots and traces are generated under ignored `test-results/`. Tests use synthetic records only. Unit/integration and browser suites reset their disposable test database and must run sequentially.

## Implementation notes

The single-owner application serializes short business transactions with a pharmacy-row lock before checking mutation receipts or updating related purchases/follow-ups. This is intentionally simple for one pharmacy; it is not designed for high-volume, multi-owner writes.

Calendar dates remain strings. Events and sessions use timestamps. A dashboard refresh/query determines which follow-ups are due; background jobs are only needed for operations such as backups and cleanup.

Recovery tools are implemented and rehearsed locally. The rehearsal verifies script failure signals, not delivery through a real production alerting provider. The CI workflow is included, but a hosted CI run has not been observed yet.

## Remaining launch work

- Provision production Neon, hosting, domain, secrets and owner access.
- Assign account/database recovery operators, backup storage/runner, key custodian and alert recipients.
- Confirm the recovery targets with the pharmacy owner.
- Rehearse restoration and actual failure notifications in the chosen production environment.
- Complete the owner walkthrough and acceptance review.

See [RUNBOOK.md](RUNBOOK.md) for the execution steps and ownership checklist.
