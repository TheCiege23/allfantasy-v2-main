/**
 * Live Scoring engine — deterministic unit tests (G11 Phase 7, engine layer).
 * Pure: no DB/app. Covers cadence, pace projection, win probability, and the
 * incremental rescore planner — the reusable core every league concept inherits.
 */
import { describe, expect, it } from 'vitest'
import {
  resolvePollCadence,
  normalizeLiveGameStatus,
  LIVE_POLL_MS,
  PREGAME_POLL_MS,
  STOP_POLL_MS,
  SUSPENDED_POLL_MS,
  projectLivePlayerFinal,
  estimateWinProbability,
  planIncrementalRescore,
  diffChangedPlayers,
  type LiveGameSnapshot,
} from '@/lib/live-scoring'

const NOW = new Date('2026-09-13T18:00:00Z')
const g = (over: Partial<LiveGameSnapshot> & { gameId: string }): LiveGameSnapshot => ({
  status: 'scheduled',
  startTime: null,
  ...over,
})

describe('cadence — status normalization', () => {
  it('maps provider variants to canonical statuses', () => {
    expect(normalizeLiveGameStatus('IN_PROGRESS')).toBe('in_progress')
    expect(normalizeLiveGameStatus('Halftime')).toBe('halftime')
    expect(normalizeLiveGameStatus('Final/OT')).toBe('final')
    expect(normalizeLiveGameStatus('STATUS_SCHEDULED')).toBe('scheduled')
    expect(normalizeLiveGameStatus('PPD')).toBe('postponed')
    expect(normalizeLiveGameStatus('suspended')).toBe('suspended')
    expect(normalizeLiveGameStatus('OT')).toBe('overtime')
  })
  it('defaults unknown to scheduled (never wrongly stops or hammers)', () => {
    expect(normalizeLiveGameStatus('weird-status')).toBe('scheduled')
    expect(normalizeLiveGameStatus(null)).toBe('scheduled')
  })
})

describe('cadence — poll decision', () => {
  it('polls every 30s when any game is live', () => {
    const d = resolvePollCadence([g({ gameId: 'a', status: 'in_progress' }), g({ gameId: 'b', status: 'final' })], NOW)
    expect(d.anyLive).toBe(true)
    expect(d.nextPollDelayMs).toBe(LIVE_POLL_MS)
    expect(d.gameIdsToPoll).toContain('a')
    expect(d.gameIdsToPoll).not.toContain('b')
    expect(d.allDone).toBe(false)
  })
  it('treats halftime and overtime as live', () => {
    expect(resolvePollCadence([g({ gameId: 'a', status: 'halftime' })], NOW).nextPollDelayMs).toBe(LIVE_POLL_MS)
    expect(resolvePollCadence([g({ gameId: 'a', status: 'overtime' })], NOW).nextPollDelayMs).toBe(LIVE_POLL_MS)
  })
  it('tightens to 30s when a kickoff is imminent', () => {
    const soon = new Date(NOW.getTime() + 60_000)
    const d = resolvePollCadence([g({ gameId: 'a', status: 'scheduled', startTime: soon })], NOW)
    expect(d.reason).toBe('kickoff_imminent')
    expect(d.nextPollDelayMs).toBe(LIVE_POLL_MS)
    expect(d.gameIdsToPoll).toContain('a')
  })
  it('uses light 2m cadence for distant upcoming games', () => {
    const later = new Date(NOW.getTime() + 3 * 3600_000)
    const d = resolvePollCadence([g({ gameId: 'a', status: 'scheduled', startTime: later })], NOW)
    expect(d.nextPollDelayMs).toBe(PREGAME_POLL_MS)
    expect(d.gameIdsToPoll).not.toContain('a')
  })
  it('stops polling once every game is final/postponed', () => {
    const d = resolvePollCadence([g({ gameId: 'a', status: 'final' }), g({ gameId: 'b', status: 'postponed' })], NOW)
    expect(d.allDone).toBe(true)
    expect(d.anyActive).toBe(false)
    expect(d.nextPollDelayMs).toBe(STOP_POLL_MS)
    expect(d.gameIdsToPoll).toHaveLength(0)
  })
  it('keeps a slow heartbeat for suspended games', () => {
    const d = resolvePollCadence([g({ gameId: 'a', status: 'suspended' }), g({ gameId: 'b', status: 'final' })], NOW)
    expect(d.nextPollDelayMs).toBe(SUSPENDED_POLL_MS)
    expect(d.gameIdsToPoll).toContain('a')
  })
  it('empty schedule → stop, no_games', () => {
    const d = resolvePollCadence([], NOW)
    expect(d.nextPollDelayMs).toBe(STOP_POLL_MS)
    expect(d.reason).toBe('no_games')
  })
})

describe('projection — pace-based rest-of-game', () => {
  it('scheduled returns the full pre-game projection', () => {
    const r = projectLivePlayerFinal({ preGameProjection: 18, currentPoints: 0, status: 'scheduled' })
    expect(r.projectedFinal).toBe(18)
    expect(r.projectedRemaining).toBe(18)
  })
  it('final returns exactly current points, zero remaining', () => {
    const r = projectLivePlayerFinal({ preGameProjection: 18, currentPoints: 22.5, status: 'final' })
    expect(r.projectedFinal).toBe(22.5)
    expect(r.projectedRemaining).toBe(0)
    expect(r.paceDelta).toBe(4.5)
  })
  it('mid-game adds pre-game projection scaled by fraction remaining', () => {
    // Half over, 10 pts so far, 20 projected → +10 remaining → 20 final.
    const r = projectLivePlayerFinal({ preGameProjection: 20, currentPoints: 10, status: 'in_progress', fractionElapsed: 0.5 })
    expect(r.projectedRemaining).toBe(10)
    expect(r.projectedFinal).toBe(20)
  })
  it('outperforming player keeps current as the floor (never loses scored points)', () => {
    const r = projectLivePlayerFinal({ preGameProjection: 8, currentPoints: 14, status: 'in_progress', fractionElapsed: 0.75 })
    expect(r.projectedFinal).toBeGreaterThanOrEqual(14)
    expect(r.paceDelta).toBeGreaterThan(0)
  })
  it('overtime still projects a small remaining slice', () => {
    const r = projectLivePlayerFinal({ preGameProjection: 20, currentPoints: 19, status: 'overtime', fractionElapsed: 1 })
    expect(r.projectedRemaining).toBeGreaterThan(0)
    expect(r.projectedFinal).toBeGreaterThan(19)
  })
})

