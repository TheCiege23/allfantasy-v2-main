import { describe, expect, it } from 'vitest'

import type { EspnImportTransaction } from '@/lib/league-import/adapters/espn/types'
import type { YahooImportTransaction } from '@/lib/league-import/adapters/yahoo/types'
import { buildManagerIdentityIndex, deriveActivityNaturalKey } from '@/lib/decision-os/ingestion/importedActivityNormalizer'
import { InMemoryImportedActivityStore } from '@/lib/decision-os/ingestion/importedActivityStore'
import {
  buildPlatformManagerMapping,
  emitEspnTransactionActivity,
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
    expect(raws[2]!.payload).toMatchObject({ source: 'espn_transaction', bidAmount: 12, adds: { '7777': '1' } })
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

describe('ingestPlatformImportedActivity', () => {
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
