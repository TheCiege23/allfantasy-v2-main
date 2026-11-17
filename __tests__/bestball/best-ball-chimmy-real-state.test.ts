/**
 * @vitest-environment node
 *
 * Audit 2026-11-06, row "Chimmy reads real state". Two reads Chimmy and start/sit make for a best ball
 * league used something other than what production scores:
 *  - start/sit's slot analysis looked up the sport's `standard` roster template, not the league's seats;
 *  - the War Room (Chimmy's best ball context) read score history only from `weeklyScore`, which native
 *    scoring never writes — a league we host had no history at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: null as unknown,
  lpws: vi.fn(async () => [] as unknown[]),
  ws: vi.fn(async () => [] as unknown[]),
  template: vi.fn(async () => ({
    templateId: 'standard-template',
    slots: [{ slotName: 'UTIL', allowedPositions: [], starterCount: 10, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 0 }],
  })),
}))

vi.mock('@/lib/prisma', () => {
  const empty = new Proxy(
    {},
    { get: (_t, method: string) => async () => (method === 'findMany' ? [] : method === 'findUnique' ? m.league : null) },
  )
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, model: string) =>
          model === 'leaguePlayerWeeklyScore' ? { findMany: m.lpws } : model === 'weeklyScore' ? { findMany: m.ws } : empty,
      },
    ),
  }
})
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: m.template }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true, isCommissioner: false })) }))
vi.mock('@/lib/redraft-war-room/redraftFreeAgentPool', () => ({ fetchAdpByPlayerKey: vi.fn(async () => new Map()) }))
vi.mock('@/lib/redraft-war-room/redraftInjuryNews', () => ({
  fetchRedraftInjuryNews: vi.fn(async () => ({ injuryByName: new Map(), newsCount: 0, injuriesAsOf: null })),
  injuryNameKey: (n: string) => String(n ?? '').trim().toLowerCase(),
}))

import { analyzeStarterSlots } from '@/lib/ai-tools-start-sit/lineupSlots'
import { buildBestBallWarRoomContext, loadWarRoomWeeklyScores } from '@/lib/best-ball-war-room/bestBallWarRoomContext'
import { bestBallDisplaySlots } from '@/lib/bestball/productionLineup'

const players = [
  { playerId: 'p1', name: 'Guard One', position: 'PG', effectiveProjection: 30 },
  { playerId: 'p2', name: 'Big One', position: 'C', effectiveProjection: 25 },
]
// A commissioner-shaped NBA best ball roster: 5 seats, in the shape league bootstrap writes.
const leagueSettings = { roster: { config: { sections: [{ key: 'primary', label: 'Primary', slots: { PG: 1, C: 1, UTIL: 3 } }] } } }

beforeEach(() => {
  m.template.mockClear()
  m.lpws.mockReset().mockResolvedValue([])
  m.ws.mockReset().mockResolvedValue([])
  m.league = null
})

describe('start/sit slot analysis for a best ball league', () => {
  it("shows the league's own seats, the ones production scores", async () => {
    const res = await analyzeStarterSlots({ leagueId: 'L', leagueSport: 'NBA' as never, sport: 'NBA' as never, players, bestBallSettings: leagueSettings })
    const expected = bestBallDisplaySlots('NBA', leagueSettings).reduce((n, s) => n + s.count, 0)
    expect(expected).toBe(5)
    expect(res.slots).toHaveLength(5)
    expect(res.slots.map((s) => s.slotName)).toEqual(['PG', 'C', 'UTIL 1', 'UTIL 2', 'UTIL 3'])
    expect(res.slots[0].candidates.map((c) => c.playerId)).toEqual(['p1'])
    expect(m.template).not.toHaveBeenCalled()
  })

  it('[control] a league that is not best ball still reads its roster template', async () => {
    const res = await analyzeStarterSlots({ leagueId: 'L', leagueSport: 'NBA' as never, sport: 'NBA' as never, players })
    expect(m.template).toHaveBeenCalledWith('NBA', 'standard', 'L')
    expect(res.slots).toHaveLength(10)
  })
})

describe("the War Room's score history (Chimmy's best ball context)", () => {
  it('a native league reads the per-player points native scoring writes', async () => {
    m.lpws.mockResolvedValue([{ playerId: 'p1', points: 40, isStarter: true, updatedAt: new Date('2026-11-01') }])
    const rows = await loadWarRoomWeeklyScores({ leagueId: 'L', season: 2026, platform: null, playerIds: ['p1'] })
    expect(rows).toEqual([{ playerId: 'p1', points: 40, isStarter: true, createdAt: new Date('2026-11-01') }])
    expect(m.lpws).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'L', seasonYear: 2026, source: 'allfantasy', playerId: { in: ['p1'] } } }),
    )
    expect(m.ws).not.toHaveBeenCalled()
  })

  it('[control] an imported league keeps the table its processor writes', async () => {
    await loadWarRoomWeeklyScores({ leagueId: 'L', season: 2026, platform: 'sleeper', playerIds: ['p1'] })
    expect(m.ws).toHaveBeenCalled()
    expect(m.lpws).not.toHaveBeenCalled()
  })

  it('end to end: a native league with scored weeks reports real spike weeks, not "no weekly scores"', async () => {
    m.league = {
      sport: 'NFL', season: 2026, leagueSize: 2, bestBallMode: true, platform: 'allfantasy', settings: {},
      rosters: [{ id: 'r1', platformUserId: 'u', playerData: { players: [{ id: 'p1', name: 'Runner', position: 'RB' }] } }],
      teams: [],
    }
    m.lpws.mockResolvedValue([
      { playerId: 'p1', points: 10, isStarter: true, updatedAt: new Date('2026-10-01') },
      { playerId: 'p1', points: 30, isStarter: false, updatedAt: new Date('2026-10-08') },
    ])
    const res = await buildBestBallWarRoomContext({ leagueId: 'L', userId: 'u' })
    if (!res.ok) throw new Error(res.error)
    expect(res.context.availability.weeklyScores).toBe('available')
    const p1 = res.context.teams[0].players[0]
    expect(p1).toMatchObject({ avgPoints: 20, maxPoints: 30, startedWeeks: 1 })
  })
})
