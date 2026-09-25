import { describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A NATIVE DYNASTY LEAGUE COULD NOT TRADE A FUTURE PICK — no native team had a pick to offer
 * (`playerData.draftPicks` holds drafted players), and the next rookie draft ignored pick ownership
 * anyway. These follow one pick the whole way: listed, offered, settled, and on the clock for its new
 * owner in the draft that uses it.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  consumeNativeFuturePicksForDraft,
  isNativeFuturePickLeague,
  loadNativeFuturePicks,
  nativePickHorizonStart,
  parseInventoryPickId,
  resolveRookieDraftRounds,
  transferNativeFuturePick,
} from '@/lib/league-trade-engine/nativeFuturePicks'
import { applyTradeAssetsInTransaction } from '@/lib/league-trade-engine/tradeProcessor'
import { validateTradeAssets } from '@/lib/league-trade-engine/tradeValidationService'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { buildEngineTestLeague, buildEngineTestRoster } from '@/lib/engine-testing/fixtures/enginePayloadBuilders'

type Row = {
  id: string
  leagueId: string
  pickSeason: number
  round: number
  originalRosterId: string
  currentOwnerId: string
  status: string
  traded: boolean
  sourceTradeId: string | null
  usedInDraftSessionId?: string | null
}

/** An in-memory league: three teams, season 2026 played, 2 rookie rounds. */
function fakeDb(opts: {
  platform?: string
  leagueType?: string
  newest?: { season: number; status: string } | null
  openDraft?: boolean
  rows?: Row[]
} = {}) {
  const rows: Row[] = opts.rows ?? []
  const rosters = ['R-a', 'R-b', 'R-c'].map((id) => ({ id, leagueId: 'L1', playerData: { players: [] }, faabRemaining: 100 }))
  const inSeason = (w: { pickSeason?: number | { in: number[] } }, r: Row) =>
    w.pickSeason == null || (typeof w.pickSeason === 'number' ? r.pickSeason === w.pickSeason : w.pickSeason.in.includes(r.pickSeason))
  const db = {
    league: {
      findUnique: vi.fn(async () => ({
        platform: opts.platform ?? 'manual',
        leagueType: opts.leagueType ?? 'dynasty',
        isDynasty: (opts.leagueType ?? 'dynasty') === 'dynasty',
        season: 2026,
      })),
    },
    roster: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] } } }) =>
        where.id ? rosters.filter((r) => where.id!.in.includes(r.id)) : rosters,
      ),
      update: vi.fn(async () => ({})),
    },
    redraftSeason: {
      findFirst: vi.fn(async () => (opts.newest === undefined ? { season: 2026, status: 'complete' } : opts.newest)),
    },
    draftSession: { findFirst: vi.fn(async () => (opts.openDraft ? { id: 'open' } : null)) },
    dynastyLeagueConfig: { findUnique: vi.fn(async () => ({ rookieDraftRounds: 2 })) },
    futureDraftPick: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: string; status?: string; pickSeason?: number | { in: number[] } } }) =>
        rows.filter((r) => r.leagueId === where.leagueId && (!where.status || r.status === where.status) && inSeason(where, r)),
      ),
      upsert: vi.fn(async ({ where, create, update }: { where: { leagueId_pickSeason_round_originalRosterId: Omit<Row, 'id' | 'currentOwnerId' | 'status' | 'traded' | 'sourceTradeId'> }; create: Omit<Row, 'id'>; update: Partial<Row> }) => {
        const k = where.leagueId_pickSeason_round_originalRosterId
        const hit = rows.find(
          (r) => r.leagueId === k.leagueId && r.pickSeason === k.pickSeason && r.round === k.round && r.originalRosterId === k.originalRosterId,
        )
        if (hit) Object.assign(hit, update)
        else rows.push({ id: `row-${rows.length + 1}`, ...create })
        return {}
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: Partial<Row> }) => {
        for (const r of rows) if (where.id.in.includes(r.id)) Object.assign(r, data)
        return { count: where.id.in.length }
      }),
    },
  }
  return { db, rows }
}

const slotOrder = [
  { slot: 1, rosterId: 'R-a', displayName: 'Team A' },
  { slot: 2, rosterId: 'R-b', displayName: 'Team B' },
  { slot: 3, rosterId: 'R-c', displayName: 'Team C' },
]

