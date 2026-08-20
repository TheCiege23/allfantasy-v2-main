/**
 * Normalized visibility + monetization for canonical POST /api/leagues → Prisma transaction.
 * Single source of truth for discovery listing, extended settings, homepage payment flag, and finance rows.
 */

import type { LeagueFormatId } from '@/lib/league/format-engine'
import type { LeagueTreasuryProvider } from '@prisma/client'

/** Discovery / join posture stored on settings + conceptSetup. */
export type CanonicalLeagueDiscoveryVisibility = 'private' | 'public' | 'invite_only'

export type CanonicalVisibilityResolution = {
  /** Normalized discovery mode. */
  mode: CanonicalLeagueDiscoveryVisibility
  /** FindLeagueListing.isActive — only true for public discovery. */
  finderListingActive: boolean
  /** redraftLeagueExtendedSettings.isPublic — true for public (listed); false for private and invite_only. */
  extendedSettingsPublic: boolean
}

export type CanonicalPayoutType = 'commissioner_managed' | 'external_escrow' | 'not_configured'

export type CanonicalMonetizationResolution = {
  isPaidLeague: boolean
  entryFeeCents: number
  payoutType: CanonicalPayoutType
  commissionerPayoutResponsible: boolean
  /** LeagueFinance.treasuryProvider when not using external escrow URL. */
  treasuryProvider: LeagueTreasuryProvider
  externalEscrowUrl: string | null
  externalEscrowLabel: string | null
  /** Create a commissioner LeagueDues row when entryFeeCents > 0. */
  createCommissionerDuesRow: boolean
  /** LeagueDues.status for the commissioner seed row. */
  commissionerDuesStatus: 'pending' | 'waived'
}

const VISIBILITY_SET = new Set<string>(['private', 'public', 'invite_only'])

