/*
 * LEAGUE DECISION CONTEXT
 *
 * CONTRACT BOUNDARY:
 * - LeagueDecisionContext is the AUTHORITATIVE source for league-level intelligence.
 * - All calculations here are deterministic (no AI). OpenAI receives the summarized
 *   output but must NOT infer beyond what this context provides.
 * - Grok (used for narrative/social posts) never receives this context directly.
 * - The trade evaluator injects the summarized context into the OpenAI prompt as
 *   auxiliary data — it does not replace the tier system or veto layer.
 *
 * DATA FLOW:
 *   Sleeper API + FantasyCalc → buildLeagueDecisionContext() → summarizeLeagueDecisionContext()
 *   → injected into OpenAI prompt (trade-evaluator/route.ts)
 *
 * DEGRADATION:
 *   If Sleeper or FantasyCalc calls fail, completeness drops to PARTIAL.
 *   If the entire context build fails, the trade evaluator proceeds without it.
 */

import { SleeperRoster, SleeperLeague, SleeperPlayer, getAllPlayers, getLeagueType } from './sleeper-client'
import { parseSleeperRosterPositions } from './trade-engine/sleeper-converter'
import { findPlayerByName, FantasyCalcPlayer } from './fantasycalc'

import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF'
const SKILL_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE']

export interface TeamDecisionProfile {
  teamId: string
  ownerId: string
  record: { wins: number; losses: number; ties?: number }
  pointsFor?: number
  pointsAgainst?: number
  competitiveWindow: 'WIN_NOW' | 'REBUILD' | 'MIDDLE'
  needs: Position[]
  surpluses: Position[]
  starterQualityByPosition: Partial<Record<Position, number>>
  depthScoreByPosition: Partial<Record<Position, number>>
  pickCapitalScore: number
  faabRemaining?: number
  avgStarterAge?: number
  flags: string[]
}

export interface LeagueMarketContext {
  scarcityByPosition: Partial<Record<Position, number>>
  pickInflationIndex: number
  contenderTeamIds: string[]
  rebuildingTeamIds: string[]
}

export interface PartnerFitScore {
  teamId: string
  fitScore: number
  reasons: string[]
}

export interface LeagueDecisionContext {
  teams: Record<string, TeamDecisionProfile>
  market: LeagueMarketContext
  partnerFit: Record<string, PartnerFitScore>
  metadata: {
    generatedAt: string
    snapshotCompleteness: 'FULL' | 'PARTIAL'
  }
}

interface RosterSlotRequirements {
  startingQB: number
  startingRB: number
  startingWR: number
  startingTE: number
  startingFlex: number
  superflex: boolean
}

interface ResolvedPlayer {
  playerId: string
  name: string
  position: Position | string
  age: number | null
  value: number
}

function resolvePlayersOnRoster(
  playerIds: string[],
  starterIds: string[],
  allPlayers: Record<string, SleeperPlayer>,
  fcPlayers: FantasyCalcPlayer[]
): { starters: ResolvedPlayer[]; bench: ResolvedPlayer[]; all: ResolvedPlayer[] } {
  const resolved: ResolvedPlayer[] = []

  for (const pid of playerIds) {
    const sleeperInfo = allPlayers[pid]
    if (!sleeperInfo) continue

    const pos = (sleeperInfo.position || 'BN').toUpperCase()
    if (!SKILL_POSITIONS.includes(pos as Position) && pos !== 'K' && pos !== 'DEF') continue

    const fcMatch = findPlayerByName(fcPlayers, sleeperInfo.full_name || `${sleeperInfo.first_name} ${sleeperInfo.last_name}`)

    resolved.push({
      playerId: pid,
      name: sleeperInfo.full_name || `${sleeperInfo.first_name} ${sleeperInfo.last_name}`,
      position: pos,
      age: sleeperInfo.age ?? fcMatch?.player.maybeAge ?? null,
      value: fcMatch?.value ?? 0,
    })
  }

  const starterSet = new Set(starterIds)
  const starters = resolved.filter(p => starterSet.has(p.playerId))
  const bench = resolved.filter(p => !starterSet.has(p.playerId))

  return { starters, bench, all: resolved }
}

