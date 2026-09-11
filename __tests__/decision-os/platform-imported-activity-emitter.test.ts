import { describe, expect, it } from 'vitest'

import type { EspnImportTransaction } from '@/lib/league-import/adapters/espn/types'
import type { MflImportTransaction } from '@/lib/league-import/adapters/mfl/types'
import type { YahooImportTransaction } from '@/lib/league-import/adapters/yahoo/types'
import { buildManagerIdentityIndex, deriveActivityNaturalKey } from '@/lib/decision-os/ingestion/importedActivityNormalizer'
import { InMemoryImportedActivityStore } from '@/lib/decision-os/ingestion/importedActivityStore'
import {
  buildPlatformManagerMapping,
  emitEspnTransactionActivity,
  emitMflTransactionActivity,
  emitYahooTransactionActivity,
  ingestPlatformImportedActivity,
} from '@/lib/decision-os/ingestion/platformActivityEmitter'

/*
 * ESPN and Yahoo transactions into the activity table the trade windows read.
 * Fixtures are the importers' own parsed shapes (EspnImportTransaction,
 * YahooImportTransaction) — the same objects the league sync already holds.
 */

const SWID_A = '{A7F6CA78-6870-408B-ACE5-D385D8C999F3}'
const SWID_B = '{EFF0FBBA-2748-4CCD-B0FB-BA2748DCCD56}'
const espnOwners = new Map<string, string | null>([
  ['1', SWID_A],
  ['2', SWID_B],
  ['3', null], // a team with no known owner: attributes to nobody, never invented
])

const espnTx = (over: Partial<EspnImportTransaction> & Pick<EspnImportTransaction, 'transactionId' | 'type'>): EspnImportTransaction => ({
  typeDescription: null,
  status: 'processed',
  createdAt: '2026-10-25T15:40:00.000Z',
  teamIds: ['1'],
  adds: {},
  drops: {},
  ...over,
})

describe('emitEspnTransactionActivity', () => {
  it('maps the feed’s four kinds — free agent and drop are roster moves, waiver and trade keep their names — and binds each team to its owner', () => {
    const { raws, skipped } = emitEspnTransactionActivity(
      [
        espnTx({ transactionId: 't1', type: 'free_agent', adds: { '4046': '1' }, messageTypeId: 178 }),
        espnTx({ transactionId: 't2', type: 'drop', drops: { '5892': '2' }, teamIds: ['2'], messageTypeId: 179 }),
        espnTx({ transactionId: 't3', type: 'waiver', adds: { '7777': '1' }, bidAmount: 12, messageTypeId: 180 }),
        espnTx({ transactionId: 't4', type: 'trade', teamIds: ['1', '2'], messageTypeId: 244 }),
      ],
      { leagueId: '919055222', afLeagueId: 'L-elites', teamOwnerMap: espnOwners },
    )
    expect(skipped).toEqual([])
    expect(raws.map((r) => [r.providerEventId, r.activityType, r.managerSourceIds])).toEqual([
      ['t1', 'roster_move', [SWID_A]],
      ['t2', 'roster_move', [SWID_B]],
      ['t3', 'waiver', [SWID_A]],
      ['t4', 'trade', [SWID_A, SWID_B]],
    ])
    expect(raws[0]).toMatchObject({ provider: 'espn', leagueId: '919055222', afLeagueId: 'L-elites', occurredAt: '2026-10-25T15:40:00.000Z' })
    expect(raws[2]!.payload).toMatchObject({ source: 'espn_transaction', idSpace: 'espn', bidAmount: 12, adds: { '7777': '1' } })
  })

  it('skips what did not happen or cannot be named — a pending trade, an unknown kind — and attributes an ownerless team to nobody', () => {
    const { raws, skipped } = emitEspnTransactionActivity(
      [
        espnTx({ transactionId: 'p1', type: 'trade', status: 'pending', teamIds: ['1', '2'] }),
        espnTx({ transactionId: 'u1', type: 'commish' }),
        espnTx({ transactionId: 'o1', type: 'free_agent', teamIds: ['3'] }),
      ],
      { leagueId: '919055222', teamOwnerMap: espnOwners },
    )
    expect(skipped).toEqual([
      { providerEventId: 'p1', reason: 'TRANSACTION_NOT_COMPLETE' },
      { providerEventId: 'u1', reason: 'UNSUPPORTED_TRANSACTION_TYPE' },
    ])
    expect(raws).toHaveLength(1)
    expect(raws[0]!.managerSourceIds).toEqual([])
  })
})

