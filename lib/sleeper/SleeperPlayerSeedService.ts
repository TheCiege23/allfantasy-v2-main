import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  SUPPORTED_SPORTS,
  normalizeToSupportedSport,
  type SupportedSport,
} from '@/lib/sport-scope'
import { apiChain } from '@/lib/workers/api-chain'
import {
  normalizePosition,
  normalizeTeamAbbrev,
} from '@/lib/team-abbrev'
import { getPlayersBySport } from '@/lib/sleeper-client'

const UPSERT_BATCH_SIZE = 100
const SLEEPER_SOURCE = 'sleeper'
const SLEEPER_PLAYER_TTL_MS = 7 * 24 * 60 * 60 * 1000

const SLEEPER_ENDPOINT_SPORTS: Partial<Record<SupportedSport, string>> = {
  NFL: 'nfl',
  NBA: 'nba',
}

type SleeperPlayerRecord = {
  player_id?: string
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  search_full_name?: string | null
  team?: string | null
  position?: string | null
  years_exp?: number | string | null
  age?: number | string | null
  height?: string | null
  weight?: string | null
  college?: string | null
  status?: string | null
  injury_status?: string | null
  injury_notes?: string | null
  active?: boolean | null
}

type SeededPlayer = {
  playerId: string
  name: string
  team: string
  position: string
  headshotUrl: string | null
  age: number | null
  height: string | null
  weight: string | null
  college: string | null
  yearsExp: number | null
  status: string | null
  injuryStatus: string | null
  injuryNotes: string | null
}

