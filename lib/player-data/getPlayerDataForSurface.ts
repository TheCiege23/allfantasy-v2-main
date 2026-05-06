/**
 * Server-side orchestration: resolve normalized unified player rows per product surface.
 * Reads DB/import/cache only — no live Rolling Insights HTTP from routes.
 */

import type { LeagueSport } from '@prisma/client'
import type { PoolPlayerRecord, SportType } from '@/lib/sport-teams/types'
import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
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
      const out: UnifiedPlayerProductView[] = []
      for (const id of ids) {
        const row = await prisma.sportsPlayerRecord.findUnique({
          where: { id },
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
          },
        })
        if (!row || sportDbKey(row.sport) !== sportKey) continue

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
            imageUrl: row.headshotUrl,
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
        const out: UnifiedPlayerProductView[] = []
        for (const id of input.playerIds.slice(0, limit)) {
          const row = await prisma.sportsPlayerRecord.findUnique({
            where: { id },
          })
          if (!row || sportDbKey(row.sport) !== sportKey) continue
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
            metadata: { imageUrl: row.headshotUrl },
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
