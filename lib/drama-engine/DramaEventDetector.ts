/**
 * DramaEventDetector — produces candidate drama events from matchup, standings, rivalry, and trade data.
 */

import { prisma } from '@/lib/prisma'
import type { DramaType } from './types'
import type { DramaDetectionSignal } from './types'
import { listRivalries } from '@/lib/rivalry-engine/RivalryQueryService'
import { listProfilesByLeague } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import { getDramaCentralTeams } from '@/lib/league-intelligence-graph/GraphQueryService'
import { getDramaCadenceConfig, normalizeSportForDrama } from './SportDramaResolver'

export interface DramaCandidate {
  dramaType: DramaType
  headline: string
  summary: string
  relatedManagerIds: string[]
  relatedTeamIds: string[]
  relatedMatchupId?: string
  signal?: DramaDetectionSignal
  intensityFactor?: number // Backward-compatible alias consumed by score calculator.
}

export interface DetectDramaInput {
  leagueId: string
  sport: string
  season?: number | null
}

export type TeamRef = {
  id: string
  externalId: string
  teamName: string
  ownerName: string
}

/**
 * The name a rivalry side is printed under, from the league's teams. 🛑 Never the raw id: the headline
 * was built from `managerAId`/`managerBId` directly, so measured 2026-10-05 across 40 commissioner
 * leagues, 146 of 587 Commissioner OS cards read like "13 vs 9: Emerging rivalry" — roster numbers
 * where every other storyline here names the team. The rivalry engine keys a pair by the team's
 * externalId, or by its owner name when it is not run with `useTeamIds` (HeadToHeadAggregator), so a
 * side resolves through either. Shared with `LeagueDramaEngine`, which renames rows this run did not
 * reach — the two must never disagree about a name.
 */
export function rivalSideNamer(teams: ReadonlyArray<TeamRef>): (id: string) => { name: string; resolved: boolean } {
  const byAnyId = new Map<string, TeamRef>()
  const byOwner = new Map<string, TeamRef>()
  for (const t of teams) {
    byAnyId.set(t.id, t)
    byAnyId.set(t.externalId, t)
    if (t.ownerName?.trim()) byOwner.set(t.ownerName.trim(), t)
  }
  return (id: string) => {
    const team = byAnyId.get(id) ?? byOwner.get(id.trim())
    const name = team?.teamName?.trim() || team?.ownerName?.trim()
    if (name) return { name, resolved: true }
    // An unresolved bare number is a roster slot, not a name; anything else already is a name.
    return /^\d+$/.test(id.trim()) ? { name: `Team ${id.trim()}`, resolved: false } : { name: id, resolved: true }
  }
}

function canonicalPair(a: string, b: string): string {
  return a <= b ? `${a}::${b}` : `${b}::${a}`
}

function parseNum(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value) || 0
  return 0
}

function toManagerIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v && String(v).trim().length > 0)))]
}

