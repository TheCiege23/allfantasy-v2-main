/**
 * Phase 2A/2B regression: canonical league creation review snapshot + visibility/monetization resolvers.
 * Pure logic — no DB, no OpenAI, no full app render.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildCreateLeagueReviewSnapshot } from '@/lib/create-league-v2/reviewCanonicalSnapshot'
import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import {
  DEFAULT_V2_STATE,
  getDefaultDynastySetup,
  getDefaultKeeperSetup,
  getDefaultBestBallSetup,
} from '@/lib/create-league-v2/state'
import * as createLeagueSubmit from '@/lib/create-league-v2/submit'
import {
  mergeVisibilityMonetizationIntoSettingsSnapshot,
  resolveCanonicalLeagueMonetization,
  resolveCanonicalLeagueVisibility,
  resolveHomepagePaymentEnabled,
} from '@/lib/league-creation/canonical/createLeagueVisibilityMonetization'

const actualBuildCanonicalCreatePayload = createLeagueSubmit.buildCanonicalCreatePayload

function completeRedraftState(overrides: Partial<CreateLeagueV2State> = {}): CreateLeagueV2State {
  return {
    ...DEFAULT_V2_STATE,
    leagueType: 'redraft',
    sport: 'NFL',
    scoringPresetId: 'fb_half_ppr_one_qb',
    draftType: 'snake',
    teamCount: 12,
    name: 'Contract Test Redraft',
    nameTouched: true,
    description: 'Public discovery blurb for tests.',
    keeper: getDefaultKeeperSetup(),
    bestBall: getDefaultBestBallSetup('NFL', 'standard', 'snake'),
    dynasty: {
      ...getDefaultDynastySetup('NFL', 'snake'),
      draftMode: 'offline',
    },
    ...overrides,
  }
}

function completeBestBallState(overrides: Partial<CreateLeagueV2State> = {}): CreateLeagueV2State {
  return {
    ...DEFAULT_V2_STATE,
    leagueType: 'best_ball',
    sport: 'NFL',
    scoringPresetId: 'fb_half_ppr_one_qb',
    draftType: 'snake',
    teamCount: 12,
    name: 'Contract Test Best Ball',
    nameTouched: true,
    description: 'Best ball contract test.',
    keeper: getDefaultKeeperSetup(),
    bestBall: getDefaultBestBallSetup('NFL', 'standard', 'snake'),
    dynasty: {
      ...getDefaultDynastySetup('NFL', 'snake'),
      draftMode: 'offline',
    },
    ...overrides,
  }
}

function completeDynastyState(overrides: Partial<CreateLeagueV2State> = {}): CreateLeagueV2State {
  return {
    ...DEFAULT_V2_STATE,
    leagueType: 'dynasty',
    sport: 'NFL',
    scoringPresetId: 'fb_half_ppr_one_qb',
    draftType: 'snake',
    teamCount: 12,
    name: 'Contract Test Dynasty',
    nameTouched: true,
    description: 'Dynasty contract test league.',
    keeper: getDefaultKeeperSetup(),
    bestBall: getDefaultBestBallSetup('NFL', 'standard', 'snake'),
    dynasty: {
      ...getDefaultDynastySetup('NFL', 'snake'),
      draftMode: 'offline',
      visibility: 'private',
      monetization: 'free',
      entryFeeDollars: 0,
      payoutType: 'not_configured',
      commissionerPayoutResponsible: true,
    },
    ...overrides,
  }
}

describe('resolveCanonicalLeagueVisibility / monetization / homepage payment', () => {
  it('public non–best-ball: mode public, finder on, extended public', () => {
    const v = resolveCanonicalLeagueVisibility({
      formatId: 'redraft',
      conceptSetup: { visibility: 'public', isPublic: true },
      bestBallVisibility: null,
    })
    expect(v.mode).toBe('public')
    expect(v.finderListingActive).toBe(true)
    expect(v.extendedSettingsPublic).toBe(true)
  })

  it('private: finder off, extended off', () => {
    const v = resolveCanonicalLeagueVisibility({
      formatId: 'dynasty',
      conceptSetup: { visibility: 'private' },
      bestBallVisibility: null,
    })
    expect(v.mode).toBe('private')
    expect(v.finderListingActive).toBe(false)
    expect(v.extendedSettingsPublic).toBe(false)
  })

  it('invite-only: finder off; homepage payment false even when paid + priced + payout', () => {
    const v = resolveCanonicalLeagueVisibility({
      formatId: 'redraft',
      conceptSetup: { visibility: 'invite_only' },
      bestBallVisibility: null,
    })
    expect(v.mode).toBe('invite_only')
    expect(v.finderListingActive).toBe(false)
    expect(v.extendedSettingsPublic).toBe(false)

    const m = resolveCanonicalLeagueMonetization({
      conceptSetup: {
        monetization: 'paid',
        entryFeeCents: 5000,
        payoutType: 'commissioner_managed',
        commissionerPayoutResponsible: true,
      },
    })
    expect(resolveHomepagePaymentEnabled(v, m)).toBe(false)
  })

  it('visibility string wins over isPublic when both set (private wins)', () => {
    const v = resolveCanonicalLeagueVisibility({
      formatId: 'dynasty',
      conceptSetup: { visibility: 'private', isPublic: true },
      bestBallVisibility: null,
    })
    expect(v.mode).toBe('private')
    expect(v.finderListingActive).toBe(false)
  })

  it('free league monetization: no dues row, homepage payment false', () => {
    const m = resolveCanonicalLeagueMonetization({
      conceptSetup: { monetization: 'free', entryFeeCents: 0, payoutType: 'not_configured' },
    })
    expect(m.isPaidLeague).toBe(false)
    expect(m.createCommissionerDuesRow).toBe(false)
    const v = resolveCanonicalLeagueVisibility({
      formatId: 'redraft',
      conceptSetup: { visibility: 'public' },
      bestBallVisibility: null,
    })
    expect(resolveHomepagePaymentEnabled(v, m)).toBe(false)
  })

  it('paid + zero entry: homepage payment false', () => {
    const m = resolveCanonicalLeagueMonetization({
      conceptSetup: {
        monetization: 'paid',
        entryFeeCents: 0,
        payoutType: 'commissioner_managed',
      },
    })
    const v = resolveCanonicalLeagueVisibility({
      formatId: 'dynasty',
      conceptSetup: { visibility: 'public' },
      bestBallVisibility: null,
    })
    expect(m.isPaidLeague).toBe(true)
    expect(resolveHomepagePaymentEnabled(v, m)).toBe(false)
  })

  it('best_ball: bestBallVisibility public wins over private conceptSetup.visibility', () => {
    const v = resolveCanonicalLeagueVisibility({
      formatId: 'best_ball',
      conceptSetup: { visibility: 'private', bestBall: { visibility: 'private' } },
      bestBallVisibility: 'public',
    })
    expect(v.mode).toBe('public')
    expect(v.finderListingActive).toBe(true)
  })

  it('best_ball: private when bestBallVisibility and nested visibility are private', () => {
    const v = resolveCanonicalLeagueVisibility({
      formatId: 'best_ball',
      conceptSetup: { bestBall: { visibility: 'private' } },
      bestBallVisibility: 'private',
    })
    expect(v.mode).toBe('private')
    expect(v.finderListingActive).toBe(false)
  })

  it('mergeVisibilityMonetizationIntoSettingsSnapshot adds canonical_* keys', () => {
    const vis = resolveCanonicalLeagueVisibility({
      formatId: 'redraft',
      conceptSetup: { visibility: 'public' },
      bestBallVisibility: null,
    })
    const mon = resolveCanonicalLeagueMonetization({
      conceptSetup: { monetization: 'paid', entryFeeCents: 100, payoutType: 'commissioner_managed' },
    })
    const merged = mergeVisibilityMonetizationIntoSettingsSnapshot({ seed: true }, vis, mon)
    expect(merged.seed).toBe(true)
    expect(merged.canonical_visibility).toBe('public')
    expect(merged.canonical_finder_listing_active).toBe(true)
    expect(merged.canonical_extended_public).toBe(true)
    expect(merged.canonical_homepage_payment_enabled).toBe(true)
    expect((merged as { canonical_monetization: { paymentEnabled: boolean } }).canonical_monetization.paymentEnabled).toBe(
      true,
    )
  })
})

describe('buildCreateLeagueReviewSnapshot (canonical path, no payload mock)', () => {
  it('public redraft: snapshot matches public discovery + extended public', () => {
    const snap = buildCreateLeagueReviewSnapshot(
      completeRedraftState({ standardDiscoveryVisibility: 'public', description: 'Listed league' }),
    )
    expect(snap.usesCanonicalCreateApi).toBe(true)
    expect(snap.engineOk).toBe(true)
    expect(snap.finderVisibility).toBe('public')
    expect(snap.finderListingWillBeActive).toBe(true)
    expect(snap.extendedProfilePublicFlag).toBe(true)
    const pub = snap.confirmations.some(
      (c) => c.label.includes('Find League') && c.label.toLowerCase().includes('publish'),
    )
    expect(pub).toBe(true)
  })

  it('private redraft: listing inactive, extended off', () => {
    const snap = buildCreateLeagueReviewSnapshot(
      completeRedraftState({ standardDiscoveryVisibility: 'private' }),
    )
    expect(snap.engineOk).toBe(true)
    expect(snap.finderVisibility).toBe('private')
    expect(snap.finderListingWillBeActive).toBe(false)
    expect(snap.extendedProfilePublicFlag).toBe(false)
  })

  it('invite-only redraft: listing inactive, payment off', () => {
    const snap = buildCreateLeagueReviewSnapshot(
      completeRedraftState({ standardDiscoveryVisibility: 'invite_only' }),
    )
    expect(snap.engineOk).toBe(true)
    expect(snap.finderVisibility).toBe('invite_only')
    expect(snap.finderListingWillBeActive).toBe(false)
    expect(snap.paymentEnabledPersisted).toBe(false)
    expect(snap.warnings.some((w) => w.code === 'invite_only_discovery')).toBe(true)
  })

  it('paid dynasty with valid entry + payout: persisted economy + paymentEnabled when not invite-only', () => {
    const snap = buildCreateLeagueReviewSnapshot(
      completeDynastyState({
        dynasty: {
          ...getDefaultDynastySetup('NFL', 'snake'),
          draftMode: 'offline',
          visibility: 'public',
          monetization: 'paid',
          entryFeeDollars: 75,
          payoutType: 'commissioner_managed',
          commissionerPayoutResponsible: false,
        },
      }),
    )
    expect(snap.engineOk).toBe(true)
    expect(snap.persistedEntryFeeCents).toBe(7500)
    expect(snap.persistedPayoutType).toBe('commissioner_managed')
    expect(snap.commissionerPayoutResponsiblePersisted).toBe(false)
    expect(snap.monetizationFromPayload).toBe('paid')
    expect(snap.paymentEnabledPersisted).toBe(true)
    expect(snap.commissionerDuesWillBeCreated).toBe(true)
    expect(snap.leagueFinanceSummary).toContain('isPaidLeague=true')
    expect(snap.leagueFinanceSummary).toContain('entryFeeCents=7500')
  })

  it('free dynasty: no commissioner dues, payment off, monetization free', () => {
    const snap = buildCreateLeagueReviewSnapshot(completeDynastyState())
    expect(snap.engineOk).toBe(true)
    expect(snap.monetizationFromPayload).toBe('free')
    expect(snap.commissionerDuesWillBeCreated).toBe(false)
    expect(snap.paymentEnabledPersisted).toBe(false)
    expect(snap.leagueFinanceSummary).toContain('isPaidLeague=false')
  })

  it('best_ball public: discovery + extended public on snapshot', () => {
    const snap = buildCreateLeagueReviewSnapshot(
      completeBestBallState({
        bestBall: {
          ...getDefaultBestBallSetup('NFL', 'standard', 'snake'),
          visibility: 'public',
          monetization: 'free',
        },
      }),
    )
    expect(snap.engineOk).toBe(true)
    expect(snap.formatId).toBe('best_ball')
    expect(snap.finderVisibility).toBe('public')
    expect(snap.finderListingWillBeActive).toBe(true)
    expect(snap.extendedProfilePublicFlag).toBe(true)
  })

  it('best_ball private: snapshot stays private / listing off', () => {
    const snap = buildCreateLeagueReviewSnapshot(
      completeBestBallState({
        bestBall: {
          ...getDefaultBestBallSetup('NFL', 'standard', 'snake'),
          visibility: 'private',
        },
      }),
    )
    expect(snap.engineOk).toBe(true)
    expect(snap.finderVisibility).toBe('private')
    expect(snap.finderListingWillBeActive).toBe(false)
    expect(snap.extendedProfilePublicFlag).toBe(false)
  })

  it('best_ball paid + entry + payout + public: paymentEnabled true', () => {
    const snap = buildCreateLeagueReviewSnapshot(
      completeBestBallState({
        bestBall: {
          ...getDefaultBestBallSetup('NFL', 'standard', 'snake'),
          visibility: 'public',
          monetization: 'paid',
          entryFeeCents: 50000,
          payoutType: 'commissioner_managed',
          commissionerPayoutResponsible: true,
        },
      }),
    )
    expect(snap.engineOk).toBe(true)
    expect(snap.monetizationFromPayload).toBe('paid')
    expect(snap.persistedEntryFeeCents).toBe(50000)
    expect(snap.paymentEnabledPersisted).toBe(true)
    expect(snap.commissionerDuesWillBeCreated).toBe(true)
  })
})

describe('buildCreateLeagueReviewSnapshot (payload overrides via spy)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('visibility_flags_conflict warning when isPublic true and visibility private on wire', () => {
    vi.spyOn(createLeagueSubmit, 'buildCanonicalCreatePayload').mockImplementation((state) => {
      const base = actualBuildCanonicalCreatePayload(state) as Record<string, unknown>
      const prev = base.conceptSetup && typeof base.conceptSetup === 'object' && !Array.isArray(base.conceptSetup)
        ? (base.conceptSetup as Record<string, unknown>)
        : {}
      return {
        ...base,
        conceptSetup: { ...prev, isPublic: true, visibility: 'private' },
      }
    })

    const snap = buildCreateLeagueReviewSnapshot(
      completeRedraftState({ standardDiscoveryVisibility: 'public' }),
    )
    expect(snap.warnings.some((w) => w.code === 'visibility_flags_conflict')).toBe(true)
    expect(snap.finderVisibility).toBe('private')
    expect(snap.finderListingWillBeActive).toBe(false)
  })

  it('paid league missing entry: paid_no_entry warning + paymentEnabled false (payload richer than free state)', () => {
    vi.spyOn(createLeagueSubmit, 'buildCanonicalCreatePayload').mockImplementation((state) => {
      const base = actualBuildCanonicalCreatePayload(state) as Record<string, unknown>
      const prev = base.conceptSetup && typeof base.conceptSetup === 'object' && !Array.isArray(base.conceptSetup)
        ? (base.conceptSetup as Record<string, unknown>)
        : {}
      return {
        ...base,
        conceptSetup: {
          ...prev,
          monetization: 'paid',
          entryFeeCents: 0,
          payoutType: 'commissioner_managed',
        },
      }
    })

    const snap = buildCreateLeagueReviewSnapshot(completeDynastyState())
    expect(snap.warnings.some((w) => w.code === 'paid_no_entry')).toBe(true)
    expect(snap.paymentEnabledPersisted).toBe(false)
    expect(snap.commissionerDuesWillBeCreated).toBe(false)
  })

  it('paid_unsupported_format when paid monetization appears on non–paid format wire', () => {
    vi.spyOn(createLeagueSubmit, 'buildCanonicalCreatePayload').mockImplementation((state) => {
      const base = actualBuildCanonicalCreatePayload(state) as Record<string, unknown>
      const prev = base.conceptSetup && typeof base.conceptSetup === 'object' && !Array.isArray(base.conceptSetup)
        ? (base.conceptSetup as Record<string, unknown>)
        : {}
      return {
        ...base,
        conceptSetup: {
          ...prev,
          monetization: 'paid',
          entryFeeCents: 2500,
          payoutType: 'commissioner_managed',
        },
      }
    })

    const snap = buildCreateLeagueReviewSnapshot(completeRedraftState())
    expect(snap.engineOk).toBe(true)
    expect(snap.warnings.some((w) => w.code === 'paid_unsupported_format')).toBe(true)
  })
})
