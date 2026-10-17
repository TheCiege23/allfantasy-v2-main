/**
 * Matchup ranks on the finder's upcoming weeks: the ranking rule, the loader (fold, merge, cache),
 * and the chips on PlayerNextGames.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ rows: [] as Array<{ opponent: string; pos: string; week: number; allowed: number }>, queryRaw: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: h.queryRaw } }))

import { MIN_DEFENSES_RANKED, buildMatchupOutlook, ordinal, rankPhrase, type DefenseCell } from '@/lib/core-app/matchupOutlook'
import { clearMatchupOutlookCache, loadMatchupOutlook } from '@/lib/core-app/matchupOutlookLoader'
import { PlayerNextGames, tileLabel } from '@/components/core-app/player-finder/PlayerNextGames'

/** 30 WR defenses: D01 allows the most (50), D30 the least (21). */
const cells = (n = 30, pos = 'WR'): DefenseCell[] =>
  Array.from({ length: n }, (_, i) => ({ defense: `D${String(i + 1).padStart(2, '0')}`, position: pos, games: 3, allowedPerGame: 50 - i }))
const id = (c: string) => c

describe('matchup ranking (pure)', () => {
  it('ranks every defense for the position and splits them into thirds', () => {
    const o = buildMatchupOutlook({
      position: 'WR',
      season: 2026,
      fold: id,
      cells: cells(),
      weeks: [
        { week: 5, opponent: 'D03', bye: false },
        { week: 6, opponent: 'D15', bye: false },
        { week: 7, opponent: 'D28', bye: false },
        { week: 8, opponent: null, bye: true },
        // A bye that still carries an opponent code (a stale schedule row) is a bye, not a game.
        { week: 10, opponent: 'D05', bye: true },
        { week: 9, opponent: 'NOPE', bye: false },
      ],
    })!
    expect(Object.values(o.reads).map((r) => [r.week, r.opponent, r.tier, r.rank, r.of])).toEqual([
      [5, 'D03', 'soft', 3, 30],
      [6, 'D15', 'neutral', 15, 30],
      [7, 'D28', 'tough', 28, 30],
    ])
    expect(o.reads[8]).toBeUndefined() // bye
    expect(o.reads[9]).toBeUndefined() // a defense we cannot rank is left blank, not guessed
    expect(o.reads[10]).toBeUndefined()
    expect(o.leagueAverage).toBeCloseTo(35.5, 5)
    expect(o.minGames).toBe(3)
  })

  it('the third boundaries sit exactly on thirds', () => {
    const weeks = [10, 11, 20, 21].map((r, i) => ({ week: i + 1, opponent: `D${String(r).padStart(2, '0')}`, bye: false }))
    const o = buildMatchupOutlook({ position: 'WR', season: 2026, fold: id, cells: cells(), weeks })!
    expect(Object.values(o.reads).map((r) => r.tier)).toEqual(['soft', 'neutral', 'neutral', 'tough'])
  })

  it('folds the schedule code before looking the defense up', () => {
    const o = buildMatchupOutlook({ position: 'WR', season: 2026, fold: (c) => (c === 'JAC' ? 'D01' : c), cells: cells(), weeks: [{ week: 5, opponent: 'JAC', bye: false }] })!
    expect(o.reads[5]).toMatchObject({ opponent: 'D01', rank: 1 })
  })

  it(`no ranking with fewer than ${MIN_DEFENSES_RANKED} defenses on file, or for a non-skill position`, () => {
    const weeks = [{ week: 5, opponent: 'D01', bye: false }]
    expect(buildMatchupOutlook({ position: 'WR', season: 2026, fold: id, cells: cells(MIN_DEFENSES_RANKED - 1), weeks })).toBeNull()
    expect(buildMatchupOutlook({ position: 'K', season: 2026, fold: id, cells: cells(30, 'K'), weeks })).toBeNull()
    expect(buildMatchupOutlook({ position: 'WR', season: 2026, fold: id, cells: cells(30, 'RB'), weeks })).toBeNull()
  })

  it('says each end from its own side', () => {
    const r = (rank: number, tier: 'soft' | 'neutral' | 'tough') => ({ week: 1, opponent: 'X', tier, rank, of: 30, allowedPerGame: 1, games: 3 })
    expect(rankPhrase(r(1, 'soft'), 'WR')).toBe('the softest vs WRs')
    expect(rankPhrase(r(3, 'soft'), 'WR')).toBe('3rd-softest vs WRs')
    expect(rankPhrase(r(30, 'tough'), 'TE')).toBe('the toughest vs TEs')
    expect(rankPhrase(r(28, 'tough'), 'TE')).toBe('3rd-toughest vs TEs')
    expect(rankPhrase(r(15, 'neutral'), 'RB')).toBe('middle of the pack vs RBs')
    expect([tileLabel(r(3, 'soft')), tileLabel(r(30, 'tough')), tileLabel(r(15, 'neutral'))]).toEqual(['Soft #3', 'Tough #1', 'Mid'])
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd'])
  })
})

