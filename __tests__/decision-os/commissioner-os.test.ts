// @vitest-environment node
/**
 * Commissioner OS (lib/decision-os/commissioner-os, 2026-11-20 re-score push): league health is read through the
 * domain-OS kernel like every other decision domain — a fresh stored snapshot, else a live build that is then stored.
 *
 * Pinned:
 *   - the fact is USER-scoped: a co-commissioner never gets another's snapshot (it marks the viewer's team);
 *   - a fresh stored snapshot is served without a rebuild; an expired one is rebuilt;
 *   - a build that throws is null, never an exception;
 *   - the Chimmy slice proves commissioner access BEFORE reading, every time, and reads through the feed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ build: vi.fn(), assert: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/commissioner-hub/commissionerHubHealth', () => ({ getCommissionerHubHealthForUser: h.build }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueCommissioner: h.assert }))
vi.mock('@/lib/decision-os/commissioner-health', () => ({ runCommissionerHealthDecision: h.run }))
vi.mock('@/lib/decision-os/commissioner-health/deps', () => ({ buildProductionCommissionerHealthDecisionDeps: () => ({}) }))

import { commissionerHealthSource, createCommissionerOsLoaders, COMMISSIONER_HEALTH_TTL_MS } from '@/lib/decision-os/commissioner-os'
import type { OsStore } from '@/lib/decision-os/domain-os/store'

const snap = (leagueId: string, viewerTeam: string) => ({ leagueId, source: 'database', dataConfidence: 'high', teamCount: 12, viewerTeam })

/** An in-memory store that honours TTL on read, the production store's rule. */
function memoryStore(now: () => number) {
  const rows = new Map<string, { facts: unknown; at: number }>()
  const key = (a: { domain: string; kind: string; level: string; scopeKey: string }) => `${a.domain}|${a.kind}|${a.level}|${a.scopeKey}`
  const store: OsStore = {
    async read(a) {
      const r = rows.get(key(a))
      if (!r || now() - r.at > a.ttlMs) return null
      return { facts: r.facts as never, level: a.level, confidence: null, sampleSize: null, capturedAt: new Date(r.at), ageMs: now() - r.at }
    },
    async write(a) {
      rows.set(key(a), { facts: a.facts, at: now() })
      return true
    },
  }
  return { store, rows }
}

beforeEach(() => {
  h.build.mockReset()
  h.assert.mockReset()
  h.run.mockReset()
})

describe('the commissioner health fact', () => {
  it('is addressed per (commissioner, league) — never per league alone', () => {
    expect(commissionerHealthSource.level).toBe('user')
    expect(commissionerHealthSource.scopeKey({ userId: 'u1', leagueId: 'L1' })).not.toBe(
      commissionerHealthSource.scopeKey({ userId: 'u2', leagueId: 'L1' }),
    )
  })

  it('serves a fresh stored snapshot without rebuilding, and rebuilds once it expires', async () => {
    let t = 1_000_000
    const { store } = memoryStore(() => t)
    h.build.mockImplementation(async (userId: string) => [snap('L1', `team-of-${userId}`)])
    const os = createCommissionerOsLoaders({ store })
    expect(await os.loadHealthSnapshot({ userId: 'u1', leagueId: 'L1' })).toMatchObject({ viewerTeam: 'team-of-u1' })
    expect(await os.loadHealthSnapshot({ userId: 'u1', leagueId: 'L1' })).toMatchObject({ viewerTeam: 'team-of-u1' })
    expect(h.build).toHaveBeenCalledTimes(1)
    // A co-commissioner gets their own build, not the first one's.
    expect(await os.loadHealthSnapshot({ userId: 'u2', leagueId: 'L1' })).toMatchObject({ viewerTeam: 'team-of-u2' })
    expect(h.build).toHaveBeenCalledTimes(2)
    t += COMMISSIONER_HEALTH_TTL_MS + 1
    await os.loadHealthSnapshot({ userId: 'u1', leagueId: 'L1' })
    expect(h.build).toHaveBeenCalledTimes(3)
  })

  it('a build that throws, or finds no snapshot for the league, is null', async () => {
    const { store } = memoryStore(() => 0)
    const os = createCommissionerOsLoaders({ store })
    h.build.mockRejectedValue(new Error('down'))
    expect(await os.loadHealthSnapshot({ userId: 'u1', leagueId: 'L1' })).toBeNull()
    h.build.mockResolvedValue([snap('OTHER', 'x')])
    expect(await os.loadHealthSnapshot({ userId: 'u1', leagueId: 'L1' })).toBeNull()
  })
})

describe('the Chimmy slice reads through it', () => {
  it('proves access first and reads nothing for someone who is not a commissioner', async () => {
    const { loadCommissionerHealthDecisionSlice } = await import('@/lib/decision-os/grounding/decisionBridge')
    h.assert.mockResolvedValue({ ok: false })
    const out = await loadCommissionerHealthDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(out.present).toBe(false)
    expect(h.build).not.toHaveBeenCalled()
  })

  it('builds the hub’s own snapshot with dynasty signals for the proven commissioner', async () => {
    const { loadCommissionerHealthDecisionSlice } = await import('@/lib/decision-os/grounding/decisionBridge')
    h.assert.mockResolvedValue({ ok: true })
    h.build.mockResolvedValue([snap('L1', 'mine')])
    h.run.mockResolvedValue({ decision: null })
    await loadCommissionerHealthDecisionSlice({ userId: 'u1', leagueId: 'L1' })
    expect(h.assert.mock.invocationCallOrder[0]).toBeLessThan(h.build.mock.invocationCallOrder[0]!)
    expect(h.build).toHaveBeenCalledWith('u1', [expect.objectContaining({ id: 'L1', isCommissioner: true })], { dynastySignals: true })
  })
})
