/**
 * Owner's decision 2026-11-28, item B: league health in Chimmy needs AF Commissioner (or AF Supreme), not just
 * the commissioner ROLE. Both readers — the `get_league_health` tool and the packet slice
 * `loadCommissionerHealthDecisionSlice` — go through the slice, which now checks `commissioner_depth` (the same
 * depth Commissioner OS reads, lib/commissioner-ui/commissionerOsDepth.ts) after the role and before any read.
 *
 * The role check (`assertLeagueCommissioner`) and the plan check (`resolveCoreDepth` → the REAL plan rules,
 * tierMatrixHarness) both run for real; only the league row and the plan's database read are replaced. And
 * when the plan is missing, Chimmy is TOLD to say league health is part of AF Commissioner or AF Supreme.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TIERS, setTier, type Tier } from '../../monetization/tierMatrixHarness'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  league: null as null | { userId: string; settings: unknown; teams: Array<Record<string, unknown>> },
  loadHealthSnapshot: vi.fn(),
  runCommish: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findFirst: vi.fn(async () => h.league) } },
}))
vi.mock('@/lib/subscription/EntitlementResolver', async () => (await import('../../monetization/tierMatrixHarness')).resolverModule())
vi.mock('@/lib/decision-os/commissioner-os', () => ({
  createCommissionerOsLoaders: () => ({ loadHealthSnapshot: h.loadHealthSnapshot }),
}))
vi.mock('@/lib/decision-os/commissioner-health', () => ({ runCommissionerHealthDecision: h.runCommish }))
vi.mock('@/lib/decision-os/commissioner-health/deps', () => ({ buildProductionCommissionerHealthDecisionDeps: vi.fn(() => ({})) }))
vi.mock('@/lib/commissioner-hub/inactiveFlagRecord', () => ({ loadInactiveFlagRecord: vi.fn(async () => null) }))
vi.mock('@/lib/decision-os/flags', () => ({
  resolveDecisionOsFeedFlags: async () => ({ enabled: () => true, killed: [] }),
}))

import { executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'
import { isLeagueHealthPlanLock, loadCommissionerHealthDecisionSlice } from '@/lib/decision-os/grounding/decisionBridge'

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
// AF Commissioner, or AF Supreme which includes it. AF Pro and AF Legacy alone do not.
const OPEN: Tier[] = ['commissioner', 'supreme']

beforeEach(() => {
  vi.clearAllMocks()
  h.league = { userId: 'u1', settings: {}, teams: [] } // the HEAD commissioner
  h.loadHealthSnapshot.mockResolvedValue({ leagueId: 'L1', source: 'database' })
  h.runCommish.mockResolvedValue({ decision })
})

describe('get_league_health needs the commissioner role AND AF Commissioner / AF Supreme', () => {
  for (const tier of TIERS) {
    const open = OPEN.includes(tier)
    it(`head commissioner on ${tier}: ${open ? 'league health is read' : 'told it is AF Commissioner, nothing read'}`, async () => {
      setTier(tier)
      const out = await executeChimmyTool('get_league_health', {}, CTX)
      if (open) {
        expect(out).toMatch(/^LEAGUE HEALTH/)
        expect(out).toContain('2 inactive managers.')
        expect(h.loadHealthSnapshot).toHaveBeenCalledTimes(1)
      } else {
        expect(out).toMatch(/League health is part of AF Commissioner or AF Supreme/)
        expect(out).toMatch(/upgrade/i)
        expect(out).toMatch(/Do not stay silent/)
        expect(out).not.toContain('inactive managers.')
        expect(h.loadHealthSnapshot).not.toHaveBeenCalled()
        expect(h.runCommish).not.toHaveBeenCalled()
      }
    })
  }

  it('a member who is not a commissioner is still told to ask the commissioner — even on AF Supreme', async () => {
    setTier('supreme')
    h.league = { userId: 'owner', settings: {}, teams: [{ id: 't1', isCommissioner: false, isCoCommissioner: false, role: null }] }
    const out = await executeChimmyTool('get_league_health', {}, CTX)
    expect(out).toMatch(/commissioner view/)
    expect(out).not.toMatch(/part of AF Commissioner/)
    expect(h.loadHealthSnapshot).not.toHaveBeenCalled()
  })
})

describe('the packet slice applies the same plan rule', () => {
  it('AF Pro commissioner → a not_entitled plan gap that names the plan; nothing read', async () => {
    setTier('pro')
    const slice = await loadCommissionerHealthDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(slice.present).toBe(false)
    expect(slice.gap?.reason).toBe('not_entitled')
    expect(isLeagueHealthPlanLock(slice.gap)).toBe(true)
    expect(slice.gap?.detail).toMatch(/AF Commissioner or AF Supreme/)
    expect(slice.gap?.remedy).toMatch(/\/upgrade\?plan=commissioner/)
    expect(h.loadHealthSnapshot).not.toHaveBeenCalled()
  })

  it('AF Commissioner commissioner → the health decision', async () => {
    setTier('commissioner')
    const slice = await loadCommissionerHealthDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(slice.present).toBe(true)
    expect(isLeagueHealthPlanLock(slice.gap)).toBe(false)
  })

  it('the role refusal is NOT read as a plan lock', async () => {
    setTier('supreme')
    h.league = { userId: 'owner', settings: {}, teams: [] }
    const slice = await loadCommissionerHealthDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(slice.gap?.reason).toBe('not_entitled')
    expect(isLeagueHealthPlanLock(slice.gap)).toBe(false)
  })
})
