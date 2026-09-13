/**
 * Build deterministic context for Zombie AI. PROMPT 355.
 * AI must NEVER decide: infection, serum/weapon/ambush legality, promotion/relegation, trade legality, dangerous drop.
 * Only data for narration and strategy advice.
 */

import { buildHistoricalContext } from '@/lib/ai/historicalContextBuilder'
import { getZombieLeagueConfig } from '../ZombieLeagueConfig'
import { getWhispererRosterId, getAllStatuses } from '../ZombieOwnerStatusService'
import { getWeeklyBoardData } from '../ZombieWeeklyBoardService'
import { getSerumBalance } from '../ZombieSerumEngine'
import { getAmbushBalance } from '../ZombieAmbushEngine'
import { getTotalWinningsByRoster } from '../ZombieWeeklyWinningsLedger'
import { evaluateCollusionFlags } from '../ZombieCollusionFlagService'
import { evaluateDangerousDrops } from '../ZombieValuableDropGuard'
import { prisma } from '@/lib/prisma'

export type ZombieAIType =
  | 'survival_strategy'
  | 'zombie_strategy'
  | 'whisperer_strategy'
  | 'serum_timing_advice'
  | 'weapon_timing_advice'
  | 'ambush_planning_advice'
  | 'stay_alive_framing'
  | 'lineup_zombie_context'
  | 'weekly_zombie_recap'
  | 'most_at_risk'
  | 'chompin_block_explanation'
  | 'serum_weapon_holders_commentary'
  | 'whisperer_pressure_summary'
  | 'commissioner_review_summary'

export type ZombieUniverseAIType =
  | 'promotion_relegation_outlook'
  | 'level_storylines'
  | 'top_survivor_runs'
  | 'fastest_spread_analysis'
  | 'league_health_summary'
  | 'commissioner_anomaly_summary'

export interface ZombieAIDeterministicContext {
  leagueId: string
  sport: string
  week: number
  config: {
    whispererSelection: string
    infectionLossToWhisperer: boolean
    infectionLossToZombie: boolean
    serumReviveCount: number
    zombieTradeBlocked: boolean
  }
  whispererRosterId: string | null
  /** Set when the Whisperer's identity was redacted for this viewer (see lib/zombie/whispererRedaction). */
  whispererHidden?: boolean
  survivors: string[]
  zombies: string[]
  statuses: { rosterId: string; status: string }[]
  movementWatch: { rosterId: string; leagueId: string; reason: string; projectedLevelId: string | null }[]
  rosterDisplayNames: Record<string, string>
  myRosterId: string | null
  myResources: { serums: number; weapons: number; ambush: number }
  winningsByRoster: Record<string, number>
  serumBalanceByRoster: Record<string, number>
  weaponBalanceByRoster: Record<string, number>
  chompinBlockCandidates: string[]
  collusionFlags: { rosterIdA: string; rosterIdB: string; flagType: string }[]
  dangerousDropFlags: { rosterId: string; playerId: string; estimatedValue: number; threshold: number }[]
  historicalContext: string | null
}

/**
 * Build deterministic context for Zombie league AI. No legal outcomes — only data for advice/narrative.
 */
