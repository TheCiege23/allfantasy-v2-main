/**
 * NCAAF weekly scoring, from the CFBD game row to a `PlayerWeeklyScore`.
 *
 * 🛑 THE SYNC THREW FOR EVERY NCAAF LEAGUE ("wired for NFL, NBA and NHL"), so a native college
 * league could be created and drafted and then never scored a point. The CFBD per-game rows were
 * already being ingested on a schedule; nothing read them.
 *
 * The fixture is a real CFBD `/games/players` response (see cfbd-game-logs.test.ts), run through the
 * SAME parser and normalizer the scheduled ingest uses, so these tests read exactly what production
 * stores in `player_game_stats.normalizedStatMap`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  adminAuditLog: { create: vi.fn() },
  league: { findFirst: vi.fn(), findUnique: vi.fn() },
  playerGameLogCache: { findMany: vi.fn() },
  playerGameStat: { findMany: vi.fn() },
  playerIdentityMap: { findFirst: vi.fn(), findMany: vi.fn() },
  playerWeeklyScore: { upsert: vi.fn(), findUnique: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  sportsGame: { findMany: vi.fn() },
  sportsPlayer: { findFirst: vi.fn(), findMany: vi.fn() },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/schedule-stats', () => ({ ingestSportStats: vi.fn() }))

import fixture from '../fixtures/cfbd/games-players.2026-w3.sample.json'
import { parseCfbdGamePlayers } from '@/lib/stats/cfbdGameLogs'
import { normalizeStatPayload } from '@/lib/schedule-stats/StatNormalizationService'
import { aggregateNcaafWeek, normalizeCfbdGameStats, NCAAF_STAT_ALIASES } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { bridgeNcaafRosterIdsToCfbdIds } from '@/lib/redraft/ncaafGameLogIdBridge'

/** What `ingestSportStats` stores as `normalizedStatMap` for one parsed CFBD row. */
function storedMap(payload: Record<string, unknown>): Record<string, number> {
  const numeric: Record<string, number> = {}
  for (const [k, v] of Object.entries(payload)) if (typeof v === 'number') numeric[k] = v
  return normalizeStatPayload('NCAAF', numeric)
}

const ROWS = parseCfbdGamePlayers(fixture)
const STORED = ROWS.map((r) => ({ playerId: r.playerId, map: storedMap(r.statPayload) }))
const CURTIS = STORED.find((r) => r.playerId === '5158948')!.map // Vanderbilt QB, week 3

describe('normalizeCfbdGameStats — against the captured CFBD response', () => {
  it('reads a QB line into the canonical keys the NCAAF config scores', () => {
    const { stats, appeared } = normalizeCfbdGameStats(CURTIS)
    expect(appeared).toBe(true)
    expect(stats).toMatchObject({ pass_yds: 277, pass_td: 3, pass_int: 2 })
  })

  it('every key in the real response is either scored or a known non-scoring stat — none unmapped', () => {
    const unmapped = new Set(STORED.flatMap((r) => normalizeCfbdGameStats(r.map).unmappedKeys))
    expect([...unmapped]).toEqual([])
  })

  it('every scored value is carried through unchanged, for every player in the response', () => {
    let checked = 0
    for (const { map } of STORED) {
      const { stats } = normalizeCfbdGameStats(map)
      for (const [cfbdKey, canonical] of Object.entries(NCAAF_STAT_ALIASES)) {
        if (typeof map[cfbdKey] === 'number') {
          expect(stats[canonical]).toBe(map[cfbdKey])
          checked += 1
        }
      }
    }
    expect(checked).toBeGreaterThan(100) // the positive control: the loop actually compared values
  })

  it('a vendor rename is reported, not silently scored as zero', () => {
    expect(normalizeCfbdGameStats({ 'passing.YARDS': 300 }).unmappedKeys).toEqual(['passing.YARDS'])
  })

  it('a player who appeared and produced nothing counts as a game — a real zero, not missing data', () => {
    const week = aggregateNcaafWeek([{ 'defensive.TOT': 3, name: 'x' }])
    expect(week).toEqual({ stats: { idp_tackle: 3 }, gamesCounted: 1, unmappedKeys: [] })
    expect(aggregateNcaafWeek([{ name: 'x', _team: 'Vanderbilt' }]).gamesCounted).toBe(0)
  })

  it('sums a rare two-game week', () => {
    expect(aggregateNcaafWeek([{ 'rushing.YDS': 40 }, { 'rushing.YDS': 60, 'rushing.TD': 1 }]).stats).toEqual({ rush_yds: 100, rush_td: 1 })
  })
})

