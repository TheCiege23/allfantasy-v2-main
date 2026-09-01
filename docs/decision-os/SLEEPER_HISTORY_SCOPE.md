# Sleeper history: the missing fourth service, and 60 live calls per dashboard

Scope for the work the 5.1 proof surface surfaced on 2026-09-01. Every figure below
was measured, and the corrections are kept in place rather than tidied away, because
three of them were wrong in the reassuring direction first.

---

## 1. What was measured

The proof surface (`/api/admin/decision-os/grounding-proof`) on a live 8-team dynasty
league, after `engineMs` and per-slice `ms` shipped:

```
buildMs   6203        chat route's grounding ceiling: 3000
engineMs  1121        twelve context providers, already concurrent
portfolio 4500ms  →   present: false, "No cross-league snapshot is available."
```

`portfolio` cost 4500ms and returned nothing. 4500 was not a duration — it was
`withTimeout(getCommandCenter(userId), 4500)`, so the slice measured its own timeout
to the millisecond. `getCareerCard` had another 3000 after it, sequentially: **7500ms
worst case inside a 3000ms ceiling**, which one slice could spend on its own.

Bounded to 1500/800 in `91df839e8`. That fixed the budget. It did not fix the cause.

### 🛑 The cause is structural, not slow

`getCommandCenter` iterates leagues in a **sequential `for…of` with `await` inside**.
`MAX_LEAGUES = 12`. Per league, six timeout-bounded calls:

| call | ms | provider |
|---|---|---|
| `getLeagueContext` | 4000 | Sleeper |
| `listLeagueDrafts` | 3500 | Sleeper |
| `/league/{sid}/rosters` | 3000 | Sleeper |
| `getMatchupCenter` | 5000 | Sleeper |
| `getLeagueH2H` | 3500 | Sleeper |
| `getMarketValues` | 4000 | — |
| **per league** | **23,000** | |

12 × 23s ≈ **4.6 minutes** worst case. Even an optimistic one second per league is
12s — four times the entire chat ceiling. It cannot serve a request from a cold
cache under any budget. The 10-minute `sportsDataCache` is the only reason the
dashboard works, and Chimmy gets `portfolio` only when someone recently loaded it.

**Five of six are live Sleeper HTTP, so one dashboard render is 60 vendor calls.**

⚠ `Promise.all` over the loop is the wrong fix and was nearly the chosen one. It
makes an architecture violation faster and multiplies concurrent vendor load by 12.
The user rejected it on exactly that ground before it was written.

---

## 2. The guard already says so

`api.sleeper.app` and `api.sleeper.com` ARE in `DATA_API_HOST_PATTERNS` — checked,
because CLAUDE.md warns the monitored-host list is not a census and this file was one
sentence from asserting the opposite. The guard reports all five:

```
lib/dashboard-intel/commandCenterService.ts:34  -> https://api.sleeper.app/v1
lib/league-context/leagueContextService.ts:24   -> https://api.sleeper.app/v1
lib/matchup-intel/matchupCenterService.ts:19    -> https://api.sleeper.app/v1
lib/league-history/sleeperH2HService.ts:22      -> https://api.sleeper.app/v1
lib/draft-intel/sleeperDraftIntelService.ts:32  -> https://api.sleeper.app/v1
```

31 Sleeper violations in total, inside the standing backlog. CI runs the guard in
`--changed` mode, so `main` stays green until someone touches these files. That is
the guard working, and it is why this has sat.

---

## 3. What is synced today, and what is not

### ⚠ Two corrections, kept because both were wrong the confident way

1. **"Drafts and matchups are not synced" — WRONG.** That came from reading the three
   scope names in `lib/fantasy-os/sync` (`league_state`, `teams_rosters`,
   `traded_picks`) and stopping. `lib/league-import/sleeper/` holds
   `SleeperHistoricalDraftSyncService`, `SleeperHistoricalMatchupSyncService` and
   `SleeperHistoricalSeasonStateSyncService`. They exist.
2. **"`WaiverTransaction` has no writer" — WRONG.** A census of
   `prisma.X.create|upsert|createMany` missed `lib/waiver-wire/free-agent-service.ts`.
   Widening to `(prisma|tx|db|client).X.(create|upsert|createMany|update)` found it.
   This is the fifth time in this repo's record that a single-form census gave the
   wrong answer.

### The actual state

`SleeperHistoricalBackfillService` orchestrates **three** services:

| | service | status |
|---|---|---|
| drafts | `SleeperHistoricalDraftSyncService` | exists |
| matchups | `SleeperHistoricalMatchupSyncService` | exists |
| season state | `SleeperHistoricalSeasonStateSyncService` | exists |
| **transactions** | — | **🛑 never written** |

