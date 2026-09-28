/**
 * `tradeRecord.ts` — three trade sources, one normalized trade (design build-order step 2). PURE, so
 * every status word and asset shape each source writes is pinned here.
 */
import { describe, expect, it } from 'vitest'

import {
  afItemAsset,
  afTradeStatus,
  providerAsset,
  providerTradeStatus,
  redraftAsset,
  redraftTradeStatus,
  twoSides,
  viewerIsParty,
} from '@/lib/decision-os/trade/tradeRecord'

const NOW = new Date('2026-09-27T12:00:00Z')
const PAST = '2026-09-26T12:00:00Z'
const FUTURE = '2026-09-28T12:00:00Z'

describe('status: every word each source writes', () => {
  it.each([
    ['pending', FUTURE, 'proposed'],
    ['awaiting_votes', null, 'proposed'],
    ['awaiting_commissioner', null, 'proposed'],
    ['scheduled', null, 'accepted'],
    ['accepted', null, 'accepted'],
    ['processed', null, 'completed'],
    ['rejected', null, 'rejected'],
    ['cancelled', null, 'rejected'],
    ['countered', null, 'rejected'],
    ['reversed', null, 'rejected'],
    ['vetoed', null, 'vetoed'],
    ['something_new', null, 'unknown'],
  ] as const)('AfLeagueTrade %s → %s', (raw, expires, want) => {
    expect(afTradeStatus(raw, expires, NOW)).toBe(want)
  })

  it('AfLeagueTrade never WRITES expired: a pending row past its expiresAt is expired', () => {
    expect(afTradeStatus('pending', PAST, NOW)).toBe('expired')
    expect(afTradeStatus('awaiting_votes', PAST, NOW)).toBe('expired')
  })

  it.each([
    ['pending', FUTURE, 'proposed'],
    ['pending', PAST, 'expired'],
    ['accepted', null, 'completed'], // accepted sets processedAt: it executed
    ['rejected', null, 'rejected'],
    ['cancelled', null, 'rejected'],
    ['vetoed', null, 'vetoed'],
    ['expired', null, 'expired'],
  ] as const)('RedraftTradeProposal %s → %s', (raw, expires, want) => {
    expect(redraftTradeStatus(raw, expires, NOW)).toBe(want)
  })

  it.each([
    ['pending', 'proposed'],
    ['accepted', 'completed'], // Sleeper `complete`
    ['rejected', 'rejected'],
    ['vanished', 'rejected'],
    ['expired', 'expired'],
    ['unknown', 'unknown'], // stored as unknown; never guessed into a real status
  ] as const)('ProviderTradeOffer %s → %s', (raw, want) => {
    expect(providerTradeStatus(raw)).toBe(want)
  })
})

describe('assets', () => {
  it('AfLeagueTradeItem: player by reference, fdp pick parsed, FAAB from either field', () => {
    expect(afItemAsset({ itemType: 'player', itemReference: '4984', faabAmount: null, metadata: null })).toEqual({ kind: 'player', playerId: '4984' })
    expect(afItemAsset({ itemType: 'future_pick', itemReference: 'fdp:2027:1:roster-9', faabAmount: null, metadata: {} })).toEqual({
      kind: 'pick', season: 2027, round: 1, originalTeamId: 'roster-9', label: '2027 1st',
    })
    expect(afItemAsset({ itemType: 'rookie_pick', itemReference: 'opaque', faabAmount: null, metadata: { pickSeason: 2027, pickRound: 2, originalRosterId: 'r3' } })).toMatchObject({ season: 2027, round: 2, originalTeamId: 'r3' })
    expect(afItemAsset({ itemType: 'faab', itemReference: null, faabAmount: null, metadata: { amount: 25 } })).toEqual({ kind: 'faab', amount: 25 })
  })

  it('an asset that cannot be priced comes back NAMED, never dropped', () => {
    expect(afItemAsset({ itemType: 'rookie_pick', itemReference: 'opaque-id', faabAmount: null, metadata: {} })).toMatch(/no season or round/)
    expect(afItemAsset({ itemType: 'specialty_asset', itemReference: 'x', faabAmount: null, metadata: {} })).toMatch(/not a priceable asset/)
    expect(redraftAsset({ assetType: 'future_consideration', playerId: null, playerName: null, pickSeason: null, pickRound: null, metadata: {} })).toMatch(/not a priceable asset/)
  })

  it('RedraftTradeAsset and ProviderTradeOfferAsset', () => {
    expect(redraftAsset({ assetType: 'draft_pick', playerId: null, playerName: null, pickSeason: 2027, pickRound: 3, metadata: {} })).toMatchObject({ kind: 'pick', season: 2027, round: 3 })
    expect(redraftAsset({ assetType: 'faab', playerId: null, playerName: null, pickSeason: null, pickRound: null, metadata: { faab: 10 } })).toEqual({ kind: 'faab', amount: 10 })
    // A Sleeper pick's `pickOriginalRosterId` is its ORIGINAL owner.
    expect(providerAsset({ assetType: 'pick', playerId: null, pickSeason: 2027, pickRound: 1, pickOriginalRosterId: '4', faabAmount: null })).toMatchObject({ originalTeamId: '4' })
  })
})

