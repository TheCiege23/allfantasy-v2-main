# Mission Control Live Integration Report — Phase 3.2

First real (gated) integration point between Commissioner OS and the ported
Decision OS backend ([`DECISION_OS_PORT_EXECUTION_REPORT.md`](DECISION_OS_PORT_EXECUTION_REPORT.md),
certified Ready with Conditions in [`DECISION_OS_PRODUCTION_READINESS_REPORT.md`](DECISION_OS_PRODUCTION_READINESS_REPORT.md)).
Scope held to Mission Control only, per instruction. No other module, no
Commissioner OS UI, no adapter contract, and no public API was changed.

## Why this isn't a simple field-mapping exercise

Repository discovery (before writing any code) found that Mission Control's
exact 3-method contract cannot be fully, honestly satisfied by the ported
backend today — verified by reading the actual ported source, not assumed:

- No time-series/previous-period data exists anywhere in
  `LeagueBehavioralIntelligence` → `LeagueHealthSummary.trendLabel`/
  `trendDirection` have no honest value.
- The raw v1 resolver explicitly **strips** `commissionerWorkloadItems`/
  `healthNarrativeInputs`, and the presentation adapter's `healthCard.derivation`
  is a fixed technical trace string, not narrative text → `driver` has no
  honest value either, through either response view.
- No schedule/deadline concept exists anywhere in event-derived behavioral
  intelligence → `MissionControlKpis.nextDeadlineLabel` has no honest value.
- No public route lists a league's managers (`/api/v1/intelligence/manager`
  is a single-manager lookup requiring a `managerId` Mission Control has no
  source for) → `getManagerHighlights()` has no honest value at all.

Given each method's response type is all-or-nothing and none of these
fields can be filled without fabricating data, I presented this to the user
directly rather than resolving it unilaterally (three options: build real
wiring but keep methods on an honest placeholder; switch the first
integration target to a better-suited module; or extend the backend's API
first). **The user chose the first option.** Everything below implements
that choice: real, tested, gated wiring whose *observable* result is
unchanged today, ready to complete the day the backend gains these
capabilities.

Two further, real gaps were found and fixed as necessary parts of
"correct wiring," not scope creep — without them, no module's live
integration could ever succeed:

- **Transport auth mismatch**: `resolveDecisionOSAuthHeaders` sent
  `Authorization: Bearer`, but the ported API's own gate
  (`lib/decision-os/behavioral/api/gate.ts`) only accepts a literal
  `X-AllFantasy-API-Key` header. Fixed internally (no signature change).
- **No league-scoping mechanism**: Mission Control's methods are
  zero-argument, but the real league route requires `leagueId`. Resolved
  internally via the same session + `Roster.platformUserId` pattern
  already established elsewhere in this app — discovered along the way
  that the one existing "active league" route
  (`app/api/user/active-league/route.ts`) queries a `LeagueMember` model
  that doesn't exist in `schema.prisma` at all (a pre-existing bug outside
  Commissioner OS, left untouched, out of this phase's scope).

## 1. Files modified

| File | Change |
|---|---|
| `lib/commissioner-os/decision-os-client/live.ts` | Full rewrite: real `isLiveReady`-gated wiring for `getLeagueHealthSummary`/`getMissionControlKpis`; `getManagerHighlights` unchanged (no backend capability exists) |
| `lib/commissioner-os/adapter/transport/auth.ts` | Internal fix only — API-key header changed from `Authorization: Bearer` to `X-AllFantasy-API-Key`, matching the ported gate's actual requirement. No signature change. |
| `.env.example` | Comment updated to document the confirmed `afk_{test|live}_{token}` key format and the per-module `isLiveReady` gate |
| `__tests__/commissioner-os-transport.test.ts` | One assertion updated to match the corrected header name |
| `__tests__/commissioner-os-mission-control-live-integration.test.ts` | New — 10 tests covering the gated real wiring |

Nothing else changed. Confirmed independently via file modification
timestamps (not git diff, which is uninformative here since Commissioner
OS's files are all uncommitted — see the Repository Hygiene section of the
Production Readiness Report): every file expected to be untouched
(`adapter/index.ts`, `adapter/types.ts`, `decision-os-client/types.ts`,
`stub.ts`, `demo.ts`, `app/commissioner-os/page.tsx`, all
`components/commissioner-os/mission-control/` files) carries a
modification timestamp from a prior phase, while only the five files above
carry today's timestamp.

## 2. Backend entry points used

`GET /api/v1/intelligence/league?leagueId={id}` (raw view, default) — the
only ported route Mission Control's methods call, via
`callDecisionOS('mission-control', '/api/v1/intelligence/league?leagueId=...')`.
`getManagerHighlights()` calls nothing — no route exists for what it needs.

## 3. Adapter verification

- **Adapter interfaces unchanged**: `lib/commissioner-os/adapter/index.ts`
  and `adapter/types.ts` untouched (timestamp-confirmed). `buildMissionControlAdapter`
  still calls `client.getLeagueHealthSummary()` etc. exactly as before —
  `wrapMethod`'s normalize/validate/log pipeline applies identically
  regardless of which concrete client (`stub`/`demo`/`live`) backs it.
