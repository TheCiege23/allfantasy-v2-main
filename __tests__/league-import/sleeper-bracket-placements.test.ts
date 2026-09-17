import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  analyzePlayoffBracket,
  placementLabel,
  resolveBracketPlacements,
  type SleeperBracketGame,
} from '@/lib/league-import/sleeper/bracketPlacements'
import { seasonPlacementTeamIds } from '@/lib/league-import/seasonPlacement'

const { parseChampionFromBracket } = await import('@/lib/league/syncLeagueHistory')
const { SleeperAdapter } = await import('@/lib/league-import/adapters/sleeper/SleeperAdapter')

/*
 * An 8-team Sleeper winners bracket. Round 3 holds FOUR placement games — the
 * title game (p 1), third place (p 3), fifth (p 5) and seventh (p 7) — and the
 * title game is deliberately NOT listed first, which is what `finals[0]` read.
 *
 *   R1  m1 1v8 → 1   m2 4v5 → 4   m3 3v6 → 3   m4 2v7 → 2
 *   R2  m5 1v4 → 1   m6 3v2 → 2   m7 8v5 → 5 (consolation)   m8 6v7 → 6 (consolation)
 *   R3  m10 4v3 p3 → 4   m11 5v6 p5 → 5   m9 1v2 p1 → 2   m12 8v7 p7 → 7
 */
const EIGHT: SleeperBracketGame[] = [
  { r: 1, m: 1, t1: 1, t2: 8, w: 1, l: 8 },
  { r: 1, m: 2, t1: 4, t2: 5, w: 4, l: 5 },
  { r: 1, m: 3, t1: 3, t2: 6, w: 3, l: 6 },
  { r: 1, m: 4, t1: 2, t2: 7, w: 2, l: 7 },
  { r: 2, m: 5, t1: 1, t2: 4, w: 1, l: 4, t1_from: { w: 1 }, t2_from: { w: 2 } },
  { r: 2, m: 6, t1: 3, t2: 2, w: 2, l: 3, t1_from: { w: 3 }, t2_from: { w: 4 } },
  { r: 2, m: 7, t1: 8, t2: 5, w: 5, l: 8, t1_from: { l: 1 }, t2_from: { l: 2 } },
  { r: 2, m: 8, t1: 6, t2: 7, w: 6, l: 7, t1_from: { l: 3 }, t2_from: { l: 4 } },
  { r: 3, m: 10, t1: 4, t2: 3, w: 4, l: 3, p: 3, t1_from: { l: 5 }, t2_from: { l: 6 } },
  { r: 3, m: 11, t1: 5, t2: 6, w: 5, l: 6, p: 5, t1_from: { w: 7 }, t2_from: { w: 8 } },
  { r: 3, m: 9, t1: 1, t2: 2, w: 2, l: 1, p: 1, t1_from: { w: 5 }, t2_from: { w: 6 } },
  { r: 3, m: 12, t1: 8, t2: 7, w: 7, l: 8, p: 7, t1_from: { l: 7 }, t2_from: { l: 8 } },
]

/*
 * A 6-team bracket where the 5th-place game ALSO sits in the last round — the
 * shape the bug report describes: seeds 1 and 2 have byes, and the round-1 losers
 * play for fifth in round 3.
 */
const SIX: SleeperBracketGame[] = [
  { r: 1, m: 1, t1: 3, t2: 6, w: 3, l: 6 },
  { r: 1, m: 2, t1: 4, t2: 5, w: 4, l: 5 },
  { r: 2, m: 3, t1: 1, t2: 4, w: 1, l: 4, t2_from: { w: 2 } },
  { r: 2, m: 4, t1: 2, t2: 3, w: 2, l: 3, t2_from: { w: 1 } },
  { r: 3, m: 7, t1: 6, t2: 5, w: 5, l: 6, p: 5, t1_from: { l: 1 }, t2_from: { l: 2 } },
  { r: 3, m: 6, t1: 4, t2: 3, w: 3, l: 4, p: 3, t1_from: { l: 3 }, t2_from: { l: 4 } },
  { r: 3, m: 5, t1: 1, t2: 2, w: 1, l: 2, p: 1, t1_from: { w: 3 }, t2_from: { w: 4 } },
]

