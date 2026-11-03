import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadLatestPlayerValueSnapshots } from '@/lib/player-values/latestPlayerValueSnapshots'
import { bridgeImportedGameLogIds } from '@/lib/redraft/importedGameLogIdBridge'
import { loadSportPointsBase } from '@/lib/decision-os/trade/sportPointsContext'
import { readDailySportForm, readPriorDailySportForm } from '@/lib/projections/dailySportFormStore'
import { scoreFormBlob } from '@/lib/projections/dailySportForm'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { meetsSampleBar } from '@/lib/decision-os/trade/sportPointsValue'
import { detectQbFormat } from './slotEligibility'
import { sleeperReadableRosters } from './rosterIdSpace'
import { BASELINE_SCORING, buildValueLedger } from '@/lib/trade-intel/valueLedger'

/**
 * How your roster stacks up against the other teams in YOUR league.
 *
 * ⚠ A RANK, NOT A LETTER. This repo has been burned by letter grades: a "C"
 * trade grade turned out to mean "we priced nothing", and it was
 * indistinguishable from a considered verdict. A letter invents a scale and
 * hides its inputs. "3rd of 12 by roster value" names the comparison, and if
 * the comparison cannot be made the section says so instead.
 *
 * ⚠ AND IT IS COMPARED WITHIN THE LEAGUE, NOT AGAINST AN ABSOLUTE. Roster value
 * only means something relative to the people you actually play. A 12-team
 * superflex dynasty and a 10-team redraft produce totals that are not on the
 * same axis, and grading against a global average would rank a strong redraft
 * roster as thin because dynasty prices dominate the market data.
 *
 * "Ever evolving" is a property of the inputs, not of a schedule here: this
 * reads whatever the value snapshots currently say, and those are refreshed by
 * their own cron. When they move, so does this.
 */

export type PositionStrength = {
  position: string
  /** Your total value at this position. */
  value: number
  /** Where that ranks among the league's teams. 1 is best. */
  rank: number
  outOf: number
  playerCount: number
  /** The league's median total at this position, so the rank has a distance attached. */
  median?: number
}

export type RosterGrade = {
  /** 1 is the most valuable roster in the league. */
  rank: number
  outOf: number
  /** Your roster's total value. */
  value: number
  /** The league's median, so the rank has a distance attached to it. */
  median: number
  /** Strongest and weakest positions by league rank. Null when unrankable. */
  strongest: PositionStrength | null
  weakest: PositionStrength | null
  /**
   * EVERY rankable position, strongest first by percentile. The two above are its ends; the
   * middle was computed and thrown away, which is exactly the view a manager wants when deciding
   * where to trade from and where to trade for.
   */
  positions?: PositionStrength[]
  /** How many of YOUR players carried a price, of how many held. */
  pricedPlayers: number
  totalPlayers: number
  /** The market these prices came from, so the number can be argued with. */
  basis: {
    format: string
    qbFormat: string
    capturedAt: string | null
    /**
     * Whether the totals were repriced under this league's scoring, or are raw
     * 12-team full-PPR market prices. Both are honest; they are not the same
     * claim, and the screen should not present them as though they were.
     */
    leagueScored: boolean
    source?: 'nba_projection'
  }
}

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
}

const EMPTY_SLOT = '0'

/** Median, so one superteam does not drag the midpoint the way a mean would. */
function median(ns: number[]): number {
  if (ns.length === 0) return 0
  const s = [...ns].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100
}

export type NbaRosterCoverage = {
  threshold: number
  modelUnavailableReason: string | null
  teams: Array<{
    platformUserId: string
    rostered: number
    qualified: number
    required: number
    missing: Array<{ playerId: string; reason: 'unmapped_identity' | 'missing_qualified_projection' }>
  }>
}

