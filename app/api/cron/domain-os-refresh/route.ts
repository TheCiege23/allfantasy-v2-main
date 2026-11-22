import { currentNflSeason } from '@/lib/follows/followFreeAgentCheck'
import { NextResponse, type NextRequest } from 'next/server'

import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { createRunBudget } from '@/lib/cron/runBudget'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { createOsStore, type OsDomain } from '@/lib/decision-os/domain-os'
import { createValueOs, marketValueSource, devyValueSource } from '@/lib/decision-os/value-os'
import { createProjectionOs, canonicalProjectionSource } from '@/lib/decision-os/projection-os'
import {
  runRankingsSweep,
  emptyRankingsSweepCounts,
  type RankingsSweepCounts,
} from '@/lib/rankings-engine/rankingsSweep'
import {
  runMatchupOddsSweep,
  emptyMatchupOddsSweepCounts,
  type MatchupOddsSweepCounts,
} from '@/lib/core-app/matchupOddsSweep'
import {
  runRankingsDailySnapshot,
  emptyRankingsSnapshotCounts,
  type RankingsSnapshotCounts,
} from '@/lib/core-app/rankingsCommunity'
import { runClassRatingDaily, emptyClassRatingCounts, type ClassRatingCounts } from '@/lib/class-rating/run'
import {
  runForecastSweep,
  emptyForecastSweepCounts,
  type ForecastSweepCounts,
} from '@/lib/season-forecast/forecastSweep'
import {
  runPortfolioDailyTotals,
  emptyPortfolioTotalsCounts,
  type PortfolioTotalsCounts,
} from '@/lib/core-app/portfolioInsightsSummary'
import {
  runOutlookPrewarm,
  emptyOutlookPrewarmCounts,
  type OutlookPrewarmCounts,
} from '@/lib/core-app/seasonOutlookPrewarm'

/**
 * GET /api/cron/domain-os-refresh
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 *
 * THE GATHERING HALF OF THE DOMAIN OS FEEDS. `OsFeed` has always exposed two methods — `get`
 * (read-through) and `refresh` (populate without reading) — and until now **nothing anywhere in
 * this repository called `refresh`**. A search across `lib/`, `app/api/cron/` and `scripts/`
 * returned zero callers, which `waiver-os/index.ts` had already predicted in its own words:
 *
 *     "The 6h league entry is not dead — it is a refresh() target for a scheduler that does not
 *      exist yet (see OsFeed.refresh: 'the gathering half; it needs a scheduler')."
 *
 * The consequence was not a broken feature, which is why it survived: reads still worked, because
 * `get` derives on a miss. But every league-level fact was re-derived per USER instead of once per
 * league, so the entire saving the level split exists to produce was never collected.
 *
 * ── 🛑 THE PER-LEAGUE WALK IS RETIRED (owner's call, 2026-11-17) ────────────────────────────
 *
 * This route used to walk up to 200 NFL leagues every 30 minutes and warm two league-keyed entries
 * in `domain_os_facts`: Draft OS's `draftRulesSource` and Waiver OS's `waiverSettingsSource`. Both
 * were WRITES WITH NO READ. The draft entry's only consumer, `resolveNflRedraftDraftRuntime`, was
 * deleted on 2026-09-06 (see `lib/decision-os/draft-os/index.ts`); the waiver loader reads through
 * `waiverResourceSource`, never the settings entry (`lib/decision-os/waiver-os/index.ts`). So each
 * fire spent a league query plus up to 400 derives filling a cache nothing served.
 *
 * Removing it also removed the walk's early `return` when no NFL league qualified — which used to
 * skip every sweep below it (rankings, forecast, odds, portfolio, outlook) on such a fire. The
 * history of why those two sources were the only eligible ones (league-id derive, league-id scope,
 * a TTL a 30-minute fire can keep warm) is in git; it is the test to apply before adding a
 * league-keyed warm here again, and the first question is whether anything reads it.
 *
 * What remains is the app-level walk (market values, devy values, projections — keyed by
 * sport/format, each serving every league) and the dedicated writers below it.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Upper bound on app-level combinations warmed per fire (R3.2).
 *
 * ⚠ A CAP ON A SET THAT IS CURRENTLY FOUR. `PlayerValueSnapshot` holds exactly
 * DYNASTY/REDRAFT x ONE_QB/SUPERFLEX today, so this never binds — it exists so a data anomaly
 * (a bad import writing a hundred format strings) cannot turn a bounded walk into an unbounded
 * one. A cap that never fires is the point; the day it fires, something upstream is wrong.
 */
