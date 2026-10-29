import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-runtime', () => ({ resolveCanonicalLeagueRules: vi.fn() }))

import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffRulesInput,
  type NflRedraftPlayoffRuntimeState,
  type NflRedraftPlayoffTeamInput,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import { applyDivisionsToTeams, resolveNflRedraftPlayoffRuntime } from '@/lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'
import {
  divisionCountAllowed,
  divisionRecords,
  evenDivisionSizes,
  groupStandingsByDivision,
  parseActiveLeagueDivisions,
  resolveRosterDivisions,
  validateDivisionSetup,
} from '@/lib/league/divisions/leagueDivisions'

/* ── fixtures ─────────────────────────────────────────────────────────── */

type PlayoffOpts = {
  teamCount: number
  reseed?: boolean
  divisionPlayoffRule?: 'top_seeds' | 'guaranteed' | 'none'
  thirdPlace?: boolean
  consolation?: boolean
  seedingRules?: string
}

function rules(o: PlayoffOpts): NflRedraftPlayoffRulesInput {
  return {
    general: { season: 2026, sport: 'NFL' },
    playoffs: {
      teamCount: o.teamCount,
      startWeek: 15,
      seedingRules: o.seedingRules ?? 'standard_standings',
      standingsTiebreakers: ['points_for', 'head_to_head', 'points_against'],
      reseedBehavior: o.reseed ? 'reseed_after_round' : 'fixed_bracket',
      thirdPlaceGameEnabled: o.thirdPlace ?? false,
      consolationBracketEnabled: o.consolation ?? false,
      ...(o.divisionPlayoffRule ? { divisionPlayoffRule: o.divisionPlayoffRule } : {}),
    },
    schedule: { regularSeasonLength: 14 },
  }
}

/** `n` teams, t1 best: wins fall by one, points by ten, so the record order is t1, t2, … */
function ladder(n: number, division?: (i: number) => string): NflRedraftPlayoffTeamInput[] {
  return Array.from({ length: n }, (_, i) => ({
    rosterId: `t${i + 1}`,
    displayName: `Team ${i + 1}`,
    wins: 13 - i,
    losses: 1 + i,
    pointsFor: 1500 - i * 10,
    divisionId: division ? division(i) : null,
  }))
}

function build(teams: NflRedraftPlayoffTeamInput[], o: PlayoffOpts): NflRedraftPlayoffRuntimeState {
  const state = buildNflRedraftPlayoffRuntimeState({
    leagueId: 'lg',
    seasonId: 'sn',
    season: 2026,
    week: 15,
    rules: rules(o),
    teams,
    now: new Date('2026-12-01T00:00:00.000Z'),
  })
  return { ...state, bracket: generateNflRedraftPlayoffBracket({ state }).bracket }
}

/**
 * Score the active championship round so the team in `winners` wins each game it is in; otherwise
 * the better seed wins. Byes stay byes.
 */
function play(state: NflRedraftPlayoffRuntimeState, winners: string[] = []): NflRedraftPlayoffRuntimeState {
  const decide = <T extends NflRedraftPlayoffRuntimeState['bracket']['rounds'][number]['matchups'][number]>(m: T): T => {
    if (m.bye || !m.homeRosterId || !m.awayRosterId) return m
    const homeWins = winners.includes(m.homeRosterId) || (!winners.includes(m.awayRosterId) && (m.homeSeed ?? 99) < (m.awaySeed ?? 99))
    return { ...m, homeScore: homeWins ? 110 : 90, awayScore: homeWins ? 90 : 110, status: 'final' }
  }
  const active = state.bracket.rounds.find((r) => r.status === 'active')
  return {
    ...state,
    bracket: {
      ...state.bracket,
      rounds: state.bracket.rounds.map((r) => (r === active ? { ...r, matchups: r.matchups.map(decide) } : r)),
      thirdPlaceMatchup: state.bracket.thirdPlaceMatchup && active === state.bracket.rounds[state.bracket.rounds.length - 1]
        ? decide(state.bracket.thirdPlaceMatchup)
        : state.bracket.thirdPlaceMatchup,
      consolationRounds: state.bracket.consolationRounds.map((r) =>
        active && r.roundNumber === active.roundNumber ? { ...r, matchups: r.matchups.map(decide) } : r,
      ),
    },
  }
}

