import { describe, expect, it, vi } from 'vitest'

import {
  INJURY_SNAPSHOT_KEY,
  captureNflInjurySnapshot,
  injuryLevel,
  mergeInjuryCapture,
  snapshotLevelFor,
  type InjurySnapshot,
} from '@/lib/af-projections/factors/injurySnapshots'
import { FACTOR_LEVELS, learnFactors, type FactorObservation } from '@/lib/af-projections/factors/factorLearner'
import { factorReason } from '@/lib/af-projections/factors/factorTables'

const at = (iso: string) => new Date(iso)

describe('injuryLevel', () => {
  it('maps every provider spelling we store to a level, and refuses what states nothing', () => {
    expect(injuryLevel('Questionable')).toBe('questionable')
    expect(injuryLevel('Q')).toBe('questionable')
    expect(injuryLevel('Doubtful')).toBe('doubtful')
    expect(injuryLevel('Out')).toBe('out')
    expect(injuryLevel('IR')).toBe('out')
    expect(injuryLevel('injury reserve')).toBe('out')
    expect(injuryLevel('PUP')).toBe('out')
    expect(injuryLevel('COV')).toBe('out')
    expect(injuryLevel('Active')).toBe('clear')
    expect(injuryLevel(null)).toBeNull()
    expect(injuryLevel('Achilles')).toBeNull()
  })
})

describe('mergeInjuryCapture', () => {
  const kick = new Map([['BUF', at('2026-11-22T18:00:00Z')], ['KC', at('2026-11-22T18:00:00Z')], ['DAL', at('2026-11-24T01:15:00Z')]])

  it('freezes a team at its kickoff: later captures never touch its players', () => {
    const friday = mergeInjuryCapture(null, {
      season: 2026, week: 12, at: at('2026-11-21T20:00:00Z'), kickoffs: kick,
      designations: new Map([['1', { level: 'questionable', team: 'BUF' }], ['2', { level: 'doubtful', team: 'DAL' }]]),
    })
    // Sunday evening: BUF has kicked off. Player 1 is now "Out" (hurt IN the game) — that must not reach the snapshot.
    const sunday = mergeInjuryCapture(friday, {
      season: 2026, week: 12, at: at('2026-11-22T21:00:00Z'), kickoffs: kick,
      designations: new Map([['1', { level: 'out', team: 'BUF' }]]),
    })
    expect(sunday.players['1']).toEqual({ level: 'questionable', team: 'BUF' })
    expect(sunday.teams.BUF.capturedAt).toBe('2026-11-21T20:00:00.000Z')
    // DAL has not kicked off and player 2 was cleared since: he drops out, and DAL is re-captured.
    expect(sunday.players['2']).toBeUndefined()
    expect(sunday.teams.DAL.capturedAt).toBe('2026-11-22T21:00:00.000Z')
  })

  it('a team first seen after its kickoff is not captured at all (no level, not "clear")', () => {
    const late = mergeInjuryCapture(null, {
      season: 2026, week: 12, at: at('2026-11-22T21:00:00Z'), kickoffs: kick, designations: new Map(),
    })
    expect(late.teams.BUF).toBeUndefined()
    expect(snapshotLevelFor(late, '1', 'BUF')).toBeUndefined()
    expect(snapshotLevelFor(late, '9', 'DAL')).toBe('clear')
  })

  it('a new week starts clean rather than carrying last week forward', () => {
    const w11 = mergeInjuryCapture(null, { season: 2026, week: 11, at: at('2026-11-14T20:00:00Z'), kickoffs: kick, designations: new Map([['1', { level: 'questionable', team: 'BUF' }]]) })
    const w12 = mergeInjuryCapture(w11, { season: 2026, week: 12, at: at('2026-11-21T20:00:00Z'), kickoffs: kick, designations: new Map() })
    expect(w12.players['1']).toBeUndefined()
  })
})

describe('snapshotLevelFor', () => {
  const snap: InjurySnapshot = {
    season: 2026, week: 12, capturedAt: '', teams: { BUF: { kickoffAt: '', capturedAt: '' } },
    players: { '1': { level: 'questionable', team: 'BUF' }, '3': { level: 'out', team: 'BUF' } },
  }
  it('designated, clear on a captured team, nothing for an uncaptured team or a ruled-out player', () => {
    expect(snapshotLevelFor(snap, '1', 'BUF')).toBe('questionable')
    expect(snapshotLevelFor(snap, '2', 'BUF')).toBe('clear')
    expect(snapshotLevelFor(snap, '2', 'KC')).toBeUndefined()
    expect(snapshotLevelFor(snap, '3', 'BUF')).toBeUndefined()
    expect(snapshotLevelFor(null, '1', 'BUF')).toBeUndefined()
  })
})

