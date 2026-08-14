/**
 * BehaviorSignalAggregator — aggregates draft, trade, waiver, and lineup signals per manager.
 * Uses LeagueTradeHistory/LeagueTrade, WaiverClaim, DraftFact, and roster/lineup data where available.
 */

import { prisma } from '@/lib/prisma'
import { getBehaviorCalibration, normalizeSportForPsych } from './SportBehaviorResolver'

export interface BehaviorSignalsOutput {
  managerId: string
  leagueId: string
  sport: string
  tradeCount: number
  tradeFrequencyNorm: number
  tradeTimingLateRate: number
  waiverClaimCount: number
  waiverFocusNorm: number
  lineupChangeRate: number
  benchingPatternScore: number
  rookieAcquisitionRate: number
  vetAcquisitionRate: number
  draftPickCount: number
  draftEarlyRoundRate: number
  positionPriorityConcentration: number
  /** Share of draft picks whose position resolved, 0-100. Distinguishes a real
   *  concentration of 0-30 from one we simply could not measure. */
  positionSampleCoverage: number
  /** Standing within this manager's OWN league, in units of the league's spread.
   *  Positive = drafts earlier than his leaguemates. Absolute rates mostly
   *  measure league draft depth, so labels must use these. */
  draftEarlyRoundRelative: number
  positionConcentrationRelative: number
  /** Trade volume relative to this manager's own leaguemates, in spread units. */
  tradeFrequencyRelative: number
  picksTradedAway: number
  picksAcquired: number
  rebuildScore: number
  contentionScore: number
  aggressionNorm: number
  riskNorm: number
}

const MAX_TRADES_FOR_NORM = 20
const MAX_WAIVER_FOR_NORM = 50
const MAX_LINEUP_VOLATILITY = 100

/**
 * Resolve league platform id for trade history (Sleeper: platformLeagueId or dynasty seasons).
 */
/**
 * Draft and trade psychology are CUMULATIVE, not per-season.
 *
 * These filters used exact season equality. A dynasty league sitting in 2026
 * carries its 420 draft picks under seasons 2021-2025, so asking for `season:
 * 2026` matched nothing and every manager came back with draftPickCount 0 —
 * indistinguishable, downstream, from a manager who has never drafted. How
 * someone drafts is the accumulation of every draft they have made; the current
 * season is an upper bound on that history, not a window into it.
 *
 * Roster snapshots and standings keep exact-season semantics on purpose: they
 * describe the team as it stands now, and stretching them across years would
 * report annual roster turnover as week-to-week lineup churn.
 */
function seasonThrough(season?: number | null) {
  return season != null ? { season: { lte: season } } : {}
}

async function getPlatformLeagueIds(leagueId: string): Promise<string[]> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, platformLeagueId: true },
  })
  if (!league || league.platform !== 'sleeper') return []
  const dynasty = await prisma.leagueDynastySeason.findMany({
    where: { leagueId },
    select: { platformLeagueId: true },
  })
  if (dynasty.length > 0) return dynasty.map((d) => d.platformLeagueId).filter(Boolean)
  return league.platformLeagueId ? [league.platformLeagueId] : []
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function seasonDateRange(season?: number | null): { from: Date; to: Date } | null {
  if (season == null) return null
  const from = new Date(Date.UTC(season, 0, 1, 0, 0, 0))
  const to = new Date(Date.UTC(season + 1, 0, 1, 0, 0, 0))
  return { from, to }
}

function computePositionConcentration(positionCounts: Map<string, number>): number {
  const total = [...positionCounts.values()].reduce((sum, n) => sum + n, 0)
  if (total <= 0) return 0
  const top = Math.max(...positionCounts.values())
  return Math.min(100, (top / total) * 100)
}

function computeLineupVolatility(lineups: string[][]): number {
  if (lineups.length < 2) return 0
  let totalChangeRatio = 0
  let comparisons = 0
  for (let i = 1; i < lineups.length; i++) {
    const prev = new Set(lineups[i - 1])
    const curr = new Set(lineups[i])
    const union = new Set([...prev, ...curr]).size || 1
    let same = 0
    for (const p of curr) if (prev.has(p)) same++
    const changed = union - same
    totalChangeRatio += changed / union
    comparisons++
  }
  return Math.min(100, (totalChangeRatio / Math.max(1, comparisons)) * 100)
}