describe('bridgeNcaafRosterIdsToCfbdIds', () => {
  function db(opts: {
    cfbdPool?: string[]
    identity?: Array<{ id: string; rollingInsightsId: string | null; cfbdId: string | null }>
  }) {
    const identity = opts.identity ?? []
    return {
      sportsPlayer: { findMany: vi.fn(async () => (opts.cfbdPool ?? []).map((externalId) => ({ externalId }))) },
      playerIdentityMap: {
        findMany: vi.fn(async ({ where }: { where: Record<string, any> }) =>
          identity.filter((r) =>
            where.rollingInsightsId ? where.rollingInsightsId.in.includes(r.rollingInsightsId) : where.id.in.includes(r.id),
          ),
        ),
      },
    }
  }

  it('a CFBD-sourced pool player is its own CFBD id; an RI player is reached through its identity row', async () => {
    const b = await bridgeNcaafRosterIdsToCfbdIds(
      db({ cfbdPool: ['5158948'], identity: [{ id: 'pim-1', rollingInsightsId: '77001', cfbdId: '4432577' }] }) as never,
      ['5158948', '77001'],
    )
    expect(b.cfbdIds.sort()).toEqual(['4432577', '5158948'])
    expect(b.rosterIdFor('5158948')).toBe('5158948')
    expect(b.rosterIdFor('4432577')).toBe('77001')
    expect(b.viaIdentity).toBe(1)
    expect(b.unresolved).toEqual([])
  })

  it('🛑 a bare number is never matched to itself — an RI id with no identity link is unresolved, not self-scored', async () => {
    const b = await bridgeNcaafRosterIdsToCfbdIds(db({}) as never, ['5158948', 'name:jared-curtis'])
    expect(b.cfbdIds).toEqual([])
    expect(b.unresolved).toEqual(['5158948', 'name:jared-curtis'])
  })

  it('an id that is a CFBD pool id AND a different player’s RI id is refused', async () => {
    const b = await bridgeNcaafRosterIdsToCfbdIds(
      db({ cfbdPool: ['5158948'], identity: [{ id: 'pim-9', rollingInsightsId: '5158948', cfbdId: '999' }] }) as never,
      ['5158948'],
    )
    expect(b.cfbdIds).toEqual([])
    expect(b.ambiguous).toEqual(['5158948'])
  })

  it('two roster players resolving to one CFBD athlete: neither is scored', async () => {
    const b = await bridgeNcaafRosterIdsToCfbdIds(
      db({ cfbdPool: ['4432577'], identity: [{ id: 'pim-1', rollingInsightsId: '77001', cfbdId: '4432577' }] }) as never,
      ['4432577', '77001'],
    )
    expect(b.cfbdIds).toEqual([])
    expect(b.ambiguous).toEqual(['4432577', '77001'])
  })
})

