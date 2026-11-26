import { beforeEach, describe, expect, it, vi } from 'vitest'

/** FAAB refills: paid once the league reaches the week, exactly once per refill (2026-11-26). */

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  rosterUpdate: vi.fn(async () => ({ count: 4 })),
  redraftUpdate: vi.fn(async () => ({ count: 4 })),
  leagueUpdate: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => {
    h.settings = data.settings
    return {}
  }),
}))

vi.mock('@/lib/prisma', () => {
  const tx = {
    $queryRaw: async () => [],
    league: { findUnique: async () => ({ settings: h.settings }), update: h.leagueUpdate },
    roster: { updateMany: h.rosterUpdate },
    redraftSeason: { findFirst: async () => ({ id: 's1' }) },
    redraftRoster: { updateMany: h.redraftUpdate },
  }
  return { prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }
})

import { applyDueFaabRefills } from '@/lib/waivers/faabRefillService'
import { dueFaabRefills, defaultWaiverExtras } from '@/lib/waivers/waiverExtras'

const extras = (refills: Array<{ week: number; amount: number }>) => ({ ...defaultWaiverExtras(), faabRefills: refills })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FAAB refills', () => {
  it('pays every team at the refill week and records it', async () => {
    h.settings = { current_week: 9, af_waiver_extras: extras([{ week: 9, amount: 25 }]) }
    expect(await applyDueFaabRefills('L')).toBe(25)
    expect(h.rosterUpdate).toHaveBeenCalledWith({ where: { leagueId: 'L', faabRemaining: { not: null } }, data: { faabRemaining: { increment: 25 } } })
    expect(h.redraftUpdate).toHaveBeenCalledWith({ where: { leagueId: 'L', seasonId: 's1' }, data: { faabBalance: { increment: 25 } } })
    expect(h.settings.af_faab_refills_applied).toEqual([9])
  })

  it('never pays the same refill twice, and waits for its week', async () => {
    h.settings = { current_week: 9, af_waiver_extras: extras([{ week: 9, amount: 25 }]), af_faab_refills_applied: [9] }
    expect(await applyDueFaabRefills('L')).toBe(0)
    h.settings = { current_week: 8, af_waiver_extras: extras([{ week: 9, amount: 25 }]) }
    expect(await applyDueFaabRefills('L')).toBe(0)
    expect(h.rosterUpdate).not.toHaveBeenCalled()
  })

  it('a league that skipped past the week still gets it (both refills owed land together)', () => {
    expect(dueFaabRefills(extras([{ week: 6, amount: 10 }, { week: 9, amount: 25 }]), 10, [])).toHaveLength(2)
  })
})
