# Redraft Commissioner Scoring Rules Contract (G2)

**Status:** NFL scoring is contract-verified for the categories that have a stat
pipeline. NCAAF scoring is honest-but-beta (no weekly stat pipeline). Two scoring
categories have **no data pipeline** and are documented gaps (team DEF/ST, return
yards).

The bar: *changing a league's scoring settings must change fantasy points exactly
as a commissioner expects.* This doc records what is proven, what was fixed, and
what is still missing. Tests: `__tests__/redraft/commissioner-scoring-contract.test.ts`
(pure) + `scripts/run-nfl-full-season-engine-e2e.ts` steps S1–S2 (DB, staging).

---

## The one scoring path

Every surface scores through the same function, so what the contract tests assert
is what the cron writes and what the matchup shows:

```
provider stats ──normalizeNflWeeklyStats──► canonical stat keys
                                              │
league.settings.sportConfig ─► getScoringCategories(sport, toggles)
                               ─► applyScoringPresetToRecPoints(preset)
                               ─► applyTePremiumStat(position)        ◄── G2 fix
                                              │
                               scoreStatsWithCategories(cats, stats, overrides)
                                              │
        ┌─────────────────────────────────────┼─────────────────────────────────┐
   score-sync cron                       matchup scoring                    roster API
 (syncPlayerWeeklyScores…)        (scoreRosterStarters→…)        (GET fantasyPts per player)
```

- **Resolution order:** sport config defaults → preset (PPR/Half/Standard) → TE
  premium injection (TEs only) → per-category commissioner overrides
  (`categoryPoints`). **Overrides always win** over presets/defaults.
- **Starters only:** `isScoringStarterSlot` excludes `bench/BN/IR/taxi/devy/
  reserve`. Only starter slots score.
- **Idempotent:** matchup recalc overwrites (never accumulates) and standings
  recompute from scratch, so repeated scoring never double-counts (proven by the
  engine E2E re-runs).

---

## 1. NFL scoring settings — verified

| Setting | Verified | Rule |
|---|---|---|
| Standard / Half PPR / Full PPR | ✅ | reception = 0 / 0.5 / 1.0 |
| Passing yards | ✅ | 0.04 / yd (decimal) |
| Passing TD 4 vs 6 | ✅ | default 4; `categoryPoints.pass_td=6` → 6 |
| Interceptions (negative) | ✅ | −2 |
| Passing bonuses | ✅ | +3 at ≥300 and ≥400 yds |
| Rushing yards / TD / 100-yd bonus | ✅ | 0.1/yd, 6, +3 at ≥100 |
| Receiving yards / TD / receptions / 100-yd bonus | ✅ | 0.1/yd, 6, preset, +3 at ≥100 |
| **TE Premium** | ✅ (fixed) | +0.5 / reception, **TEs only**, when enabled — see Fixes |
| Kicking (FG by distance, miss, XP) | ✅ | 0–39=3, 40–49=4, 50+=5, miss=−1, XP=1 |
| Fumbles (lost, recovery TD) | ✅ | −2, +6 |
| 2-point conversions | ✅ | +2 |
| Decimal scoring | ✅ | float math, rounded to 2dp at roster level |
| Negative scoring | ✅ | totals can go negative |
| Custom per-category overrides | ✅ | `categoryPoints` beats preset/default |
| Superflex | ✅ scoring-neutral | a QB scores the same in a QB or SF slot; SF counts as a starter |
| IDP (when enabled) | ✅ | solo 1, assist 0.5, sack 2, INT 6, PD 1, FF 3, FR 2, def TD 6, safety 2, TFL 1, QB hit 0.5 — and **0** when IDP off |
| **Team Defense / ST** | ✅ (engine) / ⚠️ data | categories + tier resolver added; DEF starters score. Points-allowed is derived from the real game result (`SportsGame`); sacks/INT/FR/TD need a per-team box-score feed (see G8 below). |
| **Return yards / TD** | ❌ gap G9 | no categories + no pipeline |

## 2. NCAAF scoring — honest, beta (not complete)

- NCAAF config **does** expose scoring categories (pass/rush/rec/def), and
  `scoreStatsWithCategories` scores them correctly where data exists — the engine
  is sport-agnostic.
