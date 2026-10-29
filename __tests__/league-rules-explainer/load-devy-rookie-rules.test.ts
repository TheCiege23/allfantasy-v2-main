/** `loadRuleSnapshot` hands a Devy league's variant to the rookie rules, so its own config is read. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    dynastyLeagueConfig: { findUnique: vi.fn(async () => null) },
    devyLeagueConfig: { findUnique: vi.fn(async () => ({ rookiePickOrderMethod: 'reverse_standings', rookieDraftRounds: 3, rookieDraftType: 'snake' })) },
    c2CLeagueConfig: { findUnique: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/roster-engine', () => ({ getRosterEngineRegistry: () => ({ isSupported: () => false }) }))
vi.mock('@/lib/scoring-defaults/LeagueScoringConfigResolver', () => ({ getLeagueScoringConfig: vi.fn(async () => null) }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(async () => null) }))
vi.mock('@/lib/taxi/TaxiSettingsService', () => ({ getEffectiveTaxiSettings: vi.fn(async () => null) }))
vi.mock('@/lib/league-rules-explainer/loadDraftRules', () => ({ loadDraftRulesSafe: vi.fn(async () => null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: vi.fn(async () => null) }))

import { loadRuleSnapshot } from '@/lib/league-rules-explainer/load'

describe('loadRuleSnapshot — a Devy league’s rookie draft', () => {
  it('reads its Devy config, not the dynasty defaults', async () => {
    const s = await loadRuleSnapshot('L1', {
      platform: 'allfantasy', sport: 'NFL', leagueType: 'dynasty', leagueVariant: 'devy_dynasty', isDynasty: true,
      leagueSize: 12, scoring: 'ppr', playoffTeams: 6, playoffStartWeek: 15, waiverType: 'faab', waiverBudget: 100,
      settings: { scoring_mode: 'points' },
    })
    expect(s.format).toBe('dynasty')
    expect([s.rookieDraftOrder, s.rookieDraftRounds, s.rookieDraftType]).toEqual(['reverse_standings', 3, 'snake'])
  })
})
