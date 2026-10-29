import { describe, expect, it } from 'vitest'

import {
  biggestBlowout,
  buildWeeklyHooks,
  currentStreak,
  draftSteals,
  guardHook,
  leaderVsCellar,
  oneManArmy,
  playoffHistory,
  renderTemplate,
  revengeGame,
  rivalryRecord,
  streaks,
  textIsSupportedByFacts,
  titleRematch,
  topHook,
} from '@/lib/storyline-studio/hookEngine'
import { standingsFromFixtures, unambiguousRosterMap } from '@/lib/storyline-studio/loadStoryData'
import type { StoryData, StoryFixture, StoryHook } from '@/lib/storyline-studio/types'

const M = { a: '1', b: '2' }

function data(over: Partial<StoryData> = {}): StoryData {
  const fixtures = over.fixtures ?? []
  return {
    leagueId: 'l1',
    sport: 'NFL',
    season: 2026,
    week: 8,
    teams: new Map([
      ['1', { key: '1', name: 'Hawks' }],
      ['2', { key: '2', name: 'Owls' }],
      ['3', { key: '3', name: 'Bears' }],
      ['4', { key: '4', name: 'Gridiron 99' }],
    ]),
    matchups: [M],
    fixtures,
    playoffs: [],
    playerWeeks: [],
    draftPicks: [],
    standings: standingsFromFixtures(fixtures, over.season ?? 2026),
    playerNames: new Map([
      ['p1', 'Joe Runner'],
      ['p2', 'Al Catcher'],
    ]),
    sources: { fixtures: 'dw_matchup_facts', playoffs: 'brackets', playerWeeks: 'lpws', draftPicks: 'draft_facts', standings: 'facts' },
    ...over,
  }
}

const g = (season: number, week: number, a: string, b: string, scoreA: number, scoreB: number, final = true): StoryFixture => ({
  season,
  week,
  a,
  b,
  scoreA,
  scoreB,
  final,
})

/** Every number in a hook's text is one of its facts. */
function assertGrounded(h: StoryHook) {
  expect(textIsSupportedByFacts(h.text, h.facts)).toBe(true)
  for (const f of h.facts) expect(f.source).toBeTruthy()
}

describe('rivalry record', () => {
  it('states the all-time lead and the last meeting, from the fixtures only', () => {
    const d = data({ fixtures: [g(2024, 3, '1', '2', 120, 100), g(2025, 5, '2', '1', 90.5, 110.2), g(2026, 2, '1', '2', 80, 95)] })
    const [h] = rivalryRecord(d, M, 'en')
    expect(h.kind).toBe('rivalry_record')
    expect(h.text).toBe('Hawks leads the all-time series with Owls 2-1. Last time out, in week 2 of 2026, Owls won 95-80.')
    assertGrounded(h)
  })

  it('says "dead even" on a tied series, and adds a streak hook at 3+', () => {
    const even = rivalryRecord(data({ fixtures: [g(2025, 1, '1', '2', 100, 90), g(2025, 9, '1', '2', 80, 90)] }), M, 'en')
    expect(even[0].text).toContain('dead even all-time at 1-1')
    const streak = rivalryRecord(
      data({ fixtures: [g(2023, 1, '1', '2', 100, 90), g(2024, 1, '1', '2', 100, 90), g(2025, 1, '1', '2', 100, 90)] }),
      M,
      'en',
    )
    expect(streak.map((h) => h.text)).toContain('Hawks has beaten Owls 3 straight times. Does the streak live another week?')
  })

  it('ignores unplayed fixtures entirely', () => {
    expect(rivalryRecord(data({ fixtures: [g(2026, 8, '1', '2', 0, 0, false)] }), M, 'en')).toEqual([])
  })
})

describe('playoff history and the title rematch', () => {
  it('names who eliminated whom, and a title game as a title game', () => {
    const elim = playoffHistory(data({ playoffs: [{ season: 2024, round: 1, winner: '2', loser: '1', title: false }] }), M, 'en')
    expect(elim[0].text).toBe('Playoff memory: Owls knocked Hawks out of the 2024 playoffs. Hawks has not forgotten.')
    const title = playoffHistory(data({ playoffs: [{ season: 2025, round: 3, winner: '1', loser: '2', title: true }] }), M, 'en')
    expect(title[0].text).toContain('2025 championship game')
    assertGrounded(title[0])
  })

  it('a rematch of last year’s title game quotes the final’s score', () => {
    const d = data({
      playoffs: [{ season: 2025, round: 3, winner: '1', loser: '2', title: true }],
      fixtures: [g(2025, 17, '1', '2', 140.6, 120.1)],
    })
    const [h] = titleRematch(d, M, 'en')
    expect(h.text).toBe('A rematch of the 2025 title game: Hawks beat Owls 140.6-120.1 for the crown. Can Owls get even?')
    assertGrounded(h)
  })

  it('🛑 a rematch whose final score was never stored is DROPPED, not filled in', () => {
    const d = data({ playoffs: [{ season: 2025, round: 3, winner: '1', loser: '2', title: true }], fixtures: [] })
    expect(titleRematch(d, M, 'en')).toEqual([])
  })
})

