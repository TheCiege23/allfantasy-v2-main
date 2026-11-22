# Phase 2: sample-based notification parsing — ready for code review

Phase 1 data-model sign-off remains approved. This change implements Phase 2 using
verified private samples and redacted public fixtures. It stops for owner review:
no merge, deployment, production migration, production parsing or Phase 3 work is
authorized by this implementation. The Apps Script automatic trigger remains disabled;
no Apps Script source or trigger installation was changed.

## What changes

Seven independent template parsers return a typed result or null. Eight specimens
cover payment received, wallet refund (two examples), commissioner refund notice,
wallet credit, allocation vote request, allocation approval, and payout structure
change. The dispatcher decodes outer MIME/HTML and requires an unambiguous supported
template. Unknown, inconsistent or unsupported formats return null without leaking
source content in an exception.

The manually invoked processing service stores results on the existing raw email.
The additive migration `20261117060000_leaguesafe_phase2_parsing` adds nullable parsed
payload, parser version, attempt time, static error code and indexed dedupe key.
It performs no data backfill and does not touch raw bodies, authentication results,
connection assignments, member mappings or ledger entries. Historical rows retain
their statuses and null metadata until explicitly processed.

An authenticated admin can open one accepted record in `/admin/leaguesafe/raw` and
choose **Parse stored notification**. Next's server action supplies same-origin POST
protection, checks admin access before processing, and accepts a stored ID only.
Neither inbound capture nor a scheduler calls the parser. Configuration or database
failures leave a static unavailable message for the admin.

Unsupported content becomes `unparseable` with a static reason and a durable review
alert in the capture viewer, including a count across all pages/filters. The existing
Unparseable filter opens the queue. The alert is a stored state, not an outgoing email
or notification dispatch. A newer successful parser result resolves the queue item.
Results and raw MIME are rendered as escaped text, never executable email HTML.

## Review the interpretation first

| Type | Interpretation | Deliberately unknown or separate |
| --- | --- | --- |
| Payment received | Display name, exact cents, league name, reported balance/count | Recipient is not payer email; numeric league ID and transaction ID absent |
| Wallet refund | Refund cents, transaction reference, confirmation, Fanball Wallet destination | No league or member identity is inferred |
| Commissioner refund notice | League name, aggregate owner display text, refund cents | Owner text is not split into guessed identities; transaction ID absent |
| Wallet credit | Winnings credited to SportsHub account | Not external withdrawal or a completed external payout |
| Allocation vote requested | Proposed per-owner winnings with observed zero additional fees | Vote deadline remains timezone-free text; voting links are not retained or followed |
| Allocation approved | Approved allocation summary | Does not prove payment/distribution completed |
| Payout structure updated | Observed numeric league link and informational rule text | Empty prize table stays empty; free text does not create payout entries |

All financial amounts use integer cents with strict grouping, precision and range
validation. No floating-point currency rounding or speculative fields. Source receipt
time and sender notification date remain distinct; `occurredAt` stays null because
these specimens do not establish a financial transaction timestamp.

The parser supports the observed HTML bodies. Plain-text-only, other templates,
nonzero additional allocation fees and other unseen table shapes go to review.
Setup, welcome and invitation captures remain preserved; this change does not invent
financial parsers for them. Do not bulk-process those records expecting financial events.

## Authentication, provenance and duplicates

The Phase 0 capture/authentication policy is unchanged. A stored rejected delivery
or rejection reason blocks parsing even when an older preserved header says PASS.
Accepted sources are rechecked against the configured sender-domain policy using the
first trusted Gmail authentication block. The parser is an extractor, not a DKIM
cryptographic verifier, and private historical header PASS results are not treated
as proof of current-key replay acceptance.

MIME work is bounded to 2 MiB, 64 KiB of headers, 16 nesting levels and 100 parts;
HTML traversal also has node/depth limits. Attached `.eml` messages are never parsed
as the outer notification. Script, style, head, template and explicitly hidden
content are excluded. No remote resources or links are fetched.

