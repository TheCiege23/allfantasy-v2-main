/**
 * Deterministic checks for dispersal drafts, player-pool modes (rookies/vets),
 * and commissioner-defined asset rules. Runs after roster-fit, alongside devy/C2C.
 */

import type { PickValidationResult } from './PickValidation'

export type DispersalPoolConfig = {
  /** If non-empty, only these rosters may be on the clock during this draft session. */
  eligibleRosterIds?: string[]
  /** Player IDs that cannot be selected (protected / reserved). */
  protectedPlayerIds?: string[]
  /** Subset of asset types allowed when set (e.g. player, rookie_pick, dispersal_asset). */
  allowedAssetTypes?: string[]
}

function normalizeConfig(raw: unknown): DispersalPoolConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const eligibleRosterIds = Array.isArray(o.eligibleRosterIds)
    ? o.eligibleRosterIds.filter((x): x is string => typeof x === 'string')
    : undefined
  const protectedPlayerIds = Array.isArray(o.protectedPlayerIds)
    ? o.protectedPlayerIds.filter((x): x is string => typeof x === 'string')
    : undefined
  const allowedAssetTypes = Array.isArray(o.allowedAssetTypes)
    ? o.allowedAssetTypes.filter((x): x is string => typeof x === 'string')
    : undefined
  if (!eligibleRosterIds?.length && !protectedPlayerIds?.length && !allowedAssetTypes?.length) return null
  return { eligibleRosterIds, protectedPlayerIds, allowedAssetTypes }
}

export function parseDispersalPoolConfig(raw: unknown): DispersalPoolConfig | null {
  return normalizeConfig(raw)
}

export interface SpecialtyPoolValidationInput {
  draftModeLabel: string | null | undefined
  dispersalPoolConfig: unknown
  playerPool: string
  effectiveRosterId: string
  onClockRosterId: string
  playerId: string | null | undefined
  playerName: string
  position: string
  assetType: string
  pickMetadata?: Record<string, unknown> | null
  /**
   * The server's own rookie verdict from the resolved draft pool (`resolveServerRookieStatus`).
   * When it is a boolean it decides rookies-only / veterans-only eligibility and the client's
   * metadata is ignored; `null`/absent falls back to the metadata hint.
   */
  serverRookieStatus?: boolean | null
  /** Skip pool checks (e.g. commissioner override) when true. */
  commissionerOverride?: boolean
}

/**
 * Lightweight rookie/vet hints: pool entries may send `isRookie` / `yearsExperience` in pickMetadata.
 */
function metadataSuggestsRookie(meta: Record<string, unknown> | null | undefined): boolean | null {
  if (!meta) return null
  if (typeof meta.isRookie === 'boolean') return meta.isRookie
  const y = meta.yearsExperience
  if (typeof y === 'number' && Number.isFinite(y)) return y === 0
  const ys = meta.yearsExperienceLabel
  if (typeof ys === 'string' && /rookie/i.test(ys)) return true
  return null
}

/**
 * Validate dispersal + player pool + asset type rules.
 */
export function validateSpecialtyDraftPools(input: SpecialtyPoolValidationInput): PickValidationResult {
  if (input.commissionerOverride) return { valid: true }

  const isSkip = (input.position || '').toUpperCase() === 'SKIP'
  if (isSkip) return { valid: true }

  const dispersal = parseDispersalPoolConfig(input.dispersalPoolConfig)
  const isDispersalMode =
    String(input.draftModeLabel ?? '').toLowerCase() === 'dispersal' || dispersal != null

  if (isDispersalMode && dispersal) {
    if (dispersal.eligibleRosterIds && dispersal.eligibleRosterIds.length > 0) {
      if (!dispersal.eligibleRosterIds.includes(input.onClockRosterId)) {
        return { valid: false, error: 'This roster is not eligible for the dispersal draft.' }
      }
      if (!dispersal.eligibleRosterIds.includes(input.effectiveRosterId)) {
        return { valid: false, error: 'Pick must be made for an eligible dispersal roster.' }
      }
    }
    if (dispersal.protectedPlayerIds && dispersal.protectedPlayerIds.length > 0 && input.playerId) {
      if (dispersal.protectedPlayerIds.includes(input.playerId)) {
        return { valid: false, error: 'That player is protected and cannot be selected in this dispersal draft.' }
      }
    }
    if (dispersal.allowedAssetTypes && dispersal.allowedAssetTypes.length > 0) {
      const at = String(input.assetType || 'player')
      if (!dispersal.allowedAssetTypes.includes(at)) {
        return {
          valid: false,
          error: `Asset type "${at}" is not allowed in this dispersal pool.`,
        }
      }
    }
  }

  const pool = String(input.playerPool || 'all').toLowerCase()
  // The server's verdict wins: the client only ever sends `isRookie: true` or nothing, so a
  // metadata-only check could never refuse a veteran (see serverRookieStatus.ts).
  const rookie =
    typeof input.serverRookieStatus === 'boolean'
      ? input.serverRookieStatus
      : metadataSuggestsRookie(input.pickMetadata ?? undefined)
  if (pool === 'rookies_only') {
    if (rookie === false) {
      return { valid: false, error: 'Rookie-only pool: select a rookie-eligible player.' }
    }
  }
  if (pool === 'veterans_only') {
    if (rookie === true) {
      return { valid: false, error: 'Veterans-only pool: rookies are not eligible this draft.' }
    }
  }

  return { valid: true }
}
