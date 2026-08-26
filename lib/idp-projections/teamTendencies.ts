import raw from '@/data/team-defense-tendencies.json'

/**
 * Opponent and scheme tendencies for a defence, derived from nflverse play-by-play and FTN
 * charting by `scripts/derive-team-defense-tendencies.ts`.
 *
 * ⚠ THESE DESCRIBE, THEY DO NOT PREDICT, AND THE DISTINCTION IS MEASURED. Adding these features
 * to the IDP projection model made it WORSE — MAE 4.681 and 4.696 against a 4.673 baseline over
 * 5,291 out-of-sample player-weeks. They are wired into the projector and default to strength
 * zero for that reason. So a surface may say "this defence blitzes on 14% of dropbacks" and may
 * NOT grade a matchup easy or tough: the grade would assert predictive power we went looking for
 * and did not find.
 *
 * ⚠ THE `Faced` SUFFIX IS LOAD-BEARING. `passRateFaced`, `playsFaced`, `thirdDownRateFaced` and
 * `secPerPlayFaced` describe what the OPPOSING OFFENCES did against this defence. `blitzRate`,
 * `meanPassRushers` and `meanDefendersInBox` carry no suffix because they describe what this
 * defence ITSELF does — which is the half a defender's own sack chances depend on. Labelling the
 * blitz rate as "faced" in a UI inverts its meaning.
 *
 * Imported statically rather than read with `fs`: the file is committed under `data/`, and a
 * static import is bundled at build time instead of depending on the deployment happening to
 * ship the path.
 */

export interface TeamDefenseTendency {
  teamId: string
  /** The season these describe. ALWAYS render it — coordinators change between years. */
  season: number
  /** Share of plays against this defence that were passes. */
  passRateFaced: number | null
  /** Share of third downs among plays faced. */
  thirdDownRateFaced: number | null
  /**
   * Total plays faced across the season.
   *
   * ⚠ A SEASON TOTAL, NOT A PER-GAME RATE. The source carries no games-played column, so a
   * per-game figure would require assuming a 17-game season and that the derivation excluded
   * the playoffs — two assumptions to manufacture one number nobody asked for.
   */
  playsFacedSeason: number | null
  /** Seconds per play faced — lower is a faster game and more chances. */
  secPerPlayFaced: number | null
  /** THIS defence's own blitz rate. Not "faced". */
  blitzRate: number | null
  /** THIS defence's own mean pass rushers and defenders in the box. */
  meanPassRushers: number | null
  meanDefendersInBox: number | null
}

interface RawRow {
  teamId?: unknown
  season?: unknown
  passRateFaced?: unknown
  thirdDownRateFaced?: unknown
  playsFaced?: unknown
  secPerPlayFaced?: unknown
  blitzRate?: unknown
  meanPassRushers?: unknown
  meanDefendersInBox?: unknown
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** Latest season first, so the newest row for a team wins. */
const ROWS: TeamDefenseTendency[] = (raw as RawRow[])
  .map((r) => ({
    teamId: String(r.teamId ?? '').toUpperCase(),
    season: typeof r.season === 'number' ? r.season : 0,
    passRateFaced: num(r.passRateFaced),
    thirdDownRateFaced: num(r.thirdDownRateFaced),
    playsFacedSeason: num(r.playsFaced),
    secPerPlayFaced: num(r.secPerPlayFaced),
    blitzRate: num(r.blitzRate),
    meanPassRushers: num(r.meanPassRushers),
    meanDefendersInBox: num(r.meanDefendersInBox),
  }))
  .filter((r) => r.teamId && r.season > 0)
  .sort((a, b) => b.season - a.season)

/**
 * The most recent tendencies on file for a team, or null.
 *
 * ⚠ THE MOST RECENT SEASON ON FILE IS NOT NECESSARILY THE CURRENT ONE. The derivation runs
 * against completed seasons, so during a season in progress this returns LAST year's behaviour.
 * That is usable — it is the best evidence available — but only if the caller renders
 * `season` beside it. Undated, it silently claims to describe a defence that may have changed
 * coordinators since.
 */
export function tendencyForTeam(teamId: string | null | undefined): TeamDefenseTendency | null {
  const key = String(teamId ?? '').trim().toUpperCase()
  if (!key) return null
  return ROWS.find((r) => r.teamId === key) ?? null
}

/** Every team's latest row, for callers that need the whole league at once. */
export function latestTendencies(): TeamDefenseTendency[] {
  const seen = new Set<string>()
  const out: TeamDefenseTendency[] = []
  for (const r of ROWS) {
    if (seen.has(r.teamId)) continue
    seen.add(r.teamId)
    out.push(r)
  }
  return out
}