function advance(state: NflRedraftPlayoffRuntimeState, winners: string[] = []): NflRedraftPlayoffRuntimeState {
  const result = advanceNflRedraftPlayoffRound({ state: play(state, winners) })
  if (!result.ok) throw new Error(`advance failed: ${result.code} ${result.message}`)
  return result.state
}

/** A round's games as "home-away" seed pairs. */
function pairs(state: NflRedraftPlayoffRuntimeState, roundIndex: number): string[] {
  // A bye row keeps its empty slot's seed number; show it as '-'.
  return state.bracket.rounds[roundIndex].matchups.map((m) => `${m.homeRosterId ? m.homeSeed : '-'}v${m.awayRosterId ? m.awaySeed : '-'}`)
}

/* ── divisions: setup validation ───────────────────────────────────────── */

describe('division setup validation', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `team-${i + 1}`)
  const assign = (n: number, pattern: number[]) => Object.fromEntries(ids(n).map((id, i) => [id, pattern[i]]))

  it('allows 2–4 divisions only when every division can hold two teams', () => {
    expect(divisionCountAllowed(4, 2)).toBe(true)
    expect(divisionCountAllowed(4, 3)).toBe(false)
    expect(divisionCountAllowed(5, 2)).toBe(true)
    expect(divisionCountAllowed(7, 4)).toBe(false)
    expect(divisionCountAllowed(8, 4)).toBe(true)
    expect(divisionCountAllowed(20, 4)).toBe(true)
    expect(divisionCountAllowed(16, 8)).toBe(false)
    expect(validateDivisionSetup({ count: 3, names: ['A', 'B', 'C'], teamAssignments: {} }, ids(4))).toMatchObject({ ok: false, code: 'TOO_FEW_TEAMS' })
    expect(validateDivisionSetup({ count: 8, names: [], teamAssignments: {} }, ids(16))).toMatchObject({ ok: false, code: 'COUNT_NOT_ALLOWED' })
    expect(validateDivisionSetup({ count: 0, names: [], teamAssignments: {} }, ids(4))).toEqual({ ok: true })
  })

  it('names the even split for any league size', () => {
    expect(evenDivisionSizes(10, 2)).toEqual([5, 5])
    expect(evenDivisionSizes(10, 3)).toEqual([4, 3, 3])
    expect(evenDivisionSizes(14, 4)).toEqual([4, 4, 3, 3])
    expect(evenDivisionSizes(5, 2)).toEqual([3, 2])
  })

  it('refuses uneven divisions and accepts a split within one team', () => {
    const names = ['East', 'West']
    expect(validateDivisionSetup({ count: 2, names, teamAssignments: assign(10, [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]) }, ids(10))).toEqual({ ok: true })
    expect(validateDivisionSetup({ count: 2, names, teamAssignments: assign(5, [0, 0, 0, 1, 1]) }, ids(5))).toEqual({ ok: true })
    const sixFour = validateDivisionSetup({ count: 2, names, teamAssignments: assign(10, [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]) }, ids(10))
    expect(sixFour).toMatchObject({ ok: false, code: 'UNEVEN' })
    if (!sixFour.ok) expect(sixFour.error).toContain('5 + 5')
    // 3+3+3+1: every division is under the cap of 3, but complete and two apart.
    expect(
      validateDivisionSetup({ count: 4, names: ['A', 'B', 'C', 'D'], teamAssignments: assign(10, [0, 0, 0, 1, 1, 1, 2, 2, 2, 3]) }, ids(10)),
    ).toMatchObject({ ok: false, code: 'UNEVEN' })
  })

  it('lets a league save while teams are still unassigned, but never over the per-division cap', () => {
    const partial = { 'team-1': 0, 'team-2': 0, 'team-3': 1 }
    expect(validateDivisionSetup({ count: 2, names: ['East', 'West'], teamAssignments: partial }, ids(10))).toEqual({ ok: true })
    const overCap = assign(10, [0, 0, 0, 0, 0, 0])
    for (const k of Object.keys(overCap)) if (overCap[k] === undefined) delete overCap[k]
    expect(validateDivisionSetup({ count: 2, names: ['East', 'West'], teamAssignments: overCap }, ids(10))).toMatchObject({ ok: false, code: 'UNEVEN' })
  })

  it('requires unique names, real teams and real divisions', () => {
    expect(validateDivisionSetup({ count: 2, names: ['East', 'east'], teamAssignments: {} }, ids(4))).toMatchObject({ code: 'NAME_DUPLICATE' })
    expect(validateDivisionSetup({ count: 2, names: ['East', ' '], teamAssignments: {} }, ids(4))).toMatchObject({ code: 'NAME_REQUIRED' })
    expect(validateDivisionSetup({ count: 2, names: ['East', 'West'], teamAssignments: { ghost: 0 } }, ids(4))).toMatchObject({ code: 'UNKNOWN_TEAM' })
    expect(validateDivisionSetup({ count: 2, names: ['East', 'West'], teamAssignments: { 'team-1': 2 } }, ids(4))).toMatchObject({ code: 'BAD_DIVISION' })
    expect(validateDivisionSetup({ count: 2, names: ['East', 'West'], teamAssignments: {}, playoffRule: 'bye' }, ids(4))).toMatchObject({ code: 'BAD_PLAYOFF_RULE' })
  })
})