describe('captureNflInjurySnapshot', () => {
  function db(prior: InjurySnapshot | null) {
    const upsert = vi.fn().mockResolvedValue({})
    return {
      upsert,
      db: {
        sportsGame: {
          findFirst: vi.fn().mockResolvedValue({ season: 2026, week: 12, seasonType: 'regular' }),
          findMany: vi.fn().mockResolvedValue([
            { homeTeam: 'Buffalo Bills', awayTeam: 'Kansas City Chiefs', startTime: at('2026-11-22T18:00:00Z') },
          ]),
        },
        sportsDataCache: { findUnique: vi.fn().mockResolvedValue(prior ? { data: prior } : null), upsert },
        sportsInjury: {
          findMany: vi.fn().mockResolvedValue([
            // Friday's Questionable, then Sunday morning's Active from another source: the newest claim wins.
            { playerName: 'Josh Allen', team: 'BUF', position: 'QB', status: 'Questionable', date: at('2026-11-20T20:00:00Z'), fetchedAt: at('2026-11-22T15:00:00Z') },
            { playerName: 'Josh Allen', team: 'Buffalo Bills', position: 'QB', status: 'Active', date: at('2026-11-22T14:00:00Z'), fetchedAt: at('2026-11-22T14:30:00Z') },
            { playerName: 'Travis Kelce', team: 'Kansas City Chiefs', position: 'TE', status: 'Doubtful', date: at('2026-11-21T20:00:00Z'), fetchedAt: at('2026-11-22T14:30:00Z') },
          ]),
        },
        playerIdentityMap: {
          findMany: vi.fn().mockResolvedValue([
            { sleeperId: '4984', canonicalName: 'Josh Allen', currentTeam: 'BUF', position: 'QB' },
            { sleeperId: '1466', canonicalName: 'Travis Kelce', currentTeam: 'KC', position: 'TE' },
          ]),
        },
      },
    }
  }

  it('captures designations by Sleeper id for teams not yet kicked off', async () => {
    const { db: d, upsert } = db(null)
    const tick = await captureNflInjurySnapshot(d as never, { now: at('2026-11-22T16:00:00Z') })
    expect(tick).toMatchObject({ status: 'captured', season: 2026, week: 12, openTeams: 2, designated: 1 })
    const written = upsert.mock.calls[0]![0].create
    expect(written.cacheKey).toBe(INJURY_SNAPSHOT_KEY(2026, 12))
    expect(written.data.players).toEqual({ '1466': { level: 'doubtful', team: 'KC' } })
    expect(Object.keys(written.data.teams).sort()).toEqual(['BUF', 'KC'])
  })

  it('waits 30 minutes between captures', async () => {
    const prior = { season: 2026, week: 12, capturedAt: '2026-11-22T15:50:00.000Z', teams: {}, players: {} }
    const { db: d, upsert } = db(prior)
    expect(await captureNflInjurySnapshot(d as never, { now: at('2026-11-22T16:00:00Z') })).toEqual({ status: 'fresh', season: 2026, week: 12 })
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('the injury factor in the learner', () => {
  it('is a factor with clear as its baseline, and is learned and explained like the others', () => {
    expect(FACTOR_LEVELS.injury).toEqual(['clear', 'questionable', 'doubtful'])
    const obs: FactorObservation[] = []
    const t0 = Date.UTC(2025, 8, 1)
    for (let i = 0; i < 1200; i++) {
      const q = i % 4 === 0
      // Questionable players score ~85% of their trailing average; clear ones score it.
      obs.push({ baseline: 10, actual: q ? 8.5 + ((i % 3) - 1) * 0.2 : 10 + ((i % 5) - 2) * 0.3, levels: { injury: q ? 'questionable' : 'clear' }, atMs: t0 + i * 3_600_000 })
    }
    const table = learnFactors('NFL', obs, new Date(t0 + 1300 * 3_600_000))
    const q = table.levels.find((l) => l.factor === 'injury' && l.level === 'questionable')!
    expect(q.multiplier).toBeCloseTo(0.85, 1)
    expect(q.published).toBe(true)
    expect(factorReason(q)).toMatch(/^listed Questionable before kickoff -15%/)
  })
})
