# G15 Core Commissioner Settings Enforcement Audit

Readiness is held at NFL Engine 93% and Overall Platform 90%.

This is an audit of whether commissioner-facing settings actually change engine behavior. It does not change production behavior.

## 1. Settings Architecture Map

Commissioner settings currently have multiple owners:

1. Broad league settings path:
   - UI: `app/league/[leagueId]/tabs/LeagueSettingsTab.tsx`, `components/league-settings/*`, and related league settings subpanels.
   - API: `app/api/league/settings/route.ts` and `app/api/leagues/[leagueId]/settings/route.ts`.
   - Executor: `lib/league/execute-league-settings-patch.ts`.
   - Persistence: `League` columns, `League.settings`, and `LeagueSettings`.
   - Engine sync: draft settings sync through `lib/league/league-settings-draft-sync.ts`; some waiver/playoff legacy fields sync through `lib/league/commissioner-settings-derived-sync.ts`.

2. Older commissioner section settings path:
   - UI: `components/app/settings/RosterSettingsPanel.tsx`, `TradeSettingsPanel.tsx`, `GeneralSettingsPanel.tsx`.
   - API: `app/api/commissioner/leagues/[leagueId]/settings/route.ts`.
   - Service: `lib/commissioner-settings/CommissionerSettingsService.ts`.
   - Persistence: a narrow set of `League` columns and `League.settings` keys.
   - Engine sync: partial. This path emits `EVENT.SETTINGS_CHANGED` and invalidates draft caches for roster/template changes, but it is not the canonical behavior owner for draft, waiver, playoff, scoring, or AI settings.

3. Domain-specific settings paths:
   - Scoring: `app/api/commissioner/leagues/[leagueId]/scoring/route.ts` -> `lib/scoring-defaults/*`.
   - Waivers: `app/api/commissioner/leagues/[leagueId]/waivers/route.ts` -> `lib/waiver-wire/settings-service.ts` -> `lib/waiver-wire/process-engine.ts`.
   - Draft variants: `app/api/leagues/[leagueId]/draft/settings/route.ts`, `app/api/leagues/[leagueId]/settings/draft/route.ts`, `LeagueSettings`, `DraftSession`, and `League.settings`.
   - Playoffs: `app/api/commissioner/leagues/[leagueId]/playoffs/route.ts`, playoff defaults, and Redraft playoff bracket routes.
   - AI toggles: `app/api/leagues/[leagueId]/ai-settings/route.ts` -> `lib/ai-settings/LeagueAISettingsResolver.ts`.
   - IDP: `app/api/leagues/[leagueId]/idp/config/route.ts` and IDP config/resolvers.

The architectural gap is not lack of settings. It is that "commissioner setting" is not yet a single Core Commissioner Engine contract with one resolver and explicit enforcement status.

## 2. UI to Engine Enforcement Table

