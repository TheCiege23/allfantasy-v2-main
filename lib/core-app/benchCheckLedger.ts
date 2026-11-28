import { hasAdviceDayColumn, recordAdvice, withdrawStaleMyTeamAdvice, MY_TEAM_BENCH_SURFACE } from '@/lib/chimmy-advice/adviceStore'
import { isAdviceDay } from '@/lib/chimmy-advice/adviceDay'
import { isNativePlatform } from '@/lib/league/isNativeLeague'

/**
 * The advice ledger's start/sit half (2026-11-14): My Team's bench check — the app's designated
 * "start X over Y" — written to `chimmy_advice` as it is shown, so it can be graded once the games are
 * played (scripts/advice-ledger-report.mjs).
 *
 * Until now the bench check was computed per render and kept nowhere (decisionRecordModel.ts says so),
 * so the app's main start/sit advice was the one piece of advice nobody could measure.
 *
 * WHAT IS RECORDED, AND WHEN — each rule is what keeps a grade honest:
 *   - Only a `swap` verdict (the projected gap clears BENCH_SWAP_POINTS). A `close` call is the screen
 *     saying "toss-up"; grading it as "start X" would grade something never said.
 *   - Only for the week being played: the projection feed's week must equal the real NFL week, or the
 *     call is about a week the screen is not actually showing.
 *   - Sleeper and native (AllFantasy-hosted) leagues: the grade reads each league's own weekly scores —
 *     the Sleeper import's, or our scoring engine's for a native league (source 'allfantasy', since
 *     2026-11-23) — keyed by the same Sleeper ids the roster uses (a native NFL roster holds Sleeper
 *     ids).
 *   - ESPN, NFL ONLY (2026-11-24): graded on ESPN's own week points (`espnPlayerWeekScoresWriter.ts`, source
 *     'espn'), stored already crosswalked to the canonical Sleeper id — the same `sleeperId` this records as
 *     the key. An ESPN NBA/NHL/MLB league stores no player scores, so its call is not recorded.
 *   - Yahoo, MFL and Fleaflicker store no weekly player scores, so a call there could never be graded and is
 *     not recorded. A league with no platform is not recorded either.
 *   - NFL: the week recorded is the NFL projection feed's week, which must equal the real NFL week.
 *   - NBA, NHL and MLB (2026-11-23): the week recorded is the one My Team PRICED the call for — the
 *     daily-sport outlook's period (`myTeamDailySport.ts`), on that sport's own calendar and season —
 *     never the NFL week. Before this a basketball league whose week number happened to equal the NFL's
 *     was recorded under an NFL week. Only a POINTS league records: a categories league has no period (no
 *     points to grade). Graded per sport (`sportBenchGrading.ts`), never in the NFL record.
 *   - A DAILY-lineup league (2026-11-23) prices one DAY. Its call is recorded under that day's week AND the
 *     day (`advice_day`, part of the unique key) — but only once `20261123120000_chimmy_advice_day` is
 *     applied. Before that it is not recorded at all (and nothing is withdrawn): filed under its week alone
 *     it would merge up to seven different calls into one row. Graded on that day's games.
 *   - Any other sport records nothing.
 *   - Each player's projection is stored with the call — what it knew.
 *   - A call this render no longer makes is WITHDRAWN, but only while both players' games are still
 *     to come: after a kickoff the bench check stops offering a swap because the game started, and the
 *     call that stood at kickoff is the one that counts.
 *   - Fire and forget: never awaited by the page, never thrown into it. `ADVICE_LEDGER_MY_TEAM=off`
 *     turns it off.
 */

export type BenchLedgerCall = {
  slot: string | null
  rec: { key: string; name: string; projected: number }
  alt: { key: string; name: string; projected: number }
}

export type BenchLedgerContext = {
  userId: string
  leagueId: string
  platform: string | null
  sport: string
  projectionWeek: { season: string | number; week: number } | null
  sportsWeek: { season: string | number; week: number } | null
  /**
   * NBA / NHL / MLB: the period the daily-sport outlook priced the lineup for (`applyDailySportToLineup`). Null in a
   * categories league or when nothing was priced; `kind: 'day'` in a daily-lineup league.
   */
  lineupPeriod?: { kind: 'day' | 'week'; week: number | null; season?: number | null; day?: string | null } | null
  /** Saved-roster or alert-preview renders do not show the bench check, so they record nothing. */
  fullRender: boolean
}

