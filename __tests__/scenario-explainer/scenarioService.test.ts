import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  guillotine: false,
  rule: null as unknown,
  inputs: null as unknown,
  scores: [] as Array<{ rosterId: string; weekOrPeriod: number; periodPoints: number }>,
  chopped: [] as Array<{ rosterId: string }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ id: 'L1', name: 'League', platform: 'sleeper', platformLeagueId: 'S1', settings: {}, sport: 'NFL', leagueType: 'dynasty' })) },
    roster: { findMany: vi.fn(async () => ['r1', 'r2', 'r3', 'r4'].map((id) => ({ id }))) },
    guillotineRosterState: { findMany: vi.fn(async () => h.chopped) },
    guillotinePeriodScore: { findMany: vi.fn(async () => h.scores) },
  },
}))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({
  isGuillotineLeague: vi.fn(async () => h.guillotine),
  getGuillotineConfig: vi.fn(async () => ({ teamsPerChop: 1, eliminationStartWeek: 1, eliminationEndWeek: null })),
}))
vi.mock('@/lib/guillotine/guillotineCurrentWeek', () => ({
  resolveGuillotineCurrentWeek: vi.fn(async () => 4),
  findViewerRosterId: vi.fn(async () => 'r4'),
}))
vi.mock('@/lib/guillotine/rosterDisplayNames', () => ({
  resolveRosterDisplayNames: vi.fn(async (_l: string, ids: string[]) => new Map(ids.map((id) => [id, `Team ${id}`]))),
}))
vi.mock('@/lib/core-app/standingsDraftOrder', () => ({ readDraftOrderRule: vi.fn(async () => h.rule) }))
vi.mock('@/lib/core-app/seasonOutlook', () => ({ loadOutlookInputs: vi.fn(async () => h.inputs) }))

import { readScenarios } from '@/lib/scenario-explainer/scenarioService'

const t = (rosterId: string, wins: number, mu: number) => ({ rosterId, wins, losses: 4 - wins, pointsFor: wins * 100 + mu, profile: { mu, sigma: 12, n: 4 } })

beforeEach(() => {
  h.guillotine = false
  h.rule = { kind: 'reverse_standings' }
  h.chopped = []
  h.scores = []
  h.inputs = {
    prepared: [{
      league: { id: 'L1' }, pid: 'S1', seed: 9,
      sim: { teams: [t('1', 4, 120), t('2', 2, 105), t('3', 1, 95), t('4', 0, 80)], remaining: [{ week: 5, a: '1', b: '4' }, { week: 5, a: '2', b: '3' }], playoffTeams: 2, byeTeams: 0 },
    }],
    nameByRoster: new Map([['S1:1', 'Aces'], ['S1:2', 'Bees'], ['S1:3', 'Cats'], ['S1:4', 'Dogs']]),
    myRosters: new Set(['S1:4']),
    withheld: [],
    sportOf: new Map(),
  }
})

describe('head-to-head: the #1 pick', () => {
  it('names your team and the contenders, from Season Outlook’s own inputs', async () => {
    const r = await readScenarios('L1', 'u1')
    if (r?.kind !== 'h2h' || !r.firstPick.supported) throw new Error('expected a pick explainer')
    expect(r.firstPick.you?.name).toBe('Dogs')
    expect(r.firstPick.you!.firstPickPct).toBeGreaterThan(80)
    expect(r.firstPick.leaders[0]).toMatchObject({ name: 'Dogs', isYou: true })
  })

  it('says so when the league does not draft from its standings', async () => {
    h.rule = null
    expect(await readScenarios('L1', 'u1')).toEqual({ kind: 'h2h', firstPick: { supported: false, reason: 'no_order_rule' } })
  })

  it('says so when nothing could be modelled', async () => {
    h.inputs = null
    expect(await readScenarios('L1', 'u1')).toEqual({ kind: 'h2h', firstPick: { supported: false, reason: 'no_model' } })
  })
})

describe('guillotine: the chop', () => {
  beforeEach(() => {
    h.guillotine = true
    h.scores = [1, 2, 3].flatMap((w) => [
      { rosterId: 'r1', weekOrPeriod: w, periodPoints: 130 },
      { rosterId: 'r2', weekOrPeriod: w, periodPoints: 115 },
      { rosterId: 'r3', weekOrPeriod: w, periodPoints: 110 },
      { rosterId: 'r4', weekOrPeriod: w, periodPoints: 82 },
    ])
  })

  it('gives your survival odds and the score that keeps you safe', async () => {
    const r = await readScenarios('L1', 'u1')
    if (r?.kind !== 'guillotine' || !r.chop.supported) throw new Error('expected a chop explainer')
    expect(r.chop.week).toBe(4)
    expect(r.chop.you?.name).toBe('Team r4')
    expect(r.chop.you!.surviveWeekPct).toBeLessThan(40)
    expect(r.chop.you!.safeScore!.p80).toBeGreaterThan(90)
    expect(r.chop.table[0]).toMatchObject({ name: 'Team r4', isYou: true }) // most at risk first
  })

  it('a chopped team is told so, and is not in the table', async () => {
    h.chopped = [{ rosterId: 'r4' }]
    const r = await readScenarios('L1', 'u1')
    if (r?.kind !== 'guillotine' || !r.chop.supported) throw new Error('expected a chop explainer')
    expect(r.chop.you).toMatchObject({ chopped: true })
    expect(r.chop.table.map((x) => x.name)).not.toContain('Team r4')
  })

  it('no finished chop weeks yet means no odds', async () => {
    h.scores = []
    expect(await readScenarios('L1', 'u1')).toEqual({ kind: 'guillotine', chop: { supported: false, reason: 'no_scores' } })
  })
})
