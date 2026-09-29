// @vitest-environment node
/**
 * Draft HQ's four pre-draft sections, each read from a source something writes:
 *
 *   picks     DraftSession.tradedPicks, through the draft room's own resolver
 *   lottery   lib/draft-lottery's read-only preview, only where a lottery is configured
 *   queue     the viewer's DraftQueue row, the one the draft room saves
 *   keepers   DraftSession.keeperSelections, or Sleeper's is_keeper on the imported picks
 *
 * The prisma double answers every model and records every call, so each test states only the
 * reads it is about — and can assert the reads that must NOT happen (a write from a page view,
 * a league-row read for a league the lottery does not apply to).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  calls: [] as Array<{ model: string; method: string; args: unknown }>,
  answers: {} as Record<string, (args: unknown) => unknown>,
}))

vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) =>
    method === 'count' ? 0 : method === 'findMany' || method.startsWith('$query') ? [] : null
  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            db.calls.push({ model, method, args })
            const answer = db.answers[`${model}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === 'then') return undefined
        return modelProxy(key)
      },
    },
  )
  return { prisma, default: prisma }
})

// Graders reach Sleeper for a Sleeper league; neither is under test here.
vi.mock('@/lib/draft-intel/draftReportService', () => ({ getDraftReport: vi.fn(async () => null) }))
vi.mock('@/lib/draft-intel/importedDraftReport', () => ({ buildImportedDraftReport: vi.fn(async () => null) }))

import { computePickInventory, getDraftHqData } from '@/lib/core-app/draftHq'

const L = 'league-1'
const U = 'user-1'

const calls = (model: string, method?: string) =>
  db.calls.filter((c) => c.model === model && (method == null || c.method === method))

beforeEach(() => {
  db.calls = []
  db.answers = {}
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('no network in this test')
  }))
})

const ORDER = [
  { slot: 1, rosterId: 'r1', displayName: 'Dre' },
  { slot: 2, rosterId: 'me', displayName: 'Me' },
  { slot: 3, rosterId: 'r3', displayName: 'Kim' },
]

const inventory = (tradedPicks: Parameters<typeof computePickInventory>[0]['tradedPicks'], thirdRoundReversal = false) =>
  computePickInventory({
    myRosterId: 'me',
    slotOrder: ORDER,
    tradedPicks,
    rounds: 3,
    teamCount: 3,
    draftType: 'snake',
    thirdRoundReversal,
  })

describe('computePickInventory — the draft room’s resolver, applied to your picks', () => {
  it('with no trades, holds the snake slots and nothing is traded away', () => {
    const inv = inventory([])
    expect(inv.held.map((p) => [p.label, p.overall, p.acquiredFrom])).toEqual([
      ['1.02', 2, null],
      ['2.02', 5, null],
      ['3.02', 8, null],
    ])
    expect(inv.tradedAway).toEqual([])
  })

  it('a pick acquired in a trade is held, and says who it came from', () => {
    const inv = inventory([
      { round: 2, originalRosterId: 'r1', previousOwnerName: 'Dre', newRosterId: 'me', newOwnerName: 'Me' },
    ])
    // Dre's round-2 pick is the last of a snake's even round: 2.03.
    expect(inv.held.map((p) => [p.label, p.acquiredFrom])).toEqual([
      ['1.02', null],
      ['2.02', null],
      ['2.03', 'Dre'],
      ['3.02', null],
    ])
  })

  it('a pick traded away leaves your list and is named, with who has it', () => {
    const inv = inventory([
      { round: 3, originalRosterId: 'me', previousOwnerName: 'Me', newRosterId: 'r3', newOwnerName: 'Kim' },
    ])
    expect(inv.held.map((p) => p.label)).toEqual(['1.02', '2.02'])
    expect(inv.tradedAway).toEqual([{ round: 3, overall: 8, label: '3.02', to: 'Kim' }])
  })

  it('a pick traded away and back is yours again, with no "from"', () => {
    const inv = inventory([
      { round: 1, originalRosterId: 'me', previousOwnerName: 'Me', newRosterId: 'r1', newOwnerName: 'Dre' },
      { round: 1, originalRosterId: 'me', previousOwnerName: 'Dre', newRosterId: 'me', newOwnerName: 'Me' },
    ])
    expect(inv.held[0]).toMatchObject({ label: '1.02', acquiredFrom: null })
    expect(inv.tradedAway).toEqual([])
  })

  it('third-round reversal uses the room’s order maths, not a plain snake', () => {
    // Slot 1 of 3 with 3RR: round 3 runs reversed, so its pick is 3.03, not 3.01.
    const inv = computePickInventory({
      myRosterId: 'r1',
      slotOrder: ORDER,
      tradedPicks: [],
      rounds: 3,
      teamCount: 3,
      draftType: 'snake',
      thirdRoundReversal: true,
    })
    expect(inv.held.map((p) => p.label)).toEqual(['1.01', '2.03', '3.03'])
  })
})

/** A league with a live draft session; `extra` overrides the session row. */
function liveDraft(platform: string, extra: Record<string, unknown> = {}) {
  db.answers['league.findUnique'] = () => ({ id: L, name: 'Kings', platform, platformLeagueId: null, settings: {} })
  db.answers['leagueTeam.findFirst'] = () => ({ id: 'lt-me', externalId: 'me' })
  db.answers['draftSession.findFirst'] = () => ({
    id: 's-1',
    status: 'pre_draft',
    draftType: 'snake',
    rounds: 3,
    teamCount: 3,
    thirdRoundReversal: false,
    slotOrder: ORDER,
    tradedPicks: [],
    keeperConfig: null,
    keeperSelections: null,
    sleeperDraftId: null,
    ...extra,
  })
}

