# B2C Commissioner OS + User OS — Project Plan

Date: 2026-07-12/13. Tracks the dependency chain this multi-phase program
has followed and what each phase actually delivered — a living index, not a
fixed roadmap; each entry reflects what was true when that phase's own
final report was written, not a forward-looking promise.

## The dependency chain (as executed, not as originally imagined)

1. ✅ **Secure canonical imports + identities** (multiple phases,
   culminating in the Import Security Closure phase) — MFL membership
   verification, Fantrax `AppUser` ownership, ESPN/Yahoo/MFL attestation
   requirement discovered and closed at the *server* layer.
2. ✅ **Universal League Hub — Foundation** — canonical
   `LeaguePortfolioService`, Active League Context, `/league-hub`,
   provider capability badges, sync freshness, empty recommendation
   contract. No OS module wired to it yet.
3. ✅ **Commissioner Import Attestation UI** — the missing product surface
   that made the Import Security Closure phase's server contract actually
   usable for MFL/ESPN/Yahoo full-league imports.
4. ✅ **User OS League-Specific Intelligence Wiring** (this phase) — six
   real domain generators (lineup/waiver/trade/roster/playoff/strategy)
   populate the previously-empty `LeagueRecommendationBundle` contract for
   the first time. Partial, not exhaustive — see `USER_OS_CERTIFICATION.md`
   for the honest per-domain breakdown.
5. ✅ **Commissioner OS League-Specific Intelligence Wiring** (this phase)
   — the `commissioner` domain of the same `LeagueRecommendationBundle`
   contract, populated for the first time via eight real domain generators
   (health/engagement/rankings/storylines/rivalries/draft/trades/
   integrity). Reuses a pre-existing, previously-unconsumed shared
   "Commissioner Intelligence Service" (`lib/shared-services/commissioner/*`)
   as its core rather than building fresh — see
   `COMMISSIONER_OS_RECOMMENDATION_ARCHITECTURE.md`. Fixed a real
   authorization gap along the way (`ImportedLeagueCommitService.ts` never
   set `LeagueTeam.isCommissioner` for MFL/ESPN/Yahoo/Fantrax imports).
   Certified with documented limitations — see
   `COMMISSIONER_OS_CERTIFICATION.md`.
6. ✅ **Cross-League Player Intelligence** (this phase) — the universal
   "My Players" workspace (`/my-players`), a canonical cross-league,
   cross-provider player portfolio with real exposure/injury/bye-week/
   league-specific-action intelligence. Reuses a second pre-existing,
   previously-unconsumed shadow-mode engine
   (`lib/shared-services/game-day/UserPlayerExposureService.ts`, Phase 9)
   as its aggregation core, adding real canonical, cross-provider identity
   resolution on top (the one genuinely new piece) — see
   `CROSS_LEAGUE_PLAYER_ARCHITECTURE.md`. Certified with documented
   limitations — see `CROSS_LEAGUE_PLAYER_CERTIFICATION.md`.
7. ➜ **Scoring-Aware User OS Deep Wiring** — player-level waiver
   suggestions, full trade valuation, lineup optimization, provider-
   agnostic Rankings preparation. Not started. Named next step (see this
   phase's closing block).
8. ➜ **Provider-agnostic Rankings** — architecturally scoped
   (`RANKINGS_PROVIDER_DEPENDENCY_INVENTORY.md`, Yahoo phase) but
   deliberately not started in any phase since — explicitly guarded
   against in every phase's hard guardrails.
9. ➜ **Premium visual redesign.** Not started; explicitly out of scope in
   every phase to date.

## Why the sequence held (a real, not cosmetic, dependency order)

Building the League Hub before wiring any OS module onto it meant Steps
4-6 will read from one canonical, already-tested aggregation layer instead
of each independently re-discovering leagues. Building the attestation UI
before the Rankings migration (rather than the reverse, which the user
explicitly considered and rejected mid-program) meant the Rankings
migration — whenever it happens — inherits a fully closed authorization
loop instead of building on top of a known-blocked import path for 3 of 5
providers.

## Current completion snapshot (evidence-based, this phase's own report)

| Area | Status | Evidence |
|---|---|---|
| Import security (server) | Closed | Import Security Closure phase |
| Import attestation (UI) | Closed | Commissioner Import Attestation UI phase; 116 combined regression tests passing |
| Universal League Hub | Foundation complete | `UNIVERSAL_LEAGUE_HUB_CERTIFICATION.md` |
| User OS | **Partial, real, wired** | `USER_OS_CERTIFICATION.md` — 6 domain generators; 58/58 + 99/99 combined regression `vitest` runs confirmed passing in the following phase once worker-pool contention eased |
| Commissioner OS | **Partial, real, wired** | `COMMISSIONER_OS_CERTIFICATION.md` — 8 domain generators, 71/71 new automated tests passing, physically validated on the disposable Neon branch |
| Cross-League Player Intelligence | **Partial, real, wired** (this phase) | `CROSS_LEAGUE_PLAYER_CERTIFICATION.md` — `/my-players` workspace, 27/27 new automated tests passing, physically validated on the disposable Neon branch (Part 21) |
| Rankings | Untouched | Guarded against explicitly in every phase to date, including this one |

## What "User OS" and "Commissioner OS" mean in this program's own vocabulary

Not yet formally specified as a single architecture doc — this is itself a
disclosed gap. Working definition inferred from this phase's brief and the
Foundation phase's `LeagueRecommendationBundle` contract:
- **User OS** = per-manager, per-league recommendations (lineup, waiver,
  trade, roster/playoff-path, contender-vs-rebuild framing) surfaced
  through the League Hub's existing `recommendations` field.
- **Commissioner OS** = the `commissioner` domain of that same contract,
  plus whatever separate surfaces (already-shipped, pre-existing
  `lib/decision-os/phase6` recommendation engine; `lib/commissioner-hub/*`)
  this program eventually decides to bridge into it.

A future phase should decide explicitly whether to formalize this as its
own architecture doc before wiring begins, rather than inferring it fresh
each phase — flagged here, not resolved.

## Guardrails this plan itself is subject to (carried from every phase in this program)

Do not begin the Rankings migration. Do not broadly redesign the
dashboard. Do not fabricate physical provider certification. Do not
increase readiness for documentation or UI alone — every percentage in
every phase's closing block must trace to real code, real tests, or real
disposable-database evidence, disclosed exactly as strong or weak as it
actually is.