function getRequiredStartersByPosition(slots: RosterSlotRequirements): Record<Position, number> {
  return {
    QB: slots.startingQB + (slots.superflex ? 1 : 0),
    RB: slots.startingRB + Math.ceil(slots.startingFlex * 0.4),
    WR: slots.startingWR + Math.ceil(slots.startingFlex * 0.4),
    TE: slots.startingTE + Math.ceil(slots.startingFlex * 0.2),
    K: 0,
    DEF: 0,
  }
}

function computeNeedsAndSurpluses(
  resolved: ResolvedPlayer[],
  starterIds: string[],
  requirements: Record<Position, number>
): { needs: Position[]; surpluses: Position[]; starterQuality: Partial<Record<Position, number>>; depthScore: Partial<Record<Position, number>> } {
  const needs: Position[] = []
  const surpluses: Position[] = []
  const starterQuality: Partial<Record<Position, number>> = {}
  const depthScore: Partial<Record<Position, number>> = {}

  const starterSet = new Set(starterIds)

  for (const pos of SKILL_POSITIONS) {
    const atPosition = resolved.filter(p => p.position === pos)
    const startersAtPos = atPosition.filter(p => starterSet.has(p.playerId))
    const benchAtPos = atPosition.filter(p => !starterSet.has(p.playerId))
    const required = requirements[pos] || 0

    const viableStarters = atPosition.filter(p => p.value >= 1500).length
    const eliteCount = atPosition.filter(p => p.value >= 6000).length

    const injuryPenalty = 0
    const agePenalty = pos === 'RB'
      ? atPosition.filter(p => (p.age ?? 25) >= 28).length * 0.5
      : 0

    const needScore = required - viableStarters + injuryPenalty + agePenalty
    const surplusScore = viableStarters - required + (eliteCount >= 2 ? 1 : 0)

    if (needScore >= 1) needs.push(pos)
    if (surplusScore >= 1) surpluses.push(pos)

    const avgStarterValue = startersAtPos.length > 0
      ? startersAtPos.reduce((s, p) => s + p.value, 0) / startersAtPos.length
      : 0
    starterQuality[pos] = Math.min(100, Math.round((avgStarterValue / 8000) * 100))

    const depthCount = benchAtPos.filter(p => p.value >= 1000).length
    depthScore[pos] = Math.min(100, Math.round((depthCount / Math.max(1, required)) * 50 + (viableStarters >= required ? 50 : 0)))
  }

  return { needs, surpluses, starterQuality, depthScore }
}

function classifyWindow(
  wins: number,
  losses: number,
  pickCapitalScore: number,
  avgStarterAge: number | null
): 'WIN_NOW' | 'REBUILD' | 'MIDDLE' {
  const totalGames = wins + losses
  const winPct = totalGames > 0 ? wins / totalGames : 0.5
  const hasEarlyPicks = pickCapitalScore > 65
  const starterAge = avgStarterAge ?? 26

  if (winPct >= 0.6 && starterAge <= 27) return 'WIN_NOW'
  if (winPct >= 0.55 && starterAge <= 25) return 'WIN_NOW'
  if (winPct <= 0.35 && hasEarlyPicks) return 'REBUILD'
  if (winPct <= 0.35 && starterAge >= 28) return 'REBUILD'
  return 'MIDDLE'
}

function computePickCapitalScore(
  picks: Array<{ round: number; season: string | number }>,
  totalTeams: number
): number {
  if (picks.length === 0) return 0

  const currentYear = new Date().getFullYear()
  let totalValue = 0

  for (const pick of picks) {
    const year = typeof pick.season === 'string' ? parseInt(pick.season) : pick.season
    const roundWeight = pick.round === 1 ? 10 : pick.round === 2 ? 5 : pick.round === 3 ? 2.5 : 1
    const yearDistance = Math.max(0, year - currentYear)
    const yearWeight = yearDistance <= 1 ? 1 : yearDistance <= 2 ? 0.8 : 0.6
    totalValue += roundWeight * yearWeight
  }

  const maxPossiblePerTeam = 3 * (10 + 5 + 2.5 + 1)
  const normalized = (totalValue / maxPossiblePerTeam) * 100
  return Math.min(100, Math.round(normalized))
}

