/**
 * IDP player eligibility: resolve position tags (grouped vs split), dedupe, audit position changes.
 * Handles ambiguity between grouped and split; preserves integrity when tags update midseason.
 * PROMPT 5/6.
 */

import { prisma } from '@/lib/prisma'
import type { IdpPositionMode } from './types'

const IDP_SPLIT_POSITIONS = ['DE', 'DT', 'LB', 'CB', 'S'] as const

function normalizeTag(tag: string): string {
  const u = (tag || '').trim().toUpperCase()
  if (u === 'SS' || u === 'FS') return 'S'
  if (u === 'OLB' || u === 'ILB' || u === 'MLB') return 'LB'
  return u
}

/**
 * Dedupe and normalize position tags from external source (e.g. Sleeper returns DE,DL).
 */
export function dedupePositionTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const n = normalizeTag(t)
    if (!n || seen.has(n)) continue
    if (IDP_SPLIT_POSITIONS.includes(n as (typeof IDP_SPLIT_POSITIONS)[number]) || n === 'DL' || n === 'DB') {
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

/**
 * Resolve effective position(s) for a player: prefer IdpPlayerEligibility if present (league or global), else fallback to single position.
 */
export async function resolveEligibility(
  sportsPlayerId: string,
  fallbackPosition: string | null,
  options: { leagueId?: string; positionMode?: IdpPositionMode } = {}
): Promise<string[]> {
  const { leagueId, positionMode = 'standard' } = options
  const rows = await prisma.idpPlayerEligibility.findMany({
    where: {
      sportsPlayerId,
      ...(leagueId
        ? { OR: [{ leagueId: IDP_GLOBAL_LEAGUE_SENTINEL }, { leagueId }] }
        : { leagueId: IDP_GLOBAL_LEAGUE_SENTINEL }),
    },
    orderBy: { leagueId: 'desc' },
    take: 2,
  })
  const rawTags =
    rows.length > 0
      ? (rows[0].positionTags as string[]).filter((t): t is string => typeof t === 'string')
      : fallbackPosition
        ? [normalizeTag(fallbackPosition)]
        : []
  return dedupePositionTags(rawTags)
}

/**
 * Check if player is eligible for an IDP slot (grouped or split) using resolved tags.
 */
export function isEligibleForSlot(
  resolvedPositions: string[],
  slotName: string,
  positionMode: IdpPositionMode
): boolean {
  const slot = slotName.toUpperCase()
  if (slot === 'IDP_FLEX') return resolvedPositions.some((p) => IDP_SPLIT_POSITIONS.includes(p as any) || p === 'DL' || p === 'DB')
  if (slot === 'DL') return resolvedPositions.some((p) => p === 'DE' || p === 'DT' || p === 'DL')
  if (slot === 'DB') return resolvedPositions.some((p) => p === 'CB' || p === 'S' || p === 'DB')
  if (IDP_SPLIT_POSITIONS.includes(slot as any)) return resolvedPositions.includes(slot)
  return false
}

/** Sentinel for global (league-agnostic) eligibility; Prisma unique treats null as distinct so we use a sentinel. */
export const IDP_GLOBAL_LEAGUE_SENTINEL = '__global__'

/**
 * Upsert eligibility tags for a player (league-specific or global). Dedupes before save.
 */
export async function upsertEligibility(
  sportsPlayerId: string,
  positionTags: string[],
  options: { leagueId?: string | null; source?: string } = {}
): Promise<void> {
  const tags = dedupePositionTags(positionTags)
  const source = options.source ?? 'sync'
  const leagueId = options.leagueId == null ? IDP_GLOBAL_LEAGUE_SENTINEL : options.leagueId
  await prisma.idpPlayerEligibility.upsert({
    where: {
      sportsPlayerId_leagueId: { sportsPlayerId, leagueId },
    },
    create: {
      sportsPlayerId,
      leagueId,
      positionTags: tags,
      source,
    },
    update: {
      positionTags: tags,
      source,
    },
  })
}

/**
 * Record position tag change for audit (call from sync/job when external data changes).
 * Does not move defenders across slots; caller must enforce no silent moves without audit.
 */
export async function recordEligibilityChangeAudit(
  leagueId: string,
  configId: string,
  actorId: string | null,
  playerId: string,
  before: string[],
  after: string[]
): Promise<void> {
  const { writeIdpSettingsAudit } = await import('./IdpSettingsAudit')
  await writeIdpSettingsAudit({
    leagueId,
    configId,
    actorId,
    action: 'eligibility_change',
    before: { type: 'eligibility_change', playerId, positions: before },
    after: { type: 'eligibility_change', playerId, positions: after },
    metadata: { source: 'IdpEligibilityService.recordEligibilityChangeAudit' },
  })
}
