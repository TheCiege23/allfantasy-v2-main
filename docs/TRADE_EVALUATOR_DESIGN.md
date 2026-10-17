# AllFantasy Trade Evaluator — Design

Sep 26, 2026 · Guap

> **For Claude Code:** this is the design referenced in the build prompts. Where it and the code disagree, the code wins and the difference should be flagged. Key decisions already made:
> - The engine lives in `lib/decision-os/trade/`, and `scripts/check-decision-engine-boundary.mjs` must keep passing.
> - The evaluation receipt reuses the existing `TradeDecisionSnapshot` table (`trade_decision_snapshots`). Do **not** add a new `trade_evaluations` table unless `TradeDecisionSnapshot` truly can't hold a field; if so, propose a column, not a table.
> - Never price an unknown player with a fallback value. Refuse to grade instead.

## Goal and principles

The evaluator tells a manager whether a trade helps them, and why, in under five seconds. Every number can be traced to AllFantasy data. It is the core that Trade OS screens, Chimmy and the nightly trade agent all call.

- **Code does the math, the AI explains it.** A deterministic engine produces every number. The AI never invents a player value, projection or stat, and never produces its own verdict.
- **Grounded in the league.** Values reflect this league's scoring, roster slots, format (redraft, dynasty, devy) and each team's actual lineup.
- **Explain, don't decree.** Output is advisory: a verdict, the reasons, the risks and a counter idea. No odds, locks or betting language.
- **Same trade, same answer.** Engine output is deterministic and stored as a receipt, so every surface shows the same grade.
- **Commissioners get their own lens.** A review mode flags lopsided or suspicious trades, but the app never auto-vetoes.
- **Launch scope:** NFL redraft first, then NCAAF redraft, matching the beta priority. Dynasty, devy and pick values come after.

## How it connects: Decision OS, Trade OS, Chimmy

| Layer | Role | Where in the repo |
| --- | --- | --- |
| Decision OS | Owns every verdict (trade, waiver, lineup). CI blocks verdicts anywhere else | `lib/decision-os/` |
| Trade engine | This evaluator: one grade, one decision, one receipt | `lib/decision-os/trade/` |
| Trade OS | Trade surfaces: builder, inbox, pending offers, trades panel, emails, commissioner review | `app/api/league/trades-panel`, `lib/trade-value-console`, `lib/provider-trades` |
| Chimmy | Explains the engine's receipt in chat; never grades on its own | `lib/chimmy-trade/describedTradeEvaluator.ts`, `lib/chimmy/tradeScenarioGrounding.ts`, `lib/chimmy-trade/pendingTradeDecisionGrounding.ts` |

**The receipt is the connector.** `docs/TRADE_OS_AUDIT_2026-09-26.md` calls for one versioned evaluation receipt shared by the builder, inbox, Chimmy, notifications, email and share/export. Every surface reads the receipt by id, so a grade shown in chat, in an email and on the trade screen is always the same grade. A new evaluation creates a new receipt; old receipts are never rewritten.

## Request flow

1. **Request** arrives from a Trade OS screen, Chimmy's `evaluate_trade` tool, or the nightly trade agent.
2. **Cache check** on a hash of the trade plus the current data version. Every in-season sync bumps the version.
3. **Load context:** league settings, both rosters, current values, injuries and remaining schedule.
4. **Engine** (`evaluateTrade()` in `lib/decision-os/trade/`, pure TypeScript, no network calls) returns every number the verdict needs.
5. **AI explanation** receives only the engine packet and returns structured JSON.
6. **Validate:** schema check, plus a check that every number the AI cites exists in the packet. On failure, return the engine result with a plain template explanation.
7. **Store the receipt** in `TradeDecisionSnapshot` and return it.

## Inputs

A trade is two sides of assets plus whose point of view to evaluate from.

