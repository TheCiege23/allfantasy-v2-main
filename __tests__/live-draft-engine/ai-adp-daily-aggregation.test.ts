/**
 * AllFantasy AI ADP — daily aggregation helpers, playerId sport rollup, persist hook.
 *
 * AUDIT (see `lib/adp/allFantasyAdpDailyAggregation.ts` header):
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

import type { AggregatablePick } from '@/lib/adp/computeAllFantasyAdp'
import { aggregateAdp } from '@/lib/adp/computeAllFantasyAdp'
import {
  collectAllFantasyDraftPickSamples,
  computeAllFantasyAdpByPlayerIdSport,
  computeAllFantasyAdpFromPicks,
  buildDailyRecomputeSummary,
  type DraftPickSampleRow,
} from '@/lib/adp/allFantasyAdpDailyAggregation'
import { persistAllFantasyAdpSnapshots } from '@/lib/adp/recomputeAllFantasyAdp'

const root = resolve(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

function sampleRow(partial: Partial<DraftPickSampleRow> & Pick<DraftPickSampleRow, 'playerId' | 'playerName' | 'overall' | 'sport'>): DraftPickSampleRow {
  return {
    sessionKind: 'live',
    sessionStatus: 'completed',
    pickedAt: new Date('2026-01-15T12:00:00Z'),
    leagueId: 'lg1',
    draftSessionId: 'ds1',
    source: 'user',
    assetType: 'player',
    position: 'RB',
    sportTypePick: null,
    ...partial,
  }
}

describe('collectAllFantasyDraftPickSamples', () => {
  it('keeps valid picks with playerId and excludes mock drafts', () => {
    const rows = [
      sampleRow({ playerId: 'p1', playerName: 'A', overall: 5, sport: 'NFL' }),
      sampleRow({
        playerId: 'p2',
        playerName: 'B',
        overall: 6,
        sport: 'NFL',
        sessionKind: 'mock',
      }),
    ]
    const r = collectAllFantasyDraftPickSamples(rows, { requirePlayerId: true })
    expect(r.kept).toHaveLength(1)
    expect(r.skippedMock).toBe(1)
  })

  it('excludes undone/deleted sources', () => {
    const rows = [
      sampleRow({ playerId: 'p1', playerName: 'A', overall: 3, sport: 'NFL', source: 'undone' }),
      sampleRow({ playerId: 'p2', playerName: 'B', overall: 4, sport: 'NFL' }),
    ]
    const r = collectAllFantasyDraftPickSamples(rows, { requirePlayerId: true })
    expect(r.kept).toHaveLength(1)
    expect(r.skippedInvalid).toBeGreaterThanOrEqual(1)
  })

  it('excludes wrong sport on pick row vs league sport', () => {
    const rows = [
      sampleRow({
        playerId: 'p1',
        playerName: 'X',
        overall: 2,
        sport: 'NFL',
        sportTypePick: 'NBA',
      }),
      sampleRow({ playerId: 'p2', playerName: 'Y', overall: 3, sport: 'NFL', sportTypePick: 'NFL' }),
    ]
    const r = collectAllFantasyDraftPickSamples(rows, { requirePlayerId: true })
    expect(r.skippedSportMismatch).toBe(1)
    expect(r.kept.some((k) => k.playerId === 'p1')).toBe(false)
  })
})

describe('computeAllFantasyAdpByPlayerIdSport', () => {
  it('averages overall by playerId + sport', () => {
    const rows = collectAllFantasyDraftPickSamples(
      [
        sampleRow({ playerId: 'pid-a', playerName: 'Player A', overall: 10, sport: 'NFL' }),
        sampleRow({ playerId: 'pid-a', playerName: 'Player A', overall: 20, sport: 'NFL' }),
      ],
      { requirePlayerId: true },
    ).kept
    const roll = computeAllFantasyAdpByPlayerIdSport(rows)
    expect(roll).toHaveLength(1)
    expect(roll[0]?.averageOverall).toBe(15)
    expect(roll[0]?.sampleCount).toBe(2)
  })

  it('does not merge same display name across sports', () => {
    const rows = collectAllFantasyDraftPickSamples(
      [
        sampleRow({ playerId: 'nfl-dl', playerName: 'Chris Jones', overall: 40, sport: 'NFL' }),
        sampleRow({ playerId: 'nba-pf', playerName: 'Chris Jones', overall: 14, sport: 'NBA' }),
      ],
      { requirePlayerId: true },
    ).kept
    const roll = computeAllFantasyAdpByPlayerIdSport(rows)
    expect(roll).toHaveLength(2)
    expect(roll.find((r) => r.sport === 'NFL')?.averageOverall).toBe(40)
    expect(roll.find((r) => r.sport === 'NBA')?.averageOverall).toBe(14)
  })

  it('does not merge different playerIds with same name', () => {
    const rows = collectAllFantasyDraftPickSamples(
      [
        sampleRow({ playerId: 'id1', playerName: 'Mike Williams', overall: 50, sport: 'NFL' }),
        sampleRow({ playerId: 'id2', playerName: 'Mike Williams', overall: 60, sport: 'NFL' }),
      ],
      { requirePlayerId: true },
    ).kept
    const roll = computeAllFantasyAdpByPlayerIdSport(rows)
    expect(roll).toHaveLength(2)
  })

  it('computes min/max/lastDraftedAt', () => {
    const rows = collectAllFantasyDraftPickSamples(
      [
        sampleRow({
          playerId: 'z',
          playerName: 'Z',
          overall: 8,
          sport: 'NFL',
          pickedAt: new Date('2026-01-01T00:00:00Z'),
        }),
        sampleRow({
          playerId: 'z',
          playerName: 'Z',
          overall: 12,
          sport: 'NFL',
          pickedAt: new Date('2026-06-01T00:00:00Z'),
        }),
      ],
      { requirePlayerId: true },
    ).kept
    const [r] = computeAllFantasyAdpByPlayerIdSport(rows)
    expect(r?.minOverall).toBe(8)
    expect(r?.maxOverall).toBe(12)
    expect(r?.lastDraftedAt).toBe('2026-06-01T00:00:00.000Z')
  })
})

describe('computeAllFantasyAdpFromPicks (context snapshots)', () => {
  it('matches aggregateAdp for grouped averages', () => {
    const ctx = {
      sport: 'NFL',
      leagueType: 'redraft',
      draftType: 'snake',
      scoringFormat: 'ppr',
      rosterFormat: 'standard',
      teamCount: 12,
      season: '2026',
    }
    const picks: AggregatablePick[] = [
      {
        playerName: 'Josh',
        position: 'QB',
        overall: 10,
        round: 1,
        context: ctx,
        draftMode: 'real',
      },
      {
        playerName: 'Josh',
        position: 'QB',
        overall: 20,
        round: 2,
        context: ctx,
        draftMode: 'real',
      },
    ]
    const a = aggregateAdp(picks)
    const b = computeAllFantasyAdpFromPicks(picks)
    expect(b).toEqual(a)
  })
})

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
    expect(src).toMatch(/averageOverallPick/)
    expect(src).toMatch(/adp/)
  })
})

describe('buildDailyRecomputeSummary', () => {
  it('returns zeros for empty rollup', () => {
    const s = buildDailyRecomputeSummary({
      rollup: [],
      collectSkipped: 0,
      computedForDate: new Date('2026-05-05T00:00:00Z'),
    })
    expect(s.sportsProcessed).toEqual([])
    expect(s.samplesCollected).toBe(0)
    expect(s.playersUpdated).toBe(0)
  })

  it('aggregates sports and counts', () => {
    const s = buildDailyRecomputeSummary({
      rollup: [
        {
          sport: 'NFL',
          playerId: 'a',
          playerName: 'A',
          averageOverall: 10,
          sampleCount: 2,
          minOverall: 9,
          maxOverall: 11,
          lastDraftedAt: null,
        },
      ],
      collectSkipped: 3,
      computedForDate: new Date('2026-05-05T12:00:00Z'),
    })
    expect(s.sportsProcessed).toEqual(['NFL'])
    expect(s.samplesCollected).toBe(2)
    expect(s.skippedRows).toBe(3)
    expect(s.computedForDate).toBe('2026-05-05')
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