| Setting area | UI location | API route | Persistence | Resolver / service | Engine consumer | Status | Severity | Recommended fix |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| League identity, sport, season, timezone, language | League settings tabs | `app/api/league/settings/route.ts` | `League`, `LeagueSettings` | `executeLeagueSettingsPatch` | League shells, defaults, draft/scoring resolvers | Enforced | Low | Keep in broad patch executor; expose through a typed Core Commissioner Settings resolver. |
| Roster size | `RosterSettingsPanel`, league settings tabs | Older commissioner settings route and broad league settings route | `League.rosterSize` | `CommissionerSettingsService`, `buildLeagueUpdateFromBody` | Redraft finalize, waiver roster-size checks, lineup validation | Enforced | Medium | Pick one canonical save route and deprecate duplicate older panel path. |
| Starter positions including FLEX, SUPERFLEX, DEF, K | Roster settings panels and draft/pre-draft settings | Older commissioner settings route and broad settings route | `League.starters`, `League.settings.rosterPositions` | `lib/redraft/rosterConfigResolver.ts` | `lib/redraft/lineupValidation.ts`, scoring starter detection, draft roster display | Enforced | Medium | Preserve G10 behavior; add a settings registry row marking these as engine-owned. |
| Bench, IR, taxi limits | Roster settings panels | Older/broad settings routes | `League.settings`, roster template shape | `rosterConfigResolver` | `lineupValidation` | Enforced | Medium | Keep tests; ensure UI labels match effective normalized slot names. |
| Lineup lock mode | Redraft lineup lock controls | `app/api/redraft/lineup-lock/route.ts` | `League.settings.sportConfig` | `lib/redraft/lineupLock.ts` | Redraft roster save and validation routes | Enforced | Medium | Move ownership into Core Commissioner Engine later; current behavior is real. |
| Scoring rules | `ScoringSettingsPanel` | `app/api/commissioner/leagues/[leagueId]/scoring/route.ts` | scoring override store | `LeagueScoringConfigResolver`, `ScoringOverrideService` | scoring engine, projection/scoring contracts | Enforced | Low | Keep domain route; add registry metadata linking UI rule keys to engine stat keys. |
| Legacy scoring fallback | League creation/import/legacy league paths | Multiple | `League.scoring` plus canonical overrides | scoring defaults/resolver bridge | scoring engine | Partially enforced | Medium | Keep migration plan; warn that fallback is compatibility, not the future owner. |
| Waiver type: FAAB | `WaiverSettingsPanel` | `app/api/commissioner/leagues/[leagueId]/waivers/route.ts` | waiver settings row plus legacy columns sync | `getEffectiveLeagueWaiverSettings` | `processWaiverClaimsForLeague`, `transaction-eligibility` | Enforced | Low | Make waiver settings the canonical source; legacy column sync should become read-through compatibility only. |
| Waiver type: rolling | `WaiverSettingsPanel` | same | same | same | `process-engine` moves winning roster to the back of priority | Enforced | Low | Add explicit integration coverage for rolling priority mutation if missing. |
| Waiver type: reverse standings | `WaiverSettingsPanel` | same | same | `ClaimPriorityResolver`, `process-engine` rank map | `orderClaimsForProcessing` | Enforced | Medium | Verify standings rank freshness before each run; document dependency on `LeagueTeam.currentRank`. |
| Waiver type: FCFS/standard | `WaiverSettingsPanel` | same | same | `waiver-engine-config`, scheduled/immediate helpers | waiver processing and free-agent service | Partially enforced | Medium | Clarify FCFS submission semantics and scheduled batch bypass in docs/tests. |
| Waiver limits, FAAB min bid, zero bid, overrides | `WaiverSettingsPanel` | same | waiver settings row and `waiverEngineConfig` | waiver settings service | claim creation, eligibility, process engine | Enforced | Medium | Keep as Waiver Engine plugin-owned settings under a Core Commissioner registry. |
| Trade review hours | `TradeSettingsPanel`, Redraft trade settings API | older commissioner settings route and `app/api/redraft/trade-settings/route.ts` | `League.tradeReviewHours` | generic `tradeSettingsResolver` exists | Redraft proposal route mostly uses request/default expiry | Partially enforced | High | Redraft proposal creation must resolve league trade settings instead of trusting body/default hours. |
| Trade deadline | league settings / Redraft trade settings | broad settings route and redraft trade settings GET | `League.tradeDeadlineWeek` | generic `tradeSettingsResolver` supports it | generic league-trade-engine validates it; native Redraft proposal route does not visibly call it | Partially enforced | High | Gate native Redraft proposal creation through `validateTradeAssets` or a Redraft adapter that calls the same resolver. |
| Trade veto mode | `TradeSettingsPanel` | older commissioner settings route | `League.settings.tradeReviewType` | `CommissionerSettingsService`; generic resolver looks for `commissionerSettings.tradeReviewMode` | native Redraft proposal route trusts `body.vetoMode` | Broken/disconnected | High | Normalize one persisted key and make Redraft proposal creation derive `vetoMode` from league settings. |
| Veto threshold | `TradeSettingsPanel` | older commissioner settings route | `League.settings.vetoThreshold` | generic resolver expects percent-style key; Redraft proposals store numeric threshold | `trade-votes` enforces proposal threshold | Partially enforced | High | Convert settings to proposal policy at proposal creation; stop accepting arbitrary client threshold without commissioner authority. |
| Commissioner approval/veto endpoint | Commissioner review/vote UI | `app/api/redraft/trade-votes/route.ts`, `trades/veto` | `RedraftTradeProposal` | route-level auth | proposal status transitions | Enforced | Medium | Keep; connect allowed actions to resolved league review mode. |
| Draft pick trading | league settings and draft trade UI | broad settings route; draft trade routes | `League.draftPickTrading` | `isDraftPickTradingAllowedForLeague` only blocks tournament mode | draft pick trade routes | Partially enforced | High | `isDraftPickTradingAllowedForLeague` must honor `League.draftPickTrading`, not just tournament mode. |
| Trade max assets / lock windows | trade UI concepts | scattered / not found as canonical setting | not canonical | none found | not consistently enforced | Missing | Medium | Hide or beta-label until Core Trade Engine has typed limits. |
| Draft type: snake/linear/3RR | Draft settings panels | broad settings route and draft settings route | `LeagueSettings`, `DraftSession`, `League.settings.draft_config` | `league-settings-draft-sync`, draft type registry | live draft session, order mechanics | Enforced | Low | Keep; route already blocks structural edits during active drafts. |
| Draft type: auction | Draft settings panels | draft settings route plus auction routes | `DraftSession.draftType`, auction state/settings | auction engine routes | auction nominate/bid/resolve | Partially enforced | Medium | Mark as supported where auction routes exist; keep as beta unless end-to-end launch suite covers it. |
| Draft execution: auto | Draft settings panels | broad/draft settings routes, autopick routes | `LeagueSettings.aiAutoPick/cpuAutoPick`, `DraftSession` | draft sync and live draft autopick services | autopick expired, CPU/AI draft manager | Enforced | Medium | Keep; separate "auto draft" from broader AI toggles in UI copy. |
| Draft execution: offline | Draft settings panel and draft type matrix | draft settings route may accept format-specific ids; broad executor does not include offline in `DRAFT_TYPES` | `League.settings.draft_execution_offline` / config shapes | partial | not a single offline draft engine | Future-only / partially wired | Medium | Label offline as future/beta until import/reconciliation is the enforced path. |
| Pick timer, pause/resume, slow draft windows | Draft settings / automation / commissioner controls | draft settings and draft controls routes | `LeagueSettings`, `DraftSession`, `League.settings.draftUISettings` | `DraftSessionService`, draft controls route | live draft timer and worker | Enforced | Low | Keep; already has focused draft timer suites. |
| Traded picks during draft | Draft trade UI | draft trade routes | `DraftSession`, pick ownership tables | draft trade services | live draft board/trade routes | Partially enforced | High | Same blocker as draft pick trading: league-level toggle is not the authoritative guard. |
| Playoff team count | Playoff settings panel / broad settings | playoff route and broad settings route | `League.playoffTeams`, `League.settings.playoff*` | playoff defaults and Redraft bracket route | bracket creation partially | Partially enforced | High | G14 item: bracket generation must consume resolved playoff settings by default. |
| Playoff start/championship week | Playoff settings panel | playoff/broad settings routes | `League.playoffStartWeek`, settings JSON | schedule/season cutoff paths | Redraft bracket advancement mostly separate | Partially enforced | High | Leave implementation for Playoff Engine migration; do not mix into Schedule Engine. |
| Playoff reseeding | Playoff settings panel | playoff settings route | `League.settings` | not consistently consumed | not native Redraft bracket advancement | Cosmetic only | Medium | Hide/beta-label until G14 implementation. |
| Consolation / lower bracket | Playoff settings panel | playoff settings route | `League.settings` | playoff config | not consistently generated | Cosmetic only | Medium | Hide/beta-label until G14 implementation. |
| Third-place game | Playoff settings panel | playoff settings route | `League.settings` | playoff config | not consistently generated | Cosmetic only | Medium | Hide/beta-label until G14 implementation. |
| Odd playoff sizes | broad settings validator checks some subscription cases | broad settings route | `League.playoffTeams` | subscription gate and playoff defaults | bracket byes partially | Partially enforced | Medium | Keep gated; G14 should own supported bracket shapes. |
| Schedule settings | `ScheduleSettingsPanel` | schedule/domain settings paths | schedule settings JSON | G13 schedule audit | Redraft scheduler not fully core-owned | Partially enforced | Medium | Keep separate from playoff bracket advancement; schedule settings are not G15 fix scope. |
| Keeper settings | league/draft keeper panels | keeper draft routes and broad settings route | `LeagueSettings.keeper*`, keeper config | keeper draft services | keeper deadline/routes | Partially enforced | Medium | Plugin-owned; register as Keeper plugin settings with explicit engine consumers. |
| Dynasty settings | `DynastySettingsPanel`, dynasty route | `app/api/leagues/[leagueId]/dynasty-settings/route.ts` | dynasty payload/settings | dynasty services | dynasty lifecycle/renewal | Partially enforced | Medium | Plugin-owned until Core Commissioner registry supports format-specific settings. |
| Devy / C2C settings | Devy/C2C panels/routes | devy/c2c routes and broad settings route | `League.settings.devyLeagueConfig`, C2C settings | concept-specific services | draft pools, promotions, C2C import | Partially enforced | Medium | Plugin-owned; do not fold into Redraft settings. |
| IDP settings | IDP config route/panels | `app/api/leagues/[leagueId]/idp/config/route.ts` | IDP config | IDP resolvers | roster/draft/AI IDP context | Partially enforced | Medium | Plugin-owned; enforce through roster/scoring/draft extension registry. |
| Salary cap settings | salary/auction-related panels/routes | scattered concept routes | settings JSON/session variant | draft/auction/salary cap helpers | partial | Future-only / beta | Medium | Hide unless league concept explicitly supports salary cap execution. |
| AI feature toggles | `AISettingsPanel`, AI league settings panels | `app/api/leagues/[leagueId]/ai-settings/route.ts` | `League.settings`, draft UI settings for orphan AI | `LeagueAISettingsResolver` | orphan AI draft manager only clearly consumes toggle; feature gates check subscription, not these toggles | Partially enforced / cosmetic | High | Routes for AI trade/waiver/draft/coach/chat should call `isLeagueAIFeatureEnabled` or labels must say these are visibility preferences only. |
| AI Commissioner config | `AICommissionerPanel` | `app/api/leagues/[leagueId]/ai-commissioner/*` | `aiCommissionerConfig`, alerts/actions | `AICommissionerService`, unified system | AI Commissioner run/chat/alerts | Partially enforced | Medium | Keep separate from generic AI toggles; subscription/token gates are enforced, but setting-level behavior needs an explicit table. |
| Notification settings | notification/draft-intel settings | notification routes | notification settings tables/JSON | notification services | email/push/draft notifications | Partially enforced | Low | Move into User/Commissioner Notification plugin, not core league rules. |

