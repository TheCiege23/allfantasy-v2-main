# Decision OS — Phase 2 Canonical League Bridge Architecture

**Status:** Design audit — *no implementation*. This is the canonical design document that must
be approved before any `manager.lineup.set` / `manager.trade.evaluate` canonical-bridge code is
written.

**Scope:** Determine the provider-agnostic architecture that lets imported canonical leagues
(Sleeper today; ESPN/Yahoo/Fantrax/MFL/CBS/Fleaflicker tomorrow) satisfy the Decision OS contracts
currently served only for redraft-native leagues.

**Hard rules honored by this document:** no code, no adapters, no Decision OS changes, no bridge
implementation, no slice redesign, no cutover. Audit + plan only.

> **Companion docs:** [`DECISION_REGISTRY.md`](./DECISION_REGISTRY.md) (the append-only decision map)
> and the per-slice modules under `lib/decision-os/{lineup,waiver,trade,commissioner-health}`.

---

## 0. The single most important finding (read this first)

**The Decision OS core is already provider-agnostic. The redraft coupling lives entirely in the
per-slice loaders.**

For every shipped slice the pipeline is:

```
World Resolution  →  DCO  →  Rule Framework  →  Decision Object  →  Parity  →  Telemetry
   (pure)            (pure)      (pure)            (pure)           (pure)     (pure)
        ▲
        │  the ONLY coupling point
   route-seam loader  ←──  reads prisma (redraft-native tables)
```

- `resolveLineupWorld`, `buildLineupDCO`, `resolveTradeWorld`, `buildTradeDCO`, the rule frameworks,
  the decision builders, and the parity comparators **never import prisma** and **never name a
  provider or a redraft table**. They consume neutral input shapes (`LineupWorldInput`,
  `TradeWorldInput`, `RunLineupSetInput`, `RunTradeEvaluateInput`).
- The redraft dependency is concentrated in **two files**: `lib/decision-os/lineup/loader.ts` and
  `lib/decision-os/trade/loader.ts`, plus the trade evaluation *memo* source
  (`RedraftTradeValueSnapshot`).

**Consequence for the whole plan:** Phase 2 is **not a Decision OS rewrite**. It is a rewrite of the
loader/seam layer plus a new shared *Canonical World Assembly*. This single fact changes the
migration calculus and is the backbone of the recommendation in §10.

---

## 1. Current loader dependency map

### 1.1 `manager.lineup.set`

Traced through `lib/decision-os/lineup/{loader,world,dco,index}.ts` and
`app/api/today/lineup-actions/route.ts`.

**Required inputs** (`RunLineupSetInput`): `sport`, `leagueSettings` (opaque `unknown`),
`leagueWeek`, `editingWeek`, `userId`, `leagueId`, `rosterId`, `players: RedraftLineupPlayer[]`.

**Optional inputs:** `proposed`, `projectionConfidence`, `scanIncomplete`.

**World Resolution** (`resolveLineupWorld`) — *provider-agnostic already*:
- `resolveRedraftRosterConfig(sport, settings)` → starter/bench/IR/taxi capacities (reads the opaque
  settings blob; "redraft" is a naming artifact, not a coupling — it is pure config interpretation).
- `evaluateLineupLock({sport, now, leagueWeek, editingWeek})` → neutral `lock_state` fact. Sport
  timing stays *inside* the adapter; the core only reads `locked/policy/reason/provenance`.

**Redraft dependencies (the coupling — all in `loader.ts`):**

| Source | What it provides | Canonical? |
|---|---|---|
| `resolveRedraftRosterLookup({userId, leagueId})` | identity → `{season, roster}` | **No** — assumes a `RedraftRoster`/`RedraftSeason` exists |
| `prisma.redraftRoster.findFirst({include:{players, season}})` | slot-typed players + season week | **No** — `RedraftRosterPlayer[]` rows |
| `prisma.league.findUnique({settings})` | opaque settings blob | **Yes** — `League` is shared |
| `loadCanonicalValidatorContext` → `prisma.league.findUnique(full row)` + `getRosterTemplateForLeague` | second (canonical) validator context | **Yes** — already reads canonical `League` |

**Assumptions baked in:**
1. The user's roster is a `RedraftRoster` row (keyed `seasonId` + `ownerId`).
2. Players arrive as structured `RedraftRosterPlayer` rows with `slotType`, `injuryStatus`,
   `byeWeek` — **not** the canonical `Roster.playerData` JSON blob.
3. The week comes from `RedraftSeason.currentWeek`.

**Hidden coupling (RESOLVED — was critical):** `resolveRedraftRosterLookup` is **not read-only**;
under safe conditions it performs `prisma.redraftRoster.update(...)` ("owner repair"). That resolver
still exists and still writes, deliberately, for the legacy routes that depend on the repair.

What changed: the identity logic was split. `resolveRedraftRosterLookupCore` does the lookup, and two
thin wrappers sit on top of it — `resolveRedraftRosterLookupReadOnly` (returns the core result and
stops) and `resolveRedraftRosterLookup` (core, then applies `maybeRepairRedraftRosterOwner`). The
lineup loader imports the **ReadOnly** wrapper, so the shadow's read-only guarantee no longer leaks.
See §9.

