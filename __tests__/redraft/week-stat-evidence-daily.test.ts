/**
 * The daily-sport half of the missing-stat rule (lib/redraft/weekStatEvidence.ts): NBA / NHL / MLB ask
 * the per-Eastern-day participation check the weekly sync already writes its zeros from, and only what
 * that check cannot place falls through to the team check. A daily team with no game in the window is
 * NOT a bye — it is reported as unplaced, never proved to be a 0.
 */
import { describe, expect, it, vi } from 'vitest'

const daily = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/lib/redraft/dailySportParticipation', () => ({
  DAILY_NO_ROW_VERDICT_SPORTS: ['NBA', 'NHL', 'MLB'],
  loadDailyWindowParticipation: daily.load,
}))

import { classifyMissingStatPlayers } from '@/lib/redraft/weekStatEvidence'

const WINDOW = { start: new Date('2026-10-12T00:00:00.000Z'), end: new Date('2026-10-19T00:00:00.000Z') }

function db(rows: Array<{ playerId: string; team: string; stats: Record<string, number> }>) {
  return {
    playerIdentityMap: {},
    playerGameStat: {},
    sportsGame: { findMany: vi.fn() },
    redraftRosterPlayer: {
      findMany: vi.fn(async ({ where }: any) => rows.filter((r) => where.team.in.includes(r.team)).map((r) => ({ playerId: r.playerId, team: r.team, position: 'C' }))),
    },
    playerWeeklyScore: {
      findMany: vi.fn(async ({ where }: any) => rows.filter((r) => where.playerId.in.includes(r.playerId)).map((r) => ({ playerId: r.playerId, stats: r.stats }))),
    },
  }
}

const kickoffs = {
  byTeam: new Map([
    ['BOSTON BRUINS', new Date('2026-10-14T23:00:00.000Z')],
    ['TORONTO MAPLE LEAFS', new Date('2026-10-14T23:00:00.000Z')],
  ]),
  firstKickoff: new Date('2026-10-14T23:00:00.000Z'),
  warnings: [],
}

describe('classifyMissingStatPlayers — daily sports', () => {
  it('maps each participation verdict, and only an undecided one reaches the team check', async () => {
    const verdictById: Record<string, string> = {
      gap: 'not_ingested',
      quiet: 'no_stat',
      retired: 'inactive',
      tonight: 'pending',
      unbridged: 'no_identity',
      offslate: 'no_games',
    }
    daily.load.mockResolvedValue((id: string) => verdictById[id] ?? 'no_identity')
    const missing = [
      { playerId: 'gap', sport: 'NHL', team: 'Toronto Maple Leafs' },
      { playerId: 'quiet', sport: 'NHL', team: 'Boston Bruins' },
      { playerId: 'retired', sport: 'NHL', team: 'Boston Bruins' },
      { playerId: 'tonight', sport: 'NHL', team: 'Boston Bruins' },
      { playerId: 'unbridged', sport: 'NHL', team: 'Boston Bruins' },
      { playerId: 'offslate', sport: 'NHL', team: 'Seattle Kraken' },
    ]
    const fake = db([{ playerId: 'bos-c', team: 'Boston Bruins', stats: { goals: 1 } }])
    const { verdicts, gapTeams } = await classifyMissingStatPlayers(fake as never, {
      sport: 'NHL',
      season: 2026,
      week: 2,
      dateWindow: WINDOW,
      missing,
      kickoffs,
    })

    expect(Object.fromEntries(verdicts)).toEqual({
      'NHL::gap': 'game_box_missing',
      'NHL::quiet': 'did_not_play',
      'NHL::retired': 'inactive',
      'NHL::tonight': 'game_not_final',
      // No identity bridge: the team check proves it from a Bruins line this week.
      'NHL::unbridged': 'did_not_play',
      // A daily team with no game in seven days is a name the schedule did not match, not a bye.
      'NHL::offslate': 'unplaced',
    })
    expect(gapTeams.sort()).toEqual(['Boston Bruins', 'Toronto Maple Leafs'])
    expect(daily.load).toHaveBeenCalledWith(fake, expect.objectContaining({ sport: 'NHL', window: WINDOW, week: 2 }))
    // Only the undecided Bruin was looked up by team.
    expect(fake.redraftRosterPlayer.findMany).toHaveBeenCalledOnce()
    expect(fake.redraftRosterPlayer.findMany.mock.calls[0]![0].where.team).toEqual({ in: ['Boston Bruins'] })
  })

  it('a failed participation read never zeroes anyone: the team check still decides', async () => {
    daily.load.mockRejectedValue(new Error('db down'))
    const { verdicts } = await classifyMissingStatPlayers(db([]) as never, {
      sport: 'NBA',
      season: 2026,
      week: 1,
      dateWindow: WINDOW,
      missing: [{ playerId: 'x', sport: 'NBA', team: 'Boston Bruins' }],
      kickoffs,
    })
    expect(verdicts.get('NBA::x')).toBe('game_box_missing')
  })
})