describe('loadMatchupOutlook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearMatchupOutlookCache()
    // 30 real-ish defenses for WRs, one game each in weeks 1..3.
    const codes = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB']
    h.rows = codes.flatMap((c, i) => [1, 2, 3].map((week) => ({ opponent: c, pos: 'WR', week, allowed: 20 + i })))
    h.queryRaw.mockImplementation(async () => h.rows)
  })
  const load = (over: Partial<Parameters<typeof loadMatchupOutlook>[0]> = {}) =>
    loadMatchupOutlook({ sport: 'NFL', position: 'WR', season: 2026, weeks: [{ week: 5, opponent: 'JAC', bye: false }, { week: 6, opponent: 'LA', bye: false }], ...over })

  it('folds both the schedule and the stats spellings to one defense', async () => {
    const o = await load()
    expect(o!.reads[5]).toMatchObject({ opponent: 'JAX', games: 3 })
    expect(o!.reads[6]).toMatchObject({ opponent: 'LAR' })
  })

  it('a defense spelled two ways in the stats is merged, not ranked twice', async () => {
    h.rows.push({ opponent: 'WAS', pos: 'WR', week: 1, allowed: 60 }, { opponent: 'WSH', pos: 'WR', week: 2, allowed: 40 })
    const o = await load({ weeks: [{ week: 5, opponent: 'WAS', bye: false }] })
    expect(o!.reads[5]).toMatchObject({ opponent: 'WAS', games: 2, allowedPerGame: 50, rank: 1, of: 31 })
  })

  it('reads the season once and shares it; a failed read is not cached', async () => {
    await load()
    await load({ weeks: [{ week: 7, opponent: 'KC', bye: false }] })
    expect(h.queryRaw).toHaveBeenCalledTimes(1)
    clearMatchupOutlookCache()
    h.queryRaw.mockRejectedValueOnce(new Error('db down'))
    expect(await load()).toBeNull()
    expect(await load()).not.toBeNull()
  })

  it('nothing for another sport, a kicker, or no season — and no query', async () => {
    expect(await load({ sport: 'NBA' })).toBeNull()
    expect(await load({ position: 'K' })).toBeNull()
    expect(await load({ season: null })).toBeNull()
    expect(h.queryRaw).not.toHaveBeenCalled()
  })
})

describe('PlayerNextGames with matchup ranks', () => {
  const next = { available: true as const, data: { opponent: 'KC', home: false, kickoff: null, market: null } }
  const upcoming = {
    available: true as const,
    data: {
      season: 2026,
      weeks: [
        { week: 5, opponent: 'D03', home: false, bye: false, projection: null },
        { week: 6, opponent: null, home: false, bye: true, projection: null },
        { week: 7, opponent: 'D29', home: true, bye: false, projection: null },
      ],
    },
  }
  const matchups = buildMatchupOutlook({ position: 'WR', season: 2026, fold: id, cells: cells(), weeks: upcoming.data.weeks })

  it('puts a compact rank on each ranked week, the full phrase for screen readers, and the sample in the footnote', () => {
    render(<PlayerNextGames next={next} upcoming={upcoming} matchups={matchups} />)
    expect(screen.getByText('Soft #3')).toBeTruthy()
    expect(screen.getByText('3rd-softest vs WRs')).toBeTruthy()
    expect(screen.getByText('Tough #2')).toBeTruthy()
    expect(screen.getByText(/among 30 defenses — Soft #1 allows the most, Tough #1 the least\./)).toBeTruthy()
    expect(screen.getByText(/An early read — some defenses have played only 3 games\./)).toBeTruthy()
  })

  it('no ranks, no chips and no footnote without an outlook', () => {
    const { container } = render(<PlayerNextGames next={next} upcoming={upcoming} />)
    expect(container.querySelector('.af-pf-next-mu')).toBeNull()
    expect(container.querySelector('.af-pf-next-mu-foot')).toBeNull()
  })
})