**Note — the lineup slice already has a canonical leg.** The *second* validator
(`loadCanonicalValidatorContext` → `validateCanonicalRosterPayload`) reads the canonical `League`
row and a format-resolved template, and converts Decision OS players into the canonical
`Roster.playerData` *sections* shape (`toCanonicalPlayerData` in `canonicalAdapter.ts`). The canonical
validation contract is already exercised — only the *primary* roster source is redraft-bound.

### 1.2 `manager.trade.evaluate`

Traced through `lib/decision-os/trade/{loader,world,dco,index}.ts` and
`app/api/redraft/trade-proposals/route.ts`.

**Required inputs** (`RunTradeEvaluateInput`): `worldInput` (settings + season week + per-roster
facts), `userId`, `leagueId`, `sport`, `proposal` context, `assets: TradeAssetSummary[]`,
`snapshotConfidenceScore`. The deterministic value verdict itself is **passed in** as a
`TradeValueSnapshot` (the evaluation memo).

**World Resolution** (`resolveTradeWorld`) — *provider-agnostic already*: two-sided/multi-team
neutral world (settings, deadline approximation, `participants[]`, `snapshotAvailable`).

**Redraft dependencies (the coupling):**

| Source | What it provides | Canonical? |
|---|---|---|
| `prisma.league.findUnique({sport, tradeReviewHours, tradeDeadlineWeek, draftPickTrading})` | trade settings | **Yes** — `League` is shared |
| `prisma.redraftSeason.findFirst({currentWeek, season})` | season week | **No** |
| `prisma.redraftRoster.findFirst({faabBalance, wins, losses, ties, pointsFor, playoffSeed})` | per-roster resource/standings | **No** |
| `RedraftTradeValueSnapshot.payload` (the memo) | **the deterministic grade itself** | **No** — captured only by `captureRedraftTradeValueSnapshot`, FK → `RedraftTradeProposal` → `RedraftRoster` |
| `RedraftTradeAsset` rows | the asset graph (from/to/playerId/faab) | **No** |

**Assumptions baked in:**
1. Rosters are `RedraftRoster` (FAAB = `faabBalance`, standings on the roster row).
2. Season week comes from `RedraftSeason`.
3. **A deterministic evaluation memo already exists** as a persisted `RedraftTradeValueSnapshot`. This
   is the deepest assumption: the trade slice is *wrap-fidelity over a memo that only the redraft trade
   workflow produces.* Imported leagues have **no equivalent** — `AfLeagueTrade` (canonical) carries
   no value snapshot.

**Why trade is harder than lineup:** Lineup's blocker is purely *data shape* (slot-typed players vs.
JSON blob). Trade's blocker is *data shape **plus** a missing computation*: there is no canonical
trade evaluation memo. Bridging the roster is necessary but **not sufficient** — the bridge must also
supply (or honestly degrade) the evaluation source.

---

## 2. Canonical model analysis

Two parallel data universes share **one** `League` row. The divergence is at the team/roster/season
level.

| Concern | Canonical / Import universe | Redraft-native universe | Used by which slice |
|---|---|---|---|
| League config | **`League`** (all settings; shared) | **`League`** (shared) | all |
| Teams / standings | `LeagueTeam` (wins/losses/ties, PF/PA, rank, `claimedByUserId`/`platformUserId`) | `RedraftRoster` (wins/losses/ties, PF/PA, `playoffSeed`) | health ← canonical · trade ← redraft |
| Roster contents | `Roster.playerData` (**JSON blob**) | `RedraftRosterPlayer[]` (**structured rows:** `slotType`, `injuryStatus`, `byeWeek`) | waiver ← canonical · lineup ← redraft |
| FAAB | `Roster.faabRemaining` | `RedraftRoster.faabBalance` | waiver ← canonical · trade ← redraft |
| Waiver priority | `Roster.waiverPriority` | `RedraftRoster.waiverPriority` | waiver ← canonical |
| Season / week | `League.season` (+ provider sync state) | `RedraftSeason.currentWeek/totalWeeks/playoffStartWeek` | lineup/trade ← redraft |
| Per-week scoring | `TeamPerformance` (per `LeagueTeam`) | `RedraftMatchup` / `WeeklyScore` | health ← canonical |
| Trades | `AfLeagueTrade` (FK → `Roster`) — **no value memo** | `RedraftTradeProposal` + `RedraftTradeAsset` + `RedraftTradeValueSnapshot` (FK → `RedraftRoster`) | trade ← redraft memo |
| Waiver claims | `WaiverClaim` (FK → `Roster`) | `RedraftWaiverClaim` (FK → `RedraftRoster`) | — |
| Import provenance | `ImportRun`, `ExternalEntityMapping`, `ImportWarning`, `ImportReviewTask` | — | — |

**Population reality (verified):**
- Canonical `Roster`/`League`/`LeagueTeam` are populated at **league creation *and* import**
  (`SleeperLeagueCreationBootstrapService`, `league/invite/claim`, import commit). **Every league has
  them.**
- `RedraftRoster`/`RedraftSeason` are the **redraft gameplay-engine projection**, created when a draft
  is finalized (`finalizeDraftToRedraftSeason` *reads* canonical `Roster` for identity, then *writes*
  `RedraftRoster`). **Only leagues running the AF redraft engine have them.**