const GUID_A = 'YAHOOGUIDAAAAAAA'
const yahooOwners = new Map<string, string | null>([
  ['461.l.1361311.t.10', GUID_A],
  ['461.l.1361311.t.3', 'YAHOOGUIDBBBBBBB'],
])
const yahooTx = (over: Partial<YahooImportTransaction> & Pick<YahooImportTransaction, 'transactionId' | 'type'>): YahooImportTransaction => ({
  status: 'successful',
  createdAt: '2026-10-25T15:40:00.000Z',
  teamKeys: ['461.l.1361311.t.10'],
  adds: {},
  drops: {},
  ...over,
})

describe('emitYahooTransactionActivity', () => {
  it('reads add, drop and add/drop as roster moves and a trade as a trade, keyed on the league key, bound through team keys', () => {
    const { raws, skipped } = emitYahooTransactionActivity(
      [
        yahooTx({ transactionId: '461.l.1361311.tr.55', type: 'add/drop', adds: { '461.p.100': '461.l.1361311.t.10' }, drops: { '461.p.200': '461.l.1361311.t.10' } }),
        yahooTx({ transactionId: '461.l.1361311.tr.56', type: 'add' }),
        yahooTx({ transactionId: '461.l.1361311.tr.57', type: 'drop' }),
        yahooTx({ transactionId: '461.l.1361311.tr.58', type: 'trade', teamKeys: ['461.l.1361311.t.10', '461.l.1361311.t.3'] }),
      ],
      { leagueId: '461.l.1361311', afLeagueId: 'L-warriors', teamOwnerMap: yahooOwners },
    )
    expect(skipped).toEqual([])
    expect(raws.map((r) => [r.activityType, r.managerSourceIds])).toEqual([
      ['roster_move', [GUID_A]],
      ['roster_move', [GUID_A]],
      ['roster_move', [GUID_A]],
      ['trade', [GUID_A, 'YAHOOGUIDBBBBBBB']],
    ])
    expect(raws[0]).toMatchObject({ provider: 'yahoo', leagueId: '461.l.1361311', afLeagueId: 'L-warriors' })
    // The feed keys its Sleeper-id lookup off this stamp; a Yahoo player key must never reach it.
    expect(raws[0]!.payload).toMatchObject({ source: 'yahoo_transaction', idSpace: 'yahoo' })
  })

  it('skips a commissioner action and a transaction Yahoo did not complete', () => {
    const { raws, skipped } = emitYahooTransactionActivity(
      [yahooTx({ transactionId: 'c1', type: 'commish' }), yahooTx({ transactionId: 'x1', type: 'trade', status: 'pending' })],
      { leagueId: '461.l.1361311', teamOwnerMap: yahooOwners },
    )
    expect(raws).toEqual([])
    expect(skipped.map((s) => s.reason)).toEqual(['UNSUPPORTED_TRANSACTION_TYPE', 'TRANSACTION_NOT_COMPLETE'])
  })
})

/*
 * MFL, added 2026-09-11. Franchise ids are MFL's own zero-padded form — '0001', not '1' — in
 * every fixture below, deliberately: MFL is the platform whose ids look like numbers and are
 * not, so a fixture using '1' would agree with a coercion bug rather than catch one.
 */
const MFL_OWNER_A = 'mflowner77'
const mflOwners = new Map<string, string | null>([
  ['0001', MFL_OWNER_A],
  ['0002', 'mflowner88'],
  ['0003', null], // a franchise with no known owner: attributes to nobody
])
const mflTx = (over: Partial<MflImportTransaction> & Pick<MflImportTransaction, 'transactionId' | 'type'>): MflImportTransaction => ({
  status: 'completed',
  createdAt: '2026-10-25T15:40:00.000Z',
  franchiseIds: ['0001'],
  adds: {},
  drops: {},
  ...over,
})