```typescript
type Asset =
  | { kind: "player"; playerId: string }
  | { kind: "pick"; season: number; round: number; originalTeamId: string } // dynasty only
  | { kind: "faab"; amount: number };

interface TradeEvaluationRequest {
  leagueId: string;
  tradeId?: string;                 // existing trade; omit for a "what if" trade
  sideA: { teamId: string; gives: Asset[] };
  sideB: { teamId: string; gives: Asset[] };
  perspectiveTeamId?: string;       // whose verdict; omit for a neutral read
  mode: "manager" | "commissioner";
  requestedBy: string;              // user id, for limits and billing
  source: "trade_screen" | "chimmy" | "trade_agent" | "notification";
}
```

| Field | Rule |
| --- | --- |
| Assets | Must be on the giving team's roster right now; reject otherwise |
| Sides | 1 to 6 assets each; both sides non-empty |
| perspectiveTeamId | Must be sideA or sideB; required in manager mode |
| mode commissioner | Caller must be the league's commissioner or co-commissioner |
| Picks | Rejected in redraft leagues |

## Imported vs native trades

Every trade, native or imported, becomes one normalized `Trade` with an `origin`. The engine never looks at origin: the math is the same everywhere. Origin changes only roster freshness, available actions, where status comes from, and the wording the AI uses.

```typescript
type Platform = "native" | "sleeper" | "espn" | "yahoo" | "mfl" | "fantrax" | "fleaflicker";

interface TradeOrigin {
  platform: Platform;
  externalLeagueId?: string;
  externalTradeId?: string;
  deepLink?: string;           // where the user responds on that platform
  rostersSyncedAt: string;     // ISO time both rosters were last synced
}

interface Trade {
  id: string;
  leagueId: string;
  origin: TradeOrigin;
  status: "proposed" | "accepted" | "rejected" | "vetoed" | "expired" | "completed";
  sideA: { teamId: string; gives: Asset[] };
  sideB: { teamId: string; gives: Asset[] };
  proposedAt?: string;
  completedAt?: string;
}
```

No new trade tables. A thin `loadTrade()` reads the existing ones and returns a `Trade`:

| Origin | Existing tables / code | Pending trades today |
| --- | --- | --- |
| Native | `AfLeagueTrade` + Item, StatusHistory, Vote | Yes |
| Native redraft | `RedraftTradeProposal`, `RedraftTradeAsset` | Yes |
| Sleeper | `LeagueTrade`, `LeagueTradeHistory`; `scanPendingSleeperTrades.ts` | Yes (read-only) |
| Yahoo | `LeagueTrade`; `scanPendingYahooTrades.ts` (built and tested) | Blocked until Yahoo API approval |
| ESPN, MFL, Fantrax, Fleaflicker | `LeagueTrade` (completed history) | No; user builds the trade in AllFantasy |
| League Tycoon | None: no API, importer blocked | No |

Player ids resolve through the shared `PlayerIdentityMap`. Yahoo has no id column yet and falls back to name matching; add `yahooId` together with its backfill once Yahoo API approval arrives. If any asset fails to resolve to exactly one player, return "can't evaluate yet" instead of guessing.

| Concern | Native | Imported |
| --- | --- | --- |
| Roster freshness | Always current | Refresh both rosters if older than 10 minutes, else lower confidence |
| User actions | Accept, decline, counter in AllFantasy | Read-only; link out to the platform |
| Commissioner veto | In AllFantasy | Review shown in AllFantasy; veto on the platform |
| Status | Set by AllFantasy | Read from each sync; re-evaluate on change |
| Trade rules | AllFantasy league settings | Imported where exposed; skip deadline flags if unknown |
| Counter suggestion | One tap to send | "Send this in Sleeper" plus the link |

Deep links: Sleeper `sleeper.com/leagues/{id}`, Fantrax `fantrax.com/fantasy/league/{id}/home` (no trade-specific Fantrax page confirmed). Other platforms show "open your league app".

AI packet additions: `origin.platform`, `rostersSyncedAt`, `actionsAvailable`. For imported trades, say where to act and never imply AllFantasy can accept or veto. When rosters are stale, confidence is medium at most.