**Therefore:** the canonical substrate (`League` + `LeagueTeam` + `Roster` + `TeamPerformance`) is the
**universal** layer; `RedraftRoster`/`RedraftSeason` is **one engine's projection** of it. An imported
league that has not been converted to a redraft season has the canonical substrate but no redraft
projection — exactly the leagues where lineup/trade fail today.

### 2.1 Is the canonical substrate sufficient for Decision OS?

| Decision | Canonical substrate sufficiency | Gap |
|---|---|---|
| `commissioner.league.health` | **Sufficient** (already canonical-sourced via `monitorLeagueHealth` over assembled metrics) | none |
| `manager.waiver.claim` | **Sufficient** (`Roster.playerData` + `faabRemaining` + `waiverPriority` + settings) | none |
| `manager.lineup.set` | **Mostly sufficient** | `Roster.playerData` is a JSON blob, not slot-typed rows. Need a **canonical lineup projection** (parse blob → slot/IR/taxi/injury/bye). The canonical validator already parses this shape via `getNormalizedLineupSections` — the parser exists. Week must come from a canonical season/week source, not `RedraftSeason`. |
| `manager.trade.evaluate` | **Insufficient on its own** | (a) standings/FAAB are on `LeagueTeam`/`Roster` not `RedraftRoster` — solvable mapping; (b) **no canonical evaluation memo** — `buildTradeValueSnapshot` would have to run against canonical roster values, or the decision honestly degrades to `unsupported` (mirroring the 3+ team pattern). |

**Missing, precisely:**
1. A **canonical lineup projection** (`Roster.playerData` JSON → slot-typed player facts) — the parser
   already exists (`getNormalizedLineupSections` / `LineupTemplateValidation`).
2. A **canonical season/week** source independent of `RedraftSeason` (provider sync carries current
   week; needs a single read path).
3. A **canonical trade evaluation memo** — either run `buildTradeValueSnapshot` over canonical roster
   values, or degrade honestly. (Design choice in §4 / §10.)

---

## 3. Architecture comparison matrix

Three approaches evaluated against the brief, plus the recommended refinement.

