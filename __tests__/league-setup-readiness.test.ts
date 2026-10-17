import { describe, expect, it } from 'vitest'
import { countAssignedManagers, leagueLifecycleLabel } from '@/lib/league/setup-readiness'

describe('league setup readiness', () => {
  it('counts one manager across twelve allocated native teams', () => {
    const teams = [
      { claimedByUserId: 'commissioner', platformUserId: 'commissioner', isOrphan: false },
      ...Array.from({ length: 11 }, (_, i) => ({
        claimedByUserId: null, platformUserId: `open-slot-league-${i + 2}`, isOrphan: true,
      })),
    ]
    expect(countAssignedManagers(teams)).toBe(1)
  })

  it('recognizes imported owners while excluding vacant and synthetic slots', () => {
    expect(countAssignedManagers([
      { platformUserId: 'sleeper-owner' },
      { claimedByUserId: 'af-owner', platformUserId: 'sleeper-owner' },
      { platformUserId: 'old-owner', isOrphan: true },
      { platformUserId: 'open-slot-league-2', isOrphan: false },
      { platformUserId: '  ', claimedByUserId: null },
      {},
    ])).toBe(2)
    expect(countAssignedManagers([])).toBe(0)
  })

  it.each([
    ['setup', 'active', 'League setup'],
    ['pre_draft', 'active', 'Pre-draft'],
    ['drafting', 'active', 'Draft in progress'],
    ['post_draft', 'active', 'Draft complete'],
    ['playoffs', 'active', 'Playoffs'],
    ['completed', 'active', 'Season complete'],
    ['offseason', 'active', 'Offseason'],
    ['renewal_pending', 'active', 'Renewal pending'],
    ['archived', 'active', 'Archived'],
    [null, 'in_season', 'In season'],
    [null, 'future_state', 'Status unavailable'],
  ])('labels lifecycle %s with status %s as %s', (state, status, label) => {
    expect(leagueLifecycleLabel(state, status)).toBe(label)
  })
})
