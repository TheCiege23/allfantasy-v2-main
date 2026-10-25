/**
 * `consolation_plays_for = 'pick'` sets next season's draft order.
 *
 * Before this, the setting was stored and shown ("Draft pick") and read by nothing: the next
 * draft seated every non-playoff team by standings whatever the lower bracket decided.
 *
 *   consolation + pick — the consolation winner picks first; every other non-playoff team follows
 *                        in reverse standings; then the playoff teams exactly as before.
 *   toilet bowl + pick — the toilet bowl final's loser (last place) picks first; the rest the same.
 *   cash / none, or no lower bracket — nothing changes.
 *
 * Owner's rollout rule: a stored `pick` moves the order only for a league created from now on, or
 * one whose commissioner saved the setting — both stamp `consolation_plays_for_sets_draft_order`.
 * Creation always stored the sport default (`pick`), so an older league stores `pick` too and must
 * keep the order it always had.
 *
 * Every case is played through the real bracket runtime (seeding → champion → lower final →
 * finalize), and its `RedraftPlayoffBracket.structure` is what the draft order reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn(), update: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftPlayoffSeed: { findMany: vi.fn() },
  redraftPlayoffRound: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  finalizeNflRedraftPlayoffChampion,
  generateNflRedraftPlayoffBracket,
  type NflRedraftLowerBracketMode,
  type NflRedraftPlayoffMatchupState,
  type NflRedraftPlayoffRuntimeState,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import {
  consolationPlaysForSetsDraftOrder,
  readConsolationPlaysFor,
  readLowerBracketDraftResult,
} from '@/lib/playoff-runtime/consolationPlaysFor'
import { buildInitialLeagueSettings } from '@/lib/sport-defaults/LeagueDefaultSettingsService'
import { CONSOLATION_ROUND_OFFSET } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { computeRookieOrder, type RookieOrderInput } from '@/lib/rookie-order/rookieOrderEngine'
import { playoffGamesFromRedraftMatchups } from '@/lib/rookie-order/playoffGameAdapters'
import { loadRookieOrderInput } from '@/lib/rookie-order/loadRookieOrderInput'

type Field = { sport: string; teams: number; playoffTeams: number; lower: NflRedraftLowerBracketMode }

function teamsFor(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    rosterId: `t${String(i + 1).padStart(2, '0')}`,
    displayName: `Team ${i + 1}`,
    wins: 13 - Math.floor(i / 2),
    losses: Math.floor(i / 2),
    pointsFor: 2000 - i * 37,
    pointsAgainst: 1500,
  }))
}

function scoreFor(rosterId: string, round: number, salt: string): number {
  let h = 2166136261
  for (const ch of `${rosterId}|${round}|${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return 90 + ((h >>> 0) % 60) + Number(rosterId.slice(1)) / 1000
}

function scoreGames(ms: NflRedraftPlayoffMatchupState[], round: number, salt: string) {
  return ms.map((m) =>
    m.bye || m.complete || !m.homeRosterId || !m.awayRosterId
      ? m
      : { ...m, homeScore: scoreFor(m.homeRosterId, round, salt), awayScore: scoreFor(m.awayRosterId, round, salt), status: 'final' as const },
  )
}

/** A whole season through the runtime; returns the state, the stored structure and the bracket rows. */
function playSeason(field: Field, opts: { stopBeforeLowerFinal?: boolean } = {}) {
  const base = buildNflRedraftPlayoffRuntimeState({
    leagueId: 'L', seasonId: 'S', season: 2026, week: 15,
    rules: {
      general: { season: 2026, sport: field.sport, teamCount: field.teams },
      playoffs: {
        teamCount: field.playoffTeams, startWeek: 15,
        consolationBracketEnabled: field.lower === 'consolation', toiletBowlEnabled: field.lower === 'toilet_bowl',
        thirdPlaceGameEnabled: true, seedingRules: 'standings', standingsTiebreakers: ['win_pct', 'points_for'],
      },
      schedule: { regularSeasonLength: 14 },
    },
    teams: teamsFor(field.teams),
  })
  let state: NflRedraftPlayoffRuntimeState = { ...base, bracket: generateNflRedraftPlayoffBracket({ state: base }).bracket }
  const salt = `${field.sport}-${field.teams}-${field.playoffTeams}`
  const R = state.bracket.rounds.length
  for (let week = 1; week <= R; week += 1) {
    const skipLower = opts.stopBeforeLowerFinal && week === R
    state = {
      ...state,
      bracket: {
        ...state.bracket,
        rounds: state.bracket.rounds.map((r) => (r.roundNumber === week ? { ...r, matchups: scoreGames(r.matchups, week, salt) } : r)),
        thirdPlaceMatchup: week === R && state.bracket.thirdPlaceMatchup ? scoreGames([state.bracket.thirdPlaceMatchup], week, salt)[0] : state.bracket.thirdPlaceMatchup,
        consolationRounds: state.bracket.consolationRounds.map((r) =>
          r.roundNumber === week && !skipLower ? { ...r, matchups: scoreGames(r.matchups, week, `${salt}-lower`) } : r,
        ),
      },
    }
    const advanced = advanceNflRedraftPlayoffRound({ state })
    if (!advanced.ok) throw new Error(`${advanced.code} ${advanced.message}`)
    state = advanced.state
  }
  const finalized = finalizeNflRedraftPlayoffChampion({ state })
  // What `finalizeNflRedraftPlayoffRuntimeSeason` writes into the bracket structure.
  const structure = finalized.ok
    ? {
        lowerBracket: finalized.state.bracket.lowerBracket,
        championRosterId: finalized.championRosterId,
        runnerUpRosterId: finalized.runnerUpRosterId,
        finalStandings: finalized.finalStandings,
      }
    : { lowerBracket: state.bracket.lowerBracket }
  // The rows `loadRookieOrderInput` reads: title rounds (third place in the final's row) + lower rounds at 100 + n.
  const rows = [
    ...state.bracket.rounds.flatMap((r) => [
      ...r.matchups.map((m) => ({ ...m, roundNumber: r.roundNumber })),
      ...(r === state.bracket.rounds[R - 1] && state.bracket.thirdPlaceMatchup ? [{ ...state.bracket.thirdPlaceMatchup, roundNumber: r.roundNumber }] : []),
    ]),
    ...state.bracket.consolationRounds.flatMap((r) => r.matchups.map((m) => ({ ...m, roundNumber: CONSOLATION_ROUND_OFFSET + r.roundNumber }))),
  ]
  return { state: finalized.ok ? finalized.state : state, finalized, structure, rows }
}

