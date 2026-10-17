/**
 * 🛑 The live tick recognised a team defence only as `nfl:def:<ABBR>`. Sleeper's id for one is the bare
 * club code (`KC`), so a Sleeper-format defence went into the OFFENSIVE fetch — scored, if at all, by the
 * offensive normalizer, which reads a defence's `sack` as `idp_sack`. Both forms now resolve to one
 * defence line (`canonicalTeamDefenseId`), written back under each roster's own id.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { LiveStatsProvider } from '@/lib/live-scoring/provider'

// The rescore reads the app's own prisma; this suite is about what the tick fetches and writes.
vi.mock('@/lib/redraft/scoringEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/scoringEngine')>()),
  recalculateMatchupsForSeasonWeek: vi.fn(async () => ({ updated: 0, incomplete: 0, summaries: [] })),
}))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: vi.fn(async () => []) }))

import { runLiveScoringTickForSeason } from '@/server/services/liveScoring/liveScoreRunner'

const SEASON = { id: 's-nfl', leagueId: 'l-nfl', sport: 'NFL', season: 2026, currentWeek: 3 }

function fakePrisma(roster: Array<Record<string, unknown>>, upserts: Array<Record<string, unknown>>) {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => async (args: Record<string, unknown>) => {
          if (name === 'league' && method === 'findFirst') return { bestBallMode: false, leagueType: 'redraft', leagueVariant: null }
          if (name === 'redraftRosterPlayer' && method === 'findMany') return roster
          if (name === 'redraftRoster' && method === 'findMany') {
            return [{ id: 'r1', players: roster.map((p) => ({ playerId: p.playerId, slotType: p.slotType })) }]
          }
          if (name === 'playerWeeklyScore' && method === 'upsert') {
            upserts.push(args)
            return {}
          }
          if (method.startsWith('find') && method !== 'findMany') return null
          if (method === 'count') return 0
          return []
        },
      },
    )
  return new Proxy({}, { get: (_t, prop: string) => model(prop) }) as unknown as PrismaClient
}

function provider(defence: Map<string, Record<string, number>>) {
  return {
    fetchActiveGames: vi.fn(async () => [
      { gameId: 'g1', status: 'in_progress', startTime: new Date('2026-09-27T17:00:00Z'), homeTeam: 'KC', awayTeam: 'BUF' },
    ]),
    fetchPlayerStatsForGames: vi.fn(async () => new Map([['qb1', { pass_yds: 250 }]])),
    fetchTeamDefenseStatsForGames: vi.fn(async () => defence),
    normalizeGameStatus: vi.fn(() => 'in_progress' as const),
  }
}

async function tick(roster: Array<Record<string, unknown>>, defence: Map<string, Record<string, number>>) {
  const p = provider(defence)
  const upserts: Array<Record<string, unknown>> = []
  await runLiveScoringTickForSeason(fakePrisma(roster, upserts), SEASON, {
    provider: p as unknown as LiveStatsProvider,
    broadcast: () => {},
    seasonType: 'regular',
    now: new Date('2026-09-27T18:00:00Z'),
  })
  const written = Object.fromEntries(
    upserts.map((u) => [
      (u.where as { playerId_week_season_sport: { playerId: string } }).playerId_week_season_sport.playerId,
      (u.create as { stats: Record<string, number> }).stats,
    ]),
  )
  return { p, written }
}

describe('live tick — a team defence is one defence, whichever id the roster holds', () => {
  it('🛑 Sleeper\'s bare KC is fetched as a DEFENCE, never as an offensive player, and written under KC', async () => {
    const { p, written } = await tick(
      [
        { playerId: 'KC', slotType: 'DEF', position: 'DEF' },
        { playerId: 'qb1', slotType: 'QB', position: 'QB' },
      ],
      new Map([['nfl:def:KC', { def_sack: 3, def_int: 1 }]]),
    )

    const offensive = p.fetchPlayerStatsForGames.mock.calls[0]![0] as { playerIds: string[] }
    expect(offensive.playerIds).toEqual(['qb1'])
    const defence = p.fetchTeamDefenseStatsForGames.mock.calls[0]![0] as { teamAbbrs: string[] }
    expect(defence.teamAbbrs).toEqual(['KC'])
    expect(written.KC).toEqual({ def_sack: 3, def_int: 1 })
    expect(written['nfl:def:KC']).toBeUndefined()
  })

  it('an `nfl:def:BUF` roster still reads its own line, and a D/ST-labelled bare code is a defence too', async () => {
    const { p, written } = await tick(
      [
        { playerId: 'nfl:def:BUF', slotType: 'DEF', position: 'DEF' },
        { playerId: 'KC', slotType: 'DEF', position: 'D/ST' },
      ],
      new Map([
        ['nfl:def:BUF', { def_sack: 1 }],
        ['nfl:def:KC', { def_sack: 3 }],
      ]),
    )

    const defence = p.fetchTeamDefenseStatsForGames.mock.calls[0]![0] as { teamAbbrs: string[] }
    expect([...defence.teamAbbrs].sort()).toEqual(['BUF', 'KC'])
    expect(written['nfl:def:BUF']).toEqual({ def_sack: 1 })
    expect(written.KC).toEqual({ def_sack: 3 })
  })
})
