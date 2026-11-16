// @vitest-environment node
/**
 * Rivalry week (lib/schedule-runtime/rivalryWeek.ts, rivalryWeekService.ts, 2026-11-15): pairs come from the league's
 * rivalry records, strongest first; only an unstarted regular-season week changes; a league with no history is told so.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  season: vi.fn(),
  records: vi.fn(),
  links: vi.fn(),
  deleteMany: vi.fn(async () => ({ count: 5 })),
  createMany: vi.fn(async () => ({ count: 5 })),
  log: vi.fn(async () => ({ id: 'a' })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findUnique: h.season },
    rivalryRecord: { findMany: h.records },
    roster: { findMany: h.links },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ redraftMatchup: { deleteMany: h.deleteMany, createMany: h.createMany } })),
  },
}))
vi.mock('@/server/services/auditService', () => ({ logAction: h.log }))
vi.mock('@/lib/rivalry-engine/rivalryBoard', () => ({
  getRivalryBoard: async () => ({ rows: [{ id: 'rec-AB', chips: [{ label: '6 H2H MEETINGS' }, { label: '3 CLOSE GAMES' }], context: 'Aces holds a 4-2 edge' }] }),
}))

import { pairRivalryWeek } from '@/lib/schedule-runtime/rivalryWeek'
import { applyRivalryWeek, previewRivalryWeek } from '@/lib/schedule-runtime/rivalryWeekService'

describe('pairing', () => {
  it('strongest rivalry first, then the strongest among the teams left; the rest pair in order, odd gets the bye', () => {
    const pairs = pairRivalryWeek(['A', 'B', 'C', 'D', 'E'], [
      { a: 'A', b: 'B', score: 80 },
      { a: 'B', b: 'C', score: 90 },
      { a: 'A', b: 'D', score: 40 },
    ])
    expect(pairs).toEqual([
      { home: 'B', away: 'C', rivalry: true, score: 90 },
      { home: 'A', away: 'D', rivalry: true, score: 40 },
      { home: 'E', away: null, rivalry: false, score: null },
    ])
  })
  it('ignores rivalries with a team not in the season, and zero scores', () => {
    expect(pairRivalryWeek(['A', 'B'], [{ a: 'A', b: 'Z', score: 99 }, { a: 'A', b: 'B', score: 0 }])).toEqual([
      { home: 'A', away: 'B', rivalry: false, score: null },
    ])
  })
})

describe('preview and apply', () => {
  const season = (over: Record<string, unknown> = {}) => ({
    id: 's1', leagueId: 'L1', sport: 'NFL', season: 2026, currentWeek: 3, playoffStartWeek: 15, schedule: [],
    rosters: [{ id: 'rrA', teamName: 'Aces', ownerName: 'a' }, { id: 'rrB', teamName: 'Bears', ownerName: 'b' }, { id: 'rrC', teamName: 'Colts', ownerName: 'c' }, { id: 'rrD', teamName: 'Dons', ownerName: 'd' }],
    ...over,
  })
  beforeEach(() => {
    vi.clearAllMocks()
    h.season.mockResolvedValue(season())
    h.links.mockResolvedValue([{ id: 'A', redraftRosterId: 'rrA' }, { id: 'B', redraftRosterId: 'rrB' }, { id: 'C', redraftRosterId: 'rrC' }, { id: 'D', redraftRosterId: 'rrD' }])
    h.records.mockResolvedValue([{ id: 'rec-AB', managerAId: 'A', managerBId: 'B', rivalryScore: 72 }])
  })

  it('previews each rival with the facts behind it, and changes nothing', async () => {
    const out = await previewRivalryWeek({ seasonId: 's1', week: 8 })
    expect(out).toMatchObject({ ok: true, week: 8 })
    const first = (out as { pairs: Array<Record<string, unknown>> }).pairs[0]
    expect(first).toMatchObject({ homeName: 'Aces', awayName: 'Bears', rivalry: true, reasons: ['6 H2H MEETINGS', '3 CLOSE GAMES'], context: 'Aces holds a 4-2 edge' })
    expect(h.deleteMany).not.toHaveBeenCalled()
  })

  it('applies to that week only, and records it for the league', async () => {
    await applyRivalryWeek({ seasonId: 's1', week: 8, actorUserId: 'commish' })
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { seasonId: 's1', week: 8, type: 'regular', isMedianMatchup: false } })
    const rows = (h.createMany.mock.calls[0] as unknown as [{ data: Array<Record<string, unknown>> }])[0].data
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ week: 8, homeRosterId: 'rrA', awayRosterId: 'rrB', status: 'scheduled' })
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'schedule_rivalry_week', metadata: { week: 8, rivalryGames: 1 } }))
  })

  it('a started week, a playoff week, or a league with no rivalry history is refused', async () => {
    expect(await applyRivalryWeek({ seasonId: 's1', week: 2, actorUserId: 'c' })).toMatchObject({ ok: false, code: 'WEEK_STARTED' })
    expect(await applyRivalryWeek({ seasonId: 's1', week: 15, actorUserId: 'c' })).toMatchObject({ ok: false, code: 'NOT_REGULAR_SEASON' })
    h.records.mockResolvedValue([])
    expect(await previewRivalryWeek({ seasonId: 's1', week: 8 })).toMatchObject({ ok: false, code: 'NO_RIVALRIES' })
    expect(h.deleteMany).not.toHaveBeenCalled()
  })
})