describe('getDraftHqData — your picks', () => {
  it('reads DraftSession.tradedPicks: acquired and traded-away picks both show', async () => {
    liveDraft('manual', {
      tradedPicks: [
        { round: 2, originalRosterId: 'r1', previousOwnerName: 'Dre', newRosterId: 'me', newOwnerName: 'Me' },
        { round: 3, originalRosterId: 'me', previousOwnerName: 'Me', newRosterId: 'r3', newOwnerName: 'Kim' },
      ],
    })
    const hq = await getDraftHqData(L, U)
    expect(hq?.pickSlots.available).toBe(true)
    if (!hq?.pickSlots.available) return
    expect(hq.pickSlots.data.held.map((p) => [p.label, p.acquiredFrom])).toEqual([
      ['1.02', null],
      ['2.02', null],
      ['2.03', 'Dre'],
    ])
    expect(hq.pickSlots.data.tradedAway.map((p) => [p.label, p.to])).toEqual([['3.02', 'Kim']])
    // A native league trades here, so there is nothing the list cannot see.
    expect(hq.pickSlots.data.note).toBeNull()
  })

  it('a numeric roster id stored in the JSON still matches', async () => {
    liveDraft('manual', {
      slotOrder: [
        { slot: 1, rosterId: 11, displayName: 'Dre' },
        { slot: 2, rosterId: 'me', displayName: 'Me' },
        { slot: 3, rosterId: 13, displayName: 'Kim' },
      ],
      tradedPicks: [{ round: 1, originalRosterId: 11, previousOwnerName: 'Dre', newRosterId: 'me', newOwnerName: 'Me' }],
    })
    const hq = await getDraftHqData(L, U)
    if (!hq?.pickSlots.available) throw new Error('expected picks')
    expect(hq.pickSlots.data.held.map((p) => [p.label, p.acquiredFrom])).toContainEqual(['1.01', 'Dre'])
  })

  it('🛑 a provider-hosted league says its provider’s pick trades are not reflected', async () => {
    liveDraft('sleeper')
    const hq = await getDraftHqData(L, U)
    if (!hq?.pickSlots.available) throw new Error('expected picks')
    expect(hq.pickSlots.data.note).toContain('pick trades made on Sleeper are not synced into this draft')
  })
})