Three of four siblings were built. Trades and waivers are the one that was not.

### 🛑 And none of the three is scheduled

Callers of `syncSleeperHistoricalBackfillAfterImport`:

- `lib/league-import/ImportedLeagueCommitService.ts` — once, at import
- `app/api/leagues/[leagueId]/backfill/retry/route.ts` — manual, `cron: 0`

So a league imported in March holds March's history and nothing since. **Adding the
fourth service without scheduling the orchestrator would be worse than useless** —
that is the `ingestCFBDStats` shape CLAUDE.md calls fatal: a surface pointed at a
table nothing refreshes fails silently and looks correct.

---

## 4. Trades and waivers are two different problems

Kept apart at the user's insistence, and they are broken differently.

**Trades.** `AfLeagueTrade` is written by `lib/league-trade-engine/tradeService.ts` —
the *native* engine for trades made inside AllFantasy — and by
`scripts/backfill-decision-os-sleeper-history.ts`, which is **not in
`cron-schedule.json`**. The league brief's "11 completed trades since 2022" came from
someone running that script by hand.

> 🛑 **CORRECTION, 2026-09-01: "A trade made in Sleeper today never arrives" was WRONG,
> and it was the fourth time in this document that a census stopping at
> `lib/league-import/` gave the wrong answer.** Sleeper trades DO land, in
> `TransactionFact`, on a schedule — just not through any file this document was reading:
>
> ```
> /api/cron/import-players            (every six hours)
>   -> refreshStaleLeagueProfiles({ maxLeagues: 3 })
>     -> ingestSleeperTradeFacts()     lib/psychological-profiles/SleeperTradeFactIngest.ts
>       -> prisma.transactionFact.upsert()
> ```
>
> ⚠ **What IS true is worse-sounding and more precise: the rotation is three leagues every
> six hours.** Twelve a day against 543 imported leagues is a **~45-day lap**. So the
> product complaint holds — a user can be reading month-old trade history — but the fix is
> coverage and cadence, not a missing writer. Building "the missing trade writer" would have
> produced a second writer racing the first.

**Waivers.** `WaiverTransaction`'s only writer is our own free-agent engine.
`WaiverClaim`'s only writers are a backfill and a seed script. There is **no writer
for Sleeper-originated waiver claims at all** — absent, not stale. `SleeperTradeFactIngest`
opens with `if (tx.type !== 'trade' …) continue`, so it drops every waiver and free agent
on the floor. **This half of the original finding was correct.**

> ⚠ **CORRECTION TO THE CORRECTION, same day, and it is the same mistake one layer down.**
> The paragraph above originally called `SleeperTradeFactIngest` "the ONE scheduled Sleeper
> transaction path". It is not. `/api/cron/decision-os-activity-ingest` pulls **all 18
> transaction weeks daily for ≤40 leagues**, and its type union is
> `'trade' | 'waiver' | 'roster_move' | 'draft_pick'` — **waivers included**.
>
> So "Sleeper waivers reach nothing" is true of **`TransactionFact` and `WaiverTransaction`**,
> and false of **`DecisionOsImportedActivity`**. Different tables, different consumers
> (`MetaAnalysisService` reads the former; the Decision OS behavioural surfaces read the
> latter), and a claim about one is not a claim about the other. Naming the table is the
> difference between a finding and an overstatement — the third time in this document that
> a confident negative had to be narrowed rather than withdrawn.

### ⚠ The data is already bought and thrown away

`SleeperLeagueFetchService` fetches `/league/{id}/transactions/{week}` for **18 weeks
per league**, and `SleeperHistoryMapper` normalizes it with the correct discriminator:

```ts
type: 'waiver' | 'trade' | 'free_agent' | 'drop'
```

Nothing found persists that array. Confirmed by tracing the data forward
(mapper → adapter → consumer) rather than by grepping for writers, after the writer
census above had already misreported once. The user confirms this is **not
deliberate**.

---

## 5. Proposed order

### 🛑 Step 1 was WRONG as first written, and the correction is the real finding

This document originally said step 1 was "schedule the backfill orchestrator". That was
inferred from "nothing re-runs it" without reading the gates, and it is wrong in both
directions:

- scheduled **without `force`**, every season already has rows, so every season is
  skipped and the cron burns invocations confirming what it knows;
- scheduled **with `force`**, it re-fetches completed seasons that cannot change — the
  vendor load the gates exist to avoid.

The gates are not missing. They test the wrong thing. Both the draft and season-state
services carry a gate commented *"a completed historical season's rows are stable"*
whose code tests whether **rows exist**:

```ts
if (!args.force) {
  const existing = await prisma.X.findFirst({ where: { leagueId, season } })
  if (existing) { seasonsSkippedAlreadyComplete += 1; continue }
}
```

