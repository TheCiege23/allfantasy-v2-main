/**
 * Dynasty projections API
 * GET: read persisted projections, optionally auto-generate/refresh from league roster data.
 * POST: generate projections using provided teamInputs, or auto-build inputs from league context.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ageMultiplier } from '@/lib/dynasty-engine/AgingCurveService'
import { getDynastyProjectionsForLeague } from '@/lib/dynasty-engine/DynastyQueryService'
import { generateDynastyProjection } from '@/lib/dynasty-engine/DynastyProjectionGenerator'
import { resolveSportForDynasty } from '@/lib/dynasty-engine/SportDynastyResolver'
import type { DynastyProjectionOutput } from '@/lib/dynasty-engine/types'
import type { FuturePickAsset, PlayerDynastyAsset, TeamDynastyInputs } from '@/lib/dynasty-projection/types'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

type LeagueLite = {
  id: string
  platformLeagueId: string | null
  sport: string
  season: number | null
  isDynasty: boolean | null
  leagueSize: number | null
  scoring: string | null
  settings: unknown
}

type TeamLite = {
  id: string
  externalId: string
  ownerName: string
  teamName: string
  wins: number
  losses: number
  pointsFor: number
  aiPowerScore: number | null
}

type RosterLite = {
  id: string
  platformUserId: string
  playerData: unknown
}

type DraftSessionLite = {
  tradedPicks: unknown
}

const POSITION_BASE: Record<string, number> = {
  QB: 7600,
  RB: 7000,
  WR: 6800,
  TE: 6100,
  K: 3600,
  DST: 4200,
  DEF: 4200,
  PG: 6500,
  SG: 6400,
  SF: 6500,
  PF: 6400,
  C: 6300,
  G: 5900,
  D: 5700,
  LW: 5900,
  RW: 5900,
  SP: 6500,
  RP: 5000,
  OF: 6100,
  SS: 5900,
  '2B': 5800,
  '3B': 6000,
  '1B': 6100,
  FWD: 6200,
  MID: 6000,
  GK: 5600,
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function toBool(v: string | null): boolean {
  return v === '1' || v === 'true'
}

function toPlayerId(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  const obj = asObject(raw)
  if (!obj) return null
  const candidate = obj.id ?? obj.player_id ?? obj.playerId
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

function parsePlayerIdsFromRosterData(playerData: unknown): string[] {
  const ids = new Set<string>()
  const addFromArray = (arr: unknown) => {
    if (!Array.isArray(arr)) return
    for (const item of arr) {
      const id = toPlayerId(item)
      if (id) ids.add(id)
    }
  }

  addFromArray(playerData)
  const obj = asObject(playerData)
  if (!obj) return [...ids]

  addFromArray(obj.players)
  addFromArray(obj.starters)
  addFromArray(obj.bench)
  addFromArray(obj.reserve)
  addFromArray(obj.ir)
  addFromArray(obj.taxi)
  addFromArray(obj.devy)
  addFromArray(obj.lineup)

  const lineupSections = asObject(obj.lineup_sections)
  if (lineupSections) {
    for (const v of Object.values(lineupSections)) {
      addFromArray(v)
    }
  }

  return [...ids]
}

function statusToInjuryRisk(status: string | null | undefined): number {
  const normalized = String(status ?? '').toLowerCase()
  if (!normalized) return 0
  if (normalized.includes('ir') || normalized.includes('out')) return 1
  if (normalized.includes('questionable') || normalized.includes('doubtful')) return 0.6
  return 0.2
}

function getBaseValueForPosition(position: string): number {
  const pos = position.toUpperCase()
  return POSITION_BASE[pos] ?? 5200
}

function estimateDynastyValue(params: {
  sport: string
  position: string
  age: number | null
  trendScore: number
  injuryRisk: number
}): number {
  const base = getBaseValueForPosition(params.position)
  const ageAdj = ageMultiplier(params.sport, params.position, params.age, 'next')
  const trendAdj = Math.max(0, Math.min(100, params.trendScore)) * 26
  const injuryPenalty = params.injuryRisk * 900
  return Math.round(Math.max(250, Math.min(13000, base * ageAdj + trendAdj - injuryPenalty)))
}

function resolveRosterForTeam(team: TeamLite, rosters: RosterLite[]): RosterLite | null {
  return (
    rosters.find((r) => r.platformUserId === team.externalId) ??
    rosters.find((r) => r.id === team.externalId) ??
    rosters.find((r) => r.platformUserId === team.ownerName) ??
    null
  )
}

function inferFormatFlags(league: LeagueLite): { isSuperFlex: boolean; isTightEndPremium: boolean } {
  const settings = asObject(league.settings) ?? {}
  const scoring = String(league.scoring ?? '').toLowerCase()
  const superFlexSignals = [
    settings.isSuperFlex,
    settings.superflex,
    settings.is_superflex,
    settings.sf,
  ]
  const isSuperFlex =
    superFlexSignals.some((v) => v === true || String(v).toLowerCase() === 'true' || Number(v) === 1) ||
    scoring.includes('superflex')
  const tepSignals = [
    settings.isTightEndPremium,
    settings.tightEndPremium,
    settings.tep,
  ]
  const isTightEndPremium =
    tepSignals.some((v) => v === true || String(v).toLowerCase() === 'true' || Number(v) > 0) ||
    scoring.includes('tep') ||
    scoring.includes('te premium')
  return { isSuperFlex, isTightEndPremium }
}

function buildSyntheticPlayers(team: TeamLite, sport: string): PlayerDynastyAsset[] {
  const baseline = Math.max(40, Math.min(95, team.aiPowerScore ?? 65))
  const templatesBySport: Record<string, string[]> = {
    NFL: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'RB'],
    NBA: ['PG', 'SG', 'SF', 'PF', 'C', 'SG', 'SF', 'PF'],
    NHL: ['C', 'LW', 'RW', 'D', 'D', 'C', 'LW', 'G'],
    MLB: ['SP', 'SP', 'RP', '1B', '2B', '3B', 'SS', 'OF'],
    NCAAB: ['PG', 'SG', 'SF', 'PF', 'C', 'SG', 'SF', 'PF'],
    NCAAF: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'RB'],
    SOCCER: ['FWD', 'MID', 'MID', 'DEF', 'DEF', 'GK', 'FWD', 'MID'],
  }
  const template = templatesBySport[sport] ?? templatesBySport.NFL
  return template.map((position, i) => {
    const age = 23 + (i % 8)
    const trendScore = Math.max(0, Math.min(100, baseline + (4 - i) * 2))
    return {
      playerId: `synthetic-${team.externalId}-${i + 1}`,
      name: `${team.teamName || team.externalId} ${position} ${i + 1}`,
      position,
      age,
      dynastyValue: estimateDynastyValue({
        sport,
        position,
        age,
        trendScore,
        injuryRisk: 0,
      }),
      recentInjuryScore: 0,
      gamesPlayedLastSeason: null,
      draftRound: null,
      yearsInLeague: null,
    }
  })
}

function buildFuturePicksByTeam(params: {
  teams: TeamLite[]
  rosters: RosterLite[]
  tradedPicksRaw: unknown
  season: number
}): Map<string, FuturePickAsset[]> {
  const { teams, rosters, tradedPicksRaw, season } = params
  const aliasToTeam = new Map<string, string>()
  const registerAlias = (alias: string | null | undefined, teamId: string) => {
    if (!alias) return
    aliasToTeam.set(alias, teamId)
  }

  for (const team of teams) {
    registerAlias(team.externalId, team.externalId)
    registerAlias(team.id, team.externalId)
    const roster = resolveRosterForTeam(team, rosters)
    if (roster) {
      registerAlias(roster.id, team.externalId)
      registerAlias(roster.platformUserId, team.externalId)
    }
  }

  const weakestFirst = [...teams].sort((a, b) => {
    const winsDelta = a.wins - b.wins
    if (winsDelta !== 0) return winsDelta
    return a.pointsFor - b.pointsFor
  })
  const pickNumberByOriginalTeam = new Map<string, number>()
  weakestFirst.forEach((team, idx) => {
    pickNumberByOriginalTeam.set(team.externalId, idx + 1)
  })

  const years = [season + 1, season + 2, season + 3]
  const rounds = [1, 2, 3]
  const ledger = new Map<string, string>()
  for (const originalTeamId of teams.map((t) => t.externalId)) {
    for (const year of years) {
      for (const round of rounds) {
        ledger.set(`${year}|${round}|${originalTeamId}`, originalTeamId)
      }
    }
  }

  const tradedPicks = Array.isArray(tradedPicksRaw) ? tradedPicksRaw : []
  for (const trade of tradedPicks) {
    const obj = asObject(trade)
    if (!obj) continue
    const round = Number(obj.round)
    if (!Number.isFinite(round) || round < 1 || round > 3) continue
    const year = Number(obj.season ?? season + 1)
    if (!Number.isFinite(year) || !years.includes(year)) continue
    const originalAlias = String(
      obj.originalRosterId ?? obj.rosterId ?? obj.previousOwnerId ?? obj.fromRosterId ?? ''
    )
    const newAlias = String(obj.newRosterId ?? obj.ownerId ?? obj.toRosterId ?? '')
    const originalTeamId = aliasToTeam.get(originalAlias)
    const newTeamId = aliasToTeam.get(newAlias)
    if (!originalTeamId || !newTeamId) continue
    const key = `${year}|${round}|${originalTeamId}`
    if (ledger.has(key)) ledger.set(key, newTeamId)
  }

  const byTeam = new Map<string, FuturePickAsset[]>()
  for (const [key, ownerTeamId] of ledger.entries()) {
    const [yearRaw, roundRaw, originalTeamId] = key.split('|')
    const pickNumber = pickNumberByOriginalTeam.get(originalTeamId) ?? Math.ceil(teams.length / 2)
    const pick: FuturePickAsset = {
      season: Number(yearRaw),
      round: Number(roundRaw),
      pickNumber,
      ownerTeamId,
    }
    const list = byTeam.get(ownerTeamId) ?? []
    list.push(pick)
    byTeam.set(ownerTeamId, list)
  }

  return byTeam
}

async function resolveLeagueByAnyId(leagueId: string): Promise<LeagueLite | null> {
  return prisma.league.findFirst({
    where: {
      OR: [{ id: leagueId }, { platformLeagueId: leagueId }],
    },
    select: {
      id: true,
      platformLeagueId: true,
      sport: true,
      season: true,
      isDynasty: true,
      leagueSize: true,
      scoring: true,
      settings: true,
    },
  })
}

async function buildTeamInputsFromLeague(params: {
  leagueId: string
  sportOverride?: string
  seasonOverride?: number
  teamIdFilter?: string
}): Promise<{ league: LeagueLite; teamInputs: TeamDynastyInputs[] }> {
  const league = await resolveLeagueByAnyId(params.leagueId)
  if (!league) {
    throw new Error('League not found')
  }

  const sport = resolveSportForDynasty(params.sportOverride ?? league.sport)
  const season = params.seasonOverride ?? league.season ?? new Date().getFullYear()

  const [teams, rosters, latestDraftSession] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId: league.id },
      orderBy: [{ pointsFor: 'desc' }],
      select: {
        id: true,
        externalId: true,
        ownerName: true,
        teamName: true,
        wins: true,
        losses: true,
        pointsFor: true,
        aiPowerScore: true,
      },
    }),
    prisma.roster.findMany({
      where: { leagueId: league.id },
      select: { id: true, platformUserId: true, playerData: true },
    }),
    prisma.draftSession.findFirst({
      where: { leagueId: league.id },
      orderBy: [{ updatedAt: 'desc' }],
      select: { tradedPicks: true },
    }),
  ])

  if (!teams.length) {
    throw new Error('No league teams found for dynasty projection generation')
  }

  const targetTeams = params.teamIdFilter
    ? teams.filter((t) => t.externalId === params.teamIdFilter || t.id === params.teamIdFilter)
    : teams
  if (!targetTeams.length) {
    throw new Error('Requested teamId was not found in this league')
  }

  const rosterPlayerIdsByTeam = new Map<string, string[]>()
  const allPlayerIds = new Set<string>()
  for (const team of targetTeams) {
    const roster = resolveRosterForTeam(team, rosters)
    const ids = parsePlayerIdsFromRosterData(roster?.playerData)
    rosterPlayerIdsByTeam.set(team.externalId, ids)
    ids.forEach((id) => allPlayerIds.add(id))
  }

  const playerIds = [...allPlayerIds]
  const sportLower = sport.toLowerCase()
  const [players, cachedPlayers, trends] = await Promise.all([
    playerIds.length
      ? prisma.player.findMany({
          where: {
            id: { in: playerIds },
            OR: [{ sport }, { sport: sportLower }],
          },
          select: {
            id: true,
            name: true,
            position: true,
            birthYear: true,
            injuryStatus: true,
            projectedDraftRound: true,
          },
        })
      : Promise.resolve([]),
    playerIds.length
      ? prisma.sportsPlayer.findMany({
          where: {
            sport: { in: [sportLower, sport] },
            OR: [{ externalId: { in: playerIds } }, { sleeperId: { in: playerIds } }],
          },
          select: {
            externalId: true,
            sleeperId: true,
            name: true,
            position: true,
            age: true,
            status: true,
          },
        })
      : Promise.resolve([]),
    playerIds.length
      ? prisma.playerMetaTrend.findMany({
          where: {
            playerId: { in: playerIds },
            sport: { in: [sport, sportLower] },
          },
          select: { playerId: true, trendScore: true },
        })
      : Promise.resolve([]),
  ])

  const nowYear = new Date().getFullYear()
  const playerById = new Map(players.map((p) => [p.id, p]))
  const cachedById = new Map<string, (typeof cachedPlayers)[number]>()
  for (const p of cachedPlayers) {
    cachedById.set(p.externalId, p)
    if (p.sleeperId) cachedById.set(p.sleeperId, p)
  }
  const trendByPlayerId = new Map(trends.map((t) => [t.playerId, t.trendScore]))
  const futurePicksByTeam = buildFuturePicksByTeam({
    teams,
    rosters,
    tradedPicksRaw: latestDraftSession?.tradedPicks ?? [],
    season,
  })
  const formatFlags = inferFormatFlags(league)

  const teamInputs: TeamDynastyInputs[] = targetTeams.map((team) => {
    const rosterIds = rosterPlayerIdsByTeam.get(team.externalId) ?? []
    const playersForTeam: PlayerDynastyAsset[] = rosterIds.map((id) => {
      const p = playerById.get(id)
      const cp = cachedById.get(id)
      const age =
        p?.birthYear != null && p.birthYear > 0
          ? nowYear - p.birthYear
          : (cp?.age ?? null)
      const position = String(p?.position ?? cp?.position ?? 'UTIL').toUpperCase()
      const injuryRisk = statusToInjuryRisk(p?.injuryStatus ?? cp?.status)
      return {
        playerId: id,
        name: p?.name ?? cp?.name ?? id,
        position,
        age,
        dynastyValue: estimateDynastyValue({
          sport,
          position,
          age,
          trendScore: trendByPlayerId.get(id) ?? 0,
          injuryRisk,
        }),
        recentInjuryScore: injuryRisk,
        gamesPlayedLastSeason: null,
        draftRound: p?.projectedDraftRound ?? null,
        yearsInLeague: null,
      }
    })

    const fallbackPlayers =
      playersForTeam.length > 0 ? playersForTeam : buildSyntheticPlayers(team, sport)
    return {
      leagueId: league.id,
      teamId: team.externalId,
      leagueContext: {
        sport,
        season,
        isDynasty: league.isDynasty ?? true,
        isSuperFlex: formatFlags.isSuperFlex,
        isTightEndPremium: formatFlags.isTightEndPremium,
        teamCount: league.leagueSize ?? teams.length,
      },
      players: fallbackPlayers,
      futurePicks: futurePicksByTeam.get(team.externalId) ?? [],
    }
  })

  return { league, teamInputs }
}

async function generateForInputs(
  teamInputs: TeamDynastyInputs[],
  persist: boolean
): Promise<DynastyProjectionOutput[]> {
  const outputs = await Promise.all(
    teamInputs.map((input) =>
      generateDynastyProjection(input, { persist })
    )
  )
  return outputs.sort((a, b) => b.rosterStrength3Year - a.rosterStrength3Year)
}

function latestGeneratedAt(rows: DynastyProjectionOutput[]): string | null {
  if (!rows.length) return null
  const latest = rows
    .map((r) => new Date(r.createdAt).getTime())
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a)[0]
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await ctx.params
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  }
  // Membership gate. Reachable both directly and via the [section]
  // dispatcher, and was open to anyone holding a league id.
  const gate = await requireLeagueApiAccess(leagueId)
  if (!gate.ok) return gate.response
  const sportQuery = req.nextUrl.searchParams?.get('sport') ?? undefined
  const refresh = toBool(req.nextUrl.searchParams?.get('refresh'))
  const teamId = req.nextUrl.searchParams?.get('teamId') ?? undefined

  try {
    const league = await resolveLeagueByAnyId(leagueId)
    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 })
    }
    const sport = resolveSportForDynasty(sportQuery ?? league.sport)

    let projections = await getDynastyProjectionsForLeague(league.id, sport)
    let generated = false

    if (refresh || projections.length === 0) {
      const { teamInputs } = await buildTeamInputsFromLeague({
        leagueId: league.id,
        sportOverride: sport,
        teamIdFilter: teamId,
      })
      projections = await generateForInputs(teamInputs, true)
      generated = true
    } else if (teamId) {
      projections = projections.filter((p) => p.teamId === teamId)
    }

    return NextResponse.json({
      sport,
      generated,
      generatedAt: latestGeneratedAt(projections),
      projections,
    })
  } catch (e) {
    console.error('[dynasty-projections GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load dynasty projections' },
      { status: 500 }
    )
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await ctx.params
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  }
  // Membership gate. Reachable both directly and via the [section]
  // dispatcher, and was open to anyone holding a league id.
  const gate = await requireLeagueApiAccess(leagueId)
  if (!gate.ok) return gate.response

  let body: {
    teamInputs?: TeamDynastyInputs[]
    persist?: boolean
    sport?: string
    season?: number
    teamId?: string
  } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {}

  const persist = body.persist !== false
  const providedInputs = Array.isArray(body.teamInputs) ? body.teamInputs : []
  try {
    if (providedInputs.length > 0) {
      const results = await generateForInputs(
        providedInputs.map((input) => ({
          ...input,
          leagueId: input.leagueId || leagueId,
        })),
        persist
      )
      return NextResponse.json({
        generated: true,
        generatedAt: latestGeneratedAt(results),
        projections: results,
      })
    }

    const { league, teamInputs } = await buildTeamInputsFromLeague({
      leagueId,
      sportOverride: body.sport,
      seasonOverride: body.season,
      teamIdFilter: body.teamId,
    })
    const results = await generateForInputs(teamInputs, persist)
    return NextResponse.json({
      sport: resolveSportForDynasty(body.sport ?? league.sport),
      generated: true,
      generatedAt: latestGeneratedAt(results),
      projections: results,
    })
  } catch (e) {
    console.error('[dynasty-projections POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to generate dynasty projections' },
      { status: 500 }
    )
  }
}
