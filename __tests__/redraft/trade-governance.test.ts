import { describe, expect, it, vi } from 'vitest'

import {
  REDRAFT_DEFAULT_VETO_THRESHOLD,
  prohibitedRedraftGovernanceFields,
  resolveRedraftTradeGovernance,
  vetoModeFromReviewType,
} from '@/lib/redraft/tradeGovernance'

/**
 * Redraft trade governance comes from the league's saved review type. See lib/redraft/tradeGovernance.ts
 * for why the proposer can no longer choose it, and why unknown values fail closed.
 */

describe('vetoModeFromReviewType', () => {
  it.each([
    ['league_vote', 'league_vote'],
    [' LEAGUE_VOTE ', 'league_vote'],
    ['instant', 'no_veto'],
    ['no_veto', 'no_veto'],
    ['commissioner', 'commissioner'],
  ])('maps %j to %s', (raw, expected) => {
    expect(vetoModeFromReviewType(raw)).toBe(expected)
  })

  it('🛑 fails closed: "none", missing and unrecognised values all require commissioner review', () => {
    // `none` is written for a best-ball league with trades DISABLED — reading it as "no review" would let
    // such a trade settle on accept.
    for (const raw of ['none', null, undefined, '', 'anything_else', 42, { mode: 'no_veto' }]) {
      expect(vetoModeFromReviewType(raw)).toBe('commissioner')
    }
  })
})

describe('resolveRedraftTradeGovernance', () => {
  it("reads the league's saved review type and maps it", async () => {
    const findUnique = vi.fn(async () => ({ commissionerTradeReviewType: 'league_vote' }))
    const governance = await resolveRedraftTradeGovernance({ redraftLeagueExtendedSettings: { findUnique } } as never, 'league-1')

    expect(findUnique).toHaveBeenCalledWith({ where: { leagueId: 'league-1' }, select: { commissionerTradeReviewType: true } })
    expect(governance).toEqual({ vetoMode: 'league_vote', vetoThreshold: REDRAFT_DEFAULT_VETO_THRESHOLD })
  })

  it('requires commissioner review when the league has no saved settings row', async () => {
    const findUnique = vi.fn(async () => null)
    const governance = await resolveRedraftTradeGovernance({ redraftLeagueExtendedSettings: { findUnique } } as never, 'league-1')
    expect(governance).toEqual({ vetoMode: 'commissioner', vetoThreshold: 4 })
  })
})

describe('prohibitedRedraftGovernanceFields', () => {
  it('names each governance field the body carries, whatever its value', () => {
    expect(prohibitedRedraftGovernanceFields({ vetoMode: null, vetoThreshold: 1, reason: 'x' })).toEqual([
      'vetoMode',
      'vetoThreshold',
    ])
    expect(prohibitedRedraftGovernanceFields({ vetoThreshold: undefined })).toEqual(['vetoThreshold'])
  })

  it('returns nothing for a body without them, or for no body at all', () => {
    expect(prohibitedRedraftGovernanceFields({ reason: 'x', assets: [] })).toEqual([])
    expect(prohibitedRedraftGovernanceFields(null)).toEqual([])
    expect(prohibitedRedraftGovernanceFields('vetoMode')).toEqual([])
  })
})