/* ── divisions: reading, standings and records ────────────────────────── */

describe('division standings', () => {
  const settings = {
    division_config: {
      count: 2,
      names: ['North', 'South'],
      teamAssignments: { 'lt-a': 0, 'lt-b': 0, 'lt-c': 1, 'lt-d': 1 },
      playoffRule: 'guaranteed',
    },
  }

  it('reads the stored config, defaulting the playoff rule to top seeds', () => {
    const active = parseActiveLeagueDivisions(settings)
    expect(active?.divisions.map((d) => d.name)).toEqual(['North', 'South'])
    expect(active?.playoffRule).toBe('guaranteed')
    const noRule = parseActiveLeagueDivisions({ division_config: { ...settings.division_config, playoffRule: undefined } })
    expect(noRule?.playoffRule).toBe('top_seeds')
    expect(parseActiveLeagueDivisions({ division_config: { count: 0, names: [], teamAssignments: {} } })).toBeNull()
    expect(parseActiveLeagueDivisions({ division_config: { count: 2, names: ['a', 'b'], teamAssignments: {} } })).toBeNull()
    expect(parseActiveLeagueDivisions({})).toBeNull()
  })

  it('maps a roster to its league team by externalId, owner id or the team id itself', () => {
    const active = parseActiveLeagueDivisions(settings)!
    const teams = [
      { id: 'lt-a', externalId: 'roster-a', claimedByUserId: null, platformUserId: null },
      { id: 'lt-b', externalId: null, claimedByUserId: 'user-b', platformUserId: null },
      { id: 'lt-c', externalId: null, claimedByUserId: null, platformUserId: 'user-c' },
      { id: 'lt-d', externalId: null, claimedByUserId: null, platformUserId: null },
    ]
    const byRoster = resolveRosterDivisions(active, teams, [
      { rosterId: 'roster-a', ids: [] },
      { rosterId: 'rr-b', ids: ['user-b'] },
      { rosterId: 'rr-c', ids: ['user-c'] },
      { rosterId: 'lt-d', ids: [] },
      { rosterId: 'stranger', ids: ['nobody'] },
    ])
    expect(Object.fromEntries([...byRoster].map(([k, v]) => [k, v.name]))).toEqual({
      'roster-a': 'North',
      'rr-b': 'North',
      'rr-c': 'South',
      'lt-d': 'South',
    })
  })

  it('splits the overall table into division tables in overall order', () => {
    const overall = [{ rosterId: 'c' }, { rosterId: 'a' }, { rosterId: 'd' }, { rosterId: 'b' }, { rosterId: 'x' }]
    const of = (id: string) => ({ a: 'div-1', b: 'div-1', c: 'div-2', d: 'div-2' } as Record<string, string>)[id] ?? null
    const groups = groupStandingsByDivision(overall, [{ key: 'div-1', index: 0, name: 'North' }, { key: 'div-2', index: 1, name: 'South' }], of)
    expect(groups.map((g) => [g.name, g.rows.map((r) => `${r.divisionRank}:${r.rosterId}`)])).toEqual([
      ['North', ['1:a', '2:b']],
      ['South', ['1:c', '2:d']],
    ])
  })

  it('counts only games between division rivals in the division record', () => {
    const of = (id: string) => ({ a: 'n', b: 'n', c: 's' } as Record<string, string>)[id] ?? null
    const records = divisionRecords(
      [
        { homeRosterId: 'a', awayRosterId: 'b', homeScore: 100, awayScore: 90 },
        { homeRosterId: 'b', awayRosterId: 'a', homeScore: 80, awayScore: 80 },
        { homeRosterId: 'a', awayRosterId: 'c', homeScore: 50, awayScore: 99 },
      ],
      of,
    )
    expect(records.get('a')).toEqual({ wins: 1, losses: 0, ties: 1 })
    expect(records.get('b')).toEqual({ wins: 0, losses: 1, ties: 1 })
    expect(records.get('c')).toBeUndefined()
  })

  it('breaks a tie for the division title with the league tiebreakers', () => {
    // n1 and n2 share the best North record; n2 has more points (points_for is the first tiebreaker).
    const teams: NflRedraftPlayoffTeamInput[] = [
      { rosterId: 'n1', wins: 9, losses: 5, pointsFor: 1400, divisionId: 'north' },
      { rosterId: 'n2', wins: 9, losses: 5, pointsFor: 1450, divisionId: 'north' },
      { rosterId: 's1', wins: 12, losses: 2, pointsFor: 1500, divisionId: 'south' },
      { rosterId: 's2', wins: 11, losses: 3, pointsFor: 1490, divisionId: 'south' },
      { rosterId: 's3', wins: 10, losses: 4, pointsFor: 1480, divisionId: 'south' },
      { rosterId: 'n3', wins: 3, losses: 11, pointsFor: 1100, divisionId: 'north' },
    ]
    const state = build(teams, { teamCount: 2, divisionPlayoffRule: 'top_seeds' })
    expect(state.seeds.map((s) => [s.seed, s.rosterId, s.qualifiedBy])).toEqual([
      [1, 's1', 'division'],
      [2, 'n2', 'division'],
    ])
  })
})

