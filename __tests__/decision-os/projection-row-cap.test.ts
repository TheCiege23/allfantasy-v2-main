/**
 * 2026-11-24 re-score: the projection read's row cap truncated silently. A read that comes back at exactly the cap
 * now logs a count-only warning — sport, season, week and counts, never a player id or name. The cap is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ findMany: vi.fn(), aggregate: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { aFProjectionSnapshot: { findMany: h.findMany, aggregate: h.aggregate } } }))

import { loadCanonicalProjectionFacts, PROJECTION_FACTS_DEFAULT_LIMIT } from '@/lib/decision-os/projection/facts'

const row = (i: number) => ({
  playerId: `p${i}`, playerName: `Player Secretname ${i}`, sport: 'NBA', position: 'G', season: 2026, week: 5,
  afProjection: 10, adjustmentFactors: null, confidenceLevel: 'medium', computedAt: new Date('2026-11-24T00:00:00Z'), validUntil: null,
})

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  h.findMany.mockReset()
  h.aggregate.mockReset()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

describe('the projection row cap', () => {
  it('the default cap is still 2000 and is what the read asks for', async () => {
    h.findMany.mockResolvedValue([])
    await loadCanonicalProjectionFacts({ sport: 'NBA', season: 2026, week: 5 })
    expect(PROJECTION_FACTS_DEFAULT_LIMIT).toBe(2000)
    expect(h.findMany.mock.calls[0]![0].take).toBe(2000)
  })

  it('a full page warns once, with counts only', async () => {
    h.findMany.mockResolvedValue([row(1), row(2), row(3)])
    const out = await loadCanonicalProjectionFacts({ sport: 'nba', season: 2026, week: 5, limit: 3 })
    expect(out).toHaveLength(3)
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = String(warn.mock.calls[0]![0])
    expect(msg).toContain('row cap hit')
    expect(msg).toContain('take=3')
    expect(msg).toContain('sport=NBA')
    expect(msg).not.toContain('Secretname')
    expect(msg).not.toContain('p1')
  })

  it('a short page does not warn', async () => {
    h.findMany.mockResolvedValue([row(1), row(2)])
    await loadCanonicalProjectionFacts({ sport: 'NBA', season: 2026, week: 5, limit: 3 })
    expect(warn).not.toHaveBeenCalled()
  })
})
