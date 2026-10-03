// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Team follows (owner's call, 2026-10-03): the store, the news-to-team mapping, the daily cap, and
 * the alert routing in the news notifier. Raw SQL is exercised through a stand-in `$queryRaw` that
 * answers by the SQL it is given.
 */

const h = vi.hoisted(() => ({
  teams: [] as Array<{ abbr: string; name: string }>,
  follows: [] as Array<{ user_id: string; sport: string; team_abbr: string; team_name: string; created_at: Date }>,
  promptSeen: null as string | null,
  missingTable: false,
  executed: [] as string[],
  sportsPlayers: [] as Array<{ team: string | null }>,
  dailyCalls: new Map<string, number>(),
  dailyThrows: false,
}))

function missing() {
  return Object.assign(new Error('relation "team_follows" does not exist'), { code: 'P2010', meta: { code: '42P01' } })
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const sql = (strings: TemplateStringsArray) => strings.join('?')
  return {
    prisma: {
      $queryRaw: async (strings: TemplateStringsArray, ...vals: unknown[]) => {
        const q = sql(strings)
        if (q.includes('FROM sports_core_teams')) return h.teams
        if (h.missingTable && q.includes('team_follows')) throw missing()
        if (q.includes('core_preferences->>')) return [{ seen: h.promptSeen, n: h.follows.filter((f) => f.user_id === vals[1]).length }]
        if (q.includes('count(*)::int AS n FROM team_follows')) return [{ n: h.follows.filter((f) => f.user_id === vals[0]).length }]
        if (q.includes('SELECT user_id FROM team_follows')) {
          return h.follows.filter((f) => f.sport === vals[0] && f.team_abbr === vals[1]).map((f) => ({ user_id: f.user_id }))
        }
        if (q.includes('FROM team_follows')) return h.follows.filter((f) => f.user_id === vals[0])
        return []
      },
      $executeRaw: async (strings: TemplateStringsArray) => {
        const q = sql(strings)
        if (h.missingTable && q.includes('team_follows')) throw missing()
        h.executed.push(q)
        return 1
      },
      sportsPlayer: { findMany: async () => h.sportsPlayers },
    },
  }
})
vi.mock('@/lib/rate-limit-daily', () => ({
  consumeDailyLimit: async ({ endpoint, callsLimit }: { endpoint: string; callsLimit: number }) => {
    if (h.dailyThrows) throw new Error('counter down')
    const n = (h.dailyCalls.get(endpoint) ?? 0) + 1
    h.dailyCalls.set(endpoint, n)
    return { success: n <= callsLimit, retryAfterSec: 0 }
  },
}))

import {
  __resetTeamCacheForTests,
  followTeam,
  listFollowerIdsForTeam,
  listTeamFollows,
  listTeamsForSport,
  MAX_TEAM_FOLLOWS,
  shouldShowTeamFollowPrompt,
  TEAM_FOLLOW_SPORTS,
} from '@/lib/follows/teamFollows'
import { resolveNewsTeam, TEAM_FOLLOW_ALERTS_PER_DAY, withinTeamFollowDailyCap } from '@/lib/follows/teamFollowAlerts'

beforeEach(() => {
  __resetTeamCacheForTests()
  h.teams = [
    { abbr: 'GB', name: 'Green Bay Packers' },
    { abbr: 'AFC', name: 'AFC' },
    { abbr: 'CHI', name: 'Chicago Bears' },
  ]
  h.follows = []
  h.promptSeen = null
  h.missingTable = false
  h.executed = []
  h.sportsPlayers = []
  h.dailyCalls.clear()
  h.dailyThrows = false
})

