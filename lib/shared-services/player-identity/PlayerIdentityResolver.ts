/**
 * PlayerIdentityResolver — the one authoritative, provider-neutral entry
 * point for resolving a provider player reference to a canonical
 * `PlayerIdentityMap` row. Fantasy OS Phase 14.
 *
 * Deterministic strategy (never silently invents a mapping; unresolved is an
 * explicit, real outcome):
 *   1. Direct id match against `PlayerIdentityMap`'s provider-specific column
 *      (real columns confirmed in `ProviderAdapters.ts`).
 *   2. Cache short-circuit (an already-computed direct/name-match result for
 *      the same provider+sourceId — folded into the cache layer rather than
 *      a separate DB step, since re-querying `PlayerIdentityMap` a second
 *      time would be identical to step 1).
 *   3. Direct id match against `SportsPlayer.sleeperId` — a second real
 *      source, Sleeper only (see ProviderAdapters.ts for why).
 *   4. Normalized name (+ team/position when available) match against
 *      `PlayerIdentityMap`, with the same real disambiguation approach
 *      already proven in `lib/unified-player-service.ts`'s
 *      `disambiguateCandidate` (position/team match scoring, tie detection)
 *      — reimplemented here as the canonical, provider-neutral version
 *      rather than importing that legacy-surface-only module.
 *   5. Optional injectable alias map — empty by default; no persisted alias
 *      store exists in this schema today (Phase 14 audit finding). A real
 *      extension point, not a fabricated capability.
 *   6. Confidence scoring — computed from which step matched and whether
 *      disambiguation was unambiguous (see `ResolutionConfidence`).
 */

import { prisma } from '@/lib/prisma'
import { getProviderCapability } from './ProviderAdapters'
import { defaultResolutionCache, type InMemoryResolutionCache } from './ResolutionCache'
import type {
  AliasMap,
  CanonicalPlayer,
  IdentityDiagnostics,
  ProviderPlayerRef,
  ResolutionResult,
} from './types'
import type { ImportProvider } from '@/lib/league-import/types'

export interface ResolveOptions {
  cache?: InMemoryResolutionCache
  aliasMap?: AliasMap
}

type PlayerIdentityMapRow = {
  id: string
  canonicalName: string
  normalizedName: string
  position: string | null
  currentTeam: string | null
  sport: string
  sleeperId: string | null
  espnId: string | null
  mflId: string | null
  fleaflickerId: string | null
}

const IDENTITY_MAP_SELECT = {
  id: true,
  canonicalName: true,
  normalizedName: true,
  position: true,
  currentTeam: true,
  sport: true,
  sleeperId: true,
  espnId: true,
  mflId: true,
  fleaflickerId: true,
} as const

export function normalizePlayerNameForResolution(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').trim()
}

function toCanonicalPlayer(row: PlayerIdentityMapRow): CanonicalPlayer {
  return {
    canonicalPlayerId: row.id,
    canonicalName: row.canonicalName,
    normalizedName: row.normalizedName,
    position: row.position,
    team: row.currentTeam,
    sport: row.sport,
    providerIds: {
      sleeper: row.sleeperId,
      espn: row.espnId,
      mfl: row.mflId,
      fleaflicker: row.fleaflickerId,
    },
  }
}

function unresolvedResult(input: ProviderPlayerRef, reason: string): ResolutionResult {
  return {
    input,
    player: null,
    confidence: 'unresolved',
    source: 'unresolved',
    resolvedAt: new Date().toISOString(),
    diagnostics: { matchedField: null, candidateCount: 0, tiedCandidates: 0, reason },
  }
}

/**
 * Real disambiguation scoring — adapted from `lib/unified-player-service.ts`'s
 * `disambiguateCandidate`, kept provider-neutral and dependency-free here.
 */
