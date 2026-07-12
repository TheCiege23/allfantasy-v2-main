# G58 — NFL & NCAAF Invited MVP Pre-Certification Hardening

## 1. Executive summary

G58 completed the final planned source-only hardening pass for the invited MVP. The work repaired lineup failure reconciliation, clarified authoritative standings behavior, removed provider and prohibited terminology from the hardened player/waiver surfaces, improved customer-safe errors and mobile table accessibility, froze the NFL/NCAAF feature scope, and established a deterministic invited-MVP regression configuration.

This is not runtime certification. No authenticated browser, database mutation, multiplayer session, mobile-device runtime, or live-provider certification was used or claimed.

## 2. Known blockers entering G58

- Trusted authenticated browser access was unavailable.
- Authenticated create/import and full-season validation remained open.
- Authenticated multiplayer draft validation remained open.
- Live-provider freshness and failure-mode certification remained open.
- Mobile runtime visual certification remained open.
- Earlier focused TypeScript reports alleged session and `web-push` declaration failures.

## 3. TypeScript baseline findings

The alleged `lib/auth.ts` session and `web-push` failures were caused by temporary file-only TypeScript configurations that excluded the repository's declaration files. The real configuration includes `types/**/*.d.ts`; `types/next-auth.d.ts` defines the extended session fields and `types/web-push.d.ts` supplies the module declaration. No broad `any`, disabled check, or unsafe suppression was added.

The memory-adjusted full repository typecheck (`npm run typecheck`) ran for 304 seconds without emitting a diagnostic, then exceeded the execution window. That is a timeout, not a pass. Generated and unrelated repository paths therefore remain outside a fully certified global TypeScript baseline. The curated regression suite compiled and exercised the redraft paths in scope.

## 4. My Team and lineup changes

- Lineup mutations are blocked while a save is in progress.
- Optimistic moves now reconcile from the authoritative roster after a failed save.
- Failure copy no longer exposes raw backend exceptions and explicitly tells the manager the confirmed roster was restored.
- The team-tab failure state states that the prior lineup remains active.
- Owner images use the shared image component with explicit dimensions and fallback behavior.
- Existing server-side authorization, lineup validation, lock enforcement, sport-specific eligibility, and persistence services remain authoritative.

Runtime confirmation of lock timing, IR rules, and mobile interaction remains a certification task.

## 5. Standings changes

- The view explains that rank and playoff seed come from the authoritative standings service.
- Pending stat corrections are explicitly described as capable of changing order.
- Playoff generation, advancement, finalization, and runtime errors use customer-safe actionable text.
- The standings table has a labeled focusable horizontal scroll region, an accessible caption, and a stable mobile minimum width.
- The client does not introduce an independent rank calculation.

Clinched/eliminated presentation remains limited to states returned authoritatively by the existing service.

## 6. Players and waiver changes

- Player-feed errors were normalized to safe customer copy.
- Customer-visible provider branding was removed from the player feed.
- Waiver intelligence copy now uses `Decision Support`, `Coach`, and `guidance`; new customer-facing `AI` terminology was removed.
- Existing claim scoping, duplicate protection, sport-pool resolution, FAAB/priority display, free-agent distinction, and claim persistence remain in the canonical waiver implementation.

Live market accuracy, processing cadence, and provider freshness require runtime certification.

## 7. Commissioner workspace changes

The scoring-status description is now sport-neutral and safe for NFL and NCAAF. G47's existing operations workspace remains the canonical surface; G58 did not create a parallel control center. The curated suite retains its workspace wiring and permission guardrail. Authenticated role denial and destructive actions still require runtime certification.

## 8. Settings changes

The existing DB-first settings panels, authorization boundary, sport defaults, and feature visibility were retained and included in the curated regression suite. Unsupported auction exposure is classified as deferred in the freeze matrix. G58 did not rewrite the settings domain. Authenticated persistence, frozen-season transitions, and destructive confirmations require runtime certification.

## 9. Chat and mention changes

The existing chat and mention UI was retained and its UI contract included in the deterministic suite. No new backend or unsupported DM behavior was introduced. Mention notification delivery is not claimed. Duplicate display-name identity resolution, membership enforcement, persistence, send-failure recovery, mobile keyboard behavior, and notification delivery still require authenticated runtime certification; this surface is therefore only partially source-ready.

## 10. Release guardrails

`__tests__/redraft/g58-invited-mvp-guardrails.test.ts` guards:

- real TypeScript configuration inclusion of declaration files;
- authoritative lineup reconciliation after failure;
- authoritative and pending-correction standings copy;
- provider-brand and prohibited-terminology leakage in the hardened player/waiver surfaces;
- feature-freeze truth.

`vitest.invited-mvp.config.ts` defines a deterministic 16-file suite covering create defaults, import validation/commit, draft authorization and pick transactions, sport-pool isolation, lineup locks/validation, waivers, trades, playoffs/standings, commissioner operations, settings, chat mentions, and NFL/NCAAF adapter parity.

The suite is deliberately curated. It does not replace the full repository test suite or runtime certification.

## 11. Feature-freeze decisions

