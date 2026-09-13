import { describe, expect, it } from 'vitest'
import { deterministicTransactionFactId } from '@/lib/league-import/persistProviderTransactionFacts'

describe('provider transaction fact identity', () => {
  const base = {
    provider: 'yahoo', upstreamTransactionId: 'nfl.l.1.tr.9', entryIndex: 0,
    leagueId: 'league-1', sport: 'NFL', type: 'trade', playerId: 'p1', rosterId: 't1',
    payload: {}, season: 2026,
  }

  it('is stable for repeated syncs and distinct for separate legs', () => {
    expect(deterministicTransactionFactId(base)).toBe(deterministicTransactionFactId({ ...base }))
    expect(deterministicTransactionFactId(base)).not.toBe(deterministicTransactionFactId({ ...base, entryIndex: 1 }))
    expect(deterministicTransactionFactId(base)).not.toBe(deterministicTransactionFactId({ ...base, leagueId: 'league-2' }))
    expect(deterministicTransactionFactId(base)).not.toBe(
      deterministicTransactionFactId({ ...base, lifecycleStage: 'accepted' }),
    )
    expect(deterministicTransactionFactId({ ...base, lifecycleStage: 'accepted' })).toBe(
      deterministicTransactionFactId({ ...base, lifecycleStage: 'accepted' }),
    )
  })
})