export async function getRosterGrade(args: {
  leagueId: string
  /** The claimed team's platform user id candidates, same list My Team uses. */
  myPlatformUserIds: string[]
  isDynasty: boolean
  starters: unknown
  /**
   * The league's own scoring map, so the ranking is a ranking IN THIS LEAGUE.
   *
   * Null falls back to raw market prices, which is what this did before and is
   * still honest — it is just a weaker claim, and `basis.leagueScored` says
   * which one was made.
   */
  scoringSettings?: Record<string, unknown> | null
  projectionWeek?: { season: string; week: number } | null
  onNbaCoverage?: (report: NbaRosterCoverage) => void
}): Promise<RosterGrade | null> {
  const { leagueId, myPlatformUserIds, isDynasty, starters } = args
  if (myPlatformUserIds.length === 0) return null

  // In Sleeper ids: ESPN translated, any other foreign platform emptied — a foreign id priced as a
  // Sleeper id grades a stranger (ESPN 12483 is Stafford; Sleeper 12483 is Jack Bech).
  const rosters = await sleeperReadableRosters(
    await prisma.roster
      .findMany({
        where: { leagueId },
        select: { platformUserId: true, playerData: true, league: { select: { platform: true, sport: true } } },
      })
      .catch(() => []),
    (r) => r.league?.platform,
    (r) => r.league?.sport,
  )

  const nba = rosters.some((roster) => roster.league?.sport?.toUpperCase() === 'NBA')
  if (nba && rosters.some((roster) => roster.league?.platform?.toLowerCase() !== 'sleeper')) return null

  // Two teams is not a league to be ranked within.
  if (rosters.length < 3) return null

  const byTeam = new Map<string, string[]>()
  for (const r of rosters) {
    const pd = (r.playerData ?? {}) as Record<string, unknown>
    /*
     * The whole roster, not the starting lineup. A grade that counted only
     * starters would rank a team with an elite bench identically to one with
     * nothing behind its starters — which is exactly the difference the grade
     * exists to show.
     */
    const ids = asIds(pd.players).filter((id) => id !== EMPTY_SLOT)
    if (ids.length > 0) byTeam.set(r.platformUserId, ids)
  }
  if (byTeam.size < 3) return null

  const mine = myPlatformUserIds.map((id) => byTeam.get(id)).find(Boolean)
  if (!mine) return null

  const everyId = [...new Set([...byTeam.values()].flat())]
  const format = isDynasty ? 'DYNASTY' : 'REDRAFT'
  const qbFormat = detectQbFormat(starters)

  /*
   * 🛑 THIS WAS THE HEAVIEST READER OF THE SNAPSHOT HISTORY. `everyId` is every rostered player in
   * the league, and the old read returned every dated row for each of them — a 12-team league's
   * ~250 players times every day since the daily ingest began. One row per id now.
   *
   * `newest` below is unchanged in meaning: the latest capture across the league is the max of
   * each player's latest capture.
   */
  const rows = nba ? [] : await loadLatestPlayerValueSnapshots({
    sleeperIds: everyId,
    source: 'FANTASYCALC',
    format,
    qbFormat,
  }).catch(() => [])

  // Newest capture per player — one row per id already; the guard is belt and braces.
  const priced = new Map<string, { value: number; position: string | null }>()
  let newest: Date | null = null
  for (const r of rows) {
    if (!priced.has(r.sleeperId)) {
      priced.set(r.sleeperId, { value: r.value, position: r.position })
    }
    if (!newest || r.capturedAt > newest) newest = r.capturedAt
  }

  /*
   * ⚠ THE COVERAGE GATE. Ranking on prices we hold for a third of the league
   * would produce a confident ordering of noise — and the team we happen to
   * have priced best would come first. Below half, there is no comparison to
   * report and this returns null so the screen says why.
   */
  let leagueScored = false
  if (nba) {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, settings: true, leagueType: true, leagueSize: true, season: true, status: true },
    })
    if (!league) return null
    const [bridge, model] = await Promise.all([
      bridgeImportedGameLogIds({ provider: 'sleeper', sport: 'NBA', rosterIds: everyId }),
      loadSportPointsBase({ sport: 'NBA', league }),
    ])
    const threshold = 0.8
    function reportCoverage(modelUnavailableReason: string | null) {
      if (!args.onNbaCoverage) return
      const linked = new Set(bridge.gameLogIds.map((id) => bridge.rosterIdFor(id)))
      args.onNbaCoverage({
        threshold,
        modelUnavailableReason,
        teams: [...byTeam].map(([platformUserId, ids]) => ({
          platformUserId,
          rostered: ids.length,
          qualified: ids.filter((id) => priced.has(id)).length,
          required: Math.ceil(ids.length * threshold),
          missing: ids.filter((id) => !priced.has(id)).map((playerId) => ({
            playerId,
            reason: linked.has(playerId) ? 'missing_qualified_projection' : 'unmapped_identity',
          })),
        })),
      })
    }
    if (!model.ok || model.ctx.valueKind !== 'points') {
      reportCoverage(model.ok ? 'This league does not use points scoring.' : model.reason)
      return null
    }
    for (const player of model.ctx.board) {
      const rosterId = bridge.rosterIdFor(player.id)
      if (rosterId && meetsSampleBar(player) && Number.isFinite(player.perGame)) {
        priced.set(rosterId, { value: player.perGame, position: player.position })
      }
    }
    if (priced.size < bridge.gameLogIds.length) {
      const scorer = buildLeagueStatScorer({ sport: 'NBA', settings: league.settings })
      const now = new Date()
      const form = await readDailySportForm(prisma, 'NBA', now).catch(() => null)
      if (scorer && form && !form.basis && form.season === league.season) {
        const prior = await readPriorDailySportForm(prisma, 'NBA', form.season, now).catch(() => null)
        const rates = scoreFormBlob(form, scorer, prior?.basis ? null : prior)
        for (const id of bridge.gameLogIds) {
          const rosterId = bridge.rosterIdFor(id)
          const rate = rates.get(id)
          if (!rosterId || priced.has(rosterId) || !rate || rate.perGame == null ||
            !Number.isFinite(rate.perGame) || rate.recentGames + (rate.priorGames ?? 0) < 5) continue
          priced.set(rosterId, { value: rate.perGame, position: rate.pos })
        }
      }
    }
    // Compare only when coverage is strong for every team, including its bench.
    reportCoverage(null)
    if ([...byTeam.values()].some((ids) => ids.filter((id) => priced.has(id)).length < ids.length * threshold)) return null
    leagueScored = true
  }
  if (priced.size < everyId.length * 0.5) return null

  /*
   * ⚠ A MARKET PRICE IS NOT A PRICE IN THIS LEAGUE, and a roster grade that
   * ignores the difference ranks a TE-premium roster as though tight ends were
   * ordinary. The snapshots are all fetched at ppr=1 and 12 teams with only the
   * QB format varying, so a half-PPR league, a TE premium, six-point passing
   * touchdowns and IDP weights are all unpriced by the baseline.
   *
   * The ledger reorders this league's own rostered players by what they
   * actually score here, then prices the new order off the same curve — so the
   * totals stay in the units the rest of the product already uses.
   *
   * Bounded to this league's players on purpose: the comparison is between
   * these twelve rosters, so the field to rank within is the assets in play.
   */
  if (!nba && args.scoringSettings) {
    const ledger = await buildValueLedger({
      sleeperIds: everyId,
      format,
      qbFormat,
      leagueScoring: args.scoringSettings,
      baselineScoring: BASELINE_SCORING,
      projectionWeek: args.projectionWeek ?? null,
      populationIds: everyId,
    }).catch(() => new Map())

    /*
     * Only when the layer actually ran for a real share of the league. A
     * handful of repriced players among a hundred and eighty would reorder the
     * board on partial information, which is worse than not reordering it.
     */
    const applied = [...ledger.values()].filter((l) => l.leagueFit.factor != null)
    if (applied.length >= priced.size * 0.5) {
      leagueScored = true
      for (const [id, entry] of ledger) {
        const p = priced.get(id)
        if (p && entry.value != null) priced.set(id, { ...p, value: entry.value })
      }
    }
  }

  const totals: Array<{ key: string; total: number }> = []
  const positionTotals = new Map<string, Array<{ key: string; total: number }>>()

  for (const [key, ids] of byTeam) {
    let total = 0
    const byPos = new Map<string, number>()
    for (const id of ids) {
      const p = priced.get(id)
      if (!p) continue
      total += p.value
      const pos = (p.position ?? 'UNK').toUpperCase()
      byPos.set(pos, (byPos.get(pos) ?? 0) + p.value)
    }
    totals.push({ key, total })
    for (const [pos, v] of byPos) {
      const list = positionTotals.get(pos) ?? []
      list.push({ key, total: v })
      positionTotals.set(pos, list)
    }
  }

  const myKey = myPlatformUserIds.find((id) => byTeam.has(id))!
  totals.sort((a, b) => b.total - a.total)
  const rank = totals.findIndex((t) => t.key === myKey) + 1
  if (rank === 0) return null

  const myTotal = totals.find((t) => t.key === myKey)!.total

  // Positional ranks, but only where enough teams carry that position for a
  // ranking to mean anything.
  const strengths: PositionStrength[] = []
  for (const [position, list] of positionTotals) {
    if (position === 'UNK' || list.length < 3) continue
    list.sort((a, b) => b.total - a.total)
    const idx = list.findIndex((t) => t.key === myKey)
    if (idx < 0) continue
    strengths.push({
      position,
      value: Math.round(list[idx].total),
      rank: idx + 1,
      outOf: list.length,
      median: Math.round(median(list.map((t) => t.total))),
      playerCount: mine.filter((id) => (priced.get(id)?.position ?? '').toUpperCase() === position)
        .length,
    })
  }

  // Ranked by percentile so positions with different team counts compare.
  strengths.sort((a, b) => a.rank / a.outOf - b.rank / b.outOf)

  return {
    rank,
    outOf: totals.length,
    value: Math.round(myTotal),
    median: Math.round(median(totals.map((t) => t.total))),
    strongest: strengths[0] ?? null,
    weakest: strengths.length > 1 ? strengths[strengths.length - 1] : null,
    positions: strengths,
    pricedPlayers: mine.filter((id) => priced.has(id)).length,
    totalPlayers: mine.length,
    basis: { format, qbFormat, capturedAt: newest?.toISOString() ?? null, leagueScored,
      ...(nba ? { source: 'nba_projection' as const } : {}) },
  }
}