/* ── divisions: playoff rule ──────────────────────────────────────────── */

describe('division winners in the playoffs', () => {
  // East: e1 (12-2) e2 (11-3) e3 (10-4). West: w1 (7-7, a weak winner) w2 (5-9) w3 (4-10).
  const teams: NflRedraftPlayoffTeamInput[] = [
    { rosterId: 'e1', wins: 12, losses: 2, pointsFor: 1500, divisionId: 'east' },
    { rosterId: 'e2', wins: 11, losses: 3, pointsFor: 1490, divisionId: 'east' },
    { rosterId: 'e3', wins: 10, losses: 4, pointsFor: 1480, divisionId: 'east' },
    { rosterId: 'w1', wins: 7, losses: 7, pointsFor: 1300, divisionId: 'west' },
    { rosterId: 'w2', wins: 5, losses: 9, pointsFor: 1200, divisionId: 'west' },
    { rosterId: 'w3', wins: 4, losses: 10, pointsFor: 1100, divisionId: 'west' },
  ]

  it('gives division winners the top seeds by default, ahead of better wildcards', () => {
    const state = build(teams, { teamCount: 4, divisionPlayoffRule: 'top_seeds' })
    expect(state.settings).toMatchObject({ divisionWinnersEnabled: true, divisionWinnersTopSeeds: true })
    expect(state.seeds.map((s) => [s.seed, s.rosterId, s.qualifiedBy])).toEqual([
      [1, 'e1', 'division'],
      [2, 'w1', 'division'],
      [3, 'e2', 'wildcard'],
      [4, 'e3', 'wildcard'],
    ])
    // Seeds are what round 1 is built from: 1 hosts 4, 2 hosts 3.
    expect(pairs(state, 0)).toEqual(['1v4', '2v3'])
  })

  it('guarantees division winners a spot but seeds the field by record', () => {
    const state = build(teams, { teamCount: 3, divisionPlayoffRule: 'guaranteed' })
    expect(state.settings).toMatchObject({ divisionWinnersEnabled: true, divisionWinnersTopSeeds: false })
    // w1 is in although e3 has the better record, and w1 is seeded last because its record is worst.
    expect(state.seeds.map((s) => [s.seed, s.rosterId, s.qualifiedBy])).toEqual([
      [1, 'e1', 'division'],
      [2, 'e2', 'wildcard'],
      [3, 'w1', 'division'],
    ])
  })

  it('ignores divisions for seeding when the rule is none', () => {
    const state = build(teams, { teamCount: 3, divisionPlayoffRule: 'none' })
    expect(state.settings.divisionWinnersEnabled).toBe(false)
    expect(state.seeds.map((s) => s.rosterId)).toEqual(['e1', 'e2', 'e3'])
  })

  it('keeps the legacy reading when no rule is passed: a division seeding rule means guaranteed', () => {
    const state = build(teams, { teamCount: 3, seedingRules: 'division_winners_then_standings' })
    expect(state.settings).toMatchObject({ divisionWinnersEnabled: true, divisionWinnersTopSeeds: false })
    expect(state.seeds.map((s) => s.rosterId)).toEqual(['e1', 'e2', 'w1'])
  })
})