function generateFlags(
  profile: Partial<TeamDecisionProfile>,
  resolved: ResolvedPlayer[]
): string[] {
  const flags: string[] = []

  const rbCount = resolved.filter(p => p.position === 'RB' && p.value >= 1500).length
  if (rbCount <= 1) flags.push('RB_THIN')

  const qbCount = resolved.filter(p => p.position === 'QB' && p.value >= 2000).length
  if (qbCount <= 1) flags.push('QB_THIN')

  const wrCount = resolved.filter(p => p.position === 'WR' && p.value >= 1500).length
  if (wrCount >= 5) flags.push('WR_DEEP')

  const agingCore = resolved.filter(p => p.value >= 5000 && (p.age ?? 25) >= 28).length
  if (agingCore >= 2) flags.push('AGING_CORE')

  const youngCore = resolved.filter(p => p.value >= 4000 && (p.age ?? 25) <= 23).length
  if (youngCore >= 3) flags.push('YOUNG_CORE')

  if ((profile.pickCapitalScore ?? 0) >= 70) flags.push('PICK_HEAVY')
  if ((profile.pickCapitalScore ?? 50) <= 20) flags.push('PICK_POOR')

  if ((profile.faabRemaining ?? 100) <= 10) flags.push('FAAB_LOW')

  return flags
}

function computeScarcityByPosition(
  allTeamProfiles: TeamDecisionProfile[],
  requirements: Record<Position, number>,
  totalTeams: number
): Partial<Record<Position, number>> {
  const scarcity: Partial<Record<Position, number>> = {}

  for (const pos of SKILL_POSITIONS) {
    const leagueDemand = (requirements[pos] || 0) * totalTeams
    let leagueSupply = 0
    for (const team of allTeamProfiles) {
      leagueSupply += (team.starterQualityByPosition[pos] ?? 0) > 30 ? 1 : 0
    }
    const supply = Math.max(1, leagueSupply)
    scarcity[pos] = Math.round((leagueDemand / supply) * 100) / 100
  }

  return scarcity
}

function computePickInflationIndex(profiles: TeamDecisionProfile[]): number {
  const totalPickScore = profiles.reduce((s, p) => s + p.pickCapitalScore, 0)
  const avgPickScore = totalPickScore / Math.max(1, profiles.length)
  return Math.round((avgPickScore / 50) * 100) / 100
}

function computePartnerFit(
  userTeam: TeamDecisionProfile,
  otherTeams: TeamDecisionProfile[]
): Record<string, PartnerFitScore> {
  const fits: Record<string, PartnerFitScore> = {}

  for (const other of otherTeams) {
    let fitScore = 0
    const reasons: string[] = []

    const theirSurplusMatchesUserNeed = other.surpluses.filter(s => userTeam.needs.includes(s)).length
    if (theirSurplusMatchesUserNeed > 0) {
      fitScore += theirSurplusMatchesUserNeed * 15
      reasons.push('SURPLUS_MATCH')
    }

    const userSurplusMatchesTheirNeed = userTeam.surpluses.filter(s => other.needs.includes(s)).length
    if (userSurplusMatchesTheirNeed > 0) {
      fitScore += userSurplusMatchesTheirNeed * 15
      reasons.push('NEED_ALIGNMENT')
    }

    const windowCompat =
      (userTeam.competitiveWindow === 'WIN_NOW' && other.competitiveWindow === 'REBUILD') ||
      (userTeam.competitiveWindow === 'REBUILD' && other.competitiveWindow === 'WIN_NOW')
    if (windowCompat) {
      fitScore += 25
      reasons.push('WINDOW_ALIGNMENT')
    } else if (userTeam.competitiveWindow !== other.competitiveWindow) {
      fitScore += 10
    }

    if (other.pickCapitalScore >= 50 && userTeam.competitiveWindow === 'REBUILD') {
      fitScore += 15
      reasons.push('PICK_FLEX')
    } else if (other.pickCapitalScore <= 30 && userTeam.competitiveWindow === 'WIN_NOW') {
      fitScore += 10
      reasons.push('PICK_FLEX')
    }

    const scarcityAdvantage = userTeam.surpluses.some(s => other.needs.includes(s))
    if (scarcityAdvantage) {
      fitScore += 5
      if (!reasons.includes('SURPLUS_MATCH')) reasons.push('POSITIONAL_SCARCITY_ADVANTAGE')
    }

    fits[other.teamId] = {
      teamId: other.teamId,
      fitScore: Math.min(100, fitScore),
      reasons,
    }
  }

  return fits
}

