# Universal League Hub — Certification Reassessment

Date: 2026-07-12/13 (Commissioner Import Attestation UI phase). The League
Hub itself (`lib/shared-services/league-hub/*`, `/league-hub`,
`app/api/league-hub/*`) was built in the prior "Universal League Hub —
Foundation" phase and received **zero code changes** this phase — this
document reassesses its status now that the attestation gap it inherited is
closed, and records what changed vs. what didn't.

## Status: CERTIFIED WITH DOCUMENTED LIMITATIONS

Unchanged classification from the Foundation phase's own completion report,
re-confirmed rather than re-derived:

- **Physically confirmed** (this phase, indirectly): the League Hub's
  `providerCapabilities.ts` correctly derives `Commissioner Authority
  User-Attested` from a real `commissionerVerification.method === 'attestation'`
  row — proven via the real disposable-branch write in
  `COMMISSIONER_ATTESTATION_PRODUCT_SPEC.md` (a real `leagues` row with the
  exact JSON shape the new attestation-recording functions produce, fed
  through the already-unit-tested `deriveProviderCapabilities`).
- **Unit-tested**: `LeaguePortfolioService`, `activeLeagueContext`,
  `providerCapabilities`, `syncFreshness` (33 tests, Foundation phase) —
  all still passing this phase (48/48 in the combined League Hub +
  Fantrax + canonical-materialization regression run), unaffected by this
  phase's changes.
- **Not independently re-verified end-to-end this phase**: no new browser
  session was run against `/league-hub` this phase (out of scope — this
  phase's browser verification focused on the new attestation panel; see
  the completion report's browser-verification section for what was
  actually exercised).

## What changed for the League Hub because of this phase

Exactly one thing: **the badge label text**
(`components/league-hub/UniversalLeagueCard.tsx`'s `CAPABILITY_LABEL` map)
was made more precise — `user_attested` now reads "Commissioner Authority
User-Attested" instead of "User Attested," and `native` now reads "Native
AllFantasy League" instead of "Native" (to avoid implying every native-league
member is its commissioner). No data-fetching, no service logic, no API
route in the League Hub changed. The underlying `deriveProviderCapabilities`
logic that decides *which* badges to show was already correct from the
Foundation phase (it already read the real recorded verification method,
never guessed from the provider name) — this phase only fixed the *words*.

## Handoff verification (Part 8 of the attestation phase)

Traced, not re-executed physically: after a successful attested MFL/ESPN/Yahoo
commit, `recordCommissionerVerificationMethod` writes
`method: 'attestation'` into the new league's `settings` JSON
(`app/api/leagues/import/commit/route.ts`, unconditional, non-blocking).
The very next `GET /api/league-hub/portfolio` call for that user reads that
league through the unchanged `getDashboardLeagueListForUser` →
`getLeaguePortfolioForUser` → `deriveProviderCapabilities` chain, which
resolves `method === 'attestation'` into the `user_attested` badge. This is
a real, traceable, non-hypothetical code path — every link was independently
unit-tested this phase or the prior one — but the full chain was not
re-run end-to-end against a live server in this phase (would require a
real or fixture MFL/ESPN/Yahoo commit through a running dev server, which
Part 11 explicitly scoped to fixture-level proof given no real credentials
exist).

## Known, disclosed, unchanged limitations (carried over from the Foundation phase)

- The live Dashboard's own cards (`LeagueHubCard.tsx`, `MyLeagueCard.tsx`)
  are still not swapped for `UniversalLeagueCard` — still deliberately
  deferred, same reasoning as before.
- The recommendation bundle is still always empty (Part 4 contract, no OS
  module populates it yet).
- Concept badges (dynasty/guillotine/best-ball/keeper) from the existing
  cards were never ported to `UniversalLeagueCard`.
