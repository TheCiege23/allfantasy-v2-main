import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `SportsPlayerRecord.injuryStatus` — read by league rosters, the draft room, value snapshots,
 * trending and Chimmy.
 *
 * 🛑 Measured 2026-10-11 against live SportsInjury: 295 players carried a "Questionable" no feed
 * reported any more and 84 read Questionable while ESPN had them Active, because the column came from
 * `injury_reports` (which can never say "cleared"); 10,283 carried Rolling Insights' roster code
 * "INACT" as if it were an injury, Malik Nabers among them.
 */
const findMany = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsInjury: { findMany: (...a: unknown[]) => findMany(...a) } } }))

const H = 3_600_000
const live = (over: Record<string, unknown>) => ({
  playerName: 'Malik Nabers',
  team: 'New York Giants',
  position: 'WR',
  status: 'Questionable',
  description: 'Limited practice Friday.',
  date: new Date(Date.now() - 30 * H),
  fetchedAt: new Date(Date.now() - H / 2),
  ...over,
})

async function resolver() {
  const { loadCurrentInjuryResolver } = await import('@/lib/workers/sports-data-importer')
  return loadCurrentInjuryResolver('NFL')
}

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([])
})

describe('the stored injury column', () => {
  it('asks only for rows a live feed still carries', async () => {
    await resolver()
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain('expiresAt')
  })

  it("a roster code is not an injury: RI's INACT and Sleeper's Inactive store nothing", async () => {
    const of = await resolver()
    expect(of({ name: 'Malik Nabers', team: 'NYG', position: 'WR', status: 'INACT', source: 'rolling_insights' }).status).toBeNull()
    expect(of({ name: 'Reggie Bush', team: 'FA', position: 'RB', status: 'Inactive', source: 'sleeper' }).status).toBeNull()
  })

  it('a real roster designation survives when no feed reports him', async () => {
    const of = await resolver()
    expect(of({ name: 'Tank Dell', team: 'HOU', position: 'WR', status: 'Injured Reserve', source: 'sleeper' }).status).toBe('IR')
    expect(of({ name: 'X', team: 'HOU', position: 'WR', status: 'Physically Unable to Perform', source: 'sleeper' }).status).toBe('PUP')
  })

  it("the live feed's word wins, with its note", async () => {
    findMany.mockResolvedValue([live({ status: 'Out', description: 'Ankle; ruled out Friday.' })])
    const of = await resolver()
    expect(of({ name: 'Malik Nabers', team: 'NYG', position: 'WR', status: 'INACT', source: 'rolling_insights' })).toEqual({
      status: 'Out',
      notes: 'Ankle; ruled out Friday.',
    })
  })

  it('a feed saying he was cleared stores no designation', async () => {
    findMany.mockResolvedValue([live({ status: 'Active', description: 'Cleared.' })])
    const of = await resolver()
    expect(of({ name: 'Malik Nabers', team: 'NYG', position: 'WR', status: 'Injured Reserve', source: 'sleeper' })).toEqual({ status: null, notes: null })
  })

  it("a namesake's row on another club is not his", async () => {
    findMany.mockResolvedValue([live({ playerName: 'Justin Jefferson', team: 'Cleveland Browns', position: 'LB', status: 'Out' })])
    const of = await resolver()
    expect(of({ name: 'Justin Jefferson', team: 'MIN', position: 'WR', status: 'Active', source: 'sleeper' }).status).toBeNull()
  })

  it('a seed invented from an injury report carries no roster status', async () => {
    const of = await resolver()
    expect(of({ name: 'Bryce Baringer, Khalil Jacobs', team: 'NE', position: 'FLEX', status: 'IR', source: 'cached' }).status).toBeNull()
  })

  it('a read failure stores no designation rather than throwing', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    const of = await resolver()
    expect(of({ name: 'Malik Nabers', team: 'NYG', position: 'WR', status: 'INACT', source: 'rolling_insights' }).status).toBeNull()
  })
})
