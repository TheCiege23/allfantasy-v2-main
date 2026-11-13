/**
 * AllFantasy AI ADP — daily aggregation helpers, playerId sport rollup, persist hook.
 *
 * AUDIT:
 * - **System ADP**: Imported/consensus ADP on draft pool rows (`adp` / resolver imports).
 * - **AI ADP**: `AllFantasyAdpSnapshot` from **`aggregateAdp`** + **`persistAllFantasyAdpSnapshots`**;
 *   pool joins via **`contextHash`** + **`playerKey`** (`name|position`).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockDraftPickFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))
const mockAdpUpsert = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const mockAdpFindMany = vi.hoisted(() => vi.fn().mockResolvedValue([] as unknown[]))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftPick: { findMany: mockDraftPickFindMany },
    allFantasyAdpSnapshot: { upsert: mockAdpUpsert, findMany: mockAdpFindMany },
  },
}))

import { aggregateAdp } from '@/lib/adp/computeAllFantasyAdp'
import { persistAllFantasyAdpSnapshots } from '@/lib/adp/recomputeAllFantasyAdp'

const root = resolve(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('persistAllFantasyAdpSnapshots', () => {
  beforeEach(() => {
    mockAdpUpsert.mockClear()
  })

  it('upserts prisma rows for each snapshot', async () => {
    const ctx = {
      sport: 'NFL',
      leagueType: 'redraft',
      draftType: 'snake',
      scoringFormat: 'ppr',
      rosterFormat: 'standard',
      teamCount: 12,
      season: '2026',
    }
    const snaps = aggregateAdp([
      {
        playerName: 'Test',
        position: 'RB',
        overall: 3,
        round: 1,
        context: ctx,
        draftMode: 'real',
      },
    ])
    const { written, errors } = await persistAllFantasyAdpSnapshots(snaps)
    expect(errors).toHaveLength(0)
    expect(written).toBe(1)
    expect(mockAdpUpsert).toHaveBeenCalledTimes(1)
  })
})

describe('system vs AI ADP separation', () => {
  it('compute layer never assigns imported pool adp', () => {
    const poolSrc = read('lib/draft-room/getResolvedDraftPoolForLeague.ts')
    expect(poolSrc).toContain('AI ADP comes from AllFantasyAdpSnapshot ONLY')
    expect(poolSrc.includes('aiAdpHit') && poolSrc.includes('getLiveADP')).toBe(false)
  })
})

describe('getResolvedDraftPoolForLeague exposes system adp and ai ADP fields', () => {
  it('maps aiAdp from snapshot overlay and keeps base row adp separate', () => {
    const src = read('lib/draft-room/getResolvedDraftPoolForLeague.ts')
    expect(src).toMatch(/\baiAdp\b/)
    /*
     * The overlay now goes through lib/adp/loadAdpBoard.ts, so the column name it selects
     * (`averageOverallPick`) lives there rather than here. Asserting on that name in THIS file
     * was asserting on where a query happened to be written, which is exactly what moved.
     * What matters is that the pool reads the AllFantasy board through the shared loader - the
     * one that also supplies the cross-size tier every non-12-team league depends on.
     */
    expect(src).toContain('loadAdpBoard')
    expect(src).toContain('buildDraftContext')
    expect(src).toMatch(/adp/)
  })
})

describe('recomputeAllFantasyAdp summary shape', () => {
  afterEach(() => {
    mockDraftPickFindMany.mockResolvedValue([] as unknown[])
  })

  it('report includes scan/write counters', async () => {
    mockDraftPickFindMany.mockResolvedValueOnce([] as unknown[])
    const { recomputeAllFantasyAdp } = await import('@/lib/adp/recomputeAllFantasyAdp')
    const report = await recomputeAllFantasyAdp({ apply: false, sport: 'NFL' })
    expect(report.picksScanned).toBe(0)
    expect(report.mode).toBe('dry-run')
  })
})