function readString(cs: Record<string, unknown>, key: string): string | null {
  const v = cs[key]
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

function readBool(cs: Record<string, unknown>, key: string): boolean | null {
  const v = cs[key]
  if (v === true) return true
  if (v === false) return false
  return null
}

function readIntCents(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(10_000_000, Math.floor(n))
}

/**
 * Resolves discovery visibility from canonical body + normalized Best Ball settings (if any).
 */
export function resolveCanonicalLeagueVisibility(input: {
  formatId: LeagueFormatId
  conceptSetup: Record<string, unknown> | null | undefined
  bestBallVisibility: 'public' | 'private' | null
}): CanonicalVisibilityResolution {
  const cs = input.conceptSetup && typeof input.conceptSetup === 'object' && !Array.isArray(input.conceptSetup)
    ? (input.conceptSetup as Record<string, unknown>)
    : {}

  const bb =
    cs.bestBall && typeof cs.bestBall === 'object' && !Array.isArray(cs.bestBall)
      ? (cs.bestBall as Record<string, unknown>)
      : null

  let mode: CanonicalLeagueDiscoveryVisibility = 'private'
  if (input.formatId === 'best_ball') {
    const isPublicBestBall =
      input.bestBallVisibility === 'public' || readString(bb ?? {}, 'visibility')?.toLowerCase() === 'public'
    mode = isPublicBestBall ? 'public' : 'private'
  } else {
    const raw = readString(cs, 'visibility')?.toLowerCase() ?? null
    if (raw && VISIBILITY_SET.has(raw)) {
      mode = raw as CanonicalLeagueDiscoveryVisibility
    } else if (readBool(cs, 'isPublic') === true) {
      mode = 'public'
    }
  }

  const finderListingActive = mode === 'public'
  const extendedSettingsPublic = mode === 'public'

  return {
    mode,
    finderListingActive,
    extendedSettingsPublic,
  }
}

/** Homepage `paymentEnabled`: paid + priced + payout model + not invite-only discovery. */
export function resolveHomepagePaymentEnabled(
  visibility: CanonicalVisibilityResolution,
  monetization: CanonicalMonetizationResolution,
): boolean {
  return (
    monetization.isPaidLeague &&
    monetization.entryFeeCents > 0 &&
    visibility.mode !== 'invite_only' &&
    monetization.payoutType !== 'not_configured'
  )
}

export function resolveCanonicalLeagueMonetization(input: {
  conceptSetup: Record<string, unknown> | null | undefined
}): CanonicalMonetizationResolution {
  const cs = input.conceptSetup && typeof input.conceptSetup === 'object' && !Array.isArray(input.conceptSetup)
    ? (input.conceptSetup as Record<string, unknown>)
    : {}

  const monetizationRaw = readString(cs, 'monetization')?.toLowerCase() ?? null
  const bestBall =
    cs.bestBall && typeof cs.bestBall === 'object' && !Array.isArray(cs.bestBall) ? (cs.bestBall as Record<string, unknown>) : null
  const bestBallMonetization = readString(bestBall ?? {}, 'monetization')?.toLowerCase() ?? null

  const isPaidLeague = monetizationRaw === 'paid' || bestBallMonetization === 'paid'

  const entryFromRoot = readIntCents(cs.entryFeeCents)
  const entryFromBb = readIntCents(bestBall?.entryFeeCents)
  const entryFeeCents = Math.max(entryFromRoot, entryFromBb)

  const payoutRaw = readString(cs, 'payoutType')?.toLowerCase() ?? null
  const payoutFromBb = readString(bestBall ?? {}, 'payoutType')?.toLowerCase() ?? null
  let payoutType: CanonicalPayoutType = 'not_configured'
  const p = payoutRaw ?? payoutFromBb
  if (p === 'commissioner_managed' || p === 'external_escrow' || p === 'not_configured') {
    payoutType = p
  } else if (p === 'leaguesafe_external') {
    payoutType = 'external_escrow'
  }

  const crRoot = readBool(cs, 'commissionerPayoutResponsible')
  const crBb = readBool(bestBall ?? {}, 'commissionerPayoutResponsible')
  const commissionerPayoutResponsible =
    crRoot === true || crBb === true ? true : crRoot === false || crBb === false ? false : isPaidLeague

  const externalEscrowUrl = readString(cs, 'externalEscrowUrl') ?? readString(bestBall ?? {}, 'externalEscrowUrl')
  const externalEscrowLabel = readString(cs, 'externalEscrowLabel') ?? readString(bestBall ?? {}, 'externalEscrowLabel')

  let treasuryProvider: LeagueTreasuryProvider = 'none'
  if (payoutType === 'external_escrow' && externalEscrowUrl) {
    treasuryProvider = 'external_escrow'
  } else if (payoutType === 'external_escrow') {
    treasuryProvider = 'manual'
  }

  const createCommissionerDuesRow = isPaidLeague && entryFeeCents > 0
  const commissionerDuesStatus: 'pending' | 'waived' = createCommissionerDuesRow ? 'pending' : 'waived'

  return {
    isPaidLeague,
    entryFeeCents,
    payoutType,
    commissionerPayoutResponsible,
    treasuryProvider,
    externalEscrowUrl,
    externalEscrowLabel,
    createCommissionerDuesRow,
    commissionerDuesStatus,
  }
}

export function mergeVisibilityMonetizationIntoSettingsSnapshot(
  snapshot: Record<string, unknown>,
  visibility: CanonicalVisibilityResolution,
  monetization: CanonicalMonetizationResolution,
): Record<string, unknown> {
  const homepagePayment = resolveHomepagePaymentEnabled(visibility, monetization)
  return {
    ...snapshot,
    canonical_visibility: visibility.mode,
    canonical_finder_listing_active: visibility.finderListingActive,
    canonical_extended_public: visibility.extendedSettingsPublic,
    canonical_homepage_payment_enabled: homepagePayment,
    canonical_monetization: {
      isPaidLeague: monetization.isPaidLeague,
      entryFeeCents: monetization.entryFeeCents,
      payoutType: monetization.payoutType,
      commissionerPayoutResponsible: monetization.commissionerPayoutResponsible,
      treasuryProvider: monetization.treasuryProvider,
      paymentEnabled: homepagePayment,
    },
  }
}