const APP_COMBO_CAP = 24

/** Devy values only exist for college football. Warming them for NFL would derive nothing. */
const DEVY_SPORTS = ['NCAAF'] as const

type RefreshCounts = {
  considered: number
  due: number
  written: number
  unavailable: number
  /**
   * Derived fine, the store would not take it.
   *
   * ⚠ REPORTED SEPARATELY BECAUSE IT NEEDS A DIFFERENT RESPONSE. `unavailable` is upstream and
   * usually transient; a non-zero `writeFailed` is a schema, permissions or capacity problem that
   * will not resolve on its own — and while this field did not exist, every one of them was
   * counted as `written`.
   */
  writeFailed: number
  failed: number
  skippedForTime: number
  errors: string[]
  /**
   * The rankings sweep's own outcomes, kept SEPARATE from the feed counts above.
   *
   * 🛑 NOT FOLDED IN, AND THAT IS THE POINT. The fields above count `domain_os_facts` writes; these
   * count `rankings_snapshots` writes. Summing them would produce a `written` that means neither,
   * and the whole reason this sweep exists is that a number nobody can attribute is how three
   * empty tables went unnoticed for months.
   */
  rankings: RankingsSweepCounts
  /**
   * The forecast sweep's own outcomes, kept SEPARATE from both sets above.
   *
   * 🛑 THREE WRITERS, THREE COUNTS. These count `season_forecast_snapshots` writes; `rankings`
   * counts `rankings_snapshots`; the fields above count `domain_os_facts`. Summing any two
   * produces a number that means neither, and a number nobody can attribute is exactly how this
   * three-table chain sat empty for months.
   */
  forecast: ForecastSweepCounts
  /**
   * The pre-game odds snapshot's outcomes (`matchup_odds_snapshots`), a fourth writer with its own
   * counts for the same reason as the three above. `unavailable: 1` means the table's migration is
   * still parked; `outsideWindow: 1` means the fire fell while last week may still be in play.
   */
  odds: MatchupOddsSweepCounts
  /**
   * The daily community-rankings snapshot (`sportsDataCache` key `core-rankings:daily:v1:<date>`),
   * a fifth writer with its own counts. `alreadyWritten: 1` is the normal state for every fire after
   * the first of the Eastern day; `written: 0 && alreadyWritten: 0 && failed: 0` means it is disabled.
   */
  snapshot: RankingsSnapshotCounts
  /**
   * The daily portfolio value record (`sportsDataCache` key `core-portfolio:totals:v1:<date>:u=<id>`),
   * a sixth writer with its own counts. `deferred > 0` is normal early in the Eastern day — users
   * are built ten per fire — and `written: 0 && alreadyWritten === considered` is a finished day.
   */
  portfolio: PortfolioTotalsCounts
  /**
   * The Season Outlook pre-compute (`sportsDataCache` key `core-outlook:league:v1:<platformLeagueId>`),
   * a seventh writer. `computed` counts leagues re-run because their inputs changed; `unchanged`
   * counts leagues whose rows were rewritten by a sync with the same content — the common case.
   */
  outlook: OutlookPrewarmCounts
  /**
   * The Class rating (ADR F2.10a), an eighth writer: `manager_ratings` and
   * `manager_rating_events`. `skipped: 'already_ran_today'` is the normal state after the first
   * fire of the Eastern day, and `'unchanged_input'` the normal first fire outside a new week.
   */
  classRating: ClassRatingCounts
}

