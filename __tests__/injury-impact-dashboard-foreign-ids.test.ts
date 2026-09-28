/**
 * Injury Impact dashboard, on a league whose roster ids are not Sleeper ids.
 *
 * A Fleaflicker roster id is a short number in Sleeper's range: '6038' on a Fleaflicker roster is
 * NOT Sleeper's '6038'. Looked up as a Sleeper id it resolved to a real player, the injury feed was
 * mapped back onto that id by name, and the stranger's injury was flagged as ON YOUR ROSTER.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMemberWithCode: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/openai-client', () => ({ openaiChatText: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  listInjuryFacts: vi.fn(async () => ({
    facts: [
      {
        id: 'fact-1',
        playerName: 'Wrong Player',
        status: 'Out',
        team: 'KC',
        type: 'Knee',
        description: null,
        week: 3,
        fetchedAt: new Date(),
      },
    ],
  })),
}))
vi.mock('@/lib/intelligence', () => ({
  buildAiToolPayload: vi.fn(async () => null),
  attachIntelligenceToChimmyPayload: vi.fn((p: unknown) => p),
}))
vi.mock('@/lib/sports-data-normalization', () => ({
  enrichChimmyWithPlayerSportsNorm: vi.fn(async ({ chimmyPayload }: any) => chimmyPayload),
}))
vi.mock('@/lib/weather/applyWeatherToFantasyProjection', () => ({ buildWeatherAugmentFromCachedWeather: vi.fn() }))
vi.mock('@/lib/weather/defaultGameTimes', () => ({ defaultGameTimeForSport: vi.fn() }))
vi.mock('@/lib/weather/venueResolver', () => ({ fetchWeatherForTeamHomeWindow: vi.fn() }))
vi.mock('@/lib/league-context-engine', () => ({
  resolveNormalizedLeagueContext: vi.fn(async () => ({ ok: false })),
}))
vi.mock('@/lib/injury-impact-dashboard/injuryProjectionEnrichment', () => ({
  enrichInjuryRowsWithLeagueProjections: vi.fn(async () => new Map()),
}))

const prismaMock = vi.hoisted(() => ({ current: {} as Record<string, any> }))
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_t, prop: string) => prismaMock.current[prop] }),
}))

function fakePrisma(platform: string) {
  return {
    league: {
      findFirst: vi.fn(async () => ({ id: 'lg-1', name: 'Imported', sport: 'NFL', platform, teams: [] })),
    },
    roster: {
      findMany: vi.fn(async () => [
        { id: 'r-1', leagueId: 'lg-1', platformUserId: 'u-1', playerData: { players: ['6038'], starters: ['6038'] } },
      ]),
    },
    sportsPlayerRecord: { findMany: vi.fn(async () => []) },
    // The fake Sleeper player table: '6038' IS a real Sleeper id, and it is somebody else.
    sportsPlayer: {
      findMany: vi.fn(async (args: any) => {
        const asked: string[] = args?.where?.OR?.[0]?.sleeperId?.in ?? []
        return asked.includes('6038') ? [{ sleeperId: '6038', externalId: null, name: 'Wrong Player', sport: 'NFL' }] : []
      }),
    },
  }
}

async function run(platform: string) {
  prismaMock.current = fakePrisma(platform)
  const { runInjuryImpactDashboard } = await import('@/lib/injury-impact-dashboard/runInjuryImpactDashboard')
  const out = await runInjuryImpactDashboard({
    userId: 'u-1',
    sportFilter: 'NFL',
    leagueId: 'lg-1',
    teamContext: 'full_league',
    statusFilter: 'all',
    timeHorizon: 'this_week',
    toggles: {
      includePractice: true,
      includeNews: true,
      includeReturnTimelines: true,
      includeHandcuffs: false,
      includePlayoffImpact: false,
      includeDynastyImpact: false,
    },
    skipAi: true,
  } as any)
  if (!out.ok) throw new Error(`dashboard failed: ${JSON.stringify(out)}`)
  return out
}

describe('injury impact dashboard — foreign roster ids', () => {
  it("does not flag a Sleeper player's injury as on a Fleaflicker roster that shares his id", async () => {
    const out = await run('fleaflicker')
    const row = out.players.find((p) => p.name === 'Wrong Player')
    // The feed row is still listed league-wide — it just is not claimed as rostered.
    expect(row).toBeDefined()
    expect(row!.onRoster).toBe(false)
    expect(row!.isStarter).toBe(false)
    expect(out.dataGaps.join(' ')).toContain('cannot be matched')
  })

  it('CONTROL: the same id in a Sleeper league IS on the roster', async () => {
    const out = await run('sleeper')
    const row = out.players.find((p) => p.name === 'Wrong Player')
    expect(row?.onRoster).toBe(true)
    expect(row?.isStarter).toBe(true)
  })
})