export interface BuildLeagueDecisionContextInput {
  league: SleeperLeague
  rosters: SleeperRoster[]
  tradedPicks?: Array<{ owner_id: number; roster_id: number; previous_owner_id: number; round: number; season: string }>
  userRosterId?: number
  isSuperFlex?: boolean
}

export async function buildLeagueDecisionContext(
  input: BuildLeagueDecisionContextInput
): Promise<LeagueDecisionContext> {
  const { league, rosters, tradedPicks = [], userRosterId } = input

  let completeness: 'FULL' | 'PARTIAL' = 'FULL'

  const rosterSlots = parseSleeperRosterPositions(league.roster_positions)
  const isSF = input.isSuperFlex ?? rosterSlots.superflex
  const requirements = getRequiredStartersByPosition({ ...rosterSlots, superflex: isSF })

  let allPlayers: Record<string, SleeperPlayer> = {}
  try {
    allPlayers = await getAllPlayers()
  } catch {
    completeness = 'PARTIAL'
  }

  const leagueFormat = getLeagueType(league)
  const isDynasty = leagueFormat === 'dynasty'
  let fcPlayers: FantasyCalcPlayer[] = []
  try {
    fcPlayers = await getFantasyCalcValuesDbFirst({
      isDynasty,
      numQbs: isSF ? 2 : 1,
      numTeams: league.total_rosters || 12,
      ppr: 1,
    })
  } catch {
    completeness = 'PARTIAL'
  }

  const profiles: TeamDecisionProfile[] = []

  for (const roster of rosters) {
    const teamId = String(roster.roster_id)
    const playerIds = roster.players || []
    const starterIds = roster.starters || []

    const { starters, all: allResolved } = resolvePlayersOnRoster(playerIds, starterIds, allPlayers, fcPlayers)

    const teamPicks = tradedPicks
      .filter(p => p.owner_id === roster.roster_id)
      .map(p => ({ round: p.round, season: p.season }))

    const pickCapitalScore = computePickCapitalScore(teamPicks, league.total_rosters || 12)

    const starterAges = starters.filter(p => p.age !== null).map(p => p.age as number)
    const avgStarterAge = starterAges.length > 0
      ? Math.round((starterAges.reduce((s, a) => s + a, 0) / starterAges.length) * 10) / 10
      : null

    const wins = roster.settings.wins ?? 0
    const losses = roster.settings.losses ?? 0
    const ties = roster.settings.ties ?? 0

    const competitiveWindow = classifyWindow(wins, losses, pickCapitalScore, avgStarterAge)

    const { needs, surpluses, starterQuality, depthScore } = computeNeedsAndSurpluses(
      allResolved,
      starterIds,
      requirements
    )

    const profile: TeamDecisionProfile = {
      teamId,
      ownerId: roster.owner_id,
      record: { wins, losses, ties: ties || undefined },
      pointsFor: roster.settings.fpts ? roster.settings.fpts + (roster.settings.fpts_decimal ?? 0) / 100 : undefined,
      pointsAgainst: roster.settings.fpts_against ? roster.settings.fpts_against + (roster.settings.fpts_against_decimal ?? 0) / 100 : undefined,
      competitiveWindow,
      needs,
      surpluses,
      starterQualityByPosition: starterQuality,
      depthScoreByPosition: depthScore,
      pickCapitalScore,
      faabRemaining: undefined,
      avgStarterAge: avgStarterAge ?? undefined,
      flags: [],
    }

    profile.flags = generateFlags(profile, allResolved)
    profiles.push(profile)
  }

  const teamsMap: Record<string, TeamDecisionProfile> = {}
  for (const p of profiles) {
    teamsMap[p.teamId] = p
  }

  const contenderTeamIds = profiles.filter(p => p.competitiveWindow === 'WIN_NOW').map(p => p.teamId)
  const rebuildingTeamIds = profiles.filter(p => p.competitiveWindow === 'REBUILD').map(p => p.teamId)

  const scarcity = computeScarcityByPosition(profiles, requirements, league.total_rosters || 12)
  const pickInflation = computePickInflationIndex(profiles)

  const market: LeagueMarketContext = {
    scarcityByPosition: scarcity,
    pickInflationIndex: pickInflation,
    contenderTeamIds,
    rebuildingTeamIds,
  }

  let partnerFit: Record<string, PartnerFitScore> = {}
  if (userRosterId !== undefined) {
    const userProfile = profiles.find(p => p.teamId === String(userRosterId))
    if (userProfile) {
      const otherProfiles = profiles.filter(p => p.teamId !== userProfile.teamId)
      partnerFit = computePartnerFit(userProfile, otherProfiles)
    }
  }

  return {
    teams: teamsMap,
    market,
    partnerFit,
    metadata: {
      generatedAt: new Date().toISOString(),
      snapshotCompleteness: completeness,
    },
  }
}