describe('syncPlayerWeeklyScoresForRedraftSeason — NCAAF', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.adminAuditLog.create.mockResolvedValue({})
    prismaMock.playerWeeklyScore.upsert.mockResolvedValue({})
    prismaMock.playerGameLogCache.findMany.mockResolvedValue([])
    prismaMock.sportsGame.findMany.mockResolvedValue([])
    prismaMock.playerIdentityMap.findFirst.mockResolvedValue(null)
    prismaMock.sportsPlayer.findFirst.mockResolvedValue(null)
    // Real NCAAF config, no commissioner overrides.
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'NCAAF', settings: {} })
    prismaMock.league.findUnique.mockResolvedValue({ sport: 'NCAAF', settings: {} })
    // `RedraftSeason.sport` stores the config key, not 'NCAAF'.
    prismaMock.redraftSeason.findFirst.mockResolvedValue({ id: 's1', leagueId: 'L1', sport: 'NCAAFB', season: 2026, currentWeek: 3 })
    prismaMock.redraftRoster.findMany.mockResolvedValue([{ id: 'r1' }])
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([
      { playerId: '5158948', sport: 'NCAAFB', position: 'QB', team: 'Vanderbilt' },
      { playerId: '77001', sport: 'NCAAFB', position: 'RB', team: 'X' },
      { playerId: 'ncaaf-def-x', sport: 'NCAAFB', position: 'DEF', team: 'X' },
    ])
    prismaMock.sportsPlayer.findMany.mockResolvedValue([{ externalId: '5158948' }])
    prismaMock.playerIdentityMap.findMany.mockImplementation(async ({ where }: { where: Record<string, any> }) =>
      where.rollingInsightsId?.in?.includes('77001') ? [{ id: 'pim-1', rollingInsightsId: '77001', cfbdId: '4432577' }] : [],
    )
    prismaMock.playerGameStat.findMany.mockResolvedValue([
      { playerId: '5158948', normalizedStatMap: CURTIS },
      // Appeared, produced nothing that scores: a real zero.
      { playerId: '4432577', normalizedStatMap: { 'rushing.CAR': 0, 'fumbles.FUM': 0 } },
    ])
  })

  async function run() {
    const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
    return syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 's1', week: 3, actorId: 'system:test' })
  }

  it('🛑 no longer throws for an NCAAF season (stored as NCAAFB)', async () => {
    await expect(run()).resolves.toBeTruthy()
  })

  it('reads CFBD rows BY WEEK and season, under the NCAAF sport key — not by date window', async () => {
    await run()
    expect(prismaMock.playerGameStat.findMany).toHaveBeenCalledWith({
      where: { playerId: { in: expect.arrayContaining(['5158948', '4432577']) }, sportType: { in: ['NCAAF', 'ncaaf'] }, season: 2026, weekOrRound: 3 },
      select: { playerId: true, normalizedStatMap: true },
    })
    expect(prismaMock.playerGameLogCache.findMany).not.toHaveBeenCalled()
  })

  it('scores the QB from the real config and credits the row to the ROSTER id, stored under NCAAFB', async () => {
    const summary = await run()
    const qb = prismaMock.playerWeeklyScore.upsert.mock.calls.find((c) => c[0].create.playerId === '5158948')![0]
    // His real week-3 line: 277 pass yds, 3 TD, 2 INT, 12-64 rushing, 2 fumbles (1 lost).
    expect(qb.create).toMatchObject({
      week: 3, season: 2026, sport: 'NCAAFB',
      stats: { pass_yds: 277, pass_td: 3, pass_int: 2, rush_yds: 64, rush_td: 0, fum_lost: 1 },
    })
    // Every term, from the NCAAF config: 277*.04 + 3*4 + 2*-2 + 64*.1 + 0*6 + 1*-2 = 23.48
    expect(qb.create.fantasyPts).toBeCloseTo(277 * 0.04 + 3 * 4 + 2 * -2 + 64 * 0.1 + 1 * -2, 5)
    // The RI player scored from his CFBD row, credited to his roster id.
    const rb = prismaMock.playerWeeklyScore.upsert.mock.calls.find((c) => c[0].create.playerId === '77001')![0]
    expect(rb.create).toMatchObject({ fantasyPts: 0, stats: {} })
    expect(summary).toMatchObject({ scoresUpserted: 2, cfbdIdsResolved: 2 })
  })

  it('a college team defense has no stat line: reported unscored, never sent to the NFL box-score path', async () => {
    const summary = await run()
    expect(summary.missingCachePlayerIds).toContain('ncaaf-def-x')
    expect(summary.unresolvedCfbdPlayerIds).toEqual(['ncaaf-def-x'])
    expect(prismaMock.sportsGame.findMany).not.toHaveBeenCalled()
  })
})

/**
 * 🛑 CFBD LISTS ONLY PLAYERS WHO RECORDED A STAT, and a starter with no score counts against the
 * finalizer's 80% coverage floor. Measured on production 2026-09-28: managed 12-team lineups covered
 * 78-87% of starters in weeks 2-4, autopicked ones ~27% — and every missing starter was a bye or a
 * school whose final game WAS ingested. A resolved starter with no row now scores a real 0 for those
 * two, and stays missing only for a game that is unfinished, final but never ingested, or unplaceable.
 */
