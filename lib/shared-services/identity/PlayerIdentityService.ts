/**
 * PlayerIdentityService — Identity Service, Fantasy OS Migration Plan Milestone 1.
 *
 * Wraps (does not replace) the existing, already-live `lib/league-import/playerIdResolver.ts`,
 * which resolves provider player ids against the real, global `PlayerIdentityMap` table.
 * This is the cross-provider player identity mapping contract described in the Shared
 * Fantasy Data Model spec's `Player` object — it already exists in this codebase and is
 * actively used by scoring lookups; this module gives it the Identity Service's typed
 * contract shape (matchedField, sourceAttribution) without duplicating its logic.
 *
 * KNOWN GAP (do not silently paper over): `PlayerIdentityMap` has dedicated columns for
 * sleeperId / espnId / mflId / fleaflickerId, but NOT for yahoo or fantrax. Resolution for
 * those two providers falls back to normalized-name matching only, inherited directly from
 * the underlying resolver. This is tracked as a "missing normalization" blocker in the
 * Migration Plan (Part 9) — closing it requires a schema change, which is out of scope for
 * this additive phase.
 */

import { resolveCanonicalPlayerId, resolveCanonicalPlayerIds } from '@/lib/league-import/playerIdResolver'
import type { ImportProvider } from '@/lib/league-import/types'
import type { PlayerIdentityResult } from './types'

const PROVIDER_COLUMN: Partial<Record<ImportProvider, string>> = {
  sleeper: 'sleeperId',
  espn: 'espnId',
  mfl: 'mflId',
  fleaflicker: 'fleaflickerId',
  // yahoo / fantrax intentionally absent — see module docstring.
}

export async function resolvePlayerIdentity(args: {
  provider: ImportProvider
  sourceId: string
  nameHint?: string | null
  positionHint?: string | null
}): Promise<PlayerIdentityResult> {
  const result = await resolveCanonicalPlayerId(args)
  const resolvedAt = new Date()
  return {
    canonicalPlayerId: result.canonicalId,
    confidence: result.confidence,
    matchedProvider: args.provider,
    matchedField: result.confidence === 'direct' ? (PROVIDER_COLUMN[args.provider] ?? null) : null,
    sourceAttribution: { sourceTable: 'PlayerIdentityMap', resolvedAt },
  }
}

export async function resolvePlayerIdentities(args: {
  provider: ImportProvider
  sourceIds: string[]
  playerMap?: Record<string, { name: string; position: string }>
}): Promise<Record<string, PlayerIdentityResult>> {
  const raw = await resolveCanonicalPlayerIds(args)
  const resolvedAt = new Date()
  const out: Record<string, PlayerIdentityResult> = {}
  for (const [sourceId, result] of Object.entries(raw)) {
    out[sourceId] = {
      canonicalPlayerId: result.canonicalId,
      confidence: result.confidence,
      matchedProvider: args.provider,
      matchedField: result.confidence === 'direct' ? (PROVIDER_COLUMN[args.provider] ?? null) : null,
      sourceAttribution: { sourceTable: 'PlayerIdentityMap', resolvedAt },
    }
  }
  return out
}