describe('getDraftHqData — prepared queue', () => {
  it('lists the viewer’s DraftQueue, deduped and without drafted players', async () => {
    liveDraft('manual')
    db.answers['draftQueue.findUnique'] = () => ({
      order: [
        { playerName: 'Bijan Robinson', position: 'RB', team: 'ATL' },
        { playerName: 'Bijan Robinson', position: 'RB', team: 'ATL' },
        { playerName: 'Puka Nacua', position: 'WR', team: 'LAR' },
        { playerName: 'Sam LaPorta', position: 'TE', team: 'DET' },
        { playerName: '   ' },
      ],
    })
    db.answers['draftPick.findMany'] = (args) =>
      (args as { select?: { playerName?: boolean; overall?: boolean } }).select?.overall
        ? [] // the viewer's own made picks
        : [{ playerName: 'Puka Nacua' }]
    const hq = await getDraftHqData(L, U)
    expect(hq?.queue).toEqual({
      available: true,
      data: {
        total: 2,
        players: [
          { rank: 1, playerName: 'Bijan Robinson', position: 'RB', team: 'ATL' },
          { rank: 2, playerName: 'Sam LaPorta', position: 'TE', team: 'DET' },
        ],
      },
    })
    const queueRead = calls('draftQueue', 'findUnique')[0]?.args as { where: unknown }
    expect(queueRead.where).toEqual({ sessionId_userId: { sessionId: 's-1', userId: U } })
    // 🛑 A page view never writes the queue back, unlike loadDraftQueueForUser.
    expect(calls('draftQueue').map((c) => c.method)).toEqual(['findUnique'])
  })

  it('says so when nothing is queued', async () => {
    liveDraft('manual')
    const hq = await getDraftHqData(L, U)
    expect(hq?.queue).toEqual({ available: false, reason: 'you have not queued any players for this draft yet' })
  })

  it('says so when every queued player has gone', async () => {
    liveDraft('manual')
    db.answers['draftQueue.findUnique'] = () => ({ order: [{ playerName: 'Puka Nacua', position: 'WR' }] })
    db.answers['draftPick.findMany'] = (args) =>
      (args as { select?: { overall?: boolean } }).select?.overall ? [] : [{ playerName: 'puka nacua' }]
    const hq = await getDraftHqData(L, U)
    expect(hq?.queue).toEqual({ available: false, reason: 'every player you queued has already been drafted' })
  })
})

