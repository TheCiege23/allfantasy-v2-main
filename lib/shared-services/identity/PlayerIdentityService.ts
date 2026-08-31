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
 * KNOWN GAP, HALF CLOSED 2026-08-31 (do not silently paper over the rest):
 * `PlayerIdentityMap` has dedicated columns for sleeperId / espnId / mflId /
 * fleaflickerId, and now `fantraxId` — the schema change this docstring said was out of
 * scope has been made, and the column is written weekly by
 * `lib/devy/ingestFantraxPlayerIdentities.ts`. **Yahoo is still uncovered** and still
 * falls back to normalized-name matching only.
 *
 * ⚠ FANTRAX COVERAGE IS 25%, NOT 100%, AND THE REMAINDER IS NOT A MATCHING BUG.
 * Measured on the first real run: 4,210 of 16,904 ids linked, 12,694 unmatched and
 * **0 ambiguous** — a zero that is the whole diagnosis, since it says every failure was
 * "no such player in the registry" rather than "could not choose between two". The
 * NCAAF identity registry is the thin part (3,126 of 20,027 rows sourced from CFBD).
 * Widening it is the real unlock; this column is what lets the 25% resolve by id at all.
 */

import { resolveCanonicalPlayerId, resolveCanonicalPlayerIds } from '@/lib/league-import/playerIdResolver'
import type { ImportProvider } from '@/lib/league-import/types'
import type { PlayerIdentityResult } from './types'

const PROVIDER_COLUMN: Partial<Record<ImportProvider, string>> = {
  sleeper: 'sleeperId',
  espn: 'espnId',
  mfl: 'mflId',
  fleaflicker: 'fleaflickerId',
  fantrax: 'fantraxId',
  // yahoo intentionally absent — see module docstring.
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
