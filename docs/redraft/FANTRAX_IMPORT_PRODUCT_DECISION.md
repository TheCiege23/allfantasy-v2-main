# Fantrax Import — Controlled-Beta Product Decision

Date: 2026-07-12, updated in the Import Security Closure phase. The
identity-model gap disclosed (not fixed) in the prior phase — `FantraxUser`
had no relationship to `AppUser` — is now fixed. This document keeps the
prior phase's fresh-audit findings and adds this phase's real ownership
work.

## 0. Update — Import Security Closure phase (real fix)

**Fresh-traced per explicit instruction** (Part 5):
`AppUser → CSV upload → FantraxUser → preview → canonical commit → League
ownership`. Confirmed precisely where the chain was broken: `FantraxUser`
is keyed by `fantraxUsername` (a client-supplied string with no relation to
`AppUser`); `FantraxLeague.userId → FantraxUser.id` inherited that
disconnect; the upload route resolved/created `FantraxUser` purely from
`formData.get('username')`, never cross-checked against the (already, from
the prior phase) authenticated caller's own identity.

**Fixed**: additive migration
(`20260712020000_add_fantrax_league_app_user_ownership`) adds
`FantraxLeague.appUserId` (nullable `AppUser` foreign key, `ON DELETE SET NULL`).
The upload route now stamps `appUserId: auth.userId` on every create/update,
and rejects (403) re-uploading over a snapshot already owned by a
*different* real user. The read route (`GET`) now filters to only the
authenticated caller's own owned leagues. `fetchFantraxLeagueForImport`
(the canonical pipeline's own entry point) now rejects — with the exact
same "not found" message used for a genuinely missing snapshot, never a
distinguishable "forbidden" — any read where `appUserId !== callingUserId`,
including legacy rows where `appUserId` is `null` (fails closed, never
fabricates ownership).

**Physically proven** against `br-green-lab-admi6kkj`, two real, distinct
`AppUser` rows: the real owner could read their own snapshot; a second,
unrelated real user was correctly rejected reading the *same* snapshot,
with no existence leak; a legacy row with `appUserId: null` was rejected
for everyone; the real owner's full canonical commit still worked
end-to-end. A real migration bug (wrong table name — `"AppUser"` instead of
the real, `@@map`-mapped `"app_users"`) was caught and fixed by this same
physical test, before it could ever reach a shared database.

**Commissioner semantics decision (Part 7): Option B — full-league snapshot
retained, explicitly user-attested.** Reverting to personal-roster-only
(Option A) would be a real capability regression with no corresponding
security benefit, since the CSV always contains every team's data
regardless of import scope — the actual security boundary (who owns this
upload) is now closed by the fix above. Fantrax's `assertImportCommissioner`
gate remains open-read by design (see `IMPORT_AUTHORIZATION_CONTRACT.md`) —
data ownership is now real and enforced; commissioner *authority* remains,
and is documented as, user-attested only.

## 1. Fresh audit findings (prior phase, still accurate)

- **Zero real network requests to Fantrax's servers, confirmed by direct
  grep** — `lib/league-import/fantrax/FantraxLeagueFetchService.ts` (503
  lines) contains no `fetch(` call anywhere. It reads exclusively from
  `prisma.fantraxLeague`, a row populated only by a separate CSV-upload
  endpoint.
- **CSV upload is real and functional**: `server/api-route-modules/legacy/fantrax/route.ts`
  accepts real multipart file uploads, parses them via `lib/fantrax-parser.ts`,
  and persists a real `FantraxLeague` row.
- **A real, previously-undisclosed security defect, found and fixed this
  phase**: this upload endpoint (and its companion GET/read endpoint) had
  **no authentication at all** — any anonymous request, from anyone on the
  internet, could create/overwrite or read any `FantraxUser`'s league data
  by supplying an arbitrary `username` form field. Fixed by requiring a
  real, verified AllFantasy session (`requireVerifiedUser()`) before either
  route touches Prisma. Physically unit-tested (2 new tests, both passing).
- **A second, related, disclosed-not-fixed gap**: `FantraxUser` (the model
  that owns uploaded league data) has **no relationship to `AppUser` at
  all** — the CSV upload's `username` field is entirely client-supplied and
  never cross-checked against the now-authenticated caller's own identity.
  An authenticated user could still upload/read data under someone else's
  chosen Fantrax username. This is a real, separate identity-model gap from
  the authentication fix above; not fixed this phase (would require either
  a schema change adding an `AppUser` foreign key to `FantraxUser`, or
  scoping lookups by the authenticated `AppUser.id` instead of a
  client-supplied string — a real design decision, not a small patch).
- **Commissioner authority cannot be proven** — same `OPEN_READ_PROVIDERS`
  classification as MFL, compounded by the identity-model gap above: there
  is no concept of "commissioner" in the CSV model at all, only "whoever's
  username was typed into the upload form."
- **Canonical league creation and season materialization: physically
  proven this phase** (see §3) — a real `FantraxLeague` snapshot row,
  pushed through the exact same commit pipeline every other provider uses,
  produced a real `League`, `LeagueTeam`, `Roster`, `RedraftSeason`, and
  `RedraftRoster` set, with zero Fantrax-specific code in any of those
  steps.
- **Historical imports**: possible in principle (multiple `FantraxLeague`
  rows per user, discoverable by season) but require a separate CSV upload
  per season — there is no automated backfill, since there is nothing to
  automate against (no live API).

## 2. Product decision: Option A — Certified CSV Import

**Chosen over Option B (live integration)**: no legitimate, documented,
authorized Fantrax API exists that this program found evidence of at any
point across three phases of investigation. Building one would mean
unsupported scraping, explicitly forbidden.

**Chosen over Option C (defer)**: the CSV mechanism is real, working, and
now physically proven end-to-end through the full canonical pipeline,
including the previously-unproven canonical season materialization step
(now proven for a *third* real provider this program, after Sleeper and
ESPN). Deferring a working feature without cause would be a regression in
capability for existing users of this flow.

### Requirements for Option A, verified against the current implementation

| Requirement | Status |
|---|---|
| Labeled clearly as CSV import | **Already true** — `ImportSourceInputPanel.tsx`'s Fantrax help text: *"Import uses Fantrax legacy league snapshots"*; the upload UI itself says *"Click or drag CSV files here / Export Standings, Roster from Fantrax"*. No live-sync language found anywhere. |
| Never implies live synchronization | **Already true**, confirmed by direct read this phase |
| Supported template instructions | Partial — the UI names which Fantrax exports to provide (Standings, Roster) but does not link a downloadable template or column-format spec |
| File format validation | **Real** — `parseFantraxFiles` returns structured errors (`{success:false, errors:[...]}`), surfaced to the user as a 400 with details |
| Import date / snapshot limitations shown | Not found — the completion UI does not surface "as of [upload date]" messaging |
| Canonical league creation supported | **Physically proven this phase** |
| Re-upload requirement documented | Not found in-product; only documented in this program's own docs |

## 3. Physical proof (real disposable database)

Against `br-green-lab-admi6kkj`: created a real `FantraxUser` +
`FantraxLeague` row (2 real teams, real standings/matchups/roster JSON,
past season → `isFinished:true`) — simulating exactly what the (now
authenticated) CSV upload endpoint produces. Ran the real
`fetchFantraxLeagueForImport` → `FantraxAdapter.normalize` → canonical
commit → `materializeRedraftSeasonForImportedLeague` chain, no mocks:

- Real `League` created (`status:'complete'`, matching the real
  `isFinished:true` signal — the status-mapping fix applied this phase).
- 2 real `LeagueTeam`, 2 real `Roster` rows.
- 2 real `RedraftRoster` rows under a real `RedraftSeason`
  (`status:'complete'`) — **zero Fantrax-specific code**, same shared
  module already proven for Sleeper and ESPN.
- Real Dashboard query found the league (name, platform correct).
- Real `loadTradeWorldFacts` (Trade Decision OS) reached and returned
  real facts.
- A real duplicate-import attempt was correctly rejected
  (`ImportedLeagueConflictError`).
- A real exact-replay commit was idempotent (`existed:true`, same league
  id). Final row count: exactly 1 `League`.

## 4. Customer-facing limitations (Part 10 — UX truthfulness)

The existing copy was checked fresh and found already truthful — **no
changes made**, per "update copy only if required" and "do not perform a
broad visual redesign." Real, remaining limitations to disclose in product
communication (not a UI change, a documentation/support-content item):

- Fantrax data is a point-in-time snapshot; nothing updates automatically.
- Only the uploading user's own roster gets full player detail; other
  teams show name/record only (existing, disclosed limitation).
- FAAB is not captured (`faabRemaining: null`, hardcoded).
- Scoring rule detail is limited (`scoringRules: []`, hardcoded).
- No commissioner verification exists — any authenticated user can upload
  or view Fantrax data under any username they choose to type in.

## Verdict

**Fantrax Import Status: CSV CERTIFIED WITH DOCUMENTED LIMITATIONS.** The
CSV mechanism is real, physically proven end-to-end (both the commit
pipeline, from the prior phase, and now real cross-user ownership
enforcement, this phase), and properly authenticated *and* owned. It is not
a live integration and must never be described as one. The one remaining,
disclosed, unresolved item is commissioner *authority* — genuinely
unprovable from a CSV — explicitly documented as user-attested (Option B),
never fabricated as provider-verified.