function engineInput(season: ReturnType<typeof playSeason>, playsFor: 'pick' | 'cash' | 'none'): RookieOrderInput {
  const seed = new Map(season.state.seeds.map((s) => [s.rosterId, s.seed]))
  const lower = readLowerBracketDraftResult(season.structure, season.state.bracket.consolationRounds.length > 0)
  return {
    teams: season.state.teams.map((t) => ({
      teamId: t.rosterId, name: t.displayName, wins: t.wins, losses: t.losses, ties: t.ties,
      pointsFor: t.pointsFor, maxPf: null, playoffSeed: seed.get(t.rosterId) ?? null,
    })),
    regularSeasonComplete: true,
    playoffGames: playoffGamesFromRedraftMatchups(season.rows.map((m) => ({ ...m, metadata: { bracketType: m.bracketType } }))),
    lowerBracket: lower ? { ...lower, playsForPick: playsFor === 'pick' } : null,
  }
}

const order = (input: RookieOrderInput) => computeRookieOrder(input).slots.map((s) => s.teamId)

const FIELDS: Field[] = [
  { sport: 'NFL', teams: 12, playoffTeams: 6, lower: 'consolation' },
  { sport: 'NFL', teams: 12, playoffTeams: 6, lower: 'toilet_bowl' },
  { sport: 'NFL', teams: 12, playoffTeams: 4, lower: 'consolation' }, // 8 out, field capped at 4
  { sport: 'NFL', teams: 12, playoffTeams: 4, lower: 'toilet_bowl' },
  { sport: 'NBA', teams: 10, playoffTeams: 5, lower: 'consolation' }, // odd: 5 out, byes
  { sport: 'NBA', teams: 10, playoffTeams: 5, lower: 'toilet_bowl' },
  { sport: 'NBA', teams: 13, playoffTeams: 7, lower: 'consolation' }, // odd league, 6 out
  { sport: 'NBA', teams: 13, playoffTeams: 7, lower: 'toilet_bowl' },
  { sport: 'NHL', teams: 20, playoffTeams: 16, lower: 'toilet_bowl' },
  { sport: 'MLB', teams: 8, playoffTeams: 4, lower: 'consolation' },
]

