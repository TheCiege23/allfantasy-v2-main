// @vitest-environment node
/**
 * 🛑 THE BYE SLATE WAS HARDCODED TO 2025 AND USED IN 2026.
 * `lib/waiver-engine/team-needs.ts` carried `NFL_BYE_WEEKS_2025` and read it for every bye-week
 * cluster, so waiver advice warned about weeks that were not byes this season and stayed silent on
 * the ones that were. The slate now comes from the schedule we hold.
 *
 * ⚠ A BYE IS AN ABSENCE, AND SO IS A MISSING FIXTURE. `lib/core-app/byeStatus.ts` is the one rule in
 * this repo that separates them, so the map asks it rather than deriving a second opinion: a week
 * only yields byes when its slate has the shape of a real one. A week it cannot judge yields
 * nothing, and a club with no answer produces no cluster — a missing warning, never a wrong one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany: (a: unknown) => findMany(a) } } }))

const { resolveByeWeekMap } = await import('@/lib/core-app/byeWeekMap')
const { computeTeamNeeds } = await import('@/lib/waiver-engine/team-needs')

const CLUBS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND',
  'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA',
  'SF', 'TB', 'TEN', 'WAS',
]

/**
 * A week's fixtures covering exactly the clubs NOT on bye.
 *
 * ⚠ An odd number of playing clubs still has to appear in a game, so the last one is paired with a
 * club that already played — which is what a duplicate provider row looks like. Dropping it instead
 * would quietly change how many clubs look absent, and that count is the whole judgement.
 */
function slate(week: number, onBye: string[], over: Partial<{ unresolvedName: string }> = {}) {
  const playing = CLUBS.filter((c) => !onBye.includes(c))
  const rows: Array<Record<string, unknown>> = []
  const at = new Date(`2026-10-0${(week % 9) + 1}T17:00:00Z`)
  for (let i = 0; i < playing.length; i += 2) {
    const home = playing[i]
    const away = playing[i + 1] ?? playing[0]
    rows.push({ week, homeTeam: home, awayTeam: away, startTime: at, seasonType: 'regular', venue: null })
  }
  if (over.unresolvedName) {
    rows.push({ week, homeTeam: over.unresolvedName, awayTeam: over.unresolvedName, startTime: at, seasonType: 'regular', venue: null })
  }
  return rows
}

beforeEach(() => {
  findMany.mockReset()
  findMany.mockResolvedValue([])
})

describe('resolveByeWeekMap', () => {
  it('🛑 reads this season’s byes from the schedule, not from a table', async () => {
    findMany.mockResolvedValue([...slate(6, ['KC', 'MIA']), ...slate(9, ['SF', 'PIT', 'CLE', 'MIN'])])
    const map = await resolveByeWeekMap(2026)
    expect(map).toEqual({ KC: 6, MIA: 6, SF: 9, PIT: 9, CLE: 9, MIN: 9 })
  })

  it('asks the schedule for THIS season and sport, and excludes preseason', async () => {
    await resolveByeWeekMap(2026)
    const where = findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ season: 2026, sport: { equals: 'NFL', mode: 'insensitive' } })
    expect(where.week).toEqual({ gte: 5, lte: 14 })
    expect(where.NOT).toEqual({ seasonType: 'pre' })
  })

  it('🛑 refuses a week it cannot judge rather than manufacturing byes', async () => {
    /* One absent club is not a bye slate — byes come in pairs; this is a gap in what we hold. */
    findMany.mockResolvedValue(slate(7, ['DAL']))
    expect(await resolveByeWeekMap(2026)).toEqual({})
  })

  it('🛑 refuses a week carrying a club spelling it could not fold', async () => {
    /* An unresolved name looks exactly like an absent club, so the whole week is unjudgeable. */
    findMany.mockResolvedValue(slate(6, ['KC', 'MIA'], { unresolvedName: 'Kansas City Chefs' }))
    expect(await resolveByeWeekMap(2026)).toEqual({})
  })

  it('refuses a week with too many clubs absent to be a bye slate', async () => {
    findMany.mockResolvedValue(slate(10, ['KC', 'MIA', 'SF', 'PIT', 'CLE', 'MIN', 'DAL', 'HOU']))
    /* Eight absent is beyond any real bye week, so the absence is not read as a bye. */
    expect(await resolveByeWeekMap(2026)).toEqual({})
  })

  it('a week with no fixtures at all contributes nothing', async () => {
    findMany.mockResolvedValue([])
    expect(await resolveByeWeekMap(2026)).toEqual({})
  })

  it('the earliest judgeable week wins when a club looks absent twice', async () => {
    findMany.mockResolvedValue([...slate(6, ['KC', 'MIA']), ...slate(11, ['KC', 'MIA'])])
    const map = await resolveByeWeekMap(2026)
    expect(map.KC).toBe(6)
  })

  it('a failed read is an empty map, not a crash', async () => {
    findMany.mockRejectedValue(new Error('down'))
    expect(await resolveByeWeekMap(2026)).toEqual({})
  })
})

describe('computeTeamNeeds — bye clusters come from the injected slate', () => {
  const starter = (name: string, position: string, team: string) => ({
    id: name,
    name,
    position,
    team,
    slot: 'starter' as const,
    age: 26,
    value: 2000,
  })

  const roster = [
    starter('A', 'RB', 'KC'),
    starter('B', 'WR', 'KC'),
    starter('C', 'TE', 'MIA'),
    starter('D', 'QB', 'BUF'),
  ]
  const slots = ['QB', 'RB', 'WR', 'TE', 'BN']

  it('clusters the starters whose clubs share a bye, from the map it is given', async () => {
    const needs = computeTeamNeeds(roster, slots, [{ players: roster }], 3, { KC: 6, MIA: 9, BUF: 12 })
    expect(needs.byeWeekClusters).toHaveLength(1)
    expect(needs.byeWeekClusters[0]).toMatchObject({ week: 6, positionsAffected: ['RB', 'WR'] })
    expect(needs.byeWeekClusters[0].playersOut).toEqual(['A', 'B'])
  })

  it('🛑 an empty slate produces NO cluster — a missing warning, never last year’s', async () => {
    expect(computeTeamNeeds(roster, slots, [{ players: roster }], 3, {}).byeWeekClusters).toEqual([])
    /* And the same when the argument is left off entirely. */
    expect(computeTeamNeeds(roster, slots, [{ players: roster }], 3).byeWeekClusters).toEqual([])
  })

  it('a bye already played is not a warning', async () => {
    expect(computeTeamNeeds(roster, slots, [{ players: roster }], 8, { KC: 6, MIA: 9 }).byeWeekClusters).toEqual([])
  })

  it('folds the club spelling on the roster before looking it up', async () => {
    const lower = [starter('A', 'RB', 'kc'), starter('B', 'WR', 'kc')]
    const needs = computeTeamNeeds(lower, slots, [{ players: lower }], 3, { KC: 6 })
    expect(needs.byeWeekClusters[0]?.week).toBe(6)
  })
})
