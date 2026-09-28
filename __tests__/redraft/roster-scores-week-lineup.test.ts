/**
 * The per-player breakdown behind a week's matchup score must list the lineup set FOR THAT WEEK.
 *
 * `slotType` is current state: once a manager sets week 4, a request for week 3's breakdown read
 * week 4's starters and stopped adding up to week 3's matchup total. The route now picks starters
 * through `lib/redraft/weekLineupSlots.ts`, the same reader the matchup score uses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyArgs = Record<string, any>

const db = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
  roster: { findMany: vi.fn() },
  afRosterLineupAssignment: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true })) }))
vi.mock('@/lib/redraft/scoringEngine', async (importOriginal) => ({
  // The real starter rule; only the points maths is stubbed.
  isScoringStarterSlot: (await importOriginal<typeof import('@/lib/redraft/scoringEngine')>()).isScoringStarterSlot,
  calculateScoreFromSportConfig: vi.fn(async (_l: string, playerId: string) => ({ q1: 10, q2: 20, w1: 5 })[playerId] ?? 0),
}))

import { GET } from '@/app/api/leagues/[leagueId]/scoring/roster-scores/route'

/** Current slots, as a week-4 save left them: q1 starts, q2 sits. */
const ROSTER = [
  { playerId: 'q1', playerName: 'Q One', position: 'QB', slotType: 'QB', sport: 'NFL' },
  { playerId: 'q2', playerName: 'Q Two', position: 'QB', slotType: 'bench', sport: 'NFL' },
  { playerId: 'w1', playerName: 'W One', position: 'WR', slotType: 'WR', sport: 'NFL' },
]
const WEEK3 = [
  { rosterId: 'af-1', section: 'starters', playerId: 'q2', week: 3 },
  { rosterId: 'af-1', section: 'starters', playerId: 'w1', week: 3 },
  { rosterId: 'af-1', section: 'bench', playerId: 'q1', week: 3 },
]

function arrange(assignments: typeof WEEK3) {
  db.redraftSeason.findFirst.mockResolvedValue({ currentWeek: 4, season: 2026 })
  db.redraftRosterPlayer.findMany.mockResolvedValue(ROSTER)
  db.playerWeeklyScore.findUnique.mockResolvedValue({ stats: { any: 1 }, isFinalized: true })
  db.roster.findMany.mockResolvedValue([{ id: 'af-1', redraftRosterId: 'rr-1', league: { platform: 'manual' } }])
  db.afRosterLineupAssignment.findMany.mockImplementation(async ({ where }: AnyArgs) =>
    assignments.filter((a) => where.rosterId.in.includes(a.rosterId) && where.season === 2026 && a.week === where.week),
  )
}

async function breakdown(week: number) {
  const req = { nextUrl: new URL(`https://x.test/api/leagues/L1/scoring/roster-scores?rosterId=rr-1&week=${week}&season=2026`) }
  const res = await GET(req as any, { params: Promise.resolve({ leagueId: 'L1' }) })
  return (await res.json()) as { players: Array<{ playerName: string; slotType: string; pts: number }> }
}

beforeEach(() => vi.clearAllMocks())

describe('roster-scores lists the lineup set for the requested week', () => {
  it('week 3 shows week 3\'s starters, with the slots they held that week', async () => {
    arrange(WEEK3)
    const body = await breakdown(3)
    expect(body.players.map((p) => [p.playerName, p.slotType, p.pts])).toEqual([
      ['Q Two', 'QB', 20],
      ['W One', 'WR', 5],
    ])
    expect(db.afRosterLineupAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { rosterId: { in: ['af-1'] }, season: 2026, week: 3 } }),
    )
  })

  it('a week with no saved lineup falls back to the current slots', async () => {
    arrange(WEEK3)
    const body = await breakdown(4)
    expect(body.players.map((p) => p.playerName)).toEqual(['Q One', 'W One'])
  })
})