describe('plays for the pick', () => {
  for (const field of FIELDS) {
    it(`${field.sport} ${field.playoffTeams} of ${field.teams}, ${field.lower}`, () => {
      const season = playSeason(field)
      expect(season.finalized.ok).toBe(true)
      if (!season.finalized.ok) return
      const standings = season.finalized.finalStandings
      const nonPlayoffByFinish = standings.filter((r) => r.seed == null).map((r) => r.rosterId)
      const nonPlayoffCount = field.teams - field.playoffTeams

      const pick = computeRookieOrder(engineInput(season, 'pick'))
      const cash = computeRookieOrder(engineInput(season, 'cash'))
      const none = computeRookieOrder(engineInput(season, 'none'))
      const noLower = computeRookieOrder({ ...engineInput(season, 'pick'), lowerBracket: null })

      expect(pick.phase).toBe('final')
      const pickNonPlayoff = pick.slots.slice(0, nonPlayoffCount).map((s) => s.teamId)
      const standingsNonPlayoff = cash.slots.slice(0, nonPlayoffCount).map((s) => s.teamId)
      // Consolation: its winner (finish playoffTeams + 1). Toilet bowl: last place, the final's loser.
      const first =
        field.lower === 'consolation'
          ? standings.find((r) => r.finish === field.playoffTeams + 1)!.rosterId
          : standings.find((r) => r.finish === field.teams)!.rosterId
      expect(nonPlayoffByFinish).toContain(first)
      expect(pickNonPlayoff[0]).toBe(first)
      // Everyone else: reverse standings, exactly the order they have without the setting.
      expect(pickNonPlayoff.slice(1)).toEqual(standingsNonPlayoff.filter((id) => id !== first))
      if (field.lower === 'consolation') {
        expect(pick.slots[0].reason).toMatch(/Won the consolation bracket/)
        expect(pick.slots[0].finish).toBe('Consolation winner')
      } else {
        expect(pick.slots[0].finish).toBe('Toilet bowl loser')
      }
      // The playoff teams are seated exactly as without the setting.
      expect(pick.slots.slice(nonPlayoffCount).map((s) => s.teamId)).toEqual(cash.slots.slice(nonPlayoffCount).map((s) => s.teamId))
      expect(pick.slots.at(-1)!.teamId).toBe(season.finalized.championRosterId)
      // Cash and Nothing change nothing: the order is the one with no lower bracket at all.
      expect(cash.slots.map((s) => s.teamId)).toEqual(noLower.slots.map((s) => s.teamId))
      expect(none.slots.map((s) => s.teamId)).toEqual(noLower.slots.map((s) => s.teamId))
    })
  }

  it('positive control: the pick moves the order exactly when the lower bracket did not pick the standings-first team', () => {
    let moved = 0
    for (const field of FIELDS) {
      const season = playSeason(field)
      const n = field.teams - field.playoffTeams
      const pick = order(engineInput(season, 'pick')).slice(0, n)
      const cash = order(engineInput(season, 'cash')).slice(0, n)
      if (pick[0] !== cash[0]) {
        moved += 1
        expect(pick, JSON.stringify(field)).not.toEqual(cash)
      } else {
        expect(pick, JSON.stringify(field)).toEqual(cash)
      }
    }
    // Not every field in the list lands on the standings-first team, or the cases above prove nothing.
    expect(moved).toBeGreaterThan(0)
  })

  it('no lower bracket: the setting does nothing', () => {
    const season = playSeason({ sport: 'NFL', teams: 12, playoffTeams: 6, lower: 'none' })
    const input = engineInput(season, 'pick')
    expect(input.lowerBracket).toBeNull()
    expect(order(input)).toEqual(order(engineInput(season, 'cash')))
  })

  it('while the lower bracket is undecided the slots are provisional and the order is not final', () => {
    const season = playSeason({ sport: 'NFL', teams: 12, playoffTeams: 6, lower: 'consolation' }, { stopBeforeLowerFinal: true })
    expect(season.finalized.ok).toBe(false)
    const res = computeRookieOrder(engineInput(season, 'pick'))
    expect(res.phase).toBe('playoffs')
    expect(res.slots.slice(0, 6).every((s) => s.status === 'provisional')).toBe(true)
    // Cash is not waiting on anything — the title game is decided, so that order is final.
    expect(computeRookieOrder(engineInput(season, 'cash')).phase).toBe('final')
  })
})

