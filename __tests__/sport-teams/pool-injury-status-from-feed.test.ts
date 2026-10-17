// @vitest-environment node
/**
 * 🛑 The league player pool's `injury_status` — the waiver badges and the "injured" filter — was
 * `deriveInjuryStatus(SportsPlayer.status)`. That column is Sleeper's ROSTER status on Sleeper's rows
 * ("Active" for a player who is Out), and on some provider rows an 'out' that `PlayerStatusAggregator`
 * stamped and nothing clears. So the filter missed every Out/Questionable player and kept flagging some
 * who had recovered. It is now the live injury feed's current designation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  players: [] as Array<Record<string, unknown>>,
  feed: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: { findMany: vi.fn(async () => h.players) },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
    sportsInjury: { findMany: vi.fn(async () => h.feed) },
  },
}))

const recent = () => new Date(Date.now() - 2 * 3_600_000)
function player(id: string, name: string, team: string, source: string, status: string | null) {
  return { id, name, position: 'RB', team, teamId: null, status, sleeperId: source === 'sleeper' ? id : null, externalId: `${source}:${id}`, age: 26, imageUrl: null, source }
}
function feedRow(playerName: string, team: string, status: string, date: Date = recent()) {
  return { playerName, status, type: null, description: null, date, week: null, source: 'rolling_insights', fetchedAt: recent(), team, position: 'RB' }
}

beforeEach(() => {
  vi.resetModules() // the pool is memoised in-process; each case builds its own
  h.players = [
    player('s1', 'Saquon Barkley', 'Philadelphia Eagles', 'sleeper', 'Active'),
    player('r1', 'Recovered Back', 'Dallas Cowboys', 'rolling_insights', 'out'),
    player('s2', 'Shelved Back', 'Dallas Cowboys', 'sleeper', 'Injured Reserve'),
    player('s3', 'Stale Back', 'New York Giants', 'sleeper', 'Active'),
    player('s4', 'Iffy Back', 'New York Giants', 'sleeper', 'Active'),
  ]
  h.feed = [
    feedRow('Saquon Barkley', 'Philadelphia Eagles', 'Out'),
    feedRow('Recovered Back', 'Dallas Cowboys', 'Active'),
    feedRow('Stale Back', 'New York Giants', 'Questionable', new Date(Date.now() - 10 * 24 * 3_600_000)),
    feedRow('Iffy Back', 'New York Giants', 'Questionable'),
  ]
})

describe('getPlayerPoolForSport — injury_status is the injury feed’s current designation', () => {
  it('🛑 Out and Questionable from the feed; Sleeper IR kept; a stamped "out" and a stale report dropped', async () => {
    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool = await getPlayerPoolForSport('NFL', { limit: 50, position: 'RB' })
    const byName = Object.fromEntries(pool.filter((p) => p.position === 'RB').map((p) => [p.full_name, p.injury_status]))
    expect(byName).toEqual({
      'Saquon Barkley': 'Out',
      'Recovered Back': null,
      'Shelved Back': 'Injured Reserve',
      'Stale Back': null,
      'Iffy Back': 'Questionable',
    })
    // The roster word itself is still carried, unchanged, for anything that wants roster meaning.
    expect(pool.find((p) => p.full_name === 'Saquon Barkley')?.status).toBe('Active')
  })
})
