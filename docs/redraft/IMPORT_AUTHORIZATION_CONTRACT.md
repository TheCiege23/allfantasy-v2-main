# Import Authorization Contract

Date: 2026-07-12. The authoritative, server-side contract for every
full-league import across all five providers. This does not create a new
route or a new canonical model — it documents and, where a real gap was
found, closes what the existing `commissionerGate.ts` +
`/api/leagues/import/{preview,commit}` routes already do (or should do).

## The eight questions, answered per real code path

| Question | Answer, server-derived |
|---|---|
| Who is the authenticated AllFantasy actor? | `requireVerifiedUser()` → `auth.userId`, from the real session — never a request body field |
| Which provider identity belongs to that actor? | Resolved server-side per provider: Sleeper (`UserProfile.sleeperUserId`), ESPN/Yahoo/MFL (`LeagueAuth`, decrypted, keyed by `userId_platform`), Fantrax (`FantraxLeague.appUserId`, this phase's fix) — never a client-supplied identifier |
| Is the actor a member of the source league? | Sleeper/ESPN/Yahoo: real API call proves it. MFL: real `TYPE=myleagues` call proves it (this phase's fix). Fantrax: ownership of the uploaded snapshot proves it (this phase's fix). Fleaflicker: still open-read, unchanged |
| Is the actor authorized for a full-league import? | `assertImportCommissioner({..., requireCommissioner: true})` — see the three-outcome contract below |
| New league or updating an existing canonical one? | Determined server-side by `persistImportedLeagueFromNormalization`'s own `userId + provider + platformLeagueId + season` lookup, never a client-supplied "is this new" flag; `force`/`allowUpdateExisting` only permits *re-committing over the caller's own* existing import, not arbitrary overwrite |
| Who becomes the canonical commissioner? | `League.userId` is always set to the server-resolved `auth.userId` — never a request body field |
| Who may replay or resume the import? | The same server-resolved actor, via the same idempotency-key lookup — replay is not a separate authority, it's the same gate re-run |
| Who may overwrite previously imported state? | Only the original committing actor (`League.userId` match via the existing conflict/force logic); no cross-user overwrite path exists anywhere in the commit pipeline |

The client **never** provides an authoritative value for `actorUserId`,
`actorRole`, `isCommissioner`, `canonicalOwnerId`, or `importOwnerId` —
confirmed by direct source read of every route this phase touched and
every route touched in the four prior phases of this program. No route
reads any of these five fields from `req.body`/`req.json()` for
authorization purposes.

## The three-outcome commissioner contract (`assertImportCommissioner`)

This is the one genuinely shared piece of logic across providers — not
duplicated per-provider, because the *decision* ("what to do when
commissioner status can't be determined") is the same regardless of *how*
membership was proven:

1. **`isCommissioner === false`** (Sleeper only, real API signal): fails
   closed immediately. The provider proved the requester is a member but
   explicitly *not* the commissioner.
2. **`isCommissioner === undefined`, real membership proven** (ESPN, Yahoo,
   MFL — this phase closed the gap for all three, previously only Sleeper's
   `false` case was handled): real membership is not enough for a
   full-league commit. Requires an explicit, recorded attestation
   (`attestation.accepted === true`) — always stamped
   `verification: 'attestation'`, never `'api'`, so the audit trail never
   overstates what was actually proven.
3. **`isCommissioner === true`** (Sleeper only today): passes through with
   `verification: 'api'`.

Open-read providers (Fantrax, Fleaflicker) are deliberately **not** part of
this three-outcome contract — they never attempt membership verification at
all, so forcing them through the same attestation logic would misrepresent
what was actually checked. Fantrax's real security boundary is upload-time
ownership (Part 6 of this phase), not a per-import commissioner claim.

## Why this is not identical logic forced onto every provider

Per Part 1's own instruction not to force identical provider-specific
verification where APIs genuinely differ: Sleeper's membership check hits a
public endpoint with no stored credential; ESPN/Yahoo's check re-uses the
same authenticated fetch already needed for preview; MFL's check calls a
distinct endpoint (`TYPE=myleagues`) that no other part of the pipeline
needed before this phase; Fantrax's check is upload-ownership, not a live
API call at all. Each `checkX` function is genuinely provider-specific. What
*is* shared, and correctly so, is the single decision function
(`assertImportCommissioner`) that all of them feed into.

## Update — Commissioner Import Attestation UI phase (2026-07-12/13)

The three-outcome contract's decision logic above is **unchanged** —
this phase built the missing UI + a real self-consistency hardening of the
attestation payload itself, not a new decision branch.

**`AttestationInput` extended** with two optional, client-echoed fields —
`confirmedProvider`, `confirmedSourceLeagueId` — validated by a new
`attestationMatchesThisRequest()` check inside `assertImportCommissioner`
before an attestation is ever honored. Fields left `undefined` are not
compared (backward compatible); a mismatch fails closed exactly like no
attestation at all. This is what makes "reuse one league's attestation for
another league/provider" a real, testable rejection instead of a
structurally-impossible no-op — previously the attestation shape carried no
self-describing fields to mismatch against.

**Cross-user reuse remains structurally impossible by design, not by a new
check** — `AttestationInput` still carries no user-identity field at all;
`appUserId` is, and always was, `auth.userId` from the session in every
calling route. No field was added for user identity specifically to avoid
creating a spoofable value for something that must remain 100%
session-authoritative.

**Client wire shape now self-stamps automatically.**
`LeagueCreationImportSubmissionService.ts`'s `toWireAttestation()` sets
`confirmedProvider`/`confirmedSourceLeagueId` from the *same* function
call's own `provider`/`sourceInput` parameters — the UI never manually
constructs these fields, so a normal user flow can never produce a
mismatched payload; the mismatch check exists specifically to catch a
stale UI state or a malformed/replayed client request.

**Audit evidence extended** — `recordImportAttestation`/
`recordCommissionerVerificationMethod` now also stamp `importRunId` (the
same commit's real `runId`) and, for attestation records,
`textVersion: COMMISSIONER_ATTESTATION_TEXT_VERSION`. Full detail:
`COMMISSIONER_ATTESTATION_PRODUCT_SPEC.md`.

**UI now exists** for MFL/ESPN/Yahoo full-league commit —
`components/unified-import-ui/CommissionerAttestationPanel.tsx`, gated by
`providerRequiresCommissionerAttestation()` (re-exported client-safe from
`lib/league-import/attestationProviders.ts`, the same array
`assertImportCommissioner` reads). This closes the real,
previously-disclosed product gap: the server contract was always correct,
but no product surface could ever satisfy it.
