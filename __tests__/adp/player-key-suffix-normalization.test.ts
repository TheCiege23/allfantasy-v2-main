/**
 * 🛑 `buildPlayerKey` was trim + lowercase, so the snapshot's `james cook iii|rb` never met the
 * roster's "James Cook". The free-agent pools exclude rostered players by that key, so rostered
 * James Cook III / Marvin Harrison Jr. / Kenneth Walker III were offered as top free agents in every
 * war room (production 2026-10-12: ADP 5, 7 and 11 on the 2026 NFL redraft board).
 *
 * The rows below are shaped like the production rows: suffixed keys, a dotted/undotted twin, and a
 * 1-sample stray beside the real key. Stored keys are deliberately the OLD spelling — the readers
 * must work before any recompute rewrites them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { allFantasyAdpSnapshot: { findMany: (...a: unknown[]) => findMany(...a) } } }))

import {
  aggregateAdp,
  buildPlayerKey,
  collapseStoredAdpRows,
  normalizeStoredPlayerKey,
  type AggregatablePick,
} from '@/lib/adp/computeAllFantasyAdp'
import {
  fetchAdpByPlayerKey,
  fetchRedraftFreeAgentPool,
  rosteredPlayerKeys,
} from '@/lib/redraft-war-room/redraftFreeAgentPool'
import { dynastyRosteredKeys, fetchDynastyFreeAgentPool } from '@/lib/dynasty-war-room/dynastyFreeAgentPool'
import { loadAdpBoard } from '@/lib/adp/loadAdpBoard'

const CTX = 'ctx-redraft-12'
const row = (playerKey: string, adp: number, sampleSize: number, extra: Record<string, unknown> = {}) => ({
  playerKey,
  playerName: playerKey.split('|')[0],
  scoringFormat: 'ppr',
  averageOverallPick: adp,
  sampleSize,
  contextHash: CTX,
  draftMode: 'real',
  ...extra,
})

// ADP-ascending, as the readers query them.
const STORED = [
  row('bijan robinson|rb', 1, 40),
  row('james cook iii|rb', 5, 8),
  row('marvin harrison jr.|wr', 7, 6),
  row('aaron jones sr.|rb', 8, 2),
  row('aaron jones sr|rb', 8, 2),
  row('kenneth walker iii|rb', 11, 8),
  row('kenneth walker|rb', 27, 1),
  row('puka nacua|wr', 30, 12),
]

// Roster `playerData` carries Sleeper's spelling.
const ROSTER = [
  { playerName: 'James Cook', position: 'RB' },
  { playerName: 'Marvin Harrison Jr.', position: 'WR' },
  { playerName: 'Kenneth Walker', position: 'RB' },
  { playerName: 'Aaron Jones', position: 'RB' },
]

beforeEach(() => {
  findMany.mockReset()
  findMany.mockResolvedValue(STORED)
})

describe('buildPlayerKey is suffix- and punctuation-insensitive', () => {
  it('meets every stored spelling of the same player', () => {
    expect(buildPlayerKey('Kenneth Walker', 'RB')).toBe(buildPlayerKey('Kenneth Walker III', 'RB'))
    expect(normalizeStoredPlayerKey('marvin harrison jr.|wr')).toBe(buildPlayerKey('Marvin Harrison', 'WR'))
    expect(normalizeStoredPlayerKey('aaron jones sr.|rb')).toBe(normalizeStoredPlayerKey('aaron jones sr|rb'))
    expect(normalizeStoredPlayerKey('amon-ra st. brown|wr')).toBe(buildPlayerKey('Amon-Ra St. Brown', 'WR'))
  })

  it('is idempotent on an already-normalized key', () => {
    const k = buildPlayerKey('James Cook III', 'RB')
    expect(normalizeStoredPlayerKey(k)).toBe(k)
  })

  it('the writer aggregates both spellings into one snapshot', () => {
    const context = {
      sport: 'NFL', leagueType: 'redraft', draftType: 'snake', scoringFormat: 'ppr',
      rosterFormat: 'standard', teamCount: 12, season: '2026',
    }
    const picks: AggregatablePick[] = [
      { playerName: 'Kenneth Walker III', position: 'RB', overall: 10, round: 1, context, draftMode: 'real' },
      { playerName: 'Kenneth Walker', position: 'RB', overall: 14, round: 2, context, draftMode: 'real' },
    ]
    const out = aggregateAdp(picks)
    expect(out).toHaveLength(1)
    expect(out[0]!.sampleSize).toBe(2)
    expect(out[0]!.playerKey).toBe('kenneth walker|rb')
  })
})

describe('collapseStoredAdpRows picks one variant deterministically', () => {
  it('more samples wins, whatever the row order', () => {
    const a = row('kenneth walker iii|rb', 11, 8)
    const b = row('kenneth walker|rb', 27, 1)
    for (const input of [[a, b], [b, a]]) {
      const out = collapseStoredAdpRows(input)
      expect(out).toHaveLength(1)
      expect(out[0]!.averageOverallPick).toBe(11)
      expect(out[0]!.playerKey).toBe('kenneth walker|rb')
    }
  })

  it('more samples wins even over a better ADP (production: `aaron jones|rb` n=10 @101 beside `aaron jones sr|rb` n=4 @27.5)', () => {
    const out = collapseStoredAdpRows([row('aaron jones sr|rb', 27.5, 4), row('aaron jones|rb', 101.1, 10)])
    expect(out).toHaveLength(1)
    expect(out[0]!.averageOverallPick).toBe(101.1)
  })

  it('equal samples: lower ADP, then the smaller stored key', () => {
    expect(collapseStoredAdpRows([row('x y jr|rb', 9, 2), row('x y jr.|rb', 8, 2)])[0]!.averageOverallPick).toBe(8)
    const tied = [row('aaron jones sr|rb', 8, 2, { scoringFormat: 'b' }), row('aaron jones sr.|rb', 8, 2, { scoringFormat: 'a' })]
    expect(collapseStoredAdpRows(tied)[0]!.scoringFormat).toBe('a') // 'aaron jones sr.|rb' sorts first
    expect(collapseStoredAdpRows([...tied].reverse())[0]!.scoringFormat).toBe('a')
  })

  it('never merges rows from different contexts', () => {
    const out = collapseStoredAdpRows([
      row('james cook iii|rb', 5, 8),
      row('james cook|rb', 7, 3, { contextHash: 'other' }),
    ])
    expect(out).toHaveLength(2)
  })
})

describe('free-agent pools exclude rostered players across spellings', () => {
  it('redraft: rostered James Cook / Marvin Harrison Jr. / Kenneth Walker / Aaron Jones are not free agents', async () => {
    const pool = await fetchRedraftFreeAgentPool({ sport: 'NFL', season: 2026, rosteredKeys: rosteredPlayerKeys(ROSTER) })
    expect(pool.map((p) => p.playerName)).toEqual(['bijan robinson', 'puka nacua'])
    expect(pool.map((p) => p.adpRank)).toEqual([1, 2])
  })

  it('dynasty: same exclusion', async () => {
    const pool = await fetchDynastyFreeAgentPool({ sport: 'NFL', season: 2026, rosteredKeys: dynastyRosteredKeys(ROSTER) })
    expect(pool.map((p) => p.playerName)).toEqual(['bijan robinson', 'puka nacua'])
  })

  it('a rostered "Kenneth Walker" is priced off the real key, not the 1-sample stray', async () => {
    const adpByKey = await fetchAdpByPlayerKey('NFL', 2026)
    expect(adpByKey.get(buildPlayerKey('Kenneth Walker', 'RB'))).toBe(11)
    expect(adpByKey.get(buildPlayerKey('James Cook', 'RB'))).toBe(5)
    expect(adpByKey.get(buildPlayerKey('Marvin Harrison Jr.', 'WR'))).toBe(7)
  })
})

describe('loadAdpBoard re-keys stored rows', () => {
  it('exact tier: one entry per player, keyed by buildPlayerKey', async () => {
    findMany.mockReset()
    findMany.mockResolvedValueOnce(STORED).mockResolvedValueOnce([])
    const board = await loadAdpBoard(
      { sport: 'NFL', leagueType: 'redraft', draftType: 'snake', scoringFormat: 'ppr', rosterFormat: 'standard', teamCount: 12, season: '2026' },
      { draftMode: 'real' },
    )
    const keys = board.entries.map((e) => e.playerKey)
    expect(new Set(keys).size).toBe(keys.length)
    const walker = board.entries.find((e) => e.playerKey === buildPlayerKey('Kenneth Walker', 'RB'))
    expect(walker?.adp).toBe(11)
    expect(walker?.sampleSize).toBe(8)
    expect(board.entries.find((e) => e.playerKey === buildPlayerKey('Aaron Jones Sr.', 'RB'))).toBeDefined()
  })
})
