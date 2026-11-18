import { describe, expect, it } from 'vitest'

import { chooseAuctionRosterId, isBidAgainstOwnTeam } from '@/lib/live-draft-engine/auction/multiTeamAuction'

describe('auction drafts for a manager with several teams', () => {
  const mine = ['team-a', 'team-b']

  it('one team is that team', () => {
    expect(chooseAuctionRosterId({ rosterIds: ['team-a'], purpose: 'bid' })).toBe('team-a')
    expect(chooseAuctionRosterId({ rosterIds: [], purpose: 'bid' })).toBeNull()
  })

  it('a bid is never guessed: it needs the team named or the team they switched to', () => {
    expect(chooseAuctionRosterId({ rosterIds: mine, purpose: 'bid' })).toBeNull()
    // Being the nominator does not decide who BIDS.
    expect(chooseAuctionRosterId({ rosterIds: mine, purpose: 'bid', nominatorRosterId: 'team-b' })).toBeNull()
    expect(chooseAuctionRosterId({ rosterIds: mine, purpose: 'bid', rememberedRosterIds: ['elsewhere', 'team-b'] })).toBe('team-b')
    expect(chooseAuctionRosterId({ rosterIds: mine, purpose: 'bid', requestedRosterId: 'team-a', rememberedRosterIds: ['team-b'] })).toBe('team-a')
  })

  it('a team named that the manager does not run is refused, not replaced by another of theirs', () => {
    expect(chooseAuctionRosterId({ rosterIds: mine, purpose: 'bid', requestedRosterId: 'someone-elses', rememberedRosterIds: ['team-b'] })).toBeNull()
  })

  it('a nomination goes to their team whose turn it is', () => {
    expect(chooseAuctionRosterId({ rosterIds: mine, purpose: 'nominate', nominatorRosterId: 'team-b', rememberedRosterIds: ['team-a'] })).toBe('team-b')
    // Somebody else's turn: fall back to the team they switched to (the engine then says it is not their turn).
    expect(chooseAuctionRosterId({ rosterIds: mine, purpose: 'nominate', nominatorRosterId: 'someone-elses', rememberedRosterIds: ['team-a'] })).toBe('team-a')
  })

  it('a manager cannot outbid their own other team, but can raise their own bid or outbid anyone else', () => {
    expect(isBidAgainstOwnTeam({ bidderRosterId: 'team-a', currentBidderRosterId: 'team-b', rosterIds: mine })).toBe(true)
    expect(isBidAgainstOwnTeam({ bidderRosterId: 'team-a', currentBidderRosterId: 'team-a', rosterIds: mine })).toBe(false)
    expect(isBidAgainstOwnTeam({ bidderRosterId: 'team-a', currentBidderRosterId: 'rival', rosterIds: mine })).toBe(false)
    expect(isBidAgainstOwnTeam({ bidderRosterId: 'team-a', currentBidderRosterId: null, rosterIds: mine })).toBe(false)
  })
})