| Dimension | **A — Bridge → existing redraft loader** | **B — Provider-agnostic loaders over one World Resolution** | **C — Hybrid: shared substrate + per-decision assemblers** |
|---|---|---|---|
| Shape | imported league → synthesize `RedraftRoster`-shaped input → feed existing loader | rewrite loaders to read a single canonical World Resolution; adapters feed it | shared **Canonical World Assembly** (entities) → small provider adapters → **per-decision** World assemblers (today's loaders, rewritten) |
| Decision OS core changes | none | none | none |
| Loader changes | wrap only | full rewrite into one resolver | rewrite seam loaders to read the substrate |
| New shared layer | none | one monolithic resolver | one **entity** substrate + thin adapters |
| Treats canonical data as | second-class (forced through redraft schema) | first-class | **first-class** |
| Provider count couples to | **redraft gameplay schema** (must synth `RedraftRoster`/`RedraftSeason` per provider) | the one resolver's shape | a thin per-provider adapter (no redraft schema) |
| Per-decision fidelity | high (reuses tuned loader) but redraft-bound | risk of god-object: 4 different World shapes collapsed into 1 | **high** — each decision keeps its own World shape |
| Native + imported unification | no — perpetuates two universes | yes | **yes** |
| Trade memo problem | inherited (still redraft-only) | must be solved in the resolver | solved in the **trade assembler** (canonical evaluate OR honest degrade) |
| Maintenance cost (5 yr) | **High** — every provider re-touches redraft schema; two universes forever | Medium — one resolver becomes a contention point | **Low** — substrate stable; change isolated to one adapter or one assembler |
| Migration effort | Low up front, **High** lifetime | High | **Medium**, phased, shadow-safe |
| Risk of regressing shipped slices | Medium (redraft path reshaped) | High (one big resolver swap) | **Low** (additive substrate; loaders swap one at a time behind flags) |
| 5-year fit | ✗ | partial | ✓ |

**Why not A:** It makes the *redraft gameplay schema* the lingua franca for every provider. Each new
provider (ESPN, Yahoo, …) would have to synthesize `RedraftRoster`/`RedraftSeason` shims for leagues
that never run the redraft engine. That is exactly the coupling we are trying to remove, re-introduced
at the adapter layer. It also leaves two universes permanently.

**Why not pure B:** The four decisions genuinely need *different* worlds — lineup needs slot-typed
players + lock timing; trade needs an evaluation memo + standings; waiver needs FAAB + settings;
commissioner needs aggregate league metrics. A single canonical World Resolution that serves all four
becomes a god-object and a change-contention point. B is correct in spirit (canonical source, hidden
origin) but wrong in granularity.

**Why C:** C is the *honest description of what already exists, evolved*. Today: per-decision World +
DCO (provider-agnostic) sit behind per-decision loaders (the assemblers). C keeps that boundary and
inserts a **shared Canonical World Assembly** (entity reads) beneath the per-decision assemblers, fed
by thin provider adapters. It is additive, shadow-safe, and isolates change.

---

## 4. Recommended architecture (the target)

```
                         ┌─────────────────────────────────────────────┐
                         │            DECISION OS  (unchanged)          │
                         │   World → DCO → Rules → Decision → Parity     │
                         └───────────────▲─────────────────────────────┘
                                         │  neutral per-decision input
              ┌──────────────────────────┴──────────────────────────┐
              │   Per-decision World ASSEMBLERS (today's loaders,     │
              │   rewritten — one per decision; provider-blind)       │
              │   lineupAssembler · tradeAssembler · waiverAssembler  │
              │   · commissionerHealthAssembler                       │
              └──────────────────────────▲──────────────────────────┘
                                         │  reads canonical entities only
              ┌──────────────────────────┴──────────────────────────┐
              │        CANONICAL WORLD ASSEMBLY  (new, shared)        │
              │  League · LeagueTeam · Roster(playerData) ·           │
              │  TeamPerformance · season/week · settings · FAAB ·    │
              │  identity · freshness/trust  — ORIGIN-BLIND output    │
              └──────────────────────────▲──────────────────────────┘
                                         │  fills the substrate
        ┌────────────────────────────────┼────────────────────────────────┐
        │            │             │             │              │           │
   Sleeper      ESPN adapter   Yahoo …   Native AF redraft   MFL …    future
   adapter                                engine adapter
   (import)                               (gameplay projection)
```

Key properties:
1. **Decision OS is untouched.** The four slices keep their World/DCO/rules/decision/parity exactly.
2. **One shared substrate read** (`Canonical World Assembly`) produces origin-blind entity facts.
3. **Per-decision assemblers** (the rewritten loaders) project the substrate into each decision's
   neutral input shape. Each decision keeps its own World shape — no god-object.
4. **Provider adapters are thin and below the substrate.** They translate provider/native data *into*
   the canonical entities; they never reach into Decision OS.
5. **The native AF redraft engine becomes one adapter**, not the source of truth (see §7).

---

## 5. World Resolution design

### 5.1 Should World Resolution be the single source of truth?

**Yes — for all four decisions, the per-decision World (assembled from the shared substrate) is the
*only* thing the decision consumes.** This is already true in the code: the decision builders read the
DCO, the DCO reads the World, and nothing reaches around them to prisma. Phase 2 preserves this and
makes the substrate beneath the World canonical.

### 5.2 Should Decision OS know the data's origin (import vs native vs future sync)?

**No. World Resolution must completely hide origin. Decision OS must never branch on provider or on
import-vs-native.**

This is the load-bearing design rule. The justification is already encoded in the core contract:
- The Decision Object carries `DecisionProvenance { weakest_source, weakest_trust }` and an
  `uncertainty: string[]` channel, plus `data_completeness`.
- **Origin leaks only as a *trust / freshness* signal, never as a branch.** A stale Sleeper sync, a
  freshly imported league, or a live native league differ only in *how confident* the world is —
  expressed as `weakest_trust` (`high`/`medium`/`low`/`unverified`) and `uncertainty[]` strings, which
  the existing slices already populate (e.g., trade's "snapshot input completeness", lineup's
  "ET-based approximation").

So the substrate computes a **freshness/trust** for each fact (e.g., "roster synced 4h ago" →
`medium`), and the per-decision assembler folds it into provenance. Decision OS sees a number and a
trust level — never the word "Sleeper".

**The one allowed exception is telemetry.** The debug telemetry store already carries `userId`/
`leagueId` flags; origin (`provider`, `source: import|native`) should travel as a **telemetry flag for
debuggability**, *not* as a decision input. This lets the telemetry viewer filter "imported-league
shadow events" without any decision logic ever reading it. (Origin-in-telemetry, never
origin-in-decision.)

### 5.3 Substrate output contract (conceptual — not a schema)

The Canonical World Assembly returns, per league/user, origin-blind facts:
- **League facts:** sport, settings snapshot, scoring known?, lifecycle, IR/taxi flags, trade/waiver
  settings, current season + week.
- **Identity facts:** resolved roster identity (user → team → roster) — the *read-only* successor to
  `resolveRedraftRosterLookup` (see §9, the write must be extracted).
- **Roster facts:** slot-typed player projection (parsed from `Roster.playerData` via the existing
  `getNormalizedLineupSections`), FAAB remaining, waiver priority, roster size.
- **Standings facts:** wins/losses/ties, PF/PA, rank/seed (from `LeagueTeam`/`TeamPerformance`).
- **Freshness/trust:** per fact-group, a trust level + last-synced timestamp.

Each per-decision assembler consumes the subset it needs.

---

## 6. Provider abstraction strategy

**Goal: zero provider-specific logic above the substrate. Validate against Sleeper / ESPN / Yahoo /
Fantrax / MFL / CBS / Fleaflicker.**

- **Adapters translate provider data → canonical entities, below the substrate.** They are the only
  code that knows a provider exists. Sleeper is the first; the import pipeline
  (`ImportRun`/`ExternalEntityMapping`) is already this shape.
- **`ExternalEntityMapping` is the identity seam.** Provider IDs map to canonical IDs here; the
  substrate's identity resolution reads mappings, not provider quirks.
