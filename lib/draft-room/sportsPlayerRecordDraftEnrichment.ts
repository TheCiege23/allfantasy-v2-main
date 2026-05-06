/**
 * Merge SportsPlayerRecord (`sports_players`) rows into draft pool enrichment.
 *
 * Identity rules (avoid wrong player stats/images):
 * - Scoped strictly by **league sport** in the Prisma query (no cross-sport merges).
 * - Composite keys include **sport** via `buildStrictPlayerKey` / `buildLoosePlayerKey`.
 * - Prefer **record id** match when pool row carries the same `sports_players.id`.
 * - Then **strict** canonical name + normalized position + normalized team + sport.
 * - **Loose** name + position + sport only when exactly one DB row exists for that loose key in the batch,
 *   or skip ambiguous buckets (logged).
 * - **Loose lookup at runtime** only when pool team is FA / blank — never for rostered real abbreviations.
 */

import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { classifyAvatarSource } from '@/lib/draft-room/classify-avatar-source'
import {
  buildLoosePlayerKey,
  buildStrictPlayerKey,
  isFreeAgentTeam,
  resolvePlayerIdentityConfidence,
  type IdentityMatchType,
} from '@/lib/player-identity/playerIdentityResolution'
import { logPlayerMismatchEventVoid } from '@/lib/player-identity/playerMismatchLogger'

export type SportsPlayerRecordDraftAugment = {
  fantasyPointsPerGame: number | null
  adp: number | null
  headshotUrl: string | null
  /** When true, treat as rookie class for badge (conservative — stats/experience heuristics). */
  rookieHint: boolean | null
}

function extractFppgFromJson(blob: unknown): number | null {
  if (blob == null) return null
  if (typeof blob === 'number' && Number.isFinite(blob) && blob > 0) return blob
  if (typeof blob !== 'object') return null
  const o = blob as Record<string, unknown>
  const candidates: unknown[] = [
    o.fantasyPointsPerGame,
    o.fppg,
    o.pointsPerGame,
    o.projectedPpg,
    (o.season as Record<string, unknown> | undefined)?.fantasyPointsPerGame,
    (o.season as Record<string, unknown> | undefined)?.fppg,
    (o.currentSeason as Record<string, unknown> | undefined)?.fantasyPointsPerGame,
  ]
  for (const c of candidates) {
    const n = Number(c)
    if (Number.isFinite(n) && n > 0 && n < 500) return n
  }
  return null
}

function extractRookieHint(
  stats: unknown,
  projections: unknown,
  sport: LeagueSport,
): boolean | null {
  const isNfl = String(sport).toUpperCase() === 'NFL'
  if (stats && typeof stats === 'object') {
    const s = stats as Record<string, unknown>
    if (s.rookie === true) return true
    if (s.isRookie === true) return true
    if (!isNfl) {
      const gp = Number(s.gamesPlayed ?? s.games ?? s.g)
      if (Number.isFinite(gp) && gp === 0) return true
    }
    const exp = Number(s.experience ?? s.yearsExp ?? s.years_experience)
    if (Number.isFinite(exp) && exp === 0) return true
  }
  if (projections && typeof projections === 'object') {
    const p = projections as Record<string, unknown>
    if (p.rookie === true || p.isRookie === true) return true
  }
  return null
}

function augmentFromRecord(
  row: {
    stats: unknown
    projections: unknown
    adp: number | null
    headshotUrl: string | null
    headshotUrlLg: string | null
  },
  sport: LeagueSport,
): SportsPlayerRecordDraftAugment {
  const fppg =
    extractFppgFromJson(row.projections) ??
    extractFppgFromJson(row.stats) ??
    null
  const adp = row.adp != null && Number.isFinite(Number(row.adp)) ? Number(row.adp) : null
  const rawHs = row.headshotUrlLg ?? row.headshotUrl ?? null
  const headshotUrl =
    rawHs && classifyAvatarSource(rawHs) === 'headshot' ? rawHs : null
  const rookieHint = extractRookieHint(row.stats, row.projections, sport)
  return {
    fantasyPointsPerGame: fppg,
    adp,
    headshotUrl,
    rookieHint,
  }
}

export type SportsPlayerRecordDraftMaps = {
  /** `sports_players.id` → augment (strongest match). */
  byRecordId: Map<string, SportsPlayerRecordDraftAugment>
  strict: Map<string, SportsPlayerRecordDraftAugment>
  loose: Map<string, SportsPlayerRecordDraftAugment>
}

export type SprLookupMeta = {
  matchType: IdentityMatchType
  confidence: number
  reason: string
  idLookupAttempted: boolean
  idLookupHit: boolean
  strictHitAfterIdMiss: boolean
}

export type SprLookupResult = {
  augment: SportsPlayerRecordDraftAugment | null
  meta: SprLookupMeta
}

/**
 * Batch-load `sports_players` projection cache rows for draft pool name list (single sport per call).
 */