describe('syncPlayerWeeklyScoresForRedraftSeason — NCAAF starters with no CFBD row', () => {
  const SCHEDULE = [
    { homeTeam: 'Vanderbilt', awayTeam: 'Georgia State', week: 3, externalId: '1001', status: 'completed' },
    { homeTeam: 'Florida', awayTeam: 'LSU', week: 3, externalId: '1002', status: 'completed' }, // final, never ingested
    { homeTeam: 'Texas', awayTeam: 'Rice', week: 3, externalId: '1003', status: 'scheduled' },
    { homeTeam: 'Kentucky', awayTeam: 'Ohio', week: 2, externalId: '0901', status: 'completed' }, // Kentucky: bye in week 3
  ]
  const ROSTER = [
    { playerId: '5158948', sport: 'NCAAFB', position: 'QB', team: 'Vanderbilt University' },
    { playerId: '2001', sport: 'NCAAFB', position: 'WR', team: 'Georgia State University' },
    { playerId: '2002', sport: 'NCAAFB', position: 'WR', team: 'University of Kentucky' },
    { playerId: '2003', sport: 'NCAAFB', position: 'RB', team: 'University of Florida' },
    { playerId: '2004', sport: 'NCAAFB', position: 'TE', team: 'University of Texas' },
    { playerId: '2005', sport: 'NCAAFB', position: 'WR', team: 'Hogwarts' },
    { playerId: '77009', sport: 'NCAAFB', position: 'RB', team: 'Georgia State University' }, // not linked to CFBD
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.adminAuditLog.create.mockResolvedValue({})
    prismaMock.playerWeeklyScore.upsert.mockResolvedValue({})
    prismaMock.playerGameLogCache.findMany.mockResolvedValue([])
    prismaMock.playerIdentityMap.findFirst.mockResolvedValue(null)
    prismaMock.playerIdentityMap.findMany.mockResolvedValue([])
    prismaMock.sportsPlayer.findFirst.mockResolvedValue(null)
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'NCAAF', settings: {} })
    prismaMock.league.findUnique.mockResolvedValue({ sport: 'NCAAF', settings: {} })
    prismaMock.redraftSeason.findFirst.mockResolvedValue({ id: 's1', leagueId: 'L1', sport: 'NCAAFB', season: 2026, currentWeek: 3 })
    prismaMock.redraftRoster.findMany.mockResolvedValue([{ id: 'r1' }])
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue(ROSTER)
    // Every player but 77009 is a CFBD pool player, so his roster id IS his CFBD id.
    prismaMock.sportsPlayer.findMany.mockResolvedValue(['5158948', '2001', '2002', '2003', '2004', '2005'].map((externalId) => ({ externalId })))
    prismaMock.sportsGame.findMany.mockResolvedValue(SCHEDULE)
    prismaMock.playerGameStat.findMany.mockImplementation(async ({ where }: { where: Record<string, any> }) =>
      where.gameId ? [{ gameId: 'cfbd:1001' }] : [{ playerId: '5158948', normalizedStatMap: CURTIS }],
    )
  })

  async function run() {
    const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
    return syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 's1', week: 3, actorId: 'system:test' })
  }
  const written = () => new Map(prismaMock.playerWeeklyScore.upsert.mock.calls.map((c) => [c[0].create.playerId, c[0].create]))

  it('a bye, and a final ingested game with no line for him, each score a real 0', async () => {
    const summary = await run()
    expect(written().get('2001')).toMatchObject({ fantasyPts: 0, stats: {} }) // his school played; he recorded nothing
    expect(written().get('2002')).toMatchObject({ fantasyPts: 0, stats: {} }) // bye
    expect(summary.ncaafZeroScored).toEqual([
      { playerId: '2001', reason: 'no_stat' },
      { playerId: '2002', reason: 'bye' },
    ])
  })

  it('an unfinished game, a final game never ingested, and an unplaceable school stay MISSING', async () => {
    const summary = await run()
    for (const id of ['2003', '2004', '2005']) {
      expect(written().has(id)).toBe(false)
      expect(summary.missingCachePlayerIds).toContain(id)
    }
    expect(summary.ncaafMissingByReason).toEqual({ not_ingested: 1, pending: 1, unmatched: 1 })
  })

  it('[control] an unlinked roster id is never zeroed, even when his school played', async () => {
    const summary = await run()
    expect(written().has('77009')).toBe(false)
    expect(summary.missingCachePlayerIds).toContain('77009')
  })

  it('the QB with a line still scores from it', async () => {
    const summary = await run()
    expect(written().get('5158948')?.fantasyPts).toBeCloseTo(277 * 0.04 + 3 * 4 + 2 * -2 + 64 * 0.1 + 1 * -2, 5)
    expect(summary.scoresUpserted).toBe(3)
  })

  it('asks for ingested rows only among this week’s games, under both id spellings', async () => {
    await run()
    const call = prismaMock.playerGameStat.findMany.mock.calls.find((c) => c[0].where.gameId)![0]
    expect(call.where).toMatchObject({ season: 2026, weekOrRound: 3 })
    expect(call.where.gameId.in).toEqual(expect.arrayContaining(['cfbd:1001', 'cfbd:1002', 'cfbd:1003']))
    expect(call.where.gameId.in).not.toContain('cfbd:0901')
  })
})