/** What this repo stored before the fix: no `p`, no `*_from`. */
const flatten = (bracket: SleeperBracketGame[]): SleeperBracketGame[] =>
  bracket.map(({ r, m, t1, t2, w, l }) => ({ r, m, t1, t2, w, l }))

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe('resolveBracketPlacements', () => {
  it('takes the p=1 game as the title game, wherever it is listed', () => {
    const p = resolveBracketPlacements(EIGHT)
    expect(p).toMatchObject({ championRosterId: 2, runnerUpRosterId: 1, source: 'placement' })
    expect(p.titleGame?.m).toBe(9)
  })

  it('settles every placement game: winner takes p, loser p + 1', () => {
    const p = resolveBracketPlacements(EIGHT)
    expect(Object.fromEntries(p.placementByRosterId)).toEqual({ 2: 1, 1: 2, 4: 3, 3: 4, 5: 5, 6: 6, 7: 7, 8: 8 })
  })

  it('returns no champion while the title game is undecided', () => {
    const live = EIGHT.map((g) => (g.p === 1 ? { ...g, w: null, l: null } : g))
    const p = resolveBracketPlacements(live)
    expect(p).toMatchObject({ championRosterId: null, runnerUpRosterId: null, source: 'placement' })
    // The decided placement games still settle their teams.
    expect(p.placementByRosterId.get(4)).toBe(3)
    expect(p.placementByRosterId.has(2)).toBe(false)
  })

  it('infers the final from a flattened bracket only when one game fits', () => {
    for (const bracket of [EIGHT, SIX]) {
      const p = resolveBracketPlacements(flatten(bracket))
      expect(p.source).toBe('inferred')
      const truth = resolveBracketPlacements(bracket)
      expect(p.championRosterId).toBe(truth.championRosterId)
      expect(p.runnerUpRosterId).toBe(truth.runnerUpRosterId)
    }
  })

  it('refuses to guess when the last round is ambiguous', () => {
    // Two last-round games whose teams never lost before: nothing says which is the final.
    const ambiguous: SleeperBracketGame[] = [
      { r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 },
      { r: 2, m: 2, t1: 3, t2: 4, w: 3, l: 4 },
      { r: 2, m: 3, t1: 5, t2: 6, w: 5, l: 6 },
    ]
    expect(resolveBracketPlacements(ambiguous)).toMatchObject({ championRosterId: null, runnerUpRosterId: null, source: 'none' })
    expect(resolveBracketPlacements([])).toMatchObject({ championRosterId: null, source: 'none' })
    expect(resolveBracketPlacements(null)).toMatchObject({ championRosterId: null, source: 'none' })
  })

  it('does not fall back to inference when placement games exist but none is the final', () => {
    const noFinal = EIGHT.filter((g) => g.p !== 1)
    expect(resolveBracketPlacements(noFinal)).toMatchObject({ championRosterId: null, source: 'none' })
  })
})

describe('analyzePlayoffBracket', () => {
  for (const [name, bracket, teams] of [
    ['8-team', EIGHT, 10],
    ['6-team', SIX, 10],
  ] as const) {
    it(`${name}: exactly one champion and one runner-up`, () => {
      const map = analyzePlayoffBracket(bracket, ids(teams))
      const champions = [...map].filter(([, i]) => i.isChampion).map(([id]) => id)
      const runnersUp = [...map].filter(([, i]) => i.isRunnerUp).map(([id]) => id)
      expect(champions).toHaveLength(1)
      expect(runnersUp).toHaveLength(1)
      expect(champions[0]).not.toBe(runnersUp[0])
    })
  }

  it('bestFinish comes from the placement games', () => {
    const map = analyzePlayoffBracket(EIGHT, ids(10))
    const finish = Object.fromEntries([...map].map(([id, i]) => [id, i.bestFinish]))
    expect(finish).toEqual({ 1: 2, 2: 1, 3: 4, 4: 3, 5: 5, 6: 6, 7: 7, 8: 8, 9: 999, 10: 999 })
    expect(map.get(9)?.madePlayoffs).toBe(false)
    expect(placementLabel(map.get(2)!)).toBe('Champion')
    expect(placementLabel(map.get(1)!)).toBe('Runner-up')
    expect(placementLabel(map.get(4)!)).toBe('Semifinalist')
    expect(placementLabel(map.get(5)!)).toBe('Playoff Team')
    expect(placementLabel(map.get(9)!)).toBeNull()
  })

  it('counts only title-path games as playoff wins and losses', () => {
    const map = analyzePlayoffBracket(EIGHT, ids(8))
    expect(map.get(2)).toMatchObject({ playoffWins: 3, playoffLosses: 0 })
    expect(map.get(1)).toMatchObject({ playoffWins: 2, playoffLosses: 1 })
    // Won the third-place game: not a playoff win.
    expect(map.get(4)).toMatchObject({ playoffWins: 1, playoffLosses: 1 })
    // Won a consolation semifinal and the fifth-place game: neither counts.
    expect(map.get(5)).toMatchObject({ playoffWins: 0, playoffLosses: 1 })
  })

  it('a flattened bracket still yields one champion, and elimination rounds for the rest', () => {
    const map = analyzePlayoffBracket(flatten(EIGHT), ids(8))
    expect([...map].filter(([, i]) => i.isChampion).map(([id]) => id)).toEqual([2])
    expect([...map].filter(([, i]) => i.isRunnerUp).map(([id]) => id)).toEqual([1])
    const finish = Object.fromEntries([...map].map(([id, i]) => [id, i.bestFinish]))
    // Semifinal losers: 3rd-4th band; quarterfinal losers: 5th-8th band.
    expect(finish).toEqual({ 1: 2, 2: 1, 3: 3, 4: 3, 5: 5, 6: 5, 7: 5, 8: 5 })
    // Without `*_from`, a consolation win is still recognised as off the title path.
    expect(map.get(5)).toMatchObject({ playoffWins: 0, playoffLosses: 1 })
  })

  it('an empty bracket marks nobody', () => {
    const map = analyzePlayoffBracket([], ids(4))
    expect([...map.values()].every((i) => !i.isChampion && !i.madePlayoffs && i.bestFinish === 999)).toBe(true)
  })
})