describe('getDraftHqData — keepers', () => {
  it('lists your DraftSession.keeperSelections, and nobody else’s', async () => {
    liveDraft('manual', {
      keeperConfig: { maxKeepers: 2 },
      keeperSelections: [
        { rosterId: 'me', roundCost: 5, playerName: 'Jahmyr Gibbs', position: 'RB', team: 'DET', playerId: null },
        { rosterId: 'r1', roundCost: 1, playerName: 'Somebody Else', position: 'WR', team: null, playerId: null },
        { rosterId: 'me', roundCost: 2, playerName: 'Ja’Marr Chase', position: 'WR', team: 'CIN', playerId: null },
      ],
    })
    const hq = await getDraftHqData(L, U)
    expect(hq?.keepers).toEqual({
      available: true,
      data: {
        source: 'draft',
        season: null,
        maxKeepers: 2,
        players: [
          { playerName: 'Ja’Marr Chase', position: 'WR', team: 'CIN', round: 2 },
          { playerName: 'Jahmyr Gibbs', position: 'RB', team: 'DET', round: 5 },
        ],
      },
    })
  })

  it('no keeper setup on the draft is said plainly', async () => {
    liveDraft('manual')
    const hq = await getDraftHqData(L, U)
    expect(hq?.keepers).toEqual({ available: false, reason: 'this draft has no keepers set up' })
  })

  it('a Sleeper-mirrored draft does not claim "no keepers" — they live on Sleeper', async () => {
    liveDraft('sleeper', { sleeperDraftId: 'sd-1' })
    const hq = await getDraftHqData(L, U)
    expect(hq?.keepers.available).toBe(false)
    expect(hq?.keepers.available === false && hq.keepers.reason).toContain('set on Sleeper')
  })

  it('declared keepers, none of them yours', async () => {
    liveDraft('manual', {
      keeperConfig: { maxKeepers: 1 },
      keeperSelections: [{ rosterId: 'r1', roundCost: 1, playerName: 'X', position: 'WR', team: null, playerId: null }],
    })
    const hq = await getDraftHqData(L, U)
    expect(hq?.keepers).toEqual({ available: false, reason: 'you have not declared any keepers for this draft' })
  })

  it('with no session, a Sleeper import shows the picks Sleeper flagged as keepers', async () => {
    db.answers['league.findUnique'] = () => ({ id: L, name: 'Kings', platform: 'sleeper', platformLeagueId: null, settings: {} })
    db.answers['leagueTeam.findFirst'] = () => ({ id: 'lt-me', externalId: 'me' })
    db.answers['draftFact.findMany'] = () => [
      { season: 2026, round: 3, pickNumber: 27, playerId: '4866', managerId: 'me', metadata: { isKeeper: true } },
      { season: 2026, round: 4, pickNumber: 40, playerId: '9509', managerId: 'me', metadata: { ownerSleeperId: 'x' } },
      { season: 2025, round: 2, pickNumber: 15, playerId: '1111', managerId: 'me', metadata: { isKeeper: true } },
    ]
    db.answers['sportsPlayer.findMany'] = () => [
      { sleeperId: '4866', name: 'Saquon Barkley', position: 'RB', team: 'PHI', sport: 'NFL', imageUrl: null },
    ]
    const hq = await getDraftHqData(L, U)
    expect(hq?.keepers).toEqual({
      available: true,
      data: {
        source: 'imported',
        season: 2026,
        maxKeepers: null,
        players: [{ playerName: 'Saquon Barkley', position: 'RB', team: 'PHI', round: 3 }],
      },
    })
  })

  it('with no session, a Sleeper import with no flags says exactly that', async () => {
    db.answers['league.findUnique'] = () => ({ id: L, name: 'Kings', platform: 'sleeper', platformLeagueId: null, settings: {} })
    db.answers['leagueTeam.findFirst'] = () => ({ id: 'lt-me', externalId: 'me' })
    db.answers['draftFact.findMany'] = () => [
      { season: 2026, round: 3, pickNumber: 27, playerId: '4866', managerId: 'me', metadata: null },
    ]
    const hq = await getDraftHqData(L, U)
    expect(hq?.keepers).toEqual({
      available: false,
      reason: 'Sleeper flagged none of your 2026 draft picks as keepers',
    })
  })

  it('🛑 with no session, a non-Sleeper import does not read an absence of flags as "no keepers"', async () => {
    db.answers['league.findUnique'] = () => ({ id: L, name: 'Kings', platform: 'espn', platformLeagueId: null, settings: {} })
    db.answers['leagueTeam.findFirst'] = () => ({ id: 'lt-me', externalId: 'me' })
    const hq = await getDraftHqData(L, U)
    expect(hq?.keepers).toEqual({
      available: false,
      reason: 'keepers are only imported from Sleeper drafts, so none can be shown for this league',
    })
  })
})

