/**
 * Opt-in parity for a single offer, through the evaluator API, Chimmy, the actual proposal
 * notification event, and the collusion scan. Only billing, transport and the NFL chart are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationEvent } from '@/lib/notification-engine'
import { createInMemoryPrisma, type InMemoryPrisma } from '../redraft-season-simulation/inMemoryPrisma'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  db: null as InMemoryPrisma | null,
  notices: [] as NotificationEvent[],
  chart: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ get prisma() { return h.db }, get default() { return h.db } }))
vi.mock('next-auth', async (load) => ({
  ...(await load<typeof import('next-auth')>()),
  getServerSession: async () => ({ user: { id: 'sender', email: 'sender@sim.allfantasy.test' } }),
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/feature-toggle', async (load) => ({
  ...(await load<typeof import('@/lib/feature-toggle')>()),
  isToolTradeAnalyzerEnabled: async () => true,
}))
vi.mock('@/lib/subscription/entitlement-middleware', async (load) => ({
  ...(await load<typeof import('@/lib/subscription/entitlement-middleware')>()),
  requireFeatureEntitlement: async () => ({ ok: true }),
}))
vi.mock('@/lib/tokens/paidToolBilling', async (load) => ({
  ...(await load<typeof import('@/lib/tokens/paidToolBilling')>()),
  withPaidToolBilling: (handler: unknown) => handler,
}))
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/notification-engine', async (load) => ({
  ...(await load<typeof import('@/lib/notification-engine')>()),
  ingest: vi.fn(async (event: NotificationEvent) => { h.notices.push(event) }),
}))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordEngineTelemetrySample: vi.fn(), recordProductEvent: vi.fn() }))
vi.mock('@/lib/events', async (load) => ({
  ...(await load<typeof import('@/lib/events')>()),
  getPlatformEvents: () => new Proxy({}, { get: () => vi.fn(async () => ({ eventId: 'sim-event', ok: true })) }),
}))
vi.mock('@/lib/fantasycalc-db', async (load) => ({
  ...(await load<typeof import('@/lib/fantasycalc-db')>()),
  getFantasyCalcChartDbFirst: h.chart,
  getFantasyCalcValuesDbFirst: async () => (await h.chart()).players,
}))
vi.mock('@/lib/decision-os/trade/explainTrade', async (load) => {
  const real = await load<typeof import('@/lib/decision-os/trade/explainTrade')>()
  return { ...real, explainTrade: (args: Parameters<typeof real.explainTrade>[0]) => real.explainTrade(args, { spendEnabled: () => false }) }
})

const SPORTS = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const
type Sport = typeof SPORTS[number]
const POSITIONS: Record<Sport, string> = {
  NFL: 'WR', NBA: 'C', NHL: 'C', MLB: 'OF', NCAAF: 'QB', NCAAB: 'C', SOCCER: 'FWD',
}
const PLAYERS = [
  { name: 'Alice Strong', owner: 'sender', strength: 40 },
  { name: 'Bobby Starter', owner: 'receiver', strength: 28 },
  { name: 'Charlie Reserve', owner: null, strength: 10 },
]
const day = 24 * 60 * 60 * 1000

async function seedOffer(sport: Sport) {
  const db = h.db!
  const season = new Date().getUTCFullYear()
  const platform = sport === 'NCAAF' ? 'fantrax' : 'native'
  const leagueId = 'parity-' + sport.toLowerCase()
  const scoring = sport === 'NCAAF' ? { pass_yd: 0.04, pass_td: 4 } : { rec: 1 }
  const league = await db.league.create({ data: {
    id: leagueId, userId: 'commish', platform, platformLeagueId: leagueId, sport, season,
    leagueType: 'redraft', leagueSize: 4, name: 'Trade parity ' + sport,
    settings: { scoring_mode: 'points', scoring_settings: scoring, trade_settings: { reviewType: 'none' } },
  } })
  const pos = POSITIONS[sport]
  const records = PLAYERS.map((p, i) => ({ ...p, id: String(600 + i), canonical: 'identity-' + i }))
  for (const userId of ['commish', 'sender', 'receiver']) {
    await db.appUser.create({ data: { id: userId, email: userId + '@sim.allfantasy.test', username: userId } })
  }
  for (const p of records) {
    await db.playerIdentityMap.create({ data: {
      id: p.canonical, canonicalName: p.name, normalizedName: p.name.toLowerCase().replaceAll(' ', ''),
      sport, position: pos, ...(sport === 'NFL' ? { sleeperId: p.id } : { rollingInsightsId: p.id }),
      ...(sport === 'NCAAF' ? { cfbdId: 'cfbd-' + p.id, fantraxId: p.id, rollingInsightsId: null } : {}),
    } })
    await db.sportsPlayer.create({ data: {
      id: 'sports-' + p.id, name: p.name, sport, position: pos, team: 'T1',
      source: sport === 'NFL' ? 'sleeper' : 'rolling_insights',
      externalId: sport === 'NFL' ? 'sleeper:' + p.id : p.id,
      ...(sport === 'NFL' ? { sleeperId: p.id } : {}), expiresAt: new Date(Date.now() + 200 * day),
    } })
    // The same bare id in the other namespace must never substitute a different player.
    if (sport === 'NBA' && p.owner) {
      await db.sportsPlayer.create({ data: {
        id: 'wrong-' + p.id, name: 'Wrong ' + p.name, sport, position: pos, team: 'T2',
        source: 'sleeper', externalId: 'sleeper:' + p.id, sleeperId: p.id, expiresAt: new Date(Date.now() + 200 * day),
      } })
    }
    if (p.owner) {
      const rosterId = 'roster-' + p.owner
      await db.roster.create({ data: { id: rosterId, leagueId, platformUserId: p.owner, playerData: { players: [p.id], starters: [p.id] } } })
      await db.leagueTeam.create({ data: {
        id: 'team-' + p.owner, leagueId, externalId: rosterId, platformUserId: p.owner,
        claimedByUserId: p.owner, ownerName: p.owner, teamName: p.owner, legacyRosterId: rosterId,
      } })
    }
    if (sport === 'SOCCER') {
      for (let match = 0; match < 12; match++) {
        await db.playerGameStat.create({ data: {
          playerId: p.canonical, gameId: 'soc-' + match, sportType: sport, season, weekOrRound: match + 1,
          team: 'T1', gameDate: new Date(Date.now() - (12 - match) * day), statPayload: {},
          normalizedStatMap: { group: 'fielders', position: 'Forward', stats: { goals: p.strength / 30, minutes_played: 90 } },
        } })
      }
    } else if (sport !== 'NFL') {
      const points = p.strength
      const rates = sport === 'NCAAF' ? { pass_yd: points * 10, pass_td: 2 }
        : sport === 'NHL' ? { goals: points / 20, assists: points / 20, shots: points / 5 }
          : sport === 'MLB' ? { ab: 4, h: points / 24, hr: points / 100, r: points / 50, rbi: points / 40 }
            : { points }
      await db.aFProjectionSnapshot.create({ data: {
        playerId: sport === 'NCAAF' ? 'cfbd-' + p.id : p.canonical, playerName: p.name, sport, position: pos,
        season, week: null, baselineProjection: points, afProjection: points, snapshotLookupKey: sport + ':' + p.id,
        adjustmentFactors: { perGameRates: rates, confidenceReasons: ['60 games in the season sample'], sourceSeason: season },
      } })
    }
  }
  if (sport !== 'NFL') {
    for (let i = 0; i < 24; i++) {
      await db.sportsGame.create({ data: {
        sport, externalId: 'future-' + i, homeTeam: 'T1', awayTeam: 'T2', source: 'simulation', season,
        seasonType: 'regular', week: i % 13 + 1, startTime: new Date(Date.now() + (i + 1) * day),
        expiresAt: new Date(Date.now() + 365 * day),
      } })
    }
  }
  h.chart.mockResolvedValue({
    syncedAt: new Date().toISOString(),
    players: sport === 'NFL' ? records.map((p, i) => ({
      player: { id: i + 1, name: p.name, sleeperId: p.id, position: pos, maybeAge: 25 },
      value: p.strength * 100, redraftValue: p.strength * 100, overallRank: i + 1,
    })) : [],
  })
  return { db, league, records }
}

describe.skipIf(process.env.SIM_TRADE_PARITY !== '1')('same-trade grades across four surfaces', () => {
  beforeEach(() => {
    h.db = createInMemoryPrisma()
    h.notices.length = 0
    h.chart.mockReset()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network disabled in trade parity fixture') }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(SPORTS)('%s with usable redraft inputs', { timeout: 120_000 }, async (sport) => {
    const { db, league, records } = await seedOffer(sport)
    const [{ createAfLeagueTrade, proposalOneGrade }, { POST }, { executeChimmyTool }, { scanTradeForCollusion }] = await Promise.all([
      import('@/lib/league-trade-engine/tradeService').then(async (service) => ({ ...service, ...(await import('@/lib/league-trade-engine/serverTradeDecision')) })),
      import('@/app/api/trade-evaluator/route'),
      import('@/lib/chimmy/tools/chimmyTools'),
      import('@/lib/integrity/CollusionDetectionEngine'),
    ])
    const [a, b] = records
    const giver = 'roster-sender'
    const receiver = 'roster-receiver'
    const assets = [
      { itemType: 'player', itemReference: a!.id, fromRosterId: giver, toRosterId: receiver },
      { itemType: 'player', itemReference: b!.id, fromRosterId: receiver, toRosterId: giver },
    ] satisfies Parameters<typeof proposalOneGrade>[0]['assets']
    const input = { leagueId: league.id, proposedByUserId: 'sender', proposerRosterId: giver, receiverRosterId: receiver, assets }
    const proposed = await proposalOneGrade(input)
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ graded: true })
    if (!proposed.graded) throw new Error(proposed.reason)

    const trade = await createAfLeagueTrade(input)
    const sent = h.notices.find((n) => n.type === 'trade_proposed' && n.meta?.tradeId === trade.id)
    expect(sent?.title).toContain(proposed.partnerLetter + ' for you')
    expect(sent?.userIds).toContain('receiver')

    const response = await POST(createMockNextRequest('http://localhost/api/trade-evaluator', {
      method: 'POST',
      body: {
        leagueId: league.id, league: { sport }, ...(sport === 'SOCCER' ? { asOfDate: '2026-10-05' } : {}),
        sender: { team_id: giver, manager_name: sport + ' sender', gives_players: [{ name: a!.name, providerPlayerId: a!.id }] },
        receiver: { team_id: receiver, manager_name: sport + ' receiver', gives_players: [{ name: b!.name, ...(sport === 'NFL' ? { sleeperPlayerId: b!.id } : { providerPlayerId: b!.id }) }] },
      },
    }), {} as Parameters<typeof POST>[1])
    const result = await response.json()
    expect(response.status, JSON.stringify(result)).toBe(200)
    expect(result.tradeGrade).toMatchObject({ grade: proposed.letter, partnerGrade: proposed.partnerLetter, giveValue: proposed.giveValue, getValue: proposed.getValue })

    const tradeGrades: Array<{ letters: string[] }> = []
    const giveName = sport === 'NCAAF' ? 'Strong, Alice' : a!.name
    const chimmy = await executeChimmyTool('evaluate_trade', { give: [giveName], get: [b!.name] }, {
      leagueId: league.id, userId: 'sender', tradeGrades,
    } as never)
    expect(tradeGrades, String(chimmy)).toEqual([expect.objectContaining({ letters: [proposed.letter, proposed.partnerLetter] })])

    const scanned = await scanTradeForCollusion(league.id, trade.id, { kind: 'af', tradeId: trade.id }, { notify: async () => {} })
    expect(scanned.valuation).toEqual({ status: 'priced', percentDiff: proposed.market?.percentDiff ?? proposed.percentDiff })
    expect(await db.sportsDataCache.findUnique({ where: { cacheKey: 'collusion-valuation:v1:' + league.id } })).toMatchObject({ data: scanned.valuation })
    if (sport !== 'NFL') expect(h.chart).not.toHaveBeenCalled()
  })

  it('reports missing projections without skipping the independent repeat-pair check', async () => {
    const { db, league, records } = await seedOffer('NBA')
    await db.aFProjectionSnapshot.deleteMany({ where: { sport: 'NBA' } })
    const [{ createAfLeagueTrade }, { scanTradeForCollusion }, { POST }, { executeChimmyTool }] = await Promise.all([
      import('@/lib/league-trade-engine/tradeService'),
      import('@/lib/integrity/CollusionDetectionEngine'),
      import('@/app/api/trade-evaluator/route'),
      import('@/lib/chimmy/tools/chimmyTools'),
    ])
    const [a, b] = records
    const trade = await createAfLeagueTrade({
      leagueId: league.id, proposedByUserId: 'sender', proposerRosterId: 'roster-sender', receiverRosterId: 'roster-receiver',
      assets: [
        { itemType: 'player', itemReference: a!.id, fromRosterId: 'roster-sender', toRosterId: 'roster-receiver' },
        { itemType: 'player', itemReference: b!.id, fromRosterId: 'roster-receiver', toRosterId: 'roster-sender' },
      ],
    })
    const sent = h.notices.find((n) => n.type === 'trade_proposed' && n.meta?.tradeId === trade.id)
    expect(sent?.title).toMatch(/^New trade offer/)
    expect(sent?.title).not.toMatch(/[A-F] for you/)
    const response = await POST(createMockNextRequest('http://localhost/api/trade-evaluator', {
      method: 'POST', body: {
        leagueId: league.id,
        sender: { manager_name: 'No projections sender', gives_players: [a!.name] },
        receiver: { manager_name: 'No projections receiver', gives_players: [b!.name] },
      },
    }), {} as Parameters<typeof POST>[1])
    const result = await response.json()
    expect(result.tradeGrade).toMatchObject({ grade: null, valuationGap: 'missing_projections' })
    const reason = result.tradeGrade.gradeWithheld
    const chimmy = await executeChimmyTool('evaluate_trade', { give: [a!.name], get: [b!.name] }, {
      leagueId: league.id, userId: 'sender',
    })
    expect(String(chimmy)).toContain(reason.replace(/\.$/, ''))
    const pairCheck = vi.fn(async () => null)
    const scanned = await scanTradeForCollusion(league.id, trade.id, { kind: 'af', tradeId: trade.id }, { pairCheck, notify: async () => {} })
    expect(scanned.valuation).toEqual({ status: 'unavailable', reason, gap: 'missing_projections' })
    expect(scanned.flags).toEqual([])
    expect(pairCheck).toHaveBeenCalledWith(league.id)
  })
})
