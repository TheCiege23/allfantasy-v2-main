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
import { findSportsPlayersForLeague } from '@/lib/player-identity/findSportsPlayerByLeagueId'

type LeagueLite = {
  id: string
  platformLeagueId: string | null
  platform: string | null
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

/** A team left out of generation, with why — returned so the UI can say so instead of guessing. */
type SkippedTeam = { teamId: string; reason: 'empty_roster' }

/** Player values fed to the engine are heuristic estimates, not market (FantasyCalc/KTC) values. */
const PLAYER_VALUE_SOURCE = 'estimated' as const

type DraftSessionLite = {
  tradedPicks: unknown
}

/**
 * Heuristic base value by SPORT, then position. This used to be one flat table keyed by label, so
 * MLB catcher, NBA center and NHL center were all "C" = 6300, NBA guard and NHL goalie were both
 * "G", and a soccer "DEF" was priced as an NFL team defense. Every number here is an ESTIMATE
 * (position base x age curve + market trend), which the response says via `playerValueSource`.
 * NFL values are unchanged.
 */
const NBA_BASE: Record<string, number> = {
  PG: 6500, SG: 6400, SF: 6500, PF: 6400, C: 6300, G: 6450, F: 6450, 'G-F': 6450, 'F-C': 6350, UTIL: 6300,
}
const NFL_BASE: Record<string, number> = { QB: 7600, RB: 7000, WR: 6800, TE: 6100, K: 3600, DST: 4200, DEF: 4200 }
const POSITION_BASE_BY_SPORT: Record<string, Record<string, number>> = {
  NFL: NFL_BASE,
  // College reuses its pro sport's table on purpose: NCAAF rosters use exactly the NFL labels and
  // NCAAB the NBA ones (incl. the generic G / F slots), and these are relative within-league bases.
  NCAAF: NFL_BASE,
  NBA: NBA_BASE,
  NCAAB: NBA_BASE,
  NHL: { C: 6300, LW: 5900, RW: 5900, W: 5900, F: 6100, D: 5700, G: 6000 },
  // Catcher is the shallowest fantasy position in MLB, not a premium one.
  MLB: {
    SP: 6500, RP: 5000, P: 5800, C: 5300, '1B': 6100, '2B': 5800, '3B': 6000, SS: 5900,
    OF: 6100, LF: 6100, CF: 6100, RF: 6100, DH: 5600, UTIL: 5600,
  },
  // Soccer labels are keyed under SOCCER, so its DEF / D / F / G never read NFL DST or NBA/NHL values.
  SOCCER: {
    FWD: 6200, FW: 6200, F: 6200, ST: 6200, MID: 6000, MF: 6000, M: 6000,
    DEF: 5600, DF: 5600, D: 5600, GK: 5600, GKP: 5600, G: 5600,
  },
}
/** Unknown position: NFL keeps its historical 5200; elsewhere use the sport's floor, not a mid value. */
const NFL_UNKNOWN_POSITION_BASE = 5200

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

function getBaseValueForPosition(sport: string, position: string): number {
  const pos = position.toUpperCase()
  const s = resolveSportForDynasty(sport)
  const table = POSITION_BASE_BY_SPORT[s] ?? NFL_BASE
  const hit = table[pos]
  if (hit != null) return hit
  if (table === NFL_BASE) return NFL_UNKNOWN_POSITION_BASE
  return Math.min(...Object.values(table))
}

function estimateDynastyValue(params: {
  sport: string
  position: string
  age: number | null
  trendScore: number
  injuryRisk: number
}): number {
  const base = getBaseValueForPosition(params.sport, params.position)
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
      platform: true,
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
}): Promise<{ league: LeagueLite; teamInputs: TeamDynastyInputs[]; skippedTeams: SkippedTeam[] }> {
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
    /*
     * Roster ids are in the league PLATFORM's space. The old `externalId IN ids OR sleeperId IN ids`
     * read a Sleeper id as a Rolling Insights id too, and RI's player of that number is a stranger
     * whose age, position and injury status then priced this roster's dynasty value.
     */
    findSportsPlayersForLeague(sport, league.platform, playerIds),
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
  // Keyed by the roster id that asked — never re-keyed by a row's own `externalId`.
  const cachedById = cachedPlayers
  const trendByPlayerId = new Map(trends.map((t) => [t.playerId, t.trendScore]))
  const futurePicksByTeam = buildFuturePicksByTeam({
    teams,
    rosters,
    tradedPicksRaw: latestDraftSession?.tradedPicks ?? [],
    season,
  })
  const formatFlags = inferFormatFlags(league)

  /*
   * A team whose roster has no players is SKIPPED and reported, never projected. This used to
   * fabricate eight template players (ages 23-30, values from aiPowerScore) and persist a projection
   * built on them, which read as a real roster outlook for a team we know nothing about.
   */
  const skippedTeams: SkippedTeam[] = []
  const teamsWithPlayers = targetTeams.filter((team) => {
    const hasPlayers = (rosterPlayerIdsByTeam.get(team.externalId) ?? []).length > 0
    if (!hasPlayers) skippedTeams.push({ teamId: team.externalId, reason: 'empty_roster' })
    return hasPlayers
  })

  const teamInputs: TeamDynastyInputs[] = teamsWithPlayers.map((team) => {
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
      players: playersForTeam,
      futurePicks: futurePicksByTeam.get(team.externalId) ?? [],
    }
  })

  return { league, teamInputs, skippedTeams }
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
    let skippedTeams: SkippedTeam[] = []

    if (refresh || projections.length === 0) {
      const built = await buildTeamInputsFromLeague({
        leagueId: league.id,
        sportOverride: sport,
        teamIdFilter: teamId,
      })
      skippedTeams = built.skippedTeams
      projections = await generateForInputs(built.teamInputs, true)
      generated = true
    } else if (teamId) {
      projections = projections.filter((p) => p.teamId === teamId)
    }

    return NextResponse.json({
      sport,
      generated,
      generatedAt: latestGeneratedAt(projections),
      projections,
      skippedTeams,
      playerValueSource: PLAYER_VALUE_SOURCE,
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

    const { league, teamInputs, skippedTeams } = await buildTeamInputsFromLeague({
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
      skippedTeams,
      playerValueSource: PLAYER_VALUE_SOURCE,
    })
  } catch (e) {
    console.error('[dynasty-projections POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to generate dynasty projections' },
      { status: 500 }
    )
  }
}