Where the observed wallet-refund transaction reference exists, the dedupe identity
uses notification type plus that reference. Otherwise it uses the immutable Gmail
message ID from the single capture inbox. It never uses sender-supplied RFC Message-ID,
guessed name/amount/date composites or parser version. Keys are hashed. Message-based
fallback cannot prove that two separate emails describe one transaction; no broader
dedupe guarantee is claimed for samples without a transaction reference.

Multiple source emails may preserve the same parse key for audit. Phase 1's unique
ledger dedupe key remains the financial insertion guard for a later, separately
authorized integration. Phase 2 itself creates zero financial entries, so parsing
or reprocessing cannot change any balance.

One successful compare-and-swap update publishes a result under concurrent requests.
Repeated attempts with the same parser version are no-ops, including unsupported
formats. A new parser version can retry an old result. There is no force flag that
promotes rejection or clears provenance. Unknown-format alerts do not multiply.

## Validation and rollout checks

Implemented tests cover fixture extraction, inconsistent values, money precision,
MIME/attachment limits, unsupported formats, hidden/script content, proposal versus
approval semantics, stable keys, authorization, safe rendering and concurrency.
The local PostgreSQL tests apply Phase 0/1/2 migrations to synthetic data, verify
preservation of ten historical rows and constrain inconsistent parse metadata.
Real Prisma tests exercise simultaneous processing and unchanged source bytes.

The existing LeagueSafe database CI job now includes the Phase 2 suites and fixture
paths. A clean CI install generates the matching Prisma client before those tests.
Local validation uses isolated new dependencies/client output, preserving the shared
checkout's installed client. The scoped TypeScript check uses actual generated model
types with narrow declarations at the unchanged admin-auth and Prisma-singleton
boundaries; it is not a whole-repository type-check claim.

Local results for this review:

| Check | Result |
| --- | --- |
| All LeagueSafe suites, including both local PostgreSQL suites | 11 suites, 213 tests passed; none skipped |
| Checksum-verified private originals, parsed offline only | 8 of 8 passed; no import/capture or database write |
| Decoded fixture redaction/integrity checks | All 8 passed |
| Scoped TypeScript with isolated generated Prisma types | Passed |
| ESLint on changed source/test files | Passed |
| Prisma schema validation and isolated client generation | Passed |
| Repository secret scan and diff whitespace check | Passed |

The new migration is LF-only, 1,395 bytes, SHA-256
`dcb41ce4d915a64a38658e391e673ad1a59db94862e7a7859b52a64e6dbdf60c`.
No production migration or capture-viewer acceptance is implied by these local results.

Before any later production rollout:

1. Owner reviews the sample meanings and manual-only scope above.
2. Prepare a PR against then-current main and run its required checks.
3. Review the additive migration and target guard; rehearse on an isolated copy if needed.
4. Only after separate merge/deployment authorization, verify deployed migration/client
   and unchanged raw counts/statuses before manually parsing selected accepted records.
5. Review exact parsed fields and the unsupported-format queue. Confirm no ledger
   entries or member mappings were created and that the automatic trigger is still absent.

No production UI acceptance or migration rollout is marked complete by local tests.

## Still pending — carried forward unchanged

- Successful real refund capture with a currently active allowed-domain signing key.
  The October replay remains a controlled rejection; its rejected source is never promoted.
- Fresh payment/refund/payout notification delivery through ordinary bot-inbox activity.
- Accepted live capture/replay validation for allocation votes, approval notices and
  wallet-credit samples whose older signing keys were revoked. Offline parser coverage
  does not close these live-authentication checks.
- Wallet withdrawal confirmation sample: deferred because no qualifying existing
  sample was found. No withdrawal transaction is requested or initiated.
- Any notification type or variant for which no verified original exists.

The LeagueSafe support request was not submitted. No support contact, new payment,
refund, payout, withdrawal, trigger activation, identity matching, commissioner
confirmation flow or Phase 3 implementation is part of this change.
