/**
 * Edit Playoff Bracket. The contract that matters beyond "the list changed":
 *   - the commish's seed order is a SEED OVERRIDE the runtime honours on every read — the pairing,
 *     who is in, and the reseed between rounds — because seeds are otherwise re-derived from the
 *     standings each time and an edit stored anywhere else would be undone by the next round;
 *   - an invalid or stale order falls back to the standings instead of breaking the bracket;
 *   - reseeding stops once round one is decided; winners only in a round still being played;
 *   - commish or co-commish only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffRulesInput,
  type NflRedraftPlayoffRuntimeState,
  type NflRedraftPlayoffTeamInput,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'

const h = vi.hoisted(() => ({
  role: 'co_commissioner' as string | null,
  platform: 'allfantasy',
  structure: {} as Record<string, unknown>,
  resolved: null as unknown,
  generate: vi.fn(),
  override: vi.fn(),
  audit: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ platform: h.platform })) },
    redraftPlayoffBracket: {
      findUnique: vi.fn(async () => ({ structure: JSON.parse(JSON.stringify(h.structure)) })),
      update: vi.fn(async ({ data }: { data: { structure: Record<string, unknown> } }) => {
        h.structure = data.structure
      }),
    },
  },
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u-co' } })) }))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: vi.fn(async () => h.role),
  isCommissionerRole: (r: string | null) => r === 'commissioner' || r === 'co_commissioner',
}))
vi.mock('@/server/services/auditService', () => ({
  logAction: vi.fn(async (i: Record<string, unknown>) => {
    h.audit.push(i)
    return { id: 'a' }
  }),
}))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn(async () => undefined) }))
// The service's DB-facing runtime calls; the pure engine below is the real one.
vi.mock('@/lib/playoff-runtime', async () => {
  const canonical = await import('@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime')
  return {
    ...canonical,
    resolveNflRedraftPlayoffRuntime: vi.fn(async () => h.resolved),
    generateNflRedraftPlayoffRuntimeBracket: h.generate,
    overrideNflRedraftPlayoffMatchup: h.override,
  }
})

import { executeCommishPlayoffEdit, reseedRefusal, winnerRefusal } from '@/lib/league/commishPlayoffBracket'
import { GET, POST, bracketPayload, parseCommishPlayoffEdit } from '@/app/api/leagues/[leagueId]/commish-playoffs/handler'
import { manualSeedsFromStructure } from '@/lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'

const rules = (reseed: boolean): NflRedraftPlayoffRulesInput => ({
  general: { season: 2026, sport: 'NFL', teamCount: 6 },
  playoffs: {
    teamCount: 4,
    startWeek: 15,
    firstRoundByes: 0,
    consolationBracketEnabled: false,
    thirdPlaceGameEnabled: false,
    seedingRules: 'standings',
    tiebreakerRules: ['win_pct', 'points_for'],
    byeRules: null,
    reseedBehavior: reseed ? 'reseed_after_each_round' : null,
    standingsTiebreakers: ['win_pct', 'points_for'],
  },
  schedule: { regularSeasonLength: 14, playoffTransitionPoint: 15 },
})

// Standings order A > B > C > D > E > F.
const teams: NflRedraftPlayoffTeamInput[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) => ({
  rosterId: id,
  displayName: `Team ${id}`,
  wins: 12 - i,
  losses: 2 + i,
  ties: 0,
  pointsFor: 1500 - i * 10,
  pointsAgainst: 1300,
}))

function state(opts: { seedOverride?: string[] | null; reseed?: boolean; withBracket?: boolean } = {}): NflRedraftPlayoffRuntimeState {
  const base = buildNflRedraftPlayoffRuntimeState({
    leagueId: 'L1',
    seasonId: 'S1',
    season: 2026,
    week: 15,
    rules: rules(opts.reseed ?? false),
    teams,
    seedOverride: opts.seedOverride,
  })
  if (!opts.withBracket) return base
  const { bracket } = generateNflRedraftPlayoffBracket({ state: base })
  return { ...base, bracket: { ...base.bracket, ...bracket, generated: true } }
}

const firstRoundPairs = (s: NflRedraftPlayoffRuntimeState) =>
  s.bracket.rounds[0]!.matchups.map((m) => [m.homeRosterId, m.awayRosterId])

describe('the engine honours a commish seed order', () => {
  it('without one, the standings seed the bracket', () => {
    const s = state({ withBracket: true })
    expect(s.seedingSource).toBe('standings')
    expect(s.seeds.map((x) => x.rosterId)).toEqual(['A', 'B', 'C', 'D'])
    expect(firstRoundPairs(s)).toEqual([['A', 'D'], ['B', 'C']])
  })

  it('a valid order replaces who is in AND the order, and pairs from it', () => {
    const s = state({ seedOverride: ['C', 'E', 'A', 'B'], withBracket: true })
    expect(s.seedingSource).toBe('commissioner')
    expect(s.seeds.map((x) => x.rosterId)).toEqual(['C', 'E', 'A', 'B'])
    expect(s.teams.find((t) => t.rosterId === 'E')).toMatchObject({ qualified: true, playoffSeed: 2 })
    expect(s.teams.find((t) => t.rosterId === 'D')).toMatchObject({ qualified: false, playoffSeed: null })
    expect(firstRoundPairs(s)).toEqual([['C', 'B'], ['E', 'A']])
  })

  it.each([
    [['A', 'B', 'C'], 'wrong count'],
    [['A', 'A', 'B', 'C'], 'duplicate'],
    [['A', 'B', 'C', 'Z'], 'unknown team'],
  ])('ignores an invalid order (%j: %s) and falls back to the standings', (override) => {
    const s = state({ seedOverride: override })
    expect(s.seedingSource).toBe('standings')
    expect(s.seeds.map((x) => x.rosterId)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('the reseed between rounds uses the commish order, not the standings', () => {
    // Commish puts D at 1 and A at 4. Round one: D v A, B v C. B and A win.
    const s = state({ seedOverride: ['D', 'B', 'C', 'A'], reseed: true, withBracket: true })
    for (const m of s.bracket.rounds[0]!.matchups) {
      m.winnerRosterId = m.homeRosterId === 'D' ? 'A' : 'B'
    }
    const r = advanceNflRedraftPlayoffRound({ state: s })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const final = r.state.bracket.rounds[1]!.matchups[0]!
    // By the commish order B is seed 2 and A seed 4, so B is home. By the standings it would be A.
    expect([final.homeRosterId, final.awayRosterId]).toEqual(['B', 'A'])
    expect([final.homeSeed, final.awaySeed]).toEqual([2, 4])
  })

  it('reads the stored order off the bracket row', () => {
    expect(manualSeedsFromStructure({ manualSeeds: ['C', 'E'] })).toEqual(['C', 'E'])
    expect(manualSeedsFromStructure({ manualSeeds: ['C', 5] })).toBeNull()
    expect(manualSeedsFromStructure({})).toBeNull()
    expect(manualSeedsFromStructure(null)).toBeNull()
  })
})

describe('when edits are allowed', () => {
  it('reseeding is allowed until round one is decided', () => {
    expect(reseedRefusal(state(), 'playoffs')).toBe('not_generated')
    const s = state({ withBracket: true })
    expect(reseedRefusal(s, 'playoffs')).toBeNull()
    expect(reseedRefusal(s, 'complete')).toBe('season_complete')
    s.bracket.rounds[0]!.matchups[0]!.homeScore = 101.5
    expect(reseedRefusal(s, 'playoffs')).toBe('round_one_decided')
  })

  it('a bye does not count as round one being decided', () => {
    const base = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'L1', seasonId: 'S1', season: 2026, week: 15, teams,
      rules: { ...rules(false), playoffs: { ...rules(false).playoffs, teamCount: 6 } },
    })
    const { bracket } = generateNflRedraftPlayoffBracket({ state: base })
    const s = { ...base, bracket: { ...base.bracket, ...bracket, generated: true } }
    expect(s.bracket.rounds[0]!.matchups.some((m) => m.bye && m.winnerRosterId)).toBe(true)
    expect(reseedRefusal(s, 'playoffs')).toBeNull()
  })

  it('a winner can be picked only in a round still being played, from its two teams', () => {
    const s = state({ withBracket: true })
    const m = s.bracket.rounds[0]!.matchups[0]!
    expect(winnerRefusal(s, 'playoffs', m.matchupId, 'A')).toBeNull()
    expect(winnerRefusal(s, 'playoffs', m.matchupId, 'B')).toMatch(/one of the two/)
    expect(winnerRefusal(s, 'playoffs', 'nope', 'A')).toMatch(/not in the bracket/)
    const final = s.bracket.rounds[1]!.matchups[0]!
    expect(winnerRefusal(s, 'playoffs', final.matchupId, 'A')).toMatch(/Both teams/)
    s.bracket.rounds[0]!.status = 'completed'
    expect(winnerRefusal(s, 'playoffs', m.matchupId, 'A')).toMatch(/round is over/)
  })
})

describe('the service', () => {
  beforeEach(() => {
    h.platform = 'allfantasy'
    h.structure = { playoffTeams: 4 }
    h.generate.mockReset()
    h.override.mockReset()
    h.resolved = { ok: true, state: state({ withBracket: true }), season: { id: 'S1', status: 'playoffs' } }
  })

  it('stores the order on the bracket row and regenerates from it', async () => {
    await executeCommishPlayoffEdit('L1', { action: 'reseed', seeds: ['C', 'E', 'A', 'B'] }, 'u-co')
    expect(h.structure).toEqual({ playoffTeams: 4, manualSeeds: ['C', 'E', 'A', 'B'] })
    expect(h.generate).toHaveBeenCalledWith(expect.objectContaining({ seasonId: 'S1', regenerate: true, actorUserId: 'u-co' }))
  })

  it('puts the old order back when the rebuild fails', async () => {
    h.structure = { playoffTeams: 4, manualSeeds: ['D', 'C', 'B', 'A'] }
    h.generate.mockRejectedValueOnce(new Error('boom'))
    await expect(executeCommishPlayoffEdit('L1', { action: 'reseed', seeds: ['C', 'E', 'A', 'B'] }, 'u')).rejects.toMatchObject({ status: 409 })
    expect(h.structure).toEqual({ playoffTeams: 4, manualSeeds: ['D', 'C', 'B', 'A'] })
  })

  it('reset removes the order; refusals write nothing', async () => {
    h.structure = { playoffTeams: 4, manualSeeds: ['C', 'E', 'A', 'B'] }
    h.resolved = { ok: true, state: state({ seedOverride: ['C', 'E', 'A', 'B'], withBracket: true }), season: { id: 'S1', status: 'playoffs' } }
    await executeCommishPlayoffEdit('L1', { action: 'reset_seeds' }, 'u')
    expect(h.structure).toEqual({ playoffTeams: 4 })

    h.generate.mockReset()
    await expect(executeCommishPlayoffEdit('L1', { action: 'reseed', seeds: ['A', 'A', 'B', 'C'] }, 'u')).rejects.toMatchObject({ status: 400 })
    h.platform = 'sleeper'
    await expect(executeCommishPlayoffEdit('L1', { action: 'reseed', seeds: ['A', 'B', 'C', 'D'] }, 'u')).rejects.toMatchObject({ status: 409 })
    expect(h.generate).not.toHaveBeenCalled()
  })

  it('a winner goes through the runtime override', async () => {
    const m = (h.resolved as { state: NflRedraftPlayoffRuntimeState }).state.bracket.rounds[0]!.matchups[0]!
    await executeCommishPlayoffEdit('L1', { action: 'set_winner', matchupId: m.matchupId, winnerRosterId: 'D' }, 'u-co')
    expect(h.override).toHaveBeenCalledWith(expect.objectContaining({ seasonId: 'S1', matchupId: m.matchupId, winnerRosterId: 'D', actorUserId: 'u-co' }))
  })
})

describe('route', () => {
  const ctx = { params: { leagueId: 'L1' } }
  beforeEach(() => {
    h.role = 'co_commissioner'
    h.platform = 'allfantasy'
    h.audit = []
    h.resolved = { ok: true, state: state({ withBracket: true }), season: { id: 'S1', status: 'playoffs' } }
  })

  it('refuses a member', async () => {
    h.role = 'member'
    expect((await GET(new Request('http://localhost/x') as never, ctx)).status).toBe(403)
    const res = await POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ action: 'reset_seeds' }) }) as never, ctx)
    expect(res.status).toBe(403)
  })

  it('GET returns seeds, teams and rounds', async () => {
    const body = await (await GET(new Request('http://localhost/x') as never, ctx)).json()
    expect(body).toMatchObject({ generated: true, playoffTeamCount: 4, seedingSource: 'standings', reseedBlocked: null })
    expect(body.seeds.map((s: { rosterId: string }) => s.rosterId)).toEqual(['A', 'B', 'C', 'D'])
    expect(body.teams).toHaveLength(6)
    expect(body.rounds[0].matchups[0].home).toEqual({ rosterId: 'A', name: 'Team A', seed: 1 })
  })

  it('parses only known edits', () => {
    expect(parseCommishPlayoffEdit({ action: 'reseed', seeds: [' A ', 'B'] })).toEqual({ action: 'reseed', seeds: ['A', 'B'] })
    expect(parseCommishPlayoffEdit({ action: 'set_winner', matchupId: 'm', winnerRosterId: 'A' })).toEqual({ action: 'set_winner', matchupId: 'm', winnerRosterId: 'A' })
    expect(parseCommishPlayoffEdit({ action: 'set_winner', matchupId: 'm' })).toBeNull()
    expect(parseCommishPlayoffEdit({ action: 'nuke' })).toBeNull()
  })

  it('the payload hides a bye\'s automatic winner', () => {
    const base = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'L1', seasonId: 'S1', season: 2026, week: 15, teams,
      rules: { ...rules(false), playoffs: { ...rules(false).playoffs, teamCount: 6 } },
    })
    const { bracket } = generateNflRedraftPlayoffBracket({ state: base })
    const p = bracketPayload({ ...base, bracket: { ...base.bracket, ...bracket, generated: true } }, 'playoffs')
    const bye = p.rounds[0]!.matchups.find((m) => m.bye)!
    expect(bye.winnerRosterId).toBeNull()
  })
})