## Value engine

The engine answers two questions separately: is the trade fair on paper (asset value), and does it improve each team's starting lineup (lineup impact).

Per the Trade OS audit, keep these visibly separate: **market price**, **league-adjusted value**, **team benefit** (legal lineup after required drops), and **observed result** (never used to rewrite a past grade).

### 1. Rest-of-season points (redraft)

Projected points under this league's scoring, counting only games the player is expected to play. Fantasy playoff weeks count 1.5x.

```
ROS_p = Σ over remaining weeks w of  proj(p,w) × avail(p,w) × m_w,   m_w = 1.5 in playoff weeks, else 1
```

Sources: Rolling Insights has no projection endpoints. NFL weekly projections come from `FantasyProjection` (Sleeper feed, full stat lines), re-scored with league settings; missing weeks fall back to `AFProjectionSnapshot`. NCAAF uses the season-long AF projection spread over weeks remaining. Bye weeks set availability to 0.

### 2. Injury availability (starting weights; tune later)

| Status | This week | Later weeks |
| --- | --- | --- |
| Active | 1.0 | 1.0 |
| Questionable | 0.75 | 1.0 |
| Doubtful | 0.25 | 1.0 |
| Out | 0 | 1.0 after listed return, else 0.9 next week |
| IR / PUP | 0 until eligible return week | 1.0 after |

An injured incoming player does not fill a roster hole.

### 3. Value over replacement

Replacement level = best projected free agent at that position in this league.

```
VORP_p = max(0, ROS_p − ROS_replacement(position))
```

### 4. Blend with market value

NFL blends in FantasyCalc market value (via `PlayerValueSnapshot`), both normalized 0–100 within the league's pool:

```
Value_p = 0.7 × VORP_norm + 0.3 × Market_norm
```

NCAAF has no market source: college redraft uses pure VORP (CFBD stats and AF projections). For devy, AllFantasy builds its own market value by converting college players to NFL-equivalent value, starting from the existing devy classification links and `devyMarketBridge` rate.

### 5. Package value and roster cost

Do not add an extra consolidation premium on top of market prices that already reflect packages (see audit). Instead, compute the legal lineup after required drops: if a receiving roster is full, subtract the value of the players it must drop. A depth discount (0.85 per additional asset) applies only to the VORP component, not to market prices.

### 6. Lineup impact

Solve the optimal starting lineup week by week, before and after the trade, for each team. Lineup impact = average change in projected starting points per remaining week. Fill required slots greedily, then flex slots.

### 7. Fairness and grades

```
Gap = (Package_A→B − Package_B→A) / max(Package_A→B, Package_B→A)
```

| Gap (absolute) | Label |
| --- | --- |
| Under 10% | Fair |
| 10–25% | Leans one side |
| 25–40% | Lopsided |
| Over 40% | Heavily lopsided (commissioner flag) |

Each side's letter grade weights lineup impact 60% and package value 40%. A team can "lose" on paper and still get an A because the trade fixes its weakest starter.

### Engine output

```typescript
interface EngineResult {
  dataVersion: string;
  sides: {
    teamId: string;
    receives: { assetId: string; name: string; pos: string; value: number;
                rosPoints: number; injuryStatus?: string; byeInPlayoffs: boolean }[];
    packageReceived: number;
    lineupDeltaPerWeek: number;
    forcedDrops: { name: string; value: number }[];
    grade: "A" | "B" | "C" | "D" | "F";
    positionalNeedsBefore: string[];
    positionalNeedsAfter: string[];
  }[];
  gapPct: number;
  fairnessLabel: "fair" | "leans" | "lopsided" | "heavily_lopsided";
  refused?: { reason: string; missingAssets: string[] }; // set instead of grading when prices are missing
}
```

## AI explanation layer

The AI gets the engine result, not raw data, and returns strict JSON. One call per evaluation, no tools.