describe('which leagues, which seasons', () => {
  it('only a native (manual) dynasty-family league', () => {
    expect(isNativeFuturePickLeague({ platform: 'manual', leagueType: 'dynasty' })).toBe(true)
    expect(isNativeFuturePickLeague({ platform: 'manual', isDynasty: true })).toBe(true)
    expect(isNativeFuturePickLeague({ platform: 'sleeper', leagueType: 'dynasty' })).toBe(false)
    expect(isNativeFuturePickLeague({ platform: 'manual', leagueType: 'redraft' })).toBe(false)
  })

  it('the horizon starts after the newest draft', () => {
    // Season played, no draft open: next season's picks are tradeable.
    expect(nativePickHorizonStart({ newestSeason: { season: 2026, status: 'complete' }, hasOpenDraft: false, leagueSeason: 2026 })).toBe(2027)
    // Next season's shell exists but nobody has drafted it: its picks are still open.
    expect(nativePickHorizonStart({ newestSeason: { season: 2027, status: 'setup' }, hasOpenDraft: false, leagueSeason: 2026 })).toBe(2027)
    // Its rookie draft now exists: those picks trade in the draft room, not here.
    expect(nativePickHorizonStart({ newestSeason: { season: 2027, status: 'setup' }, hasOpenDraft: true, leagueSeason: 2026 })).toBe(2028)
    // The startup draft, before any season row: the season after the league's own.
    expect(nativePickHorizonStart({ newestSeason: null, hasOpenDraft: true, leagueSeason: 2026 })).toBe(2027)
  })

  it('pick ids round-trip and nothing else parses', () => {
    expect(parseInventoryPickId('fdp:2027:1:R-a')).toEqual({ season: 2027, round: 1, originalRosterId: 'R-a' })
    expect(parseInventoryPickId('pick-2027-r1')).toBeNull()
    expect(parseInventoryPickId('fdp:2027:0:R-a')).toBeNull()
  })

  it('rookie rounds clamp exactly as the draft does', () => {
    expect(resolveRookieDraftRounds(null)).toBe(4)
    expect(resolveRookieDraftRounds(0)).toBe(1)
    expect(resolveRookieDraftRounds(25)).toBe(10)
  })
})

describe('the inventory', () => {
  it('every team owns its own picks for three drafts, and a stored row moves one', async () => {
    const { db } = fakeDb({
      rows: [
        { id: 'x', leagueId: 'L1', pickSeason: 2027, round: 1, originalRosterId: 'R-a', currentOwnerId: 'R-b', status: 'active', traded: true, sourceTradeId: 't0' },
      ],
    })
    const inv = await loadNativeFuturePicks('L1', db as never)
    expect(inv?.seasons).toEqual([2027, 2028, 2029])
    // 3 teams x 2 rounds x 3 seasons
    expect(inv?.picks).toHaveLength(18)
    expect(inv?.ownerByPickId.get('fdp:2027:1:R-a')).toBe('R-b')
    expect(inv?.ownerByPickId.get('fdp:2027:2:R-a')).toBe('R-a')
  })

  it('an imported league has none here', async () => {
    const { db } = fakeDb({ platform: 'sleeper' })
    expect(await loadNativeFuturePicks('L1', db as never)).toBeNull()
  })
})

describe('offering a pick', () => {
  function validate(fromRosterId: string, owners: ReadonlyMap<string, string> | null) {
    const league = buildEngineTestLeague({ leagueType: 'dynasty' })
    const a = buildEngineTestRoster('R-a', league.id, 'u1', { players: ['p1'] })
    const b = buildEngineTestRoster('R-b', league.id, 'u2', { players: ['p2'] })
    return validateTradeAssets({
      league,
      settings: resolveLeagueTradeSettings(league),
      proposer: fromRosterId === 'R-a' ? a : b,
      receiver: fromRosterId === 'R-a' ? b : a,
      assets: [
        { itemType: 'rookie_pick', itemReference: 'fdp:2027:1:R-a', fromRosterId, toRosterId: fromRosterId === 'R-a' ? 'R-b' : 'R-a', metadata: {} },
      ],
      currentWeek: 1,
      nativeFuturePickOwners: owners,
    })
  }

  it('the team holding it can offer it', () => {
    expect(validate('R-a', new Map([['fdp:2027:1:R-a', 'R-a']])).ok).toBe(true)
  })

  it('a team that does not hold it cannot', () => {
    const v = validate('R-a', new Map([['fdp:2027:1:R-a', 'R-b']]))
    expect(v.ok ? null : v.code).toBe('PICK_NOT_OWNED')
  })

  it('without the inventory it is refused, as before', () => {
    const v = validate('R-a', null)
    expect(v.ok ? null : v.code).toBe('PICK_NOT_OWNED')
  })
})