export async function GET(req: NextRequest) {
  // Name CRON_SECRET explicitly: a bare requireCronAuth checks LEAGUE_CRON_SECRET first and 401s
  // whenever that is set to something else (the #284/#289 production regression).
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await withSyncJobRun(
    { jobName: 'cron-domain-os-refresh', sport: 'NFL', trigger: 'cron' },
    () => run(),
    /*
     * 🛑 THE COUNT AND THE STATUS BOTH HAVE TO MOVE, OR THE FIX IS HALF DONE.
     *
     * Counting `writeFailed` in `run()` while this block still reported `success` would leave the
     * signal in a field nobody reads — the same "seam with no consumer" shape that let the
     * original bug live. A run in which EVERY write failed used to satisfy `r.failed === 0` and
     * report `status: 'success'` with `rowsWritten: N`.
     *
     * ⚠ `writeFailed` is NOT folded into `rowsSkipped`. Skipped means "we chose not to do this";
     * a rejected write means "we tried and the store refused". Filing one as the other is how a
     * schema problem reads as a budget decision.
     */
    (r) => ({
      rowsRead: r.considered,
      /*
       * ⚠ BOTH WRITERS, SUMMED ONLY HERE. `rowsWritten` is the telemetry row's single headline, so
       * it has to account for every row this fire persisted — `domain_os_facts` AND
       * `rankings_snapshots`. The per-writer numbers stay separate in `metadata.rankings` below,
       * because a total nobody can attribute is exactly how three empty tables went unnoticed.
       */
      // ⚠ One line each, on purpose: three wiring tests pin these sums as written.
      rowsWritten: r.written + r.rankings.written + r.forecast.written + r.odds.written + r.snapshot.written + r.portfolio.written + r.outlook.computed,
      rowsSkipped:
        r.skippedForTime + r.unavailable +
        r.rankings.skippedForTime + r.rankings.skipped +
        r.forecast.skippedForTime + r.forecast.pastSeasonEnd +
        r.portfolio.deferred +
        r.outlook.deferred +
        r.odds.skippedForTime,
      errors: [...r.errors, ...r.rankings.errors, ...r.forecast.errors, ...r.odds.errors, ...r.snapshot.errors, ...r.portfolio.errors, ...r.outlook.errors, ...r.classRating.errors],
      /*
       * A rankings `failed` is a genuine fault and downgrades the run, the same as a feed failure.
       * `skipped` does NOT: a league whose settings Sleeper will not serve is a normal single-league
       * outcome, and reporting it as partial would make every fire partial forever.
       */
      status:
        r.failed > 0 || r.writeFailed > 0 || r.rankings.failed > 0 || r.forecast.failed > 0 || r.odds.failed > 0 ||
        r.snapshot.failed > 0 || r.portfolio.failed > 0 || r.outlook.failed > 0 || r.classRating.failed > 0
          ? 'partial'
          : 'success',
      metadata: {
        due: r.due,
        unavailable: r.unavailable,
        writeFailed: r.writeFailed,
        failed: r.failed,
        /*
         * The sweep's own outcomes, unsummed. `attempted > 0 && written === 0` is the shape that
         * means the writer ran and produced nothing — the thing a green cron would otherwise hide.
         */
        rankings: {
          considered: r.rankings.considered,
          due: r.rankings.due,
          written: r.rankings.written,
          skipped: r.rankings.skipped,
          emptyRoster: r.rankings.emptyRoster,
          failed: r.rankings.failed,
          skippedForTime: r.rankings.skippedForTime,
        },
        /*
         * The forecast sweep's outcomes, unsummed for the same reason. `due > 0 && written === 0`
         * is the shape that means the writer ran and produced nothing; `pastSeasonEnd` is separated
         * from `declined` so that late season — when every league is past the engine's 14-week
         * default — does not read as a broken engine.
         */
        forecast: {
          considered: r.forecast.considered,
          due: r.forecast.due,
          written: r.forecast.written,
          pastSeasonEnd: r.forecast.pastSeasonEnd,
          declined: r.forecast.declined,
          failed: r.forecast.failed,
          skippedForTime: r.forecast.skippedForTime,
        },
        /*
         * The community-rankings snapshot, unsummed. Movement on /core/rankings is only ever read
         * from these, so a day with `failed: 1` is a day with no 7-day comparison a week later.
         */
        snapshot: {
          date: r.snapshot.date,
          written: r.snapshot.written,
          alreadyWritten: r.snapshot.alreadyWritten,
          ranked: r.snapshot.population,
          failed: r.snapshot.failed,
          levelsRefreshed: r.snapshot.levelsRefreshed,
          levelsRefreshFailed: r.snapshot.levelsRefreshFailed,
          levelsDeferred: r.snapshot.levelsDeferred,
        },
        /*
         * The daily portfolio value record, unsummed. The /core/portfolio chart draws a stored day
         * as "recorded" and falls back to a reconstruction where none exists, so a user stuck in
         * `deferred` shows estimated history rather than a gap.
         */
        /*
         * The Season Outlook pre-compute, unsummed. `due > 0 && computed === 0 && unchanged === 0` is
         * the silent no-op; `candidates` far above `due` is normal (syncs rewrite unchanged rows).
         */
        outlook: {
          candidates: r.outlook.candidates,
          due: r.outlook.due,
          cooling: r.outlook.cooling,
          computed: r.outlook.computed,
          unchanged: r.outlook.unchanged,
          skipped: r.outlook.skipped,
          deferred: r.outlook.deferred,
          failed: r.outlook.failed,
        },
        portfolio: {
          date: r.portfolio.date,
          considered: r.portfolio.considered,
          written: r.portfolio.written,
          alreadyWritten: r.portfolio.alreadyWritten,
          empty: r.portfolio.empty,
          deferred: r.portfolio.deferred,
          failed: r.portfolio.failed,
        },
        /*
         * The pre-game odds snapshot, unsummed. `unavailable: 1` is the parked migration, not a
         * fault; `due > 0 && written === 0` with nothing unprojected or started is the silent no-op.
         */
        odds: {
          outsideWindow: r.odds.outsideWindow,
          unavailable: r.odds.unavailable,
          considered: r.odds.considered,
          due: r.odds.due,
          written: r.odds.written,
          leaguesWritten: r.odds.leaguesWritten,
          started: r.odds.started,
          unprojected: r.odds.unprojected,
          failed: r.odds.failed,
          skippedForTime: r.odds.skippedForTime,
        },
        /*
         * The Class rating, unsummed. `rebuilt: 1` happens about weekly in season; a long run of
         * `unchanged_input` through the season means no new week is being rated — check that the
         * leagues' stated week is advancing, because that is what releases a finished week.
         */
        classRating: {
          date: r.classRating.date,
          skipped: r.classRating.skipped,
          rebuilt: r.classRating.rebuilt,
          games: r.classRating.games,
          people: r.classRating.people,
          established: r.classRating.established,
          events: r.classRating.events,
          ms: r.classRating.ms,
          failed: r.classRating.failed,
          recapQueued: r.classRating.recapQueued,
          recapSent: r.classRating.recapSent,
          recapFailed: r.classRating.recapFailed,
        },
      },
    }),
  )

  return NextResponse.json(result)
}

