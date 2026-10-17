import { describe, expect, it, vi } from 'vitest'

/*
 * The rail printed an unowned Sleeper roster's opponent as "Unknown" — the importer's placeholder,
 * stored as both teamName and ownerName (managerName.ts) — in English and Spanish alike (live sweep,
 * 2026-10-05). It now names the roster the way Matchup and the home do: the real name, else the
 * platform's own "Team N" (`rosterLabel`), never the placeholder.
 */

const db = vi.hoisted(() => ({
  teams: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', async () => {
  const { fakeWeeklyMatchup } = await import('./helpers/fakeWeeklyMatchup')
  return {
    prisma: {
      weeklyMatchup: fakeWeeklyMatchup(() => [
        { leagueId: 'P1', seasonYear: 2026, week: 4, rosterId: '10', matchupId: 1, pointsFor: 0, pointsAgainst: 0, updatedAt: new Date('2026-09-29T20:00:00Z') },
        { leagueId: 'P1', seasonYear: 2026, week: 4, rosterId: '11', matchupId: 1, pointsFor: 0, pointsAgainst: 0, updatedAt: new Date('2026-09-29T20:00:00Z') },
      ]),
      leagueTeam: { findMany: async () => db.teams },
      matchupFact: { findMany: async () => [] },
      $queryRawUnsafe: async () => [],
    },
  }
})

import { getRailMatchups } from '@/lib/core-app/railMatchups'

const team = (externalId: string, teamName: string | null, ownerName: string | null, mine: boolean) => ({
  externalId,
  teamName,
  ownerName,
  avatarUrl: null,
  claimedByUserId: mine ? 'user' : null,
  platformUserId: mine ? 'sl-me' : null,
  league: { id: 'AF-A', platform: 'sleeper', platformLeagueId: 'P1' },
})
const opponent = async () => (await getRailMatchups('user', [{ id: 'AF-A', platformLeagueId: 'P1' }])).byLeague['AF-A']?.opponentTeam

describe('rail opponent — a placeholder is not a name', () => {
  it('an unowned roster stored as "Unknown"/"Unknown" reads "Team 11"', async () => {
    db.teams = [team('10', 'Mine', null, true), team('11', 'Unknown', 'Unknown', false)]
    expect(await opponent()).toBe('Team 11')
  })

  it('a placeholder team name falls through to the real manager name', async () => {
    db.teams = [team('10', 'Mine', null, true), team('11', 'unknown', 'kfrost22', false)]
    expect(await opponent()).toBe('kfrost22')
  })

  it('CONTROL — a real team name is kept as it is', async () => {
    db.teams = [team('10', 'Mine', null, true), team('11', 'Go Birds!', 'eagles', false)]
    expect(await opponent()).toBe('Go Birds!')
  })
})