export function summarizeLeagueDecisionContext(ctx: LeagueDecisionContext): string {
  const lines: string[] = [
    `LEAGUE DECISION CONTEXT (generated ${ctx.metadata.generatedAt}, completeness: ${ctx.metadata.snapshotCompleteness})`,
    '',
    '--- MARKET ---',
    `Positional Scarcity: ${Object.entries(ctx.market.scarcityByPosition).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `Pick Inflation Index: ${ctx.market.pickInflationIndex} (>1 = picks overpriced in this league)`,
    `Contenders: ${ctx.market.contenderTeamIds.join(', ') || 'None identified'}`,
    `Rebuilders: ${ctx.market.rebuildingTeamIds.join(', ') || 'None identified'}`,
    '',
    '--- TEAMS ---',
  ]

  for (const [id, team] of Object.entries(ctx.teams)) {
    lines.push(`Team ${id} (${team.competitiveWindow}):`)
    lines.push(`  Record: ${team.record.wins}-${team.record.losses}${team.record.ties ? `-${team.record.ties}` : ''}`)
    if (team.pointsFor) lines.push(`  Points For: ${team.pointsFor.toFixed(1)}`)
    lines.push(`  Needs: ${team.needs.join(', ') || 'None'}`)
    lines.push(`  Surpluses: ${team.surpluses.join(', ') || 'None'}`)
    lines.push(`  Starter Quality: ${Object.entries(team.starterQualityByPosition).map(([k, v]) => `${k}=${v}`).join(', ')}`)
    lines.push(`  Depth Score: ${Object.entries(team.depthScoreByPosition).map(([k, v]) => `${k}=${v}`).join(', ')}`)
    lines.push(`  Pick Capital: ${team.pickCapitalScore}/100`)
    if (team.avgStarterAge) lines.push(`  Avg Starter Age: ${team.avgStarterAge}`)
    if (team.flags.length > 0) lines.push(`  Flags: ${team.flags.join(', ')}`)
    lines.push('')
  }

  if (Object.keys(ctx.partnerFit).length > 0) {
    lines.push('--- PARTNER FIT (ranked) ---')
    const sorted = Object.values(ctx.partnerFit).sort((a, b) => b.fitScore - a.fitScore)
    for (const fit of sorted) {
      lines.push(`Team ${fit.teamId}: fit=${fit.fitScore}/100 [${fit.reasons.join(', ')}]`)
    }
  }

  return lines.join('\n')
}