## 3. Enforced Settings

- Scoring overrides are enforced through the canonical scoring config route, normalized stat keys, override persistence, and scoring recalculation queue.
- Roster starter slots, FLEX/SUPERFLEX aliases, DEF/K, bench, IR, and taxi are enforced by `rosterConfigResolver` and `lineupValidation`.
- Lineup lock modes are enforced by Redraft lock reads during lineup save/validation.
- Waiver FAAB, rolling priority, reverse-standings order, claim limits, FAAB min bid, zero-bid rules, and commissioner waiver overrides are enforced in the waiver processor/eligibility path.
- Draft snake/linear/3RR, timers, CPU/AI autopick flags, pause/resume, and most live draft controls are enforced through `LeagueSettings` -> `DraftSession` sync and draft control routes.
- Commissioner approve/veto actions for existing Redraft trade proposals are enforced at the proposal/vote route layer.

## 4. Cosmetic-Only Settings

- Native Redraft playoff reseeding, consolation/lower bracket, and third-place settings are saved/configurable but are not consistently consumed by bracket advancement.
- Several AI feature toggles are saved but not broadly consumed by AI routes. Subscription/token gates exist, but a commissioner disabling "Trade Analyzer" does not appear to stop all trade AI routes.
- Some schedule/automation display options are UI preferences unless a draft/session route explicitly consumes them.