- **Where provider logic could leak (and the rule to stop it):**
  - *Player ID namespaces* (Sleeper IDs vs ESPN IDs vs MFL IDs) → should resolve to canonical player IDs.
    **Validation correction (Part 12):** the live Sleeper import does **not** do this — it stores **raw
    provider player IDs** in `Roster.playerData.players`. So either the substrate's lineup projection
    resolves provider→canonical IDs at read time via the identity seam, or a normalization step does it
    at import. The architecture rule stands; the current implementation does not yet satisfy it.
  - *Slot/position vocabularies* → the canonical `Roster.playerData` blob stores `players`/`starters`/
    `reserve`/`taxi` ID arrays but **no per-player position/injury/bye/slot-type** (Part 12). The lineup
    projection must enrich those by joining player IDs against the canonical player table — the blob
    alone is insufficient.
  - *Scoring/settings dialects* → normalized into the `settings` snapshot at import.
  - *Sync cadence / freshness* → surfaced as a trust signal (§5.2), not a branch.
- **Litmus test for the design:** grep the Decision OS tree and the per-decision assemblers for any
  provider name or any `redraft*` table. The target state has **zero** matches outside the adapters.
  (Today the lineup/trade loaders fail this test; the rest of the OS passes it.)

---

## 7. Native AF league strategy

**Question: should native AF-created leagues pass through the same canonical world assembly as imported
leagues, or keep two execution paths?**

**Recommendation: one path. Native leagues pass through the same Canonical World Assembly.**

Rationale:
- The canonical substrate (`League`/`LeagueTeam`/`Roster`) is **already populated for native leagues**
  at creation. They are not import-only tables.
- `RedraftRoster`/`RedraftSeason` is a **gameplay-engine projection**, not a separate source of truth.
  Today the redraft engine *reads* canonical `Roster` for identity and *writes* its own projection.
- Keeping two execution paths means every decision is maintained twice forever (the exact debt in §9)
  and parity must be proven twice.

**The migration-safe interpretation:** treat the **native AF redraft engine as one adapter** that fills
the canonical substrate (or whose outputs the substrate can read), exactly like the Sleeper adapter.
The redraft engine continues to run gameplay (drafts, scoring, playoffs); the Decision OS reads the
canonical substrate regardless of which engine produced it. Native and imported converge on one World.

This also resolves the trade-memo gap cleanly: the canonical trade assembler computes the evaluation
memo from canonical roster values for *any* league (native or imported), instead of depending on the
redraft-only `RedraftTradeValueSnapshot`. The redraft snapshot becomes a *cache/parity reference*, not
the source.

---

## 8. Migration roadmap (phased, shadow-safe, no legacy duplication)

Each phase is independently shippable, shadow-only until parity is GREEN on **both** native and imported
leagues, and gated by the existing per-slice flags + `DecisionShadowScope` (so it can be targeted to
specific test usernames/leagues in prod without affecting everyone).

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **A — (done)** | Current shadow slices over redraft-native data | All four slices Hybrid + Shadow, parity GREEN on native. ✅ |
| **B — Canonical World Assembly** | New shared substrate read (entities + identity + freshness), origin-blind. **No decision consumes it yet.** Read-only. Unit-tested with canonical fakes. | Substrate returns correct facts for a known imported league and a known native league; parity vs. existing redraft reads where both exist. |
| **C — Provider adapters formalized** | Sleeper adapter + native-redraft adapter both expressed as substrate fillers; `ExternalEntityMapping` is the identity seam; freshness/trust surfaced. | One imported + one native league produce identical substrate fact *shapes*; origin only in telemetry. |
| **D — Lineup bridge** | `lineupAssembler` reads the substrate (canonical lineup projection + canonical week) instead of `RedraftRoster`. Shadow-mounted for imported leagues. Validator-parity reused. | Lineup shadow runs GREEN for an imported league; redraft path unchanged and still GREEN; **read-only confirmed** (see §9 critical debt — must be fixed before/with this phase). |
| **E — Trade bridge** | `tradeAssembler` reads the substrate; canonical evaluation memo computed from canonical roster values (or honest `unsupported` degrade). Shadow-mounted for imported leagues. | Trade shadow GREEN for an imported 2-team trade; 3+ team still `unsupported`; redraft snapshot reused as parity reference. |
| **F — Single execution path** | Native + imported both served by the substrate for all four decisions. Redraft-native reads retained only as gameplay; no second Decision OS path. **No cutover of any shadow yet** — cutover is a separate, later decision per the Registry governance rule. | All four slices' assemblers read the substrate; zero provider/`redraft*` references above the substrate; Registry rows updated. |

**No legacy duplication / no second architecture:** Phases D–E *replace* the loader internals behind
the flag; they do not add a parallel canonical slice. The substrate is the single new layer; the redraft
tables remain as a gameplay engine + parity reference, not a Decision OS source.

---

## 9. Technical debt assessment