describe('twoSides', () => {
  const p = (id: string) => ({ kind: 'player' as const, playerId: id })

  it('folds movements into the two sides, proposer first', () => {
    const r = twoSides([
      { fromTeamId: 'r2', toTeamId: 'r1', asset: p('b') },
      { fromTeamId: 'r1', toTeamId: 'r2', asset: p('a') },
    ], { sideAId: 'r1', sideBId: 'r2' })
    expect(r).toEqual({ ok: true, trade: { sideA: { teamId: 'r1', gives: [p('a')] }, sideB: { teamId: 'r2', gives: [p('b')] } } })
  })

  it('refuses a third team — declared or on any movement', () => {
    const r = twoSides([
      { fromTeamId: 'r1', toTeamId: 'r2', asset: p('a') },
      { fromTeamId: 'r2', toTeamId: 'r3', asset: p('b') },
    ])
    expect(r).toMatchObject({ ok: false, refusal: { code: 'multi_team', reason: expect.stringContaining('3-team') } })
    expect(twoSides([{ fromTeamId: 'r1', toTeamId: 'r2', asset: p('a') }], { declaredTeamIds: ['r1', 'r2', 'r9'] })).toMatchObject({ ok: false, refusal: { code: 'multi_team' } })
  })

  it('refuses an unreadable asset by name, and a side that sends nothing', () => {
    expect(twoSides([{ fromTeamId: 'r1', toTeamId: 'r2', asset: 'a draft pick (no season or round on record)' }, { fromTeamId: 'r2', toTeamId: 'r1', asset: p('b') }]))
      .toMatchObject({ ok: false, refusal: { code: 'unreadable_asset', missingAssets: ['a draft pick (no season or round on record)'] } })
    expect(twoSides([{ fromTeamId: 'r1', toTeamId: 'r2', asset: p('a') }], { sideAId: 'r1', sideBId: 'r2' }))
      .toMatchObject({ ok: false, refusal: { code: 'no_assets' } })
  })
})

describe('viewerIsParty', () => {
  const viewer = { rosterId: 'roster-1', redraftRosterId: 'rr-1', externalTeamIds: ['03', '3'] }

  it('matches in each source’s own id space', () => {
    expect(viewerIsParty('af', viewer, ['roster-1', 'roster-2'])).toBe(true)
    expect(viewerIsParty('redraft', viewer, ['rr-1'])).toBe(true)
    expect(viewerIsParty('af', viewer, ['rr-1'])).toBe(false) // a redraft id is not a Roster id
  })

  it('compares Sleeper roster ids through their zero padding', () => {
    expect(viewerIsParty('provider', { ...viewer, externalTeamIds: ['03'] }, ['3', '7'])).toBe(true)
    expect(viewerIsParty('provider', viewer, ['7', '8'])).toBe(false)
  })
})
