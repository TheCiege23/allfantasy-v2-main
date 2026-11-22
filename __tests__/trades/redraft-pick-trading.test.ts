import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Draft-pick trading in a REDRAFT league: the current season's draft only.
 *
 * Runs the REAL validator (`validateTradeAssets`) and the REAL settlement
 * (`applyTradeAssetsInTransaction`) against a transaction double, then reads the written
 * `tradedPicks` back through the draft room's own resolver (`resolvePickOwner`,
 * `computeUpcomingOwnedPicks`) — so "the new owner is on the clock" is asserted with the function
 * the draft room uses, not restated.
 */

const h = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  league: null as null | Record<string, unknown>,
  rosters: [] as Array<{ id: string; leagueId: string; playerData: unknown; faabRemaining: number }>,
  sessionWrites: [] as Array<{ where: unknown; data: Record<string, unknown> }>,
  rosterWrites: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
  archive: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/salary-cap/TradeContractSettlement', () => ({ settleTradeContracts: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/league-runtime/redraftRosterMoveSync', () => ({ applyRedraftRosterMoves: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/draft-archive/events', () => ({ recordArchiveEvent: (...a: unknown[]) => h.archive(...a) }))

import { validateTradeAssets } from '@/lib/league-trade-engine/tradeValidationService'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { applyTradeAssetsInTransaction } from '@/lib/league-trade-engine/tradeProcessor'
import {
  FUTURE_PICKS_NOT_ALLOWED_IN_REDRAFT,
  REDRAFT_NO_DRAFT_PICKS,
  REDRAFT_PICK_ALREADY_USED,
  buildRedraftPickBook,
  isRedraftPickLeague,
  redraftPickId,
  type RedraftSessionView,
} from '@/lib/league-trade-engine/redraftDraftPicks'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { computeUpcomingOwnedPicks } from '@/lib/live-draft-engine/draftPickTradeInventory'
import type { TradedPickRecord } from '@/lib/live-draft-engine/types'
import { buildEngineTestLeague, buildEngineTestRoster } from '@/lib/engine-testing/fixtures/enginePayloadBuilders'

const SLOT_ORDER = [
  { slot: 1, rosterId: 'ra', displayName: 'Alpha' },
  { slot: 2, rosterId: 'rb', displayName: 'Beta' },
]

function session(over: Partial<RedraftSessionView> = {}): RedraftSessionView {
  return {
    id: 'ds-2026',
    status: 'pre_draft',
    draftType: 'snake',
    rounds: 3,
    teamCount: 2,
    thirdRoundReversal: false,
    version: 4,
    slotOrder: SLOT_ORDER,
    tradedPicks: [],
    picks: [],
    ...over,
  }
}

const RA_R1 = redraftPickId({ sessionId: 'ds-2026', round: 1, originalRosterId: 'ra' })
const RA_R2 = redraftPickId({ sessionId: 'ds-2026', round: 2, originalRosterId: 'ra' })

function redraftLeague() {
  return buildEngineTestLeague({ leagueType: 'redraft', platform: 'manual', season: 2026 })
}

function rosters(extra: { raPicks?: unknown[] } = {}) {
  return {
    ra: buildEngineTestRoster('ra', 'league-1', 'ua', { players: ['p-ra'], draftPicks: extra.raPicks ?? [] }),
    rb: buildEngineTestRoster('rb', 'league-1', 'ub', { players: ['p-rb'] }),
  }
}

function validate(league: ReturnType<typeof buildEngineTestLeague>, assets: Parameters<typeof validateTradeAssets>[0]['assets'], opts: {
  book?: ReturnType<typeof buildRedraftPickBook> | null
  raPicks?: unknown[]
  native?: Map<string, string>
} = {}) {
  const r = rosters({ raPicks: opts.raPicks })
  return validateTradeAssets({
    league,
    settings: resolveLeagueTradeSettings(league),
    proposer: r.ra,
    receiver: r.rb,
    assets,
    currentWeek: 1,
    redraftDraftPicks: opts.book ?? null,
    nativeFuturePickOwners: opts.native ?? null,
  })
}

/** A transaction double holding one league, two rosters and one draft session. */
function tx() {
  return {
    league: { findUnique: async () => h.league },
    roster: {
      findMany: async () => h.rosters,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        h.rosterWrites.push(args)
        return {}
      },
    },
    draftSession: {
      findFirst: async () => h.session,
      findUnique: async () => h.session,
      updateMany: async (args: { where: { id: string; version: number }; data: Record<string, unknown> }) => {
        const s = h.session as Record<string, unknown>
        if (!s || s.id !== args.where.id || s.version !== args.where.version) return { count: 0 }
        h.sessionWrites.push(args)
        h.session = { ...s, tradedPicks: args.data.tradedPicks, version: (s.version as number) + 1 }
        return { count: 1 }
      },
    },
  }
}

beforeEach(() => {
  h.session = session() as unknown as Record<string, unknown>
  h.league = { id: 'league-1', leagueType: 'redraft', isDynasty: false, platform: 'manual', season: 2026, settings: null }
  h.rosters = [
    { id: 'ra', leagueId: 'league-1', playerData: { players: ['p-ra'] }, faabRemaining: 100 },
    { id: 'rb', leagueId: 'league-1', playerData: { players: ['p-rb'] }, faabRemaining: 100 },
  ]
  h.sessionWrites = []
  h.rosterWrites = []
  h.archive.mockReset().mockResolvedValue(undefined)
})

describe('which leagues are redraft for pick trading', () => {
  it('redraft is; dynasty, devy, c2c, keeper and salary cap are not', () => {
    expect(isRedraftPickLeague({ leagueType: 'redraft' })).toBe(true)
    expect(isRedraftPickLeague({ leagueType: 'best_ball' })).toBe(true)
    for (const t of ['dynasty', 'devy', 'c2c', 'keeper', 'salary_cap', 'c2c_dynasty']) expect(isRedraftPickLeague({ leagueType: t })).toBe(false)
    expect(isRedraftPickLeague({ leagueType: 'redraft', isDynasty: true })).toBe(false)
  })
})

describe('the current draft’s pick book', () => {
  it('lists every unmade pick with its holder, before the draft', () => {
    const book = buildRedraftPickBook(session(), 2026)
    expect(book.closed).toBe(false)
    expect(book.picks).toHaveLength(6)
    expect(book.ownerByPickId.get(RA_R1)).toBe('ra')
  })

  it('drops picks already made, mid-draft', () => {
    const book = buildRedraftPickBook(session({ status: 'in_progress', picks: [{ overall: 1, playerName: 'X', position: 'RB' }] }), 2026)
    expect(book.closed).toBe(false)
    expect(book.usedPickIds.has(RA_R1)).toBe(true)
    expect(book.ownerByPickId.has(RA_R1)).toBe(false)
    expect(book.picks).toHaveLength(5)
  })

  it('has nothing to trade once the draft completes', () => {
    const book = buildRedraftPickBook(session({ status: 'completed' }), 2026)
    expect(book.closed).toBe(true)
    expect(book.picks).toHaveLength(0)
  })
})

describe('validating a redraft offer', () => {
  it('a current-season pick is tradable', () => {
    const v = validate(redraftLeague(), [{ itemType: 'rookie_pick', itemReference: RA_R1, fromRosterId: 'ra', toRosterId: 'rb' }], {
      book: buildRedraftPickBook(session(), 2026),
    })
    expect(v).toMatchObject({ ok: true })
  })

  it('a pick can be mixed with players in one trade', () => {
    const v = validate(redraftLeague(), [
      { itemType: 'rookie_pick', itemReference: RA_R1, fromRosterId: 'ra', toRosterId: 'rb' },
      { itemType: 'player', itemReference: 'p-ra', fromRosterId: 'ra', toRosterId: 'rb' },
      { itemType: 'player', itemReference: 'p-rb', fromRosterId: 'rb', toRosterId: 'ra' },
    ], { book: buildRedraftPickBook(session(), 2026) })
    expect(v).toMatchObject({ ok: true })
  })

  it('a pick the sender does not hold is refused', () => {
    const v = validate(redraftLeague(), [{ itemType: 'rookie_pick', itemReference: RA_R1, fromRosterId: 'rb', toRosterId: 'ra' }], {
      book: buildRedraftPickBook(session(), 2026),
    })
    expect(v).toMatchObject({ ok: false, code: 'PICK_NOT_OWNED' })
  })

  it('a future pick is refused with an explicit code — by type, by season, and from the dynasty inventory', () => {
    const book = buildRedraftPickBook(session(), 2026)
    const byType = validate(redraftLeague(), [{ itemType: 'future_pick', itemReference: 'pick-2027-r1', fromRosterId: 'ra', toRosterId: 'rb' }], {
      book, raPicks: [{ id: 'pick-2027-r1', season: 2027, round: 1 }],
    })
    expect(byType).toMatchObject({ ok: false, code: FUTURE_PICKS_NOT_ALLOWED_IN_REDRAFT })

    const bySeason = validate(redraftLeague(), [{ itemType: 'rookie_pick', itemReference: 'pick-2027-r1', fromRosterId: 'ra', toRosterId: 'rb' }], {
      book, raPicks: [{ id: 'pick-2027-r1', season: 2027, round: 1 }],
    })
    expect(bySeason).toMatchObject({ ok: false, code: FUTURE_PICKS_NOT_ALLOWED_IN_REDRAFT })

    const native = validate(redraftLeague(), [{ itemType: 'rookie_pick', itemReference: 'fdp:2027:1:ra', fromRosterId: 'ra', toRosterId: 'rb' }], {
      book, native: new Map([['fdp:2027:1:ra', 'ra']]),
    })
    expect(native).toMatchObject({ ok: false, code: FUTURE_PICKS_NOT_ALLOWED_IN_REDRAFT })
  })

  it('the same future pick is still allowed in a dynasty league', () => {
    const dynasty = buildEngineTestLeague({ leagueType: 'dynasty', isDynasty: true, platform: 'manual', season: 2026 })
    expect(validate(dynasty, [{ itemType: 'future_pick', itemReference: 'pick-2027-r1', fromRosterId: 'ra', toRosterId: 'rb' }], {
      raPicks: [{ id: 'pick-2027-r1', season: 2027, round: 1 }],
    })).toMatchObject({ ok: true })
    expect(validate(dynasty, [{ itemType: 'rookie_pick', itemReference: 'fdp:2027:1:ra', fromRosterId: 'ra', toRosterId: 'rb' }], {
      native: new Map([['fdp:2027:1:ra', 'ra']]),
    })).toMatchObject({ ok: true })
  })

  it('a pick already made is refused', () => {
    const book = buildRedraftPickBook(session({ status: 'in_progress', picks: [{ overall: 1, playerName: 'X', position: 'RB' }] }), 2026)
    const v = validate(redraftLeague(), [{ itemType: 'rookie_pick', itemReference: RA_R1, fromRosterId: 'ra', toRosterId: 'rb' }], { book })
    expect(v).toMatchObject({ ok: false, code: REDRAFT_PICK_ALREADY_USED })
  })

  it('after the draft completes, an unmade pick id is refused as having nothing to trade', () => {
    const book = buildRedraftPickBook(session({ status: 'completed' }), 2026)
    const v = validate(redraftLeague(), [{ itemType: 'rookie_pick', itemReference: RA_R2, fromRosterId: 'ra', toRosterId: 'rb' }], { book })
    expect(v).toMatchObject({ ok: false, code: REDRAFT_NO_DRAFT_PICKS })
  })

  it('a current-draft pick with no book loaded is refused, never waved through', () => {
    const v = validate(redraftLeague(), [{ itemType: 'rookie_pick', itemReference: RA_R1, fromRosterId: 'ra', toRosterId: 'rb' }], { book: null })
    expect(v.ok).toBe(false)
  })
})

describe('settling a redraft trade', () => {
  const settle = (assets: Parameters<typeof applyTradeAssetsInTransaction>[1]['assets']) =>
    applyTradeAssetsInTransaction(tx() as never, { leagueId: 'league-1', proposerRosterId: 'ra', receiverRosterId: 'rb', assets, tradeId: 't-1' })

  it('a current-season pick trade transfers ownership the draft room reads', async () => {
    await settle([{ itemType: 'rookie_pick', itemReference: RA_R1, fromRosterId: 'ra', toRosterId: 'rb' }])

    expect(h.sessionWrites).toHaveLength(1)
    expect(h.sessionWrites[0]!.where).toEqual({ id: 'ds-2026', version: 4 })
    const traded = (h.session as { tradedPicks: TradedPickRecord[] }).tradedPicks
    expect(traded).toEqual([
      expect.objectContaining({ round: 1, originalRosterId: 'ra', newRosterId: 'rb', newOwnerName: 'Beta', season: '2026' }),
    ])
    // The draft room's own resolver puts Beta on the clock for Alpha's first-round pick.
    expect(resolvePickOwner(1, 1, SLOT_ORDER, traded)?.rosterId).toBe('rb')
    expect(computeUpcomingOwnedPicks({
      totalPicks: 6, pickedOverall: new Set(), teamCount: 2, draftType: 'snake', thirdRoundReversal: false,
      slotOrder: SLOT_ORDER, tradedPicks: traded, ownerRosterId: 'rb',
    }).map((p) => p.overall)).toEqual([1, 2, 3, 6])
    expect(h.archive).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'ownership', expect.objectContaining({ tradeId: 't-1' }), expect.any(Date))
  })

  it('a mixed player + pick trade moves both', async () => {
    await settle([
      { itemType: 'rookie_pick', itemReference: RA_R1, fromRosterId: 'ra', toRosterId: 'rb' },
      { itemType: 'player', itemReference: 'p-rb', fromRosterId: 'rb', toRosterId: 'ra' },
    ])
    const traded = (h.session as { tradedPicks: TradedPickRecord[] }).tradedPicks
    expect(resolvePickOwner(1, 1, SLOT_ORDER, traded)?.rosterId).toBe('rb')
    const raWrite = h.rosterWrites.find((w) => w.where.id === 'ra')!
    expect(JSON.stringify(raWrite.data.playerData)).toContain('p-rb')
  })

  it('a pick made between offer and settlement is refused, and nothing is written', async () => {
    h.session = session({ status: 'in_progress', picks: [{ overall: 1, playerName: 'X', position: 'RB' }] }) as unknown as Record<string, unknown>
    await expect(settle([{ itemType: 'rookie_pick', itemReference: RA_R1, fromRosterId: 'ra', toRosterId: 'rb' }]))
      .rejects.toMatchObject({ code: REDRAFT_PICK_ALREADY_USED })
    expect(h.sessionWrites).toHaveLength(0)
  })

  it('a pick sold in the draft room meanwhile is refused as no longer held', async () => {
    h.session = session({ tradedPicks: [{ round: 1, originalRosterId: 'ra', previousOwnerName: 'Alpha', newRosterId: 'rb', newOwnerName: 'Beta' }] }) as unknown as Record<string, unknown>
    await expect(settle([{ itemType: 'rookie_pick', itemReference: RA_R1, fromRosterId: 'ra', toRosterId: 'rb' }]))
      .rejects.toMatchObject({ code: 'PICK_NOT_OWNED' })
  })

  it('a pending future-pick offer is refused at settlement in a redraft league', async () => {
    h.rosters[0]!.playerData = { players: ['p-ra'], draftPicks: [{ id: 'pick-2027-r1', season: 2027, round: 1 }] }
    await expect(settle([{ itemType: 'rookie_pick', itemReference: 'pick-2027-r1', fromRosterId: 'ra', toRosterId: 'rb' }]))
      .rejects.toMatchObject({ code: FUTURE_PICKS_NOT_ALLOWED_IN_REDRAFT })
  })
})
