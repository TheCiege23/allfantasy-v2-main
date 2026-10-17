import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ settings: vi.fn(), rosters: vi.fn(), sp: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    autoCoachSetting: { findMany: h.settings },
    roster: { findMany: h.rosters },
    sportsPlayer: { findFirst: h.sp },
  },
}))

import { identityWhereForLeagueId } from '@/lib/player-identity/externalIdNamespace'
import { indexClearSportsProjections, pickProjectionRowForPlayer } from '@/lib/sports-data-normalization/clearSportsProjectionIndex'
import { findLeagueIdsWithPlayerAsStarter } from '@/lib/autocoach/findLeaguesWithStarterPlayer'

/*
 * Sleeper 8394 is Percy Butler; Rolling Insights 8394 is Rome Odunze (measured 2026-10-11). Every
 * lookup below used to let one stand in for the other.
 */

describe('identityWhereForLeagueId', () => {
  it('🛑 an NFL bare number is asked of sleeperId ONLY — never rollingInsightsId / espnId', () => {
    expect(identityWhereForLeagueId('8394', 'NFL')).toEqual({ sleeperId: '8394' })
  })
  it('other ids keep every column (a native NHL roster holds RI ids)', () => {
    const w = identityWhereForLeagueId('1086', 'NHL') as { OR: Array<Record<string, string>> }
    expect(w.OR).toContainEqual({ rollingInsightsId: '1086' })
    expect(w.OR).toContainEqual({ sleeperId: '1086' })
  })
})

describe('ClearSports projection matching', () => {
  const rows = [
    { name: 'Justin Jefferson', team: 'MIN', position: 'WR', projected_points: 19.4 },
    { name: 'Justin Jefferson', team: 'CLE', position: 'LB', projected_points: 6.1 },
    { name: 'Rome Odunze', team: 'CHI', position: 'WR', projected_points: 11.2 },
  ]
  const index = indexClearSportsProjections(rows, 'NFL' as never)

  it('🛑 a shared name binds the athlete on the caller’s team, never the last row written', () => {
    expect(pickProjectionRowForPlayer({ name: 'Justin Jefferson', team: 'Minnesota Vikings', sport: 'NFL', index })?.projected_points).toBe(19.4)
    expect(pickProjectionRowForPlayer({ name: 'Justin Jefferson', team: 'CLE', sport: 'NFL', index })?.projected_points).toBe(6.1)
  })
  it('a shared name with nothing to tell them apart binds nothing', () => {
    expect(pickProjectionRowForPlayer({ name: 'Justin Jefferson', sport: 'NFL', index })).toBeNull()
  })
  it('a unique name binds without a team', () => {
    expect(pickProjectionRowForPlayer({ name: 'Rome Odunze', sport: 'NFL', index })?.projected_points).toBe(11.2)
  })
})

describe('findLeagueIdsWithPlayerAsStarter', () => {
  const roster = (leagueId: string, starters: string[]) => ({ leagueId, playerData: { lineup_sections: { starters: starters.map((id) => ({ id })) } } })
  beforeEach(() => {
    h.settings.mockResolvedValue([{ leagueId: 'L-butler', userId: 'u1' }, { leagueId: 'L-odunze', userId: 'u2' }])
    h.rosters.mockResolvedValue([roster('L-butler', ['8394']), roster('L-odunze', ['11620'])])
  })

  it('🛑 an RI status for 8394 (Odunze) re-runs the league starting Sleeper 11620, not Sleeper 8394', async () => {
    h.sp.mockResolvedValue({ sleeperId: '11620' })
    expect(await findLeagueIdsWithPlayerAsStarter('NFL', '8394')).toEqual(['L-odunze'])
  })
  it('an NFL provider number with no Sleeper id matches nothing rather than a stranger', async () => {
    h.sp.mockResolvedValue(null)
    expect(await findLeagueIdsWithPlayerAsStarter('NFL', '8394')).toEqual([])
  })
})