- **But there is no NCAAF weekly stat pipeline.** `syncPlayerWeeklyScoresForRed
  raftSeason` throws for non-NFL, and the scoring runner **skips NCAAF with a
  `dataWarning`** (`SCORING_SUPPORTED_SPORTS = {'NFL'}`). NCAAF is never reported
  as scored.
- NCAAF preset names (`College PPR`…) don't map to the PPR/HALF/STANDARD reception
  resolver, so NCAAF reception points stay at the category default unless
  overridden (minor; moot until the pipeline exists).
- **We do not claim NCAAF scoring is complete.** It is structurally ready and
  data-blocked.

## 3. Bugs found

1. **TE Premium was inert (B1).** `normalizeNflWeeklyStats` never emits a
   `te_premium` stat, but the `te_premium` category scores off exactly that key —
   so enabling TE Premium added **0 points** in production.
2. **Team DEF/ST had no scoring (G8 — now addressed in the engine).** The NFL
   config previously had no team-defense categories and no team-defense stat
   pipeline, so every DEF starter scored 0. Fixed: see §10.
3. **Return yards/TD not scored (G9).** No categories, no pipeline.
4. **Lineup slots ignore commissioner roster config (G10).** `lineupValidation`
   uses static `starterSlots` (`QB/RB/WR/WR/TE/DEF`); enabling Superflex/extra
   FLEX/K/IDP slots or changing counts is not reflected in lineup validation.
   *Scoring is unaffected* (SF/FLEX slots still score), but the lineup validator
   doesn't honor the configured slots. Out of scope for G2 (roster config, not
   scoring) — documented for a later phase.

## 4. Bugs fixed (safe)

- **B1 — TE Premium now works (TE-only).** Added `applyTePremiumStat`: when the
  `te_premium` category is active and the player is a **TE**, inject
  `te_premium = receptions` before scoring (+0.5/reception). Non-TEs and
  TE-Premium-off leagues are unaffected → backward-compatible. Threaded an
  optional `position` through `calculateScoreFromSportConfig` at all three call
  sites (matchup scoring, score-sync, roster API). Proven via the DB path on
  staging: TE with 6 rec/80 yds = **17.0**, identical WR = **14.0**.

No other code changed — the scoring engine was **not** redesigned.

## 5. Tests added

`__tests__/redraft/commissioner-scoring-contract.test.ts` (21 pure tests):
presets; passing yards/TD value/INT/bonuses; rushing & receiving incl. bonuses;
TE premium (toggle + TE-only + `applyTePremiumStat`); kicking; fumbles; 2-pt;
IDP on/off (all categories); custom overrides beat presets; starters-only;
Superflex scoring-neutral; decimal & negative totals; **score-sync uses the same
path** (normalize → score equals direct score); NCAAF honest note; G10 lineup note.

`scripts/run-nfl-full-season-engine-e2e.ts` (DB, staging): **S1** TE premium via
the real `calculateScoreFromSportConfig` DB path (TE 17 / WR 14); **S2** custom
override (6-pt pass TD) + STANDARD (0 rec) = 18. Full run **16 PASS / 0 FAIL**.

## 6. Does commissioner custom scoring work?

**Yes**, for every NFL category that has a stat pipeline. Presets, per-category
overrides (`categoryPoints`), passing-TD value, PPR variants, TE premium, IDP,
kicking, bonuses, decimals, and negatives all change the output exactly as
configured, and overrides beat presets. The exceptions are team DEF/ST and return
scoring, which have no data pipeline (G8/G9).

## 7. Does score-sync use the same path?

**Yes.** `syncPlayerWeeklyScoresForRedraftSeason` →
`calculateScoreFromSportConfig` → `scoreStatsWithCategories`, and the matchup
scorer (`scoreRosterStarters`) and roster API use the identical function. The
contract test proves normalizing provider aliases then scoring equals scoring the
canonical stats directly.

## 8. Remaining scoring gaps

