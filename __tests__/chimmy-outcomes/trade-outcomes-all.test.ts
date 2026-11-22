import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  DYNASTY_POINTS_HORIZON_DAYS,
  foldOutcomeBucket,
  gradeAllTradeOutcomes,
  gradedByNflLedger,
  outcomeBucketKey,
  pointsOver,
  tradeOutcomeKind,
  valueShareNet,
  VALUE_MIN_DAYS,
} from '@/lib/chimmy-outcomes/tradeOutcomesAll'
import { ledgerRecordFor, readLedgerRecordView, type LedgerSnapshot } from '@/lib/chimmy-outcomes/ledgerRecord'
import { letterRecordApplies, tradeOutcomeRecordFor } from '@/lib/chimmy-outcomes/engineRecord'
import { publicTrackRecord } from '@/lib/chimmy-outcomes/publicTrackRecord'
import { adviceRecordMessages } from '@/lib/core-app/messages/adviceRecord'

/**
 * Trade letters graded on what happened, for everything the NFL redraft record does not cover (owner's call,
 * 2026-11-22): every sport, and dynasty, keeper, devy, C2C, salary cap, best ball, guillotine, survivor, zombie…
 */

const NOW = new Date('2026-11-22T12:00:00Z')
const DAY = 86_400_000

describe('which measure a league is graded on', () => {
  it('dynasty-shaped leagues on value; every redraft-shaped season on points', () => {
    for (const t of ['dynasty', 'keeper', 'devy', 'devy_dynasty', 'c2c', 'merged_devy_c2c', 'salary_cap', 'contract_dynasty']) expect(tradeOutcomeKind(t)).toBe('value')
    for (const t of ['redraft', 'best_ball', 'guillotine', 'survivor', 'survivor_guillotine', 'zombie', 'big_brother', 'season_tournament', 'idp']) expect(tradeOutcomeKind(t)).toBe('points')
    expect(tradeOutcomeKind('', true)).toBe('value')
    expect(tradeOutcomeKind(null, false)).toBe('points')
  })

  it('NFL plain redraft is left to the NFL ledger; everything else is graded here', () => {
    expect(gradedByNflLedger('NFL', 'redraft')).toBe(true)
    expect(gradedByNflLedger('NFL', 'best_ball')).toBe(false)
    expect(gradedByNflLedger('NBA', 'redraft')).toBe(false)
    expect(outcomeBucketKey('nba', 'points')).toBe('NBA:points')
  })
})

describe('the measures', () => {
  it('points: summed over the window; a player the logs cannot place leaves the side unscored, never zero', () => {
    const games = new Map([['a', [{ dayMs: 5, points: 10 }, { dayMs: 9, points: 20 }]], ['b', [{ dayMs: 6, points: 4 }]]])
    expect(pointsOver(['a', 'b'], games, 5, 8)).toBe(14)
    expect(pointsOver(['a', 'ghost'], games, 0, 99)).toBeNull()
    expect(pointsOver([], games, 0, 99)).toBe(0)
  })

  it('value: get minus give as a share of both, in percentage points; anyone unpriced → null', () => {
    const v = new Map([['x', 6000], ['y', 4000]])
    expect(valueShareNet(['x'], ['y'], (id) => v.get(id) ?? null)).toBe(20)
    expect(valueShareNet(['y'], ['x'], (id) => v.get(id) ?? null)).toBe(-20)
    expect(valueShareNet(['x'], ['ghost'], (id) => v.get(id) ?? null)).toBeNull()
  })

  it('a bucket counts, averages and folds the held-up record with the shared rule', () => {
    const b = foldOutcomeBucket('NBA', 'points', [
      { status: 'graded', letter: 'A', net: 4, capturedAtMs: NOW.getTime() - 20 * DAY },
      { status: 'graded', letter: 'A', net: -2, capturedAtMs: NOW.getTime() - 20 * DAY },
      { status: 'graded', letter: 'F', net: -6, capturedAtMs: NOW.getTime() - 20 * DAY },
      { status: 'pending', letter: 'B' },
      { status: 'unscored', letter: 'C' },
    ], { category_league: 2 }, NOW)
    expect(b.byLetter.A).toEqual({ n: 2, net: 1, ahead: 1, behind: 1 })
    expect(b.byLetter.F).toEqual({ n: 1, net: -6, ahead: 0, behind: 1 })
    expect(b).toMatchObject({ pending: 1, unscored: 1, gradable: 5, skips: { category_league: 2 } })
    expect(b.letters.A).toMatchObject({ held: 1, missed: 1 })
    expect(b.letters.F).toMatchObject({ held: 1, missed: 0 })
  })
})

