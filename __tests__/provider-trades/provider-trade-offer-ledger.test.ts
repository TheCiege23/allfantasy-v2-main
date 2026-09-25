/**
 * The provider trade-offer ledger writer.
 *
 * ── WHAT THESE ASSERTIONS ARE FOR ─────────────────────────────────────────────────────────────
 *
 * Every mistake available here is silent. A player counted twice makes a two-player swap read as
 * a four-asset deal. A pick that loses its ORIGINAL owner is unvaluable but looks complete. And
 * `vanished` written without proof is a claim about the world that nobody observed — the ledger
 * would say an offer went away on the strength of a sweep that failed to read the feed.
 *
 * So the vanish rules are asserted in BOTH directions: refusing without proof is only meaningful
 * if it is shown retiring offers WITH proof.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    providerTradeOffer: { upsert: h.upsert, updateMany: h.updateMany },
    providerTradeOfferAsset: { deleteMany: h.deleteMany, createMany: h.createMany },
  },
}))

import {
  mapSleeperStatus,
  normalizeSleeperTradeOffer,
  persistProviderTradeOffers,
  type NormalizedOffer,
} from '@/lib/provider-trades/providerTradeOfferLedger'

beforeEach(() => {
  vi.clearAllMocks()
  h.upsert.mockResolvedValue({ id: 'offer-1' })
  h.deleteMany.mockResolvedValue({ count: 0 })
  h.createMany.mockResolvedValue({ count: 0 })
  h.updateMany.mockResolvedValue({ count: 0 })
})

describe('normalizeSleeperTradeOffer', () => {
  /**
   * 🛑 Sleeper records ONE movement from both ends: `adds` maps the player to the roster receiving
   * him, `drops` to the roster giving him up. A row per side doubles every player in the ledger.
   */
  it('emits one asset per player, carrying both ends of the movement', () => {
    const offer = normalizeSleeperTradeOffer(
      {
        transaction_id: 't1',
        type: 'trade',
        status: 'pending',
        roster_ids: [1, 2],
        adds: { '4034': 1, '1234': 2 },
        drops: { '4034': 2, '1234': 1 },
      },
      { week: 5 },
    )
    const players = offer!.assets.filter((a) => a.assetType === 'player')
    expect(players).toHaveLength(2)
    expect(players.find((p) => p.playerId === '4034')).toMatchObject({
      fromRosterId: '2',
      toRosterId: '1',
    })
    expect(players.find((p) => p.playerId === '1234')).toMatchObject({
      fromRosterId: '1',
      toRosterId: '2',
    })
  })

  /**
   * 🛑 THE THREE PICK ROSTER FIELDS ARE THREE DIFFERENT THINGS AND WERE TRANSPOSED HERE ONCE.
   * Sleeper: `roster_id` is whose season the pick tracks (the original owner — the only field that
   * makes it valuable or not), `owner_id` the roster RECEIVING it, `previous_owner_id` the giver.
   * This test used to assert the opposite and so locked in a ledger that sent every traded pick to
   * its original owner (2026-09-25). `SleeperTradedPicksMapper.ts` documents the same shape.
   */
  it('keeps a pick original owner apart from its giver and receiver', () => {
    const offer = normalizeSleeperTradeOffer(
      {
        transaction_id: 't2',
        type: 'trade',
        status: 'pending',
        roster_ids: [1, 2],
        draft_picks: [{ season: '2027', round: 1, roster_id: 7, previous_owner_id: 1, owner_id: 2 }],
      },
      { week: null },
    )
    expect(offer!.assets).toEqual([
      expect.objectContaining({
        assetType: 'pick',
        pickSeason: 2027,
        pickRound: 1,
        pickOriginalRosterId: '7',
        fromRosterId: '1',
        toRosterId: '2',
      }),
    ])
  })

  it('carries FAAB from sender to receiver and drops non-positive transfers', () => {
    const offer = normalizeSleeperTradeOffer(
      {
        transaction_id: 't3',
        type: 'trade',
        status: 'pending',
        roster_ids: [1, 2],
        waiver_budget: [
          { sender: 1, receiver: 2, amount: 40 },
          { sender: 2, receiver: 1, amount: 0 },
        ],
      },
      { week: null },
    )
    const faab = offer!.assets.filter((a) => a.assetType === 'faab')
    expect(faab).toEqual([
      expect.objectContaining({ faabAmount: 40, fromRosterId: '1', toRosterId: '2' }),
    ])
  })

  /** ⚠ A roster that only moved FAAB still participated — a row with no participant is unusable. */
  it('counts a FAAB-only participant among the rosters involved', () => {
    const offer = normalizeSleeperTradeOffer(
      {
        transaction_id: 't4',
        type: 'trade',
        status: 'pending',
        roster_ids: [1, 2],
        adds: { '99': 1 },
        drops: { '99': 2 },
        waiver_budget: [{ sender: 3, receiver: 1, amount: 15 }],
      },
      { week: null },
    )
    expect(new Set(offer!.rosterIds)).toEqual(new Set(['1', '2', '3']))
  })

  it('expresses a three-team trade without a side table', () => {
    const offer = normalizeSleeperTradeOffer(
      {
        transaction_id: 't5',
        type: 'trade',
        status: 'pending',
        roster_ids: [1, 2, 3],
        adds: { a: 1, b: 2, c: 3 },
        drops: { a: 2, b: 3, c: 1 },
      },
      { week: null },
    )
    expect(offer!.rosterIds).toHaveLength(3)
    expect(offer!.assets).toHaveLength(3)
  })

  it('ignores a transaction that is not a trade, and one with no id', () => {
    expect(normalizeSleeperTradeOffer({ transaction_id: 'w1', type: 'waiver' }, { week: 1 })).toBeNull()
    expect(normalizeSleeperTradeOffer({ type: 'trade', status: 'pending' }, { week: 1 })).toBeNull()
  })

  /**
   * 🛑 AN UNRECOGNISED STATUS IS `unknown`, NEVER `pending`. Calling a new terminal state pending
   * would park a dead offer in a manager's "Needs you" queue permanently.
   */
  it('maps Sleeper statuses and refuses to guess at a new one', () => {
    expect(mapSleeperStatus('complete')).toBe('accepted')
    expect(mapSleeperStatus('pending')).toBe('pending')
    expect(mapSleeperStatus('failed')).toBe('rejected')
    expect(mapSleeperStatus('some_new_word')).toBe('unknown')
    expect(mapSleeperStatus(null)).toBe('unknown')
  })

  it('keeps the provider word verbatim beside the mapped status', () => {
    const offer = normalizeSleeperTradeOffer(
      { transaction_id: 't6', type: 'trade', status: 'some_new_word', roster_ids: [1] },
      { week: null },
    )
    expect(offer).toMatchObject({ status: 'unknown', providerStatus: 'some_new_word' })
  })

  /** `creator` is a Sleeper USER id; writing it into a roster column would never join. */
  it('does not put a user id into the proposing-roster column', () => {
    const offer = normalizeSleeperTradeOffer(
      { transaction_id: 't7', type: 'trade', status: 'pending', roster_ids: [1], creator: 'u_abc' },
      { week: null },
    )
    expect(offer!.proposedByRosterId).toBeNull()
  })
})

