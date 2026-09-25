// @vitest-environment node
/**
 * 🛑 THE /core/matchup SCOREBOARD COUNTS AN OUT STARTER AT 0, NOT HIS FULL PROJECTION.
 *
 * `loadSideProjections` read no injury data, so the board cells, the projected final and the win
 * probability all counted a ruled-out starter at full value — while My Team, pricing the same
 * player, showed 0.0. It now reads status through the same helper and rule My Team uses
 * (`readInjuryStatusById` + `isRuledOut`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  settings: { scoring_settings: { rec: 1 } } as unknown,
  platform: 'sleeper',
  injuries: [] as Array<{ playerName: string; status: string }>,
  crosswalk: new Map<string, string>(),
}))

/** Catches projected; the league scores a point a catch, so this IS each player's number. */
const RECEPTIONS: Record<string, number> = { a: 10, b: 6, c: 8, d: 12 }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: {
      findMany: vi.fn(async () => [
        { platformUserId: 'you', playerData: { starters: ['a', 'b'] } },
        { platformUserId: 'them', playerData: { starters: ['c', 'd'] } },
      ]),
    },
    league: { findUnique: vi.fn(async () => ({ settings: db.settings, platform: db.platform, sport: 'NFL' })) },
    fantasyProjection: {
      findMany: vi.fn(async ({ where }: { where: { playerId: { in: string[] } } }) =>
        where.playerId.in
          .filter((id) => id in RECEPTIONS)
          .map((playerId) => ({ playerId, stats: { stats: { rec: RECEPTIONS[playerId] } } })),
      ),
    },
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { sleeperId: { in: string[] } } }) =>
        where.sleeperId.in.map((sleeperId) => ({ sleeperId, name: `Player ${sleeperId}` })),
      ),
    },
    sportsInjury: {
      // Already ordered newest first, as the real query asks for.
      findMany: vi.fn(async ({ where }: { where: { playerName: { in: string[] } } }) =>
        db.injuries.filter((i) => where.playerName.in.includes(i.playerName)),
      ),
    },
  },
}))

vi.mock('@/lib/core-app/rosterIdCrosswalk', () => ({
  crosswalkToSleeperIds: vi.fn(async () => db.crosswalk),
}))

import { loadSideProjections } from '@/lib/core-app/matchupProjections'

const load = () =>
  loadSideProjections({ leagueId: 'lg', season: 2026, week: 3, yourPlatformUserId: 'you', opponentPlatformUserId: 'them' })

beforeEach(() => {
  db.settings = { scoring_settings: { rec: 1 } }
  db.platform = 'sleeper'
  db.injuries = []
  db.crosswalk = new Map()
})

describe('Matchup scoreboard — a ruled-out starter', () => {
  it('control: with no injuries, every starter counts in full', async () => {
    const sides = await load()
    expect(sides?.you.projectedRemaining).toBe(16)
    expect(sides?.opponent.projectedRemaining).toBe(20)
  })

  it('🛑 an OUT starter is 0 in the cell, the total and the model — on both sides', async () => {
    db.injuries = [
      { playerName: 'Player a', status: 'Out' },
      { playerName: 'Player d', status: 'Injured Reserve' },
    ]
    const sides = await load()

    expect(sides?.you.lineup).toEqual([{ playerId: 'a', projected: 0 }, { playerId: 'b', projected: 6 }])
    expect(sides?.you.projectedRemaining).toBe(6)
    expect(sides?.opponent.projectedRemaining).toBe(8)
    // Still priced — a known 0, not an unknown — so it is in the model and not a coverage gap.
    expect(sides?.you.starters.find((s) => s.playerId === 'a')?.projectedPoints).toBe(0)
    expect(sides?.you.unprojected).toBe(0)
  })

  it('questionable is not out, and the NEWEST status wins', async () => {
    db.injuries = [
      { playerName: 'Player a', status: 'Questionable' },
      { playerName: 'Player b', status: 'Active' }, // newest
      { playerName: 'Player b', status: 'Out' }, // older
    ]
    const sides = await load()
    expect(sides?.you.projectedRemaining).toBe(16)
  })

  it('reads the status through the crosswalk, and keeps the roster’s own id on the board', async () => {
    db.platform = 'espn'
    db.crosswalk = new Map([['espn-a', 'a']])
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.roster.findMany).mockResolvedValueOnce([
      { platformUserId: 'you', playerData: { starters: ['espn-a', 'b'] } },
      { platformUserId: 'them', playerData: { starters: ['c', 'd'] } },
    ] as never)
    db.injuries = [{ playerName: 'Player a', status: 'OUT' }]
    const sides = await load()
    expect(sides?.you.lineup[0]).toEqual({ playerId: 'espn-a', projected: 0 })
  })

  it('without real rules nothing is priced — an OUT starter included', async () => {
    db.settings = null
    db.injuries = [{ playerName: 'Player a', status: 'Out' }]
    const sides = await load()
    expect(sides?.leagueScoring.available).toBe(false)
    expect(sides?.you.starters).toEqual([])
  })
})