Rules:
1. Use only numbers in the packet. Never state a projection, stat, value or injury detail that isn't in it.
2. Lead with lineup impact for the perspective team, then asset value.
3. Give 2 to 4 reasons, each tied to a packet field.
4. Always name at least one risk (injury, playoff bye, forced drop, thin depth).
5. Suggest a counter only when the gap is 10% or more, using assets already on the rosters.
6. Advisory voice. No odds, locks, guarantees or betting terms.
7. Plain language; headline 280 characters max.

```typescript
interface TradeVerdict {
  verdict: "accept" | "decline" | "counter" | "fair_either_way";
  headline: string;
  grades: { teamId: string; grade: "A" | "B" | "C" | "D" | "F" }[]; // copied from engine
  reasons: { text: string; evidence: string[] }[];                   // packet field paths
  risks: string[];
  counter?: { add: string[]; remove: string[]; why: string };
  confidence: "high" | "medium" | "low";
  commissioner?: CommissionerReview;
}
```

Validation before returning: schema valid; grades equal the engine's exactly; every evidence path and counter asset exists; every number in the text matches a packet value. On failure, retry once, then fall back to a template.

The existing AI paths (`dual-brain-trade-analyzer.ts`, the trade-analyzer AI service, `trade-evaluator-prompt.ts`) must be changed to this pattern: receive the engine packet and explain it.

## Commissioner review mode

| Flag | Trigger | Severity |
| --- | --- | --- |
| Heavily lopsided | Gap over 40% | High |
| Tanking signal | Strongly negative lineup impact while receiving mostly bench value | High |
| Repeat partners | Same two teams traded 3+ times this season, all leaning one way | Medium |
| Inactive manager | League Health Tracker shows one side inactive 14+ days | Medium |
| Eliminated team dumping | Eliminated team sends starters to a contender | Medium |
| Deadline rush | Within 48 hours of the deadline and gap over 25% | Low |

Flags are computed in code; the AI only writes the explanation.

```typescript
interface CommissionerReview {
  flags: { code: string; severity: "low" | "medium" | "high"; explanation: string }[];
  recommendation: "approve" | "review_with_managers" | "consider_veto";
  noteToLeague?: string;
}
```

Workflow: trade proposed → review generated → commissioner approves, messages managers, or vetoes → decision logged.

## Chimmy tool: evaluate_trade

Chimmy resolves names with `search_players`, then calls this tool, which calls the same `evaluateTrade()`. The backend fills in the user's team and perspective from the session. The result includes the receipt id so Chimmy's reply can link to the full breakdown in Trade OS.

```json
{
  "name": "evaluate_trade",
  "description": "Evaluate a proposed fantasy trade in the user's league. Returns fairness, each team's lineup impact in projected points per week, grades, reasons, risks, an optional counter and a receipt id. Use whenever the user asks whether to accept, offer or counter a trade. Player ids must come from search_players.",
  "input_schema": {
    "type": "object",
    "properties": {
      "league_id": { "type": "string" },
      "user_team_gives": { "type": "array", "items": { "type": "string" } },
      "other_team_id": { "type": "string" },
      "other_team_gives": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["league_id", "user_team_gives", "other_team_id", "other_team_gives"]
  }
}
```

## Storage, caching, cost and monetization

- **Receipt:** `TradeDecisionSnapshot` (append-only). Today it only receives native trades; extend it to imported and "what if" trades. Needed fields: league, requester, source, mode, input hash, data version, engine result, verdict, model, token counts, latency. Add columns only where missing.
- **Caching:** the same trade within the same data version returns the stored receipt without an AI call.
- **Cost control:** cache the fixed system prompt, send a compact packet, cap output tokens, and log tokens per call.
- **Launch with a free and a paid tier:**

| Tier | Evaluations | Extras |
| --- | --- | --- |
| Free | 3 per week | Grades and fairness only |
| Subscriber | Unlimited | Full reasons, risks, counters |
| Tokens | 1 token each beyond limits | Deep analysis with the largest model |
| Commissioner | Unlimited reviews in leagues they run | League notes, trade history |