/** The sports whose bench calls are recorded on their own weekly calendar (the daily-sport outlook's period). */
export const WEEKLY_PERIOD_SPORTS: ReadonlySet<string> = new Set(['NBA', 'NHL', 'MLB'])

/**
 * PURE. The season and week to record under — plus the day, in a daily-lineup league — or null when this render must
 * record nothing. A `day` result still records nothing until the day column exists (`scheduleBenchCheckLedger`).
 */
export function benchLedgerWeek(
  ctx: BenchLedgerContext,
  env: NodeJS.ProcessEnv = process.env,
): { season: number; week: number; day?: string } | null {
  if (String(env['ADVICE_LEDGER_MY_TEAM'] ?? '').trim().toLowerCase() === 'off') return null
  if (!ctx.fullRender || !ctx.userId || !ctx.leagueId) return null
  const platform = String(ctx.platform ?? '').trim().toLowerCase()
  const sport = String(ctx.sport ?? '').trim().toUpperCase()
  const espnNfl = platform === 'espn' && sport === 'NFL'
  if (platform !== 'sleeper' && !espnNfl && !(platform !== '' && isNativePlatform(platform))) return null
  if (WEEKLY_PERIOD_SPORTS.has(sport)) {
    const lp = ctx.lineupPeriod
    if (!lp || (lp.kind !== 'week' && lp.kind !== 'day')) return null
    const season = Number(lp.season)
    if (lp.season == null || !Number.isInteger(season) || season < 1900) return null
    if (typeof lp.week !== 'number' || !Number.isInteger(lp.week) || lp.week < 1) return null
    if (lp.kind === 'day') return isAdviceDay(lp.day) ? { season, week: lp.week, day: lp.day } : null
    return { season, week: lp.week }
  }
  if (sport !== 'NFL') return null
  const p = ctx.projectionWeek
  const s = ctx.sportsWeek
  if (!p || !s) return null
  const season = Number(p.season)
  if (!Number.isInteger(season) || season !== Number(s.season) || p.week !== s.week) return null
  if (!Number.isInteger(p.week) || p.week < 1) return null
  return { season, week: p.week }
}

/**
 * Record this render's calls, then withdraw the ones it no longer makes. Never throws, never awaited.
 * `openPlayerKeys`: roster players whose games have not started (a bye counts as not started).
 */
export function scheduleBenchCheckLedger(
  ctx: BenchLedgerContext,
  calls: readonly BenchLedgerCall[],
  openPlayerKeys: readonly string[],
): void {
  const at = benchLedgerWeek(ctx)
  if (!at) return
  void (async () => {
    // 🛑 A day's call waits for the day column: before it, today's behaviour exactly — nothing recorded or withdrawn.
    if (at.day && !(await hasAdviceDayColumn())) return
    const day = at.day ? { day: at.day } : {}
    for (const c of calls) {
      await recordAdvice({
        userId: ctx.userId,
        leagueId: ctx.leagueId,
        sport: ctx.sport,
        season: at.season,
        week: at.week,
        adviceType: 'start_sit',
        surface: MY_TEAM_BENCH_SURFACE,
        rec: { key: c.rec.key, name: c.rec.name },
        alt: { key: c.alt.key, name: c.alt.name },
        slot: c.slot,
        confidencePct: null,
        projected: { rec: c.rec.projected, alt: c.alt.projected },
        ...day,
      })
    }
    await withdrawStaleMyTeamAdvice({
      userId: ctx.userId,
      leagueId: ctx.leagueId,
      season: at.season,
      week: at.week,
      keep: calls.map((c) => ({ rec: c.rec.key, alt: c.alt.key })),
      openPlayerKeys,
      ...day,
    })
  })().catch((err) => {
    console.warn('[advice-ledger] My Team bench check not recorded', err instanceof Error ? err.message : err)
  })
}
