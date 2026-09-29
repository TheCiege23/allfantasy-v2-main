import { describe, expect, it, vi } from 'vitest'

/*
 * One Sleeper league is several AF `leagues` rows — one per importer. The rail looks each card up by
 * its OWN row id, and `getRailMatchups` used to key its answer on whichever row's team was read last,
 * so every other copy of the league drew `PROJ —` (and no standing) beside a live score. Measured
 * 2026-09-29 on `🪓 Guillotine League 26`: three AF rows, one Sleeper id.
 */

const db = vi.hoisted(() => ({
  seasons: [{ leagueId: 'P1', _max: { seasonYear: 2026 } }],
  rows: [
    { leagueId: 'P1', seasonYear: 2026, week: 4, rosterId: '10', matchupId: 1, pointsFor: 0, pointsAgainst: 0, updatedAt: new Date('2026-09-29T20:00:00Z') },
    { leagueId: 'P1', seasonYear: 2026, week: 4, rosterId: '11', matchupId: 1, pointsFor: 0, pointsAgainst: 0, updatedAt: new Date('2026-09-29T20:00:00Z') },
  ],
  teams: ['AF-A', 'AF-B', 'AF-C'].flatMap((id) => [
    { externalId: '10', teamName: 'Mine', ownerName: null, avatarUrl: null, claimedByUserId: 'user', platformUserId: 'sl-me', league: { id, platform: 'sleeper', platformLeagueId: 'P1' } },
    { externalId: '11', teamName: 'Theirs', ownerName: null, avatarUrl: null, claimedByUserId: null, platformUserId: 'sl-them', league: { id, platform: 'sleeper', platformLeagueId: 'P1' } },
  ]),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: {
      groupBy: async () => db.seasons,
      findMany: async () => db.rows,
    },
    leagueTeam: { findMany: async () => db.teams },
    matchupFact: { findMany: async () => [] },
    $queryRawUnsafe: async () => [],
  },
}))

import { getRailMatchups } from '@/lib/core-app/railMatchups'

describe('rail — one Sleeper league, several AF rows', () => {
  it('answers for EVERY row the caller drew, not only the one read last', async () => {
    const result = await getRailMatchups('user', [
      { id: 'AF-A', platformLeagueId: 'P1' },
      { id: 'AF-B', platformLeagueId: 'P1' },
      { id: 'AF-C', platformLeagueId: 'P1' },
    ])
    for (const id of ['AF-A', 'AF-B', 'AF-C']) {
      expect(result.byLeague[id]?.leagueId).toBe(id)
      expect(result.byLeague[id]?.opponentTeam).toBe('Theirs')
      expect(result.byLeague[id]?.week).toBe(4)
    }
  })

  it('does not invent a fixture for a row whose Sleeper league has none', async () => {
    const result = await getRailMatchups('user', [
      { id: 'AF-A', platformLeagueId: 'P1' },
      { id: 'AF-Z', platformLeagueId: 'P-OTHER' },
    ])
    expect(result.byLeague['AF-A']).toBeTruthy()
    expect(result.byLeague['AF-Z']).toBeUndefined()
  })
})