## 5. Broken Or Disconnected Settings

1. Trade veto mode and veto threshold are the highest-risk disconnect.
   - `TradeSettingsPanel` saves `tradeReviewType` and `vetoThreshold` through the older settings route.
   - `app/api/redraft/trade-proposals/route.ts` accepts `body.vetoMode` and `body.vetoThreshold`, defaulting to commissioner/4.
   - `app/api/redraft/trade-votes/route.ts` enforces the proposal threshold, not the league setting.
   - Future impact: a commissioner-facing policy can be bypassed or ignored at proposal creation.

2. Draft pick trading toggle is not the authoritative guard for all draft pick trade paths.
   - Draft trade routes call `isDraftPickTradingAllowedForLeague`.
   - That function currently blocks tournament mode but does not read `League.draftPickTrading`.
   - Future impact: commissioners may believe pick trading is disabled while draft pick routes still allow it outside tournament mode.

3. AI feature toggles do not form a route-level permission system.
   - `LeagueAISettingsResolver` persists toggles.
   - `requireAIFeature` only checks AF Commissioner subscription and is not called broadly.
   - Future impact: visible toggles behave like preferences while users expect enforcement.

## 6. Future-Only Settings

- Offline draft execution should remain beta/future until there is a single offline draft reconciliation engine.
- Salary cap should remain beta/future outside formats that have full auction/salary execution.
- Playoff reseeding, consolation, third-place, custom bracket sizes, and odd-size bracket support should remain G14-owned until the Playoff Engine consumes them.
- Devy, C2C, Dynasty, Keeper, IDP, Guillotine, Survivor, Tournament, Zombie, Big Brother settings should be plugin-owned unless a setting has a shared Core Commissioner contract.

