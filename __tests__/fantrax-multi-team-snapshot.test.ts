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
    /* A two-slot board: one pick made by source-a, one slot still open. */
    draftBoard: {
      version: 1,
      draftState: 'in_progress',
      picks: [
        { round: 1, pick: 1, pickInRound: 1, teamId: 'source-a', time: null, playerId: 'player-a', playerName: 'Player A', playerPosition: 'QB', playerTeam: 'TxSt' },
        { round: 1, pick: 2, pickInRound: 2, teamId: 'source-b', time: null, playerId: null },
      ],
    },
    /* Future picks: one traded a -> b, one untraded, one owned by a team not in this league. */
    draftPicks: {
      version: 1,
      current: [],
      futureRaw: [
        { year: 2027, round: 1, originalOwnerTeamId: 'source-a', currentOwnerTeamId: 'source-b' },
        { year: 2027, round: 2, originalOwnerTeamId: 'source-a', currentOwnerTeamId: 'source-a' },
        { year: 2028, round: 1, originalOwnerTeamId: 'source-b', currentOwnerTeamId: 'not-a-team' },
      ],
    },
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
    /*
     * A snapshot with a `sourceLeagueId` re-reads the league's settings from
     * Fantrax. Without this stub the test made a REAL request for
     * 'real-league-id' and failed on the answer.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ leagueName: 'Large League', seasonYear: 2026, teamInfo: {} }),
      }),
    )
    const raw = await fetchFantraxLeagueForImport('af-user', 'id:snapshot-b')
    expect(raw.teams).toHaveLength(2)
    expect(new Set(raw.teams.map((team) => team.teamId)).size).toBe(2)
    const first = raw.teams.find((team) => team.rosterPlayerIds.includes('player-a'))
    const second = raw.teams.find((team) => team.rosterPlayerIds.includes('player-b'))
    expect(first?.rosterPlayerIds).toEqual(['player-a'])
    expect(second?.rosterPlayerIds).toEqual(['player-b'])
    expect(raw.viewerTeamId).toBe(second?.teamId)
    expect(raw.schedule[0]?.matchups[0]).toMatchObject({ teamId1: first?.teamId, teamId2: second?.teamId })

    /* The stored draft board comes back as real picks, on the right team. */
    expect(raw.draftBoard).toMatchObject({ slots: 2, made: 1, outstanding: 1 })
    expect(raw.draftPicks).toEqual([
      { round: 1, pickNumber: 1, teamId: first?.teamId, playerId: 'player-a', playerName: 'Player A', position: 'QB', team: 'TxSt' },
    ])

    /*
     * Only the pick that changed hands goes downstream. The untraded one is left
     * out (the table marks every row traded), and the one whose owner is not a
     * team in this league is counted rather than guessed.
     */
    expect(raw.tradedPicks).toEqual([
      { season: 2027, round: 1, originalTeamId: first?.teamId, currentOwnerTeamId: second?.teamId },
    ])
    expect(raw.futurePicks).toEqual({ total: 3, traded: 1, unmapped: 1, fromTradeExport: 0 })
    /* The untraded pick is reported as HOME, which is what clears a traded-back row. */
    expect(raw.returnedPicks).toEqual([{ season: 2027, round: 2, originalTeamId: first?.teamId }])

    const normalized = await FantraxAdapter.normalize(raw)
    expect(normalized.traded_picks).toEqual([
      { season: 2027, round: 1, original_roster_id: first?.teamId, current_owner_roster_id: second?.teamId },
    ])
    expect(normalized.returned_picks).toEqual([{ season: 2027, round: 2, original_roster_id: first?.teamId }])
    expect(normalized.draft_picks).toHaveLength(1)
    expect(normalized.coverage.draftHistory).toMatchObject({ state: 'partial', count: 1 })
    expect(normalized.source.source_league_id).toBe('real-league-id')
    expect(normalized.viewer_source_team_id).toBe(second?.teamId)
    expect(normalized.rosters).toHaveLength(2)
    expect(new Set(normalized.rosters.map((roster) => roster.source_manager_id)).size).toBe(2)
  })
})