| Severity | Item | Detail | Disposition |
|---|---|---|---|
| ~~**Critical**~~ **RESOLVED** | Lineup "read-only" loader could write | Was: `loadLineupSetInputs` → `resolveRedraftRosterLookup` → `prisma.redraftRoster.update` (owner repair), transitively violating the shadow's read-only invariant. | **Fixed as prescribed.** `resolveRedraftRosterLookupReadOnly` is the pure resolver; owner-repair stays in the write-capable `resolveRedraftRosterLookup` for legacy callers (`keeper/context`, `redraft/roster`). `lineup/loader.ts` imports the ReadOnly seam. Enforced by architecture tests that ban the regex `resolveRedraftRosterLookup(?!ReadOnly)` in substrate source. |
| **High** | Two roster tables | Canonical `Roster.playerData` (JSON) vs `RedraftRoster` + `RedraftRosterPlayer[]` (rows). Source of the entire lineup/trade incompatibility. | Substrate reads canonical `Roster`; redraft projection becomes an adapter (§7). |
| **High** | No canonical trade evaluation memo | `RedraftTradeValueSnapshot` is redraft-only; `AfLeagueTrade` has none. | Phase E: compute memo from canonical values, or degrade honestly (mirror 3+ team pattern). |
| **High** | Duplicated transaction stores | `WaiverClaim`/`RedraftWaiverClaim`, `AfLeagueTrade`/`RedraftTradeProposal`, `TeamPerformance`/`RedraftMatchup`. | Out of scope for the bridge; flag for a separate canonicalization track. Decision OS reads the canonical side. |
| **Medium** | Fragile 3-way identity resolution | `resolveRedraftRosterLookup` juggles `RedraftRoster` ↔ `LeagueTeam` ↔ `Roster` with repair heuristics. | Substrate's identity resolution supersedes it (read-only); keep the mapping logic, drop the writes. |
| **Medium** | Redraft naming leaks into provider-agnostic code | `resolveRedraftRosterConfig` is used by the *provider-agnostic* lineup World; `RedraftLineupPlayer` is the player type across the slice. | Cosmetic/no behavior change; rename when the canonical projection lands so the vocabulary matches the substrate. |
| **High** *(validated, Part 12)* | Imported `Roster.faabRemaining` is `null` | `SleeperRosterMapper` sets `faab_remaining: null` (only `waiver_budget_used` is roster-scoped; league total `waiver_budget` is not joined). `bootstrapLeagueFromNormalizedImport` persists the null; the waiver loader reads it directly. **Remaining FAAB is computable** (`budget − used`) but dropped. | Substrate should **derive** remaining FAAB from `League` budget + roster `waiver_budget_used`, not depend on the provider mapper. Affects waiver + trade data completeness today. |
| **Medium** *(validated, Part 12)* | Imported player IDs stored raw / unenriched | `Roster.playerData.players` holds raw provider IDs with no position/injury/bye/slot-type. | Lineup projection resolves IDs via the identity seam and enriches from the canonical player table. |
| **Medium** *(validated, Part 12)* | No canonical current-week column on import | Import writes `League.season` (year) + per-week `TeamPerformance`, but no per-league "current week". Lineup/trade need it. | Substrate derives current week from provider sync state (`state/nfl`) / latest `TeamPerformance`, surfaced with freshness. |
| **Low** *(validated, Part 12)* | Imported `pointsAgainst` may be 0 | `SleeperRosterMapper` drops `points_against`; bootstrap falls back to `standing.points_against ?? 0`. | Map `fpts_against` in the adapter or derive in the substrate; minor health-metric completeness. |
| **Low** | Settings duplication on `League` | `League` has both top-level columns (`tradeReviewHours`, `irSlots`, …) and a `settings` JSON snapshot. | Substrate picks one canonical read order; document precedence. |

---

## 10. Risk assessment

