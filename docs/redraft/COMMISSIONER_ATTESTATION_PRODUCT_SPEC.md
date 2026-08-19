# Commissioner Import Attestation UI — Product Spec

Date: 2026-07-12/13. Unblocks full-league commissioner import for MFL,
ESPN, and Yahoo — the real, disclosed gap the Import Security Closure phase
left open: these three providers can prove real membership but not
commissioner authority, and no product UI existed anywhere to collect the
attestation the server-side contract already required.

## The gap this phase closed

`assertImportCommissioner` (`lib/league-import/commissionerGate.ts`) and the
commit/preview routes already had a complete, correct server-side
attestation contract — `AttestationInput`, `recordImportAttestation`,
`recordCommissionerVerificationMethod`, `ATTESTATION_REQUIRED`/403 —
**since the Import Security Closure phase**. Confirmed by fresh grep before
any edits: zero UI anywhere referenced `attestation`, `requiresAttestation`,
or `ATTESTATION_REQUIRED`. Every real member of an MFL, ESPN, or Yahoo
league was correctly, safely blocked from a full-league commit with no way
to proceed. This phase built the missing UI layer only — it did not touch
the server contract's actual decision logic (`assertImportCommissioner`'s
three-outcome branching is unchanged).

## Required language (verbatim, as shipped)

> I confirm that I am the commissioner or have explicit authorization from
> the commissioner to import and manage this full league in AllFantasy.

Plus, always shown alongside it in `CommissionerAttestationPanel.tsx`:
- AllFantasy has verified your account is a member of this [Provider] league (only shown when true).
- [Provider] did not independently verify commissioner authority — only membership.
- This confirmation applies only to this specific league and provider.
- False or unauthorized imports may be removed or restricted.
- Only import leagues you are authorized to manage.

Never displayed: "Commissioner verified by ESPN/Yahoo/MFL" or any phrase
implying provider-side verification of commissioner status — confirmed by
grep across the touched surfaces before and after this phase's edits, zero
matches both times.

## Where it lives

`components/unified-import-ui/CommissionerAttestationPanel.tsx` — one
shared component, zero per-provider branches. Rendered inside
`LeagueImportFlow.tsx` between the canonical preview summary and the commit
button, gated by `providerRequiresCommissionerAttestation()`
(`lib/league-import/attestationProviders.ts`) — the same classification
`assertImportCommissioner` itself uses, re-exported from a
dependency-free file so the client bundle never needs `commissionerGate.ts`'s
server-only imports (`@/lib/prisma`, decrypted-auth lookups).

## Interaction contract

- Commit is disabled until the checkbox is checked, whenever the active
  provider requires attestation (`commitDisabled` in `LeagueImportFlow.tsx`).
- Selecting a different discovered league, submitting a new source id, or
  switching provider tabs all route through `runPreview()` (or the tab
  `onClick` handler), both of which reset `attestationAccepted`/
  `attestationStatement` to their unchecked defaults — a stale confirmation
  can never silently survive a league or provider change.
- State lives in plain `useState`, never `localStorage`/`sessionStorage` —
  a page refresh always starts unchecked.
- The client-supplied checkbox state is never trusted alone: the wire
  payload also carries `confirmedProvider`/`confirmedSourceLeagueId`,
  stamped automatically from the same request's own `provider`/`sourceId`
  (`toWireAttestation` in `LeagueCreationImportSubmissionService.ts`) —
  the server independently compares these against its own resolved
  `provider`/`sourceLeagueId` and rejects a mismatch
  (`attestationMatchesThisRequest` in `commissionerGate.ts`).

## Audit evidence (Part 5)

No new Prisma model — assessed and rejected as unnecessary this phase (see
"Schema decision" below). `recordImportAttestation`/
`recordCommissionerVerificationMethod` write into the same
`League.settings` JSON bag used since the Import Security Closure phase,
extended this phase with two new fields:
- `importRunId` — the same commit's real `runId` from
  `persistImportWithCanonicalAudit`, so any audit record traces to one
  specific import request.
- `textVersion` (attestation record only) — `COMMISSIONER_ATTESTATION_TEXT_VERSION = 'v1'`,
  so a future copy change never silently reinterprets what a past user
  actually agreed to.

Physically proven against the disposable Neon branch
(`br-green-lab-admi6kkj`, project `icy-field-51189449`): a real
`leagues` row (table's real Postgres name — confirmed via
`information_schema` after discovering `League` model's own
`@@map("leagues")`), two sequential JSONB merge writes reproducing exactly
what the real functions do, confirmed both `commissionerVerification` and
`commissionerAttestation` keys coexist (merge, not overwrite), confirmed
`importRunId`/`textVersion` persist correctly, confirmed zero secrets in
the stored JSON. Fixture row deleted after the proof — no residue left on
the shared disposable branch.

## Schema decision: no new Prisma model

Assessed per Part 5's own instruction ("if the current JSON evidence
storage is insufficient for durable querying or revocation, assess whether
an additive Prisma model is justified"). Decision: **not justified this
phase.** `League.settings` is already a real, durable, per-league JSONB
column; every required field (`appUserId`, canonical/external league id,
provider, method, `sourceManagerId`, `importRunId`, `textVersion`,
`recordedAt`) is already captured; each `League` row has at most one active
attestation record (1:1 relationship), so a separate table would add join
complexity without adding real capability. Revisit only if a future phase
needs cross-league attestation reporting/search at scale that JSON path
queries can't serve well — not a need identified in this phase.

## Revocation & repeat-import behavior (Part 6)

Traced the real, existing conflict logic
(`persistImportedLeagueFromNormalization`,
`lib/league-import/ImportedLeagueCommitService.ts:329-340`) — the
"existing league" lookup is scoped by `(userId, platform, platformLeagueId, season)`,
**per-user**. Real, disclosed consequences:

- **A duplicate import by a different real user creates a separate
  canonical `League` row** for that user, never overwrites or transfers
  ownership of the original importer's row. Confirmed by direct source
  read, not assumption.
- **One user's attestation cannot authorize another user** — structurally
  true, not just policy: `AttestationInput` carries no user-identity field
  at all; `appUserId` is always `auth.userId` from the session, never
  client-supplied, in every route that calls `assertImportCommissioner`.
- **A new full import by a different user requires that user's own
  authorization path** — confirmed: each commit independently re-runs
  `assertImportCommissioner` against the calling session.
- **Existing league access is governed by canonical membership/ownership
  (`League.userId`, `LeagueTeam.claimedByUserId`, `RedraftMember`), never
  the historical attestation checkbox** — the attestation record is
  write-once audit evidence, never re-checked as an access gate on
  subsequent reads (League Hub, Trade OS, etc.).
- **"A new attestation may be required when the authorized importer
  changes"** — deferred/not-applicable under the current architecture:
  since each user's import is already a structurally separate `League` row
  (no shared "authorized importer" concept to hand off), there is no
  existing mechanism for one canonical league to change hands between two
  AllFantasy users. Honestly disclosed as out of scope, not silently
  ignored — a real, separate future initiative (multi-manager shared
  canonical leagues) would need to design this from scratch, not extend
  today's attestation record.

## Deferred / not built this phase

- No dedicated expired-OAuth-token detection for ESPN/Yahoo — existing
  error messages remain accurate but generic ("Link the ESPN account that
  manages this league"), not distinguishing "never connected" from
  "connection expired." Real, disclosed, not fixed — would require
  per-provider token-refresh-state work out of this phase's scope.
- No visual redesign of the import flow beyond the new panel — matches
  the explicit guardrail.
- Rankings migration untouched — matches the explicit guardrail.