describe('revenge game', () => {
  it('a player who scored for the opponent last season now plays for the other side', () => {
    const d = data({
      playerWeeks: [
        { season: 2025, week: 1, team: '2', playerId: 'p1', points: 20, starter: true },
        { season: 2025, week: 2, team: '2', playerId: 'p1', points: 15.5, starter: true },
        { season: 2026, week: 6, team: '1', playerId: 'p1', points: 9, starter: true },
      ],
    })
    const [h] = revengeGame(d, M, 'en')
    expect(h.text).toBe(
      'Revenge game: Joe Runner played 2 weeks for Owls in 2025 and scored 35.5 points for them. Now he lines up for Hawks — against Owls. Roles have changed. Will he have the same success?',
    )
    expect(h.players).toEqual(['p1'])
    assertGrounded(h)
  })

  it('also catches a mid-season move, and skips a player with no name on file', () => {
    const d = data({
      playerWeeks: [
        { season: 2026, week: 2, team: '2', playerId: 'p2', points: 12, starter: true },
        { season: 2026, week: 6, team: '1', playerId: 'p2', points: 8, starter: true },
        { season: 2026, week: 2, team: '2', playerId: 'nameless', points: 30, starter: true },
        { season: 2026, week: 6, team: '1', playerId: 'nameless', points: 8, starter: true },
      ],
    })
    const hooks = revengeGame(d, M, 'en')
    expect(hooks).toHaveLength(1)
    expect(hooks[0].text).toContain('Al Catcher played a week for Owls in 2026')
  })
})

describe('draft steal', () => {
  const picks = Array.from({ length: 8 }, (_, r) => [
    { season: 2026, round: r + 1, pick: r * 2 + 1, team: '1', playerId: `a${r}` },
    { season: 2026, round: r + 1, pick: r * 2 + 2, team: '2', playerId: `b${r}` },
  ]).flat()

  it('a late-round pick near the top of the scoring is a steal', () => {
    const weeks = picks.map((p) => ({ season: 2026, week: 1, team: p.team, playerId: p.playerId, points: p.playerId === 'b7' ? 200 : 10, starter: true }))
    const names = new Map(picks.map((p) => [p.playerId, `Player ${p.playerId.toUpperCase()}`]))
    const [h] = draftSteals(data({ draftPicks: picks, playerWeeks: weeks, playerNames: names }), ['1', '2'], 'en', M)
    expect(h.text).toBe(
      'Owls drafted a late-round sleeper: Player B7 went in round 8 of the 2026 draft and has scored 200 points — number 1 among everyone drafted in this league.',
    )
    assertGrounded(h)
  })

  it('works for a first-season league with no history at all', () => {
    const weeks = picks.map((p) => ({ season: 2026, week: 1, team: p.team, playerId: p.playerId, points: p.playerId === 'a6' ? 99 : 5, starter: true }))
    const names = new Map(picks.map((p) => [p.playerId, `P ${p.playerId}`]))
    const hooks = buildWeeklyHooks(data({ draftPicks: picks, playerWeeks: weeks, playerNames: names }), 'en')
    expect(hooks.byMatchup[0].hooks.some((h) => h.kind === 'draft_steal')).toBe(true)
  })
})

describe('one-man army', () => {
  it('one starter outscoring the opponent’s entire lineup that week', () => {
    const d = data({
      playerWeeks: [
        { season: 2025, week: 4, team: '1', playerId: 'p1', points: 52.3, starter: true },
        { season: 2025, week: 4, team: '1', playerId: 'x', points: 40, starter: true },
        { season: 2025, week: 4, team: '2', playerId: 'y', points: 30, starter: true },
        { season: 2025, week: 4, team: '2', playerId: 'z', points: 18.1, starter: true },
        { season: 2025, week: 4, team: '2', playerId: 'bench', points: 60, starter: false },
      ],
    })
    const [h] = oneManArmy(d, M, 'en')
    expect(h.text).toBe('Week 4 of 2025: Joe Runner scored 52.3 for Hawks — by himself more than the entire Owls starting lineup (48.1).')
    assertGrounded(h)
  })
})

