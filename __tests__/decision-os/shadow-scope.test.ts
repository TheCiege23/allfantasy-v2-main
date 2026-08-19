import { describe, expect, it } from 'vitest'
import {
  getDecisionShadowScopeFilters,
  matchesDecisionShadowScope,
} from '@/lib/decision-os/core/shadow'

describe('Decision OS shadow scope filters', () => {
  it('parses username and league filters from env', () => {
    const filters = getDecisionShadowScopeFilters({
      DECISION_OS_TEST_USERNAMES: 'theciege24, AnotherUser',
      DECISION_OS_TEST_LEAGUE_IDS: 'league-1;league-2',
    } as never)

    expect(filters.hasScope).toBe(true)
    expect(filters.hasUsernameFilter).toBe(true)
    expect(filters.hasLeagueFilter).toBe(true)
    expect(filters.usernames.has('theciege24')).toBe(true)
    expect(filters.usernames.has('anotheruser')).toBe(true)
    expect(filters.leagueIds.has('league-1')).toBe(true)
    expect(filters.leagueIds.has('league-2')).toBe(true)
  })

  it('allows all scopes when no test targeting envs are set', () => {
    expect(matchesDecisionShadowScope({ username: 'whoever', leagueId: 'league-1' }, {} as never)).toBe(true)
  })

  it('matches usernames case-insensitively', () => {
    expect(
      matchesDecisionShadowScope(
        { username: 'TheCiege24' },
        { DECISION_OS_TEST_USERNAMES: 'theciege24' } as never,
      ),
    ).toBe(true)
  })

  it('matches any provided league id candidate', () => {
    expect(
      matchesDecisionShadowScope(
        { leagueIds: ['league-0', 'league-2'] },
        { DECISION_OS_TEST_LEAGUE_IDS: 'league-2' } as never,
      ),
    ).toBe(true)
  })

  it('requires both username and league when both filters are configured', () => {
    const env = {
      DECISION_OS_TEST_USERNAMES: 'theciege24',
      DECISION_OS_TEST_LEAGUE_IDS: 'league-2',
    } as never

    expect(matchesDecisionShadowScope({ username: 'theciege24', leagueId: 'league-2' }, env)).toBe(true)
    expect(matchesDecisionShadowScope({ username: 'wrong-user', leagueId: 'league-2' }, env)).toBe(false)
    expect(matchesDecisionShadowScope({ username: 'theciege24', leagueId: 'league-9' }, env)).toBe(false)
  })
})
