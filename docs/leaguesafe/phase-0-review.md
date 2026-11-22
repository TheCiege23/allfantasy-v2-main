# LeagueSafe Phase 0 review

Scope: capture only, using confirmed inbox allfantasysportsapp@gmail.com.

## Files changed

Existing files:

- prisma/schema.prisma — LeagueSafeRawEmail and processing-status enum.
- .env.example — required inbound secret and verified sender-domain allowlist.
- app/admin/page.tsx — link to the raw-email viewer.

New files:

- prisma/migrations/20261114000000_leaguesafe_raw_email_capture/migration.sql — additive table, enum, unique deduplication key, indexes.
- lib/leaguesafe/inbound-security.ts — fail-closed configuration, constant-time HMAC check, timestamp window, streaming request-size limit.
- lib/leaguesafe/email-headers.ts — generic RFC822 envelope metadata and trusted Gmail delivery-authentication inspection.
- lib/leaguesafe/capture.ts — immutable raw capture, concurrent duplicate protection, sanitized rejection logs.
- app/api/integrations/leaguesafe/inbound/route.ts — signed JSON-envelope intake for original raw messages.
- app/admin/leaguesafe/raw/page.tsx — admin-gated list/detail, status filters, cursor pagination, escaped source display.
- scripts/leaguesafe/Code.gs — full bot-account Apps Script capture bridge and five-minute trigger installer.
- scripts/leaguesafe/appsscript.json — explicit Gmail, outbound HTTPS, and trigger scopes.
- __tests__/leaguesafe-email-headers.test.ts — synthetic generic-header authentication cases; no LS templates assumed.
- __tests__/leaguesafe-inbound.test.ts — signing, expiry, size limits, storage, retries, validation, safe logging.
- __tests__/leaguesafe-admin.test.tsx — admin authorization before data access, escaped source, pagination.
- __tests__/leaguesafe-apps-script.test.ts — execute the actual supplied script using mocked Google services; verify HMAC interoperates with server.
- docs/leaguesafe/phase-0-setup.md — non-expert setup, sender verification, OAuth alternative, troubleshooting, manual test checklist.
- docs/leaguesafe/phase-0-review.md — this inventory and review notes.

No application dependencies were added. Other existing workspace edits are outside this feature.

## Data and security decisions

- Gmail immutable message ID is the unique messageId. RFC Message-ID is retained separately.
  This avoids deduplication poisoning through attacker-controlled header IDs.
- receivedAt comes from Gmail internalDate, not a sender-provided Date header.
- rawBody retains the original MIME source as a UTF-8 string. Header strings retain their
  original RFC encodings; there is no body-template or payment parser.
- authResults retains all original Authentication-Results values and the trusted Gmail result,
  plus observed SPF/DKIM/DMARC outcomes and passing DKIM domains.
- Only a private, HMAC-authenticated Gmail bridge can submit captures. No unsigned body is stored.
- Only the first Authentication-Results is eligible, and its auth service must be mx.google.com.
  Sender and passing signing/identity domains must be explicitly allowed. Comments, quoted reasons,
  later injected results, SPF-only passes, and ARC-only passes do not satisfy the DKIM requirement.
- Every authenticated policy rejection is retained as rejected with a reason. It remains visible
  to admins, but no ledger exists in this phase.
- leagueConnectionId is a nullable scalar reserved for Phase 1, without an invented connection model.
- The Gmail processed label means that storage was acknowledged, including rejected messages.
  It is applied per message and visible on the conversation, preventing thread-arrival races.
- The body limit is 2 MiB for the signed JSON request. Oversized mail is retained in Gmail for
  manual inspection and is not silently truncated.
- The viewer reads the database only after the existing admin gate; no additional raw-email API
  is needed, so the repository's production exclusion of most /api/admin routes does not affect it.

## Migration and environment

Migration prepared: **20261114000000_leaguesafe_raw_email_capture**.
No live database migration or deployment is performed as part of preparing this review.

Server variables:

- **LS_INBOUND_SECRET**: random 32+ byte secret.
- **LS_SENDER_DOMAINS**: comma-separated exact verified LeagueSafe sending/signing domains.

Apps Script properties:

- **LS_INBOUND_URL**: canonical HTTPS endpoint.
- **LS_INBOUND_SECRET** and **LS_SENDER_DOMAINS**: same values as the server.

Existing database and admin authentication configuration is reused.

## Verification

Run the four focused suites:

~~~powershell
node node_modules/vitest/vitest.mjs run __tests__/leaguesafe-email-headers.test.ts __tests__/leaguesafe-inbound.test.ts __tests__/leaguesafe-admin.test.tsx __tests__/leaguesafe-apps-script.test.ts --pool=threads --maxWorkers=1
~~~

They use synthetic RFC headers and mocked database/Google services. They do not contact Gmail,
LeagueSafe, or a live database. Actual LeagueSafe templates remain unknown until real samples arrive.

Schema validation and local Prisma-client generation do not apply migrations.
Live migration correctness, Gmail authorization, actual sending domains, and end-to-end
real email capture require the manual acceptance steps in [the setup guide](phase-0-setup.md).

## Validation results

- Four focused Vitest suites: **68 tests passed**.
- ESLint: the five new production TypeScript/TSX files passed.
- Prisma schema validation passed; the standard local Prisma client was regenerated.
- The migration exactly matches Prisma's generated diff from the prior schema, ignoring
  comments and whitespace. This was an offline comparison, with no database access.
- Focused TypeScript check of Phase 0 production files and all four test files passed.
  That check used the actual generated Prisma client types and the existing admin-access
  type contract extracted from lib/adminAuth.ts, isolating unrelated infrastructure imports.
- The complete repository TypeScript check finished with **150 diagnostics in other files**,
  in the original development checkout, including app/ai-chat/page.tsx and existing admin World Cup routes. No diagnostics reference
  the new LeagueSafe files or the modified admin dashboard. The full repository is therefore
  not type-clean; those unrelated files were left unchanged.
- The Apps Script manifest is valid JSON. Existing-file diff whitespace checks passed.
- No full production build, live database migration, Gmail authorization, live LS capture,
  or deployment was performed. Use the manual acceptance checklist for those environment checks.

## What the owner must do by hand

Follow the setup guide to review/deploy the migration and app, set the two server env vars,
add the bot to the LS test league, confirm original sender/DKIM domains, create/authorize the private
Apps Script project, run capture once, enable its trigger, and review real captured emails.

After Phase 0 review and real sample capture, provide redacted samples and explicitly authorize
the next phase. No automatic phase advancement is configured.


## Railway release preparation

- Isolated branch: codex/leaguesafe-phase0, based on main at b722e1a94.
- The release contains only the 17 Phase 0 files listed above; unrelated local edits are excluded.
- The setup guide now targets the verified Railway production web service and its existing
  node scripts/railway-prod-migrate.cjs pre-deploy hook, including LF-only migration checks.
- The original-message summary verified noreply@leaguesafe.com and DKIM PASS for leaguesafe.com.
- The owner added LS_SENDER_DOMAINS and LS_INBOUND_SECRET to Railway; no secret was read or stored in source.
- Creating a review branch/PR does not merge it or deploy Phase 0. Deployment, migration,
  live admin-viewer verification, and actual Gmail capture remain pending.
- Release-branch revalidation passed: 68 tests, focused TypeScript, ESLint, schema validation,
  exact generated migration comparison, LF-only migration bytes, and the repository secret scan.