describe('gradeAllTradeOutcomes (database read, mocked)', () => {
  const receipt = (letter: string, type: string, get: string[], give: string[], extraAssets: unknown[] = []) => ({
    grade: { graded: true, letter, leagueType: { type } },
    canonical: { proposerRosterId: 'me', moves: [...get.map((p) => ({ playerId: p, fromRosterId: 'them', toRosterId: 'me' })), ...give.map((p) => ({ playerId: p, fromRosterId: 'me', toRosterId: 'them' }))] },
    assets: extraAssets,
  })
  const snap = (over: Record<string, unknown>) => ({ is_trade: true, surface: 'trade-center', captured_at: new Date(NOW.getTime() - 60 * DAY), league_type: null, league_variant: null, is_dynasty: false, settings: null, ...over })

  function db(snaps: unknown[], extra: { values?: Record<string, Array<{ sleeper_id: string; value: number }>> } = {}) {
    return {
      $queryRaw: vi.fn(async (q: TemplateStringsArray, ...v: unknown[]) => {
        const sql = q.join('?')
        if (sql.includes('trade_decision_snapshots')) return snaps
        if (sql.includes('PlayerValueSnapshot')) return extra.values?.[String(v.find((x) => x === 'ONE_QB' || x === 'SUPERFLEX'))] ?? []
        return []
      }),
      sportsPlayer: { findMany: vi.fn(async () => [{ sleeperId: 's1', position: 'RB', externalId: 'x' }, { sleeperId: 's2', position: 'WR', externalId: 'y' }]) },
      playerGameStat: { findMany: vi.fn(async () => []) },
      playerIdentityMap: { findMany: vi.fn(async () => []) },
    }
  }

  it('an NFL dynasty players-only deal is graded on the dynasty market in its own QB format; a picks deal is skipped and counted', async () => {
    const d = db([
      snap({ sport: 'NFL', receipt: receipt('A', 'dynasty', ['s1'], ['s2']), settings: { roster_positions: ['QB', 'SUPER_FLEX'] } }),
      snap({ sport: 'NFL', receipt: receipt('B', 'dynasty', ['s1'], ['s2'], [{ kind: 'pick' }]) }),
      snap({ sport: 'NFL', receipt: receipt('A', 'devy', ['s1'], ['s2']), captured_at: new Date(NOW.getTime() - (VALUE_MIN_DAYS - 1) * DAY) }),
      snap({ sport: 'NFL', receipt: receipt('A', 'redraft', ['s1'], ['s2']) }), // the NFL ledger's
    ], { values: { SUPERFLEX: [{ sleeper_id: 's1', value: 7000 }, { sleeper_id: 's2', value: 3000 }], ONE_QB: [{ sleeper_id: 's1', value: 1 }, { sleeper_id: 's2', value: 1 }] } })
    // placePlayerIds maps receipt ids to Sleeper ids; here they already are.
    vi.doMock('@/lib/chimmy-outcomes/ledgerGrading', () => ({ placePlayerIds: async (ids: string[]) => new Map(ids.map((i) => [i, i])) }))
    const out = await gradeAllTradeOutcomes({ now: NOW, db: d as never })
    vi.doUnmock('@/lib/chimmy-outcomes/ledgerGrading')
    const v = out['NFL:value']!
    expect(v.byLetter.A).toEqual({ n: 1, net: 40, ahead: 1, behind: 0 })
    expect(v.pending).toBe(1)
    expect(v.skips).toEqual({ picks_not_valued: 1 })
    expect(Object.keys(out)).not.toContain('NFL:points')
  })

  it('category leagues are skipped with a reason, never scored on points', async () => {
    const d = db([snap({ sport: 'NBA', receipt: receipt('A', 'redraft', ['1'], ['2']), settings: { scoring_mode: 'h2h_category' } })])
    const out = await gradeAllTradeOutcomes({ now: NOW, db: d as never })
    expect(out['NBA:points']!.skips).toEqual({ category_league: 1 })
    expect(out['NBA:points']!.gradable).toBe(0)
  })

  it('another sport’s dynasty deal goes to that sport’s points bucket, over the longer window', () => {
    expect(DYNASTY_POINTS_HORIZON_DAYS).toBeGreaterThan(300)
  })
})

