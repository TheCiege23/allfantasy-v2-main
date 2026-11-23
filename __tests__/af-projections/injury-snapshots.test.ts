import { describe, expect, it, vi } from 'vitest'

import {
  INJURY_SNAPSHOT_KEY,
  captureInjurySnapshot,
  captureInjurySnapshots,
  easternDate,
  injuryLevel,
  mergeInjuryCapture,
  nflPeriod,
  snapshotLevelFor,
  type InjurySnapshot,
} from '@/lib/af-projections/factors/injurySnapshots'
import { FACTOR_LEVELS, learnFactors, type FactorObservation } from '@/lib/af-projections/factors/factorLearner'
import { factorReason } from '@/lib/af-projections/factors/factorTables'
import { projectionTeamKey } from '@/lib/af-projections/leagueProjectionSchedule'

const at = (iso: string) => new Date(iso)

describe('injuryLevel', () => {
  it('maps every provider spelling we store to a level, and refuses what states nothing', () => {
    expect(injuryLevel('Questionable')).toBe('questionable')
    expect(injuryLevel('Q')).toBe('questionable')
    expect(injuryLevel('Day-To-Day')).toBe('questionable')
    expect(injuryLevel('Probable')).toBe('probable')
    expect(injuryLevel('Doubtful')).toBe('doubtful')
    expect(injuryLevel('Out')).toBe('out')
    expect(injuryLevel('IR')).toBe('out')
    expect(injuryLevel('injury reserve')).toBe('out')
    expect(injuryLevel('Suspension')).toBe('out')
    expect(injuryLevel('PUP')).toBe('out')
    expect(injuryLevel('COV')).toBe('out')
    expect(injuryLevel('Active')).toBe('clear')
    expect(injuryLevel(null)).toBeNull()
    expect(injuryLevel('Achilles')).toBeNull()
  })
})

describe('easternDate', () => {
  it('is the US-Eastern calendar date: a 7:30 pm ET tip-off stored at 00:30Z belongs to the day before', () => {
    expect(easternDate(at('2026-11-22T00:30:00Z'))).toBe('2026-11-21')
    expect(easternDate(at('2026-11-22T17:00:00Z'))).toBe('2026-11-22')
  })
})

describe('mergeInjuryCapture', () => {
  const kick = new Map([['BUF', at('2026-11-22T18:00:00Z')], ['KC', at('2026-11-22T18:00:00Z')], ['DAL', at('2026-11-24T01:15:00Z')]])
  const P = nflPeriod(2026, 12)

  it('freezes a team at its kickoff: later captures never touch its players', () => {
    const friday = mergeInjuryCapture(null, {
      sport: 'NFL', period: P, at: at('2026-11-21T20:00:00Z'), kickoffs: kick,
      designations: new Map([['1', { level: 'questionable', team: 'BUF' }], ['2', { level: 'doubtful', team: 'DAL' }]]),
    })
    // Sunday evening: BUF has kicked off. Player 1 is now "Out" (hurt IN the game) — that must not reach the snapshot.
    const sunday = mergeInjuryCapture(friday, {
      sport: 'NFL', period: P, at: at('2026-11-22T21:00:00Z'), kickoffs: kick,
      designations: new Map([['1', { level: 'out', team: 'BUF' }]]),
    })
    expect(sunday.players['1']).toEqual({ level: 'questionable', team: 'BUF' })
    expect(sunday.teams.BUF.capturedAt).toBe('2026-11-21T20:00:00.000Z')
    // DAL has not kicked off and player 2 was cleared since: he drops out, and DAL is re-captured.
    expect(sunday.players['2']).toBeUndefined()
    expect(sunday.teams.DAL.capturedAt).toBe('2026-11-22T21:00:00.000Z')
  })

  it('a team first seen after its kickoff is not captured at all (no level, not "clear")', () => {
    const late = mergeInjuryCapture(null, { sport: 'NFL', period: P, at: at('2026-11-22T21:00:00Z'), kickoffs: kick, designations: new Map() })
    expect(late.teams.BUF).toBeUndefined()
    expect(snapshotLevelFor(late, '1', 'BUF')).toBeUndefined()
    expect(snapshotLevelFor(late, '9', 'DAL')).toBe('clear')
  })

  it('a new period (or another sport) starts clean rather than carrying the last one forward', () => {
    const w11 = mergeInjuryCapture(null, { sport: 'NFL', period: nflPeriod(2026, 11), at: at('2026-11-14T20:00:00Z'), kickoffs: kick, designations: new Map([['1', { level: 'questionable', team: 'BUF' }]]) })
    expect(mergeInjuryCapture(w11, { sport: 'NFL', period: P, at: at('2026-11-21T20:00:00Z'), kickoffs: kick, designations: new Map() }).players['1']).toBeUndefined()
    expect(mergeInjuryCapture(w11, { sport: 'NBA', period: nflPeriod(2026, 11), at: at('2026-11-14T20:00:00Z'), kickoffs: new Map(), designations: new Map() }).players['1']).toBeUndefined()
  })
})

