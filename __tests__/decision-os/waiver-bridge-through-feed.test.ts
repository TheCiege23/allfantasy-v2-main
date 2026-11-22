import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Waiver OS, 2026-11-20 re-score (Kernel ⚠ → ✅): the waiver decision behind every Chimmy waiver question and the
 * weekly engine run reads its facts through Waiver OS's five-minute user entry, not `loadWaiverWorldFacts` directly.
 */

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ loadFacts: vi.fn(), loadPool: vi.fn() }))
vi.mock('@/lib/decision-os/waiver/loader', () => ({
  loadWaiverWorldFacts: h.loadFacts,
  loadWaiverLeagueFacts: vi.fn(async () => null),
  worldInputFromFacts: () => ({}),
}))
vi.mock('@/lib/decision-os/waiver/pool', () => ({ loadWaiverPool: h.loadPool }))
vi.mock('@/lib/decision-os/waiver', () => ({ runWaiverClaimDecision: vi.fn(async () => null) }))
vi.mock('@/lib/decision-os/waiver/deps', () => ({ buildLiveWaiverDecisionDeps: () => ({}) }))
vi.mock('@/lib/decision-os/waiver/calibrationStore', () => ({ loadWaiverCalibrationForLeague: vi.fn(async () => null) }))

// An in-memory `domain_os_facts`.
const rows = new Map<string, Record<string, unknown>>()
const key = (w: { domain_kind_level_scopeKey: Record<string, string> }) => Object.values(w.domain_kind_level_scopeKey).join('/')
vi.mock('@/lib/prisma', () => ({
  prisma: {
    domainOsFacts: {
      findUnique: vi.fn(async (a: { where: { domain_kind_level_scopeKey: Record<string, string> } }) => rows.get(key(a.where)) ?? null),
      upsert: vi.fn(async (a: { where: { domain_kind_level_scopeKey: Record<string, string> }; create: Record<string, unknown> }) => {
        rows.set(key(a.where), { ...a.create, capturedAt: new Date() })
        return a.create
      }),
    },
  },
}))

const { loadWaiverDecisionSlice } = await import('@/lib/decision-os/grounding/decisionBridge')

const FACTS = { sport: 'NFL', leagueId: 'lg1', rosterId: 'r1', settings: { faabBudget: 100 }, settingsKnown: true, faabRemaining: 80, waiverPriority: 3, rosterSize: 16 }

beforeEach(() => {
  rows.clear()
  h.loadFacts.mockReset()
  h.loadPool.mockReset()
  h.loadFacts.mockResolvedValue(FACTS)
  // An empty wire ends the slice right after the facts read — the read is what is under test.
  h.loadPool.mockResolvedValue({ availablePlayers: [] })
})

describe('the waiver decision reads its facts through Waiver OS', () => {
  it('a second question inside five minutes is served from the entry — no second derivation', async () => {
    await loadWaiverDecisionSlice({ userId: 'u1', leagueId: 'lg1' })
    await loadWaiverDecisionSlice({ userId: 'u1', leagueId: 'lg1' })
    expect(h.loadFacts).toHaveBeenCalledTimes(1)
    expect(h.loadPool).toHaveBeenCalledTimes(2)
    expect(h.loadPool).toHaveBeenLastCalledWith('lg1', 'NFL', 'r1')
    expect([...rows.keys()]).toContain('waiver/resource/user/u1:lg1')
  })

  it('another manager in the same league gets their own entry, never the first one’s FAAB', async () => {
    await loadWaiverDecisionSlice({ userId: 'u1', leagueId: 'lg1' })
    await loadWaiverDecisionSlice({ userId: 'u2', leagueId: 'lg1' })
    expect(h.loadFacts).toHaveBeenCalledTimes(2)
    expect(h.loadFacts).toHaveBeenLastCalledWith('u2', 'lg1')
  })

  it('no roster resolved is never cached: the next question derives again', async () => {
    h.loadFacts.mockResolvedValue(null)
    const first = await loadWaiverDecisionSlice({ userId: 'u1', leagueId: 'lg1' })
    expect(first.gap?.reason).toBe('not_synced')
    await loadWaiverDecisionSlice({ userId: 'u1', leagueId: 'lg1' })
    expect(h.loadFacts).toHaveBeenCalledTimes(2)
    expect(rows.size).toBe(0)
  })
})
