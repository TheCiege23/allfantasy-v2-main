import { describe, it, expect } from 'vitest'
import { categorize, tradeProposalDelta } from '@/lib/intelligence'

describe('intelligence snapshot projection — pure helpers', () => {
  it('categorize maps event types to coarse categories', () => {
    expect(categorize('transaction.trade.accepted')).toBe('trade')
    expect(categorize('transaction.waiver.processed')).toBe('waiver')
    expect(categorize('roster.lineup.set')).toBe('lineup')
    expect(categorize('draft.session.started')).toBe('draft')
    expect(categorize('competition.matchup.finalized')).toBe('scoring')
    expect(categorize('competition.champion.crowned')).toBe('scoring')
    expect(categorize('governance.settings.changed')).toBe('governance')
    expect(categorize('lifecycle.season.activated')).toBe('lifecycle')
    expect(categorize('auth.user.registered')).toBe('other')
  })

  it('tradeProposalDelta tracks open proposals', () => {
    expect(tradeProposalDelta('transaction.trade.proposed')).toBe(1)
    expect(tradeProposalDelta('transaction.trade.accepted')).toBe(-1)
    expect(tradeProposalDelta('transaction.trade.rejected')).toBe(-1)
    expect(tradeProposalDelta('transaction.trade.canceled')).toBe(-1)
    expect(tradeProposalDelta('transaction.trade.vetoed')).toBe(-1)
    expect(tradeProposalDelta('transaction.waiver.processed')).toBe(0)
    expect(tradeProposalDelta('lifecycle.season.activated')).toBe(0)
  })
})
