/**
 * A projection read is ONE week, always (Projection OS, 2026-11-16). The writer stores a week-less per-game season
 * baseline AND a row for the current week; an unfiltered read returned both, so Chimmy could quote either as
 * "this week". With no week named, the read takes the latest week that has weekly rows, else the baseline alone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ findMany: vi.fn(), aggregate: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { aFProjectionSnapshot: { findMany: h.findMany, aggregate: h.aggregate } } }))

import { currentProjectionWeek, loadCanonicalProjectionFacts } from '@/lib/decision-os/projection/facts'

beforeEach(() => {
  h.findMany.mockReset()
  h.findMany.mockResolvedValue([])
  h.aggregate.mockReset()
})

describe('loadProjectionFacts reads one week', () => {
  it('with no week named, reads exactly the latest week that has weekly rows', async () => {
    h.aggregate.mockResolvedValue({ _max: { week: 11 } })
    await loadCanonicalProjectionFacts({ sport: 'nfl', season: 2026, week: null })
    expect(h.aggregate).toHaveBeenCalledWith({ where: { sport: 'NFL', season: 2026, week: { not: null } }, _max: { week: true } })
    expect(h.findMany.mock.calls[0]![0].where).toEqual({ sport: 'NFL', season: 2026, week: 11 })
  })

  it('with no weekly rows at all, reads only the week-less baseline — never both', async () => {
    h.aggregate.mockResolvedValue({ _max: { week: null } })
    await loadCanonicalProjectionFacts({ sport: 'NFL', season: 2026 })
    expect(h.findMany.mock.calls[0]![0].where).toEqual({ sport: 'NFL', season: 2026, week: null })
  })

  it('a named week is read as named, with no lookup', async () => {
    await loadCanonicalProjectionFacts({ sport: 'NFL', season: 2026, week: 4 })
    expect(h.aggregate).not.toHaveBeenCalled()
    expect(h.findMany.mock.calls[0]![0].where).toEqual({ sport: 'NFL', season: 2026, week: 4 })
  })

  it('an unreadable week lookup reads the baseline, labelled as such downstream', async () => {
    h.aggregate.mockRejectedValue(new Error('down'))
    expect(await currentProjectionWeek('NFL', 2026)).toBeNull()
  })
})