| Risk | Exposure | Mitigation |
|---|---|---|
| **Performance** | Substrate parses `Roster.playerData` JSON per request; potential N+1 across teams for standings. | Assemble once per request, share across decisions; select-narrow; the substrate is a single read layer (not per-decision prisma calls). |
| **Caching** | Imported-league freshness depends on provider sync; cached substrate could serve stale facts. | Carry `lastSyncedAt` → trust signal (§5.2); never cache across a sync boundary without invalidation. |
| **Provider sync timing** | A league mid-sync yields partial rosters. | Substrate marks incomplete fact-groups `low`/`unverified`; decisions degrade honestly (existing `data_completeness`/`uncertainty` channels), never fabricate. |
| **Roster freshness** | Imported roster lags the provider; lineup/trade act on stale rosters. | Trust + uncertainty surfaced; shadow-only until freshness SLAs are validated; `DecisionShadowScope` to pilot on opted-in leagues. |
| **Trade timing** | Canonical evaluation memo computed at read time may differ run-to-run if values drift. | Pin the memo to a value snapshot at proposal time (mirror redraft's persisted-snapshot pattern); parity against the redraft snapshot where both exist. |
| **Waiver timing** | Already canonical — low risk; FAAB/priority freshness only. | Existing slice unaffected; reuse its freshness handling. |
| **Concurrency** | Owner-repair writes racing with reads. | **Eliminated for the shadow** — the read path now calls `resolveRedraftRosterLookupReadOnly`, which issues no writes. Legacy routes that still call the write-capable resolver retain the original race; unchanged and out of scope here. |
| **Telemetry** | Need to debug imported-league shadows without origin branching. | Origin (`provider`, `source`) travels as a **telemetry flag only** (§5.2); the viewer already filters by `userId`/`leagueId`. |
| **Testing** | New substrate needs coverage for imported *and* native, partial syncs, JSON-blob edge cases. | Canonical fakes mirroring the slice fakes; architecture tests forbidding provider/`redraft*` references above the substrate; per-phase staging parity scripts (prod-host guard, like `slice4-staging-parity.ts`). |
| **Rollback** | A bad substrate read could affect a shipped slice. | Phases D–E swap loader internals **behind the existing flags**; default off; shadow-only; instant revert by flag. No cutover in Phase 2. |

---

## 11. Decision record (ADR)

**ADR-DOS-002 — Canonical World Assembly as the permanent Decision OS data foundation**

**Status:** Proposed (audit complete; awaiting approval to begin Phase B).

**Context:** Decision OS shipped four shadow slices. Two (`waiver`, `commissioner.league.health`) read
the canonical substrate and already serve imported leagues. Two (`lineup`, `trade`) read the
redraft-native gameplay projection (`RedraftRoster`/`RedraftSeason` + `RedraftTradeValueSnapshot`) and
cannot serve imported leagues. The audit established that **Decision OS core is already
provider-agnostic** and the coupling is confined to two seam loaders plus the trade memo source, and
that the canonical substrate (`League`/`LeagueTeam`/`Roster`/`TeamPerformance`) is **universal** (every
native and imported league has it) while the redraft tables are **one engine's projection**.

**Decision:** Adopt **Option C** — a shared, origin-blind **Canonical World Assembly** beneath the
existing per-decision World assemblers (the rewritten seam loaders), fed by thin provider adapters
(Sleeper, native-redraft, future). Decision OS is not modified. World Resolution becomes the single
source of truth and **completely hides origin**; origin survives only as a trust/freshness signal in
provenance and as a telemetry flag — **never** as a decision branch. Native AF leagues use the **same**
path; the redraft engine becomes one adapter feeding the substrate, not a second Decision OS source.

**Why this is the five-year foundation:**
1. **It matches reality, evolved.** The OS is already per-decision and provider-agnostic; C inserts the
   missing shared substrate without inverting anything. A and B both fight the existing grain.
2. **Provider count stops coupling to gameplay schema.** New providers write canonical entities through
   a thin adapter; they never touch `RedraftRoster`/`RedraftSeason`. Adding ESPN/Yahoo/MFL is an
   adapter, not a Decision OS change.
3. **One path for native + imported.** Eliminates the duplicate-everything debt at the decision layer
   and the double parity burden.
4. **Honesty is preserved, not bolted on.** Freshness/trust flows through the existing
   `provenance`/`uncertainty`/`data_completeness` channels; partial syncs degrade truthfully rather
   than fabricating.
5. **It is migration-safe.** Additive substrate (Phase B), formalized adapters (C), then loader-internal
   swaps behind existing flags (D–E), with no cutover and instant flag rollback.

**Consequences:**
- New shared layer to build and own (the substrate) — the single net-new surface.
- ~~The Critical read-only debt (owner-repair write in the identity path) **must** be retired before the
  lineup bridge ships.~~ **Done** — retired via the ReadOnly resolver split; see §9.
- The trade slice gains a canonical evaluation memo (or an honest `unsupported` degrade) — the only
  genuinely new computation in Phase 2.
- Cutover of any shadow remains a **separate, later** decision governed by the Decision Registry; Phase 2
  ends at "single read path, still shadow."

**Rejected alternatives:** **A** (bridge into the redraft loader) — perpetuates the redraft schema as
the provider lingua franca and keeps two universes forever. **B** (one monolithic canonical resolver) —
correct in spirit but collapses four genuinely different World shapes into a god-object and a
change-contention point.

---

## 12. Real-world validation (Sleeper `theciege24`)

The audit above was traced from code. This part grounds it in **live data** from the proof account
`theciege24` (Sleeper user_id `591462610482806784`) and the **actual import pipeline code**, to confirm
the architecture describes the real application state — not assumptions. Sleeper is treated only as the
first implemented provider; every finding is stated in provider-neutral terms.

### 12.1 Method (safe, no DB/prod risk)

- **Source side:** read-only calls to Sleeper's public API for `theciege24` (no auth, no credentials).
  No staging/production database was touched, honoring the prod-host guard rule.
- **Transform side:** traced the live import path
  `ImportedLeagueCommitService → bootstrapLeagueFromImport → bootstrapLeagueFromNormalizedImport`, the
  provider-neutral mappers (`mappers/External*Mapper.ts`), and the Sleeper adapter
  (`adapters/sleeper/SleeperRosterMapper.ts`).
- **Decision side:** cross-checked `lib/decision-os/waiver/loader.ts` against the persisted canonical
  shape.

### 12.2 What the live data confirms

| Claim in this doc | Live evidence | Verdict |
|---|---|---|
| Provider abstraction already exists at the import layer (thin adapters → neutral entities) | `adapters/{sleeper,espn,yahoo,fantrax,fleaflicker,mfl}/` + `IExternalRosterMapper<T>` producing a provider-neutral `NormalizedRoster`; `ImportProvider` switch only in backfill | **Confirmed** — the "thin provider adapters below the substrate" already ship for 6 providers |
| Import populates the **canonical substrate**, not the redraft projection | `bootstrapLeagueFromNormalizedImport` writes **only** `LeagueTeam` + `Roster` + `TeamPerformance`; **no** `RedraftRoster`/`RedraftSeason`/`RedraftRosterPlayer` write anywhere in the import path | **Confirmed** — this is the precise reason lineup/trade fail for imported leagues |
| `Roster.playerData` is a JSON blob | Persisted shape: `{ players[], starters[], reserve[], taxi[], source_provider, source_league_id, source_team_id, source_manager_id, …, import:{…} }` | **Confirmed**, and now concretely specified for the projection design |
| Standings live on `LeagueTeam`; per-week scoring on `TeamPerformance` | bootstrap upserts `LeagueTeam` (wins/losses/ties/PF/PA/rank/role/orphan/commish) and `TeamPerformance` per matchup week | **Confirmed** — commissioner-health's canonical sources are real |
| Every league has the canonical substrate; redraft tables are one engine's projection | Import creates the substrate with no draft run; `RedraftRoster` only appears via `finalizeDraftToRedraftSeason` (AF-native drafting) | **Confirmed** — imported leagues are exactly the "substrate-but-no-projection" case |
| Identity seam maps provider manager → AF user | `resolveImportedManagerUserIds` resolves via `appUser.username = sleeper_<id>` and `UserProfile.sleeperUserId`; `Roster.platformUserId` holds resolved AF id or raw provider id | **Confirmed** (mechanism refined below) |
| Real scale is non-trivial | `theciege24`: 60 leagues (2025), 67 (2024), 116 (2023); sizes 4–32 teams; redraft + keeper + dynasty; IDP/taxi/superflex variants | **Confirmed** — the substrate must handle wide settings/variant diversity |

### 12.3 What the live data corrects or sharpens (fed back into §2.1, §6, §9)

1. **Remaining FAAB is `null` on imported leagues (computable but dropped).** `SleeperRosterMapper`
   sets `faab_remaining: null` because the roster-scoped mapper sees only `waiver_budget_used` (live:
   `150`) and not the league total (`waiver_budget: 250`). `bootstrapLeagueFromNormalizedImport`
   persists the null, and `waiver/loader.ts` reads `roster.faabRemaining` directly. **Effect:** the
   waiver slice is *structurally* canonical (league budget is known via settings) but the user's
   *remaining* FAAB is unknown today — honest degradation, but degradation of a fact that is trivially
   derivable. **Architecture consequence (important):** *derivation belongs in the substrate, not the
   provider adapter.* If each provider mapper must compute remaining FAAB, each can (and Sleeper does)
   drop it. The Canonical World Assembly should derive `faabRemaining = leagueBudget − used` once, for
   all providers. This generalizes: the substrate is the right home for cross-provider derivations
   (remaining budget, current week, points-against), keeping adapters genuinely thin.

2. **Player IDs are stored raw, not resolved to canonical at import.** `playerData.players = r.player_ids`
   are raw Sleeper IDs; there is no per-player position/injury/bye/slot-type in the blob. §6's claim
   that IDs are "resolved to canonical by the adapter at import" was **aspirational, not current**. The
   projection must resolve + enrich at read time (or a normalization step must be added). Corrected in
   §6 and §9.

3. **No canonical current-week column.** Import writes the season *year* and per-week `TeamPerformance`,
   but nothing stores "current week" for an imported league. The lineup/trade week source must be
   derived (provider `state/nfl` or latest `TeamPerformance`) — confirming the §2.1 "canonical
   season/week independent of `RedraftSeason`" gap is real, with a concrete derivation path.

4. **Manager identity uses a username convention + `UserProfile`, not (only) `ExternalEntityMapping`.**
   §6 named `ExternalEntityMapping` as "the identity seam"; for *managers* the live mechanism is
   `appUser.username = sleeper_<id>` / `UserProfile.sleeperUserId`. The seam is real but multi-mechanism;
   the substrate's identity resolver should treat manager-identity resolution as a named capability, not
   assume a single table.

### 12.4 Effect on the recommendation

**Unchanged and strengthened.** The live evidence makes Option C *more* clearly correct, not less:

- The smoking-gun confirmation that import writes the canonical substrate and **never** the redraft
  projection is the strongest possible support for "the substrate is universal; the redraft tables are a
  projection" (§2, §7) and for rejecting Option A (which would force every imported league through the
  redraft schema it provably does not have).
- The 6-provider adapter tree already in the repo is exactly the "thin adapters below the substrate"
  layer C proposes — C formalizes what import already does and extends it to the decision-read path.
- The new finding that derivations (FAAB, week, PA) are dropped per-adapter is a *positive* argument for
  a shared substrate: it is the only layer that can compute these once for every provider and every
  native league. This is the one genuinely new architectural insight from validation, and it is folded
  into §5.3 (substrate output contract) and §9.

No change to the hard rules: this validation read live provider data and existing code only — **no code
was written, no Decision OS module changed, no bridge implemented, no shadow cut over.**

---

*End of audit. No code was written, no Decision OS module changed, no bridge implemented. Approval of
ADR-DOS-002 unblocks Phase B (Canonical World Assembly, read-only) — now validated against live
`theciege24` import data and the real import pipeline.*
