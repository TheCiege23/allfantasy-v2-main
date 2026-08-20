# Projections — provider audit, data audit, and the design that follows

Everything below was **measured**, not assumed. Provider claims come from live probes
run 2026-08-16; data claims come from counting production rows. Where something
could not be verified, that is stated rather than smoothed over.

The governing constraint is the one that set this work off: **do not create false
stats.** A projection is the most authoritative-looking number in fantasy sports.
Every section here is written to make absence visible rather than fillable.

---

## 1. Provider audit — who actually serves weekly points projections

| Provider | Weekly projections? | What it gives | Evidence |
|---|---|---|---|
| **Sleeper** | **YES** | `pts_ppr`, `pts_half_ppr`, `pts_std` **and 94 component stat fields** | `GET /v1/projections/nfl/regular/2025/1` → 200, 535 KB, 9,412 players, 811 with points |
| **ESPN** | **YES** | `appliedTotal` + component stats under numeric stat IDs | `kona_player_info` → `statSourceId: 1` entries; Gibbs wk14 = 22.94 |
| **TheSportsDB** | **NO** | 49 event fields, none projection-related | `eventsnextleague.php?id=4391` → 200, zero `proj/forecast/predict/expect` fields |
| **Rolling Insights** | **NO** | no projections endpoint exists | every projection path → **404**, while real endpoints → **304** |

### Why Sleeper is the primary source

Its projection field names are **the same keys as a Sleeper league's
`scoring_settings`** — `rec`, `rec_yd`, `rec_td`, `pass_td`, `pass_int`,
`bonus_rec_te`, `idp_sack`, `fgm_40_49`, `pts_allow`, and so on.

That is the whole ballgame for league-specific projections. It means:

```
projectedPoints(league, player) = Σ  projection[k] × scoring_settings[k]
```

This is an **exact** computation, not an approximation. A TE-premium league, a
6-point-passing-TD league, an IDP league and a first-down-bonus league each get a
different, correct number from the same ingested row — and we already store every
league's `scoring_settings` in `League.settings`.

Anything derived from `pts_ppr` alone could not do this: you cannot recover
league-specific scoring from a total that has already been collapsed.

### On the two negatives

- **TheSportsDB** has no projections at all. It does carry `strWeather` on events,
  which is useful elsewhere, but it is not a projection source. Do not re-probe.
- **Rolling Insights** — every projection-named path returned 404 while known
  endpoints returned 304 ("exists, empty without params"). That 404-vs-304 split is
  the discriminator.
  ⚠ **Caveat, stated plainly:** no RI endpoint returned a 200 body in this
  environment, so this rests on the status-code split rather than on a payload I
  read. If RI's contract says otherwise, re-test before trusting this row.

---

## 2. Data audit — what the AF projection can actually be built from

The request was for an AF projection combining: **past performance vs that specific
team / defense / offense, coaching staff, month of year, weather.** Each was checked
against production.

| Input | Available? | Measured reality |
|---|---|---|
| **Weather** | **YES** | `WeatherCache` + `lib/weather/afProjectionService.ts` already run; `AFProjectionSnapshot` holds 6,104 rows |
| **Month of year** | **YES** | derivable from `SportsGame.startTime` |
| **Player game history** | **PARTIAL** | `PlayerGameStat` = 40,473 rows — but **2025 only, one season** |
| **Opponent / defense faced** | **NOT TODAY** | ⚠ see below |
| **Offense context** | **PARTIAL** | `normalizedStatMap` carries `off_snp`, `tm_off_snp`, `rec_tgt` → snap and target share are real |
| **Coaching staff** | **NO** | ⚠ **no coaching data exists anywhere in the schema** |

### ⚠ The opponent join does not currently work

`PlayerGameStat.gameId` does **not** join to `SportsGame`:

- `PlayerGameStat.gameId` looks like `202510126`; all 40,473 rows are **season 2025**
- `SportsGame` NFL rows are **season 2026**, with two different `externalId` shapes
  (`20261001-22-26` and `2475563` — i.e. two sources)
- Matching sample game ids against `SportsGame.externalId` and `.id`: **0 matches on both**

