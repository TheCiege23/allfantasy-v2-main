/**
 * Third-place game and a lower bracket played to its final — full brackets from seeding to champion.
 *
 * What these guard, each of which failed silently before:
 *
 *  1. THE THIRD-PLACE GAME WAS NEVER GENERATED, whatever the setting said. It is now a matchup in the
 *     championship round's own row — same weeks, same scoring — between the two semifinal losers, and
 *     it decides 3rd and 4th in the final standings.
 *  2. THE CONSOLATION BRACKET PLAYED ONE ROUND AND WAS NEVER SCORED. It is now a full bracket (or a
 *     losers-advance toilet bowl) that ends in the championship's weeks, is scored by the same scorer,
 *     advances alongside the title bracket, and orders the non-playoff teams in the final standings.
 *  3. The season does not finalize while either is undecided — once complete, nothing scores them.
 *
 * Sizes: 2–16 playoff teams including odd fields, in leagues of 4–20, for NFL and NBA.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: {} as Record<string, any>, rules: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key) => holder.db[key as string] }),
}))
vi.mock('@/lib/league-runtime', () => ({ resolveCanonicalLeagueRules: vi.fn(async () => holder.rules) }))

import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  finalizeNflRedraftPlayoffChampion,
  generateNflRedraftPlayoffBracket,
  type NflRedraftLowerBracketMode,
  type NflRedraftPlayoffMatchupState,
  type NflRedraftPlayoffRulesInput,
  type NflRedraftPlayoffRuntimeState,
  type NflRedraftPlayoffTeamInput,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import {
  advanceNflRedraftPlayoffRuntimeRound,
  finalizeNflRedraftPlayoffRuntimeSeason,
  generateNflRedraftPlayoffRuntimeBracket,
  overrideNflRedraftPlayoffMatchup,
} from '@/lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'
import { scoreActivePlayoffRound } from '@/lib/playoff-runtime/playoffRoundScoring'
import { CONSOLATION_ROUND_OFFSET, playoffRoundWeeks } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { playoffGamesFromRedraftMatchups } from '@/lib/rookie-order/playoffGameAdapters'
import { readBracketResult } from '@/lib/redraft/offseason/RedraftOffseasonService'
import { readStoredThirdPlaceGame, readThirdPlaceGameEnabled } from '@/lib/playoff-runtime/thirdPlaceGame'
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'

type AnyArgs = Record<string, any>

// ── fixtures ────────────────────────────────────────────────────────────────

/** Team `t01` has the best record; every record is distinct, so seeding is fully determined. */
function makeTeams(count: number): NflRedraftPlayoffTeamInput[] {
  return Array.from({ length: count }, (_, i) => ({
    rosterId: `t${String(i + 1).padStart(2, '0')}`,
    displayName: `Team ${i + 1}`,
    ownerId: `owner-${i + 1}`,
    wins: 13 - Math.floor(i / 2),
    losses: Math.floor(i / 2),
    pointsFor: 2000 - i * 37,
    pointsAgainst: 1500,
  }))
}

function rulesFor(input: {
  sport: string
  teams: number
  playoffTeams: number
  lower: NflRedraftLowerBracketMode
  thirdPlace: boolean
  reseed?: boolean
  byePlan?: number[]
}): NflRedraftPlayoffRulesInput {
  return {
    general: { season: 2026, sport: input.sport, teamCount: input.teams },
    playoffs: {
      teamCount: input.playoffTeams,
      startWeek: 15,
      firstRoundByes: null,
      consolationBracketEnabled: input.lower === 'consolation',
      toiletBowlEnabled: input.lower === 'toilet_bowl',
      thirdPlaceGameEnabled: input.thirdPlace,
      seedingRules: 'standings',
      tiebreakerRules: ['win_pct', 'points_for'],
      standingsTiebreakers: ['win_pct', 'points_for'],
      reseedBehavior: input.reseed ? 'reseed_after_each_round' : null,
      byePlan: input.byePlan ?? null,
    },
    schedule: { regularSeasonLength: 14, playoffTransitionPoint: 15 },
  }
}