function disambiguate(
  candidates: PlayerIdentityMapRow[],
  positionHint?: string | null,
  teamHint?: string | null
): { best: PlayerIdentityMapRow; candidateCount: number; tiedCandidates: number } {
  if (candidates.length === 1) {
    return { best: candidates[0], candidateCount: 1, tiedCandidates: 1 }
  }

  let best = candidates[0]
  let bestScore = -Infinity
  let tied = 0

  for (const c of candidates) {
    let score = 0
    if (positionHint && c.position) {
      score += c.position.toUpperCase() === positionHint.toUpperCase() ? 5 : -3
    }
    if (teamHint && c.currentTeam) {
      score += c.currentTeam.toUpperCase() === teamHint.toUpperCase() ? 4 : 0
    }
    if (c.sleeperId) score += 1
    if (c.espnId) score += 1

    if (score > bestScore) {
      best = c
      bestScore = score
      tied = 1
    } else if (score === bestScore) {
      tied += 1
    }
  }

  return { best, candidateCount: candidates.length, tiedCandidates: tied }
}

async function resolveDirectViaPlayerIdentityMap(
  provider: ImportProvider,
  sourceId: string
): Promise<PlayerIdentityMapRow | null> {
  const capability = getProviderCapability(provider)
  const source = capability.directIdSources.find((s) => s.table === 'PlayerIdentityMap')
  if (!source) return null
  return prisma.playerIdentityMap.findFirst({
    where: { [source.column]: sourceId } as Record<string, string>,
    select: IDENTITY_MAP_SELECT,
  })
}

/** Sleeper-only real second source: `SportsPlayer.sleeperId`. Returns a synthetic PlayerIdentityMap-shaped row (no canonical UUID minted — see diagnostics.reason). */
async function resolveDirectViaSportsPlayer(
  provider: ImportProvider,
  sourceId: string
): Promise<{ name: string; position: string | null; team: string | null; sport: string } | null> {
  const capability = getProviderCapability(provider)
  const source = capability.directIdSources.find((s) => s.table === 'SportsPlayer')
  if (!source) return null
  const row = await prisma.sportsPlayer.findFirst({
    where: { [source.column]: sourceId } as Record<string, string>,
    select: { name: true, position: true, team: true, sport: true },
    orderBy: { fetchedAt: 'desc' },
  })
  return row
}

async function resolveByName(
  nameHint: string,
  positionHint: string | null | undefined,
  teamHint: string | null | undefined,
  sport: string | undefined
): Promise<{ best: PlayerIdentityMapRow; candidateCount: number; tiedCandidates: number } | null> {
  const normalized = normalizePlayerNameForResolution(nameHint)
  if (!normalized) return null
  const candidates = await prisma.playerIdentityMap.findMany({
    where: { normalizedName: normalized, ...(sport ? { sport } : {}) },
    select: IDENTITY_MAP_SELECT,
  })
  if (candidates.length === 0) return null
  return disambiguate(candidates, positionHint, teamHint)
}