describe('readConsolationPlaysFor', () => {
  it('stored value first (playoff_structure, then top level), then the sport default', () => {
    expect(readConsolationPlaysFor({ playoff_structure: { consolation_plays_for: 'cash' }, consolation_plays_for: 'pick' }, 'NFL')).toBe('cash')
    expect(readConsolationPlaysFor({ consolation_plays_for: 'none' }, 'NFL')).toBe('none')
    expect(readConsolationPlaysFor({}, 'NFL')).toBe('pick')
    expect(readConsolationPlaysFor({}, 'MLB')).toBe('none')
  })
  it('an unrecognised stored value reads as none, never as pick', () => {
    expect(readConsolationPlaysFor({ playoff_structure: { consolation_plays_for: 'final_standings' } }, 'NFL')).toBe('none')
  })
})

describe('readLowerBracketDraftResult', () => {
  it('null without a lower bracket; null finish order until the bracket is finalized', () => {
    expect(readLowerBracketDraftResult({ lowerBracket: 'none' }, false)).toBeNull()
    expect(readLowerBracketDraftResult({}, false)).toBeNull()
    expect(readLowerBracketDraftResult({ lowerBracket: 'toilet_bowl' }, true)).toEqual({ mode: 'toilet_bowl', finishOrder: null })
    // A bracket stored before the mode was recorded is a consolation bracket.
    expect(readLowerBracketDraftResult({}, true)).toEqual({ mode: 'consolation', finishOrder: null })
  })
  it('the non-playoff teams in finish order once finalized', () => {
    expect(
      readLowerBracketDraftResult(
        {
          lowerBracket: 'consolation',
          championRosterId: 'a',
          finalStandings: [
            { rosterId: 'a', finish: 1, seed: 1 },
            { rosterId: 'y', finish: 4, seed: null },
            { rosterId: 'b', finish: 2, seed: 2 },
            { rosterId: 'x', finish: 3, seed: null },
          ],
        },
        true,
      ),
    ).toEqual({ mode: 'consolation', finishOrder: ['x', 'y'] })
  })
})

