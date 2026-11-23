import { recordAdvice, withdrawStaleMyTeamAdvice, MY_TEAM_BENCH_SURFACE } from '@/lib/chimmy-advice/adviceStore'
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
 *     ids). ESPN, Yahoo, MFL and Fleaflicker store no weekly player scores, so a call there could never
 *     be graded and is not recorded. A league with no platform is not recorded either.
 *   - NFL leagues only (2026-11-23). The week recorded is the NFL projection feed's week, and the grade
 *     decides "is the week over" from the NFL schedule. A basketball, hockey or baseball league whose own
 *     week number happened to equal the NFL's was recorded under an NFL week and graded on the NFL clock —
 *     a call about a different period. Until each sport is graded on its own calendar, nothing else is
 *     recorded (and the grade ignores any such row already stored: `loadBenchRows`, `foldLedger`).
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
  /** Saved-roster or alert-preview renders do not show the bench check, so they record nothing. */
  fullRender: boolean
}

/** PURE. The season and week to record under, or null when this render must record nothing. */
export function benchLedgerWeek(ctx: BenchLedgerContext, env: NodeJS.ProcessEnv = process.env): { season: number; week: number } | null {
  if (String(env['ADVICE_LEDGER_MY_TEAM'] ?? '').trim().toLowerCase() === 'off') return null
  if (!ctx.fullRender || !ctx.userId || !ctx.leagueId) return null
  const platform = String(ctx.platform ?? '').trim().toLowerCase()
  if (platform !== 'sleeper' && !(platform !== '' && isNativePlatform(platform))) return null
  if (String(ctx.sport ?? '').trim().toUpperCase() !== 'NFL') return null
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
      })
    }
    await withdrawStaleMyTeamAdvice({
      userId: ctx.userId,
      leagueId: ctx.leagueId,
      season: at.season,
      week: at.week,
      keep: calls.map((c) => ({ rec: c.rec.key, alt: c.alt.key })),
      openPlayerKeys,
    })
  })().catch((err) => {
    console.warn('[advice-ledger] My Team bench check not recorded', err instanceof Error ? err.message : err)
  })
}
