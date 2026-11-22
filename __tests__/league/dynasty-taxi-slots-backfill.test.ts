/** The one-off taxi-size backfill fixes only the pair league creation left behind, and reports the rest. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { planDynastyTaxiBackfill, type TaxiRow } from '../../scripts/backfill-dynasty-taxi-slots'

const row = (id: string, column: number | null, config: number | null, over: Partial<TaxiRow> = {}): TaxiRow => ({
  id, name: id, sport: 'NFL', leagueVariant: null, lifecycleState: 'in_season', column, config, ...over,
})

describe('planDynastyTaxiBackfill', () => {
  it('sets a 0 column to the size the settings show, and leaves leagues that already agree', () => {
    const plan = planDynastyTaxiBackfill([row('created-with-bug', 0, 4), row('null-column', null, 6), row('agrees', 4, 4), row('no-squad', 0, 0)])
    expect(plan.fix.map((r) => [r.id, r.next])).toEqual([['created-with-bug', 4], ['null-column', 6]])
    expect(plan.review).toEqual([])
  })

  it('🛑 only reports a league whose two numbers disagree any other way', () => {
    const plan = planDynastyTaxiBackfill([row('both-set', 3, 5), row('column-only', 4, 0)])
    expect(plan.fix).toEqual([])
    expect(plan.review.map((r) => r.id)).toEqual(['both-set', 'column-only'])
  })

  it('never touches an archived league, a devy or C2C league, or a league with no readable config size', () => {
    const plan = planDynastyTaxiBackfill([
      row('archived', 0, 4, { lifecycleState: 'archived' }),
      row('devy', 0, 4, { leagueVariant: 'devy_dynasty' }),
      row('c2c', 0, 4, { leagueVariant: 'merged_devy_c2c' }),
      row('no-config', 0, null),
    ])
    expect(plan).toEqual({ fix: [], review: [] })
  })
})
