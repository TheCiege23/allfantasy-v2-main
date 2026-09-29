/**
 * Injury Impact dashboard: which injured players are "on your roster".
 *
 * 🛑 The roster-identity read matched ids against `SportsPlayer.sleeperId` OR `externalId`, and
 * `externalId` holds Rolling Insights' own numbers for different people: Sleeper 9228 is Bryce
 * Young, RI 9228 is Michael Tarquin, an offensive tackle. The name→id map then sent Tarquin's
 * injury report to 9228, so it was flagged as on the roster (and as a starter). An ESPN league's
 * ids were the opposite failure — never translated, so its own injured players matched nobody.
 * The native NHL case must keep working: those rosters hold Rolling Insights ids by design.
 * The mock database honours the query's `where`, as Postgres does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, string | null>
type Where = Record<string, unknown>

const h = vi.hoisted(() => ({
  facts: [] as Array<{ name: string; status: string }>,
  league: { sport: 'NFL', platform: 'sleeper' },
  players: [] as string[],
}))

const SPORTS_PLAYERS: Row[] = [
  // Impostor first: the old map let the LAST row written win, and the name map the first.
  { sport: 'NFL', sleeperId: null, externalId: '9228', source: 'rolling_insights', name: 'Michael Tarquin' },
  { sport: 'NFL', sleeperId: '9228', externalId: 'sleeper:9228', source: 'sleeper', name: 'Bryce Young' },
  { sport: 'NHL', sleeperId: null, externalId: '1086', source: 'rolling_insights', name: 'Aaron Dell' },
]
const IDENTITY_MAP: Row[] = [{ sport: 'NFL', espnId: '4040404', sleeperId: '9228', canonicalName: 'Bryce Young' }]

function matches(row: Row, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Where[]).some((c) => matches(row, c))) return false
    } else if (cond && typeof cond === 'object') {
      const c = cond as { in?: string[]; not?: string | null }
      if (c.in && !c.in.includes(row[key] as string)) return false
      if ('not' in c && row[key] === c.not) return false
    } else if (row[key] !== cond) return false
  }
  return true
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMemberWithCode: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/openai-client', () => ({ openaiChatText: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  listInjuryFacts: vi.fn(async ({ sport }: { sport: string }) => ({
    facts: sport !== h.league.sport
      ? []
      : h.facts.map((f, i) => ({
          id: `fact-${i}`,
          playerName: f.name,
          status: f.status,
          team: 'X',
          type: 'Knee',
          description: null,
          week: 4,
          fetchedAt: new Date(),
        })),
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
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/injury-impact-dashboard/injuryProjectionEnrichment', () => ({
  enrichInjuryRowsWithLeagueProjections: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: vi.fn(async () => ({ id: 'lg-1', name: 'L', sport: h.league.sport, platform: h.league.platform, teams: [] })),
    },
    roster: {
      findMany: vi.fn(async () => [
        { id: 'r-1', leagueId: 'lg-1', platformUserId: 'u-1', playerData: { players: h.players, starters: h.players } },
      ]),
    },
    sportsPlayerRecord: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findMany: vi.fn(async ({ where }: { where: Where }) => SPORTS_PLAYERS.filter((r) => matches(r, where))) },
    playerIdentityMap: { findMany: vi.fn(async ({ where }: { where: Where }) => IDENTITY_MAP.filter((r) => matches(r, where))) },
  },
}))

import { runInjuryImpactDashboard } from '@/lib/injury-impact-dashboard/runInjuryImpactDashboard'

async function run() {
  const out = await runInjuryImpactDashboard({
    userId: 'u-1',
    sportFilter: h.league.sport,
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
const rowFor = (out: Awaited<ReturnType<typeof run>>, name: string) => out.players.find((p) => p.name === name)

beforeEach(() => {
  h.facts = [
    { name: 'Michael Tarquin', status: 'Out' },
    { name: 'Bryce Young', status: 'Questionable' },
  ]
  h.league = { sport: 'NFL', platform: 'sleeper' }
  h.players = ['9228']
})

describe('injury impact dashboard — roster ids are asked in their own id space', () => {
  it("Sleeper league: the RI player who shares 9228 is NOT on the roster; Bryce Young is, as a starter", async () => {
    const out = await run()
    expect(rowFor(out, 'Michael Tarquin')?.onRoster).toBe(false)
    expect(rowFor(out, 'Michael Tarquin')?.isStarter).toBe(false)
    expect(rowFor(out, 'Bryce Young')?.onRoster).toBe(true)
    expect(rowFor(out, 'Bryce Young')?.isStarter).toBe(true)
  })

  it('ESPN league: an ESPN id is translated to its Sleeper id; an untranslatable one is dropped and said', async () => {
    h.league = { sport: 'NFL', platform: 'espn' }
    h.players = ['4040404', '5050505']
    const out = await run()
    expect(rowFor(out, 'Bryce Young')?.onRoster).toBe(true)
    expect(rowFor(out, 'Bryce Young')?.isStarter).toBe(true)
    expect(out.dataGaps.join(' ')).toContain('1 ESPN roster player has no linked identity yet')
  })

  it("native NHL: a Rolling Insights id is still matched — Sleeper has no NHL ids to collide with", async () => {
    h.league = { sport: 'NHL', platform: 'manual' }
    h.players = ['1086']
    h.facts = [{ name: 'Aaron Dell', status: 'Out' }]
    const out = await run()
    expect(rowFor(out, 'Aaron Dell')?.onRoster).toBe(true)
  })
})