describe('imported historical reserves are separate from 2026 scoring eligibility', () => {
 beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.adminAuditLog.create.mockResolvedValue({})
  prismaMock.playerWeeklyScore.upsert.mockResolvedValue({})
  prismaMock.playerGameLogCache.findMany.mockResolvedValue([])
  prismaMock.league.findFirst.mockResolvedValue({ sport: 'NCAAF', settings: {} })
  prismaMock.league.findUnique.mockResolvedValue({ sport: 'NCAAF', platform: 'fantrax', settings: {} })
  prismaMock.redraftSeason.findFirst.mockResolvedValue({ id: 's1', leagueId: 'L1', sport: 'NCAAFB', season: 2026, currentWeek: 3 })
  prismaMock.redraftRoster.findMany.mockResolvedValue([{ id: 'r1' }])
  prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([
   { playerId: '05ny7', sport: 'NCAAFB', position: 'QB', team: 'Utah State' },
   { playerId: '05lol', sport: 'NCAAFB', position: 'RB', team: 'Boise State' },
   { playerId: '077wg', sport: 'NCAAFB', position: 'QB', team: 'BYU' },
  ])
  prismaMock.sportsPlayer.findMany.mockResolvedValue([])
  prismaMock.playerIdentityMap.findMany.mockImplementation(async ({ where }: { where: Record<string, any> }) => where.fantraxId ? [
   { id: 'barnes', fantraxId: '05ny7', cfbdId: '4695600', rollingInsightsId: null },
   { id: 'sherrod', fantraxId: '05lol', cfbdId: '4607267', rollingInsightsId: null },
  ] : [])
  // All three old schools appear to have a bye. That cannot prove these players' eligibility.
  prismaMock.sportsGame.findMany.mockResolvedValue([
   { homeTeam: 'Utah State', awayTeam: 'Boise State', week: 2, externalId: 'past', status: 'completed' },
   { homeTeam: 'BYU', awayTeam: 'Utah', week: 2, externalId: 'past2', status: 'completed' },
  ])
  prismaMock.playerGameStat.findMany.mockResolvedValue([])
 })
 const run = async () => (await import('@/lib/redraft/playerWeeklyScoreService')).syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 's1', week: 3, actorId: 'system:test' })
 it('does not manufacture bye zeros for inactive, unverified or prospect records', async () => {
  const r = await run()
  expect(prismaMock.playerWeeklyScore.upsert).not.toHaveBeenCalled()
  expect(r.ncaafMissingByReason).toEqual({ college_inactive: 1, needs_verification: 1, prospect: 1 })
  expect(r.ncaafSeasonAvailability).toHaveLength(3)
  expect(r.unresolvedCfbdPlayerIds).toEqual(['077wg'])
 })
 it('refuses conflicting provider game rows for a verified former college player', async () => {
  prismaMock.playerGameStat.findMany.mockResolvedValue([{ playerId: '4695600', normalizedStatMap: { 'passing.YDS': 200 } }])
  const r = await run()
  expect(prismaMock.playerWeeklyScore.upsert).not.toHaveBeenCalled()
  expect(r.warnings.join(' ')).toContain('season evidence conflicts')
 })
 it('allows actual season game evidence to resolve a player needing verification', async () => {
  prismaMock.playerGameStat.findMany.mockResolvedValue([{ playerId: '4607267', normalizedStatMap: { 'rushing.YDS': 50 } }])
  await run()
  expect(prismaMock.playerWeeklyScore.upsert.mock.calls.map(c => c[0].create.playerId)).toEqual(['05lol'])
 })
 it('does not apply Fantrax exceptions to a native roster namespace', async () => {
  prismaMock.league.findUnique.mockResolvedValue({ sport: 'NCAAF', platform: 'allfantasy', settings: {} })
  expect((await run()).ncaafSeasonAvailability).toBeUndefined()
 })
})