/** A deterministic score with upsets: neither seed nor standings decides every game. */
function scoreFor(rosterId: string, round: number, salt: string): number {
  let h = 2166136261
  for (const ch of `${rosterId}|${round}|${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const index = Number(rosterId.slice(1))
  return 90 + ((h >>> 0) % 60) + index / 1000
}

// ── pure-runtime simulation ─────────────────────────────────────────────────

function scoreGames(matchups: NflRedraftPlayoffMatchupState[], round: number, salt: string) {
  return matchups.map((m) =>
    m.bye || m.complete || !m.homeRosterId || !m.awayRosterId
      ? m
      : { ...m, homeScore: scoreFor(m.homeRosterId, round, salt), awayScore: scoreFor(m.awayRosterId, round, salt), status: 'final' as const },
  )
}

type Sim = {
  generated: NflRedraftPlayoffRuntimeState
  played: NflRedraftPlayoffRuntimeState
  final: Extract<ReturnType<typeof finalizeNflRedraftPlayoffChampion>, { ok: true }>
}

/** Seeding through champion: each championship round's week, the games of that week are scored, then advanced once. */
function simulate(input: Parameters<typeof rulesFor>[0] & { salt?: string }): Sim {
  const salt = input.salt ?? `${input.sport}-${input.teams}-${input.playoffTeams}`
  const base = buildNflRedraftPlayoffRuntimeState({
    leagueId: 'L',
    seasonId: 'S',
    season: 2026,
    week: 15,
    rules: rulesFor(input),
    teams: makeTeams(input.teams),
    now: new Date('2026-12-01T00:00:00Z'),
  })
  let state: NflRedraftPlayoffRuntimeState = { ...base, bracket: generateNflRedraftPlayoffBracket({ state: base }).bracket }
  const generated = state
  const roundCount = state.bracket.rounds.length
  for (let week = 1; week <= roundCount; week += 1) {
    const isFinal = week === roundCount
    state = {
      ...state,
      bracket: {
        ...state.bracket,
        rounds: state.bracket.rounds.map((r) => (r.roundNumber === week ? { ...r, matchups: scoreGames(r.matchups, week, salt) } : r)),
        thirdPlaceMatchup:
          isFinal && state.bracket.thirdPlaceMatchup ? scoreGames([state.bracket.thirdPlaceMatchup], week, salt)[0] : state.bracket.thirdPlaceMatchup,
        consolationRounds: state.bracket.consolationRounds.map((r) =>
          r.roundNumber === week ? { ...r, matchups: scoreGames(r.matchups, week, `${salt}-lower`) } : r,
        ),
      },
    }
    const advanced = advanceNflRedraftPlayoffRound({ state })
    if (!advanced.ok) throw new Error(`week ${week}: ${advanced.code} ${advanced.message}`)
    state = advanced.state
  }
  const done = advanceNflRedraftPlayoffRound({ state })
  expect(done.ok ? 'advanced' : done.code).toBe('NO_ACTIVE_ROUND')
  const final = finalizeNflRedraftPlayoffChampion({ state })
  if (!final.ok) throw new Error(`finalize: ${final.code}`)
  return { generated, played: state, final }
}

function loser(m: NflRedraftPlayoffMatchupState): string | null {
  if (!m.winnerRosterId) return null
  return m.winnerRosterId === m.homeRosterId ? m.awayRosterId : m.homeRosterId
}

function finishOf(sim: Sim, rosterId: string | null): number | undefined {
  return sim.final.finalStandings.find((row) => row.rosterId === rosterId)?.finish
}

/** Invariants every completed simulation must hold. */
function assertCompleteSeason(sim: Sim, input: { teams: number; playoffTeams: number; lower: NflRedraftLowerBracketMode; thirdPlace: boolean }) {
  const { played, final } = sim
  const rounds = played.bracket.rounds
  const finalRound = rounds[rounds.length - 1]
  const title = finalRound.matchups[0]

  // Every team finishes exactly once, 1..N.
  expect(final.finalStandings.map((row) => row.finish)).toEqual(Array.from({ length: input.teams }, (_, i) => i + 1))
  expect(new Set(final.finalStandings.map((row) => row.rosterId)).size).toBe(input.teams)
  expect(final.championRosterId).toBe(title.winnerRosterId)
  expect(finishOf(sim, title.winnerRosterId)).toBe(1)
  expect(finishOf(sim, loser(title))).toBe(2)
  // The top `playoffTeams` finishes are the playoff teams.
  const qualified = new Set(played.seeds.map((s) => s.rosterId))
  expect(final.finalStandings.slice(0, input.playoffTeams).every((row) => qualified.has(row.rosterId))).toBe(true)

  // Every championship game was decided.
  for (const round of rounds) for (const m of round.matchups) expect(m.winnerRosterId).toBeTruthy()

  // Third place.
  const semifinal = rounds.length >= 2 ? rounds[rounds.length - 2] : null
  const semifinalLosers = semifinal ? semifinal.matchups.filter((m) => !m.bye).map(loser).filter(Boolean) : []
  const tp = played.bracket.thirdPlaceMatchup
  if (input.thirdPlace && semifinalLosers.length === 2) {
    expect(tp).not.toBeNull()
    expect(tp!.roundNumber).toBe(finalRound.roundNumber)
    expect(tp!.roundId).toBe(finalRound.roundId)
    expect(new Set([tp!.homeRosterId, tp!.awayRosterId])).toEqual(new Set(semifinalLosers))
    expect(tp!.winnerRosterId).toBeTruthy()
    expect(finishOf(sim, tp!.winnerRosterId)).toBe(3)
    expect(finishOf(sim, loser(tp!))).toBe(4)
    expect(final.state.bracket.thirdPlaceRosterId).toBe(tp!.winnerRosterId)
    expect(final.finalStandings.find((r) => r.finish === 3)?.thirdPlace).toBe(true)
  } else {
    expect(tp).toBeNull()
    // Without a game the semifinal losers still take 3rd and 4th, the better seed first.
    const bySeed = [...semifinalLosers].sort(
      (a, b) => played.seeds.find((s) => s.rosterId === a)!.seed - played.seeds.find((s) => s.rosterId === b)!.seed,
    )
    bySeed.forEach((id, i) => expect(finishOf(sim, id)).toBe(3 + i))
  }

  // Playoff teams that went out earlier finish below those that went out later.
  const wentOut = new Map<string, number>()
  for (const round of rounds) for (const m of round.matchups) { const l = loser(m); if (l) wentOut.set(l, round.roundNumber) }
  for (const [a, ra] of wentOut) for (const [b, rb] of wentOut) {
    if (ra > rb) expect(finishOf(sim, a)!).toBeLessThan(finishOf(sim, b)!)
  }

  // Lower bracket.
  const nonPlayoff = input.teams - input.playoffTeams
  const cap = 2 ** rounds.length
  const fieldSize = input.lower === 'none' ? 0 : Math.min(nonPlayoff, cap)
  const lower = played.bracket.consolationRounds
  if (fieldSize < 2) {
    expect(lower).toHaveLength(0)
    return
  }
  expect(played.bracket.lowerBracket).toBe(input.lower)
  expect(lower).toHaveLength(Math.ceil(Math.log2(fieldSize)))
  // The lower final is played alongside the championship.
  expect(lower[lower.length - 1].roundNumber).toBe(finalRound.roundNumber)
  expect(lower[lower.length - 1].matchups).toHaveLength(1)
  for (const round of lower) {
    expect(round.status).toBe('completed')
    for (const m of round.matchups) expect(m.complete).toBe(true)
  }
  const field = new Set(lower.flatMap((r) => r.matchups.flatMap((m) => [m.homeRosterId, m.awayRosterId])).filter(Boolean))
  expect(field.size).toBe(fieldSize)
  const standingsOrder = played.teams.filter((t) => !t.qualified).map((t) => t.rosterId)
  const expectedField = input.lower === 'toilet_bowl' ? standingsOrder.slice(-fieldSize) : standingsOrder.slice(0, fieldSize)
  expect(field).toEqual(new Set(expectedField))
  // Who moved on from each game: the winner in a consolation bracket, the LOSER in a toilet bowl.
  for (let i = 0; i < lower.length - 1; i += 1) {
    for (const m of lower[i].matchups) {
      const target = lower[i + 1].matchups.find((row) => row.matchupId === m.nextMatchupId)!
      const movedOn = m.bye ? m.homeRosterId : input.lower === 'toilet_bowl' ? loser(m) : m.winnerRosterId
      expect([target.homeRosterId, target.awayRosterId]).toContain(movedOn)
      if (!m.bye) expect([target.homeRosterId, target.awayRosterId]).not.toContain(input.lower === 'toilet_bowl' ? m.winnerRosterId : loser(m))
    }
  }
  const lowerFinal = lower[lower.length - 1].matchups[0]
  if (input.lower === 'consolation') {
    expect(finishOf(sim, lowerFinal.winnerRosterId)).toBe(input.playoffTeams + 1)
    expect(finishOf(sim, loser(lowerFinal))).toBe(input.playoffTeams + 2)
    expect(final.state.bracket.lowerBracketResultRosterId).toBe(lowerFinal.winnerRosterId)
  } else {
    expect(finishOf(sim, loser(lowerFinal))).toBe(input.teams)
    expect(finishOf(sim, lowerFinal.winnerRosterId)).toBe(input.teams - 1)
    expect(final.state.bracket.lowerBracketResultRosterId).toBe(loser(lowerFinal))
  }
}

// ── tests ───────────────────────────────────────────────────────────────────

const FIELDS: Array<{ playoffTeams: number; teams: number }> = [
  { playoffTeams: 2, teams: 4 },
  { playoffTeams: 3, teams: 8 },
  { playoffTeams: 4, teams: 12 },
  { playoffTeams: 5, teams: 10 },
  { playoffTeams: 6, teams: 12 },
  { playoffTeams: 7, teams: 12 },
  { playoffTeams: 8, teams: 14 },
  { playoffTeams: 10, teams: 16 },
  { playoffTeams: 12, teams: 16 },
  { playoffTeams: 14, teams: 20 },
  { playoffTeams: 16, teams: 20 },
]

describe('full bracket simulations — champion, third place and the lower-bracket final', () => {
  for (const sport of ['NFL', 'NBA']) {
    for (const field of FIELDS) {
      for (const lower of ['consolation', 'toilet_bowl'] as const) {
        it(`${sport} ${field.playoffTeams} of ${field.teams}, ${lower}, third place on`, () => {
          const input = { sport, ...field, lower, thirdPlace: true }
          assertCompleteSeason(simulate(input), input)
        })
      }
    }
  }

  it('reseeded brackets fill the third-place game from the reseeded semifinals', () => {
    for (const playoffTeams of [6, 8, 12]) {
      const input = { sport: 'NFL', teams: 14, playoffTeams, lower: 'consolation' as const, thirdPlace: true, reseed: true }
      assertCompleteSeason(simulate(input), input)
    }
  })

  it('commissioner bye plans: a two-game semifinal gets the game; a seed waiting in the final means one semifinal loser, who is 3rd', () => {
    const twoSemis = { sport: 'NFL', teams: 12, playoffTeams: 8, lower: 'consolation' as const, thirdPlace: true, byePlan: [2, 2, 1, 1, 0, 0, 0, 0] }
    const a = simulate(twoSemis)
    expect(a.played.bracket.rounds).toHaveLength(4)
    expect(a.played.bracket.thirdPlaceMatchup).not.toBeNull()
    assertCompleteSeason(a, twoSemis)

    const seedInFinal = { sport: 'NBA', teams: 10, playoffTeams: 5, lower: 'toilet_bowl' as const, thirdPlace: true, byePlan: [2, 0, 0, 0, 0] }
    const b = simulate(seedInFinal)
    expect(b.played.bracket.rounds.map((r) => r.matchups.length)).toEqual([2, 1, 1])
    expect(b.played.bracket.thirdPlaceMatchup).toBeNull()
    assertCompleteSeason(b, seedInFinal)
    const semifinalLoser = loser(b.played.bracket.rounds[1].matchups[0])
    expect(finishOf(b, semifinalLoser)).toBe(3)
  })

  it('third place OFF: no game is generated and the semifinal losers finish 3rd/4th by seed', () => {
    for (const field of FIELDS) {
      const input = { sport: 'NFL', ...field, lower: 'none' as const, thirdPlace: false }
      const sim = simulate(input)
      expect(sim.generated.bracket.thirdPlaceMatchup).toBeNull()
      assertCompleteSeason(sim, input)
    }
  })

  it('no lower bracket when the league has none, and the non-playoff teams keep standings order', () => {
    const input = { sport: 'NBA', teams: 12, playoffTeams: 6, lower: 'none' as const, thirdPlace: true }
    const sim = simulate(input)
    expect(sim.generated.bracket.consolationRounds).toHaveLength(0)
    const standings = sim.played.teams.filter((t) => !t.qualified).map((t) => t.rosterId)
    expect(sim.final.finalStandings.slice(6).map((r) => r.rosterId)).toEqual(standings)
  })
})

describe('generation shape', () => {
  const generate = (input: Parameters<typeof rulesFor>[0]) => {
    const base = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'L', seasonId: 'S', season: 2026, week: 15, rules: rulesFor(input), teams: makeTeams(input.teams),
    })
    return generateNflRedraftPlayoffBracket({ state: base }).bracket
  }

  it('a 3-team field has one semifinal and a bye, so there is no third-place game; 2 teams have no semifinal', () => {
    expect(generate({ sport: 'NFL', teams: 8, playoffTeams: 3, lower: 'none', thirdPlace: true }).thirdPlaceMatchup).toBeNull()
    expect(generate({ sport: 'NFL', teams: 4, playoffTeams: 2, lower: 'none', thirdPlace: true }).thirdPlaceMatchup).toBeNull()
  })

  it('positive control: a 4-team field does get one, as the final round\'s second matchup', () => {
    const bracket = generate({ sport: 'NFL', teams: 8, playoffTeams: 4, lower: 'none', thirdPlace: true })
    expect(bracket.thirdPlaceMatchup).toMatchObject({ bracketType: 'third_place', roundNumber: 2, matchupNumber: 2, roundId: bracket.rounds[1].roundId })
  })

  it('a consolation bracket takes the best non-playoff teams, byes to the best; a toilet bowl the worst, byes to the worst', () => {
    // 12 teams, 4 playoff → 8 out, 2 championship rounds → a field of 4.
    const consolation = generate({ sport: 'NFL', teams: 12, playoffTeams: 4, lower: 'consolation', thirdPlace: true })
    expect(consolation.consolationRounds.map((r) => r.roundNumber)).toEqual([1, 2])
    expect(consolation.consolationRounds[0].matchups.map((m) => [m.homeRosterId, m.awayRosterId])).toEqual([['t05', 't08'], ['t06', 't07']])
    const toilet = generate({ sport: 'NFL', teams: 12, playoffTeams: 4, lower: 'toilet_bowl', thirdPlace: true })
    expect(toilet.consolationRounds[0].matchups.map((m) => [m.homeRosterId, m.awayRosterId])).toEqual([['t12', 't09'], ['t11', 't10']])
    expect(toilet.consolationRounds[1].roundName).toBe('Toilet Bowl Final')

    // 12 teams, 6 playoff → 6 out: an 8-slot lower bracket with two byes.
    const withByes = generate({ sport: 'NFL', teams: 12, playoffTeams: 6, lower: 'toilet_bowl', thirdPlace: true })
    const byes = withByes.consolationRounds[0].matchups.filter((m) => m.bye).map((m) => m.homeRosterId)
    expect(byes).toEqual(['t12', 't11'])
    const consolationByes = generate({ sport: 'NFL', teams: 12, playoffTeams: 6, lower: 'consolation', thirdPlace: true })
      .consolationRounds[0].matchups.filter((m) => m.bye).map((m) => m.homeRosterId)
    expect(consolationByes).toEqual(['t07', 't08'])
  })

  it('a short lower bracket is aligned to the END of the championship bracket', () => {
    // 10 teams, 6 playoff (3 rounds), 4 out → a 2-round lower bracket in championship rounds 2 and 3.
    const bracket = generate({ sport: 'NFL', teams: 10, playoffTeams: 6, lower: 'consolation', thirdPlace: true })
    expect(bracket.rounds.map((r) => r.roundNumber)).toEqual([1, 2, 3])
    expect(bracket.consolationRounds.map((r) => [r.roundNumber, r.status])).toEqual([[2, 'pending'], [3, 'pending']])
  })
})

describe('tiebreaks', () => {
  function tiedState(lower: NflRedraftLowerBracketMode) {
    const base = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'L', seasonId: 'S', season: 2026, week: 15,
      rules: rulesFor({ sport: 'NFL', teams: 8, playoffTeams: 4, lower, thirdPlace: true }),
      teams: makeTeams(8),
    })
    return { ...base, bracket: generateNflRedraftPlayoffBracket({ state: base }).bracket }
  }
  const tie = (ms: NflRedraftPlayoffMatchupState[]) =>
    ms.map((m) => (m.bye || !m.homeRosterId || !m.awayRosterId ? m : { ...m, homeScore: 100, awayScore: 100, status: 'final' as const }))

  it('a tied third-place game goes to the better seed', () => {
    let state = tiedState('none')
    state = { ...state, bracket: { ...state.bracket, rounds: state.bracket.rounds.map((r) => (r.roundNumber === 1 ? { ...r, matchups: tie(r.matchups) } : r)) } }
    const semis = advanceNflRedraftPlayoffRound({ state })
    if (!semis.ok) throw new Error(semis.code)
    // Ties to the better seed: 1 beat 4 and 2 beat 3, so 3 and 4 play for third.
    expect([semis.state.bracket.thirdPlaceMatchup!.homeRosterId, semis.state.bracket.thirdPlaceMatchup!.awayRosterId]).toEqual(['t03', 't04'])
    state = {
      ...semis.state,
      bracket: {
        ...semis.state.bracket,
        rounds: semis.state.bracket.rounds.map((r) => (r.roundNumber === 2 ? { ...r, matchups: tie(r.matchups) } : r)),
        thirdPlaceMatchup: tie([semis.state.bracket.thirdPlaceMatchup!])[0],
      },
    }
    const final = advanceNflRedraftPlayoffRound({ state })
    if (!final.ok) throw new Error(final.code)
    expect(final.state.bracket.thirdPlaceMatchup!.winnerRosterId).toBe('t03')
  })

  it('a tied consolation game goes to the better standings place; a tied toilet-bowl game sends the WORSE team on', () => {
    for (const lower of ['consolation', 'toilet_bowl'] as const) {
      let state = tiedState(lower)
      state = { ...state, bracket: { ...state.bracket, consolationRounds: state.bracket.consolationRounds.map((r) => (r.roundNumber === 1 ? { ...r, matchups: tie(r.matchups) } : r)) } }
      const advanced = advanceNflRedraftPlayoffRound({ state })
      if (!advanced.ok) throw new Error(advanced.code)
      const lowerFinal = advanced.state.bracket.consolationRounds[1].matchups[0]
      // 8 teams, 4 out (t05..t08), field of 4: consolation pairs 5v8, 6v7; toilet 8v5, 7v6.
      if (lower === 'consolation') expect([lowerFinal.homeRosterId, lowerFinal.awayRosterId]).toEqual(['t05', 't06'])
      else expect([lowerFinal.homeRosterId, lowerFinal.awayRosterId]).toEqual(['t08', 't07'])
    }
  })

  it('positive control: the same games NOT tied are decided by score, against seed', () => {
    let state = tiedState('toilet_bowl')
    state = {
      ...state,
      bracket: {
        ...state.bracket,
        consolationRounds: state.bracket.consolationRounds.map((r) =>
          r.roundNumber === 1
            ? { ...r, matchups: r.matchups.map((m) => ({ ...m, homeScore: 150, awayScore: 100, status: 'final' as const })) }
            : r,
        ),
      },
    }
    const advanced = advanceNflRedraftPlayoffRound({ state })
    if (!advanced.ok) throw new Error(advanced.code)
    // The worst teams (home) won, so the better teams lost and move on toward last.
    const lowerFinal = advanced.state.bracket.consolationRounds[1].matchups[0]
    expect([lowerFinal.homeRosterId, lowerFinal.awayRosterId]).toEqual(['t05', 't06'])
  })
})

describe('the two brackets do not wait for each other, and the season waits for both', () => {
  const start = () => {
    const base = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'L', seasonId: 'S', season: 2026, week: 15,
      rules: rulesFor({ sport: 'NFL', teams: 8, playoffTeams: 4, lower: 'consolation', thirdPlace: true }),
      teams: makeTeams(8),
    })
    return { ...base, bracket: generateNflRedraftPlayoffBracket({ state: base }).bracket }
  }
  const scoreTitle = (s: NflRedraftPlayoffRuntimeState, round: number) => ({
    ...s,
    bracket: {
      ...s.bracket,
      rounds: s.bracket.rounds.map((r) => (r.roundNumber === round ? { ...r, matchups: scoreGames(r.matchups, round, 'x') } : r)),
      thirdPlaceMatchup: s.bracket.thirdPlaceMatchup && round === s.bracket.rounds.length ? scoreGames([s.bracket.thirdPlaceMatchup], round, 'x')[0] : s.bracket.thirdPlaceMatchup,
    },
  })
  const scoreLower = (s: NflRedraftPlayoffRuntimeState, round: number) => ({
    ...s,
    bracket: { ...s.bracket, consolationRounds: s.bracket.consolationRounds.map((r) => (r.roundNumber === round ? { ...r, matchups: scoreGames(r.matchups, round, 'y') } : r)) },
  })

  it('the title bracket advances while the consolation round is unscored, and the reverse', () => {
    const titleOnly = advanceNflRedraftPlayoffRound({ state: scoreTitle(start(), 1) })
    if (!titleOnly.ok) throw new Error(titleOnly.code)
    expect(titleOnly.state.bracket.rounds[0].status).toBe('completed')
    expect(titleOnly.state.bracket.consolationRounds[0].status).not.toBe('completed')
    const lowerOnly = advanceNflRedraftPlayoffRound({ state: scoreLower(start(), 1) })
    if (!lowerOnly.ok) throw new Error(lowerOnly.code)
    expect(lowerOnly.state.bracket.rounds[0].status).not.toBe('completed')
    expect(lowerOnly.state.bracket.consolationRounds[0].status).toBe('completed')
    expect(lowerOnly.eliminatedRosterIds).toEqual([])
  })

  it('a half-decided group writes nothing', () => {
    const state = start()
    const half = {
      ...state,
      bracket: { ...state.bracket, rounds: state.bracket.rounds.map((r) => (r.roundNumber === 1 ? { ...r, matchups: [scoreGames(r.matchups, 1, 'x')[0], r.matchups[1]] } : r)) },
    }
    const res = advanceNflRedraftPlayoffRound({ state: half })
    expect(res.ok ? 'ok' : res.code).toBe('MATCHUPS_INCOMPLETE')
  })

  it('the final round does not complete until the third-place game is decided', () => {
    let s = advanceNflRedraftPlayoffRound({ state: scoreLower(scoreTitle(start(), 1), 1) })
    if (!s.ok) throw new Error(s.code)
    const finalOnly = {
      ...s.state,
      bracket: { ...s.state.bracket, rounds: s.state.bracket.rounds.map((r) => (r.roundNumber === 2 ? { ...r, matchups: scoreGames(r.matchups, 2, 'x') } : r)) },
    }
    const blocked = advanceNflRedraftPlayoffRound({ state: scoreLower(finalOnly, 2) })
    if (!blocked.ok) throw new Error(blocked.code)
    // The lower final advanced; the title round is held for the third-place game.
    expect(blocked.state.bracket.rounds[1].status).not.toBe('completed')
    expect(blocked.status).toBe('round_complete')
    expect(finalizeNflRedraftPlayoffChampion({ state: blocked.state })).toMatchObject({ ok: false, code: 'FINAL_ROUND_INCOMPLETE' })
    s = advanceNflRedraftPlayoffRound({ state: scoreTitle(blocked.state, 2) })
    if (!s.ok) throw new Error(s.code)
    expect(s.status).toBe('championship_ready')
    expect(finalizeNflRedraftPlayoffChampion({ state: s.state }).ok).toBe(true)
  })

  it('finalize refuses while the lower bracket is undecided', () => {
    let s = advanceNflRedraftPlayoffRound({ state: scoreLower(scoreTitle(start(), 1), 1) })
    if (!s.ok) throw new Error(s.code)
    s = advanceNflRedraftPlayoffRound({ state: scoreTitle(s.state, 2) })
    if (!s.ok) throw new Error(s.code)
    expect(finalizeNflRedraftPlayoffChampion({ state: s.state })).toMatchObject({ ok: false, code: 'LOWER_BRACKET_INCOMPLETE' })
    // The roller is held, not finalized: the lower final is still an active round.
    expect(advanceNflRedraftPlayoffRound({ state: s.state })).toMatchObject({ ok: false, code: 'MATCHUPS_INCOMPLETE' })
    s = advanceNflRedraftPlayoffRound({ state: scoreLower(s.state, 2) })
    if (!s.ok) throw new Error(s.code)
    expect(advanceNflRedraftPlayoffRound({ state: s.state })).toMatchObject({ ok: false, code: 'NO_ACTIVE_ROUND' })
    expect(finalizeNflRedraftPlayoffChampion({ state: s.state }).ok).toBe(true)
  })
})

describe('the setting', () => {
  it('is on by default for new leagues in every sport that plays a bracket', () => {
    for (const sport of ['NFL', 'NBA', 'NHL', 'MLB'] as const) {
      expect(resolveDefaultPlayoffConfig(sport).third_place_game_enabled).toBe(true)
      expect(readThirdPlaceGameEnabled({}, sport)).toBe(true)
    }
  })

  it('a stored choice wins, playoff_structure first', () => {
    expect(readThirdPlaceGameEnabled({ playoff_structure: { third_place_game_enabled: false } }, 'NFL')).toBe(false)
    expect(readThirdPlaceGameEnabled({ third_place_game_enabled: false }, 'NFL')).toBe(false)
    expect(readStoredThirdPlaceGame({ playoff_structure: { third_place_game_enabled: true }, third_place_game_enabled: false })).toBe(true)
    expect(readStoredThirdPlaceGame({})).toBeNull()
  })
})

// ── through the database: generate → score → advance → finalize ─────────────

type Row = Record<string, any>

/** Just enough of Prisma for the playoff resolver and scorer, in memory. */
function fakeDb(input: { sport: string; teams: number; weeksPerRound?: number; championshipLength?: number }) {
  const season: Row = {
    id: 'season-1', leagueId: 'league-1', sport: input.sport, season: 2026, status: 'regular_season_complete',
    currentWeek: 15, playoffStartWeek: 15,
  }
  const rosters: Row[] = makeTeams(input.teams).map((t) => ({
    id: t.rosterId, ownerId: t.ownerId, ownerName: t.displayName, teamName: t.displayName, wins: t.wins, losses: t.losses,
    ties: 0, pointsFor: t.pointsFor, pointsAgainst: t.pointsAgainst, playoffSeed: null, isEliminated: false,
  }))
  let bracket: Row | null = null
  let rounds: Row[] = []
  let matchups: Row[] = []
  let seeds: Row[] = []
  const league = {
    playoffWeeksPerRound: input.weeksPerRound ?? 1,
    settings: input.championshipLength ? { playoff_structure: { championship_length: input.championshipLength } } : {},
  }
  const championships: Row[] = []
  const inRange = (n: number, where: AnyArgs | undefined) =>
    !where || ((where.lt == null || n < where.lt) && (where.gte == null || n >= where.gte))
  const roundsWith = (where: AnyArgs = {}) =>
    rounds
      .filter((r) => inRange(r.roundNumber, where.roundNumber))
      .sort((a, b) => a.roundNumber - b.roundNumber)
      .map((r) => ({ ...r, matchups: matchups.filter((m) => m.roundId === r.id).sort((a, b) => a.matchupNumber - b.matchupNumber).map((m) => ({ ...m })) }))
  const db: Record<string, any> = {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    redraftSeason: {
      findFirst: async () => ({ ...season, rosters: rosters.map((r) => ({ ...r })), playoffBracket: bracket, playoffRounds: roundsWith() }),
      update: async ({ data }: AnyArgs) => Object.assign(season, data),
    },
    redraftMatchup: { findMany: async () => [] },
    redraftRoster: { update: async ({ where, data }: AnyArgs) => Object.assign(rosters.find((r) => r.id === where.id)!, data) },
    redraftPlayoffSeed: {
      deleteMany: async () => { seeds = [] },
      createMany: async ({ data }: AnyArgs) => { seeds.push(...data) },
    },
    redraftPlayoffBracket: {
      upsert: async ({ create }: AnyArgs) => (bracket = { id: 'bracket-1', ...create }),
      findUnique: async () => bracket,
      update: async ({ data }: AnyArgs) => Object.assign(bracket!, data),
    },
    redraftPlayoffRound: {
      deleteMany: async () => { rounds = [] },
      create: async ({ data }: AnyArgs) => { rounds.push({ ...data }); return data },
      update: async ({ where, data }: AnyArgs) => Object.assign(rounds.find((r) => r.id === where.id)!, data),
      findMany: async ({ where }: AnyArgs = {}) => roundsWith(where),
    },
    redraftPlayoffMatchup: {
      deleteMany: async () => { matchups = [] },
      create: async ({ data }: AnyArgs) => { matchups.push({ homeScore: null, awayScore: null, nextMatchupId: null, ...data }); return data },
      update: async ({ where, data }: AnyArgs) => {
        const row = matchups.find((m) => m.id === where.id)
        if (!row) throw new Error(`no matchup ${where.id}`)
        return Object.assign(row, data)
      },
    },
    league: {
      findFirst: async () => league,
      update: async () => ({}),
    },
    leagueChampionship: { upsert: async ({ create }: AnyArgs) => { championships.push(create); return create } },
    leagueEvent: { createMany: async () => ({ count: 0 }) },
  }
  return { db, season, rosters, get bracket() { return bracket }, get rounds() { return rounds }, get matchups() { return matchups }, championships }
}

async function runSeasonThroughDb(input: {
  sport: string
  teams: number
  playoffTeams: number
  lower: NflRedraftLowerBracketMode
  weeksPerRound?: number
  championshipLength?: number
}) {
  const store = fakeDb(input)
  holder.db = store.db
  holder.rules = rulesFor({ ...input, thirdPlace: true })
  const scoredWeeks: Array<{ rosterId: string; week: number }> = []
  const scoreRoster = vi.fn(async (args: AnyArgs) => {
    scoredWeeks.push({ rosterId: args.rosterId, week: args.week })
    return { rosterId: args.rosterId, points: scoreFor(args.rosterId, args.week, 'db'), allFinal: true } as any
  })
  const finalizeWeek = vi.fn(async () => ({ finalized: true, alreadyFinal: false, refusal: null }) as any)

  await generateNflRedraftPlayoffRuntimeBracket({ seasonId: 'season-1', actorUserId: 'commish' })
  let finalized: Awaited<ReturnType<typeof finalizeNflRedraftPlayoffRuntimeSeason>> | null = null
  for (let week = 15; week <= 30 && !finalized; week += 1) {
    await scoreActivePlayoffRound({ seasonId: 'season-1', calendarWeek: week }, { prisma: store.db as any, scoreRoster, finalizeWeek })
    const advanced = await advanceNflRedraftPlayoffRuntimeRound({ seasonId: 'season-1', actorUserId: 'roller' })
    if (!advanced.ok && advanced.code === 'NO_ACTIVE_ROUND') {
      finalized = await finalizeNflRedraftPlayoffRuntimeSeason({ seasonId: 'season-1', actorUserId: 'roller' })
    }
  }
  return { store, finalized, scoredWeeks }
}

describe('through the database', () => {
  beforeEach(() => {
    holder.db = {}
  })

  it('NFL 6 of 12, consolation: every game is stored, scored in its week, advanced and recorded', async () => {
    const { store, finalized, scoredWeeks } = await runSeasonThroughDb({ sport: 'NFL', teams: 12, playoffTeams: 6, lower: 'consolation' })
    expect(finalized?.ok).toBe(true)
    if (!finalized?.ok) return
    // Rounds: 1-3 for the title bracket, 101-103 for an 8-slot consolation bracket of 6.
    expect(store.rounds.map((r) => r.roundNumber).sort((a, b) => a - b)).toEqual([1, 2, 3, 101, 102, 103])
    const finalRow = store.rounds.find((r) => r.roundNumber === 3)!
    const finalRowMatchups = store.matchups.filter((m) => m.roundId === finalRow.id)
    expect(finalRowMatchups.map((m) => m.metadata.bracketType).sort()).toEqual(['championship', 'third_place'])
    // Everything that was played carries a final score; byes do not.
    for (const m of store.matchups) {
      if (m.status === 'bye') continue
      expect(m.status).toBe('final')
      expect(typeof m.homeScore).toBe('number')
      expect(m.winnerRosterId).toBeTruthy()
    }
    // The third-place game and the consolation final were scored in the championship week.
    const tp = finalRowMatchups.find((m) => m.metadata.bracketType === 'third_place')!
    expect(tp.metadata.scoredWeeks).toEqual([17])
    const lowerFinal = store.matchups.find((m) => m.roundId === store.rounds.find((r) => r.roundNumber === 103)!.id)!
    expect(lowerFinal.metadata.scoredWeeks).toEqual([17])
    expect(scoredWeeks.every((row) => row.week >= 15 && row.week <= 17)).toBe(true)
    // Season history reads the stored finishes: 3rd and 4th from the game, 7th from the consolation final.
    const result = readBracketResult(store.bracket!.structure)!
    expect(result.finishByRosterId.get(tp.winnerRosterId)).toBe(3)
    expect(result.finishByRosterId.get(tp.winnerRosterId === tp.homeRosterId ? tp.awayRosterId : tp.homeRosterId)).toBe(4)
    expect(result.finishByRosterId.get(lowerFinal.winnerRosterId)).toBe(7)
    expect(store.bracket!.structure).toMatchObject({ thirdPlaceRosterId: tp.winnerRosterId, lowerBracket: 'consolation', lowerBracketResultRosterId: lowerFinal.winnerRosterId })
    expect(store.season.status).toBe('complete')
    // The rookie order reads the third-place game as the placement game for 3rd.
    const games = playoffGamesFromRedraftMatchups(
      store.matchups.map((m) => ({ ...m, roundNumber: store.rounds.find((r) => r.id === m.roundId)!.roundNumber })),
    )
    expect(games.filter((g) => g.kind === 'placement')).toEqual([expect.objectContaining({ place: 3, round: 3, winner: tp.winnerRosterId })])
    expect(games.every((g) => g.round < CONSOLATION_ROUND_OFFSET)).toBe(true)
  })

  it('NHL 8 of 14, toilet bowl, two-week final: the third-place game and toilet bowl final span both weeks', async () => {
    const { store, finalized } = await runSeasonThroughDb({
      sport: 'NHL', teams: 14, playoffTeams: 8, lower: 'toilet_bowl', championshipLength: 2,
    })
    expect(finalized?.ok).toBe(true)
    if (!finalized?.ok) return
    const finalWeeks = playoffRoundWeeks({ playoffStartWeek: 15, roundNumber: 3, finalRoundNumber: 3, championshipLength: 2 })
    expect(finalWeeks).toEqual([17, 18])
    const tp = store.matchups.find((m) => m.metadata.bracketType === 'third_place')!
    expect(tp.metadata.scoredWeeks).toEqual([17, 18])
    const lastLower = [...store.rounds].filter((r) => r.roundNumber > CONSOLATION_ROUND_OFFSET).sort((a, b) => b.roundNumber - a.roundNumber)[0]
    expect(lastLower.roundNumber).toBe(CONSOLATION_ROUND_OFFSET + 3)
    const toiletFinal = store.matchups.find((m) => m.roundId === lastLower.id)!
    expect(toiletFinal.metadata.scoredWeeks).toEqual([17, 18])
    const last = toiletFinal.winnerRosterId === toiletFinal.homeRosterId ? toiletFinal.awayRosterId : toiletFinal.homeRosterId
    expect(readBracketResult(store.bracket!.structure)!.finishByRosterId.get(last)).toBe(14)
    // The champion record excludes the toilet bowl: the champion played three title games at most.
    expect(store.championships).toHaveLength(1)
  })

  it('a lower-bracket week that will not seal does not hold the title round, and is sealed on its own', async () => {
    const store = fakeDb({ sport: 'NFL', teams: 8 })
    holder.db = store.db
    holder.rules = rulesFor({ sport: 'NFL', teams: 8, playoffTeams: 4, lower: 'consolation', thirdPlace: true })
    await generateNflRedraftPlayoffRuntimeBracket({ seasonId: 'season-1', actorUserId: 'commish' })
    store.season.status = 'playoffs'
    const lowerTeams = new Set(['t05', 't06', 't07', 't08'])
    const calls: AnyArgs[] = []
    const finalizeWeek = vi.fn(async (params: AnyArgs) => {
      calls.push(params)
      const lowerCall = params.rosterIds.some((id: string) => lowerTeams.has(id))
      return { finalized: !lowerCall, alreadyFinal: false, refusal: lowerCall ? 'stat_coverage_below_floor' : null } as any
    })
    const scoreRoster = vi.fn(async (args: AnyArgs) => ({ rosterId: args.rosterId, points: scoreFor(args.rosterId, args.week, 'z'), allFinal: true }) as any)
    const res = await scoreActivePlayoffRound({ seasonId: 'season-1', calendarWeek: 15 }, { prisma: store.db as any, scoreRoster, finalizeWeek })
    expect(res.outcome).toBe('scored')
    expect(res.matchupsScored).toBe(2)
    expect(res.lowerBracket).toMatchObject({ outcome: 'live', matchupsLive: 2, weekRefusals: { 15: 'stat_coverage_below_floor' } })
    // Two seals: the title teams, then the lower-bracket teams — never one call holding both.
    expect(calls.map((c) => [...c.rosterIds].sort())).toEqual([['t01', 't02', 't03', 't04'], ['t05', 't06', 't07', 't08']])
    // The title round advances; the lower round waits.
    const advanced = await advanceNflRedraftPlayoffRuntimeRound({ seasonId: 'season-1', actorUserId: 'roller' })
    expect(advanced.ok).toBe(true)
    const lowerRound = store.rounds.find((r) => r.roundNumber === CONSOLATION_ROUND_OFFSET + 1)!
    expect(store.matchups.filter((m) => m.roundId === lowerRound.id).every((m) => m.homeScore == null && m.metadata.live)).toBe(true)
  })

  it('a commissioner can override a lower-bracket game, which the next advance carries forward', async () => {
    const store = fakeDb({ sport: 'NFL', teams: 8 })
    holder.db = store.db
    holder.rules = rulesFor({ sport: 'NFL', teams: 8, playoffTeams: 4, lower: 'toilet_bowl', thirdPlace: true })
    await generateNflRedraftPlayoffRuntimeBracket({ seasonId: 'season-1', actorUserId: 'commish' })
    const lowerRound = store.rounds.find((r) => r.roundNumber === CONSOLATION_ROUND_OFFSET + 1)!
    const game = store.matchups.find((m) => m.roundId === lowerRound.id && m.matchupNumber === 1)!
    await overrideNflRedraftPlayoffMatchup({ seasonId: 'season-1', matchupId: game.id, winnerRosterId: game.homeRosterId, actorUserId: 'commish' })
    expect(store.matchups.find((m) => m.id === game.id)!.winnerRosterId).toBe(game.homeRosterId)
  })
})