The authoritative matrix is [NFL_NCAAF_INVITED_MVP_FEATURE_MATRIX.md](./NFL_NCAAF_INVITED_MVP_FEATURE_MATRIX.md).

Key decisions:

- NFL auction is deferred and must not be advertised as invited-MVP scope.
- NCAAF Sleeper import is hidden; Fantrax import requires certification.
- Source-present live, multiplayer, mobile, and provider-backed capabilities are marked as requiring certification rather than complete.
- Keeper, Devy, C2C, IDP, salary-cap, and unsupported provider variants remain excluded unless the matrix explicitly includes them.

## 12. Files modified by G58

- `components/app/roster/useRosterManager.ts`
- `app/league/[leagueId]/tabs/TeamTab.tsx`
- `app/league/[leagueId]/tabs/redraft/StandingsView.tsx`
- `app/league/[leagueId]/tabs/PlayersTab.tsx`
- `components/waiver-wire/WaiverClaimDrawer.tsx`
- `components/waiver-wire/WaiverWirePage.tsx`
- `components/league-home/CommissionerOperationsWorkspace.tsx`
- `__tests__/redraft/g58-invited-mvp-guardrails.test.ts`
- `vitest.invited-mvp.config.ts`
- `docs/redraft/NFL_NCAAF_INVITED_MVP_FEATURE_MATRIX.md`
- `docs/redraft/G58_INVITED_MVP_PRE_CERTIFICATION_HARDENING.md`

The worktree contains extensive changes from earlier phases and user work; this list is intentionally limited to G58-owned changes.

## 13. Tests and validation

### Passing

- `npx vitest run --config vitest.invited-mvp.config.ts --pool=threads --maxWorkers=1`
  - 16/16 files passed
  - 127/127 tests passed
  - 0 failures, 0 skips, 0 retries, 0 timeouts
  - final duration: 175.41 seconds
- Targeted ESLint over the seven modified application files and G58 guardrail/config:
  - exit 0
  - 0 errors, 0 warnings
- `git diff --check`:
  - exit 0
  - no whitespace errors (line-ending conversion warnings are informational)

### Not passing / not counted

- `npm run typecheck`: timed out after 304 seconds with no emitted diagnostics. It is not counted as passing.
- An initial regression attempt used a merged Vitest config whose include arrays concatenated with the global suite. It ran unrelated World Cup tests, encountered pre-existing `hasLiveData` failures/EPIPE, and timed out. The configuration defect was corrected with a standalone curated config; the failed attempt is not counted.
- Browser validation: not performed.
- Database validation: not performed.
- Authenticated validation: not performed.
- Live-provider validation: not performed.

## 14. Remaining source-level blockers

- A complete repository-wide TypeScript pass has not completed within the available execution window.
- Chat/mention identity edge cases and notification semantics need a narrow source/runtime review if certification exposes a defect.
- Several customer workflows have source coverage but cannot be truthfully closed without authentication and persistence evidence.

No known remaining source defect in the G58-modified lineup, standings, player, waiver, or commissioner files failed the curated suite or targeted lint.

## 15. Runtime certification blockers

- Trusted browser bridge attached to a real commissioner session.
- Safe real development database and authenticated create/import lifecycle.
- Two or more authenticated managers for multiplayer draft certification.
- Live provider credentials/data for freshness, cache, fallback, timeout, and failure evidence.
- Desktop and 390×844 mobile runtime visual validation.

## 16. Updated readiness assessment

Readiness remains unchanged because source hardening is not runtime certification:

- NFL Redraft: **95%**
- NCAAF Redraft: **80%**
- August 10 Controlled Beta: **70%**

## 17. Recommended next phase

The next action is authenticated certification, beginning with the G48 create/import and commissioner lifecycle rerun when a trusted authenticated browser and safe development database are available. Then run authenticated multiplayer draft certification and live-provider certification. A G58B remediation is not presently warranted; create one only for a specific defect revealed by certification.

```text
G58 INVITED MVP PRE-CERTIFICATION HARDENING: PASS
REDRAFT-RELEVANT TYPESCRIPT ERRORS RESOLVED: PARTIAL
MY TEAM AND LINEUP SOURCE-READY: YES
STANDINGS SOURCE-READY: YES
PLAYERS AND WAIVERS SOURCE-READY: YES
COMMISSIONER WORKSPACE SOURCE-READY: YES
SETTINGS SOURCE-READY: YES
CHAT AND MENTIONS SOURCE-READY: PARTIAL
NFL INVITED MVP FEATURE SCOPE FROZEN: YES
NCAAF INVITED MVP FEATURE SCOPE FROZEN: YES
SOURCE-LEVEL RELEASE GUARDRAILS COMPLETE: YES
READY FOR AUTHENTICATED CREATE/IMPORT CERTIFICATION: YES
READY FOR AUTHENTICATED MULTIPLAYER DRAFT CERTIFICATION: YES
READY FOR LIVE PROVIDER CERTIFICATION: YES
RECOMMENDED FOR INVITED MVP WITHOUT RUNTIME CERTIFICATION: NO
```
