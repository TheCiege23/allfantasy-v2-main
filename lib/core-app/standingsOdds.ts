import type { OutlookLeague, SwingMatchup } from './seasonOutlook'

/**
 * Season Outlook's numbers, narrowed to what the standings table prints beside each team.
 *
 * PURE and CLIENT-SAFE: it imports only types, so `StandingsBoardView` can take the result as a prop.
 *
 * ⚠ NOT A SECOND MODEL. Playoff odds, strength of schedule and the week's stakes all come from the one
 * stored per-league simulation Season Outlook runs (`seasonOutlookSims.ts`), which is seeded and shared
 * across every viewer of the league. So the percentage on this table and the one on Season Outlook are
 * the same number, and the standings page's own projected W-L column stays labelled as the different,
 * deterministic thing it is.
 *
 * ⚠ THE OUTLOOK SEEDS ON WINS, THEN POINTS FOR. It does not model median games, ties or head-to-head
 * tiebreaks, so its own "clinched" can disagree with this table's. The simulation's status is
 * therefore NOT carried here: "In" and "Out" are printed only from this table's arithmetic (see
 * `formatOdds`), and the simulation contributes percentages alone.
 */

export type StandingsOddsTeam = {
  playoffPct: number
  byePct: number
  /** False when the team has too few completed weeks to model — its percentage is a prior, not a read. */
  modelled: boolean
  /** 1 = the hardest remaining schedule in the league. Null when not rankable. */
  sosRank: number | null
  /** Mean fitted weekly score of the opponents still to play. */
  sosOpponentMu: number | null
}

export type StandingsStakesGame = {
  a: { id: string; name: string | null }
  b: { id: string; name: string | null }
  ifA: number
  ifB: number
  rootFor: string
}

export type StandingsStakes = {
  week: number
  opponentName: string | null
  ifWin: number
  ifLose: number
  clinchOnWin: boolean
  /** Teams whose missing the playoffs most helps you if you lose. */
  helpIfLose: string[]
  /** Null when the board predates the rooting guide, which is not the same as "no game matters". */
  rooting: StandingsStakesGame[] | null
}

export type StandingsOdds = {
  byRoster: Record<string, StandingsOddsTeam>
  /** How many teams have a rankable remaining schedule — the denominator for `sosRank`. */
  sosRanked: number
  /** Mean fitted weekly score across the league, the yardstick for `sosOpponentMu`. */
  leagueMu: number | null
  iterations: number
  /** Your own odds, when we know which team is yours. */
  you: { rosterId: string; playoffPct: number; whatDecidesIt: string } | null
  stakes: StandingsStakes | null
  /** The simulation's basis, as Season Outlook prints it. */
  basis: string
  /** Season Outlook for this league. */
  href: string
}

export function toStandingsOdds(league: OutlookLeague, swing: SwingMatchup | null, basis: string): StandingsOdds {
  const byRoster: Record<string, StandingsOddsTeam> = {}
  for (const t of league.teams) {
    byRoster[t.rosterId] = {
      playoffPct: t.playoffPct,
      byePct: t.byePct,
      modelled: t.modelled,
      sosRank: t.schedule?.remainingRank ?? null,
      sosOpponentMu: t.schedule?.remainingOpponentMu ?? null,
    }
  }
  const leagueMu = league.teams.find((t) => t.schedule?.leagueMu != null)?.schedule?.leagueMu ?? null
  return {
    byRoster,
    sosRanked: league.teams.filter((t) => t.schedule?.remainingRank != null).length,
    leagueMu,
    iterations: league.assumptions.iterations,
    you: league.you ? { rosterId: league.you.rosterId, playoffPct: league.you.playoffPct, whatDecidesIt: league.whatDecidesIt } : null,
    stakes:
      swing && swing.leagueId === league.leagueId
        ? {
            week: swing.week,
            opponentName: swing.opponentName,
            ifWin: swing.ifWin,
            ifLose: swing.ifLose,
            clinchOnWin: swing.clinchOnWin,
            helpIfLose: swing.helpIfLose,
            rooting: swing.rooting
              ? swing.rooting.map((g) => ({
                  a: { id: g.a, name: g.aName },
                  b: { id: g.b, name: g.bName },
                  ifA: g.ifA,
                  ifB: g.ifB,
                  rootFor: g.rootFor,
                }))
              : null,
          }
        : null,
    basis,
    href: `/core/season-outlook?league=${encodeURIComponent(league.leagueId)}`,
  }
}

/**
 * A playoff percentage as printed: whole numbers, with the ends kept honest. A simulated 99.6% is not
 * a clinch, so it reads ">99%", never "100%" — and zero runs out of thousands is not elimination
 * either, so it reads "<1%". Only the arithmetic `status` earns "In" or "Out".
 */
export function formatOdds(pct: number, status: 'clinched' | 'eliminated' | null = null): string {
  if (status === 'clinched') return 'In'
  if (status === 'eliminated') return 'Out'
  if (pct > 99) return '>99%'
  if (pct < 1) return '<1%'
  return `${Math.round(pct)}%`
}
