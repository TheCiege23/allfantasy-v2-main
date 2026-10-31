import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  snapshot: {
    id: 'snapshot-b',
    sourceLeagueId: 'real-league-id',
    appUserId: 'af-user',
    leagueName: 'Large League',
    season: 2026,
    sport: 'cfb',
    teamCount: 2,
    userTeam: 'Same Name',
    isDevy: true,
    standings: [
      { team: 'Same Name', fantraxTeamId: 'source-a', rank: 1 },
      { team: 'Same Name', fantraxTeamId: 'source-b', rank: 2 },
    ],
    roster: [
      { fantraxId: 'player-a', name: 'Player A', teamId: 'source-a', teamName: 'Same Name', status: 'ACTIVE' },
      { fantraxId: 'player-b', name: 'Player B', teamId: 'source-b', teamName: 'Same Name', status: 'ACTIVE' },
    ],
    matchups: [{ week: 1, awayTeam: 'Same Name', awayTeamId: 'source-a', homeTeam: 'Same Name', homeTeamId: 'source-b' }],
    transactions: {},
    user: { id: 'snapshot-user', fantraxUsername: 'fantrax-team:real-league-id:source-b' },
  },
  findMany: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantraxLeague: {
      findUnique: vi.fn(async () => h.snapshot),
      findMany: h.findMany,
    },
  },
}))

import { fetchFantraxLeagueForImport } from '@/lib/league-import/fantrax/FantraxLeagueFetchService'
import { FantraxAdapter } from '@/lib/league-import/adapters/fantrax/FantraxAdapter'

describe('live Fantrax snapshots with duplicate team names', () => {
  it('keeps both rosters and selected ownership distinct by source team ID', async () => {
    const raw = await fetchFantraxLeagueForImport('af-user', 'id:snapshot-b')
    expect(raw.teams).toHaveLength(2)
    expect(new Set(raw.teams.map((team) => team.teamId)).size).toBe(2)
    const first = raw.teams.find((team) => team.rosterPlayerIds.includes('player-a'))
    const second = raw.teams.find((team) => team.rosterPlayerIds.includes('player-b'))
    expect(first?.rosterPlayerIds).toEqual(['player-a'])
    expect(second?.rosterPlayerIds).toEqual(['player-b'])
    expect(raw.viewerTeamId).toBe(second?.teamId)
    expect(raw.schedule[0]?.matchups[0]).toMatchObject({ teamId1: first?.teamId, teamId2: second?.teamId })

    const normalized = await FantraxAdapter.normalize(raw)
    expect(normalized.source.source_league_id).toBe('real-league-id')
    expect(normalized.viewer_source_team_id).toBe(second?.teamId)
    expect(normalized.rosters).toHaveLength(2)
    expect(new Set(normalized.rosters.map((roster) => roster.source_manager_id)).size).toBe(2)
  })
})