describe('win probability — variance aware', () => {
  it('is deterministic once no points remain (A leads → 1, B leads → 0, tie → 0.5)', () => {
    expect(estimateWinProbability({ currentPoints: 120, projectedRemaining: 0 }, { currentPoints: 100, projectedRemaining: 0 })).toBe(1)
    expect(estimateWinProbability({ currentPoints: 100, projectedRemaining: 0 }, { currentPoints: 120, projectedRemaining: 0 })).toBe(0)
    expect(estimateWinProbability({ currentPoints: 100, projectedRemaining: 0 }, { currentPoints: 100, projectedRemaining: 0 })).toBe(0.5)
  })
  it('a tied projection with games remaining is ~50%', () => {
    const wp = estimateWinProbability({ currentPoints: 50, projectedRemaining: 40 }, { currentPoints: 50, projectedRemaining: 40 })
    expect(wp).toBeGreaterThan(0.45)
    expect(wp).toBeLessThan(0.55)
  })
  it('a big lead with little remaining is high but clamped below 1 while live', () => {
    const wp = estimateWinProbability({ currentPoints: 130, projectedRemaining: 3 }, { currentPoints: 95, projectedRemaining: 5 })
    expect(wp).toBeGreaterThan(0.95)
    expect(wp).toBeLessThanOrEqual(0.995)
  })
  it('symmetry: WP(A,B) + WP(B,A) ≈ 1', () => {
    const a = { currentPoints: 80, projectedRemaining: 25 }
    const b = { currentPoints: 72, projectedRemaining: 30 }
    const sum = estimateWinProbability(a, b) + estimateWinProbability(b, a)
    expect(Math.abs(sum - 1)).toBeLessThan(0.01)
  })
})

describe('incremental rescore plan — only touch what changed', () => {
  const rosters = [
    { rosterId: 'r1', matchupId: 'm1', scoringPlayerIds: ['p1', 'p2'] },
    { rosterId: 'r2', matchupId: 'm1', scoringPlayerIds: ['p3', 'p4'] },
    { rosterId: 'r3', matchupId: 'm2', scoringPlayerIds: ['p5', 'p6'] },
  ]
  it('affects only rosters/matchups that start a changed player', () => {
    const plan = planIncrementalRescore({ changedPlayerIds: ['p3'], rosters })
    expect(plan.affectedRosterIds).toEqual(['r2'])
    expect(plan.affectedMatchupIds).toEqual(['m1'])
    expect(plan.noop).toBe(false)
  })
  it('a bench/unrostered player change is a no-op', () => {
    const plan = planIncrementalRescore({ changedPlayerIds: ['bench-only'], rosters })
    expect(plan.noop).toBe(true)
    expect(plan.affectedMatchupIds).toHaveLength(0)
  })
  it('standings only move when an affected matchup is final', () => {
    const live = planIncrementalRescore({ changedPlayerIds: ['p1'], rosters, matchups: [{ matchupId: 'm1', status: 'live' }] })
    expect(live.standingsImpacted).toBe(false)
    const final = planIncrementalRescore({ changedPlayerIds: ['p1'], rosters, matchups: [{ matchupId: 'm1', status: 'final' }] })
    expect(final.standingsImpacted).toBe(true)
  })
  it('empty change set is a no-op', () => {
    expect(planIncrementalRescore({ changedPlayerIds: [], rosters }).noop).toBe(true)
  })
})

describe('stat diff — idempotent / correction safe', () => {
  it('detects new, changed, and ignores unchanged stat lines', () => {
    const prev = new Map<string, unknown>([
      ['p1', { rec: 5, yds: 60 }],
      ['p2', { rush: 10, yds: 40 }],
    ])
    const next = new Map<string, unknown>([
      ['p1', { rec: 5, yds: 60 }], // unchanged
      ['p2', { rush: 12, yds: 55 }], // changed (correction)
      ['p3', { rec: 1, yds: 8 }], // new
    ])
    expect(diffChangedPlayers(prev, next).sort()).toEqual(['p2', 'p3'])
  })
  it('identical snapshots produce no work (idempotent poll)', () => {
    const snap = new Map<string, unknown>([['p1', { pts: 10 }]])
    expect(diffChangedPlayers(snap, snap)).toEqual([])
  })

  it('is key-order insensitive (Postgres JSONB reorders keys → must not false-diff)', () => {
    const prev = new Map<string, unknown>([['p1', { pass_td: 2, pass_yds: 300 }]]) // DB order
    const next = new Map<string, unknown>([['p1', { pass_yds: 300, pass_td: 2 }]]) // provider order
    expect(diffChangedPlayers(prev, next)).toEqual([])
    // a real value change is still detected regardless of order
    const corrected = new Map<string, unknown>([['p1', { pass_yds: 300, pass_td: 3 }]])
    expect(diffChangedPlayers(prev, corrected)).toEqual(['p1'])
  })
})
