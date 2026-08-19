import { describe, expect, it, vi } from 'vitest'
import { loadWaiverWorldFacts, type WaiverLoaderDeps } from '@/lib/decision-os/waiver/loader'

function buildDeps(overrides: Partial<WaiverLoaderDeps> = {}): WaiverLoaderDeps {
  return {
    loadEffectiveSettings: async () => ({
      waiverType: 'faab',
      normalizedWaiverType: 'faab',
      faabBudget: 100,
      claimLimitPerPeriod: null,
      claimLimitPerWeek: null,
      maxDropsPerWeek: null,
      lockType: null,
    }),
    loadLeagueSport: async () => 'NFL',
    loadLinkedPlatformUserIds: async () => ['app-user', 'sleep-123'],
    loadUserRoster: async () => ({
      id: 'roster-1',
      faabRemaining: 22,
      waiverPriority: 5,
      playerData: { players: ['p1', 'p2', 'p3'] },
    }),
    hasSettingsRow: async () => true,
    ...overrides,
  }
}

describe('loadWaiverWorldFacts', () => {
  it('uses linked Sleeper platform ids when resolving imported canonical rosters', async () => {
    const loadUserRoster = vi.fn(async (_leagueId: string, platformUserIds: string[]) => ({
      id: 'roster-1',
      faabRemaining: 22,
      waiverPriority: 5,
      playerData: { players: ['p1', 'p2', 'p3'] },
    }))

    const facts = await loadWaiverWorldFacts(
      'app-user',
      'league-1',
      buildDeps({ loadUserRoster }),
    )

    expect(loadUserRoster).toHaveBeenCalledWith('league-1', ['app-user', 'sleep-123'])
    expect(facts?.rosterId).toBe('roster-1')
    expect(facts?.settingsKnown).toBe(true)
    expect(facts?.rosterSize).toBe(3)
  })

  it('returns null when no canonical roster can be resolved', async () => {
    const facts = await loadWaiverWorldFacts(
      'app-user',
      'league-1',
      buildDeps({ loadUserRoster: async () => null }),
    )

    expect(facts).toBeNull()
  })
})
