/**
 * Ledger offers rendered into the trade timeline — item #7's actual gap.
 *
 * The UI already had the five buckets; "Declined & expired" was permanently empty for an imported
 * league because `historyTrades` is native-only and the live scan drops `failed` on the floor.
 * These assertions pin the two things that would quietly undo the fix: contributing PENDING rows
 * (which must stay live), and relabelling `vanished` as `expired` so it fits an existing list.
 */
import { describe, expect, it } from 'vitest'

import {
  buildProviderOfferHistoryRows,
  timelineStatusFor,
} from '@/lib/provider-trades/providerOfferHistoryRows'
import type { LedgerOffer } from '@/lib/provider-trades/providerTradeOfferReads'

const offer = (over: Partial<LedgerOffer> = {}): LedgerOffer => ({
  id: 'o1',
  providerTradeId: 't1',
  provider: 'sleeper',
  status: 'rejected',
  bucket: 'declined',
  goneReason: null,
  at: new Date('2026-09-10T00:00:00Z'),
  atSource: 'provider',
  rosterIds: ['1', '2'],
  consentedRosterIds: [],
  awaitingRosterIds: [],
  assets: [],
  ...over,
})

const names = new Map([['2', 'Team Two']])

describe('timelineStatusFor', () => {
  /**
   * 🛑 THE ONE-CHARACTER TEMPTATION. `isClosedStatus` already accepted `expired`, so relabelling
   * `vanished` would have made it fit with no other change — and would have stated a cause nobody
   * observed. The predicate was widened instead.
   */
  it('does not relabel a vanished offer as expired', () => {
    expect(timelineStatusFor(offer({ bucket: 'gone', goneReason: 'withdrawnOrExpired' }))).toBe('vanished')
  })

  it('passes a provider-stated expiry through as expired', () => {
    expect(timelineStatusFor(offer({ bucket: 'gone', goneReason: 'expired' }))).toBe('expired')
  })

  it('maps a declined offer onto the timeline rejected status', () => {
    expect(timelineStatusFor(offer({ bucket: 'declined' }))).toBe('rejected')
  })
})

describe('buildProviderOfferHistoryRows', () => {
  /**
   * 🛑 PENDING STAYS LIVE. `lib/core-app/trades.ts` records why: a cached pending offer goes stale
   * the moment it is accepted, so an offer answered on Sleeper thirty seconds ago must not still
   * be sitting in an inbox here. Contributing pending rows would put this feed in direct conflict
   * with the live read, and the two would disagree about the same offer.
   */
  it('contributes settled rows only, never pending ones', () => {
    const rows = buildProviderOfferHistoryRows({
      offers: [
        offer({ id: 'a', bucket: 'needsYou', status: 'pending' }),
        offer({ id: 'b', bucket: 'awaitingOthers', status: 'pending' }),
        offer({ id: 'c', bucket: 'completed', status: 'accepted' }),
        offer({ id: 'd', bucket: 'declined' }),
        offer({ id: 'e', bucket: 'gone', goneReason: 'withdrawnOrExpired' }),
      ],
      viewerRosterId: '1',
      teamNames: names,
    })
    expect(rows.map((r) => r.id)).toEqual(['provider-offer:d', 'provider-offer:e'])
  })

  it('splits assets into sent and received from the viewer side', () => {
    const rows = buildProviderOfferHistoryRows({
      offers: [
        offer({
          assets: [
            { assetType: 'player', playerId: '99', pickSeason: null, pickRound: null, pickOriginalRosterId: null, faabAmount: null, fromRosterId: '1', toRosterId: '2' },
            { assetType: 'player', playerId: '77', pickSeason: null, pickRound: null, pickOriginalRosterId: null, faabAmount: null, fromRosterId: '2', toRosterId: '1' },
          ],
        }),
      ],
      viewerRosterId: '1',
      teamNames: names,
    })
    expect(rows[0].sent.map((a) => a.label)).toEqual(['Player 99'])
    expect(rows[0].received.map((a) => a.label)).toEqual(['Player 77'])
  })

  it('renders picks and FAAB as their own assets', () => {
    const rows = buildProviderOfferHistoryRows({
      offers: [
        offer({
          assets: [
            { assetType: 'pick', playerId: null, pickSeason: 2027, pickRound: 1, pickOriginalRosterId: '7', faabAmount: null, fromRosterId: '1', toRosterId: '2' },
            { assetType: 'faab', playerId: null, pickSeason: null, pickRound: null, pickOriginalRosterId: null, faabAmount: 40, fromRosterId: '1', toRosterId: '2' },
          ],
        }),
      ],
      viewerRosterId: '1',
      teamNames: names,
    })
    expect(rows[0].sent.map((a) => a.label)).toEqual(['2027 round 1 pick', '$40 FAAB'])
    expect(rows[0].sent[0].sublabel).toBe('originally roster 7')
  })

  /**
   * ⚠ Dropping an unresolvable player would make a two-for-one render as a one-for-one — a trade
   * that reads as a plausible deal rather than as missing data.
   */
  it('keeps an unresolved player visible rather than dropping it', () => {
    const rows = buildProviderOfferHistoryRows({
      offers: [
        offer({
          assets: [
            { assetType: 'player', playerId: 'zzz', pickSeason: null, pickRound: null, pickOriginalRosterId: null, faabAmount: null, fromRosterId: '1', toRosterId: '2' },
          ],
        }),
      ],
      viewerRosterId: '1',
      teamNames: names,
    })
    expect(rows[0].sent).toHaveLength(1)
    expect(rows[0].sent[0].label).toBe('Player zzz')
  })

  /**
   * ⚠ Sleeper's `creator` is a USER id, so nothing here can say who proposed a settled offer.
   * Guessing would render a manager's own offer backwards — the mistake the Yahoo path explicitly
   * refuses to make.
   */
  it('claims no direction it cannot know', () => {
    const rows = buildProviderOfferHistoryRows({ offers: [offer()], viewerRosterId: '1', teamNames: names })
    expect(rows[0].direction).toBe('complete')
  })

  it('names the partner, and says how many when there are more than two', () => {
    const two = buildProviderOfferHistoryRows({ offers: [offer()], viewerRosterId: '1', teamNames: names })
    expect(two[0].partnerName).toBe('Team Two')

    const three = buildProviderOfferHistoryRows({
      offers: [offer({ rosterIds: ['1', '2', '3'] })],
      viewerRosterId: '1',
      teamNames: new Map(),
    })
    expect(three[0].partnerName).toBe('2 managers')
  })

  /**
   * 🛑 NO FABRICATED TIMESTAMP. Defaulting an unknown time to `new Date()` would date the offer to
   * the moment the page rendered — in the feature whose whole point is reliable timestamps.
   */
  it('leaves an unknown time empty rather than inventing one', () => {
    const rows = buildProviderOfferHistoryRows({
      offers: [offer({ at: null, atSource: null })],
      viewerRosterId: '1',
      teamNames: names,
    })
    expect(rows[0].timestamp).toBe('')
  })

  it('carries a known time through as an ISO string', () => {
    const rows = buildProviderOfferHistoryRows({ offers: [offer()], viewerRosterId: '1', teamNames: names })
    expect(rows[0].timestamp).toBe('2026-09-10T00:00:00.000Z')
  })

  it('namespaces row ids so they cannot collide with native trade ids', () => {
    const rows = buildProviderOfferHistoryRows({ offers: [offer()], viewerRosterId: '1', teamNames: names })
    expect(rows[0].id.startsWith('provider-offer:')).toBe(true)
  })
})