| # | Gap | Severity |
|---|---|---|
| ~~G8~~ | NFL **team Defense/ST** — **COMPLETE.** Engine + box-score ingestion + a **real weekly provider (Sleeper)** are wired (see §10): `GET /api/cron/import-nfl-team-defense` fetches Sleeper weekly DST stats for every rostered defense and ingests them; the score-sync then scores sacks/INT/FR/def TD/safety/blocked kicks/return TDs + points-allowed (provider value, or `SportsGame` fallback) + yards-allowed. Proven on staging (E2E D1–D6) and against the live Sleeper API. | ✅ Done (engine + feed); browser flow still gates readiness |
| ~~G9~~ | **Return yards/TD** — **COMPLETE.** Return TDs already scored via `def_st_td`; added `def_kr_yd` (kick) + `def_pr_yd` (punt) return-yard categories (default **0** — commissioner-enable), mapped Sleeper `def_kr_yd`/`def_pr_yd` in the DST normalizer, and bridged the surfaced panel keys (`st_kick_return_yards`/`st_punt_return_yards`). Proven: 8 pure tests + staging E2E D9 (panel enable → provider yards → DEF scores 6). | ✅ Done |
| ~~G10~~ | **COMPLETE.** `lineupValidation` now honors commissioner roster config via `resolveRedraftRosterConfig` (reads `settings.roster.config.sections[].slots`): starter slots/capacities (Superflex/FLEX/K/counts), flex/SF eligibility, DEF/K restrictions, and bench/IR/taxi limits + max roster size. Falls back to sport-config defaults when settings absent. Proven: 13 pure tests + staging E2E RC1 (SF config from DB → QB-in-SF validates). | ✅ Done |
| G4 | NCAAF weekly stat pipeline missing → NCAAF scoring beta. | Medium (NCAAF only) |
| — | NCAAF preset-name → reception mapping. | Low (moot until G4) |

## 9. Readiness

Commissioner **scoring correctness is now proven** for the NFL categories that have
data, a real inert-feature bug (TE premium) was fixed and verified on staging, and
score-sync is proven to use the same path. The previously High-severity team
DEF/ST gap (DEF starters scored 0) is **now addressed in the engine** (see §10):
DEF starters score, points-allowed is sourced from real game data, and the
residual is a per-team box-score feed. Net: NFL engine scoring is materially more
trustworthy. Readiness moves modestly and stays gated on the browser/customer flow
per the project rule.

## 10. G8 — Team Defense / ST scoring (added)

**What changed (additive, no scorer redesign):**

- **Categories** (`lib/sportConfig/configs/nfl.ts`, group `team_def`, always
  active, all commissioner-overridable): `def_sack` 1, `def_int` 2, `def_fr` 2,
  `def_safety` 2, `def_blk_kick` 2, `def_td` 6, `def_st_td` 6, **points-allowed
  tiers** (0→10, 1–6→7, 7–13→4, 14–20→1, 21–27→0, 28–34→−1, 35+→−4), and
  **yards-allowed tiers** (off by default — commissioner can value them).
- **Tier resolver** (`pointsForCategory`): a new `tierStatKey`/`tierMin`/`tierMax`
  category shape awards the tier's points when the single tier stat falls in
  `[min, max]`. Presence-checked so a real `0` (shutout) scores the top tier and
  *absent* data scores nothing. This mirrors the existing `minForBonus` mechanism
  — the core scorer was **not** redesigned, so overrides still beat defaults on
  every DST category (including each tier).
- **DEF "player".** A team defense is the synthetic pool row `nfl:def:<ABBR>`
  (position `DEF`/`DST`), already eligible for the required `DEF` starter slot.