/**
 * R3.2 — the SECOND walk: app-level sources, keyed sport+format rather than by league.
 *
 * ── 🛑 WHY THE (NOW RETIRED) LEAGUE WALK COULD NEVER REACH THESE ───────────────────────────
 * That walk took sources keyed by league id alone. `marketValueSource` takes
 * `{ sport, format, qbFormat }`, `devyValueSource` takes `{ sport, currentSeason }` and
 * `canonicalProjectionSource` takes `{ sport, season, week? }` — none is satisfiable from a league
 * id, so none could ever be a member of that list. They were not omitted by oversight; they are a
 * different shape of walk.
 *
 * The cost of that was measured on 2026-09-03: `domain_os_facts` held 125 lineup rows and 223 each
 * for waiver and draft, all minutes old — against **1 projection row and 2 value rows, nine hours
 * stale**. Those few existed only because a read-through populated them on demand. Every other
 * request paid a live derive.
 *
 * ── ✅ THE COMBINATION SET IS MEASURED, NOT GUESSED ─────────────────────────────────────────
 * The obvious approach — expand sport x isDynasty x qbFormat from the league table — warms
 * combinations that cannot be served. `marketAdapter` reads `PlayerValueSnapshot` filtered on
 * `format`/`qbFormat`, so a combination with no snapshot rows derives nothing however many leagues
 * use it. So the set comes from the SNAPSHOT table: exactly the combinations that can produce an
 * answer, and it stays correct as the data changes rather than drifting from a hardcoded list.
 *
 * ── ⚠ IT RUNS FIRST, AND THAT IS A PRIORITY DECISION ────────────────────────────────────────
 * One app-level fact serves every league — 249 of them when this was written. If the run budget
 * exhausts mid-fire, the market combinations are worth more than anything that serves one league.
 */
