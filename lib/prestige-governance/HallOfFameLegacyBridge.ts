/**
 * HallOfFameLegacyBridge — connects Hall of Fame entries/moments to legacy score context.
 * Used when showing "Why inducted?" and "View legacy score" for the same entity.
 */

import {
  getEntryById,
  getEntryByIdScoped,
  getMomentById,
  getMomentByIdScoped,
} from '@/lib/hall-of-fame-engine/HallOfFameQueryService'
import { getLegacyScoreByEntity } from '@/lib/legacy-score-engine/LegacyRankingService'
import type { LegacyScoreRow } from '@/lib/legacy-score-engine/LegacyRankingService'

interface HallOfFameEntryWithLegacy {
  entryId: string
  entityType: string
  entityId: string
  sport: string
  leagueId: string | null
  season: string | null
  category: string
  title: string
  summary: string | null
  score: number
  /** Legacy record when entityType is MANAGER or TEAM and a record exists. */
  legacy: LegacyScoreRow | null
}

interface HallOfFameMomentWithLegacy {
  momentId: string
  leagueId: string
  sport: string
  season: string
  headline: string
  summary: string | null
  relatedManagerIds: string[]
  significanceScore: number
  /** Legacy records for related managers (keyed by entityId). */
  relatedLegacy: Map<string, LegacyScoreRow>
}

/**
 * Enrich a Hall of Fame entry with legacy score when the entry is for a MANAGER or TEAM.
 */
export async function getHallOfFameEntryWithLegacy(
  input: { entryId: string; leagueId?: string | null }
): Promise<HallOfFameEntryWithLegacy | null> {
  const entry = input.leagueId
    ? await getEntryByIdScoped({
        entryId: input.entryId,
        leagueId: input.leagueId,
      })
    : await getEntryById(input.entryId)
  if (!entry) return null

  const legacy =
    entry.entityType === 'MANAGER' || entry.entityType === 'TEAM'
      ? await getLegacyScoreByEntity(
          entry.entityType,
          entry.entityId,
          entry.sport,
          entry.leagueId
        )
      : null

  return {
    entryId: entry.id,
    entityType: entry.entityType,
    entityId: entry.entityId,
    sport: entry.sport,
    leagueId: entry.leagueId,
    season: entry.season,
    category: entry.category,
    title: entry.title,
    summary: entry.summary,
    score: entry.score,
    legacy,
  }
}

/**
 * Enrich a Hall of Fame moment with legacy scores for related managers.
 */
export async function getHallOfFameMomentWithLegacy(
  input: { momentId: string; leagueId?: string | null }
): Promise<HallOfFameMomentWithLegacy | null> {
  const moment = input.leagueId
    ? await getMomentByIdScoped({
        momentId: input.momentId,
        leagueId: input.leagueId,
      })
    : await getMomentById(input.momentId)
  if (!moment) return null

  const relatedLegacy = new Map<string, LegacyScoreRow>()
  const managerScores = await Promise.all(
    moment.relatedManagerIds.map(async (managerId) => {
      const rec = await getLegacyScoreByEntity('MANAGER', managerId, moment.sport, moment.leagueId)
      return rec ? { managerId, rec } : null
    })
  )
  for (const row of managerScores) {
    if (row?.rec) relatedLegacy.set(row.managerId, row.rec)
  }

  return {
    momentId: moment.id,
    leagueId: moment.leagueId,
    sport: moment.sport,
    season: moment.season,
    headline: moment.headline,
    summary: moment.summary,
    relatedManagerIds: moment.relatedManagerIds,
    significanceScore: moment.significanceScore,
    relatedLegacy,
  }
}