- **Stat pipeline.** A *separate* `normalizeNflTeamDefenseWeeklyStats` maps the
  team-D provider aliases to `def_*` keys — kept separate from the offensive
  normalizer because `sack`/`int`/`fum_rec` mean opposite things for a QB vs a
  DST row. `syncPlayerWeeklyScoresForRedraftSeason` routes DEF rows through it,
  and **derives `def_points_allowed` from `SportsGame`** (a defense allows the
  opponent's final score — data we already ingest), so a DEF starter scores from
  real data even without a box-score feed.

**Provider sourcing — confirmed:** `SportsGame` carries final scores →
points-allowed is fully derivable today. Per-team **defensive box-score** stats
(sacks/INT/FR/def TD/safety/blocked kicks) and **yards-allowed** are not currently
ingested for the `nfl:def:<ABBR>` players (the Sleeper game-log import keys off
offensive player ids, not team defenses). Until that feed is wired, those
categories stay inert (score 0) rather than guessing — the engine is ready to
score them the moment `def_*` keys appear in the cache.

### Box-score feed ingestion (G8 residual — adapter built)

`lib/redraft/teamDefenseStatsIngest.ts` is the ingestion side of the feed:

- `ingestNflTeamDefenseBoxScores(prisma, { season, week, entries })` takes a
  provider's per-team defensive payload, normalizes it (`normalizeNflTeamDefense
  WeeklyStats`), and writes it into the cache the existing DEF score-sync already
  reads (`player_game_log_cache` for `nfl:def:<ABBR>`). The sync remains the **one
  writer** of the DEF `PlayerWeeklyScore` — no clobbering.
- **Idempotent + stat corrections:** `mergeWeekIntoTeamDefenseGameLog` replaces a
  week's entry in place (never appends), so re-ingesting corrected numbers
  re-scores on the next sync.
- **No fabrication:** an entry with no recognized DST keys is skipped — no
  zero-filled row is written.
- **Offense-safe / overrides:** only `nfl:def:*` cache rows are touched; per-league
  scoring still happens via `calculateScoreFromSportConfig`.

Proven on staging (engine E2E **D3–D5**): ingest a box score → sync → DEF scores
the full line (4 sack + 2 INT + 1 FR + 1 def TD + PA-tier 7 = **23**); a stat
correction (sacks 4→6) re-scores to **25**; an unrecognized payload writes/scores
nothing.

### Provider wired — Sleeper (G8 final)

**Audit result:** Sleeper supplies **real, weekly** (not season-aggregate) NFL
team-defense stats. A defense is keyed by its team abbreviation as the player id:
`GET https://api.sleeper.com/stats/nfl/player/<TEAM>?season_type=regular&season=<YYYY>&grouping=week`
→ per-week `{ sack, int, fum_rec, def_td, blk_kick, safe, def_st_td, pts_allow,
yds_allow, … }`. Rolling Insights only carries **season** team-defense aggregates;
`SportsGame.raw`/`team_game_stats`/`dw_team_game_facts` are empty — so Sleeper is
the source.

- `lib/redraft/teamDefenseProvider.ts`: `fetchSleeperTeamDefenseSeason` (live HTTP,
  rate-limited, 10 s timeout), pure `extractSleeperWeekStats`, and
  `syncNflTeamDefenseBoxScores` (fetch → ingest; **fetcher is dependency-injected**
  so tests/E2E use fixtures, production uses live Sleeper). `resolveRosteredDefense
  Teams` limits fetches to defenses that are actually rostered.
- `app/api/cron/import-nfl-team-defense` (cron-authed, `withSyncJobRun`, isolated
  failures, registered in `vercel.json` `30 * * * *` and `cronRegistry`): the
  scheduled feed.
- The only normalizer gap was Sleeper's `safe` key → fixed (`def_safety` now maps
  it).

**Proven:** pure tests against the real Sleeper payload shape; engine E2E **D6**
(provider→sync→score, provider `pts_allow` 31 overrides the game-derived fallback
3 → 6 pts) on staging; and a **live** call (`BAL` 2024 wk1 → `{def_sack:2, def_int:1,
def_points_allowed:27, def_yds_allowed:353}`). **No fabrication:** a team whose week
the provider omits is skipped with a warning.

Readiness is **not** raised — per the rule, NFL stays at 90 until the feed is
proven against staging (done) **and** the browser/customer flow is verified (still
pending).

**Tests:** `__tests__/redraft/team-defense-scoring-contract.test.ts` (16 pure
tests): every DST category, all points-allowed tier boundaries, shutout vs
no-data, full line, per-category + tier overrides, yards-allowed (inert→valued),
offense/defense non-contamination, the team-D normalizer (aliases, nested
payload, return-TD sum), points-allowed-from-game derivation, and DEF row
identity. E2E (`run-nfl-full-season-engine-e2e.ts`): **D1** DST line scores 20 via
the DB path; **D2** the real score sync derives points-allowed from a seeded game
result (allowed 3 → 7 pts).