describe('loadRookieOrderInput (native) carries the lower bracket and the setting', () => {
  beforeEach(() => vi.clearAllMocks())

  function mockSeason(season: ReturnType<typeof playSeason>, settings: Record<string, unknown>) {
    db.league.findUnique.mockResolvedValue({ id: 'L', season: 2026, platform: 'allfantasy', platformLeagueId: 'L', playoffStartWeek: 15, settings, sport: 'NFL', leagueVariant: null })
    db.redraftSeason.findFirst.mockResolvedValue({ id: 'S', season: 2026, currentWeek: 17, playoffStartWeek: 15, status: 'complete', playoffBracket: { structure: season.structure } })
    db.redraftRoster.findMany.mockResolvedValue(
      season.state.teams.map((t) => ({ id: t.rosterId, teamName: t.displayName, ownerName: t.displayName, wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor, playoffSeed: null })),
    )
    db.redraftPlayoffSeed.findMany.mockResolvedValue(season.state.seeds.map((s) => ({ rosterId: s.rosterId, seed: s.seed })))
    const byRound = new Map<number, unknown[]>()
    for (const m of season.rows) byRound.set(m.roundNumber, [...(byRound.get(m.roundNumber) ?? []), { homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId, winnerRosterId: m.winnerRosterId, metadata: { bracketType: m.bracketType } }])
    db.redraftPlayoffRound.findMany.mockResolvedValue([...byRound].map(([roundNumber, matchups]) => ({ roundNumber, matchups })))
    db.roster.findMany.mockResolvedValue([])
  }

  it('toilet bowl + pick from a real season: last place picks first', async () => {
    const season = playSeason({ sport: 'NFL', teams: 12, playoffTeams: 6, lower: 'toilet_bowl' })
    mockSeason(season, { playoff_structure: { consolation_plays_for: 'pick', consolation_plays_for_sets_draft_order: true } })
    const loaded = await loadRookieOrderInput('L')
    expect(loaded?.input.lowerBracket).toMatchObject({ mode: 'toilet_bowl', playsForPick: true })
    const last = season.finalized.ok ? season.finalized.finalStandings.at(-1)!.rosterId : null
    expect(computeRookieOrder(loaded!.input).slots[0].teamId).toBe(last)
  })

  it('a league that stores pick from before the rule (no flag) keeps the standings order', async () => {
    // A field whose consolation winner is not already the standings-first team, so the flag can show.
    const field = FIELDS.find((f) => {
      if (f.lower !== 'consolation') return false
      const s = playSeason(f)
      return order(engineInput(s, 'pick'))[0] !== order(engineInput(s, 'cash'))[0]
    })!
    expect(field).toBeDefined()
    const season = playSeason(field)
    for (const settings of [{ playoff_structure: { consolation_plays_for: 'pick' } }, {}]) {
      mockSeason(season, settings)
      const loaded = await loadRookieOrderInput('L')
      expect(loaded?.input.lowerBracket).toMatchObject({ mode: 'consolation', playsForPick: false })
      expect(order(loaded!.input)).toEqual(order({ ...loaded!.input, lowerBracket: null }))
    }
    // [control] the same season, flagged: the order moves.
    mockSeason(season, { playoff_structure: { consolation_plays_for: 'pick', consolation_plays_for_sets_draft_order: true } })
    const flagged = await loadRookieOrderInput('L')
    expect(order(flagged!.input)).not.toEqual(order({ ...flagged!.input, lowerBracket: null }))
  })

  it('[control] the same season with cash keeps the standings order', async () => {
    const season = playSeason({ sport: 'NFL', teams: 12, playoffTeams: 6, lower: 'toilet_bowl' })
    mockSeason(season, { playoff_structure: { consolation_plays_for: 'cash', consolation_plays_for_sets_draft_order: true } })
    const loaded = await loadRookieOrderInput('L')
    expect(loaded?.input.lowerBracket).toMatchObject({ mode: 'toilet_bowl', playsForPick: false })
    expect(order(loaded!.input)).toEqual(order({ ...loaded!.input, lowerBracket: null }))
  })
})

describe('the consolation winner picks first, then reverse standings, then the playoff teams', () => {
  // Eight teams, four in the playoffs. Non-playoff by standings (worst first): e(2-12), f(4-10), g(5-9), h(6-8).
  const t = (teamId: string, wins: number, playoffSeed: number | null) => ({
    teamId, name: teamId.toUpperCase(), wins, losses: 14 - wins, ties: 0, pointsFor: 1000 + wins * 10, maxPf: null, playoffSeed,
  })
  const base: RookieOrderInput = {
    teams: [t('a', 12, 1), t('b', 11, 2), t('c', 10, 3), t('d', 9, 4), t('h', 6, null), t('g', 5, null), t('f', 4, null), t('e', 2, null)],
    regularSeasonComplete: true,
    playoffGames: [
      { round: 1, kind: 'championship', place: null, teamA: 'a', teamB: 'd', winner: 'a' },
      { round: 1, kind: 'championship', place: null, teamA: 'b', teamB: 'c', winner: 'b' },
      { round: 2, kind: 'championship', place: null, teamA: 'a', teamB: 'b', winner: 'a' },
    ],
    config: { nonPlayoff: 'reverse_record' },
  }
  const without = order(base)

  it('[control] without the setting the non-playoff teams go worst record first', () => {
    expect(without.slice(0, 4)).toEqual(['e', 'f', 'g', 'h'])
  })

  it('consolation winner g gets pick 1; e, f, h follow in reverse standings; playoff teams as before', () => {
    const res = computeRookieOrder({ ...base, lowerBracket: { mode: 'consolation', playsForPick: true, finishOrder: ['g', 'h', 'e', 'f'] } })
    expect(res.slots.map((s) => s.teamId)).toEqual(['g', 'e', 'f', 'h', ...without.slice(4)])
    expect(res.slots[0]).toMatchObject({ slot: 1, finish: 'Consolation winner', status: 'locked' })
    expect(res.slots.slice(1, 4).every((s) => s.finish === null && s.group === 'non_playoff')).toBe(true)
    expect(res.slots.at(-1)!.teamId).toBe('a')
    expect(res.phase).toBe('final')
  })

  it('a consolation winner who was already worst in the standings changes nothing', () => {
    const res = computeRookieOrder({ ...base, lowerBracket: { mode: 'consolation', playsForPick: true, finishOrder: ['e', 'h', 'g', 'f'] } })
    expect(res.slots.map((s) => s.teamId)).toEqual(without)
  })

  it('toilet bowl: last place (the final loser) picks first, the rest by standings', () => {
    const res = computeRookieOrder({ ...base, lowerBracket: { mode: 'toilet_bowl', playsForPick: true, finishOrder: ['h', 'e', 'g', 'f'] } })
    expect(res.slots.map((s) => s.teamId)).toEqual(['f', 'e', 'g', 'h', ...without.slice(4)])
  })
})

