// @vitest-environment node
/**
 * Today Actions waiver advice follows each best ball league's own add rules
 * (lib/bestball/bestBallLeagueState.ts), not the `bestBallMode` flag alone.
 *
 * It skipped every `bestBallMode` league — so a Classic Best Ball league with waivers switched on never
 * got a "must add" row — while a best ball tournament saved by `leagueType` alone (no adds at all) was
 * analysed and could be told to add a player it cannot claim.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ leagues: [] as unknown[], analyse: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: vi.fn(async () => m.leagues) } } }))
vi.mock('@/lib/ai-tools-waiver/waiver-intelligence', () => ({ runWaiverIntelligenceAnalysis: m.analyse }))

import { fetchAiWaiverLineupSignalsForUser } from '@/lib/lineup-actions/aiWaiverLineupSignals'

const league = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  name: id,
  sport: 'NFL',
  platform: 'native',
  bestBallMode: false,
  leagueType: 'redraft',
  leagueVariant: null,
  guillotineMode: false,
  settings: {},
  bbWaiversEnabled: null,
  bbFaEnabled: null,
  ...o,
})

const analysed = () => m.analyse.mock.calls.map((c) => (c[0] as { leagueId: string }).leagueId)

beforeEach(() => {
  vi.stubEnv('LINEUP_ACTION_WAIVER_SIGNALS', '1')
  vi.stubEnv('LINEUP_ACTION_WAIVER_MAX_LEAGUES', '10')
  m.analyse.mockReset().mockResolvedValue({ ok: false })
})
afterEach(() => vi.unstubAllEnvs())

describe('waiver advice in best ball leagues', () => {
  it('analyses a league that allows adds and skips one that allows none', async () => {
    m.leagues = [
      league('classic-waivers-on', { bestBallMode: true, leagueType: 'best_ball', bbWaiversEnabled: true }),
      league('classic-fa-on', { bestBallMode: true, leagueType: 'best_ball', bbFaEnabled: true }),
      league('classic-draft-only', { bestBallMode: true, leagueType: 'best_ball', bbWaiversEnabled: false, bbFaEnabled: false }),
      league('tournament-by-type', { leagueType: 'best_ball' }),
      league('guilly-best-ball', { leagueType: 'guillotine', guillotineMode: true, settings: { best_ball: true } }),
      league('redraft'),
    ]
    await fetchAiWaiverLineupSignalsForUser('u1', {} as never)
    expect(analysed()).toEqual(['classic-waivers-on', 'classic-fa-on', 'guilly-best-ball', 'redraft'])
  })
})
