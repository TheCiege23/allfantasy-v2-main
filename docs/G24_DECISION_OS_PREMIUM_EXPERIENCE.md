# G24 Decision OS Premium Experience

Readiness remains unchanged:

- NFL Engine: 93%
- Overall Platform: 90%

## Decision OS UX Principles

Decision OS should feel like the living operating layer of AllFantasy, not a chatbot wrapper. Core engines produce facts. Decision OS interprets those facts into customer-facing intelligence.

Every visible Decision OS surface should answer:

1. What happened?
2. Why did it happen?
3. What should I do next?

Visible cards should include:

- insight
- evidence
- confidence
- next action
- last updated
- insufficient-data fallback when evidence is missing

AI can explain deterministic results, but it must not invent standings, scores, schedules, roster state, transactions, injuries, or projections.

## Current Surface Audit

Classification uses exactly this taxonomy: visible and useful / visible but weak / buried /
disconnected from evidence / too AI-forward / missing confidence/evidence / missing next action /
missing commissioner value / future-only / should be hidden/beta-labeled.

This table is the **pre-G24 baseline** (what a surface looked like before this ticket touched it).
Dashboard, League Home, and Commissioner Hub rows are superseded by the "Implemented Surfaces"
table below, which reflects the current state after League Pulse landed.

| Surface | Classification (pre-G24 baseline) | Notes |
| --- | --- | --- |
| Dashboard widgets | visible but weak | AI shortcuts were visible, but the dashboard lacked a central Decision OS pulse. Now has one — see Implemented Surfaces. |
| League Home | buried | League Intelligence link existed, but the home tab did not summarize league health or next action. Now has a compact pulse — see Implemented Surfaces. |
| Commissioner Hub | visible and useful | Existing commissioner health snapshots and League Health Dashboard provide deterministic signal. Now also has a pulse summary — see Implemented Surfaces. |
| Matchups | future-only | Live scoring and matchup surfaces need a later Decision OS layer for matchup insight and evidence. |
| Team/Roster | future-only | Roster and lineup intelligence exists in pieces, but premium evidence presentation is not unified. |
| Draft Room | future-only | Timer/board controls should stay separate from League Pulse until draft-specific evidence is modeled (Draft AI itself, below, is further along). |
| Settings | future-only | Settings need trust labels, enforcement status, and beta/future copy from prior audits. |
| Chimmy drawer/chat | too AI-forward | Chimmy should increasingly cite Decision OS facts rather than becoming the source of facts. |
| AI Coach | too AI-forward | `AICoachingWorkspace` (gated by `league_ai_coaching`) and the legacy dashboard `ai-coach` API return a persona-driven "head coach" narrative (headline/next-move/game-plan JSON) with no confidence score or evidence array surfaced to the UI. |
| Trade AI | missing confidence/evidence | Trade analysis has deterministic work, but customer presentation still needs consistent evidence and confidence rendering. |
| Waiver AI | missing confidence/evidence | Waiver recommendations need the same evidence and derivation pattern. |
| Draft AI | visible and useful | `DraftHelperPanel` (Live Draft Brain) already renders `explanation`, `evidence[]`, `caveats[]`, and uncertainty/reach/value warnings — the most Decision-OS-disciplined AI surface in the app today. |
| Commissioner AI | buried | A real backend (`lib/redraft/ai/commissionerAssistant.ts`, `app/api/redraft/ai/commissioner/route.ts`) exists for inactive-manager detection and rule recommendations, but has no commissioner-hub UI consumer. The visible "Commissioner AI Prompts" cards in Commissioner Hub are generic link-stubs into `/ai/tools` or `/ai-chat`, not grounded commissioner-specific output. |
| Decision OS cards | visible but weak | `LeaguePulseCard` is genuinely evidence-grounded (status, confidence, evidence, derivation, insufficient-data fallback) but is narrow: one card type, three render sites, not yet a general Decision OS card library. |
| Behavioral intelligence | disconnected from evidence | Deterministic behavioral code paths (Phase 6) exist but are not consistently surfaced as customer-facing evidence in the UI yet. |

## League Pulse Design

League Pulse is the first premium vertical slice. It is a deterministic Decision OS card that summarizes:

- league health
- engagement/setup risks
- activity or ownership signals where available
- competitive balance where standings data exists
- commissioner workload where health snapshots exist
- recommended next action

The first implementation intentionally avoids new AI calls. It derives from available dashboard league data, league home team data, and existing commissioner health snapshots.

## Evidence And Confidence Rules

League Pulse uses:

- evidence rows with customer-readable labels
- confidence labels derived from available data volume and quality
- a short derivation chain
- last-updated time
- an insufficient-data state when league evidence is missing

It does not show raw internal IDs or backend terminology. It does not claim activity, scoring, roster, injury, or projection facts unless those facts are present in the input model.

