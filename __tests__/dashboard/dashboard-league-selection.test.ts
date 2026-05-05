import { describe, expect, it } from 'vitest'
import { mergeDashboardActiveLeagueId } from '@/lib/dashboard/dashboard-league-selection'

describe('mergeDashboardActiveLeagueId', () => {
  const ids = new Set(['a', 'b'])

  it('prefers valid leagueId from URL', () => {
    expect(
      mergeDashboardActiveLeagueId({
        leagueIdFromUrl: 'a',
        validLeagueIds: ids,
        routeActiveLeagueId: 'b',
      }),
    ).toBe('a')
  })

  it('ignores unknown URL id and falls back to route when valid', () => {
    expect(
      mergeDashboardActiveLeagueId({
        leagueIdFromUrl: 'zzz',
        validLeagueIds: ids,
        routeActiveLeagueId: 'b',
      }),
    ).toBe('b')
  })

  it('returns null when URL empty and route invalid', () => {
    expect(
      mergeDashboardActiveLeagueId({
        leagueIdFromUrl: null,
        validLeagueIds: ids,
        routeActiveLeagueId: 'nope',
      }),
    ).toBe(null)
  })

  it('returns route id when URL empty and route valid', () => {
    expect(
      mergeDashboardActiveLeagueId({
        leagueIdFromUrl: null,
        validLeagueIds: ids,
        routeActiveLeagueId: 'b',
      }),
    ).toBe('b')
  })
})
