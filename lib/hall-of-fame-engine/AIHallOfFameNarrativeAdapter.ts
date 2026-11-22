/**
 * AIHallOfFameNarrativeAdapter — builds narrative payloads for AI "Tell me why this matters".
 * Consumes Hall of Fame entries/moments and produces structured context for storytelling.
 */

import type { HallOfFameEntryRow, HallOfFameMomentRow } from './HallOfFameQueryService'
import { getHallOfFameSportLabel } from './SportHallOfFameResolver'

interface HallOfFameNarrativeContext {
  type: 'entry' | 'moment'
  id: string
  title: string
  summary: string
  sport: string
  sportLabel: string
  leagueId: string | null
  season: string | null
  category: string
  score: number
  extra: Record<string, unknown>
}

export function entryToNarrativeContext(entry: HallOfFameEntryRow): HallOfFameNarrativeContext {
  return {
    type: 'entry',
    id: entry.id,
    title: entry.title,
    summary: entry.summary ?? '',
    sport: entry.sport,
    sportLabel: getHallOfFameSportLabel(entry.sport),
    leagueId: entry.leagueId,
    season: entry.season,
    category: entry.category,
    score: entry.score,
    extra: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      inductedAt: entry.inductedAt.toISOString(),
      metadata: entry.metadata,
    },
  }
}

export function momentToNarrativeContext(moment: HallOfFameMomentRow): HallOfFameNarrativeContext {
  return {
    type: 'moment',
    id: moment.id,
    title: moment.headline,
    summary: moment.summary ?? '',
    sport: moment.sport,
    sportLabel: getHallOfFameSportLabel(moment.sport),
    leagueId: moment.leagueId,
    season: moment.season,
    category: 'greatest_moments',
    score: moment.significanceScore,
    extra: {
      relatedManagerIds: moment.relatedManagerIds,
      relatedTeamIds: moment.relatedTeamIds,
      relatedMatchupId: moment.relatedMatchupId,
      createdAt: moment.createdAt.toISOString(),
    },
  }
}

/** Build a short "why inducted" explanation prompt context. */
export function buildWhyInductedPromptContext(context: HallOfFameNarrativeContext): string {
  const parts = [
    `Title: ${context.title}`,
    context.summary ? `Summary: ${context.summary}` : '',
    `Sport: ${context.sportLabel}`,
    context.leagueId ? `League ID: ${context.leagueId}` : '',
    context.season ? `Season: ${context.season}` : '',
    `Category: ${context.category}`,
    `Significance score: ${context.score.toFixed(2)}`,
  ].filter(Boolean)
  return parts.join('\n')
}
