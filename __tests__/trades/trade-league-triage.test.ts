import { describe, expect, it } from 'vitest'
import { stateOf } from '@/components/core-app/screens/TradeLeagueStrip'

describe('cross-league trade triage', () => {
  it('uses the latest real offer and does not double count provider rows', () => {
    const state = stateOf({
      pending: { scanned: true, reason: null, platform: 'yahoo' },
      pendingOffers: [{ direction: 'incoming', partnerName: 'Alex', proposedAt: '2026-10-02T10:00:00Z' }],
      activeTrades: [
        { direction: 'incoming', partnerName: 'Alex', status: 'pending_on_yahoo', timestamp: '2026-10-02T10:00:00Z' },
        { direction: 'outgoing', partnerName: 'Jordan', status: 'proposed', timestamp: '2026-10-03T10:00:00Z' },
      ],
    })
    expect(state).toMatchObject({ kind: 'waiting', count: 1, from: 'Alex', last: { direction: 'outgoing', partner: 'Jordan' } })
  })

  it('preserves known native offers when a source feed could not be scanned', () => {
    const state = stateOf({
      pending: { scanned: false, reason: 'Provider unavailable', platform: 'espn' },
      activeTrades: [{ direction: 'incoming', partnerName: 'Taylor', status: 'proposed', timestamp: '2026-10-03T10:00:00Z' }],
    })
    expect(state).toMatchObject({ kind: 'waiting', count: 1, partial: true, from: 'Taylor' })
    expect(stateOf({ pending: { scanned: false, reason: 'Provider unavailable', platform: 'espn' } }))
      .toMatchObject({ kind: 'unread', reason: 'Provider unavailable' })
  })
})
