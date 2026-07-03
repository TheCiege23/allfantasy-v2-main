/**
 * Server-side orchestration: resolve normalized unified player rows per product surface.
 * Reads DB/import/cache only — no live Rolling Insights HTTP from routes.
 */

import type { LeagueSport } from '@prisma/client'
import type { PoolPlayerRecord, SportType } from '@/lib/sport-teams/types'
import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { getTeamLogo } from '@/lib/players/getTeamLogo'
import {
  buildUnifiedPlayerProductView,
  type PlayerDataSurface,
  type UnifiedPlayerAugment,
  type UnifiedPlayerProductView,
} from '@/lib/player-data/unifiedPlayerProductView'
import {
  normalizePoolRowToEntry,
  normalizePoolRowToUnified,
} from '@/lib/player-data/normalizeProviderPlayer'
import type { RollingInsightsSoccerLeagueCode } from '@/lib/providers/rollingInsightsSoccerLeague'

export type GetPlayerDataForSurfaceInput = {
  surface: PlayerDataSurface
  leagueId?: string | null
  sport?: LeagueSport | string | null
  userId?: string | null
  playerIds?: string[] | null
  limit?: number
  /** Soccer competition hint for SOCCER leagues (EPL / LALIGA / SERIEA). */
  soccerLeague?: RollingInsightsSoccerLeagueCode | null
  /** Waivers: case-insensitive substring on player display name. */
  waiverSearch?: string | null
  /** Waivers: forwarded to `getPlayerPoolForLeague`. */
  waiverPosition?: string | null
  waiverTeamId?: string | null
}

/** Batch-load sports_players augment slices for waiver/free-agent lists. */
async function batchAugmentsFromSportsPlayerRecords(
  sportDb: string,
  playerIds: string[],
): Promise<Map<string, UnifiedPlayerAugment>> {
  const map = new Map<string, UnifiedPlayerAugment>()
  const uniq = [...new Set(playerIds.filter(Boolean))]
  if (uniq.length === 0) return map
  const rows = await prisma.sportsPlayerRecord.findMany({
    where: { id: { in: uniq }, sport: sportDb },
    select: {
      id: true,
      stats: true,
      projections: true,
      dataSource: true,
      headshotSource: true,
      adp: true,
    },
  })
  for (const row of rows) {
    map.set(row.id, {
      sportsPlayerRecord: {
        stats: row.stats,
        projections: row.projections,
        dataSource: row.dataSource,
        headshotSource: row.headshotSource,
        adp: row.adp,
      },
    })
  }
  return map
}

function sportDbKey(leagueSport: LeagueSport | string): string {
  return String(leagueSport).toUpperCase()
}

type CanonicalMediaSeed = {
  recordId: string
  name: string
  team: string | null
  position: string | null
  sport: string
  recordHeadshotUrl?: string | null
  recordHeadshotUrlSm?: string | null
  recordHeadshotUrlLg?: string | null
  recordLogoUrl?: string | null
}

type CanonicalMedia = {
  headshotUrl: string | null
  teamLogoUrl: string | null
}

function isHttpUrl(value: unknown): value is string {
  return /^https?:\/\//i.test(String(value ?? '').trim())
}

function normalizeMediaKey(name: string, team: string | null, position: string | null): string {
  return `${String(name ?? '').trim().toLowerCase()}|${String(team ?? '').trim().toUpperCase()}|${String(position ?? '').trim().toUpperCase()}`
}

function normalizeLooseMediaKey(name: string, position: string | null): string {
  return `${String(name ?? '').trim().toLowerCase()}|${String(position ?? '').trim().toUpperCase()}`
}

function sportsPlayerSourceRank(source: string | null | undefined): number {
  const normalized = String(source ?? '').trim().toLowerCase()
  if (normalized === 'thesportsdb') return 60
  if (normalized === 'clearsports') return 50
  if (normalized === 'api_sports' || normalized === 'api-sports') return 40
  if (normalized === 'rolling_insights') return 30
  if (normalized === 'sleeper') return 20
  if (normalized === 'backfill') return 10
  return 0
}

function chooseBestSportsPlayerRow<T extends { imageUrl?: string | null; source?: string | null }>(
  current: T | undefined,
  candidate: T,
): T {
  if (!current) return candidate
  const currentScore = sportsPlayerSourceRank(current.source) + (isHttpUrl(current.imageUrl) ? 1_000 : 0)
  const candidateScore = sportsPlayerSourceRank(candidate.source) + (isHttpUrl(candidate.imageUrl) ? 1_000 : 0)
  return candidateScore > currentScore ? candidate : current
}

