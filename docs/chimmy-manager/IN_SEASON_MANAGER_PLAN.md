# Chimmy as a real in-season manager — plan

Status: proposal, 2026-11-25. Read from `origin/main` at `21ddcc6d5`.

## What already exists (keep it)

| Piece | Where | What it does |
|---|---|---|
| Hourly run | `app/api/redraft/waiver-process/route.ts` (cron `0 * * * *`, worker service) | Calls `runAutoHandovers`, `runInactiveManagerLineups`, `runAutopilotWaivers` |
| Lineups | `lib/inactive-manager/inactiveManagerService.ts` | Best projected lineup, never moves a locked player |
| Adds/drops | `lib/inactive-manager/autopilotWaivers.ts` | Fills only empty starting slots, max 2 claims/run, via `createClaim` |
| Style | `inactiveManagerMode.ts` → `AUTOPILOT_STYLES` | `dynasty_owner` / `win_now` / `rebuild`, picked by the commissioner |
| Draft personality | `lib/live-draft-engine/npcDraftPersonalityTypes.ts` | 21 personalities, stored in `commissionerAiManagers`, used only in the draft |
| Plan gate | `chimmyPlayable.ts`, `autopilotEntitled` | AF Pro / Supreme; the free team limit |

## What is missing

1. **Trades into a Chimmy team are refused** — `app/api/redraft/trade-proposals/route.ts` returns `409 RECEIVER_ON_AUTOPILOT`.
2. **Nothing sends trade offers.** `/api/leagues/[id]/trade/ai-decision` is commissioner-triggered and draft-pick-only.
3. **The personality ends at the draft.** In season there are only the 3 styles.
4. **Waivers only fill holes** — no upgrade pickups.

## Design

### 1. One manager profile per Chimmy team
Stored on the existing managed entry (`League.settings.af_managed_lineups[rosterId].autopilot`), not a new table:

```
autopilot: { style, since, byUserId, personality?, activity? }
```

- `personality`: carried over from the team's draft personality when Chimmy drafted it; otherwise picked
  once, deterministically from `rosterId` (same hash trick the orphan service uses), and then fixed.
- The 21 draft personalities are draft-shaped. Map them onto a small in-season **trait set** that the
  season code actually reads, so we don't write 21 code paths:

| trait | range | drives |
|---|---|---|
| `horizon` | now ↔ future | value of young players and picks vs this week's points (replaces `style`) |
| `risk` | floor ↔ upside | injured / boom-bust players |
| `activity` | quiet ↔ busy | how many offers it sends and pickups it makes per week |
| `fairness` | shark ↔ easy | how much surplus it demands to accept |
| `positionBias` | e.g. RB-heavy, late QB | which positions it buys / sells |

  `dynasty_owner` / `win_now` / `rebuild` stay as presets of `horizon`, so nothing already switched on changes.

### 2. Answering trade offers (the most important part)
- Remove the blanket `409` for autopilot receivers; instead the offer is created as normal and the
  hourly run (plus a short-delay pass right after the offer is made) decides it.
- **Extract the accept/reject logic out of `app/api/redraft/trade-votes/route.ts` (856 lines, inline)
  into `lib/redraft/tradeDecision.ts`**, so Chimmy goes through exactly the rules a person does:
  deadline, review window, survivor/cap rules, integrity holds, veto votes, DMs, learning events.
  This is the precondition for everything else — Chimmy must never have its own accept path.
- Value both sides with the existing value layer (`estimateRedraftTradeAssetValue` / DB-first market
  values), adjusted by traits: `horizon` reweights age and picks, `positionBias` and roster need
  (empty starter slot, surplus at a position) add or subtract.
- Decide: accept if Chimmy's side gains ≥ its `fairness` margin; counter if it is close (ask for one
  bench player or pick to close the gap, once per offer); otherwise reject with a one-line reason
  in Chimmy's voice ("I'd need a bit more for a starter").
- Guard rails: never accept a trade that leaves an unfillable starting slot, never trade a player
  the owner marked untouchable (new optional list), never trade away more than 2 starters in a week.

### 3. Sending trade offers
- A new phase in the same hourly run, but acting **at most once a day per team**, at a random hour
  per team so the league doesn't see a burst.
- Find a need (weak starter slot) and a surplus (bench player another team needs), using the existing
  `package-finder` / trade-block / interests data. Prefer teams that listed the player on their
  trade block or showed interest.
- Weekly caps by `activity`: quiet 1, normal 2, busy 4 offers a week. At most 1 open offer to the same
  team. Never to another Chimmy team (no bot-to-bot churn) unless the commissioner allows it.
- Stops at the trade deadline (`tradeDeadlineWindow`) and in the playoffs.
- Offers say who sent them: "Chimmy (managing Team X)". The commissioner sees every Chimmy trade in
  the existing AI-manager audit log (`logAction`, `trade_send` / `trade_accept` already exist).

### 4. Upgrade pickups
- Extend `planAutopilotWaivers` with one optional upgrade claim per week when a free agent projects
  clearly better (margin set by `risk`/`activity`) than the worst bench player. Still never drops a
  starter or a protected young player.

### 5. Settings the commissioner sees
In the existing Chimmy section of league settings, per Chimmy team:
- Personality (shown in plain words, changeable), plus "Trades: off / answer only / answer and send"
  — **default "answer only"** for teams switched on before this ships, so nothing starts sending
  offers by surprise.
- League-wide switch: "Chimmy teams can trade with each other" (default off).

## Phases (each its own PR)

1. **Extract `tradeDecision.ts`** from `trade-votes` with no behaviour change; existing tests prove it.
2. **Profile + traits**, with the 3 styles mapped onto `horizon`; carry the draft personality over.
3. **Answer offers**: drop the 409, add the decision pass, counters, audit log, settings toggle.
4. **Send offers**: daily per-team pass with caps, deadline stop, no bot-to-bot.
5. **Upgrade pickups**.

Each phase ships behind the per-team trade setting, and is tested live in a test league before the next.

## Things to watch
- The hourly run is one Node thread on the worker that already stalls under load (CLAUDE.md). Trade
  evaluation must be bounded per run (team cap + deadline), like `runAutopilotWaivers`.
- Worker deploys from `worker-release` once a day, so a merged phase goes live on the cron up to a day later.
- No LLM call in the decision itself — deterministic, so it is cheap, testable and explainable. An
  LLM may only write the one-line message text, with a fixed fallback.
- Survivor, Guillotine and other special formats have their own trade rules; phase 3 starts with
  plain redraft/dynasty and turns the others on one at a time.