- **UI unchanged**: zero files under `components/commissioner-os/mission-control/`
  or `app/commissioner-os/page.tsx` touched.
- **Decision Ownership unchanged**: no ownership doc touched; Mission
  Control's module boundary and public contract (`DecisionOSClient` in
  `types.ts`) are byte-identical to before this phase.
- **Telemetry preserved**: `wrapMethod`'s logging hooks are untouched and
  apply uniformly; my new code produces normal success/error results that
  flow through the exact same logging path as every other client.
- **Error handling preserved**: every new error is a well-formed
  `CommissionerErrorContract` using the existing `upstream_unavailable`
  category — no new category invented, no shape change.
- **Loading states preserved**: method signatures and return-envelope
  shape (`{ data, error, source, timestamp }`) are identical; async timing
  characteristics are unaffected from the UI's perspective.
- **Accessibility / responsive behavior unchanged**: zero UI touched.

## 4. Tests executed

| Suite | Result |
|---|---|
| New: `commissioner-os-mission-control-live-integration.test.ts` | 10/10 passing |
| `commissioner-os-transport.test.ts` (updated) | 11/11 passing |
| `commissioner-os-mission-control.test.tsx`, `commissioner-os-adapter.test.ts`, `commissioner-os-live-readiness.test.ts`, `commissioner-os-live-integration-foundation.test.ts` | 83/83 passing (pre-existing, re-run, zero regressions) |
| Full Commissioner OS suite (23 files) | **310/310 passing** |
| Decision OS behavioral tests (port worktree, re-confirmed unaffected) | 660/660 passing |
| Full-repo typecheck | **3156 errors — exactly the known baseline**, zero new (one round found 2 real new errors from an untyped Prisma callback, fixed with explicit `League` typing, reconfirmed clean) |

The new integration test file proves, with mocked `next-auth`/`prisma`/
`callDecisionOS`/`isLiveReady`: the placeholder path never touches
session/DB/transport when the flag is off (today, always); active-league
resolution correctly finds the most recent non-archived league and skips
archived ones; the real transport call fires with the correct URL and
`leagueId` encoding; a successful real call still returns the specific,
honest "trend"/"deadline" gap error rather than fabricated data; a genuine
transport failure passes straight through unmasked; and `getManagerHighlights`
never even consults `isLiveReady`, since there is nothing to gate.

## 5. Regression results

Zero. 310/310 Commissioner OS tests, 660/660 Decision OS tests, typecheck
at exact baseline. No adapter, UI, or contract file was touched.

## 6. Remaining placeholder dependencies

- `getLeagueHealthSummary()` / `getMissionControlKpis()`: real wiring is
  built and gated behind `isLiveReady('mission-control')` (defaults false,
  unchanged by this phase), but even once flipped true, both will return
  an honest error — not real data — until the Decision OS backend exposes
  trend/narrative-driver data and scheduling/deadline data respectively.
- `getManagerHighlights()`: no wiring attempted; blocked entirely on a
  public per-manager-listing route not existing yet.
- The 3 conditions from the Production Readiness Report remain open (live
  DB unverified, source branch sign-off, Commissioner OS's uncommitted
  state) — none block what was built here, since nothing here executes
  against a real database in this environment either way.

## 7. Risks

1. The auth-header and league-resolution fixes are real, necessary
   corrections to shared infrastructure (`transport/auth.ts`), not
   Mission-Control-specific hacks — but they were discovered and fixed
   *during* a single-module integration task. Worth a second pair of eyes
   given their blast radius (every future module's live.ts depends on
   `auth.ts` being correct).
2. `resolveActiveLeagueId()`'s "most recent non-archived roster's league"
   heuristic is a reasonable first pass, not a verified product decision —
   Commissioner OS has no existing single-league-context convention to
   defer to, and this doesn't attempt to invent one beyond what one method
   needs internally.
3. `scoreToSeverityTier`-equivalent logic was *not* needed in the final
   implementation (removed after simplifying away the dead-code mapping
   attempt) — worth knowing that no score→tier convention exists anywhere
   in Commissioner OS yet, for whoever eventually completes this method.
4. Discovered, not fixed (out of scope): `app/api/user/active-league/route.ts`
   queries a non-existent `LeagueMember` Prisma model behind an `as any`
   cast — very likely broken at runtime today. Not a Commissioner OS file;
   flagging for whoever owns it.

## 8. Readiness for the next module

The pattern is now concrete and proven, not theoretical: `isLiveReady`
gate → resolve any needed context internally (session/DB, matching
existing app conventions) → `callDecisionOS` with a locally-declared
minimal wire-shape type (not an import from the unmerged port branch) →
pass real transport errors straight through → return a specific, honest
error for any field the backend can't yet back with real data, never a
fabricated object. Every future module's `live.ts` can follow this exact
shape. The one thing every subsequent module should check *before*
writing code, per this phase's own experience: whether the ported
backend's actual response shape (traced through its real resolvers/
adapters, not assumed from its type names) actually covers what that
module's specific UI contract needs — it will not always be a full match,
and finding that out early avoids fabricating data under deadline
pressure.