/** A dynasty league set to draft by weighted lottery, past its startup season. */
function lotteryLeague(overrides: { season?: number; settings?: Record<string, unknown>; isDynasty?: boolean } = {}) {
  const settings = {
    draft_order_mode: 'weighted_lottery',
    draft_lottery_config: {
      enabled: true,
      lotteryTeamCount: 2,
      lotteryPickCount: 2,
      eligibilityMode: 'non_playoff',
      weightingMode: 'inverse_points_for',
      tiebreakMode: 'lower_points_for',
      fallbackOrder: 'reverse_standings',
    },
    playoff_team_count: 2,
    startup_season: 2024,
    ...overrides.settings,
  }
  // One answer serves the context row, the eligibility guard and the standings read.
  db.answers['league.findUnique'] = () => ({
    id: L,
    name: 'Kings',
    platform: 'manual',
    platformLeagueId: null,
    isDynasty: overrides.isDynasty ?? true,
    leagueVariant: null,
    season: overrides.season ?? 2026,
    createdAt: new Date('2024-02-01T00:00:00Z'),
    settings,
    leagueSize: 4,
    _count: { redraftDrafts: 1 },
    rosters: [
      { id: 'r1', platformUserId: 'u1' },
      { id: 'r2', platformUserId: 'u2' },
      { id: 'me', platformUserId: U },
      { id: 'r4', platformUserId: 'u4' },
    ],
    teams: [
      { id: 't1', externalId: 'r1', ownerName: 'A', teamName: 'Alpha', wins: 10, losses: 3, ties: 0, pointsFor: 1500, currentRank: 1 },
      { id: 't2', externalId: 'r2', ownerName: 'B', teamName: 'Bravo', wins: 9, losses: 4, ties: 0, pointsFor: 1400, currentRank: 2 },
      { id: 't3', externalId: 'me', ownerName: 'C', teamName: 'Mine', wins: 5, losses: 8, ties: 0, pointsFor: 900, currentRank: 3 },
      { id: 't4', externalId: 'r4', ownerName: 'D', teamName: 'Delta', wins: 2, losses: 10, ties: 1, pointsFor: 800, currentRank: 4 },
    ],
  })
  db.answers['leagueTeam.findFirst'] = () => ({ id: 't3', externalId: 'me' })
  db.answers['roster.findFirst'] = () => ({ id: 'me' })
}

describe('getDraftHqData — weighted lottery', () => {
  it('a configured, established dynasty league shows the preview odds, you marked', async () => {
    lotteryLeague()
    const hq = await getDraftHqData(L, U)
    expect(hq?.lottery.available).toBe(true)
    if (!hq?.lottery.available) return
    const { teams, ...rest } = hq.lottery.data
    expect(rest).toEqual({
      pickCount: 2,
      playoffTeamCount: 2,
      fallbackOrder: 'reverse order of finish',
      alreadyRunAt: null,
    })
    // Weights 1000 - PF: Mine 100, Delta 200.
    expect(teams.map((t) => [t.name, t.record, Number(t.oddsPercent.toFixed(1)), t.isYou])).toEqual([
      ['Mine', '5-8', 33.3, true],
      ['Delta', '2-10-1', 66.7, false],
    ])
  })

  it('🛑 a league that is not dynasty is refused from the row it already has — no extra read', async () => {
    lotteryLeague({ isDynasty: false })
    const hq = await getDraftHqData(L, U)
    expect(hq?.lottery).toEqual({
      available: false,
      reason: 'a weighted draft lottery only applies to dynasty leagues, and this one is not',
    })
    expect(calls('league', 'findUnique')).toHaveLength(1)
  })

  it('a dynasty league whose order is not set by lottery says so', async () => {
    lotteryLeague({ settings: { draft_order_mode: 'randomize' } })
    const hq = await getDraftHqData(L, U)
    expect(hq?.lottery).toEqual({
      available: false,
      reason: 'this league’s draft order is not set by a weighted lottery',
    })
    expect(calls('league', 'findUnique')).toHaveLength(1)
  })

  it('a startup-year dynasty league is refused by the dynasty-year guard', async () => {
    lotteryLeague({ season: 2024 })
    const hq = await getDraftHqData(L, U)
    expect(hq?.lottery).toEqual({
      available: false,
      reason: 'a weighted lottery starts in a dynasty league’s second season, and this league is in its first',
    })
  })
})