/* ── reseeding ────────────────────────────────────────────────────────── */

describe('playoff reseeding', () => {
  it('re-pairs best remaining vs worst remaining at 8 teams, and the fixed tree does not', () => {
    // Round 1: 1v8, 4v5, 2v7, 3v6. Upsets: 8 beats 1, 7 beats 2.
    const upsets = ['t8', 't7']
    const fixed = advance(build(ladder(8), { teamCount: 8 }), upsets)
    const reseeded = advance(build(ladder(8), { teamCount: 8, reseed: true }), upsets)
    expect(pairs(fixed, 0)).toEqual(['1v8', '4v5', '2v7', '3v6'])
    expect(pairs(reseeded, 0)).toEqual(pairs(fixed, 0))
    expect(pairs(fixed, 1)).toEqual(['8v4', '7v3'])
    expect(pairs(reseeded, 1)).toEqual(['3v8', '4v7'])
    expect(reseeded.bracket.rounds[1].matchups.every((m) => m.metadata.reseeded === true)).toBe(true)
  })

  it('sends the top seed to the lowest survivor after the byes at 6 teams (top two seeds on byes)', () => {
    // Round 1: 1 bye, 4v5, 2 bye, 3v6. 6 upsets 3.
    const fixed = build(ladder(6), { teamCount: 6 })
    const reseed = build(ladder(6), { teamCount: 6, reseed: true })
    expect(fixed.settings.firstRoundByes).toBe(2)
    expect(pairs(reseed, 0)).toEqual(['1v-', '4v5', '2v-', '3v6'])
    expect(pairs(advance(fixed, ['t6']), 1)).toEqual(['1v4', '2v6'])
    expect(pairs(advance(reseed, ['t6']), 1)).toEqual(['1v6', '2v4'])
  })

  it('at 4 teams (no byes) the final is the two survivors, better seed at home', () => {
    const reseed = advance(build(ladder(4), { teamCount: 4, reseed: true }), ['t4', 't3'])
    expect(pairs(reseed, 0)).toEqual(['1v4', '2v3'])
    expect(pairs(reseed, 1)).toEqual(['3v4'])
    const fixed = advance(build(ladder(4), { teamCount: 4 }), ['t4', 't3'])
    expect(pairs(fixed, 1)).toEqual(['4v3'])
  })

  it('handles an odd field (5 teams, three byes)', () => {
    const reseed = build(ladder(5), { teamCount: 5, reseed: true })
    expect(pairs(reseed, 0)).toEqual(['1v-', '4v5', '2v-', '3v-'])
    expect(pairs(advance(reseed, ['t5']), 1)).toEqual(['1v5', '2v3'])
  })

  it('keeps the seeds locked from the playoff start; reseeding only re-pairs', () => {
    const start = build(ladder(8), { teamCount: 8, reseed: true })
    // A mid-playoff standings recompute (a division reassignment, a tiebreaker edit) reverses the
    // computed seeds. The bracket's own round-1 seeds must still decide the pairing.
    const drifted = { ...start, seeds: start.seeds.map((s, i, all) => ({ ...s, seed: all.length - i })) }
    const next = advance(drifted, ['t8', 't7'])
    expect(pairs(next, 1)).toEqual(['3v8', '4v7'])
  })

  it('fills the third-place game from the semifinal losers by locked seed', () => {
    let state = build(ladder(8), { teamCount: 8, reseed: true, thirdPlace: true })
    state = advance(state, ['t8', 't7'])
    state = advance(state) // semifinals 3v8, 4v7: 3 and 4 win
    expect(state.bracket.thirdPlaceMatchup).toMatchObject({ homeSeed: 7, awaySeed: 8 })
    expect(pairs(state, 2)).toEqual(['3v4'])
  })

  it('leaves the consolation bracket on its fixed tree', () => {
    const run = (reseed: boolean) => {
      let state = build(ladder(12), { teamCount: 4, reseed, consolation: true })
      state = advance(state, ['t4'])
      return state.bracket.consolationRounds.map((r) => r.matchups.map((m) => `${m.homeRosterId}-${m.awayRosterId}`))
    }
    expect(run(true)).toEqual(run(false))
  })

  it('reseed off leaves the bracket exactly as before', () => {
    const state = build(ladder(8), { teamCount: 8 })
    expect(state.settings.reseedAfterEachRound).toBe(false)
    const next = advanceNflRedraftPlayoffRound({ state: play(state, ['t8', 't7']) })
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.events.map((e) => e.type)).not.toContain('playoffs.reseeded')
    expect(next.state.bracket.rounds[1].matchups.some((m) => m.metadata.reseeded)).toBe(false)
    // The winners went where round 1's next-matchup links sent them.
    for (const m of next.state.bracket.rounds[0].matchups) {
      const target = next.state.bracket.rounds[1].matchups.find((row) => row.matchupId === m.nextMatchupId)
      expect([target?.homeRosterId, target?.awayRosterId]).toContain(m.winnerRosterId)
    }
  })

  it('reads the in-app panel\'s "Re-seed" (seedingRules: reseed) as reseeding', () => {
    const state = build(ladder(8), { teamCount: 8, seedingRules: 'reseed' })
    expect(state.settings.reseedAfterEachRound).toBe(true)
  })
})