## 7. Severity-Ranked Gap Table

| Severity | File | Issue | Reason | Future impact |
| --- | --- | --- | --- | --- |
| High | `app/api/redraft/trade-proposals/route.ts` | Proposal creation trusts body/default trade policy | League trade settings are not resolved at creation | Redraft can bypass commissioner trade mode/review/deadline expectations. |
| High | `components/app/settings/TradeSettingsPanel.tsx` + `lib/commissioner-settings/CommissionerSettingsService.ts` | Trade settings are saved in legacy keys | Generic resolver expects different canonical keys | Future Trade Engine plugins will inherit mismatched policy semantics. |
| High | `lib/tournament-mode/safety.ts` | `isDraftPickTradingAllowedForLeague` ignores `League.draftPickTrading` | Function name implies league policy but only blocks tournament mode | Draft pick trading can remain enabled despite commissioner setting. |
| High | `lib/ai-settings/LeagueAISettingsResolver.ts` and AI routes | AI toggles are mostly not route guards | Toggles save correctly but consumers are sparse | Paying commissioners may disable AI features that remain callable. |
| High | Playoff routes/settings from G14 | Playoff settings are not consistently enforced | Bracket creation/advancement does not consistently consume resolved settings | Commissioner playoff configuration can be cosmetic. |
| Medium | `app/api/commissioner/leagues/[leagueId]/settings/route.ts` | Older settings route overlaps broad settings executor | Two save paths with different schemas | Core Commissioner Engine cannot prove one persisted source of truth. |
| Medium | `lib/league/commissioner-settings-derived-sync.ts` | Legacy derived sync for waiver/playoff fields | Duplicates domain-specific settings ownership | Future plugins may read stale legacy columns. |
| Medium | `components/app/settings/DraftSettingsPanel.tsx` | Offline/format-specific draft options exceed core execution maturity | Some modes are configuration/UI first | Commissioners may expect complete execution for beta formats. |
| Medium | `app/api/commissioner/leagues/[leagueId]/playoffs/route.ts` | Playoff advanced options are saved before engine support | G14 boundary | Must not leak playoff behavior into regular-season schedule engine. |
| Low | `app/api/commissioner/leagues/[leagueId]/scoring/route.ts` | Scoring route is separate from broad settings | Good domain ownership but not registered centrally | Low risk, but needs registry documentation. |