export async function loadSportsPlayerRecordMapsForDraftPool(
  leagueId: string | undefined,
  sport: LeagueSport,
  rows: Array<{ name: string; position: string; team?: string | null }>,
): Promise<SportsPlayerRecordDraftMaps> {
  const byRecordId = new Map<string, SportsPlayerRecordDraftAugment>()
  const strict = new Map<string, SportsPlayerRecordDraftAugment>()
  const loose = new Map<string, SportsPlayerRecordDraftAugment>()
  const sportStr = String(sport).toUpperCase()
  const uniqueNames = [...new Set(rows.map((r) => String(r.name ?? '').trim()).filter(Boolean))]
  if (uniqueNames.length === 0) return { byRecordId, strict, loose }

  const nameTake = Math.min(uniqueNames.length, 2800)
  const namesIn = uniqueNames.slice(0, nameTake)

  let records: Array<{
    id: string
    name: string
    position: string
    team: string
    stats: unknown
    projections: unknown
    adp: number | null
    headshotUrl: string | null
    headshotUrlLg: string | null
  }> = []
  try {
    records = await prisma.sportsPlayerRecord.findMany({
      where: { sport: sportStr, name: { in: namesIn } },
      select: {
        id: true,
        name: true,
        position: true,
        team: true,
        stats: true,
        projections: true,
        adp: true,
        headshotUrl: true,
        headshotUrlLg: true,
      },
      take: 6000,
    })
  } catch {
    return { byRecordId, strict, loose }
  }

  const looseGroups = new Map<string, Map<string, SportsPlayerRecordDraftAugment>>()

  for (const rec of records) {
    const aug = augmentFromRecord(rec, sport)
    const rid = String(rec.id ?? '').trim()
    if (rid && !byRecordId.has(rid)) byRecordId.set(rid, aug)

    const strictKey = buildStrictPlayerKey({
      name: rec.name,
      position: rec.position,
      team: rec.team,
      sport: sportStr,
    })
    if (!strict.has(strictKey)) strict.set(strictKey, aug)

    const looseKey = buildLoosePlayerKey({
      name: rec.name,
      position: rec.position,
      sport: sportStr,
    })
    const bucket = looseGroups.get(looseKey) ?? new Map<string, SportsPlayerRecordDraftAugment>()
    bucket.set(strictKey, aug)
    looseGroups.set(looseKey, bucket)
  }

  for (const [looseKey, bucket] of looseGroups) {
    if (bucket.size !== 1) {
      if (bucket.size > 1) {
        logPlayerMismatchEventVoid({
          leagueId: leagueId ?? null,
          sport: sportStr,
          reason: 'AMBIGUOUS_LOOSE_MATCH_SKIPPED',
          playerName: null,
          position: null,
          team: null,
          attemptedMatchType: 'loose',
          confidence: null,
          details: {
            looseKey,
            distinctStrictKeys: [...bucket.keys()],
            count: bucket.size,
          },
        })
      }
      continue
    }
    const onlyAug = [...bucket.values()][0]!
    loose.set(looseKey, onlyAug)
  }

  return { byRecordId, strict, loose }
}

export function lookupSportsPlayerRecordAugmentDetailed(
  maps: SportsPlayerRecordDraftMaps,
  sport: LeagueSport,
  name: string,
  position: string,
  team: string | null | undefined,
  poolExternalOrRecordId?: string | null,
): SprLookupResult {
  const sportU = String(sport).toUpperCase()
  const pid = String(poolExternalOrRecordId ?? '').trim()
  const idLookupAttempted = Boolean(pid)
  let idLookupHit = false
  let strictHitAfterIdMiss = false

  if (pid && maps.byRecordId.has(pid)) {
    idLookupHit = true
    return {
      augment: maps.byRecordId.get(pid)!,
      meta: {
        matchType: 'id',
        confidence: resolvePlayerIdentityConfidence('id'),
        reason: 'sports_players.id matched pool external / record id',
        idLookupAttempted,
        idLookupHit,
        strictHitAfterIdMiss: false,
      },
    }
  }

  const strictKey = buildStrictPlayerKey({ name, position, team, sport: sportU })
  const strictHit = maps.strict.get(strictKey)
  if (strictHit) {
    strictHitAfterIdMiss = idLookupAttempted && !idLookupHit
    return {
      augment: strictHit,
      meta: {
        matchType: 'strict',
        confidence: resolvePlayerIdentityConfidence('strict'),
        reason: 'strict identity key matched (name + position + team + sport)',
        idLookupAttempted,
        idLookupHit,
        strictHitAfterIdMiss,
      },
    }
  }

  const poolTeamMissingOrFa = !team?.trim() || isFreeAgentTeam(team, sport)
  if (poolTeamMissingOrFa) {
    const looseKey = buildLoosePlayerKey({ name, position, sport: sportU })
    const looseHit = maps.loose.get(looseKey)
    if (looseHit) {
      return {
        augment: looseHit,
        meta: {
          matchType: 'loose',
          confidence: resolvePlayerIdentityConfidence('loose'),
          reason: 'unique loose key in batch; pool team FA or blank',
          idLookupAttempted,
          idLookupHit,
          strictHitAfterIdMiss: false,
        },
      }
    }
  }

  return {
    augment: null,
    meta: {
      matchType: 'none',
      confidence: 0,
      reason: 'no sports_players row matched identity rules',
      idLookupAttempted,
      idLookupHit,
      strictHitAfterIdMiss: false,
    },
  }
}

/**
 * @param poolExternalOrRecordId — `SportsPlayerRecord.id` / pool `player_id` when aligned with sports_players cache.
 */
export function lookupSportsPlayerRecordAugment(
  maps: SportsPlayerRecordDraftMaps,
  sport: LeagueSport,
  name: string,
  position: string,
  team: string | null | undefined,
  poolExternalOrRecordId?: string | null,
): SportsPlayerRecordDraftAugment | null {
  return lookupSportsPlayerRecordAugmentDetailed(
    maps,
    sport,
    name,
    position,
    team,
    poolExternalOrRecordId,
  ).augment
}
