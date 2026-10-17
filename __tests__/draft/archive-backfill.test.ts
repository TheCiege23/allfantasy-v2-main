import { describe, expect, it } from 'vitest'
import { uniqueHistoricalSelection } from '@/lib/draft-archive/backfillMatch'
const fact = { season: 2025, round: 1, pickNumber: 1, playerId: 'player' }
const candidate = { sourceDraftId: 'startup', season: 2025, round: 1, overall: 1, playerId: 'player', metadata: {} }
describe('legacy archive backfill identity', () => {
  it('matches exact season, round, overall and player identity', () => {
    expect(uniqueHistoricalSelection(fact, [candidate])).toBe(candidate)
    expect(uniqueHistoricalSelection({ ...fact, season: 2024 }, [candidate])).toBeNull()
    expect(uniqueHistoricalSelection({ ...fact, playerId: 'other' }, [candidate])).toBeNull()
  })
  it('leaves ambiguous startup/rookie matches unresolved', () => {
    expect(uniqueHistoricalSelection(fact, [candidate, { ...candidate, sourceDraftId: 'rookie' }])).toBeNull()
  })
})
