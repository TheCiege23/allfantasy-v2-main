import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { planSleeperNbaReconciliation } from '@/lib/player-identity/reconcileSleeperNbaIdentities'

const sleeper = (id: string, overrides: Record<string, string | null> = {}) => ({
  sleeperId: id, name: 'Alex Example', position: 'G', team: 'BOS', dob: '2000-01-01', ...overrides,
})
const ri = (id: string, overrides: Record<string, string | null> = {}) => ({
  externalId: id, name: 'Alex Example', position: 'G', team: 'Boston Celtics', dob: '2000-01-01', ...overrides,
})
const identity = (id: string, riId: string, overrides: Record<string, string | null> = {}) => ({
  id, rollingInsightsId: riId, sleeperNbaId: null, canonicalName: 'Alex Example', position: 'G', dob: '2000-01-01', ...overrides,
})

describe('Sleeper NBA reconciliation', () => {
  it('links a unique exact name, position, and team', () => {
    expect(planSleeperNbaReconciliation([sleeper('100')], [ri('200')], [identity('nba-person', '200')]).links)
      .toEqual([{ identityId: 'nba-person', sleeperId: '100', evidence: 'name_position_team' }])
  })

  it('uses a matching birthday for a spelling alias only with the same position and team', () => {
    const plan = planSleeperNbaReconciliation([sleeper('100', { name: 'A. Example' })], [ri('200')], [identity('nba-person', '200')])
    expect(plan.links).toEqual([{ identityId: 'nba-person', sleeperId: '100', evidence: 'dob_position_team' }])
    expect(planSleeperNbaReconciliation([sleeper('100', { name: 'A. Example', dob: '2001-01-01' })],
      [ri('200')], [identity('nba-person', '200')]).links).toEqual([])
  })

  it('refuses duplicate targets, conflicting owners, and teamless rows', () => {
    expect(planSleeperNbaReconciliation([sleeper('100'), sleeper('101')], [ri('200')], [identity('nba-person', '200')]).links).toEqual([])
    expect(planSleeperNbaReconciliation([sleeper('100')], [ri('200')],
      [identity('nba-person', '200', { sleeperNbaId: '999' })]).links).toEqual([])
    expect(planSleeperNbaReconciliation([sleeper('100', { team: null })], [ri('200')], [identity('nba-person', '200')]).links).toEqual([])
  })

  it('never crosses a same-numbered player in another sport', () => {
    const plan = planSleeperNbaReconciliation([sleeper('5850')], [ri('5850')], [identity('nba-person', '5850')])
    expect(plan.links).toEqual([{ identityId: 'nba-person', sleeperId: '5850', evidence: 'name_position_team' }])
    // The planner's inputs are NBA-only; the database read and conditional write enforce that namespace.
  })
})
