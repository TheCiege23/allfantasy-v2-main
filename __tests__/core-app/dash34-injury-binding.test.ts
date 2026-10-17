import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ live: vi.fn(), injuries: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/core-app/currentSleeperRoster', () => ({ currentSleeperRoster: h.live }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/injuries/injurySyncState', () => ({ readInjurySyncFreshness: async () => null }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findMany: async () => [] },
  guillotineRosterState: { findMany: async () => [] },
  guillotineElimination: { findMany: async () => [] },
  leagueTeam: { findMany: async () => [{ leagueId: 'af-league', platformUserId: 'owner', externalId: '3', teamName: 'Team' }] },
  roster: { findMany: async () => [{ leagueId: 'af-league', playerData: { players: ['smith', 'jj'], starters: ['smith', 'jj'] } }] },
  sportsGame: { findMany: async () => [] },
  sportsPlayer: { findMany: async () => [
    { sleeperId: 'smith', name: 'DeVonta Smith', position: 'WR', team: 'PHI', sport: 'NFL', imageUrl: null },
    { sleeperId: 'jj', name: 'Justin Jefferson', position: 'WR', team: 'MIN', sport: 'NFL', imageUrl: null },
  ] },
  sportsInjury: { findMany: async () => h.injuries },
  playerValueSnapshot: { findMany: async () => [] },
} }))
import { getDash34Data } from '@/lib/core-app/dash34'

/*
 * The dashboard's injury binding, measured live 2026-10-11:
 *  - 77 NFL names had 2+ live rows sharing a position (ESPN writes a row per news item, plus the
 *    live Sleeper fold). The matcher saw several candidates for ONE athlete, refused, and an Out
 *    starter (DeVonta Smith) read as healthy.
 *  - the status was then read by NAME alone, so a verified Vikings WR could get a Browns LB's.
 */
const NOW = new Date('2026-10-11T15:00:00Z')
const leagues = [{ id: 'af-league', name: 'L', platform: 'sleeper', platformLeagueId: 'sl', sport: 'NFL', status: 'in_season' }]
const inj = (playerName: string, team: string, position: string | null, status: string) =>
  ({ playerName, team, position, status, description: null, date: new Date('2026-10-10') })
const flagged = async () =>
  ((await getDash34Data('user', leagues, NOW)).allLeagues?.[0]?.flaggedStarters ?? []).map((f) => `${f.name}:${f.status}`)

describe('dash34 binds each injury to its own athlete', () => {
  beforeEach(() => h.live.mockResolvedValue({ players: ['smith', 'jj'], starters: ['smith', 'jj'], reserve: [], taxi: [] }))

  it('🛑 an Out starter reported by several feeds is still flagged (not refused as ambiguous)', async () => {
    h.injuries = [
      inj('DeVonta Smith', 'Philadelphia Eagles', 'WR', 'Out'),
      inj('DeVonta Smith', 'Philadelphia Eagles', 'WR', 'Out'),
      inj('DeVonta Smith', 'PHI', null, 'Out'),
    ]
    expect(await flagged()).toEqual(['DeVonta Smith:Out'])
  })

  it('🛑 a verified athlete gets HIS status, not a same-named player’s', async () => {
    h.injuries = [
      inj('Justin Jefferson', 'Cleveland Browns', 'LB', 'Out'),
      inj('Justin Jefferson', 'Minnesota Vikings', 'WR', 'Active'),
    ]
    expect(await flagged()).toEqual([])
  })

  it('the newest row decides: a later "Active" clears an older "Out"', async () => {
    h.injuries = [
      inj('DeVonta Smith', 'Philadelphia Eagles', 'WR', 'Active'),
      // An older feed's row with no position — the shape that lets the old matcher resolve the
      // athlete and then fall through the skipped "Active" to this stale "Out".
      inj('DeVonta Smith', 'Philadelphia Eagles', null, 'Out'),
    ]
    expect(await flagged()).toEqual([])
  })
})