## Existing code to reuse or retire

**Keep as the engine:** `lib/decision-os/trade/`. Merge `leagueTradeGrader` (league-priced value and grade) and `canonicalEvaluator` (decision plus lineup impact) behind one `evaluateTrade()`. `lib/league-trade-engine/serverTradeDecision.ts` already combines them and is the template.

- **Delete:** `lib/trade-engine/core-engine.ts`, `pipeline.ts`, `simulation.ts` (no importers).
- **Shrink:** `trade-engine.ts` to an input provider for lineup change and accept probability; remove its verdict.
- **Repoint at `evaluateTrade()`:** `/api/trade-evaluator`, the legacy `trade/analyze` route, `calculateTradeBalance` in `lib/fantasycalc.ts` (remove `UNKNOWN_PLAYER_VALUE = 200`), `lib/trade-value/grader.ts`, `lib/projections/tradeGrading.ts`. Remove or re-export the verdict-named exports so the boundary check passes, and add each repointed surface to `__tests__/trade-value/one-grade-surfaces.test.ts`.
- **Keep as helpers:** `lib/trade-value/valueEngine.ts`, `leagueTradeValue.ts`, the FantasyCalc data functions.

New work none of them do yet: forced drops, roster capacity, multi-week lineup impact, playoff-week weighting.

## Testing

**Engine unit tests:** lineup solver with flex and superflex slots, replacement level per position, injury availability, playoff byes, forced drops on full rosters, refusal when a price is missing.

**Golden trades** (from one of Guap's real leagues, frozen as a fixture):

| Case | Expected |
| --- | --- |
| Star RB for a bench WR | Heavily lopsided, decline, commissioner flag |
| Even swap, same position | Fair, fair_either_way |
| 2-for-1 consolidation | Forced drop counted; star receiver wins on lineup impact |
| Star who is Out for 3 weeks | Low availability now, risk named, confidence not high |
| Player on bye in the fantasy semifinal | Playoff bye risk named |
| Fair on paper but fills a hole | Positive lineup impact, grade A for the needy team |
| Trade with an inactive manager | Inactive flag in commissioner mode |
| Unpriceable player in the trade | Refused, missing asset named |

**AI output checks** on every golden trade before each deploy: schema valid, grades match, cited numbers exist, no betting language, counter uses only rostered assets.

## Build order

1. **Consolidate the engine** in `lib/decision-os/trade/` (see "Existing code").
2. **Receipt and route:** `evaluateTrade()` writes to `TradeDecisionSnapshot`; add `loadTrade()` over existing trade tables, native first, then Sleeper pending.
3. **New engine math:** forced drops, multi-week lineup impact, playoff weighting.
4. **AI explanation layer:** prompt, schema, validation, fallback; convert existing AI paths.
5. **Trade OS screens** read the receipt.
6. **Commissioner review mode.**
7. **Chimmy `evaluate_trade` tool.**
8. **NCAAF redraft**, then dynasty, devy and picks.
9. **Nightly trade agent** proposing trades that grade B or better for both sides.

## Decisions

| Question | Decision |
| --- | --- |
| Projections | `FantasyProjection` (weekly NFL) with `AFProjectionSnapshot` fallback; NCAAF season-long |
| NCAAF market values | CFBD-based; where missing, AllFantasy converts college players to NFL-equivalent value |
| Starting weights | 0.7 blend, 0.85 depth, 60/40 grade for v1; tune by replaying completed trades from `LeagueTradeHistory` |
| Where trades live | Both native and imported |
| Launch limits | Free and paid tiers |
| Pending trades | Sleeper only today; Yahoo code ready, waiting on API approval |
| Deep links | Sleeper; Fantrax league home |
| Player ids | `PlayerIdentityMap`; add `yahooId` after Yahoo approval |