describe('syncLeagueHistory.parseChampionFromBracket', () => {
  it('reads the title game, not the first last-round game', () => {
    expect(parseChampionFromBracket(EIGHT as never)).toEqual({ winnerRosterId: 2, loserRosterId: 1 })
    expect(parseChampionFromBracket(SIX as never)).toEqual({ winnerRosterId: 1, loserRosterId: 2 })
  })

  it('falls back to the league winner for the champion only — never for the runner-up', () => {
    const noFinal = EIGHT.filter((g) => g.p !== 1)
    expect(parseChampionFromBracket(noFinal as never, { winner_roster_id: 2 })).toEqual({ winnerRosterId: 2, loserRosterId: null })
    expect(
      parseChampionFromBracket([] as never, { metadata: { latest_league_winner_roster_id: '5' } }),
    ).toEqual({ winnerRosterId: 5, loserRosterId: null })
    expect(parseChampionFromBracket([] as never, { metadata: {} })).toEqual({ winnerRosterId: null, loserRosterId: null })
  })
})

describe('seasonPlacementTeamIds', () => {
  const standings = [
    { source_team_id: '7', rank: 1 },
    { source_team_id: '3', rank: 2 },
  ]

  it('uses the bracket result when the adapter has one', () => {
    expect(
      seasonPlacementTeamIds({
        source: { source_provider: 'sleeper' },
        standings,
        season_placement: { champion_source_team_id: '2', runner_up_source_team_id: '1' },
      }),
    ).toEqual({ championTeamId: '2', runnerUpTeamId: '1' })
  })

  it('never crowns a Sleeper standings leader', () => {
    expect(seasonPlacementTeamIds({ source: { source_provider: 'sleeper' }, standings })).toEqual({
      championTeamId: null,
      runnerUpTeamId: null,
    })
  })

  it('keeps the standings fallback for other providers', () => {
    expect(seasonPlacementTeamIds({ source: { source_provider: 'espn' }, standings })).toEqual({
      championTeamId: '7',
      runnerUpTeamId: '3',
    })
  })
})

describe('SleeperAdapter', () => {
  const base = {
    league: { league_id: 'L1', name: 'Test', sport: 'nfl', season: '2025', total_rosters: 8, status: 'complete' },
    rosters: ids(8).map((id) => ({ roster_id: id, owner_id: `u${id}`, settings: { wins: 10 - id, losses: id, fpts: 1000 } })),
  }

  it('carries the bracket result as season_placement', async () => {
    const n = await SleeperAdapter.normalize({ ...base, winnersBracket: EIGHT } as never)
    expect(n.season_placement).toEqual({ champion_source_team_id: '2', runner_up_source_team_id: '1', source: 'placement' })
    // …while the standings still rank roster 1 first, which is exactly why they are not used.
    expect(n.standings[0].source_team_id).toBe('1')
  })

  it('leaves it unset when no bracket was fetched', async () => {
    const n = await SleeperAdapter.normalize(base as never)
    expect(n.season_placement).toBeUndefined()
  })
})
