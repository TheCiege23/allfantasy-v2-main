/**
 * The DB-first read layer over the provider trade-offer ledger.
 *
 * The assertions that matter here are the ones about what the view must NOT claim: that a
 * timestamp we observed is a timestamp the provider stated, that an offer which merely stopped
 * appearing "expired", or that an empty league has no offers when it may never have been swept.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { providerTradeOffer: { findMany: h.findMany, findFirst: h.findFirst } },
}))

import {
  bucketFor,
  getLeagueTradeLedgerForRoster,
  goneReasonFor,
} from '@/lib/provider-trades/providerTradeOfferReads'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  providerTradeId: 't1',
  provider: 'sleeper',
  status: 'pending',
  rosterIds: ['1', '2'],
  consentedRosterIds: ['2'],
  proposedAt: new Date('2026-09-10T00:00:00Z'),
  firstSeenAt: new Date('2026-09-12T00:00:00Z'),
  expiresAt: null,
  assets: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([])
  h.findFirst.mockResolvedValue(null)
})

describe('bucketFor — consent decides, not authorship', () => {
  /**
   * 🛑 Sleeper's `creator` is a USER id, so `proposedByRosterId` is null on every Sleeper row and
   * an "I sent it / they sent it" split is not buildable. Consent is the better signal regardless:
   * in a three-team trade "sender" is not well defined, but "has this roster agreed" is.
   */
  it('puts a pending offer this roster has not agreed to in needsYou', () => {
    expect(bucketFor('pending', false)).toBe('needsYou')
  })

  it('moves it out of needsYou once this roster has agreed', () => {
    expect(bucketFor('pending', true)).toBe('awaitingOthers')
  })

  it('files settled states without an action', () => {
    expect(bucketFor('accepted', false)).toBe('completed')
    expect(bucketFor('rejected', false)).toBe('declined')
    expect(bucketFor('expired', false)).toBe('gone')
    expect(bucketFor('vanished', false)).toBe('gone')
  })

  /**
   * 🛑 An unrecognised status must not become an ACTION. Filing it under needsYou puts a phantom
   * decision in front of a manager; `gone` merely under-reports.
   */
  it('never turns an unknown status into something that needs the manager', () => {
    expect(bucketFor('unknown', false)).toBe('gone')
    expect(bucketFor('unknown', true)).toBe('gone')
  })
})

describe('goneReasonFor — the ledger does not state a cause nobody observed', () => {
  it('separates a stated expiry from an offer that merely stopped appearing', () => {
    expect(goneReasonFor('expired')).toBe('expired')
    expect(goneReasonFor('vanished')).toBe('withdrawnOrExpired')
  })

  it('attaches no reason to a settled offer', () => {
    expect(goneReasonFor('accepted')).toBeNull()
    expect(goneReasonFor('rejected')).toBeNull()
  })
})