`LeaguePulseViewModel` (`lib/decision-os/league-pulse.ts`) is a presentation-layer type, not a literal instance of the G20 `DecisionOSInsight` contract (`lib/decision-os/core/integrationContract.ts`). It carries the same required concepts the G20 contract enforces — confidence, evidence, a derivation chain, and an honest insufficient-data path — but in a simpler UI-facing shape (`evidence: {label, value, detail}[]` rather than `DecisionOSEvidenceRef[]`, `derivation: string[]` rather than a typed `DecisionOSDerivationStep[]`, no `aiBoundary`/`plugin`/`riskLevel`). This is a deliberate scope choice for a UI card, not a gap: League Pulse produces zero AI output (matches `createDeterministicAiBoundary`'s spirit) and never needs the full engine-insight contract. A future step, if Decision OS cards become a general library (see the "Decision OS cards" audit row), would be to have card view-models derive from an actual `DecisionOSInsight` rather than parallel it.

## Implemented Surfaces

| Surface | Implementation |
| --- | --- |
| Dashboard | Added a League Pulse card after the dashboard hero, derived from connected leagues and tracked entries. |
| League Home | Added a compact League Pulse module after the league hero and quick cards, derived from team ownership, league state, and points-for spread when present. |
| Commissioner Hub | Added a League Pulse summary above the detailed League Health Dashboard, derived from existing commissioner health snapshots. |

## Files Added Or Updated

- `lib/decision-os/league-pulse.ts`
- `components/decision-os/LeaguePulseCard.tsx`
- `app/dashboard/DashboardContent.tsx`
- `app/league/[leagueId]/tabs/LeagueTab.tsx`
- `app/commissioner-hub/CommissionerHubPageClient.tsx`
- `__tests__/league-pulse-decision-os.test.tsx`
- `e2e/unified-dashboard-click-audit.spec.ts`

## Remaining Surfaces

| Surface | Recommended next step |
| --- | --- |
| Matchups | Add matchup-specific pulse using live scoring, projections, win probability, and freshness evidence. |
| Team/Roster | Add roster pulse using lineup legality, injuries, bench pressure, and upcoming matchup context. |
| Draft Room | Add draft pulse only after draft-specific evidence and action contracts are modeled. |
| Trade AI | Wrap trade recommendations in the same evidence/confidence/next-action pattern. |
| Waiver AI | Wrap waiver recommendations in deterministic need, scarcity, roster fit, and claim-priority evidence. |
| Chimmy | Teach Chimmy to reference Decision OS cards and admit insufficient data, without becoming the source of facts. |

## Tests Run

Passed:

- `npx vitest run __tests__/league-pulse-decision-os.test.tsx __tests__/chimmy-theme-readability.test.tsx __tests__/required-public-media-assets.test.ts`
  - 3 files passed
  - 9 tests passed
- Re-verified in a later session: `npx vitest run __tests__/league-pulse-decision-os.test.tsx` — 1 file, 4 tests, still green against the current working tree.
- Targeted G24 parse check with esbuild for:
  - `lib/decision-os/league-pulse.ts`
  - `components/decision-os/LeaguePulseCard.tsx`
  - `app/dashboard/DashboardContent.tsx`
  - `app/league/[leagueId]/tabs/LeagueTab.tsx`
  - `app/commissioner-hub/CommissionerHubPageClient.tsx`
  - `__tests__/league-pulse-decision-os.test.tsx`
- Light/dark readability verified structurally rather than by a rendered visual test: `LeaguePulseCard.tsx` uses only G22 semantic tokens (`card-premium`, `border-subtle`, `bg-surface-muted`, `text-primary`, `text-secondary`, `text-muted`, `brand-primary`, `content-inverse`), and `app/globals.css` redefines every one of those tokens with appropriate contrast under both `html[data-mode="light"]` (`:root` defaults) and `html[data-mode="dark"]` (lines ~716+). No hardcoded hex/opacity colors were introduced by the card.

Attempted but blocked:

- `npx playwright test e2e/landing-page-click-audit.spec.ts e2e/unified-dashboard-click-audit.spec.ts e2e/draft-room-click-audit.spec.ts --project=chromium --reporter=line --workers=1`
  - Timed out before a clean Playwright summary.
  - Logs showed placeholder Meta CAPI errors for `your-meta-pixel-id`, NextAuth client fetch noise, and web server abort/EPIPE after the outer command timeout.
- `npx playwright test e2e/unified-dashboard-click-audit.spec.ts --project=chromium --reporter=line --workers=1`
  - Timed out waiting 120000ms for `config.webServer`.
  - `http://127.0.0.1:3101/api/auth/csrf` was not reachable after the attempt.
- `npx next dev -p 3101 --hostname 127.0.0.1`
  - Direct startup probe did not reach readiness within 60 seconds in this local shell.
- `npx tsc --noEmit --pretty false --incremental false`
  - Blocked by existing parse errors in `app/league/[leagueId]/LeagueShell.tsx` at lines 1584 and 2249.
- Re-attempted with the `preview_start`/`preview_*` MCP tooling (more reliable than raw shell commands) in a later session, navigating to `/e2e/dashboard-soccer-grouping` on `npm run dev` (port 3000): the dev server process bound the port and logged `✓ Starting...` but never progressed to `Ready in`. Process CPU time advanced only ~0.8s over roughly 3.5 minutes of wall-clock polling (`Get-Process` sampled twice), i.e. the process was idle/stuck, not slow-compiling. This independently confirms the readiness blocker is a genuine local dev-server/environment issue in this workspace, not raw-shell-command flakiness.

## Blockers

No G24 product blocker is known from unit or targeted parse verification. Browser proof is currently blocked by local Next dev server readiness (the server hangs before "Ready" rather than erroring), confirmed independently across two different tool paths (raw shell, then MCP preview tooling) — not by a League Pulse assertion or anything in the G24 diff itself. The dashboard Playwright spec was extended to assert `data-testid="league-pulse-card-dashboard"` once the harness is able to start; the same assertion should be exercised in CI/Vercel where the dev server reliably reaches readiness.