/**
 * Aggregate behavior signals for one manager in a league.
 * managerId is the stable key (e.g. rosterId as string). options.sleeperUsername for trade history lookup.
 */
export async function aggregateBehaviorSignals(
  leagueId: string,
  managerId: string,
  sport: string,
  options?: { sleeperUsername?: string; rosterId?: string; season?: number | null }
): Promise<BehaviorSignalsOutput> {
  const sportNorm = normalizeSportForPsych(sport) ?? sport
  const calibration = normalizeSportForPsych(sportNorm)
    ? getBehaviorCalibration(normalizeSportForPsych(sportNorm)!)
    : { lineupVolatilityWeight: 1, lateTradeWeekThreshold: 10, rookiePreferenceWeight: 1 }
  const seasonRange = seasonDateRange(options?.season)
  const platformIds = await getPlatformLeagueIds(leagueId)
  const username = options?.sleeperUsername ?? managerId

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { teams: true },
  })
  const team = league?.teams.find(
    (t) => t.externalId === managerId || t.id === managerId || t.ownerName === username
  )
  // LeagueTradeHistory.sleeperUsername does NOT hold a username — it holds the
  // numeric Sleeper user id ("604531915508228096"). Teams are keyed by roster id
  // ("9") and display name ("thisaintmyhouse"), so neither matched and the trade
  // history fallback below returned nothing for every manager in every league.
  // LeagueTeam.platformUserId is that id space, and it is populated for 935 of
  // 1002 teams; adding it makes 207 of 207 manager-histories join.
  const managerCandidates = new Set<string>(
    [
      managerId,
      username,
      team?.externalId,
      team?.id,
      team?.ownerName,
      team?.platformUserId,
    ].filter((v): v is string => Boolean(v && String(v).trim().length > 0))
  )

  let tradeCount = 0
  let lateTradeCount = 0
  let playersGiven = 0
  let playersReceived = 0
  let picksGiven = 0
  let picksReceived = 0
  let youthCount = 0
  let vetCount = 0

  const txFacts = await prisma.transactionFact.findMany({
    where: {
      leagueId,
      sport: sportNorm,
      type: { in: ['trade', 'TRADE'] },
      ...seasonThrough(options?.season),
      OR: [
        { managerId: { in: [...managerCandidates] } },
        { rosterId: { in: [...managerCandidates] } },
      ],
    },
    select: { transactionId: true, weekOrPeriod: true },
  })
  if (txFacts.length > 0) {
    const uniqueIds = new Set(txFacts.map((t) => t.transactionId))
    tradeCount = uniqueIds.size
    lateTradeCount = txFacts.filter(
      (t) => (t.weekOrPeriod ?? 0) >= calibration.lateTradeWeekThreshold
    ).length
  }

  if (platformIds.length > 0) {
    const historyRows = await prisma.leagueTradeHistory.findMany({
      where: {
        sleeperLeagueId: { in: platformIds },
        sleeperUsername: { in: [...managerCandidates] },
      },
      include: {
        trades: { orderBy: { createdAt: 'desc' }, take: 200 },
      },
    })
    for (const history of historyRows) {
      for (const t of history.trades) {
        // Trade psychology is cumulative, like draft: a 2026 league whose trades
        // happened in 2023 has a trade history, not an empty one. Exact-season
        // equality here discarded every one of them.
        if (options?.season != null && t.season > options.season) continue
        const pGiven = (t.playersGiven as any[]) ?? []
        const pReceived = (t.playersReceived as any[]) ?? []
        const dkGiven = (t.picksGiven as any[]) ?? []
        const dkReceived = (t.picksReceived as any[]) ?? []
        playersGiven += pGiven.length
        playersReceived += pReceived.length
        picksGiven += dkGiven.length
        picksReceived += dkReceived.length
        if ((t.week ?? 0) >= calibration.lateTradeWeekThreshold) lateTradeCount++
        for (const p of pReceived) {
          const age = p?.age ?? 0
          if (age > 0 && age < 25) youthCount++
          if (age >= 28) vetCount++
        }
      }
    }
    // Keep the larger trade sample between transaction facts and trade history.
    tradeCount = Math.max(
      tradeCount,
      historyRows.reduce(
        (sum, h) =>
          sum +
          h.trades.filter((t) => (options?.season != null ? t.season <= options.season : true))
            .length,
        0
      )
    )
  }

  // Trade volume needs the same peer treatment as draft position.
  //
  // Trade history is cumulative across seasons (a 2026 league whose trades
  // happened in 2023 still traded), but the "trade-heavy" threshold was written
  // for a single-season count. Left absolute, a long-lived league labels almost
  // everyone heavy: 9 of 12 managers in a five-season dynasty cleared a bar of 6,
  // which works out to barely one trade a season. Busy is a comparison, and the
  // only fair comparison is against the people in the same league.
  let tradeFrequencyRelative = 0
  if (platformIds.length > 0) {
    const leagueHistories = await prisma.leagueTradeHistory.findMany({
      where: { sleeperLeagueId: { in: platformIds } },
      select: {
        sleeperUsername: true,
        trades: { select: { season: true }, take: 200, orderBy: { createdAt: 'desc' } },
      },
    })
    const perManager = new Map<string, number>()
    for (const h of leagueHistories) {
      const n = h.trades.filter(
        (t) => options?.season == null || t.season <= options.season
      ).length
      perManager.set(h.sleeperUsername, (perManager.get(h.sleeperUsername) ?? 0) + n)
    }
    const peerCounts = [...perManager.values()]
    if (peerCounts.length >= 3) {
      const mean = peerCounts.reduce((a, v) => a + v, 0) / peerCounts.length
      const variance =
        peerCounts.reduce((a, v) => a + (v - mean) ** 2, 0) / peerCounts.length
      // Floor the spread so a league where nobody trades cannot promote a single
      // extra trade into a personality.
      const spread = Math.max(Math.sqrt(variance), 2)
      tradeFrequencyRelative = (tradeCount - mean) / spread
    }
  }

  let waiverClaimCount = 0
  const rosterIdForWaiver = options?.rosterId ?? managerId
  const roster = await prisma.roster.findFirst({
    where: {
      leagueId,
      OR: [
        { id: rosterIdForWaiver },
        { platformUserId: { in: [...managerCandidates] } },
      ],
    },
  })
  if (roster) {
    const waiverWhere = {
      leagueId,
      rosterId: roster.id,
      ...(sportNorm ? { sportType: sportNorm } : {}),
      ...(seasonRange
        ? { createdAt: { gte: seasonRange.from, lt: seasonRange.to } }
        : {}),
    }
    waiverClaimCount = await prisma.waiverClaim.count({
      where: waiverWhere,
    })
  }

  // Fetch the WHOLE league's picks, not just this manager's.
  //
  // Early-round share is dominated by how deep the league drafts, not by the
  // manager. Measured on live leagues: a 44-round IDP dynasty puts every one of
  // its 14 managers at 20-23%, while a 23-round league puts everyone at 36-51%.
  // Judged against a fixed threshold the first league labels all 14 managers
  // "late-round accumulator" — a fact about the league's settings wearing the
  // costume of a personality trait, which is the same defect as grading a trade
  // C on no data.
  //
  // What IS a trait is drafting earlier than your own leaguemates, so every
  // draft claim below is relative to this league's own distribution.
  const leagueDraftFacts = await prisma.draftFact.findMany({
    where: {
      leagueId,
      sport: sportNorm,
      ...seasonThrough(options?.season),
    },
    select: { playerId: true, round: true, managerId: true },
  })
  const draftFacts = leagueDraftFacts.filter(
    (d) => d.managerId != null && managerCandidates.has(d.managerId)
  )
  const draftPickCount = draftFacts.length
  const earlyRoundPickCount = draftFacts.filter((d) => d.round <= 3).length
  const draftEarlyRoundRate =
    draftPickCount > 0 ? (earlyRoundPickCount / draftPickCount) * 100 : 0

  // Draft facts store the PROVIDER player id (Sleeper's "12529"), not the
  // canonical Player uuid, so matching on `id` alone resolved 0 of 44 picks for
  // every manager in this league. Canonical Player carries `sleeperId`, so try
  // both key spaces before giving up.
  const positionCounts = new Map<string, number>()
  const leaguePositionById = new Map<string, string>()
  let resolvedPickCount = 0
  if (draftFacts.length > 0) {
    const ids = [...new Set(leagueDraftFacts.map((d) => d.playerId))]
    const [playerRows, sportsRows] = await Promise.all([
      prisma.player.findMany({
        where: { id: { in: ids } },
        select: { id: true, position: true },
      }),
      // SportsPlayer is the table keyed by Sleeper id, which is the id space
      // draft facts actually use.
      prisma.sportsPlayer.findMany({
        where: { sleeperId: { in: ids } },
        select: { sleeperId: true, position: true },
      }),
    ])
    const posById = leaguePositionById
    for (const row of playerRows) {
      if (row.position) posById.set(row.id, row.position.toUpperCase())
    }
    for (const row of sportsRows) {
      if (row.sleeperId && row.position) posById.set(row.sleeperId, row.position.toUpperCase())
    }
    for (const d of draftFacts) {
      // An unresolved pick is NOT a position. It used to be bucketed as 'UNK',
      // which meant every unresolvable draft collapsed into one bucket and
      // scored 100% positional concentration — the system reporting total
      // positional focus precisely when it had identified nothing.
      const pos = posById.get(d.playerId)
      if (!pos) continue
      resolvedPickCount += 1
      positionCounts.set(pos, (positionCounts.get(pos) ?? 0) + 1)
    }
  }
  // Concentration read off a handful of resolved picks does not describe how
  // someone drafted 44 times. Below half coverage we report nothing rather than
  // extrapolating from the sample that happened to match.
  const positionSampleCoverage =
    draftFacts.length > 0 ? (resolvedPickCount / draftFacts.length) * 100 : 0
  const positionCoverageOk =
    draftFacts.length > 0 && resolvedPickCount >= Math.ceil(draftFacts.length / 2)
  const positionPriorityConcentration = positionCoverageOk
    ? computePositionConcentration(positionCounts)
    : 0

  // Where this manager sits in his OWN league's distribution, expressed in units
  // of that league's spread. A value of 1 means "one spread-width above his
  // leaguemates", which is a claim about the manager; the raw rate is mostly a
  // claim about the league's settings.
  //
  // The spread floor keeps a league whose managers are nearly identical from
  // promoting rounding noise into a personality: if everyone drafts alike, no
  // one is distinctive, and the honest output is no label.
  const MIN_SPREAD_EARLY_RATE = 5
  const MIN_SPREAD_CONCENTRATION = 8
  const peerStat = (values: number[], own: number, minSpread: number): number => {
    if (values.length < 3) return 0
    const mean = values.reduce((a, v) => a + v, 0) / values.length
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length
    const spread = Math.max(Math.sqrt(variance), minSpread)
    return (own - mean) / spread
  }

  const byManager = new Map<string, { total: number; early: number; positions: Map<string, number>; resolved: number }>()
  for (const d of leagueDraftFacts) {
    if (!d.managerId) continue
    let entry = byManager.get(d.managerId)
    if (!entry) {
      entry = { total: 0, early: 0, positions: new Map(), resolved: 0 }
      byManager.set(d.managerId, entry)
    }
    entry.total += 1
    if (d.round <= 3) entry.early += 1
    const pos = leaguePositionById.get(d.playerId)
    if (pos) {
      entry.resolved += 1
      entry.positions.set(pos, (entry.positions.get(pos) ?? 0) + 1)
    }
  }
  const peers = [...byManager.values()].filter((e) => e.total > 0)
  const draftEarlyRoundRelative =
    draftPickCount > 0
      ? peerStat(peers.map((e) => (e.early / e.total) * 100), draftEarlyRoundRate, MIN_SPREAD_EARLY_RATE)
      : 0
  const positionConcentrationRelative = positionCoverageOk
    ? peerStat(
        peers
          .filter((e) => e.resolved >= Math.ceil(e.total / 2))
          .map((e) => computePositionConcentration(e.positions)),
        positionPriorityConcentration,
        MIN_SPREAD_CONCENTRATION
      )
    : 0

  const snapshots = await prisma.rosterSnapshot.findMany({
    where: {
      leagueId,
      ...(options?.season != null ? { season: options.season } : {}),
      teamId: { in: [...managerCandidates] },
    },
    orderBy: [{ season: 'asc' }, { weekOrPeriod: 'asc' }],
    select: { lineupPlayers: true },
  })
  const lineups = snapshots.map((s) =>
    parseJsonArray(s.lineupPlayers).map((v) => String(v))
  )
  const lineupChangeRateRaw = computeLineupVolatility(lineups)
  const lineupChangeRate = Math.min(
    MAX_LINEUP_VOLATILITY,
    lineupChangeRateRaw * calibration.lineupVolatilityWeight
  )
  const benchingPatternScore = Math.min(100, lineupChangeRate * 0.9)

  // Rookie-vs-vet is an ACQUISITION MIX, and a mix needs two things to mix.
  //
  // This previously read (youth + draftPicks) / (youth + vet + draftPicks). With
  // no acquisitions observed — the live state, since transaction_facts holds 0
  // rows — youth and vet are both 0 and the expression collapses to
  // draftPicks/draftPicks = 1.0. Every manager who had ever made a pick scored a
  // perfect 100 rookie rate and was labelled "rookie-heavy": all 12 managers in
  // this league got the identical label, which is not consensus, it is a
  // constant wearing a measurement's clothes. It also drove 55% of the risk
  // score, so an unobserved league produced a confident risk number too.
  //
  // In a rookie draft every pick is a rookie by construction, so draft picks
  // alone cannot separate a rookie-hoarder from anyone else. Without real
  // acquisitions there is no denominator variety and therefore no rate. Draft
  // behaviour is still measured — through early-round rate and positional
  // concentration, which genuinely differ between managers.
  const observedAcquisitions = youthCount + vetCount
  const hasAcquisitionMix = observedAcquisitions > 0
  const totalAcquisitions = observedAcquisitions + draftPickCount || 1
  const rookieRate = hasAcquisitionMix
    ? Math.min(
        1,
        (youthCount + draftPickCount * calibration.rookiePreferenceWeight) / totalAcquisitions
      )
    : 0
  const vetRate = hasAcquisitionMix ? vetCount / totalAcquisitions : 0

  const tradeFrequencyNorm = Math.min(tradeCount / MAX_TRADES_FOR_NORM, 1) * 100
  const waiverFocusNorm = Math.min(waiverClaimCount / MAX_WAIVER_FOR_NORM, 1) * 100
  const tradeTimingLateRate =
    tradeCount > 0 ? Math.min(100, (lateTradeCount / tradeCount) * 100) : 0

  const standingsFact = await prisma.seasonStandingFact.findFirst({
    where: {
      leagueId,
      sport: sportNorm,
      ...(options?.season != null ? { season: options.season } : {}),
      teamId: { in: [...managerCandidates] },
    },
    orderBy: { createdAt: 'desc' },
    select: { wins: true, losses: true, rank: true },
  })
  const standingWinRate =
    standingsFact && standingsFact.wins + standingsFact.losses > 0
      ? standingsFact.wins / (standingsFact.wins + standingsFact.losses)
      : 0
  const standingRankBoost =
    standingsFact?.rank != null ? Math.max(0, 20 - standingsFact.rank) : 0

  const rebuildScore = picksReceived > picksGiven
    ? Math.min((picksReceived - picksGiven) * 10 + rookieRate * 20, 100)
    : Math.min(rookieRate * 25, 100)
  const contentionScore = picksGiven > picksReceived
    ? Math.min((picksGiven - picksReceived) * 10 + standingWinRate * 40 + standingRankBoost, 100)
    : Math.min(standingWinRate * 35 + standingRankBoost, 100)

  const aggressionNorm = Math.min(
    tradeFrequencyNorm * 0.45 + waiverFocusNorm * 0.25 + lineupChangeRate * 0.3,
    100
  )
  // Risk is only scored from the terms actually observed. Letting the rookie term
  // contribute 0 when unmeasured would be the mirror of the bug above: it would
  // drag risk toward 0 and make unobserved managers read "risk-averse", inventing
  // caution from absence exactly as it used to invent aggression.
  const riskNorm = hasAcquisitionMix
    ? Math.min(rookieRate * 55 + tradeTimingLateRate * 0.25 + lineupChangeRate * 0.2, 100)
    : Math.min((tradeTimingLateRate * 0.25 + lineupChangeRate * 0.2) / 0.45, 100)

  return {
    managerId,
    leagueId,
    sport: sportNorm,
    tradeCount,
    tradeFrequencyNorm,
    tradeTimingLateRate,
    waiverClaimCount,
    waiverFocusNorm,
    lineupChangeRate,
    benchingPatternScore,
    rookieAcquisitionRate: rookieRate * 100,
    vetAcquisitionRate: vetRate * 100,
    draftPickCount,
    draftEarlyRoundRate,
    positionPriorityConcentration,
    positionSampleCoverage,
    draftEarlyRoundRelative,
    positionConcentrationRelative,
    tradeFrequencyRelative,
    picksTradedAway: picksGiven,
    picksAcquired: picksReceived,
    rebuildScore,
    contentionScore,
    aggressionNorm,
    riskNorm,
  }
}
