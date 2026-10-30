/** `loadRuleSnapshot` takes a native league's waiver rules from the engine's settings; an import keeps its columns. */
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ effective: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { dynastyLeagueConfig: { findUnique: vi.fn(async () => null) } } }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: h.effective }))
vi.mock('@/lib/roster-engine', () => ({ getRosterEngineRegistry: () => ({ isSupported: () => false }) }))
vi.mock('@/lib/scoring-defaults/LeagueScoringConfigResolver', () => ({ getLeagueScoringConfig: vi.fn(async () => null) }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(async () => null) }))
vi.mock('@/lib/taxi/TaxiSettingsService', () => ({ getEffectiveTaxiSettings: vi.fn(async () => null) }))
vi.mock('@/lib/league-rules-explainer/loadDraftRules', () => ({ loadDraftRulesSafe: vi.fn(async () => null) }))

import { loadRuleSnapshot } from '@/lib/league-rules-explainer/load'
import type { RulesLeagueRow } from '@/lib/league-rules-explainer/snapshot'

const row: RulesLeagueRow = {
  platform: 'allfantasy', sport: 'NFL', leagueType: 'redraft', leagueSize: 12, scoring: 'ppr',
  playoffTeams: 6, playoffStartWeek: 15, waiverType: 'rolling', waiverBudget: 100, settings: { scoring_mode: 'points' },
}

describe('loadRuleSnapshot — waiver rules', () => {
  it('a native league reads the engine’s settings over the League columns', async () => {
    h.effective.mockResolvedValueOnce({ normalizedWaiverType: 'faab', waiverType: 'faab', faabBudget: 250, faabMinBid: 2 })
    const s = await loadRuleSnapshot('L1', row)
    expect([s.waiverType, s.waiverBudget, s.waiverMinBid]).toEqual(['faab', 250, 2])
  })
  it('a failed read keeps the columns', async () => {
    h.effective.mockRejectedValueOnce(new Error('db down'))
    const s = await loadRuleSnapshot('L1', row)
    expect([s.waiverType, s.waiverBudget]).toEqual(['rolling', 100])
  })
})