So "how this player performed against this defense" is **not computable today**. It
needs either an opponent stamped per player-game at ingest, or a 2025 schedule
backfilled and id-mapped. That is real work, and it is a prerequisite — not a detail.

### ⚠ Even with the join, opponent-specific history is a sample-size trap

A player faces a given defense **once or twice a season**. With one season on file
that is n=1 or n=2. A "vs this defense" average computed from one game is noise
wearing the costume of insight, and it would be the most confidently wrong number on
the screen — precisely the failure this codebase keeps undoing.

The industry answer is not to skip the factor but to **regress it toward the
positional mean in proportion to sample size** ([Fantasy Footballers on sample
size](https://www.thefantasyfootballers.com/articles/fantasy-football-philosopher-how-much-of-a-sample-size-do-we-need/),
[Fantasy Projection Lab](https://fantasyprojectionlab.com/nfl-fantasy-projections)):
a rate over 3 games gets pulled hard toward the mean; the same rate over 50 touches
barely moves. Applied here, an n=1 opponent split should move a projection by
almost nothing — and the honest version of this feature says so, rather than
presenting the raw split.

The stronger, better-supported signal is **defense-vs-position allowed** aggregated
across all players who faced that defense (n = dozens), not one player's single game
against it.

### ⚠ 20% of PlayerGameStat rows have `fantasyPoints > 0`

8,078 of 40,473. This is plausible — most of a 9,000-player universe scores zero in
any given week — but it means the usable history is smaller than the row count
suggests, and any per-player history needs a minimum-games filter before it says
anything.

---

## 3. The two projections

Exactly as asked, and the existing `AFProjectionSnapshot` already has the shape:

| Field | Meaning |
|---|---|
| `baselineProjection` | **Provider projection** — ingested, league-scored, nothing of ours added |
| `afProjection` | **Decision OS projection** — baseline plus our adjustments |
| `adjustmentFactors` (Json) | every factor, itemised, with its own contribution |
| `adjustmentReason` | why it moved, in words |
| `confidenceLevel` | how much support the adjustments actually had |

**Both are always shown.** The provider number is never silently replaced — a user
must be able to see what we changed and by how much, or the AF projection is
unfalsifiable.

### Adjustment layers, in dependency order

1. **League scoring** (exact) — component stats × that league's `scoring_settings`
2. **Weather** (built) — existing `afProjectionService`, outdoor/dome aware
3. **Month / late-season** (cheap) — from `SportsGame.startTime`
4. **Defense-vs-position** (needs the opponent join) — aggregated across the defense's
   full season, regressed by sample size
5. **Player-vs-this-defense** (needs the join, and stays tiny) — n=1–2, so heavily
   regressed; expected contribution near zero, and honest about it
6. **Coaching staff** — ⚠ **blocked, no data source exists**

Layers 1–3 are buildable now. Layer 4 is buildable after the opponent join. Layers
5–6 should not ship as confident numbers on today's data.

### The rule for `confidenceLevel`

It reflects **how much of the stack actually ran**, not how far the number moved. A
projection adjusted only by weather is not "high confidence" merely because the
weather was certain — it is a projection with one of five layers applied, and it
should say so.

---

## 4. What ships, and what is honestly withheld

**Ships:**
- Sleeper projection ingestion (component stats retained, not just totals)
- Exact league-specific scoring from those components
- Both projections surfaced side by side, with the delta itemised

**Withheld, with stated reasons rather than filled in:**
- Player-vs-specific-defense history — opponent join broken, and n=1–2 anyway
- Coaching-staff effects — no data exists
- Anything for **NCAAF** — Sleeper projections are NFL; there is no college source

A projection that says "provider baseline, adjusted for weather only" is worth more
than one that quietly implies it modelled a coaching change it knows nothing about.

---

## Sources

- [Fantasy Footballers — how much of a sample size do we need?](https://www.thefantasyfootballers.com/articles/fantasy-football-philosopher-how-much-of-a-sample-size-do-we-need/)
- [Fantasy Projection Lab — NFL fantasy projections methodology](https://fantasyprojectionlab.com/nfl-fantasy-projections)
- [Forbes — inside the formulas that power fantasy football projections](https://www.forbes.com/sites/giovannimalloy/2025/08/23/fantasy-football-projections-keep-human-touch-in-an-ai-world/)
