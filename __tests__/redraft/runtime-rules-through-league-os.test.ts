import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * League OS Kernel axis (2026-11-21 code re-score: "the redraft runtime screens read the league ruleset around League
 * OS"). The three NFL read resolvers take the ruleset from an injected `loadRules`; their GET routes pass League OS's
 * and report its outcomes; every other caller — anything that persists on the result — still reads it live.
 */

const h = vi.hoisted(() => ({
  liveRules: vi.fn(async () => null),
  findFirst: vi.fn(async () => ({ id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, currentWeek: 3, status: 'in_season' })),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { redraftSeason: { findFirst: h.findFirst, findUnique: h.findFirst } } }))
vi.mock('@/lib/league-runtime', async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolveCanonicalLeagueRules: h.liveRules }))

const { resolveNflRedraftTradeRuntime } = await import('@/lib/trade-runtime/resolveNflRedraftTradeRuntime')
const { resolveNflRedraftWaiverRuntime } = await import('@/lib/waiver-runtime/resolveNflRedraftWaiverRuntime')
const { resolveNflRedraftLiveScoringRuntime } = await import('@/lib/scoring-runtime/resolveNflRedraftLiveScoringRuntime')

const resolvers = [
  ['trade', (deps?: object) => resolveNflRedraftTradeRuntime({ leagueId: 'league-1' }, deps)],
  ['waiver', (deps?: object) => resolveNflRedraftWaiverRuntime({ leagueId: 'league-1' } as never, deps)],
  ['live scoring', (deps?: object) => resolveNflRedraftLiveScoringRuntime({ leagueId: 'league-1' }, deps)],
] as const

beforeEach(() => h.liveRules.mockClear())

describe.each(resolvers)('the %s runtime', (_name, run) => {
  it('reads the ruleset through the injected League OS loader, and not live', async () => {
    const loadRules = vi.fn(async () => null)
    expect(await run({ loadRules })).toEqual({ ok: false, reason: 'league_not_found' })
    expect(loadRules).toHaveBeenCalledWith('league-1')
    expect(h.liveRules).not.toHaveBeenCalled()
  })

  it('with nothing injected — every persisting caller — it still reads the ruleset live', async () => {
    expect(await run()).toEqual({ ok: false, reason: 'league_not_found' })
    expect(h.liveRules).toHaveBeenCalledWith('league-1')
  })
})
