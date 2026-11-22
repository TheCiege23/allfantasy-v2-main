/**
 * @vitest-environment node
 *
 * Waiver OS Kernel axis (2026-11-21 code re-score): the AI waiver panel's route read `loadWaiverWorldFacts` directly
 * while Chimmy's waiver answer read the same facts through Waiver OS. It reads Waiver OS's user-level resource entry
 * now, and reports the feed's outcomes.
 */
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const facts = {
    sport: 'NFL',
    leagueId: 'L1',
    rosterId: 'r-me',
    settings: { waiverType: 'faab', normalizedWaiverType: 'faab', faabBudget: 100 },
    settingsKnown: true,
    faabRemaining: 64,
    waiverPriority: 3,
    rosterSize: 15,
  }
  const outcomes = [{ key: 'u1:L1', outcome: 'hit' }]
  return {
    facts,
    outcomes,
    liveLoad: vi.fn(async () => facts),
    feedLoad: vi.fn(async () => facts),
    emitFeedOutcomes: vi.fn(),
  }
})

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/entitlements/afAccess', () => ({ getUserAfProStatus: vi.fn(async () => true), AfProRequiredError: class {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: vi.fn(async () => ({ platform: 'sleeper' })) } } }))
vi.mock('@/lib/decision-os/waiver/loader', () => ({ loadWaiverWorldFacts: h.liveLoad, worldInputFromFacts: vi.fn(() => ({})) }))
vi.mock('@/lib/decision-os/waiver-os', () => ({
  createWaiverOsLoaders: () => ({ loadWorldFacts: h.feedLoad, drainOutcomes: () => h.outcomes }),
}))
vi.mock('@/lib/decision-os/core/parity', () => ({ emitFeedOutcomes: h.emitFeedOutcomes }))
vi.mock('@/lib/decision-os/waiver/deps', () => ({ buildLiveWaiverDecisionDeps: vi.fn(() => ({})) }))
vi.mock('@/lib/decision-os/waiver/pool', () => ({ loadWaiverPool: vi.fn(async () => ({ availablePlayers: [], leagueRosterCount: 12 })) }))
vi.mock('@/lib/decision-os/waiver/calibrationStore', () => ({ loadWaiverCalibrationForLeague: vi.fn(async () => ({ calibration: null, inScope: false })) }))
vi.mock('@/lib/decision-os/waiver', () => ({ runWaiverClaimDecision: vi.fn() }))

const { POST } = await import('@/app/api/ai/waivers/recommend/route')

describe('POST /api/ai/waivers/recommend reads through Waiver OS', () => {
  it('the facts come from the Waiver OS entry, never a direct load, and the feed outcomes are reported', async () => {
    const res = await POST(new Request('http://x/api/ai/waivers/recommend', { method: 'POST', body: JSON.stringify({ leagueId: 'L1' }) }))
    const body = await res.json()
    expect(h.feedLoad).toHaveBeenCalledWith('u1', 'L1')
    expect(h.liveLoad).not.toHaveBeenCalled()
    expect(h.emitFeedOutcomes).toHaveBeenCalledWith('waiver', h.outcomes)
    // The panel's FAAB line is the feed's.
    expect(body.leagueContext).toMatchObject({ waiverType: 'faab', faabBudget: 100, faabRemaining: 64 })
  })
})