async function refreshAppSources(counts: RefreshCounts, budget: ReturnType<typeof createRunBudget>): Promise<void> {
  const store = createOsStore()
  const valueOs = createValueOs({ store })
  const projectionOs = createProjectionOs({ store })

  const combos = await prisma.playerValueSnapshot
    .findMany({ select: { format: true, qbFormat: true }, distinct: ['format', 'qbFormat'], take: APP_COMBO_CAP })
    .catch((e: unknown) => {
      counts.errors.push(`value_combo_query: ${e instanceof Error ? e.message : String(e)}`)
      return [] as { format: string; qbFormat: string }[]
    })

  /*
   * The football season, not the calendar year (2026-11-20 re-score). In January and February a league still plays —
   * and asks for — LAST year's season (the playoffs, the Super Bowl window, the NCAAF bowls), so a calendar-year key
   * warmed 2027 entries that no league read while the 2026 ones went cold. Same rule the follow-alert check uses.
   */
  const season = currentNflSeason(new Date())

  type Unit = { domain: OsDomain; label: string; run: () => Promise<'written' | 'unavailable' | 'write_failed'> }
  const units: Unit[] = [
    ...combos.map((c) => ({
      domain: 'value' as OsDomain,
      label: `market:NFL:${c.format}:${c.qbFormat}`,
      run: () => valueOs.refresh(marketValueSource, { sport: 'NFL', format: c.format, qbFormat: c.qbFormat }),
    })),
    ...DEVY_SPORTS.map((sp) => ({
      domain: 'value' as OsDomain,
      label: `devy:${sp}:${season}`,
      run: () => valueOs.refresh(devyValueSource, { sport: sp, currentSeason: season }),
    })),
    {
      domain: 'projection' as OsDomain,
      label: `projection:NFL:${season}`,
      /*
       * ⚠ SEASON-SCOPED, NOT WEEK-SCOPED, DELIBERATELY. `scopeKey` falls back to the literal
       * 'season' when `week` is absent, and `writeAfProjectionSnapshots` runs once a day — so a
       * per-week warm would write 18 entries for a fact that changes daily.
       */
      run: () => projectionOs.refresh(canonicalProjectionSource, { sport: 'NFL', season }),
    },
  ]

  for (const u of units) {
    // `exhausted()` is the budget's actual surface — there is no `hasTimeFor`. The sweeps below make
    // the same call, so every part of the fire stops on the same signal.
    if (budget.exhausted()) { counts.skippedForTime += 1; continue }
    counts.considered += 1
    counts.due += 1
    try {
      const outcome = await u.run()
      if (outcome === 'written') counts.written += 1
      else if (outcome === 'write_failed') counts.writeFailed += 1
      else counts.unavailable += 1
    } catch (e) {
      counts.failed += 1
      if (counts.errors.length < 10) {
        counts.errors.push(`${u.domain}/${u.label}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
}

async function run(): Promise<RefreshCounts> {
  const budget = createRunBudget()
  const counts: RefreshCounts = {
    considered: 0, due: 0, written: 0, unavailable: 0, writeFailed: 0, failed: 0, skippedForTime: 0, errors: [],
    rankings: emptyRankingsSweepCounts(),
    forecast: emptyForecastSweepCounts(),
    odds: emptyMatchupOddsSweepCounts(),
    snapshot: emptyRankingsSnapshotCounts(),
    portfolio: emptyPortfolioTotalsCounts(),
    outlook: emptyOutlookPrewarmCounts(),
    classRating: emptyClassRatingCounts(),
  }

  // R3.2 — app-level sources first; see the note on refreshAppSources for why the order matters.
  await refreshAppSources(counts, budget)

  /*
   * ── THE DAILY RANKINGS SNAPSHOT ─────────────────────────────────────────────────────────────
   *
   * ⚠ IT USED TO HAVE TO RUN BEFORE THE PER-LEAGUE WALK, whose early return (no NFL league) skipped
   * everything after it. That walk is retired (see the header), so no writer here can be skipped by
   * another's empty result. It is one existence read per fire and, on the
   * first fire of each Eastern day, one ledger read and one upsert — so it does not need the budget
   * the sweeps below compete for. It never throws; a failure is counted and the run continues.
   */
  counts.snapshot = await runRankingsDailySnapshot().catch((e: unknown) => {
    const out = emptyRankingsSnapshotCounts()
    out.failed = 1
    out.errors.push(`rankings_snapshot: ${e instanceof Error ? e.message : String(e)}`)
    return out
  })

  /*
   * ── THE CLASS RATING (ADR F2.10a) ───────────────────────────────────────────────────────────
   *
   * Every fire
   * but the first of the Eastern day is one state read; the first reads the matchup facts and
   * rebuilds only when they changed (about weekly). It takes the budget it needs from the fire
   * and stands down for the next one when too little is left. It never throws.
   */
  counts.classRating = await runClassRatingDaily(new Date(), { remainingMs: () => budget.remainingMs() }).catch(
    (e: unknown) => {
      const out = emptyClassRatingCounts()
      out.failed = 1
      out.errors.push(`class_rating: ${e instanceof Error ? e.message : String(e)}`)
      return out
    },
  )

  // The per-league draft/waiver warm that stood here is retired — see the header. Nothing read it.

  /*
   * ── THE RANKINGS SWEEP, LAST AND ON THE LEFTOVER BUDGET ────────────────────────────────────
   *
   * 🛑 ORDER IS DELIBERATE. Everything above is a handful of indexed Postgres reads; this is ~6
   * LIVE Sleeper calls per league. Running it first would let a slow provider spend the budget the
   * feed warming needs, and the feeds are what 244 warm scopes depend on. Running it last means
   * the expensive, newest thing yields to the cheap, proven thing — and `runRankingsSweep` reports
   * `skippedForTime` rather than silently doing less.
   *
   * ⚠ IT SHARES THE BUDGET RATHER THAN TAKING ITS OWN. A second independent budget would let the
   * two halves sum past the window this cron shares with thirteen other sub-hourly jobs, two of
   * them on a two-minute cadence. One budget, checked between units by both halves, is the only
   * version that
   * bounds the whole fire.
   *
   * Off unless `DECISION_OS_RANKINGS_SWEEP_ENABLED` is true, and the flag is read at the sweep's
   * own boundary — flag-off costs no League read and no Sleeper call.
   */
  counts.rankings = await runRankingsSweep({ budget }).catch((e: unknown) => {
    /*
     * The sweep isolates per league internally, so reaching here means something structural — the
     * League query, or the module itself. It must not fail the feed refresh that already
     * succeeded above, so it is recorded and the run still reports its real feed counts.
     */
    const out = emptyRankingsSweepCounts()
    out.errors.push(`rankings_sweep: ${e instanceof Error ? e.message : String(e)}`)
    return out
  })

  /*
   * ── THE FORECAST SWEEP, AFTER THE RANKINGS SWEEP AND ON WHAT IS LEFT ───────────────────────
   *
   * 🛑 IT MUST RUN AFTER, NOT BEFORE, AND NOT INSTEAD. It can only forecast a league-week that
   * ALREADY has a rankings snapshot, so running it first would forecast last fire's leagues and
   * leave this fire's newly-ranked ones for thirty minutes later. Running it after means a league
   * ranked seconds ago is eligible in the same fire.
   *
   * ⚠ AND IT IS THE CHEAP HALF, WHICH IS WHY IT GOES LAST RATHER THAN FIGHTING FOR THE BUDGET.
   * The rankings sweep is ~1.4s/league of live Sleeper calls; this is ~62-85ms of local CPU plus a
   * handful of indexed reads and NO external calls at all. Same shared budget, checked between
   * units — a second budget would let the halves sum past the window this cron shares with
   * thirteen other sub-hourly jobs.
   *
   * Off unless `DECISION_OS_FORECAST_SWEEP_ENABLED` is true, read at the sweep's own boundary —
   * flag-off costs not one row read and not one simulation.
   */
  counts.forecast = await runForecastSweep({ budget }).catch((e: unknown) => {
    /*
     * The sweep isolates per unit internally, so reaching here means something structural. It must
     * not fail the feed refresh and rankings sweep that already succeeded, so it is recorded and
     * the run still reports their real counts.
     */
    const out = emptyForecastSweepCounts()
    out.errors.push(`forecast_sweep: ${e instanceof Error ? e.message : String(e)}`)
    return out
  })

  /*
   * ── THE PRE-GAME ODDS SNAPSHOT, LAST ────────────────────────────────────────────────────────
   *
   * Postgres rows and arithmetic, no provider calls, so it goes last on the same shared budget and
   * yields to everything above. Dormant (`unavailable: 1`, no matchup rows read) until the
   * `matchup_odds_snapshots` migration is applied; a no-op Sunday–Tuesday 06:00 ET.
   */
  counts.odds = await runMatchupOddsSweep({ budget }).catch((e: unknown) => {
    const out = emptyMatchupOddsSweepCounts()
    out.failed = 1
    out.errors.push(`odds_sweep: ${e instanceof Error ? e.message : String(e)}`)
    return out
  })

  /*
   * ── THE DAILY PORTFOLIO VALUE RECORD, LAST OF ALL ───────────────────────────────────────────
   *
   * The newest writer here, so it yields to every proven one — the same rule the rankings sweep
   * follows. Postgres only (lib/core-app/portfolioInsights.ts has no provider call and no lib/auth
   * in its import graph), bounded to ten users and 45s per fire on top of the shared budget, and
   * it never throws. `CORE_PORTFOLIO_TOTALS_DISABLED=true` turns it off.
   */
  counts.portfolio = await runPortfolioDailyTotals(new Date(), { budget }).catch((e: unknown) => {
    const out = emptyPortfolioTotalsCounts()
    out.failed = 1
    out.errors.push(`portfolio_totals: ${e instanceof Error ? e.message : String(e)}`)
    return out
  })

  /*
   * ── THE SEASON OUTLOOK PRE-COMPUTE, AFTER EVERYTHING ELSE ───────────────────────────────────
   *
   * The newest writer, so it yields to all of the above. Re-runs the leagues whose matchup rows a
   * sync rewrote AND whose inputs actually changed, so the first visit after games are scored reads
   * a stored run. Postgres and arithmetic only — its import graph has no provider call and no
   * lib/auth (checked with a bundler graph, with `lib/core-app/rankings.ts` as the positive control).
   * Twelve leagues / 30s per fire on top of the shared budget; never throws.
   * `CORE_OUTLOOK_PREWARM_DISABLED=true` turns it off.
   */
  counts.outlook = await runOutlookPrewarm(new Date(), { budget }).catch((e: unknown) => {
    const out = emptyOutlookPrewarmCounts()
    out.failed = 1
    out.errors.push(`outlook_prewarm: ${e instanceof Error ? e.message : String(e)}`)
    return out
  })

  return counts
}