describe('snapshotLevelFor', () => {
  const snap: InjurySnapshot = {
    sport: 'NFL', period: '2026:12', capturedAt: '', teams: { BUF: { kickoffAt: '', capturedAt: '' } },
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

function fakeDb(opts: { games: unknown[]; next?: unknown; injuries: unknown[]; roster: unknown[]; prior?: InjurySnapshot[] }) {
  const upsert = vi.fn().mockResolvedValue({})
  return {
    upsert,
    db: {
      sportsGame: { findFirst: vi.fn().mockResolvedValue(opts.next ?? null), findMany: vi.fn().mockResolvedValue(opts.games) },
      sportsDataCache: {
        findMany: vi.fn().mockResolvedValue((opts.prior ?? []).map((p) => ({ cacheKey: INJURY_SNAPSHOT_KEY(p.sport, p.period), data: p }))),
        upsert,
      },
      sportsInjury: { findMany: vi.fn().mockResolvedValue(opts.injuries) },
      playerIdentityMap: { findMany: vi.fn().mockResolvedValue(opts.roster) },
    },
  }
}

describe('captureInjurySnapshot — NFL (weekly, Sleeper ids)', () => {
  const base = {
    next: { season: 2026, week: 12, seasonType: 'regular' },
    games: [{ homeTeam: 'Buffalo Bills', awayTeam: 'Kansas City Chiefs', startTime: at('2026-11-22T18:00:00Z') }],
    injuries: [
      // Friday's Questionable, then Sunday morning's Active from another source: the newest claim wins.
      { playerName: 'Josh Allen', team: 'BUF', position: 'QB', status: 'Questionable', date: at('2026-11-20T20:00:00Z'), fetchedAt: at('2026-11-22T15:00:00Z') },
      { playerName: 'Josh Allen', team: 'Buffalo Bills', position: 'QB', status: 'Active', date: at('2026-11-22T14:00:00Z'), fetchedAt: at('2026-11-22T14:30:00Z') },
      { playerName: 'Travis Kelce', team: 'Kansas City Chiefs', position: 'TE', status: 'Doubtful', date: at('2026-11-21T20:00:00Z'), fetchedAt: at('2026-11-22T14:30:00Z') },
    ],
    roster: [
      { id: 'u1', sleeperId: '4984', canonicalName: 'Josh Allen', currentTeam: 'BUF', position: 'QB' },
      { id: 'u2', sleeperId: '1466', canonicalName: 'Travis Kelce', currentTeam: 'KC', position: 'TE' },
    ],
  }

  it('captures designations by Sleeper id for teams not yet kicked off', async () => {
    const { db, upsert } = fakeDb(base)
    const tick = await captureInjurySnapshot(db as never, 'NFL', { now: at('2026-11-22T16:00:00Z') })
    expect(tick).toMatchObject({ sport: 'NFL', status: 'captured', periods: ['2026:12'], openTeams: 2, designated: 1 })
    const written = upsert.mock.calls[0]![0].create
    expect(written.cacheKey).toBe(INJURY_SNAPSHOT_KEY('NFL', '2026:12'))
    expect(written.data.players).toEqual({ '1466': { level: 'doubtful', team: 'KC' } })
    expect(Object.keys(written.data.teams).sort()).toEqual(['BUF', 'KC'])
  })

  it('waits 30 minutes between captures', async () => {
    const prior: InjurySnapshot = { sport: 'NFL', period: '2026:12', capturedAt: '2026-11-22T15:50:00.000Z', teams: {}, players: {} }
    const { db, upsert } = fakeDb({ ...base, prior: [prior] })
    expect(await captureInjurySnapshot(db as never, 'NFL', { now: at('2026-11-22T16:00:00Z') })).toEqual({ sport: 'NFL', status: 'fresh', periods: ['2026:12'] })
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('captureInjurySnapshot — NBA (daily, identity ids, full team names)', () => {
  it('keys players by identity id and periods by the US-Eastern game date', async () => {
    // Names as our feeds store them: the schedule's codes, identity rows' upper-case names, injuries' proper case.
    expect(projectionTeamKey('NBA', 'MILWAUKEE BUCKS')).toBe(projectionTeamKey('NBA', 'MIL'))
    const { db, upsert } = fakeDb({
      games: [
        { homeTeam: 'MIL', awayTeam: 'BOS', startTime: at('2026-11-23T00:30:00Z') }, // 7:30 pm ET on the 22nd
        { homeTeam: 'Milwaukee Bucks', awayTeam: 'Boston Celtics', startTime: at('2026-11-23T00:30:00Z') }, // another feed, same game
      ],
      injuries: [
        { playerName: 'Giannis Antetokounmpo', team: 'Milwaukee Bucks', position: 'F', status: 'Day-To-Day', date: at('2026-11-22T15:00:00Z'), fetchedAt: at('2026-11-22T16:00:00Z') },
        { playerName: 'Jayson Tatum', team: 'Boston Celtics', position: 'F', status: 'Probable', date: at('2026-11-22T15:00:00Z'), fetchedAt: at('2026-11-22T16:00:00Z') },
      ],
      roster: [
        { id: 'id-giannis', sleeperId: null, canonicalName: 'Giannis Antetokounmpo', currentTeam: 'MILWAUKEE BUCKS', position: 'F' },
        { id: 'id-tatum', sleeperId: null, canonicalName: 'Jayson Tatum', currentTeam: 'BOSTON CELTICS', position: 'F' },
      ],
    })
    const tick = await captureInjurySnapshot(db as never, 'NBA', { now: at('2026-11-22T17:00:00Z') })
    expect(tick).toMatchObject({ sport: 'NBA', status: 'captured', periods: ['2026-11-22'], openTeams: 2, designated: 2 })
    const written = upsert.mock.calls[0]![0].create
    expect(written.cacheKey).toBe('af-projections:injury-snapshot:NBA:2026-11-22')
    expect(written.data.players['id-giannis'].level).toBe('questionable')
    expect(written.data.players['id-tatum'].level).toBe('probable')
    expect(snapshotLevelFor(written.data, 'id-giannis', projectionTeamKey('NBA', 'MIL'))).toBe('questionable')
    expect(snapshotLevelFor(written.data, 'id-other', projectionTeamKey('NBA', 'BOS'))).toBe('clear')
  })
})

describe('captureInjurySnapshots', () => {
  it('runs every sport and contains one sport failing', async () => {
    const { db } = fakeDb({ games: [], injuries: [], roster: [] })
    db.sportsGame.findMany = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([])
    const out = await captureInjurySnapshots(db as never, { now: at('2026-11-22T17:00:00Z') })
    expect(out.map((o) => o.sport)).toEqual(['NFL', 'NBA', 'NHL'])
    expect(out[1]).toMatchObject({ sport: 'NBA', status: 'error', error: 'boom' })
    expect(out[2]).toMatchObject({ sport: 'NHL', status: 'no_games' })
  })
})

describe('the injury factor in the learner', () => {
  it('is a factor with clear as its baseline, and is learned and explained like the others', () => {
    expect(FACTOR_LEVELS.injury).toEqual(['clear', 'probable', 'questionable', 'doubtful'])
    const obs: FactorObservation[] = []
    const t0 = Date.UTC(2025, 8, 1)
    for (let i = 0; i < 1200; i++) {
      const q = i % 4 === 0
      // Questionable players score ~85% of their trailing average; clear ones score it.
      obs.push({ baseline: 10, actual: q ? 8.5 + ((i % 3) - 1) * 0.2 : 10 + ((i % 5) - 2) * 0.3, levels: { injury: q ? 'questionable' : 'clear' }, atMs: t0 + i * 3_600_000 })
    }
    const table = learnFactors('NBA', obs, new Date(t0 + 1300 * 3_600_000))
    const q = table.levels.find((l) => l.factor === 'injury' && l.level === 'questionable')!
    expect(q.multiplier).toBeCloseTo(0.85, 1)
    expect(q.published).toBe(true)
    expect(factorReason(q)).toMatch(/^listed Questionable or day-to-day before the game -15%/)
  })
})