describe('the store', () => {
  it('lists real teams only (no conferences), A–Z, and soccer is not followable', async () => {
    expect((await listTeamsForSport('NFL')).map((t) => t.abbr)).toEqual(['CHI', 'GB'])
    expect(TEAM_FOLLOW_SPORTS).not.toContain('SOCCER' as never)
    expect(await listTeamsForSport('SOCCER')).toEqual([])
  })

  it('accepts only an abbreviation the canonical table has', async () => {
    expect(await followTeam('u-1', 'NFL', 'GB')).toBe('followed')
    expect(await followTeam('u-1', 'NFL', 'XYZ')).toBe('invalid')
    expect(await followTeam('u-1', 'NFL', 'AFC')).toBe('invalid')
    expect(await followTeam('u-1', 'SOCCER', 'ARS')).toBe('invalid')
  })

  it('stops at the follow limit', async () => {
    h.follows = Array.from({ length: MAX_TEAM_FOLLOWS }, (_, i) => ({
      user_id: 'u-1', sport: 'NFL', team_abbr: `T${i}`, team_name: `Team ${i}`, created_at: new Date(),
    }))
    expect(await followTeam('u-1', 'NFL', 'GB')).toBe('limit')
  })

  it('a missing table is UNAVAILABLE, never "follows nobody"', async () => {
    h.missingTable = true
    expect(await listTeamFollows('u-1')).toBeNull()
    expect(await listFollowerIdsForTeam('NFL', 'GB')).toBeNull()
    expect(await followTeam('u-1', 'NFL', 'GB')).toBe('unavailable')
  })
})

describe('the one-time prompt', () => {
  it('shows only to someone who has neither seen it nor followed a team', async () => {
    expect(await shouldShowTeamFollowPrompt('u-1')).toBe(true)
    h.promptSeen = '2026-10-03T00:00:00.000Z'
    expect(await shouldShowTeamFollowPrompt('u-1')).toBe(false)
    h.promptSeen = null
    h.follows = [{ user_id: 'u-1', sport: 'NFL', team_abbr: 'GB', team_name: 'Green Bay Packers', created_at: new Date() }]
    expect(await shouldShowTeamFollowPrompt('u-1')).toBe(false)
  })

  it('never nags on a failed read, or when follows are unavailable', async () => {
    h.missingTable = true
    expect(await shouldShowTeamFollowPrompt('u-1')).toBe(false)
  })
})

describe('which team a news story belongs to', () => {
  it('uses the row\'s own team text through the resolver', async () => {
    expect(await resolveNewsTeam('NFL', 'Packers', 'Some Player')).toBe('GB')
    expect(await resolveNewsTeam('NFL', 'GB (Packers)', null)).toBe('GB')
  })

  it('an ambiguous team text does NOT fall back to the player', async () => {
    h.sportsPlayers = [{ team: 'GB' }]
    expect(await resolveNewsTeam('NFL', 'Multiple (Packers, Bears)', 'Some Player')).toBeNull()
    expect(await resolveNewsTeam('NFL', 'Packers (former)', 'Some Player')).toBeNull()
  })

  it('no team text: the player\'s current team, only when it is ONE team', async () => {
    h.sportsPlayers = [{ team: 'GB' }, { team: 'Green Bay Packers' }]
    expect(await resolveNewsTeam('NFL', null, 'Some Player')).toBe('GB')
    h.sportsPlayers = [{ team: 'GB' }, { team: 'CHI' }]
    expect(await resolveNewsTeam('NFL', null, 'Common Name')).toBeNull()
  })

  it('an unsupported sport maps to no team', async () => {
    expect(await resolveNewsTeam('SOCCER', 'Arsenal', null)).toBeNull()
  })
})

describe('the daily cap', () => {
  it(`keeps each person to ${TEAM_FOLLOW_ALERTS_PER_DAY} team alerts a day`, async () => {
    let told = 0
    for (let i = 0; i < TEAM_FOLLOW_ALERTS_PER_DAY + 3; i++) told += (await withinTeamFollowDailyCap(['u-1'])).length
    expect(told).toBe(TEAM_FOLLOW_ALERTS_PER_DAY)
    // Someone else is counted separately.
    expect(await withinTeamFollowDailyCap(['u-2'])).toEqual(['u-2'])
  })

  it('a counter outage sends rather than silently dropping every follower', async () => {
    h.dailyThrows = true
    expect(await withinTeamFollowDailyCap(['u-1', 'u-2'])).toEqual(['u-1', 'u-2'])
  })
})