export type SleeperPlayerSeedResult = {
  sport: SupportedSport
  source: string
  endpointSport: string | null
  fetched: number
  sportsPlayerRecordAvailable: boolean
  seededSportsPlayerRecords: number
  seededSportsPlayers: number
  seededIdentityMaps: number
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function resolveSleeperEndpointSport(sport: SupportedSport): string | null {
  return SLEEPER_ENDPOINT_SPORTS[sport] ?? null
}

function buildSleeperHeadshotUrl(sport: SupportedSport, playerId: string): string | null {
  if (sport !== 'NFL') return null
  return `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`
}

function buildPlayerName(player: SleeperPlayerRecord): string {
  const fullName =
    player.full_name?.trim() ||
    [player.first_name?.trim(), player.last_name?.trim()].filter(Boolean).join(' ').trim() ||
    player.search_full_name?.trim() ||
    ''

  return fullName
}

function normalizeSleeperPlayer(
  sport: SupportedSport,
  key: string,
  player: SleeperPlayerRecord
): SeededPlayer | null {
  const playerId = String(player.player_id ?? key ?? '').trim()
  const name = buildPlayerName(player)
  if (!playerId || !name) return null

  const team = normalizeTeamAbbrev(player.team) ?? 'FA'
  const position = normalizePosition(player.position) ?? 'FLEX'

  return {
    playerId,
    name,
    team,
    position,
    headshotUrl: buildSleeperHeadshotUrl(sport, playerId),
    age: toFiniteNumber(player.age),
    height: player.height?.trim() || null,
    weight: player.weight?.trim() || null,
    college: player.college?.trim() || null,
    yearsExp: toFiniteNumber(player.years_exp),
    status: player.status?.trim() || (player.active === false ? 'inactive' : null),
    injuryStatus: player.injury_status?.trim() || null,
    injuryNotes: player.injury_notes?.trim() || null,
  }
}

async function fetchSleeperPlayers(sport: SupportedSport): Promise<SeededPlayer[]> {
  const endpointSport = resolveSleeperEndpointSport(sport)
  if (!endpointSport) {
    throw new Error(
      `Sleeper player sync is not available for ${sport} yet. Currently supported: ${Object.keys(
        SLEEPER_ENDPOINT_SPORTS
      ).join(', ')}.`
    )
  }

  const payload = (await getPlayersBySport(endpointSport)) as unknown as Record<string, SleeperPlayerRecord>
  return Object.entries(payload)
    .map(([key, value]) => normalizeSleeperPlayer(sport, key, value))
    .filter((player): player is SeededPlayer => Boolean(player))
}

function normalizeProviderPlayer(
  sport: SupportedSport,
  row: Record<string, unknown>
): SeededPlayer | null {
  const playerId = String(row.id ?? row.externalId ?? row.playerId ?? '').trim()
  const name = String(row.name ?? row.fullName ?? row.displayName ?? '').trim()
  if (!playerId || !name) return null

  return {
    playerId,
    name,
    team: normalizeTeamAbbrev(String(row.team ?? row.teamAbbrev ?? '')) ?? 'FA',
    position: normalizePosition(String(row.position ?? row.pos ?? '')) ?? 'FLEX',
    headshotUrl: String(row.imageUrl ?? row.headshotUrl ?? '').trim() || null,
    age: toFiniteNumber(row.age),
    height: String(row.height ?? '').trim() || null,
    weight: String(row.weight ?? '').trim() || null,
    college: String(row.college ?? '').trim() || null,
    yearsExp: toFiniteNumber(row.yearsExp ?? row.years_exp),
    status: String(row.status ?? '').trim() || null,
    injuryStatus: String(row.injuryStatus ?? row.injury_status ?? '').trim() || null,
    injuryNotes: String(row.injuryNotes ?? row.injury_notes ?? '').trim() || null,
  }
}

async function fetchSeedPlayers(sport: SupportedSport): Promise<{
  endpointSport: string | null
  players: SeededPlayer[]
  source: string
}> {
  const endpointSport = resolveSleeperEndpointSport(sport)
  if (endpointSport) {
    return {
      endpointSport,
      players: await fetchSleeperPlayers(sport),
      source: SLEEPER_SOURCE,
    }
  }

  const response = await apiChain.fetch<Array<Record<string, unknown>>>({
    sport,
    dataType: 'players',
  })

  const rows = Array.isArray(response.data) ? response.data : []
  return {
    endpointSport: null,
    source: response.source,
    players: rows
      .map((row) => normalizeProviderPlayer(sport, row))
      .filter((player): player is SeededPlayer => Boolean(player)),
  }
}

async function hasSportsPlayerRecordTable(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'sports_players'
       ) AS exists`
    )
    return Boolean(rows[0]?.exists)
  } catch {
    return false
  }
}

export async function seedSleeperPlayers(input: {
  sport: string
}): Promise<SleeperPlayerSeedResult> {
  const sport = normalizeToSupportedSport(input.sport)
  if (!SUPPORTED_SPORTS.includes(sport)) {
    throw new Error(`Unsupported sport: ${input.sport}`)
  }

  const endpointSport = resolveSleeperEndpointSport(sport)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SLEEPER_PLAYER_TTL_MS)
  const seedData = await fetchSeedPlayers(sport)
  const players = seedData.players
  const sportsPlayerRecordAvailable = await hasSportsPlayerRecordTable()

  const sportsPlayerRows = players.map((player) => ({
    sport,
    externalId: player.playerId,
    name: player.name,
    position: player.position,
    team: player.team,
    age: player.age,
    /*
     * ⚠ PARSED SINCE THIS SERVICE WAS WRITTEN, WRITTEN ONLY NOW. `years_exp`
     * has always been read off Sleeper's feed into `SeededPlayer` and then
     * dropped at the write, because `SportsPlayer` had no column for it. The
     * value ledger carried "experience / rookie year" as blocked for that
     * reason, with the gap named in `trajectory.ts` rather than guessed at.
     *
     * `toFiniteNumber` returns null for a missing field, so a player Sleeper
     * has no experience figure for stays null rather than becoming a rookie.
     */
    yearsExp: player.yearsExp,
    height: player.height,
    weight: player.weight,
    college: player.college,
    imageUrl: player.headshotUrl,
    sleeperId: player.playerId,
    status: player.status,
    source: seedData.source,
    fetchedAt: now,
    expiresAt,
  }))

  // ID format must match sports-data-importer (`${sport}:${rawId}`) so that
  // downstream lookups like getPlayer("NFL:4017") resolve regardless of which
  // importer wrote the row last.
  const sportsPlayerRecordRows = players.map((player) => ({
    id: `${sport}:${player.playerId}`,
    sport,
    name: player.name,
    team: player.team,
    position: player.position,
    stats: {},
    projections: {},
    adp: null,
    dynastyValue: null,
    injuryStatus: player.injuryStatus,
    injuryNotes: player.injuryNotes,
    news: [],
    dataSource: seedData.source,
    headshotUrl: player.headshotUrl,
  }))

  await prisma.sportsPlayer.deleteMany({
    where: {
      sport,
      source: seedData.source,
    },
  })

  for (const batch of chunk(sportsPlayerRows, UPSERT_BATCH_SIZE)) {
    await prisma.sportsPlayer.createMany({
      data: batch,
      skipDuplicates: true,
    })
  }

  if (sportsPlayerRecordAvailable) {
    await prisma.sportsPlayerRecord.deleteMany({
      where: { sport, dataSource: seedData.source },
    })

    for (const batch of chunk(sportsPlayerRecordRows, UPSERT_BATCH_SIZE)) {
      await prisma.sportsPlayerRecord.createMany({
        data: batch,
        skipDuplicates: true,
      })
    }
  }

  return {
    sport,
    source: seedData.source,
    endpointSport: seedData.endpointSport ?? endpointSport ?? null,
    fetched: players.length,
    sportsPlayerRecordAvailable,
    seededSportsPlayerRecords: sportsPlayerRecordAvailable ? players.length : 0,
    seededSportsPlayers: players.length,
    seededIdentityMaps: 0,
  }
}
