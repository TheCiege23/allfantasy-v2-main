/**
 * `get_league_health` (2026-11-23): league-health facts used to reach Chimmy only when the turn was CLASSIFIED
 * `commissioner`, so "is anyone inactive in my league?" read as anything else got nothing. The tool reads the same
 * `loadCommissionerHealthDecisionSlice` the packet does.
 *
 * 🛑 THE GATE IS RUN FOR REAL HERE. `assertLeagueCommissioner` and `commissionerAccess` are not mocked — only the
 * league row they read is — so these tests pin the actual permission rule, not a stand-in that says yes or no.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// The commissioner holds AF Commissioner here; the plan rule itself is pinned in
// __tests__/chimmy/tools/league-health-plan-2026-11-28.test.ts.
vi.mock('@/lib/core-app/corePaywall', () => ({ resolveCoreDepth: async () => ({ unlocked: true }) }))

const h = vi.hoisted(() => ({
  league: null as null | { userId: string; settings: unknown; teams: Array<Record<string, unknown>> },
  loadHealthSnapshot: vi.fn(),
  runCommish: vi.fn(),
  enabled: true,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findFirst: vi.fn(async () => h.league) } },
}))
vi.mock('@/lib/decision-os/commissioner-os', () => ({
  createCommissionerOsLoaders: () => ({ loadHealthSnapshot: h.loadHealthSnapshot }),
}))
vi.mock('@/lib/decision-os/commissioner-health', () => ({ runCommissionerHealthDecision: h.runCommish }))
vi.mock('@/lib/decision-os/commissioner-health/deps', () => ({ buildProductionCommissionerHealthDecisionDeps: vi.fn(() => ({})) }))
vi.mock('@/lib/commissioner-hub/inactiveFlagRecord', () => ({ loadInactiveFlagRecord: vi.fn(async () => null) }))
vi.mock('@/lib/decision-os/flags', () => ({
  resolveDecisionOsFeedFlags: async () => ({ enabled: () => h.enabled, killed: [] }),
}))

import { CHIMMY_TOOL_SPECS, executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'

const decision = {
  decision_id: 'c1',
  decision_type: 'commissioner.league.health',
  decider_scope: 'commissioner',
  lifecycle_phase: 'in_season',
  four_answers: {
    what_happened: 'Two managers have not set a lineup in three weeks.',
    why_it_matters: 'Abandoned teams distort playoff seeding.',
    how_confident: 'High — measured from live rosters.',
    what_to_do: 'Message both managers, then consider a replacement.',
  },
  recommended_actions: [],
  rule_verdicts: [
    { rule: 'commissioner.health.inactive_managers', verdict: 'requires_approval', message: '2 inactive managers.', severity: 'warning' },
  ],
  confidence: 88,
  data_completeness: 100,
  uncertainty_sources: [],
  provenance: { weakest_source: 'league_rosters', weakest_trust: 'high' },
  automation_capable: false,
  explanation: 'Two inactive teams.',
  telemetry: { dco_consumed: true, rule_gated: true, decision_object_emitted: true, explainable: true, world_resolution_read_only: true },
}

const CTX = { leagueId: 'L1', userId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  h.enabled = true
  h.loadHealthSnapshot.mockResolvedValue({ leagueId: 'L1', source: 'database' })
  h.runCommish.mockResolvedValue({ decision })
})

describe('get_league_health', () => {
  it('is declared with no arguments — the league comes from the session, never the model', () => {
    const spec = CHIMMY_TOOL_SPECS.find((s) => s.function.name === 'get_league_health')
    expect(spec).toBeDefined()
    expect(spec!.function.parameters).toEqual({ type: 'object', properties: {}, required: [] })
  })

  it('answers the HEAD commissioner with the health engine\'s findings', async () => {
    h.league = { userId: 'u1', settings: {}, teams: [] }
    const out = await executeChimmyTool('get_league_health', {}, CTX)
    expect(out).toMatch(/^LEAGUE HEALTH/)
    expect(out).toContain('Two managers have not set a lineup in three weeks.')
    expect(out).toContain('Message both managers')
    expect(out).toContain('2 inactive managers.')
    expect(h.loadHealthSnapshot).toHaveBeenCalledWith({ userId: 'u1', leagueId: 'L1' })
  })

  it('answers a CO-commissioner too — the hub\'s own "view" need', async () => {
    h.league = { userId: 'owner', settings: {}, teams: [{ id: 't1', isCommissioner: false, isCoCommissioner: true, role: null }] }
    const out = await executeChimmyTool('get_league_health', {}, CTX)
    expect(out).toContain('2 inactive managers.')
  })

  it('🛑 REFUSES a league member who is not a commissioner, and reads no health data at all', async () => {
    h.league = { userId: 'owner', settings: {}, teams: [{ id: 't1', isCommissioner: false, isCoCommissioner: false, role: null }] }
    const out = await executeChimmyTool('get_league_health', {}, CTX)
    expect(out).toMatch(/commissioner view/)
    expect(out).toMatch(/NOTHING was read/)
    expect(out).not.toContain('inactive managers.')
    expect(h.loadHealthSnapshot).not.toHaveBeenCalled()
    expect(h.runCommish).not.toHaveBeenCalled()
  })

  it('no league in scope reads nothing', async () => {
    const out = await executeChimmyTool('get_league_health', {}, { leagueId: null, userId: 'u1' })
    expect(out).toMatch(/NO LEAGUE IS SELECTED/)
    expect(h.loadHealthSnapshot).not.toHaveBeenCalled()
  })

  it('the feed kill switch turns the tool off too', async () => {
    h.league = { userId: 'u1', settings: {}, teams: [] }
    h.enabled = false
    const out = await executeChimmyTool('get_league_health', {}, CTX)
    expect(out).toMatch(/switched off/)
    expect(h.loadHealthSnapshot).not.toHaveBeenCalled()
  })

  it('a missing snapshot is said as "not measured", never as a healthy league', async () => {
    h.league = { userId: 'u1', settings: {}, teams: [] }
    h.loadHealthSnapshot.mockResolvedValue(null)
    const out = await executeChimmyTool('get_league_health', {}, CTX)
    expect(out).toMatch(/could not be read/)
    expect(out).toMatch(/nothing was measured/)
  })
})