describe('getLeagueTradeLedgerForRoster', () => {
  it('buckets by the viewing roster, so the same offer reads differently for each side', async () => {
    h.findMany.mockResolvedValue([row({ rosterIds: ['1', '2'], consentedRosterIds: ['2'] })])

    const forOne = await getLeagueTradeLedgerForRoster({ leagueId: 'lg1', rosterId: '1' })
    const forTwo = await getLeagueTradeLedgerForRoster({ leagueId: 'lg1', rosterId: '2' })

    expect(forOne.needsYou).toHaveLength(1)
    expect(forOne.awaitingOthers).toHaveLength(0)
    expect(forTwo.needsYou).toHaveLength(0)
    expect(forTwo.awaitingOthers).toHaveLength(1)
  })

  it('names who is still being waited on', async () => {
    h.findMany.mockResolvedValue([
      row({ rosterIds: ['1', '2', '3'], consentedRosterIds: ['2'] }),
    ])
    const view = await getLeagueTradeLedgerForRoster({ leagueId: 'lg1', rosterId: '1' })
    expect(view.needsYou[0].awaitingRosterIds).toEqual(['1', '3'])
  })

  /**
   * ⚠ Nobody is waiting on a declined trade. Rendering "awaiting Team B" beside one describes a
   * decision that has already happened.
   */
  it('reports nobody awaited once the offer is settled', async () => {
    h.findMany.mockResolvedValue([
      row({ status: 'rejected', rosterIds: ['1', '2', '3'], consentedRosterIds: ['2'] }),
    ])
    const view = await getLeagueTradeLedgerForRoster({ leagueId: 'lg1', rosterId: '1' })
    expect(view.declined[0].awaitingRosterIds).toEqual([])
  })

  /**
   * 🛑 THE TIMESTAMP HONESTY RULE. When the provider states when an offer was made, that is the
   * truth. When it does not, the earliest honest claim is when WE FIRST SAW IT — which can be days
   * late — so the source ships with the value and a surface says "first seen", not "sent".
   */
  it('marks a provider-stated time as provider-sourced', async () => {
    h.findMany.mockResolvedValue([row({ proposedAt: new Date('2026-09-10T00:00:00Z') })])
    const view = await getLeagueTradeLedgerForRoster({ leagueId: 'lg1', rosterId: '1' })
    expect(view.needsYou[0].atSource).toBe('provider')
    expect(view.needsYou[0].at).toEqual(new Date('2026-09-10T00:00:00Z'))
  })

  it('falls back to first-observed and SAYS it is first-observed', async () => {
    h.findMany.mockResolvedValue([
      row({ proposedAt: null, firstSeenAt: new Date('2026-09-12T00:00:00Z') }),
    ])
    const view = await getLeagueTradeLedgerForRoster({ leagueId: 'lg1', rosterId: '1' })
    expect(view.needsYou[0].atSource).toBe('firstObserved')
    expect(view.needsYou[0].at).toEqual(new Date('2026-09-12T00:00:00Z'))
  })

  /**
   * ⚠ A roster can be party to a trade it neither gives nor receives a player in — a pure FAAB leg,
   * or a three-team deal where its only movement is a pick. Filtering on assets drops exactly those.
   */
  it('selects on participation, not on the assets', async () => {
    await getLeagueTradeLedgerForRoster({ leagueId: 'lg1', rosterId: '9' })
    expect(h.findMany.mock.calls[0][0].where).toEqual({
      leagueId: 'lg1',
      rosterIds: { has: '9' },
    })
  })

  /**
   * 🛑 "NO OFFERS" AND "WE HAVE NOT LOOKED" RENDER IDENTICALLY AND MEAN OPPOSITE THINGS.
   */
  it('dates its own silence when the league has been swept', async () => {
    h.findMany.mockResolvedValue([])
    h.findFirst.mockResolvedValue({ lastSeenAt: new Date('2026-09-15T18:00:00Z') })
    const view = await getLeagueTradeLedgerForRoster({ leagueId: 'lg1', rosterId: '1' })
    expect(view.needsYou).toEqual([])
    expect(view.feedLastSeenAt).toEqual(new Date('2026-09-15T18:00:00Z'))
  })

  it('reports an unswept league as unknown rather than as empty', async () => {
    h.findMany.mockResolvedValue([])
    h.findFirst.mockResolvedValue(null)
    const view = await getLeagueTradeLedgerForRoster({ leagueId: 'lg1', rosterId: '1' })
    expect(view.feedLastSeenAt).toBeNull()
  })

  /**
   * ⚠ Taken across the LEAGUE, not the viewer's own rows — otherwise a manager with no trades is
   * told nothing is known about a league swept minutes ago.
   */
  it('reads feed freshness league-wide, not from the viewer offers', async () => {
    h.findMany.mockResolvedValue([])
    await getLeagueTradeLedgerForRoster({ leagueId: 'lg1', rosterId: '1' })
    expect(h.findFirst.mock.calls[0][0].where).toEqual({ leagueId: 'lg1' })
  })

  /** 🛑 Truncating needsYou would hide a decision the manager still has to make. */
  it('caps settled buckets but never the actionable one', async () => {
    const pending = Array.from({ length: 5 }, (_, i) =>
      row({ id: `p${i}`, providerTradeId: `p${i}`, status: 'pending', consentedRosterIds: [] }),
    )
    const done = Array.from({ length: 5 }, (_, i) =>
      row({ id: `d${i}`, providerTradeId: `d${i}`, status: 'accepted' }),
    )
    h.findMany.mockResolvedValue([...pending, ...done])

    const view = await getLeagueTradeLedgerForRoster({
      leagueId: 'lg1',
      rosterId: '1',
      settledLimit: 2,
    })
    expect(view.needsYou).toHaveLength(5)
    expect(view.completed).toHaveLength(2)
  })

  it('degrades to an empty view rather than throwing when the read fails', async () => {
    h.findMany.mockRejectedValue(new Error('P2021'))
    h.findFirst.mockRejectedValue(new Error('P2021'))
    const view = await getLeagueTradeLedgerForRoster({ leagueId: 'lg1', rosterId: '1' })
    expect(view.needsYou).toEqual([])
    expect(view.feedLastSeenAt).toBeNull()
  })
})