`getSleeperHistoricalLeagueChain` starts at the CURRENT league and walks back, so the
chain's first element is the season being played; `SEASON_END_ROSTER_SNAPSHOT_PERIOD = 0`
is written with no completed-season guard. A mid-season import therefore stamps
"season end" rows for a season that has not ended, and every later run skips it — while a
counter named `seasonsSkippedAlreadyComplete` reports it finished.

**A user's live roster and draft froze at the instant they imported.** Fixed by
`lib/league-import/sleeper/seasonCompletion.ts`, which gates on Sleeper's own
`status === 'complete'` — already carried on every chain element, so it costs no request.

⚠ And the three siblings did not agree with each other, which is why no single reading
found this:

| service | gate as shipped | effect |
|---|---|---|
| draft | rows exist → skip | current season frozen at import |
| season state | rows exist → skip | current season frozen at import |
| matchup | none (guard clauses only) | re-fetches every season, every run |

| | step | why this order |
|---|---|---|
| 1 | ~~Schedule the backfill orchestrator~~ **Fix the completion gates** | DONE. Past and present are now distinguishable, which every later step depends on. Scheduling anything before this would have propagated the frozen-season bug on a timer. |
| 1b | ~~Give the matchup service the same gate~~ | DONE. It had none, so every run re-fetched FOUR Sleeper endpoints per season — rosters, both playoff brackets, and multi-week `fetchWeekMatchups` — re-learning settled history. Now gated on the same shared predicate. |
| 1d | **The predicate is provider-agnostic, at the user's instruction** | It was first written under `sleeper/` and typed on `SleeperLeague`. Past-versus-present is a PRODUCT rule and every import has both kinds of season, so it now lives at `lib/league-import/seasonCompletion.ts`. `'complete'` is already the shared vocabulary: espn/fantrax/mfl/yahoo all map `isFinished ? 'complete' : 'in_season'`, sleeper passes its own through, fleaflicker maps none — correctly not-complete. |
| 1c | ~~**Then schedule the orchestrator**~~ | **DONE, 2026-09-01** — and it exposed a FIFTH gate of the same shape. See below. |
| 2 | ~~**`SleeperHistoricalTransactionSyncService`**~~ | **DONE, 2026-09-01** — and it needed **no migration**, which is the part this plan had wrong. See below. |
| 3 | **Repoint `getLeagueContext` + `/rosters`** | Free today — that data is already in the DB via the 30-min sync. Deletes 24 of 60 calls per render with no new writer. |
| 4 | **Repoint drafts, matchups, H2H** | Only safe once 1 and 2 hold. `getLeagueH2H` is completed head-to-head history, immutable, re-fetched live on every render — the clearest case. |

Cadence, per the user 2026-09-01: the 30-minute `fantasy-os-exec-sync` **stays as is**
(deliberate, not drift). Historical data is written once and never re-fetched. Live
scoring stays on the sports APIs and is out of scope here.

### 🛑 Decided 2026-09-01: imported trades get their OWN table

User's call, and the reason is the durable part: **we cannot write to other sites.**

`AfLeagueTrade` is owned by `lib/league-trade-engine/tradeService.ts`, which does not
merely store trades — it accepts, rejects, counters, vetoes and processes them. Every
one of those is a WRITE, and for a trade that happened in Sleeper there is nowhere to
write it to. Sleeper is not ours to act on.

So a Sleeper-origin trade in that table is a row the engine believes it can operate,
backed by an operation that cannot exist. The failure would not be a crash — it would
be a commissioner vetoing a trade that stays completed on Sleeper, and the two systems
disagreeing with no error anywhere. That is the same shape as everything else this
document records: an action that looks available and is not.

Imported history is **read-only by nature**, and the table boundary is what makes that
structural rather than a convention someone has to remember. The discriminator the
importer already produces (`'waiver' | 'trade' | 'free_agent' | 'drop'`) is the split
INSIDE imported data; ownership is the split between imported and native, and they are
different questions.

⚠ This applies to waivers identically. `WaiverTransaction` is written by our own
free-agent engine, which processes claims. Imported Sleeper claims are history and
must not land there.

### ✅ Built 2026-09-01 — and the table the decision asked for already existed

`lib/league-import/sleeper/SleeperHistoricalTransactionSyncService.ts`, wired into
`SleeperHistoricalBackfillService` beside the other three siblings.

**No migration, and this plan expected one.** `TransactionFact` (`dw_transaction_facts`)
is already the imported-history table for **ESPN, Fantrax, MFL and Yahoo** — four
providers writing it from their own historical backfills. Sleeper was the only one that
did not. So the user's "imports get their own table" decision was already satisfied by
the existing schema; what was missing was Sleeper's writer, not the boundary.