function pickRecordHeadshot(seed: CanonicalMediaSeed): string | null {
  const preferred = [seed.recordHeadshotUrl, seed.recordHeadshotUrlLg, seed.recordHeadshotUrlSm]
  for (const value of preferred) {
    if (isHttpUrl(value)) return value
  }
  return null
}

async function batchLoadCanonicalPlayerMedia(
  sport: string,
  seeds: CanonicalMediaSeed[],
): Promise<Map<string, CanonicalMedia>> {
  const out = new Map<string, CanonicalMedia>()
  const normalizedSport = sportDbKey(sport)
  const rawIds = [...new Set(
    seeds
      .map((seed) => {
        const token = String(seed.recordId ?? '').trim()
        if (!token) return null
        const idx = token.indexOf(':')
        return idx >= 0 ? token.slice(idx + 1) : token
      })
      .filter((value): value is string => Boolean(value)),
  )]
  const names = [...new Set(seeds.map((seed) => seed.name).filter(Boolean))]

  const [sportsPlayerRows, fantasyPlayerRows] = await Promise.all([
    prisma.sportsPlayer
      .findMany({
        where: {
          sport: normalizedSport,
          OR: [
            ...(rawIds.length > 0 ? [{ externalId: { in: rawIds } }, { sleeperId: { in: rawIds } }] : []),
            ...(names.length > 0 ? [{ name: { in: names } }] : []),
          ],
        },
        select: {
          externalId: true,
          sleeperId: true,
          name: true,
          team: true,
          position: true,
          imageUrl: true,
          source: true,
        },
      })
      .catch(() => []),
    (prisma as any).fantasyPlayer
      ?.findMany({
        where: {
          sport: normalizedSport,
          ...(names.length > 0 ? { fullName: { in: names } } : {}),
        },
        select: {
          fullName: true,
          team: true,
          position: true,
          headshotUrl: true,
        },
      })
      .catch(() => []) ?? Promise.resolve([]),
  ])

  const sportsPlayerByExternalId = new Map<string, (typeof sportsPlayerRows)[number]>()
  const sportsPlayerByStrictKey = new Map<string, (typeof sportsPlayerRows)[number]>()
  const sportsPlayerByLooseKey = new Map<string, (typeof sportsPlayerRows)[number]>()
  for (const row of sportsPlayerRows) {
    const strictKey = normalizeMediaKey(row.name, row.team, row.position)
    const looseKey = normalizeLooseMediaKey(row.name, row.position)
    const externalIds = [row.externalId, row.sleeperId].filter((value): value is string => Boolean(value))
    for (const externalId of externalIds) {
      sportsPlayerByExternalId.set(
        externalId,
        chooseBestSportsPlayerRow(sportsPlayerByExternalId.get(externalId), row),
      )
    }
    sportsPlayerByStrictKey.set(
      strictKey,
      chooseBestSportsPlayerRow(sportsPlayerByStrictKey.get(strictKey), row),
    )
    sportsPlayerByLooseKey.set(
      looseKey,
      chooseBestSportsPlayerRow(sportsPlayerByLooseKey.get(looseKey), row),
    )
  }

  const fantasyPlayerByStrictKey = new Map<string, string>()
  const fantasyPlayerByLooseKey = new Map<string, string>()
  for (const row of fantasyPlayerRows as Array<{
    fullName: string
    team: string | null
    position: string | null
    headshotUrl: string | null
  }>) {
    if (!isHttpUrl(row.headshotUrl)) continue
    const strictKey = normalizeMediaKey(row.fullName, row.team, row.position)
    const looseKey = normalizeLooseMediaKey(row.fullName, row.position)
    if (!fantasyPlayerByStrictKey.has(strictKey)) fantasyPlayerByStrictKey.set(strictKey, row.headshotUrl)
    if (!fantasyPlayerByLooseKey.has(looseKey)) fantasyPlayerByLooseKey.set(looseKey, row.headshotUrl)
  }

  for (const seed of seeds) {
    const rawIdToken = String(seed.recordId ?? '').trim()
    const rawId = rawIdToken.includes(':') ? rawIdToken.slice(rawIdToken.indexOf(':') + 1) : rawIdToken
    const strictKey = normalizeMediaKey(seed.name, seed.team, seed.position)
    const looseKey = normalizeLooseMediaKey(seed.name, seed.position)
    const sportsPlayerMatch =
      (rawId ? sportsPlayerByExternalId.get(rawId) : undefined) ??
      sportsPlayerByStrictKey.get(strictKey) ??
      sportsPlayerByLooseKey.get(looseKey)
    const sportsPlayerHeadshot =
      sportsPlayerMatch && isHttpUrl(sportsPlayerMatch.imageUrl) ? sportsPlayerMatch.imageUrl : null
    const fantasyPlayerHeadshot =
      fantasyPlayerByStrictKey.get(strictKey) ?? fantasyPlayerByLooseKey.get(looseKey) ?? null
    const recordHeadshot = pickRecordHeadshot(seed)
    out.set(seed.recordId, {
      headshotUrl: sportsPlayerHeadshot ?? fantasyPlayerHeadshot ?? recordHeadshot,
      teamLogoUrl:
        (isHttpUrl(seed.recordLogoUrl) ? seed.recordLogoUrl : null) ??
        getTeamLogo(seed.team, normalizedSport),
    })
  }

  return out
}

