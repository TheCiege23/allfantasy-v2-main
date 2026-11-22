/**
 * Dynasty League home extras (step 5): the pure shaping behind the championship rafters, the pick
 * capital module and the pipeline module. Real data only — every "hide" case below is a case where
 * the honest answer is "nothing to show", not a zero.
 */
import { describe, expect, it } from 'vitest'
import {
  buildChampionRafters,
  leagueRunsDevy,
  summarizePickCapital,
  summarizePipeline,
  type HubPick,
} from '@/lib/league/dynastyHomeExtras'

describe('buildChampionRafters', () => {
  const base = { viewerUserId: 'me', currentSeason: 2026 }

  it('no recorded champion anywhere → null (rafters hide)', () => {
    expect(buildChampionRafters({ ...base, seasons: [], championships: [] })).toBeNull()
    expect(
      buildChampionRafters({
        ...base,
        seasons: [{ season: 2025, championName: null, championTeamUserIds: [], championTeamName: null }],
        championships: [],
      }),
    ).toBeNull()
  })

  it('oldest first; gold only for the viewer; the current season is an open pennant', () => {
    const r = buildChampionRafters({
      ...base,
      seasons: [
        { season: 2024, championName: 'Wolves', championTeamUserIds: ['u2', null], championTeamName: 'Wolves' },
        { season: 2023, championName: 'guap', championTeamUserIds: [null, 'me'], championTeamName: 'Gold' },
        { season: 2022, championName: 'Owls', championTeamUserIds: [], championTeamName: null },
      ],
      championships: [],
    })
    expect(r).toEqual({
      pennants: [
        { season: 2022, label: 'Owls', mine: false },
        { season: 2023, label: 'guap', mine: true },
        { season: 2024, label: 'Wolves', mine: false },
      ],
      openSeason: 2026,
      myTitles: 1,
    })
  })

  it('league_championships (which carries the user id) wins its season', () => {
    const r = buildChampionRafters({
      ...base,
      seasons: [{ season: 2025, championName: 'Someone', championTeamUserIds: ['u9'], championTeamName: null }],
      championships: [{ season: 2025, championUserId: 'me', teamName: 'Gold Standard' }],
    })
    expect(r?.pennants).toEqual([{ season: 2025, label: 'Gold Standard', mine: true }])
    expect(r?.myTitles).toBe(1)
  })

  it('a current season that already has a champion is not shown as open', () => {
    const r = buildChampionRafters({
      ...base,
      seasons: [{ season: 2026, championName: 'Owls', championTeamUserIds: [], championTeamName: null }],
      championships: [],
    })
    expect(r?.openSeason).toBeNull()
  })

  it('no viewer → nothing is gold', () => {
    const r = buildChampionRafters({
      viewerUserId: null,
      currentSeason: null,
      seasons: [{ season: 2025, championName: 'Owls', championTeamUserIds: [null, null], championTeamName: null }],
      championships: [],
    })
    expect(r?.pennants[0]?.mine).toBe(false)
    expect(r?.openSeason).toBeNull()
  })
})

describe('summarizePickCapital', () => {
  const pick = (id: string, year: number, round: number, type: HubPick['type'] = 'own', fromTeam: string | null = null): HubPick => ({ id, year, round, type, fromTeam })

  it('none held → null (module hides)', () => {
    expect(summarizePickCapital([])).toBeNull()
    expect(summarizePickCapital([pick('a', 2027, 1, 'traded_away')])).toBeNull()
  })

  it('soonest first, R1 ahead, counts real years, overflow as "+N"', () => {
    const s = summarizePickCapital(
      [pick('a', 2028, 1), pick('b', 2027, 2), pick('c', 2027, 1, 'incoming', 'Owls'), pick('d', 2027, 1), pick('e', 2029, 3), pick('f', 2028, 2)],
      4,
    )
    expect(s?.total).toBe(6)
    expect(s?.years).toBe(3)
    expect(s?.chips.map((c) => c.id)).toEqual(['c', 'd', 'b', 'a'])
    expect(s?.more).toBe(2)
  })
})

describe('summarizePipeline', () => {
  const exp = (entries: Array<[string, number]>) => new Map(entries)

  it('counts taxi against slots, devy, and rookies from KNOWN experience only', () => {
    const s = summarizePipeline({
      players: [
        { playerId: 't1', lineupSection: 'taxi' },
        { playerId: 't2', lineupSection: 'taxi' },
        { playerId: 'd1', lineupSection: 'devy' },
        { playerId: 'b1', lineupSection: 'bench' },
        { playerId: 's1', lineupSection: 'starters' },
        { playerId: 's2', lineupSection: 'starters' },
      ],
      taxiSlots: 4,
      leagueHasDevy: true,
      // t1 and b1 are rookies, s1 is a veteran, t2 and s2 are unknown. d1 is college: never asked.
      yearsExpByPlayerId: exp([['t1', 0], ['b1', 0], ['s1', 6], ['d1', 0]]),
    })
    expect(s).toEqual({
      taxi: { count: 2, slots: 4 },
      devy: { count: 1 },
      rookies: { count: 2, unknown: 2 },
      rookiesUnknownOnly: 0,
    })
  })

  it('no known experience → no rookie row (never a confident zero)', () => {
    const s = summarizePipeline({
      players: [{ playerId: 't1', lineupSection: 'taxi' }],
      taxiSlots: 3,
      leagueHasDevy: false,
      yearsExpByPlayerId: exp([]),
    })
    expect(s?.rookies).toBeNull()
    expect(s?.rookiesUnknownOnly).toBe(1)
    expect(s?.devy).toBeNull()
  })

  it('nothing to count → null (module hides)', () => {
    expect(
      summarizePipeline({ players: [{ playerId: 'x', lineupSection: 'bench' }], taxiSlots: 0, leagueHasDevy: false, yearsExpByPlayerId: exp([]) }),
    ).toBeNull()
  })
})

describe('leagueRunsDevy', () => {
  it('devy variants and types only', () => {
    expect(leagueRunsDevy({ leagueVariant: 'devy_dynasty' })).toBe(true)
    expect(leagueRunsDevy({ leagueType: 'c2c' })).toBe(true)
    expect(leagueRunsDevy({ leagueVariant: 'dynasty', leagueType: 'dynasty' })).toBe(false)
    expect(leagueRunsDevy({})).toBe(false)
  })
})