## 8. Minimal-Risk Fix Plan

1. Add a Core Commissioner Settings Registry.
   - Metadata only first: setting key, UI owner, API owner, persistence path, resolver, engine consumer, status, plugin owner.
   - No behavior changes in the first pass.

2. Fix trade policy enforcement in the smallest slice.
   - Create a Redraft adapter that resolves league trade settings at proposal creation.
   - Derive `vetoMode`, `vetoThreshold`, `expiresAt`, and deadline acceptance from the league policy.
   - Keep existing proposal schema, but stop trusting client-provided policy values from non-commissioner proposal creation.

3. Fix draft pick trading guard.
   - Update the guard to read `League.draftPickTrading` and tournament status.
   - Add tests proving false blocks draft trade proposals/analyze routes.

4. Add AI toggle guards or relabel.
   - For each AI route, either call `isLeagueAIFeatureEnabled` for the matching feature or label the toggle as "UI preference / beta."
   - Do not silently keep enabled features behind a disabled commissioner toggle.

5. Register plugin-owned settings.
   - Waiver, Draft, Scoring, Playoff, Keeper, Dynasty, Devy, C2C, IDP, Survivor, Guillotine, Tournament, Zombie, Big Brother should expose their own settings descriptors.
   - Core Commissioner Engine should orchestrate descriptors, not own all behavior.

6. De-duplicate older settings route after registry coverage.
   - Keep compatibility reads.
   - Migrate writes to broad or domain-specific route owners.

## 9. Hiding And Beta-Labeling Strategy

- Hide or beta-label playoff reseeding, consolation bracket, third-place game, and unsupported odd-size brackets until the Playoff Engine consumes them.
- Hide or beta-label offline draft unless the league is using an import/reconciliation flow with clear commissioner confirmation.
- Hide salary cap outside formats with salary execution.
- Rename AI feature toggles to "AI feature preferences" unless route-level enforcement is added.
- Keep waiver type, scoring, roster, lineup lock, draft timer, pause/resume, and core draft order settings visible because they have real engine consumers.

## 10. Tests Run And Results

Focused verification passed:

```text
npx vitest run __tests__/redraft/commissioner-scoring-contract.test.ts __tests__/redraft/commissioner-roster-validation.test.ts __tests__/redraft/lineup-validation.test.ts __tests__/redraft/lineup-lock-engine.test.ts __tests__/waiver-settings-service.test.ts __tests__/redraft/waiver-scoring.test.ts __tests__/league-trade-engine-validation.test.ts __tests__/redraft/trade-veto-route.test.ts __tests__/playoff-defaults-by-sport.test.ts __tests__/draft/timer-presets.test.ts __tests__/draft/slice3-soft-timer-and-pause-resume.test.ts __tests__/league-ai-settings-resolver.test.ts

Test Files  12 passed (12)
Tests       150 passed (150)
```

Coverage represented:

- Scoring settings contract.
- Roster settings and lineup validation.
- Lineup lock behavior.
- Waiver settings resolver and Redraft waiver scoring.
- Generic league trade validation and Redraft veto route behavior.
- Playoff defaults by sport.
- Draft timer and pause/resume behavior.
- League AI settings resolver.

Remaining coverage gaps:

- Native Redraft trade proposal creation does not have a focused test proving it consumes league-level review/deadline/veto settings.
- Draft pick trading routes do not have a focused test proving `League.draftPickTrading = false` blocks draft pick trades.
- AI feature routes do not have route-level tests proving disabled commissioner AI toggles block each feature.

## Readiness Recommendation

Do not increase readiness from G15.

- NFL Engine remains 93%.
- Overall Platform remains 90%.

Reason: this audit improves trust and identifies enforcement gaps, but no customer-visible settings behavior was changed. A readiness increase should wait until the high-severity trade, draft-pick-trading, and AI-toggle enforcement gaps are fixed and tested.