export async function resolvePlayer(ref: ProviderPlayerRef, options: ResolveOptions = {}): Promise<ResolutionResult> {
  const cache = options.cache ?? defaultResolutionCache
  const aliasMap = options.aliasMap ?? {}

  if (ref.sourceId) {
    const cached = cache.get(ref.provider, ref.sourceId)
    if (cached) return { ...cached, source: 'cache' }
  }

  // Step 1: direct PlayerIdentityMap match.
  if (ref.sourceId) {
    const direct = await resolveDirectViaPlayerIdentityMap(ref.provider, ref.sourceId)
    if (direct) {
      const capability = getProviderCapability(ref.provider)
      const column = capability.directIdSources.find((s) => s.table === 'PlayerIdentityMap')?.column ?? null
      const result: ResolutionResult = {
        input: ref,
        player: toCanonicalPlayer(direct),
        confidence: 'direct',
        source: 'player_identity_map_direct',
        resolvedAt: new Date().toISOString(),
        diagnostics: { matchedField: column, candidateCount: 1, tiedCandidates: 1, reason: `Direct match on PlayerIdentityMap.${column}` },
      }
      cache.set(ref.provider, ref.sourceId, result)
      return result
    }

    // Step 3: direct SportsPlayer match (Sleeper only today).
    const viaSportsPlayer = await resolveDirectViaSportsPlayer(ref.provider, ref.sourceId)
    if (viaSportsPlayer) {
      // Not a PlayerIdentityMap row — no canonical UUID exists yet for this player.
      // Reported honestly as a resolved-but-non-canonical match, never a fabricated UUID.
      const result: ResolutionResult = {
        input: ref,
        player: {
          canonicalPlayerId: `sportsplayer:${ref.provider}:${ref.sourceId}`,
          canonicalName: viaSportsPlayer.name,
          normalizedName: normalizePlayerNameForResolution(viaSportsPlayer.name),
          position: viaSportsPlayer.position,
          team: viaSportsPlayer.team,
          sport: viaSportsPlayer.sport,
          providerIds: { [ref.provider]: ref.sourceId } as CanonicalPlayer['providerIds'],
        },
        confidence: 'direct',
        source: 'sports_player_direct',
        resolvedAt: new Date().toISOString(),
        diagnostics: {
          matchedField: 'SportsPlayer.sleeperId',
          candidateCount: 1,
          tiedCandidates: 1,
          reason: 'Direct match on SportsPlayer.sleeperId — not yet present in PlayerIdentityMap, so no canonical cross-provider UUID exists; canonicalPlayerId is a synthetic, non-UUID placeholder.',
        },
      }
      cache.set(ref.provider, ref.sourceId, result)
      return result
    }
  }

  // Step 4: name/team/position fallback.
  if (ref.nameHint) {
    const nameResult = await resolveByName(ref.nameHint, ref.positionHint, ref.teamHint, ref.sport)
    if (nameResult) {
      const confidence = nameResult.tiedCandidates === 1 ? 'name_match_confident' : 'name_match_ambiguous'
      const result: ResolutionResult = {
        input: ref,
        player: toCanonicalPlayer(nameResult.best),
        confidence,
        source: 'player_identity_map_name_match',
        resolvedAt: new Date().toISOString(),
        diagnostics: {
          matchedField: 'normalizedName',
          candidateCount: nameResult.candidateCount,
          tiedCandidates: nameResult.tiedCandidates,
          reason:
            confidence === 'name_match_confident'
              ? 'Unambiguous normalized-name match.'
              : `${nameResult.tiedCandidates} candidates tied for best disambiguation score — best guess returned, treat with caution.`,
        },
      }
      if (ref.sourceId) cache.set(ref.provider, ref.sourceId, result)
      return result
    }

    // Step 5: alias map (real extension point, empty by default).
    const normalized = normalizePlayerNameForResolution(ref.nameHint)
    const aliasCanonicalId = aliasMap[normalized]
    if (aliasCanonicalId) {
      const row = await prisma.playerIdentityMap.findUnique({ where: { id: aliasCanonicalId }, select: IDENTITY_MAP_SELECT })
      if (row) {
        const result: ResolutionResult = {
          input: ref,
          player: toCanonicalPlayer(row),
          confidence: 'name_match_confident',
          source: 'alias_map',
          resolvedAt: new Date().toISOString(),
          diagnostics: { matchedField: 'aliasMap', candidateCount: 1, tiedCandidates: 1, reason: 'Matched via injected historical-alias map.' },
        }
        if (ref.sourceId) cache.set(ref.provider, ref.sourceId, result)
        return result
      }
    }
  }

  return unresolvedResult(
    ref,
    ref.sourceId
      ? `No direct id match for ${ref.provider}:${ref.sourceId}${ref.nameHint ? ' and no name-match candidate found' : ' and no nameHint was provided to attempt a fallback'}.`
      : 'No sourceId or nameHint provided — nothing to resolve against.'
  )
}