That matters beyond convenience: a migration is not pushable work, so had this needed one
the code could not have shipped ahead of the user's decision to apply it.

⚠ **The id had to collide with the existing writer, not avoid it.**
`SleeperTradeFactIngest` keys `TransactionFact.transactionId` as
`${sleeperTransactionId}:${rosterId}`. The new service uses the **same composition**, so
when both paths see one trade they upsert the **same row**. A fresh key would have
duplicated every trade into a table `MetaAnalysisService` counts — nothing would have
thrown, the numbers would just have been wrong.

For the same reason it **upserts rather than `deleteMany` + `createMany`**, which is where
it deliberately breaks from the draft sibling's shape: the draft sync owns every
`DraftFact` row for its league, but this table is *shared*, and a season-scoped delete
would silently drop the other writer's rows on every run.

Two smaller things found by writing the tests rather than by reading the code:

- a roster that only **gave or received FAAB** got no row at all, because the participant
  scan read `roster_ids`/`adds`/`drops` and not `waiver_budget`. Usually both sides are in
  `roster_ids` too, which is exactly why it would have sat undetected — a missing row is
  not something a consumer can notice.
- **the waiver bid was not being captured at all.** It lives in `settings.waiver_bid` and
  `SleeperTransaction` had no `settings` field, so it was invisible to anything reading
  that type. A waiver stored without its bid is a half-fact — what someone was willing to
  pay *is* the FAAB history. It is now its own `waiverBid`, kept strictly apart from
  `faabNet`: one is a purchase from the league, the other a transfer between managers, and
  folding them together would misreport both.

### ✅ Step 1c, 2026-09-01 — scheduled, and it found the fifth gate

`/api/cron/sleeper-historical-refresh`, twice daily (`20 3` and `20 15` UTC), staleness-ordered
by `DynastyBackfillStatus.updatedAt` ascending, ≤25 leagues a fire, 240s `createRunBudget`
checked between leagues, per-league failure isolation, `SyncJobRun` telemetry.

The ordering needs no stored cursor because `runDynastyBackfill` **upserts that status row at
the start of every run** — so refreshing a league is what makes it the least stale, and coverage
is complete since every imported Sleeper league ran the orchestrator once at import.

🛑 **A FIFTH COMPLETION GATE, AND THIS ONE WAS THE DANGEROUS ONE TO SCHEDULE.**
`lib/dynasty-import/backfill-orchestrator.ts` skipped any season with a `SeasonResult` row —
identical in shape to the four already repaired, missed because it lives under
`lib/dynasty-import/` and every census had been of `lib/league-import/`. Left alone it would have
frozen standings and trades for the live season of **every league the rotation touches**, on a
timer, while `seasonsSkipped` reported success.

⚠ **It had a second half that typechecked perfectly.** `discoverSleeperSeasons` dropped `status`
when mapping to `HistoricalSeasonRef`, *and* the orchestrator annotated its local `discovered`
with an inline structural type that omitted the field. Either alone leaves the gate with nothing
to read. A narrower local annotation silently undoes a widening two files away — worth
remembering next to the "a type widening surfaces in a CONSUMER's file" note in CLAUDE.md.

⚠ **`force` means something DIFFERENT here** — "run even though this league is not dynasty",
not "refetch a season we already hold". `skipExistingSeasons` is the local equivalent of the
siblings' `force`. Wiring the wrong one in by analogy would re-open the gate entirely, so the
field now says so at its definition.

**Coverage, stated rather than implied.** At ≤25 leagues a fire and two fires a day, a
543-league account laps in **roughly eleven days**. That is a large improvement on the ~45-day
trade rotation it supplements and it is **still not "up to date"**. Raising the frequency is a
one-line change to `cron-schedule.json`; the twice-daily cadence is the user's standing
instruction for system-side refreshes and was not raised unilaterally.

⚠ **Known duplication, recorded rather than discovered later.** Transactions for one league can
now be fetched by three paths: the new transaction sibling, `runDynastyBackfill` (which loops
weeks of its own for trades), and `decision-os-activity-ingest`. With every gate working each
touches only the season still being played, so it is bounded — but it is real. Collapsing it
means giving the orchestrator a single fetch to share, which is a refactor, not this change.

---

## 6. Provenance

Measured 2026-09-01 against `origin/main` at `91df839e8`, by direct file read, the
repo's own `check-db-first-api-boundary.mjs`, and the 5.1 proof surface against a live
league. Not from module headers — `SleeperHistoricalBackfillService`'s siblings are
absent from every summary consulted before reading the directory. Three claims in this
document were wrong on first pass and are corrected in place above rather than removed.
