/**
 * Bridge raw pool / DB rows into NormalizedDraftEntry, then unified product view.
 */

import type { PoolPlayerRecord } from '@/lib/sport-teams/types'
import {
  normalizeDraftPlayer,
  type RawDraftPlayerLike,
} from '@/lib/draft-sports-models/normalize-draft-player'
import type { LeagueSport } from '@prisma/client'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import {
  buildUnifiedPlayerProductView,
  type BuildUnifiedPlayerOptions,
  type UnifiedPlayerProductView,
} from '@/lib/player-data/unifiedPlayerProductView'
import { looksLikeSleeperExternalId } from '@/lib/draft-sports-models/player-asset-resolver'
import { normalizeSoccerLeague } from '@/lib/providers/rollingInsightsSoccerLeague'

function metadataBag(row: PoolPlayerRecord): Record<string, unknown> {
  const m = row.metadata
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : {}
}

/**
 * Map SportPlayerPoolResolver row → RawDraftPlayerLike for normalizeDraftPlayer().
 */
export function poolPlayerRecordToRawDraftLike(row: PoolPlayerRecord): RawDraftPlayerLike {
  const meta = metadataBag(row)
  const cls = meta.class ?? meta.collegeClass ?? meta.Class
  const birthDateRaw = meta.birthDateRaw ?? meta.birth_date_raw ?? meta.dateOfBirth
  const soccerLeague = meta.soccerLeague ?? meta.league ?? meta.competition

  const external = row.external_source_id?.trim() ?? ''
  const sleeperLike = external && looksLikeSleeperExternalId(external)

  return {
    full_name: row.full_name,
    position: row.position,
    team: row.team_abbreviation,
    teamAbbr: row.team_abbreviation,
    playerId: row.player_id,
    sleeperId: sleeperLike ? external : undefined,
    injuryStatus: row.injury_status,
    status: row.status,
    secondaryPositions: row.secondary_positions,
    age: row.age ?? undefined,
    yearsExp: row.experience ?? undefined,
    classYearLabel: typeof cls === 'string' ? cls : undefined,
    imageUrl: typeof meta.imageUrl === 'string' ? meta.imageUrl : typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined,
    college: typeof meta.college === 'string' ? meta.college : undefined,
    collegeOrPipeline: typeof meta.college === 'string' ? meta.college : undefined,
    birthDateRaw: typeof birthDateRaw === 'string' ? birthDateRaw : undefined,
    soccerLeague,
    metadata: meta,
  }
}

export function normalizePoolRowToEntry(row: PoolPlayerRecord, sport: LeagueSport | string): NormalizedDraftEntry {
  const entry = normalizeDraftPlayer(poolPlayerRecordToRawDraftLike(row), sport)
  const m = metadataBag(row)
  const br = m.birthDateRaw ?? m.birth_date_raw
  const loose: Record<string, unknown> = {}
  if (typeof br === 'string') loose.birthDateRaw = br
  const sl = m.soccerLeague ?? m.league ?? m.competition
  if (sl != null && String(sl).trim()) loose.soccerLeagueHint = String(sl).trim()
  return Object.keys(loose).length > 0 ? ({ ...entry, ...loose } as NormalizedDraftEntry) : entry
}

export function normalizePoolRowToUnified(
  row: PoolPlayerRecord,
  sport: LeagueSport | string,
  options?: BuildUnifiedPlayerOptions,
): UnifiedPlayerProductView {
  const entry = normalizePoolRowToEntry(row, sport)
  const meta = metadataBag(row)
  const soccerLeague =
    options?.augment?.soccerLeague ??
    normalizeSoccerLeague(meta.soccerLeague ?? meta.league ?? meta.competition)
  return buildUnifiedPlayerProductView(entry, {
    ...options,
    augment: {
      ...options?.augment,
      soccerLeague: soccerLeague ?? options?.augment?.soccerLeague,
    },
  })
}
