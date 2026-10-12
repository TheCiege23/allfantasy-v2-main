// @vitest-environment node
/**
 * The legacy compare and trade-analyze prompts state "now" from the clock, and the tier-name
 * lookups that remained (trade-constraints untouchables / cornerstones) check the position group.
 *
 * 🛑 Measured 2026-10-12: /api/legacy/compare froze "CURRENT DATE" at process start, told the model
 * "The 2024 NFL Draft class … have completed their rookie seasons", and fetched only seasons
 * 2020–2024 — so neither manager's 2025 or 2026 season was ever graded. LB Justin Jefferson was an
 * untouchable in `identifyUntouchables` by lowercase name alone.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ create: vi.fn(), getUserLeagues: vi.fn() }))

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: () => ({ chat: { completions: { create: m.create } } }),
}))
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  consumeRateLimit: () => ({ success: true, remaining: 4 }),
}))
vi.mock('@/lib/analytics-server', () => ({ trackLegacyToolUsage: vi.fn() }))
vi.mock('@/lib/sleeper-client', () => ({
  getSleeperUser: vi.fn(async (u: string) => ({ user_id: `id-${u}`, username: u, display_name: u })),
  getUserLeagues: m.getUserLeagues,
  getLeagueRosters: vi.fn(async (leagueId: string) => [
    { roster_id: 1, owner_id: leagueId.replace('L-', '').replace(/-\d+$/, ''), settings: { wins: 8, losses: 6, ties: 0, rank: 3 } },
  ]),
  getPlayoffBracket: vi.fn(async () => []),
  getLeagueType: vi.fn(() => 'dynasty'),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn(async () => []) } }))

import { POST as compare } from '@/server/api-route-modules/legacy/compare/route'
import { identifyCornerstones, identifyUntouchables, validateCornerstoneProtection } from '@/lib/trade-constraints'
import { ProjectionEngine } from '@/lib/projections/projection-engine'

const OCT_2026 = new Date('2026-10-12T15:00:00Z')
const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(OCT_2026)
})
afterAll(() => vi.useRealTimers())

describe('/api/legacy/compare', () => {
  it('fetches the five most recent seasons and builds the prompt from today', async () => {
    m.getUserLeagues.mockImplementation(async (userId: string, _sport: string, season: string) =>
      season === '2026'
        ? [{ league_id: `L-${userId}-${season}`, name: 'Dynasty', season, status: 'in_season', settings: {}, roster_positions: [] }]
        : [],
    )
    m.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ verdict: 'ok' }) } }] })
    await (compare as (r: unknown) => Promise<Response>)(
      new Request('http://localhost/api/legacy/compare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username_a: 'alice', username_b: 'bob' }),
      }) as never,
    )
    const seasons = Array.from(new Set(m.getUserLeagues.mock.calls.map((c) => String(c[2]))))
    expect(seasons).toEqual(['2026', '2025', '2024', '2023', '2022'])

    expect(m.create).toHaveBeenCalledTimes(1)
    const system = String(m.create.mock.calls[0]![0].messages[0].content)
    expect(system).toMatch(/Today's date: October 12, 2026/)
    expect(system).toMatch(/Current fantasy season: 2026/)
    expect(system).toMatch(/most recent NFL Draft was in 2026/)
    expect(system).not.toMatch(/2024 NFL Draft class|completed their rookie seasons/)
    expect(system).not.toMatch(/\b202[3-5]\b/)
  })
})

describe('legacy trade analyzer prompt examples', () => {
  it('derives the "ceiling" / "outlook" years instead of literal 2025 / 2026+', () => {
    const s = src('server/api-route-modules/legacy/trade/analyze/route.ts')
    expect(s).not.toMatch(/your 2025 ceiling|your 2026\+ outlook/)
    expect(s).toMatch(/hurts your \$\{season\} ceiling/)
    expect(s).toMatch(/what happens to your \$\{season \+ 1\}\+ outlook/)
    expect(s).toMatch(/const season = legacyPromptSeason\(now\)/)
  })
})

describe('ProjectionEngine.currentSeason', () => {
  it('is the current fantasy season, not a literal', () => {
    expect((new ProjectionEngine() as unknown as { currentSeason: number }).currentSeason).toBe(2026)
  })
})

describe('trade-constraints tier lookups check the position group', () => {
  it('LB Justin Jefferson is neither an untouchable nor a cornerstone; the WR is both', () => {
    expect(identifyUntouchables([{ name: 'Justin Jefferson', pos: 'LB' }])).toEqual([])
    expect(identifyCornerstones([{ name: 'Justin Jefferson', pos: 'LB' }], {})).toEqual([])
    expect(identifyUntouchables([{ name: 'Justin Jefferson', pos: 'WR' }])).toEqual(['Justin Jefferson'])
    expect(identifyCornerstones([{ name: 'Lamar Jackson', pos: 'CB' }], {})).toEqual([])
    expect(identifyCornerstones([{ name: 'Lamar Jackson', pos: 'QB' }], {})).toEqual(['Lamar Jackson'])
  })
  it('the trade-history readers go through findPlayerTier, not a bare name find on the tier list', () => {
    for (const f of ['lib/ai-gm-intelligence.ts', 'lib/trade-pre-analysis.ts', 'lib/smart-trade-recommendations.ts', 'lib/trade-constraints.ts']) {
      const s = src(f)
      expect(s, f).not.toMatch(/ALL_TIERED_PLAYERS|TIER_[01]_[A-Z]+/)
      expect(s, f).toMatch(/findPlayerTier\(/)
    }
    expect(src('lib/trade-pre-analysis.ts')).toMatch(/findPlayerTier\(p\.name, p\.position\)/)
    expect(src('lib/smart-trade-recommendations.ts').match(/findPlayerTier\(p\.name, p\.position\)/g)?.length).toBe(3)
    expect(src('lib/ai-gm-intelligence.ts').match(/findPlayerTier\(p\.name, p\.position\)/g)?.length).toBe(2)
  })
  it('a received asset with no position counts as a cornerstone by exact name only', () => {
    const given = [{ name: 'Justin Jefferson', value: 9000 }]
    expect(validateCornerstoneProtection(given, [{ name: 'Bijan Robinson', value: 8000 }], ['Justin Jefferson']).isValid).toBe(true)
    // "Robinson" is contained in "Bijan Robinson" — that is not a cornerstone.
    expect(validateCornerstoneProtection(given, [{ name: 'Robinson', value: 8000 }], ['Justin Jefferson']).isValid).toBe(false)
  })
})