export async function buildZombieAIContext(args: {
  leagueId: string
  week: number
  userId: string
}): Promise<ZombieAIDeterministicContext | null> {
  const { leagueId, week, userId } = args
  const config = await getZombieLeagueConfig(leagueId)
  if (!config) return null

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, zombieLeague: { select: { universeId: true } } },
  })
  const sport = league?.sport ?? 'NFL'
  const universeId = league?.zombieLeague?.universeId ?? null

  const [
    whispererRosterId,
    statuses,
    board,
    myRosterId,
    rosters,
    teams,
    winnings,
    collusionFlags,
    dangerousDropFlags,
  ] = await Promise.all([
    getWhispererRosterId(leagueId),
    getAllStatuses(leagueId),
    getWeeklyBoardData(leagueId, week, universeId),
    prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }).then((r) => r?.id ?? null),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true }, orderBy: { id: 'asc' } }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, teamName: true, ownerName: true },
      orderBy: [{ currentRank: 'asc' }, { id: 'asc' }],
    }),
    getTotalWinningsByRoster(leagueId),
    evaluateCollusionFlags(leagueId),
    evaluateDangerousDrops(leagueId),
  ])

  const rosterDisplayNames: Record<string, string> = {}
  for (let i = 0; i < rosters.length && i < teams.length; i++) {
    const r = rosters[i]
    const t = teams[i]
    if (r && t) rosterDisplayNames[r.id] = t.teamName || t.ownerName || r.id
  }
  for (const r of rosters) {
    if (!rosterDisplayNames[r.id]) rosterDisplayNames[r.id] = r.id
  }

  const serumBalanceByRoster: Record<string, number> = {}
  const weaponBalanceByRoster: Record<string, number> = {}
  const ledgerRows = await prisma.zombieResourceLedger.findMany({
    where: { leagueId, resourceType: { in: ['serum', 'weapon'] } },
    select: { rosterId: true, resourceType: true, balance: true },
  })
  for (const r of rosters) {
    serumBalanceByRoster[r.id] = ledgerRows.filter((l) => l.rosterId === r.id && l.resourceType === 'serum').reduce((s, l) => s + l.balance, 0)
    weaponBalanceByRoster[r.id] = ledgerRows.filter((l) => l.rosterId === r.id && l.resourceType === 'weapon').reduce((s, l) => s + l.balance, 0)
  }

  let myResources = { serums: 0, weapons: 0, ambush: 0 }
  if (myRosterId) {
    myResources = {
      serums: serumBalanceByRoster[myRosterId] ?? 0,
      weapons: weaponBalanceByRoster[myRosterId] ?? 0,
      ambush: await getAmbushBalance(leagueId, myRosterId),
    }
  }

  return {
    leagueId,
    sport: String(sport),
    week,
    config: {
      whispererSelection: config.whispererSelection,
      infectionLossToWhisperer: config.infectionLossToWhisperer,
      infectionLossToZombie: config.infectionLossToZombie,
      serumReviveCount: config.serumReviveCount,
      zombieTradeBlocked: config.zombieTradeBlocked,
    },
    whispererRosterId,
    survivors: board.survivors,
    zombies: board.zombies,
    statuses: statuses.map((s) => ({ rosterId: s.rosterId, status: s.status })),
    movementWatch: board.movementWatch,
    rosterDisplayNames,
    myRosterId,
    myResources,
    winningsByRoster: winnings,
    serumBalanceByRoster,
    weaponBalanceByRoster,
    chompinBlockCandidates: board.chompinBlockCandidates ?? [],
    collusionFlags: collusionFlags.map((f) => ({ rosterIdA: f.rosterIdA, rosterIdB: f.rosterIdB, flagType: f.flagType })),
    dangerousDropFlags: dangerousDropFlags.map((f) => ({
      rosterId: f.rosterId,
      playerId: f.playerId,
      estimatedValue: f.estimatedValue,
      threshold: f.threshold,
    })),
    // buildHistoricalContext returns a rich HistoricalContext object; the
    // zombie AI context only needs the summary blurb for prompt injection.
    historicalContext: await buildHistoricalContext(leagueId)
      .then((ctx) => ctx?.summaryText ?? null)
      .catch(() => null),
  }
}

export interface ZombieUniverseAIDeterministicContext {
  universeId: string
  sport: string
  standings: {
    leagueId: string
    rosterId: string
    levelName: string
    status: string
    totalPoints: number
    winnings: number
    serums: number
    weapons: number
    weekKilled: number | null
  }[]
  movementProjections: { rosterId: string; leagueId: string; reason: string; projectedLevelId: string | null }[]
  rosterDisplayNames: Record<string, string>
}

/**
 * Build deterministic context for universe-wide Zombie AI. No promotion/relegation decisions — only data.
 */
export async function buildZombieUniverseAIContext(args: {
  universeId: string
  userId: string
}): Promise<ZombieUniverseAIDeterministicContext | null> {
  const { universeId } = args
  const standings = await prisma.zombieUniverse.findUnique({
    where: { id: universeId },
    select: { id: true, sport: true },
  })
  if (!standings) return null

  const { getUniverseStandings } = await import('../ZombieUniverseStandingsService')
  const { getMovementProjections } = await import('../ZombieMovementEngine')

  const [rows, movement] = await Promise.all([
    getUniverseStandings(universeId),
    getMovementProjections(universeId),
  ])

  const rosterDisplayNames: Record<string, string> = {}
  for (const r of rows) {
    rosterDisplayNames[r.rosterId] = r.rosterId
  }

  return {
    universeId,
    sport: standings.sport ?? 'NFL',
    standings: rows.map((r) => ({
      leagueId: r.leagueId,
      rosterId: r.rosterId,
      levelName: r.levelName,
      status: r.status,
      totalPoints: r.totalPoints,
      winnings: r.winnings,
      serums: r.serums,
      weapons: r.weapons,
      weekKilled: r.weekKilled,
    })),
    movementProjections: movement,
    rosterDisplayNames,
  }
}