describe('emitMflTransactionActivity', () => {
  it('reads free agent as a roster move, both waiver spellings as waivers, and a trade as a trade', () => {
    const { raws, skipped } = emitMflTransactionActivity(
      [
        mflTx({ transactionId: 'm1', type: 'free_agent', adds: { '13145': '0001' } }),
        mflTx({ transactionId: 'm2', type: 'waiver', adds: { '13146': '0001' } }),
        // MFL's blind-bid waiver: a second spelling for the same thing; both must land as `waiver`.
        mflTx({ transactionId: 'm3', type: 'bbid_waiver', adds: { '13147': '0001' } }),
        mflTx({ transactionId: 'm4', type: 'trade', franchiseIds: ['0001', '0002'] }),
      ],
      { leagueId: '65432', afLeagueId: 'L-mfl', teamOwnerMap: mflOwners },
    )
    expect(skipped).toEqual([])
    expect(raws.map((r) => [r.providerEventId, r.activityType, r.managerSourceIds])).toEqual([
      ['m1', 'roster_move', [MFL_OWNER_A]],
      ['m2', 'waiver', [MFL_OWNER_A]],
      ['m3', 'waiver', [MFL_OWNER_A]],
      ['m4', 'trade', [MFL_OWNER_A, 'mflowner88']],
    ])
    expect(raws[0]).toMatchObject({ provider: 'mfl', leagueId: '65432', afLeagueId: 'L-mfl', occurredAt: '2026-10-25T15:40:00.000Z' })
    // MFL player ids are MFL's own; a consumer must not resolve them against the Sleeper map.
    expect(raws[0]!.payload).toMatchObject({ source: 'mfl_transaction', idSpace: 'mfl', adds: { '13145': '0001' } })
  })

  it('REGRESSION: a zero-padded franchise id binds to its owner instead of being coerced to a number', () => {
    /*
     * `Number('0001')` is 1 — a perfectly valid franchise id, just not this one. That exact
     * coercion silently emptied MFL trades on the import path (see `lib/dynasty-import/types.ts`),
     * so the binding is asserted here rather than assumed correct because a map lookup happens
     * to be keyed on a string today.
     */
    const { raws } = emitMflTransactionActivity(
      [mflTx({ transactionId: 'm5', type: 'trade', franchiseIds: ['0001', '0002'] })],
      { leagueId: '65432', teamOwnerMap: mflOwners },
    )
    expect(raws[0]!.managerSourceIds).toEqual([MFL_OWNER_A, 'mflowner88'])
    expect(raws[0]!.payload).toMatchObject({ franchiseIds: ['0001', '0002'] })
  })

  it('leaves IR and taxi out, skips what MFL did not complete, and attributes an ownerless franchise to nobody', () => {
    /*
     * IR and taxi are roster DESIGNATIONS, not changes in who holds a player. Counting them
     * would inflate MFL managers' activity against every other platform, so they are skipped as
     * unsupported rather than mapped to `roster_move`.
     */
    const { raws, skipped } = emitMflTransactionActivity(
      [
        mflTx({ transactionId: 'i1', type: 'ir' }),
        mflTx({ transactionId: 'i2', type: 'taxi' }),
        mflTx({ transactionId: 'x1', type: 'trade', status: 'pending' }),
        mflTx({ transactionId: 'o1', type: 'free_agent', franchiseIds: ['0003'] }),
      ],
      { leagueId: '65432', teamOwnerMap: mflOwners },
    )
    expect(skipped.map((s) => s.reason)).toEqual([
      'UNSUPPORTED_TRANSACTION_TYPE',
      'UNSUPPORTED_TRANSACTION_TYPE',
      'TRANSACTION_NOT_COMPLETE',
    ])
    // The ownerless franchise still emits an event — it simply names no manager.
    expect(raws.map((r) => [r.providerEventId, r.managerSourceIds])).toEqual([['o1', []]])
  })
})