describe('rollout: new leagues play for the pick in the draft order, older ones only once saved', () => {
  it('a league created now stores the flag beside the sport default', () => {
    for (const sport of ['NFL', 'NBA', 'NHL']) {
      const settings = buildInitialLeagueSettings(sport)
      expect((settings.playoff_structure as Record<string, unknown>).consolation_plays_for_sets_draft_order).toBe(true)
      expect(consolationPlaysForSetsDraftOrder(settings, sport)).toBe(true)
    }
    // MLB defaults to Nothing, flagged or not.
    expect(consolationPlaysForSetsDraftOrder(buildInitialLeagueSettings('MLB'), 'MLB')).toBe(false)
  })
  it('the post-create playoff bootstrap stamps the flag only when it fills "plays for" in', async () => {
    const { bootstrapLeaguePlayoffConfig } = await import('@/lib/playoff-defaults/LeaguePlayoffBootstrapService')
    const run = async (settings: Record<string, unknown>) => {
      db.league.update.mockReset()
      db.league.findUnique.mockResolvedValueOnce({ id: 'L', sport: 'NFL', leagueVariant: null, settings, platform: 'manual', playoffTeams: 6, playoffStartWeek: 15, playoffSeedingRule: null })
      await bootstrapLeaguePlayoffConfig('L')
      return db.league.update.mock.calls[0]?.[0]?.data?.settings?.playoff_structure as Record<string, unknown> | undefined
    }
    // A league being created (best ball writes a structure with only its seeding rule first).
    const created = await run({ playoff_structure: { seeding_rules: 'points_only' } })
    expect(created).toMatchObject({ consolation_plays_for: 'pick', consolation_plays_for_sets_draft_order: true })
    // An existing league that stores the sport default: the bootstrap fills other gaps, never the flag.
    const existing = await run({ playoff_structure: { consolation_plays_for: 'pick' } })
    expect(existing?.consolation_plays_for_sets_draft_order).toBeUndefined()
  })

  it('an older league — the sport default stored by creation, or nothing stored — does not', () => {
    expect(consolationPlaysForSetsDraftOrder({ playoff_structure: { consolation_plays_for: 'pick' } }, 'NFL')).toBe(false)
    expect(consolationPlaysForSetsDraftOrder({}, 'NFL')).toBe(false)
    // The value it shows is unchanged.
    expect(readConsolationPlaysFor({}, 'NFL')).toBe('pick')
  })
  it('a commissioner save (the flag) with pick does; with cash it does not', () => {
    expect(consolationPlaysForSetsDraftOrder({ playoff_structure: { consolation_plays_for: 'pick', consolation_plays_for_sets_draft_order: true } }, 'NFL')).toBe(true)
    expect(consolationPlaysForSetsDraftOrder({ playoff_structure: { consolation_plays_for: 'cash', consolation_plays_for_sets_draft_order: true } }, 'NFL')).toBe(false)
  })
})