function recentWeight(index: number): number {
  return Math.max(0.9, 1.08 - index * 0.03)
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

/**
 * Detect candidate drama events for a league/season from matchups, standings, rivalries.
 */
export async function detectDramaEvents(input: DetectDramaInput): Promise<DramaCandidate[]> {
  const candidates: DramaCandidate[] = []
  const candidateKeys = new Set<string>()
  const { leagueId, season } = input
  const sportNorm = normalizeSportForDrama(input.sport) ?? input.sport

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { teams: true },
  })
  if (!league?.teams?.length) return candidates

  const seasonNum = season ?? league.season ?? new Date().getFullYear()
  const cadence = normalizeSportForDrama(sportNorm)
    ? getDramaCadenceConfig(normalizeSportForDrama(sportNorm)!)
    : { regularSeasonLength: 16, playoffStartWeek: 14, upsetScoreMultiplier: 1 }

  const teams = league.teams.map(
    (t): TeamRef => ({
      id: t.id,
      externalId: t.externalId,
      teamName: t.teamName,
      ownerName: t.ownerName,
    })
  )
  const teamByAnyId = new Map<string, TeamRef>()
  for (const t of teams) {
    teamByAnyId.set(t.id, t)
    teamByAnyId.set(t.externalId, t)
  }
  const nameSide = rivalSideNamer(teams)
  const rivalSideName = (id: string): string => nameSide(id).name

  const [platformLeagueIds, prevSeasonChampions] = await Promise.all([
    getPlatformLeagueIds(leagueId),
    prisma.seasonResult.findMany({
      where: { leagueId, season: String(seasonNum - 1), champion: true },
      select: { rosterId: true },
    }),
  ])

  const [
    matchups,
    rivalries,
    seasonResults,
    psychProfiles,
    simulationRows,
    dynastyProjections,
    graphDramaTeams,
    tradeHistories,
  ] = await Promise.all([
    prisma.matchupFact.findMany({
      where: { leagueId, season: seasonNum, sport: sportNorm },
      orderBy: { weekOrPeriod: 'desc' },
      take: 250,
    }),
    listRivalries(leagueId, { sport: sportNorm, season: seasonNum, limit: 25 }),
    prisma.seasonResult.findMany({
      where: { leagueId, season: String(seasonNum) },
      select: { rosterId: true, wins: true, losses: true, champion: true },
    }),
    listProfilesByLeague(leagueId, { sport: sportNorm, season: seasonNum, limit: 200 }),
    prisma.seasonSimulationResult.findMany({
      where: { leagueId, season: seasonNum, sport: sportNorm },
      orderBy: [{ weekOrPeriod: 'desc' }, { createdAt: 'desc' }],
      take: 800,
    }),
    prisma.dynastyProjection.findMany({
      where: { leagueId, sport: sportNorm },
      select: {
        teamId: true,
        championshipWindowScore: true,
        rebuildProbability: true,
      },
      take: 100,
    }),
    getDramaCentralTeams({
      leagueId,
      season: seasonNum,
      sport: sportNorm,
      limit: 12,
    }).catch(() => []),
    platformLeagueIds.length > 0
      ? prisma.leagueTradeHistory.findMany({
          where: { sleeperLeagueId: { in: platformLeagueIds } },
          include: {
            trades: {
              where: { season: seasonNum },
              orderBy: [{ week: 'desc' }, { createdAt: 'desc' }],
              take: 120,
            },
          },
          take: 80,
        })
      : Promise.resolve([]),
  ])

  const winsByTeam = new Map<string, number>()
  for (const row of seasonResults) {
    winsByTeam.set(String(row.rosterId), row.wins ?? 0)
  }

  const psychByManager = new Map(psychProfiles.map((p) => [p.managerId, p]))
  const graphHeatByEntity = new Map(graphDramaTeams.map((t) => [t.entityId, t.dramaScore]))

  const simByWeek = new Map<number, typeof simulationRows>()
  for (const row of simulationRows) {
    const w = row.weekOrPeriod ?? 0
    if (!simByWeek.has(w)) simByWeek.set(w, [])
    simByWeek.get(w)!.push(row)
  }
  const simWeeks = [...simByWeek.keys()].sort((a, b) => b - a)
  const latestSimWeek = simWeeks[0]
  const previousSimWeek = simWeeks[1]
  const latestSim = latestSimWeek != null ? simByWeek.get(latestSimWeek) ?? [] : []
  const previousSim = previousSimWeek != null ? simByWeek.get(previousSimWeek) ?? [] : []
  const latestPlayoffProbByTeam = new Map(latestSim.map((s) => [s.teamId, s.playoffProbability]))
  const previousPlayoffProbByTeam = new Map(previousSim.map((s) => [s.teamId, s.playoffProbability]))

  const pushCandidate = (c: DramaCandidate) => {
    const key = `${c.dramaType}::${c.headline}`
    if (candidateKeys.has(key)) return
    candidateKeys.add(key)
    candidates.push(c)
  }

  for (const r of rivalries.slice(0, 4)) {
    const managers = [r.managerAId, r.managerBId]
    const behaviorHeat =
      managers
        .map((m) => psychByManager.get(m)?.activityScore ?? 0)
        .reduce((sum, n) => sum + n, 0) / Math.max(1, managers.length)
    const graphHeat =
      managers
        .map((m) => graphHeatByEntity.get(m) ?? 0)
        .reduce((sum, n) => sum + n, 0) / Math.max(1, managers.length)
    pushCandidate({
      dramaType: 'RIVALRY_CLASH',
      headline: `${rivalSideName(r.managerAId)} vs ${rivalSideName(r.managerBId)}: ${r.rivalryTier} rivalry`,
      summary: `Head-to-head tension (score ${r.rivalryScore.toFixed(0)}/100).`,
      relatedManagerIds: toManagerIds(managers),
      relatedTeamIds: [],
      signal: {
        intensityFactor: r.rivalryScore / 100,
        rivalryScore: r.rivalryScore,
        managerBehaviorHeat: behaviorHeat,
        leagueGraphHeat: graphHeat,
        recencyWeight: 1.06,
      },
      intensityFactor: r.rivalryScore / 100, // Backward-compatible.
    })
  }

  const upsetCandidates = matchups
    .map((m, idx) => {
      const margin = Math.abs((m.scoreA ?? 0) - (m.scoreB ?? 0))
      if (!m.winnerTeamId) return null
      const winner = String(m.winnerTeamId)
      const loser = winner === m.teamA ? m.teamB : m.teamA
      const winnerWins = winsByTeam.get(winner) ?? 0
      const loserWins = winsByTeam.get(loser) ?? 0
      const winnerPlayoff = latestPlayoffProbByTeam.get(winner) ?? 0
      const loserPlayoff = latestPlayoffProbByTeam.get(loser) ?? 0
      const underdogSignal = winnerWins + 1 < loserWins || winnerPlayoff + 0.12 < loserPlayoff
      if (!underdogSignal) return null
      const upsetMagnitude =
        Math.max(0, loserWins - winnerWins) * 8 +
        Math.max(0, loserPlayoff - winnerPlayoff) * 55 +
        Math.max(0, 25 - margin)
      return {
        matchup: m,
        upsetMagnitude,
        recencyWeight: recentWeight(idx),
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b?.upsetMagnitude ?? 0) - (a?.upsetMagnitude ?? 0))
    .slice(0, 3)

  for (const u of upsetCandidates) {
    const m = u!.matchup
    const teamA = teamByAnyId.get(m.teamA)
    const teamB = teamByAnyId.get(m.teamB)
    pushCandidate({
      dramaType: 'MAJOR_UPSET',
      headline: `Major upset in week ${m.weekOrPeriod}: ${(teamA?.teamName ?? m.teamA)} vs ${(teamB?.teamName ?? m.teamB)}`,
      summary: `${teamA?.teamName ?? m.teamA} ${m.scoreA} – ${m.scoreB} ${teamB?.teamName ?? m.teamB}.`,
      relatedManagerIds: toManagerIds([teamA?.externalId, teamB?.externalId]),
      relatedTeamIds: toManagerIds([m.teamA, m.teamB]),
      relatedMatchupId: m.matchupId,
      signal: {
        upsetMagnitude: u!.upsetMagnitude,
        recencyWeight: u!.recencyWeight,
      },
      intensityFactor: 1 - Math.abs((m.scoreA ?? 0) - (m.scoreB ?? 0)) / 30, // Backward-compatible.
    })
  }

  const pairHistory = new Map<string, typeof matchups>()
  for (const m of matchups) {
    const key = canonicalPair(m.teamA, m.teamB)
    if (!pairHistory.has(key)) pairHistory.set(key, [])
    pairHistory.get(key)!.push(m)
  }
  for (const series of pairHistory.values()) {
    const ordered = [...series].sort((a, b) => (b.weekOrPeriod ?? 0) - (a.weekOrPeriod ?? 0))
    if (ordered.length < 2) continue
    const latest = ordered[0]
    const previous = ordered[1]
    if (!latest.winnerTeamId || !previous.winnerTeamId) continue
    if (latest.winnerTeamId === previous.winnerTeamId) continue
    const teamA = teamByAnyId.get(latest.teamA)
    const teamB = teamByAnyId.get(latest.teamB)
    pushCandidate({
      dramaType: 'REVENGE_GAME',
      headline: `Revenge game completed: ${teamA?.teamName ?? latest.teamA} vs ${teamB?.teamName ?? latest.teamB}`,
      summary: `Winner flipped from the prior meeting, signaling a revenge payoff.`,
      relatedManagerIds: toManagerIds([teamA?.externalId, teamB?.externalId]),
      relatedTeamIds: toManagerIds([latest.teamA, latest.teamB]),
      relatedMatchupId: latest.matchupId,
      signal: { recencyWeight: 1.05, intensityFactor: 0.8 },
      intensityFactor: 0.8,
    })
  }

  const outcomesByTeam = new Map<string, Array<'W' | 'L'>>()
  for (const m of matchups) {
    if (!m.winnerTeamId) continue
    const winner = String(m.winnerTeamId)
    const loser = winner === m.teamA ? m.teamB : m.teamA
    if (!outcomesByTeam.has(winner)) outcomesByTeam.set(winner, [])
    if (!outcomesByTeam.has(loser)) outcomesByTeam.set(loser, [])
    outcomesByTeam.get(winner)!.push('W')
    outcomesByTeam.get(loser)!.push('L')
  }
  let longestWin: { teamId: string; streak: number } | null = null
  let longestLoss: { teamId: string; streak: number } | null = null
  for (const [teamId, outcomes] of outcomesByTeam.entries()) {
    let win = 0
    let loss = 0
    for (const o of outcomes) {
      if (o === 'W') win++
      else break
    }
    for (const o of outcomes) {
      if (o === 'L') loss++
      else break
    }
    if (win >= 3 && (!longestWin || win > longestWin.streak)) longestWin = { teamId, streak: win }
    if (loss >= 3 && (!longestLoss || loss > longestLoss.streak)) longestLoss = { teamId, streak: loss }
  }
  if (longestWin) {
    const team = teamByAnyId.get(longestWin.teamId)
    pushCandidate({
      dramaType: 'WIN_STREAK',
      headline: `${team?.teamName ?? longestWin.teamId} is on a ${longestWin.streak}-game heater`,
      summary: 'Momentum continues to build as playoff pressure rises.',
      relatedManagerIds: toManagerIds([team?.externalId]),
      relatedTeamIds: toManagerIds([longestWin.teamId]),
      signal: { intensityFactor: Math.min(1.2, longestWin.streak / 4), recencyWeight: 1.04 },
      intensityFactor: Math.min(1.2, longestWin.streak / 4),
    })
  }
  if (longestLoss) {
    const team = teamByAnyId.get(longestLoss.teamId)
    pushCandidate({
      dramaType: 'LOSING_STREAK',
      headline: `Collapse warning: ${team?.teamName ?? longestLoss.teamId} has dropped ${longestLoss.streak} straight`,
      summary: 'Pressure mounts as every week worsens the playoff path.',
      relatedManagerIds: toManagerIds([team?.externalId]),
      relatedTeamIds: toManagerIds([longestLoss.teamId]),
      signal: { intensityFactor: Math.min(1.2, longestLoss.streak / 4), recencyWeight: 1.03 },
      intensityFactor: Math.min(1.2, longestLoss.streak / 4),
    })
  }

  const bubbleRows = latestSim
    .map((row) => {
      const prev = previousPlayoffProbByTeam.get(row.teamId) ?? row.playoffProbability
      return {
        ...row,
        swing: row.playoffProbability - prev,
      }
    })
    .filter((r) => r.playoffProbability >= 0.33 && r.playoffProbability <= 0.67)
    .sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing))
  if (bubbleRows.length >= 2) {
    const linked = bubbleRows.slice(0, 4)
    pushCandidate({
      dramaType: 'PLAYOFF_BUBBLE',
      headline: 'Playoff bubble tightening across the league',
      summary: 'Playoff odds are swinging quickly around the cut line.',
      relatedManagerIds: toManagerIds(linked.map((r) => teamByAnyId.get(r.teamId)?.externalId)),
      relatedTeamIds: toManagerIds(linked.map((r) => r.teamId)),
      signal: {
        playoffSwing: Math.max(...linked.map((r) => Math.abs(r.swing))),
        recencyWeight: 1.05,
      },
    })
  }

  const previousChampionIds = prevSeasonChampions.map((r) => String(r.rosterId))
  if (previousChampionIds.length > 0) {
    const returning = previousChampionIds
      .map((id) => ({
        teamId: id,
        playoffProb: latestPlayoffProbByTeam.get(id) ?? 0,
      }))
      .sort((a, b) => b.playoffProb - a.playoffProb)[0]
    if (returning && returning.playoffProb >= 0.45) {
      const team = teamByAnyId.get(returning.teamId)
      pushCandidate({
        dramaType: 'TITLE_DEFENSE',
        headline: `Title defense alive for ${team?.teamName ?? returning.teamId}`,
        summary: `Last season's champion still projects as a contender.`,
        relatedManagerIds: toManagerIds([team?.externalId]),
        relatedTeamIds: toManagerIds([returning.teamId]),
        signal: { playoffSwing: returning.playoffProb, recencyWeight: 1.04 },
      })
    }
  }

  const tradeCandidates = tradeHistories
    .flatMap((h) =>
      h.trades.map((t) => ({
        owner: h.sleeperUsername,
        trade: t,
      }))
    )
    .map((row) => {
      const picksGiven = Array.isArray(row.trade.picksGiven) ? row.trade.picksGiven.length : 0
      const picksReceived = Array.isArray(row.trade.picksReceived) ? row.trade.picksReceived.length : 0
      const playersGiven = Array.isArray(row.trade.playersGiven) ? row.trade.playersGiven.length : 0
      const playersReceived = Array.isArray(row.trade.playersReceived) ? row.trade.playersReceived.length : 0
      const turnover = picksGiven + picksReceived + playersGiven + playersReceived
      const differential = Math.abs((row.trade.valueDifferential ?? 0) || 0)
      return { ...row, turnover, differential, volatility: differential + turnover * 4 }
    })
    .filter((t) => t.turnover >= 2 || t.differential >= 12)
    .sort((a, b) => b.volatility - a.volatility)
    .slice(0, 2)
  for (const tc of tradeCandidates) {
    const partnerId = tc.trade.partnerRosterId != null ? String(tc.trade.partnerRosterId) : null
    const relatedManagers = toManagerIds([tc.owner, tc.trade.partnerName])
    pushCandidate({
      dramaType: 'TRADE_FALLOUT',
      headline: `Trade fallout after week ${tc.trade.week} blockbuster`,
      summary: `High-volatility trade (${tc.turnover} moved assets, value swing ${tc.differential.toFixed(1)}).`,
      relatedManagerIds: relatedManagers,
      relatedTeamIds: toManagerIds([partnerId]),
      signal: {
        intensityFactor: Math.min(1.2, tc.volatility / 60),
        managerBehaviorHeat:
          relatedManagers.reduce((sum, m) => sum + (psychByManager.get(m)?.activityScore ?? 0), 0) /
          Math.max(1, relatedManagers.length),
        recencyWeight: 1.03,
      },
      intensityFactor: Math.min(1.2, tc.volatility / 60),
    })
  }

  // REBUILD_PROGRESS is no longer generated (owner decision 2026-09-29,
  // Milestone 32). Its candidates were SELECTED by a psychology-profile label
  // ("patient rebuilder" / "rookie-heavy"); with the label removed, the only fact
  // left is playoff-odds movement, which PLAYOFF_BUBBLE already tells — and
  // calling that movement a "rebuild" would restate the label as a claim. The
  // type stays in DRAMA_TYPES so stored events keep rendering (their prose is
  // scrubbed on read by publicNarrative.ts).

  const topDynasty = dynastyProjections
    .slice()
    .sort(
      (a, b) =>
        b.championshipWindowScore - b.rebuildProbability * 20 -
        (a.championshipWindowScore - a.rebuildProbability * 20)
    )[0]
  if (topDynasty) {
    const priorChampion = previousChampionIds[0]
    const rising = topDynasty.teamId
    if (!priorChampion || rising !== priorChampion) {
      const risingTeam = teamByAnyId.get(rising)
      const priorTeam = priorChampion ? teamByAnyId.get(priorChampion) : null
      pushCandidate({
        dramaType: 'DYNASTY_SHIFT',
        headline: `Dynasty shift alert: ${risingTeam?.teamName ?? rising} is surging`,
        summary: priorTeam
          ? `${priorTeam.teamName} no longer looks untouchable as power shifts.`
          : 'A new long-term power center is emerging.',
        relatedManagerIds: toManagerIds([risingTeam?.externalId, priorTeam?.externalId]),
        relatedTeamIds: toManagerIds([rising, priorChampion]),
        signal: {
          intensityFactor: Math.min(1.25, topDynasty.championshipWindowScore / 80),
          leagueGraphHeat: graphHeatByEntity.get(rising) ?? 0,
          recencyWeight: 1.01,
        },
        intensityFactor: Math.min(1.25, topDynasty.championshipWindowScore / 80),
      })
    }
  }

  // Keep outputs focused and sortable for UI.
  candidates.sort((a, b) => (b.signal?.intensityFactor ?? b.intensityFactor ?? 0) - (a.signal?.intensityFactor ?? a.intensityFactor ?? 0))
  return candidates.slice(0, Math.max(12, cadence.playoffStartWeek >= 20 ? 14 : 12))

}