describe('through the snapshot to the screen', () => {
  const ledger = {
    season: 2026, throughWeek: 11, bench: {}, pickups: {}, users: {},
    trades: { byLetter: {}, pending: 0, unscored: 0, read: 0, gradable: 0 },
    tradeOutcomes: {
      'NFL:value': { sport: 'NFL', kind: 'value', byLetter: { A: { n: 24, net: 12.5, ahead: 17, behind: 7 }, B: { n: 3, net: 1, ahead: 2, behind: 1 } }, pending: 0, unscored: 0, gradable: 27, skips: {}, letters: { A: { held: 17, missed: 7, wDecided: 24, wHeld: 17 } } },
      'NBA:points': { sport: 'NBA', kind: 'points', byLetter: { D: { n: 30, net: 2.1, ahead: 18, behind: 12 } }, pending: 0, unscored: 0, gradable: 30, skips: {}, letters: {} },
    },
  } as unknown as LedgerSnapshot

  it('the view keeps letters with enough graded deals, and survives the trip to the client', () => {
    const view = ledgerRecordFor(ledger, null)!
    expect(view.tradeOutcomes!['NFL:value']!.letters.map((l) => l.letter)).toEqual(['A'])
    expect(readLedgerRecordView(JSON.parse(JSON.stringify(view)))!.tradeOutcomes!['NBA:points']!.letters[0]).toMatchObject({ letter: 'D', n: 30, net: 2.1, aheadPct: 60 })
  })

  it('a dynasty grade gets the dynasty record; an NBA grade the NBA one; an NFL redraft grade neither (it has its own)', () => {
    const view = ledgerRecordFor(ledger, null)!
    const dyn = tradeOutcomeRecordFor(view, { sport: 'NFL', leagueType: 'dynasty', letter: 'A' })!
    expect(dyn).toMatchObject({ kind: 'value', n: 24, net: 12.5, aheadPct: 71, verdict: 'held_up' })
    expect(tradeOutcomeRecordFor(view, { sport: 'NFL', leagueType: 'c2c', letter: 'A' })!.kind).toBe('value')
    const nba = tradeOutcomeRecordFor(view, { sport: 'NBA', leagueType: 'dynasty', letter: 'D' })!
    expect(nba).toMatchObject({ kind: 'points', verdict: 'not_held_up' })
    expect(letterRecordApplies({ sport: 'NFL', leagueType: 'redraft' })).toBe(true)
    expect(tradeOutcomeRecordFor(view, { sport: 'NFL', leagueType: 'redraft', letter: 'A' })).toBeNull()
    expect(tradeOutcomeRecordFor(view, { sport: 'NFL', leagueType: 'dynasty', letter: 'B' })).toBeNull() // 3 deals: under the floor
  })

  it('the line says what it measured, in both languages', () => {
    const en = adviceRecordMessages.en.tradeOutcomeRecord('value', 'NFL', 'A', 24, 12.5, 71, 'held_up')
    expect(en).toBe('How A grades have held up in dynasty-style leagues: across 24 graded trades, the team we graded A held 12.5 points more of the deal\'s dynasty value than it gave up, a month or more later (ahead in 71%). This letter has held up.')
    expect(adviceRecordMessages.en.tradeOutcomeRecord('points', 'NBA', 'D', 30, 2.1, 60, 'not_held_up')).toMatch(/in NBA leagues like this one.*under each league's own scoring.*has not held up/)
    expect(adviceRecordMessages.es!.tradeOutcomeRecord!('points', 'NBA', 'D', 30, 2.1, 60, 'not_held_up')).toMatch(/intercambios.*con la puntuación de cada liga/)
  })

  it('the public record lists them, misses included', () => {
    const lines = publicTrackRecord(ledgerRecordFor(ledger, null)).lines
    expect(lines.find((l) => l.key === 'trade-NFL:value-A')).toMatchObject({ title: 'Trades graded A in dynasty-style leagues', tone: 'held' })
    expect(lines.find((l) => l.key === 'trade-NBA:points-D')).toMatchObject({ title: 'Trades graded D in NBA leagues', tone: 'not_held' })
  })
})