describe('ingestPlatformImportedActivity', () => {
  it('routes an MFL league to the MFL emitter, not to the provider that used to be the fall-through', async () => {
    /*
     * 🛑 THE ROUTING IS THE ASSERTION, AND IT IS WHY THIS CASE EXISTS SEPARATELY FROM THE
     * EMITTER TESTS ABOVE. `ingestPlatformImportedActivity` dispatched with a nested ternary
     * whose last branch was reached by elimination, so a third provider added without its own
     * branch would have been handed to the Yahoo emitter — which reads `teamKeys` where MFL has
     * `franchiseIds`. Every MFL event would have been written attributed to NOBODY, with no
     * throw, no skip and a healthy-looking `created` count.
     *
     * So this asserts the manager actually resolved. An assertion that only counted rows would
     * have passed against that bug.
     */
    const store = new InMemoryImportedActivityStore()
    const index = buildManagerIdentityIndex([
      buildPlatformManagerMapping('mfl', MFL_OWNER_A, 'af-guap'),
      buildPlatformManagerMapping('mfl', 'mflowner88', null),
    ])
    const input = {
      provider: 'mfl' as const,
      providerLeagueId: '65432',
      afLeagueId: 'L-mfl',
      teamOwnerMap: mflOwners,
      transactions: [
        mflTx({ transactionId: 'm4', type: 'trade', franchiseIds: ['0001', '0002'] }),
        mflTx({ transactionId: 'm9', type: 'waiver', createdAt: null }), // MFL gave no date: never invented
      ],
    }

    const first = await ingestPlatformImportedActivity(input, index, store)
    expect(first.writer).toMatchObject({ total: 1, created: 1, updated: 0 })
    expect(first.normalizerSkipped.map((s) => s.reason)).toEqual(['MISSING_OCCURRED_AT'])

    const row = await store.getByNaturalKey(deriveActivityNaturalKey('mfl', '65432', 'trade', 'm4'))
    expect(row).not.toBeNull()
    expect(row!.managerKeys).toEqual(['af-guap', 'mfl:mflowner88'])

    // An MFL league and a Sleeper league sharing a numeric id cannot collide: the provider is in the key.
    expect(deriveActivityNaturalKey('mfl', '65432', 'trade', 'm4')).not.toBe(
      deriveActivityNaturalKey('sleeper', '65432', 'trade', 'm4'),
    )

    // Re-ingesting the same feed converges.
    const second = await ingestPlatformImportedActivity(input, index, store)
    expect(second.writer).toMatchObject({ created: 0 })
    expect(await store.count()).toBe(1)
  })

  it('writes idempotent rows keyed on the provider and its league id, attributes a claimed team to its AllFantasy user and an unclaimed one to its provider key, and skips a dateless transaction honestly', async () => {
    const store = new InMemoryImportedActivityStore()
    const index = buildManagerIdentityIndex([
      buildPlatformManagerMapping('espn', SWID_A, 'af-guap'),
      buildPlatformManagerMapping('espn', SWID_B, null),
    ])
    const input = {
      provider: 'espn' as const,
      providerLeagueId: '919055222',
      afLeagueId: 'L-elites',
      teamOwnerMap: espnOwners,
      transactions: [
        espnTx({ transactionId: 't4', type: 'trade', teamIds: ['1', '2'] }),
        espnTx({ transactionId: 't9', type: 'waiver', createdAt: null }), // the feed had no date: never invented
      ],
    }
    const first = await ingestPlatformImportedActivity(input, index, store)
    expect(first.writer).toMatchObject({ total: 1, created: 1, updated: 0 })
    expect(first.normalizerSkipped.map((s) => s.reason)).toEqual(['MISSING_OCCURRED_AT'])
    const key = deriveActivityNaturalKey('espn', '919055222', 'trade', 't4')
    const row = await store.getByNaturalKey(key)
    expect(row).not.toBeNull()
    expect(row!.managerKeys).toEqual(['af-guap', `espn:${SWID_B}`])
    // A Sleeper league with the same numeric id and event id can never collide: the provider is in the key.
    expect(key).not.toBe(deriveActivityNaturalKey('sleeper', '919055222', 'trade', 't4'))
    // Re-ingesting the same feed converges: nothing new is created.
    const second = await ingestPlatformImportedActivity(input, index, store)
    expect(second.writer).toMatchObject({ created: 0 })
    expect(await store.count()).toBe(1)
  })
})
