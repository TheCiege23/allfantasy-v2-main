/**
 * Resolve trade payload player assets → `sports_players.id` for normalized product data.
 * Does not mutate the trade payload.
 */

import { prisma } from '@/lib/prisma'

export type TradePlayerResolutionInput = {
  sport: string
  /** Lowercase full name → Sleeper-style player key from `getPlayersBySport` (same as trade-evaluator today). */
  nameLowerToExternalPid?: Record<string, string>
  assets: unknown[]
}

export type ResolvedTradePlayerAsset = {
  originalAsset: unknown
  playerId: string
  source: string
}

export type UnresolvedTradePlayerAsset = {
  originalAsset: unknown
  reason: string
}

export type ResolveTradePlayerAssetsResult = {
  resolved: ResolvedTradePlayerAsset[]
  unresolved: UnresolvedTradePlayerAsset[]
}

function asRecord(a: unknown): Record<string, unknown> | null {
  return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : null
}

function playerDisplayName(asset: unknown): string | null {
  if (typeof asset === 'string') return asset.trim() || null
  const o = asRecord(asset)
  const n = o?.name
  return typeof n === 'string' && n.trim() ? n.trim() : null
}

function optionalString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

/** Try resolve SportsPlayerRecord.id — ids may match pool keys or Sleeper keys depending on import. */
async function trySportsPlayerRecordId(candidate: string, sportUpper: string): Promise<string | null> {
  const row = await prisma.sportsPlayerRecord.findUnique({
    where: { id: candidate },
    select: { id: true, sport: true },
  })
  if (!row || String(row.sport).toUpperCase() !== sportUpper) return null
  return row.id
}

export async function resolveTradePlayerAssets(
  input: TradePlayerResolutionInput,
): Promise<ResolveTradePlayerAssetsResult> {
  const sportUpper = String(input.sport || 'NFL').toUpperCase()
  const resolved: ResolvedTradePlayerAsset[] = []
  const unresolved: UnresolvedTradePlayerAsset[] = []
  const seen = new Set<string>()

  for (const asset of input.assets) {
    const name = playerDisplayName(asset)
    const o = asRecord(asset)

    let candidateId: string | null = null
    let source = 'unknown'

    if (o) {
      const explicit =
        optionalString(o, [
          'playerId',
          'sportsPlayerId',
          'sports_player_id',
          'player_id',
          'internalPlayerId',
          'externalSourceId',
          'external_source_id',
          'providerPlayerId',
          'provider_player_id',
        ]) ?? null
      if (explicit) {
        candidateId = explicit
        source = 'explicit_player_id'
      }
      const sleeperKeys =
        optionalString(o, ['sleeperPlayerId', 'sleeper_id', 'sleeperPlayerID']) ?? null
      if (!candidateId && sleeperKeys) {
        candidateId = sleeperKeys
        source = 'explicit_sleeper_id'
      }
    }

    if (!candidateId && typeof asset === 'string') {
      unresolved.push({ originalAsset: asset, reason: 'string_asset_requires_name_map' })
      continue
    }

    if (!candidateId && name && input.nameLowerToExternalPid) {
      const pid = input.nameLowerToExternalPid[name.toLowerCase()]
      if (pid) {
        candidateId = pid
        source = 'sleeper_player_map_by_name'
      }
    }

    if (!candidateId) {
      unresolved.push({
        originalAsset: asset,
        reason: name ? 'no_external_mapping_for_name' : 'missing_name_and_ids',
      })
      continue
    }

    let internalId = await trySportsPlayerRecordId(candidateId, sportUpper)
    if (!internalId) {
      const sp = await prisma.sportsPlayer.findFirst({
        where: {
          sport: sportUpper,
          OR: [{ id: candidateId }, { sleeperId: candidateId }, { externalId: candidateId }],
        },
        select: { sleeperId: true, externalId: true, id: true },
      })
      if (sp?.sleeperId) {
        internalId = await trySportsPlayerRecordId(sp.sleeperId, sportUpper)
      }
      if (!internalId && sp?.externalId) {
        internalId = await trySportsPlayerRecordId(sp.externalId, sportUpper)
      }
      if (!internalId && sp?.id) {
        internalId = await trySportsPlayerRecordId(sp.id, sportUpper)
      }
      if (internalId) source = `${source}+sports_player_bridge`
    }

    if (!internalId) {
      unresolved.push({
        originalAsset: asset,
        reason: 'sports_player_record_not_found',
      })
      continue
    }

    if (seen.has(internalId)) continue
    seen.add(internalId)
    resolved.push({ originalAsset: asset, playerId: internalId, source })
  }

  return { resolved, unresolved }
}
