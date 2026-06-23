# T10 — Chimmy Trade Intelligence (grounded + deterministic tool layer)

Adds grounded trade intelligence to Chimmy so it can **explain, teach, summarize, and
answer** trade questions using the deterministic T2–T9 layers already in production.
Chimmy never negotiates, auto-sends, auto-vetoes, accuses collusion, mutates official/
provider values, scrapes KTC, or invents numbers.

## Phase 0 — precondition (confirmed)
- `main` includes **#99 / T9** (`5cd283cd`) and **#101 route-headroom** (`cc4c81f5`).
- Production smoke (prior turn) green: T9 `/api/redraft/trades/market-values` live + gated, old `[playerId]` route 404, `/api/health` 200, deferred excluded routes 404, core flows load, no route-cap failure.
- Branched fresh from `main`: `feature/t10-chimmy-trade-intelligence`.

## Phase 1 — audit findings
- **Where Chimmy gets context:** the shared route `app/api/chat/chimmy/route.ts` (2179 lines) composes per-mode grounding via `build<Mode>ContextForChimmy(leagueId, userId)` adapters (tournament, big-brother, redraft, dynasty, keeper, best-ball, guillotine, …) appended to `legacyEnrichmentContext`. There was **no trade grounding adapter**.
- **How trade questions were answered:** only the standalone `app/api/trade-value/chimmy` console route (single-shot LLM over a supplied payload). The main grounded Chimmy had no trade layer.
- **Reused route decision:** **reuse `app/api/chat/chimmy`** — add one `buildTradeContextForChimmy` adapter call alongside the existing mode adapters. **No new route.** (See route-budget below.)
- **Deterministic tools exposed:** explainTrade, commissionerTradeReview, findTradePartners, suggestTradePackages, explainPlayerMarketValue, summarizeTradeBlock.
- **Commissioner-only:** T4 commissioner review (risk/context flags, audit/event trail).
- **Manager-visible:** own roster, league-visible trade-block items, own private interests, published AllFantasy market values, snapshot grades, deterministic partners/packages from their own team.
- **Refused / insufficient:** other teams' private interests/strategy; commissioner review for non-commissioners; unpublished values (insufficient sample); any auto-action.

## Route-budget impact
**Zero new routes.** T10 is server/lib modules + one adapter call wired into the existing Chimmy route. Headroom from #101 (~26 routes, ≈2022) is preserved. The route-budget test stays green.

## Phase 2 — context builder
`lib/chimmy-trade/tradeIntelligenceContext.ts` → `buildTradeIntelligenceContext({ leagueId, userId, proposalId?, playerId?, partnerRosterId? })`. Returns a **structured** object: role, myRosterId, sport, permission flags, proposal (T2 snapshot), commissioner review (gated), player value (T9), trade block (T8), and `limitations[]`. Privacy: role-resolved via `resolveTradeRole`; managers see league-visible + own private interests; commissioner-only review gated; no emails/tokens/session/other-team private strategy.

## Phase 3 — deterministic tools (`lib/chimmy-trade/tradeIntelligenceTools.ts`)
Each reuses the existing service and returns `{ ok, data, text[], limitations[] }`; **no fabricated numbers**.
| Tool | Source reused |
|---|---|
| `explainTrade(proposalId)` | T2 `RedraftTradeValueSnapshot` (immutable; flagged historical) |
| `commissionerTradeReview(proposalId, role)` | T4 `buildCommissionerTradeReview` + `summarizeMarketContext` + `buildTeamProfile` (commissioner-gated) |
| `explainPlayerMarketValue(playerId, sport)` | T9 `resolveAllFantasyMarketValue` (source-separated) |
| `summarizeTradeBlock(leagueId, rosterId)` | T8 block items + `discoverySignals` (league-visible + own interests only) |
| `findTradePartners(leagueId, rosterId)` | T7 `assembleDiscoveryLeague` + `findPartners` |
| `suggestTradePackages(leagueId, rosterId, partnerRosterId)` | T7 `findPackages` (fairness bands; `canStartProposal`, no auto-submit) |

## Phase 4 — intent router (`lib/chimmy-trade/intent.ts`)
Deterministic keyword/pattern classifier → `explain_trade | commissioner_review | find_partners | suggest_packages | explain_player_value | summarize_block | teach | general_trade`. No LLM, no hidden-id guessing; uncertain → general trade education + ask for a specific player/team/proposal.

## Phase 5 — answer policy (`lib/chimmy-trade/answerPolicy.ts`)
`TRADE_INTELLIGENCE_SYSTEM_RULES` injected into grounding: only use context numbers; report insufficient data; keep the four value sources distinct (official AllFantasy market / provider-ADP-projection / immutable snapshot / preview) and never claim one overwrites another; snapshot grades are historical; never "must veto" (commissioners get "manual review suggested" with neutral flags); never collusion/cheating; managers never see commissioner-only/other-team private data; Chimmy can draft/build but never auto-submit/accept/veto; beginner teaching mode; limited-data answers for unsupported sports/formats. `assertSafeText` + `FORBIDDEN_PHRASE_PATTERNS` scrub veto-command/collusion/auto-action/guarantee phrasing.

## Phase 6 — integration
`lib/chimmy-trade/tradeChimmyGrounding.ts` → `buildTradeContextForChimmy(leagueId, userId, opts?)` mirrors the other adapters: returns a compact grounded block (numbers + policy) or **null** when the user is a non-member or there is no trade context (so other formats are unaffected). One non-fatal `try/catch` call added in `app/api/chat/chimmy/route.ts` after the existing mode adapters. Existing rate-limit/subscription/modes/languages/mobile/World Cup behavior untouched.

## Phase 7 — UI
**Deferred** (per the "skip if risky" guidance): wiring prefilled "Ask Chimmy" buttons into the complex Trade Center / Commissioner Review / Discovery / Market Value panels carries UI-breakage risk. Backend + tooling + grounding ship first; UI entry points are a safe follow-up using the existing `?openChat=league` drawer mechanism.

## Phase 8 — tests
`__tests__/chimmy-trade/trade-intelligence.test.ts` (16): intent classifier mapping; system-rules content (no "must veto", auto-actions, collusion; 4 sources distinct); `assertSafeText` scrubbing; **manager/non-member cannot see commissioner review**; insufficient-data wording with **no fabricated number**. The 2179-line LLM chat route is not deterministically unit-testable (live model + tokens); its trade behavior is covered by the deterministic layer these tests exercise.

## Limitations
- Deterministic-only; Chimmy explains numbers, never invents them.
- Commissioner review requires commissioner/co-commissioner role.
- Unpublished (low-sample) players return an insufficient-data answer.
- NCAAF is flagged limited-data.
- UI entry points deferred.

## Explicitly NOT in T10
No auto-trading · no auto-veto · no collusion accusations · no provider writes · no official-value mutation · no KTC scraping · no new external API calls in write paths · no new routes.

## Future
- **T11** automated negotiation — not started.
- **T12** provider-market integrations — not started.
- **T13** paid trade-agent workflows — not started.