describe('persistProviderTradeOffers', () => {
  const offer = (id: string): NormalizedOffer => ({
    provider: 'sleeper',
    providerTradeId: id,
    status: 'pending',
    providerStatus: 'pending',
    proposedByRosterId: null,
    rosterIds: ['1', '2'],
    consentedRosterIds: ['1'],
    proposedAt: new Date('2026-09-10T00:00:00Z'),
    weekOrPeriod: 2,
    assets: [
      {
        assetType: 'player',
        playerId: '4034',
        pickSeason: null,
        pickRound: null,
        pickOriginalRosterId: null,
        faabAmount: null,
        fromRosterId: '2',
        toRosterId: '1',
      },
    ],
  })

  const base = { leagueId: 'lg1', sport: 'NFL', season: 2026, provider: 'sleeper' }

  /**
   * 🛑 THE PROOF OBLIGATION. `vanished` is an inference from ABSENCE, and absence has two causes
   * that look identical from here: the offer is gone, or the sweep failed to read the feed.
   */
  it('marks nothing vanished when the sweep cannot prove it read the feed', async () => {
    const r = await persistProviderTradeOffers({ ...base, offers: [offer('t1')], feedComplete: false })
    expect(r.vanishSkipped).toBe(true)
    expect(r.vanished).toBe(0)
    expect(h.updateMany).not.toHaveBeenCalled()
  })

  /** The positive control: refusing without proof only means something if it acts WITH proof. */
  it('retires offers that are gone when the feed was read in full', async () => {
    h.updateMany.mockResolvedValue({ count: 3 })
    const r = await persistProviderTradeOffers({ ...base, offers: [offer('t1')], feedComplete: true })
    expect(r.vanishSkipped).toBe(false)
    expect(r.vanished).toBe(3)
    const where = h.updateMany.mock.calls[0][0].where
    expect(where.status).toBe('pending')
    expect(where.providerTradeId).toEqual({ notIn: ['t1'] })
  })

  /**
   * 🛑 AN EMPTY FEED IS A REAL STATE, AND `notIn: []` MATCHES NOTHING. Spelling it the obvious way
   * would retire nobody in exactly the case the sweep exists to catch — a league whose every
   * pending offer has been answered.
   */
  it('retires every pending offer when a fully-read feed contains none', async () => {
    h.updateMany.mockResolvedValue({ count: 2 })
    const r = await persistProviderTradeOffers({ ...base, offers: [], feedComplete: true })
    expect(r.vanished).toBe(2)
    expect(h.updateMany.mock.calls[0][0].where.providerTradeId).toBeUndefined()
  })

  /** ⚠ A terminal state is something we SAW. It does not stop being true when the feed ages out. */
  it('only ever retires pending rows', async () => {
    await persistProviderTradeOffers({ ...base, offers: [offer('t1')], feedComplete: true })
    expect(h.updateMany.mock.calls[0][0].where.status).toBe('pending')
  })

  /** ⚠ Retiring must not advance `lastSeenAt` — that is the evidence the offer was NOT seen. */
  it('does not advance last-seen on an offer it is retiring', async () => {
    await persistProviderTradeOffers({ ...base, offers: [], feedComplete: true })
    expect(h.updateMany.mock.calls[0][0].data).toEqual({ status: 'vanished' })
  })

  /**
   * ⚠ `firstSeenAt` IS HOW LONG AN OFFER HAS BEEN OUTSTANDING. Re-stamping it each sweep would
   * reset every offer's age on a cadence and make all of them permanently read as new.
   */
  it('sets first-seen only on create, and advances last-seen on both paths', async () => {
    const seenAt = new Date('2026-09-15T12:00:00Z')
    await persistProviderTradeOffers({ ...base, offers: [offer('t1')], feedComplete: true, seenAt })
    const call = h.upsert.mock.calls[0][0]
    expect(call.create.firstSeenAt).toEqual(seenAt)
    expect(call.create.lastSeenAt).toEqual(seenAt)
    expect(call.update.lastSeenAt).toEqual(seenAt)
    expect(call.update).not.toHaveProperty('firstSeenAt')
  })

  it('keys the upsert on provider + league + provider trade id', async () => {
    await persistProviderTradeOffers({ ...base, offers: [offer('t1')], feedComplete: true })
    expect(h.upsert.mock.calls[0][0].where).toEqual({
      uniq_provider_trade_offer: { provider: 'sleeper', leagueId: 'lg1', providerTradeId: 't1' },
    })
  })

  /** ⚠ Replace, not merge — otherwise rows from an old parse sit beside rows from a new one. */
  it('replaces an offer assets rather than accumulating them', async () => {
    await persistProviderTradeOffers({ ...base, offers: [offer('t1')], feedComplete: true })
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { offerId: 'offer-1' } })
    expect(h.createMany.mock.calls[0][0].data).toHaveLength(1)
    expect(h.createMany.mock.calls[0][0].data[0]).toMatchObject({ offerId: 'offer-1', playerId: '4034' })
  })

  it('writes no asset rows for an offer that has none', async () => {
    const empty = { ...offer('t9'), assets: [] }
    await persistProviderTradeOffers({ ...base, offers: [empty], feedComplete: true })
    expect(h.deleteMany).toHaveBeenCalled()
    expect(h.createMany).not.toHaveBeenCalled()
  })
})