describe('settling a trade', () => {
  it('moves the pick to the receiving team and records the trade', async () => {
    const { db, rows } = fakeDb()
    await applyTradeAssetsInTransaction(db as never, {
      leagueId: 'L1',
      proposerRosterId: 'R-a',
      receiverRosterId: 'R-b',
      assets: [{ itemType: 'rookie_pick', itemReference: 'fdp:2027:1:R-a', fromRosterId: 'R-a', toRosterId: 'R-b' }],
      tradeId: 'trade-1',
    })
    expect(rows).toEqual([
      expect.objectContaining({ pickSeason: 2027, round: 1, originalRosterId: 'R-a', currentOwnerId: 'R-b', traded: true, status: 'active', sourceTradeId: 'trade-1' }),
    ])
  })

  it('refuses a pick the sender no longer holds', async () => {
    const { db } = fakeDb({
      rows: [
        { id: 'x', leagueId: 'L1', pickSeason: 2027, round: 1, originalRosterId: 'R-a', currentOwnerId: 'R-c', status: 'active', traded: true, sourceTradeId: 't0' },
      ],
    })
    await expect(
      transferNativeFuturePick(db as never, { leagueId: 'L1', ref: 'fdp:2027:1:R-a', fromRosterId: 'R-a', toRosterId: 'R-b' }),
    ).rejects.toThrow('Pick not found on roster')
  })

  it('refuses a pick whose draft already exists (offered before it was created)', async () => {
    const { db } = fakeDb({ newest: { season: 2027, status: 'setup' }, openDraft: true })
    await expect(
      transferNativeFuturePick(db as never, { leagueId: 'L1', ref: 'fdp:2027:1:R-a', fromRosterId: 'R-a', toRosterId: 'R-b' }),
    ).rejects.toThrow('no longer tradeable')
  })

  it('a pick traded back to its original team is no longer marked traded', async () => {
    const { db, rows } = fakeDb({
      rows: [
        { id: 'x', leagueId: 'L1', pickSeason: 2027, round: 1, originalRosterId: 'R-a', currentOwnerId: 'R-b', status: 'active', traded: true, sourceTradeId: 't0' },
      ],
    })
    await transferNativeFuturePick(db as never, { leagueId: 'L1', ref: 'fdp:2027:1:R-a', fromRosterId: 'R-b', toRosterId: 'R-a', tradeId: 't1' })
    expect(rows[0]).toMatchObject({ currentOwnerId: 'R-a', traded: false, sourceTradeId: 't1' })
  })
})

describe('the draft that uses it', () => {
  it('puts the traded pick on the new owner’s clock, and consumes the season’s rows', async () => {
    const { db, rows } = fakeDb()
    await transferNativeFuturePick(db as never, { leagueId: 'L1', ref: 'fdp:2027:1:R-a', fromRosterId: 'R-a', toRosterId: 'R-c', tradeId: 't1' })

    const traded = await consumeNativeFuturePicksForDraft(db as never, {
      leagueId: 'L1',
      season: 2027,
      draftSessionId: 'draft-2027',
      rounds: 2,
      slotOrder,
    })
    expect(traded).toEqual([
      expect.objectContaining({ round: 1, originalRosterId: 'R-a', newRosterId: 'R-c', newOwnerName: 'Team C', season: '2027' }),
    ])
    // Team A's slot in round 1 is now Team C's pick; its round-2 pick is still its own.
    expect(resolvePickOwner(1, 1, slotOrder, traded)?.rosterId).toBe('R-c')
    expect(resolvePickOwner(2, 1, slotOrder, traded)?.rosterId).toBe('R-a')
    expect(rows[0]).toMatchObject({ status: 'used', usedInDraftSessionId: 'draft-2027' })
  })

  it('a round the draft does not have, or a team not in it, is consumed but not applied', async () => {
    const { db, rows } = fakeDb({
      rows: [
        { id: 'x', leagueId: 'L1', pickSeason: 2027, round: 3, originalRosterId: 'R-a', currentOwnerId: 'R-b', status: 'active', traded: true, sourceTradeId: 't0' },
        { id: 'y', leagueId: 'L1', pickSeason: 2027, round: 1, originalRosterId: 'R-gone', currentOwnerId: 'R-b', status: 'active', traded: true, sourceTradeId: 't0' },
      ],
    })
    const traded = await consumeNativeFuturePicksForDraft(db as never, { leagueId: 'L1', season: 2027, draftSessionId: 'd', rounds: 2, slotOrder })
    expect(traded).toEqual([])
    expect(rows.every((r) => r.status === 'used')).toBe(true)
  })
})