export async function getPlayerDataForSurface(
  input: GetPlayerDataForSurfaceInput,
): Promise<UnifiedPlayerProductView[]> {
  const limit = Math.min(500, Math.max(1, input.limit ?? 200))

  switch (input.surface) {
    case 'draft': {
      if (!input.leagueId) return []
      const { getResolvedDraftPoolForLeague } = await import('@/lib/draft-room/getResolvedDraftPoolForLeague')
      const pool = await getResolvedDraftPoolForLeague(input.leagueId, { limit })
      if (pool.rosterConfigurationIncomplete) return []
      const augment =
        input.soccerLeague != null ? { soccerLeague: input.soccerLeague } satisfies UnifiedPlayerAugment : undefined
      return pool.entries.map((e) =>
        buildUnifiedPlayerProductView(e, augment ? { augment } : undefined),
      )
    }

    case 'waivers': {
      if (!input.leagueId) return []
      const league = await prisma.league.findUnique({
        where: { id: input.leagueId },
        select: { sport: true },
      })
      if (!league?.sport) return []
      const sport = league.sport
      const sportKey = sportDbKey(sport)

      const rosters = await prisma.roster.findMany({
        where: { leagueId: input.leagueId },
        select: { playerData: true },
      })
      const rosteredIds = new Set<string>()
      for (const r of rosters) {
        getRosterPlayerIds(r.playerData).forEach((id) => rosteredIds.add(id))
      }

      const pool = await getPlayerPoolForLeague(input.leagueId, sport, {
        limit: 800,
        position: input.waiverPosition ?? undefined,
        teamId: input.waiverTeamId ?? undefined,
      })

      const q = (input.waiverSearch ?? '').trim().toLowerCase()
      const pending: PoolPlayerRecord[] = []
      for (const row of pool) {
        const pid = String(row.player_id ?? '')
        const ext = String(row.external_source_id ?? '')
        if ((pid && rosteredIds.has(pid)) || (ext && rosteredIds.has(ext))) continue
        if (q && !String(row.full_name ?? '').toLowerCase().includes(q)) continue
        pending.push(row)
        if (pending.length >= limit) break
      }

      const pids = pending.map((r) => String(r.player_id ?? '')).filter(Boolean)
      const augMap = await batchAugmentsFromSportsPlayerRecords(sportKey, pids)
      const soccerAug =
        input.soccerLeague != null ? ({ soccerLeague: input.soccerLeague } satisfies UnifiedPlayerAugment) : {}

      const out: UnifiedPlayerProductView[] = []
      for (const row of pending) {
        const pid = String(row.player_id ?? '')
        const entry = normalizePoolRowToEntry(row, sport)
        const sprAug = augMap.get(pid)
        const augment: UnifiedPlayerAugment = { ...(sprAug ?? {}), ...soccerAug }
        const hasAugment = Object.keys(augment).length > 0
        out.push(buildUnifiedPlayerProductView(entry, hasAugment ? { augment } : undefined))
      }
      return out
    }

    case 'roster':
    case 'lineup': {
      if (!input.leagueId) return []
      const league = await prisma.league.findUnique({
        where: { id: input.leagueId },
        select: { sport: true },
      })
      if (!league?.sport) return []

      const roster =
        input.userId != null
          ? await prisma.roster.findFirst({
              where: { leagueId: input.leagueId, platformUserId: input.userId },
              select: { playerData: true },
            })
          : await prisma.roster.findFirst({
              where: { leagueId: input.leagueId },
              select: { playerData: true },
            })

      if (!roster?.playerData) return []
      let ids = getRosterPlayerIds(roster.playerData)
      if (input.playerIds?.length) {
        const allow = new Set(input.playerIds)
        ids = ids.filter((id) => allow.has(id))
      }
      ids = ids.slice(0, limit)

      const sportKey = sportDbKey(league.sport)
      const rows = await prisma.sportsPlayerRecord.findMany({
        where: { id: { in: ids }, sport: sportKey },
        select: {
          id: true,
          sport: true,
          name: true,
          team: true,
          position: true,
          stats: true,
          projections: true,
          dataSource: true,
          headshotSource: true,
          injuryStatus: true,
          adp: true,
          headshotUrl: true,
          headshotUrlSm: true,
          headshotUrlLg: true,
          logoUrl: true,
        },
      })
      const rowById = new Map(rows.map((row) => [row.id, row]))
      const mediaById = await batchLoadCanonicalPlayerMedia(
        sportKey,
        rows.map((row) => ({
          recordId: row.id,
          name: row.name,
          team: row.team,
          position: row.position,
          sport: row.sport,
          recordHeadshotUrl: row.headshotUrl,
          recordHeadshotUrlSm: row.headshotUrlSm,
          recordHeadshotUrlLg: row.headshotUrlLg,
          recordLogoUrl: row.logoUrl,
        })),
      )
      const out: UnifiedPlayerProductView[] = []
      for (const id of ids) {
        const row = rowById.get(id)
        if (!row || sportDbKey(row.sport) !== sportKey) continue
        const media = mediaById.get(row.id)

        const syntheticPoolRow: PoolPlayerRecord = {
          player_id: row.id,
          sport_type: league.sport as SportType,
          team_id: null,
          team_abbreviation: row.team,
          team: row.team,
          full_name: row.name,
          position: row.position,
          status: null,
          injury_status: row.injuryStatus,
          external_source_id: null,
          secondary_positions: [],
          metadata: {
            imageUrl: media?.headshotUrl ?? null,
            headshotUrl: media?.headshotUrl ?? null,
            teamLogoUrl: media?.teamLogoUrl ?? null,
          },
        }

        const augment: UnifiedPlayerAugment = {
          soccerLeague: input.soccerLeague ?? undefined,
          sportsPlayerRecord: {
            stats: row.stats,
            projections: row.projections,
            dataSource: row.dataSource,
            headshotSource: row.headshotSource,
            adp: row.adp,
          },
        }

        out.push(
          normalizePoolRowToUnified(syntheticPoolRow, league.sport, {
            augment,
          }),
        )
      }
      return out
    }

    case 'trade':
    case 'player_card':
    case 'matchup':
    case 'ai_context': {
      /** Until waivers/rosters callers migrate, reuse waiver-style pool scoping by league when ids absent. */
      if (input.playerIds?.length && input.leagueId) {
        const league = await prisma.league.findUnique({
          where: { id: input.leagueId },
          select: { sport: true },
        })
        if (!league?.sport) return []
        const sportKey = sportDbKey(league.sport)
        const ids = input.playerIds.slice(0, limit)
        const rows = await prisma.sportsPlayerRecord.findMany({
          where: { id: { in: ids }, sport: sportKey },
          select: {
            id: true,
            sport: true,
            name: true,
            team: true,
            position: true,
            stats: true,
            projections: true,
            dataSource: true,
            headshotSource: true,
            injuryStatus: true,
            adp: true,
            headshotUrl: true,
            headshotUrlSm: true,
            headshotUrlLg: true,
            logoUrl: true,
          },
        })
        const rowById = new Map(rows.map((row) => [row.id, row]))
        const mediaById = await batchLoadCanonicalPlayerMedia(
          sportKey,
          rows.map((row) => ({
            recordId: row.id,
            name: row.name,
            team: row.team,
            position: row.position,
            sport: row.sport,
            recordHeadshotUrl: row.headshotUrl,
            recordHeadshotUrlSm: row.headshotUrlSm,
            recordHeadshotUrlLg: row.headshotUrlLg,
            recordLogoUrl: row.logoUrl,
          })),
        )
        const out: UnifiedPlayerProductView[] = []
        for (const id of ids) {
          const row = rowById.get(id)
          if (!row || sportDbKey(row.sport) !== sportKey) continue
          const media = mediaById.get(row.id)
          const syntheticPoolRow: PoolPlayerRecord = {
            player_id: row.id,
            sport_type: league.sport as SportType,
            team_id: null,
            team_abbreviation: row.team,
            team: row.team,
            full_name: row.name,
            position: row.position,
            status: null,
            injury_status: row.injuryStatus,
            external_source_id: null,
            secondary_positions: [],
            metadata: {
              imageUrl: media?.headshotUrl ?? null,
              headshotUrl: media?.headshotUrl ?? null,
              teamLogoUrl: media?.teamLogoUrl ?? null,
            },
          }
          out.push(
            normalizePoolRowToUnified(syntheticPoolRow, league.sport, {
              augment: {
                soccerLeague: input.soccerLeague ?? undefined,
                sportsPlayerRecord: {
                  stats: row.stats,
                  projections: row.projections,
                  dataSource: row.dataSource,
                  headshotSource: row.headshotSource,
                  adp: row.adp,
                },
              },
            }),
          )
        }
        return out
      }
      if (!input.leagueId) return []
      return getPlayerDataForSurface({
        ...input,
        surface: 'waivers',
      })
    }
  }
}