/* ── resolver wiring ──────────────────────────────────────────────────── */

describe('playoff resolver with divisions', () => {
  const roster = (id: string, wins: number, pointsFor: number) => ({
    id, ownerId: `o-${id}`, ownerName: id, teamName: id, wins, losses: 14 - wins, ties: 0,
    pointsFor, pointsAgainst: 0, playoffSeed: null, isEliminated: false,
  })
  const season = {
    id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, status: 'active',
    currentWeek: 15, playoffStartWeek: 15, totalWeeks: 17,
    rosters: [roster('a', 12, 1500), roster('b', 11, 1490), roster('c', 10, 1480), roster('d', 6, 1300)],
    playoffRounds: [], playoffBracket: null,
  }
  const loadRules = async () => ({
    general: { sport: 'NFL', format: 'redraft' },
    playoffs: { teamCount: 2, seedingRules: 'standard_standings', standingsTiebreakers: ['points_for'] },
    schedule: { regularSeasonLength: 14 },
  }) as never
  const divisions = {
    playoffRule: 'top_seeds' as const,
    divisions: [{ key: 'div-1', index: 0, name: 'East' }, { key: 'div-2', index: 1, name: 'West' }],
    byRoster: new Map([
      ['a', { key: 'div-1', index: 0, name: 'East' }],
      ['b', { key: 'div-1', index: 0, name: 'East' }],
      ['c', { key: 'div-1', index: 0, name: 'East' }],
      ['d', { key: 'div-2', index: 1, name: 'West' }],
    ]),
  }

  it('seeds the commissioner\'s division winners on top', async () => {
    const resolved = await resolveNflRedraftPlayoffRuntime(
      { preloadedSeason: season as never },
      { loadRules, loadRegularSeasonMatchups: async () => [], loadDivisions: async () => divisions },
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.seeds.map((s) => [s.rosterId, s.qualifiedBy])).toEqual([['a', 'division'], ['d', 'division']])
    expect(resolved.state.teams.find((t) => t.rosterId === 'd')?.divisionName).toBe('West')
  })

  it('seeds by record with no divisions (positive control for the case above)', async () => {
    const resolved = await resolveNflRedraftPlayoffRuntime(
      { preloadedSeason: season as never },
      { loadRules, loadRegularSeasonMatchups: async () => [], loadDivisions: async () => null },
    )
    expect(resolved.ok && resolved.state.seeds.map((s) => s.rosterId)).toEqual(['a', 'b'])
  })

  it('computes division records from final regular-season games only', () => {
    const teams = applyDivisionsToTeams(
      [{ rosterId: 'a' }, { rosterId: 'b' }, { rosterId: 'd' }],
      divisions,
      [
        { week: 1, type: 'regular', status: 'final', homeRosterId: 'a', awayRosterId: 'b', homeScore: 100, awayScore: 90 },
        { week: 2, type: 'regular', status: 'scheduled', homeRosterId: 'b', awayRosterId: 'a', homeScore: 0, awayScore: 0 },
        { week: 3, type: 'regular', status: 'final', homeRosterId: 'a', awayRosterId: 'd', homeScore: 100, awayScore: 90 },
        { week: 4, type: 'regular', status: 'final', isMedianMatchup: true, homeRosterId: 'a', awayRosterId: 'b', homeScore: 10, awayScore: 90 },
      ],
    )
    expect(teams.map((t) => [t.rosterId, t.divisionId, t.divisionWins, t.divisionLosses])).toEqual([
      ['a', 'div-1', 1, 0],
      ['b', 'div-1', 0, 1],
      ['d', 'div-2', 0, 0],
    ])
  })

  it('keeps the reseed choice a generated bracket was built with', async () => {
    const withBracket = {
      ...season,
      playoffBracket: { id: 'br', status: 'active', structure: { reseedAfterEachRound: true } },
      playoffRounds: [
        {
          id: 'r1', roundNumber: 1, roundName: 'Championship', status: 'active',
          matchups: [{ id: 'm1', matchupNumber: 1, homeRosterId: 'a', awayRosterId: 'b', homeSeed: 1, awaySeed: 2, homeScore: null, awayScore: null, winnerRosterId: null, nextMatchupId: null, status: 'scheduled', metadata: {} }],
        },
      ],
    }
    const resolved = await resolveNflRedraftPlayoffRuntime(
      { preloadedSeason: withBracket as never },
      { loadRules, loadRegularSeasonMatchups: async () => [], loadDivisions: async () => null },
    )
    expect(resolved.ok && resolved.state.settings.reseedAfterEachRound).toBe(true)
    const regenerating = await resolveNflRedraftPlayoffRuntime(
      { preloadedSeason: withBracket as never, ignoreStoredBracketSettings: true },
      { loadRules, loadRegularSeasonMatchups: async () => [], loadDivisions: async () => null },
    )
    expect(regenerating.ok && regenerating.state.settings.reseedAfterEachRound).toBe(false)
  })
})