/** Batched resolution — avoids N+1 queries for a whole roster. */
export async function resolvePlayers(refs: ProviderPlayerRef[], options: ResolveOptions = {}): Promise<ResolutionResult[]> {
  const cache = options.cache ?? defaultResolutionCache
  const results: ResolutionResult[] = new Array(refs.length)
  const remaining: number[] = []

  refs.forEach((ref, i) => {
    if (ref.sourceId) {
      const cached = cache.get(ref.provider, ref.sourceId)
      if (cached) {
        results[i] = { ...cached, source: 'cache' }
        return
      }
    }
    remaining.push(i)
  })

  // Group remaining refs by provider for batched direct-id lookups.
  const byProvider = new Map<ImportProvider, number[]>()
  for (const i of remaining) {
    const provider = refs[i].provider
    if (!byProvider.has(provider)) byProvider.set(provider, [])
    byProvider.get(provider)!.push(i)
  }

  for (const [provider, indices] of byProvider) {
    const capability = getProviderCapability(provider)
    const idColumn = capability.directIdSources.find((s) => s.table === 'PlayerIdentityMap')?.column
    const idsWithSourceId = indices.filter((i) => refs[i].sourceId)
    const sourceIds = idsWithSourceId.map((i) => refs[i].sourceId as string)

    let identityRows: PlayerIdentityMapRow[] = []
    if (idColumn && sourceIds.length > 0) {
      identityRows = await prisma.playerIdentityMap.findMany({
        where: { [idColumn]: { in: sourceIds } } as Record<string, { in: string[] }>,
        select: IDENTITY_MAP_SELECT,
      })
    }
    const byId = new Map(identityRows.map((r) => [(r as unknown as Record<string, string>)[idColumn ?? ''], r]))

    const sportsPlayerColumn = capability.directIdSources.find((s) => s.table === 'SportsPlayer')?.column
    let sportsPlayerRows: Array<{ sleeperId: string | null; name: string; position: string | null; team: string | null; sport: string }> = []
    const stillUnresolvedIds = sourceIds.filter((id) => !byId.has(id))
    if (sportsPlayerColumn && stillUnresolvedIds.length > 0) {
      sportsPlayerRows = await prisma.sportsPlayer.findMany({
        where: { [sportsPlayerColumn]: { in: stillUnresolvedIds } } as Record<string, { in: string[] }>,
        select: { sleeperId: true, name: true, position: true, team: true, sport: true },
      })
    }
    const bySportsPlayerId = new Map(sportsPlayerRows.map((r) => [r.sleeperId as string, r]))

    for (const i of idsWithSourceId) {
      const ref = refs[i]
      const sourceId = ref.sourceId as string
      const direct = byId.get(sourceId)
      if (direct) {
        const result: ResolutionResult = {
          input: ref,
          player: toCanonicalPlayer(direct),
          confidence: 'direct',
          source: 'player_identity_map_direct',
          resolvedAt: new Date().toISOString(),
          diagnostics: { matchedField: idColumn ?? null, candidateCount: 1, tiedCandidates: 1, reason: `Direct match on PlayerIdentityMap.${idColumn}` },
        }
        cache.set(provider, sourceId, result)
        results[i] = result
        continue
      }

      const viaSportsPlayer = bySportsPlayerId.get(sourceId)
      if (viaSportsPlayer) {
        const result: ResolutionResult = {
          input: ref,
          player: {
            canonicalPlayerId: `sportsplayer:${provider}:${sourceId}`,
            canonicalName: viaSportsPlayer.name,
            normalizedName: normalizePlayerNameForResolution(viaSportsPlayer.name),
            position: viaSportsPlayer.position,
            team: viaSportsPlayer.team,
            sport: viaSportsPlayer.sport,
            providerIds: { [provider]: sourceId } as CanonicalPlayer['providerIds'],
          },
          confidence: 'direct',
          source: 'sports_player_direct',
          resolvedAt: new Date().toISOString(),
          diagnostics: {
            matchedField: 'SportsPlayer.sleeperId',
            candidateCount: 1,
            tiedCandidates: 1,
            reason: 'Direct match on SportsPlayer.sleeperId — not yet present in PlayerIdentityMap; canonicalPlayerId is a synthetic, non-UUID placeholder.',
          },
        }
        cache.set(provider, sourceId, result)
        results[i] = result
        continue
      }
    }

    // Anything still unresolved in this provider group falls through to per-item name resolution.
    for (const i of indices) {
      if (results[i]) continue
      const ref = refs[i]
      if (ref.nameHint) {
        results[i] = await resolvePlayer(ref, options)
      } else {
        results[i] = unresolvedResult(
          ref,
          ref.sourceId
            ? `No direct id match for ${ref.provider}:${ref.sourceId} and no nameHint was provided to attempt a fallback.`
            : 'No sourceId or nameHint provided — nothing to resolve against.'
        )
      }
    }
  }

  return results
}
