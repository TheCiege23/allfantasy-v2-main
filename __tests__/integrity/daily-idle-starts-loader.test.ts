import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ kickoffs: vi.fn() }))
vi.mock('@/lib/redraft/lineupLock', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/redraft/lineupLock')>()),
  buildWeekKickoffMap: h.kickoffs,
}))
vi.mock('@/lib/redraft/weekLineupSlots', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/redraft/weekLineupSlots')>()),
  loadWeekLineups: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/season-week/dailySportSeasonStarts', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/season-week/dailySportSeasonStarts')>()),
  resolveDailySportWeekWindow: () => ({ start: new Date('2026-11-02T00:00:00Z'), end: new Date('2026-11-04T00:00:00Z') }),
}))

import { loadDailyIdleStarts } from '@/lib/integrity/dailyIdleStarts'
import { normalizeLockTeam } from '@/lib/redraft/lineupLock'

/**
 * The loader joins roster teams to the schedule with the SAME key the lineup lock uses
 * (`lockTeamLookupKeys` / `normalizeLockTeam`), so the scan and the lock agree on who had a game.
 */
describe('loadDailyIdleStarts', () => {
  it("matches a roster team to the schedule's day map through the lock's own team key", async () => {
    // The Celtics play Monday only; the Knicks play both days.
    h.kickoffs.mockResolvedValue({
      byTeam: new Map(),
      firstKickoff: null,
      warnings: [],
      byTeamDay: new Map([
        [normalizeLockTeam('NBA', 'Boston Celtics'), new Map([['2026-11-02', new Date()]])],
        [normalizeLockTeam('NBA', 'New York Knicks'), new Map([['2026-11-02', new Date()], ['2026-11-03', new Date()]])],
      ]),
    })
    const players = [
      { rosterId: 'r1', playerId: 'idle', playerName: 'Idle Guard', position: 'PG', slotType: 'PG', team: 'Boston Celtics', injuryStatus: null, addedAt: new Date('2026-10-01'), droppedAt: null },
      { rosterId: 'r1', playerId: 'bench', playerName: 'Bench Guard', position: 'PG', slotType: 'BN', team: 'New York Knicks', injuryStatus: null, addedAt: new Date('2026-10-01'), droppedAt: null },
    ]
    const db = {
      redraftRosterPlayer: { findMany: vi.fn(async () => players) },
      redraftDailyLineup: { findMany: vi.fn(async () => []) },
    }
    const out = await loadDailyIdleStarts(db as never, { sport: 'nba', season: 2026, week: 3, redraftRosterIds: ['r1'] })
    expect(h.kickoffs).toHaveBeenCalledWith(db, { sport: 'NBA', season: 2026, week: 3 })
    expect(out?.get('r1')?.idleStarts).toEqual([
      { day: '2026-11-03', slot: 'PG', playerId: 'idle', playerName: 'Idle Guard', benchPlayerId: 'bench', benchPlayerName: 'Bench Guard' },
    ])
    // Roster rows dropped during the week are read too, as the scorer reads them.
    expect(db.redraftRosterPlayer.findMany.mock.calls[0]![0].where).toMatchObject({ OR: [{ droppedAt: null }, { droppedAt: { gte: new Date('2026-11-02T00:00:00Z') } }] })
  })
})