describe('streaks, top vs bottom and the blowout', () => {
  it('a hot team against a cold one', () => {
    const fixtures = [
      g(2026, 1, '1', '3', 100, 90), g(2026, 2, '1', '4', 100, 90), g(2026, 3, '1', '3', 100, 90),
      g(2026, 1, '2', '4', 80, 90), g(2026, 2, '2', '3', 80, 90), g(2026, 3, '2', '4', 80, 90),
    ]
    expect(currentStreak(fixtures, '1', 2026)).toBe(3)
    expect(currentStreak(fixtures, '2', 2026)).toBe(-3)
    const [h] = streaks(data({ fixtures }), M, 'en')
    expect(h.text).toBe('Hawks has won 3 straight. Owls has lost 3 straight. Something has to give.')
  })

  it('the points-for leader against the cellar', () => {
    const fixtures = [g(2026, 1, '1', '3', 150, 100), g(2026, 1, '2', '4', 60, 110), g(2026, 2, '1', '4', 140, 120), g(2026, 2, '2', '3', 70, 100)]
    const [h] = leaderVsCellar(data({ fixtures }), M, 'en')
    expect(h.text).toBe('Top vs bottom: Hawks leads the league with 290 points scored. Owls has 130 — the fewest in the league.')
    assertGrounded(h)
  })

  it('the biggest blowout needs two meetings and a real margin', () => {
    expect(biggestBlowout(data({ fixtures: [g(2025, 1, '1', '2', 150, 80)] }), M, 'en')).toEqual([])
    const [h] = biggestBlowout(data({ fixtures: [g(2025, 1, '1', '2', 150, 80), g(2025, 9, '2', '1', 101, 99)] }), M, 'en')
    expect(h.text).toBe('Biggest blowout in this series: Hawks beat Owls by 70 in week 1 of 2025 (150-80).')
  })
})

describe('the fact guard', () => {
  it('a template naming a fact that is missing renders nothing', () => {
    expect(renderTemplate('{team} scored {points}', [{ key: 'team', value: 'Hawks', source: 's' }])).toBeNull()
    expect(renderTemplate('{team} scored {points}', [{ key: 'team', value: 'Hawks', source: 's' }, { key: 'points', value: '', source: 's' }])).toBeNull()
  })

  it('a hook with a missing fact is dropped, not filled in', () => {
    const hook = guardHook(
      { id: 'x', kind: 'one_man_army', score: 1, season: 2026, week: 8, matchup: M, teams: [], players: [], facts: [{ key: 'week', value: 4, source: 's' }] },
      'one_man_army',
      'en',
    )
    expect(hook).toBeNull()
  })

  it('refuses text carrying a number that is not a fact — and allows a number inside a team name', () => {
    const facts = [
      { key: 'team', value: 'Gridiron 99', source: 's' },
      { key: 'points', value: 12.5, source: 's' },
    ]
    expect(textIsSupportedByFacts('Gridiron 99 scored 12.5', facts)).toBe(true)
    expect(textIsSupportedByFacts('Gridiron 99 scored 13', facts)).toBe(false)
  })

  it('every hook the engine emits passes the guard, in both languages', () => {
    const d = data({
      fixtures: [g(2024, 3, '1', '2', 120, 100), g(2025, 5, '2', '1', 90.5, 160.2), g(2026, 2, '1', '2', 80, 95)],
      playoffs: [{ season: 2024, round: 1, winner: '2', loser: '1', title: false }],
    })
    for (const lang of ['en', 'es'] as const) {
      const hooks = buildWeeklyHooks(d, lang).byMatchup[0].hooks
      expect(hooks.length).toBeGreaterThan(1)
      hooks.forEach(assertGrounded)
    }
    expect(buildWeeklyHooks(d, 'es').byMatchup[0].hooks.some((h) => h.text.includes('domina la serie'))).toBe(true)
  })
})

describe('ranking', () => {
  it('a title rematch outranks a plain rivalry line, and topHook returns it', () => {
    const d = data({
      playoffs: [{ season: 2025, round: 3, winner: '1', loser: '2', title: true }],
      fixtures: [g(2025, 17, '1', '2', 140, 120), g(2024, 1, '1', '2', 100, 90)],
    })
    const hooks = buildWeeklyHooks(d, 'en')
    expect(hooks.byMatchup[0].hooks[0].kind).toBe('title_rematch')
    expect(topHook(hooks)?.kind).toBe('title_rematch')
  })

  it('a league with no matchups this week gets league-wide hooks instead', () => {
    const picks = Array.from({ length: 6 }, (_, r) => ({ season: 2026, round: r + 1, pick: r + 1, team: '1', playerId: `q${r}` }))
    const weeks = picks.map((p) => ({ season: 2026, week: 1, team: '1', playerId: p.playerId, points: p.playerId === 'q5' ? 90 : 5, starter: true }))
    const out = buildWeeklyHooks(
      data({ matchups: [], draftPicks: picks, playerWeeks: weeks, playerNames: new Map(picks.map((p) => [p.playerId, p.playerId])) }),
      'en',
    )
    expect(out.byMatchup).toEqual([])
    expect(out.league[0]?.kind).toBe('draft_steal')
    expect(out.league[0]?.matchup).toBeNull()
  })
})

describe('the loader’s roster map', () => {
  it('drops historical ids that collide on one of today’s teams rather than guessing', () => {
    const m = unambiguousRosterMap({ '1': '1', '2': '5', '3': '5', '4': 'former:sleeper:9' })
    expect(m.get('1')).toBe('1')
    expect(m.has('2')).toBe(false)
    expect(m.has('3')).toBe(false)
    expect(m.get('4')).toBe('former:sleeper:9')
  })
})
