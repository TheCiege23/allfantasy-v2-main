import { describe, expect, it } from 'vitest'

import {
  adjustForPickOwnership,
  buildLineupReportText,
  lineupIntegrityPattern,
  lowWeekRun,
  pickOwnershipNote,
  scoreLineupWeek,
  summarizeTeamScores,
  type SnapshotPlayer,
} from '@/lib/integrity/lineupIntegrityScore'
import { mergeSnapshotPlayers } from '@/lib/integrity/lineupLockSnapshotMerge'

const SLOTS = [
  { slot: 'QB', eligible: ['QB'] },
  { slot: 'RB', eligible: ['RB'] },
  { slot: 'WR', eligible: ['WR'] },
  { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'] },
]

function roster(extra: Record<string, SnapshotPlayer> = {}): Record<string, SnapshotPlayer> {
  return {
    qb1: { position: 'QB', proj: 20 },
    qb2: { position: 'QB', proj: 12 },
    rb1: { position: 'RB', proj: 15 },
    rb2: { position: 'RB', proj: 8 },
    wr1: { position: 'WR', proj: 14 },
    wr2: { position: 'WR', proj: 10 },
    ...extra,
  }
}

describe('scoreLineupWeek', () => {
  it('scores the best lineup as 100% and names every starter as top', () => {
    const s = scoreLineupWeek({ week: 5, players: roster(), slots: SLOTS, starterIds: ['qb1', 'rb1', 'wr1', 'wr2'] })
    expect(s).toMatchObject({ scored: true, startedProj: 59, optimalProj: 59, ratio: 1, startedTopCount: 4, starterCount: 4 })
  })

  it('scores a weaker lineup against the best one', () => {
    const s = scoreLineupWeek({ week: 5, players: roster(), slots: SLOTS, starterIds: ['qb2', 'rb2', 'wr1', 'wr2'] })
    if (!s.scored) throw new Error('expected a score')
    expect(s.startedProj).toBe(44)
    expect(s.optimalProj).toBe(59)
    expect(s.ratio).toBeCloseTo(44 / 59)
    expect(s.startedTopCount).toBe(2)
  })

  it('leaves a player who could not play out of the best lineup, and counts him zero when started', () => {
    // rb1 is OUT: the best lineup without him is qb1 + rb2 + wr1 + wr2 = 52.
    const players = roster({ rb1: { position: 'RB', proj: 15, status: 'Out' } })
    const benched = scoreLineupWeek({ week: 5, players, slots: SLOTS, starterIds: ['qb1', 'rb2', 'wr1', 'wr2'] })
    expect(benched).toMatchObject({ scored: true, ratio: 1, optimalProj: 52, excludedIds: ['rb1'] })
    const started = scoreLineupWeek({ week: 5, players, slots: SLOTS, starterIds: ['qb1', 'rb1', 'wr1', 'wr2'] })
    if (!started.scored) throw new Error('expected a score')
    expect(started.startedProj).toBe(44)
  })

  it('treats a bye-week player as unable to play', () => {
    const players = roster({ qb1: { position: 'QB', proj: 20, bye: 5 } })
    const s = scoreLineupWeek({ week: 5, players, slots: SLOTS, starterIds: ['qb2', 'rb1', 'wr1', 'wr2'] })
    expect(s).toMatchObject({ scored: true, ratio: 1, excludedIds: ['qb1'] })
  })

  it('refuses to score a week with too few projections', () => {
    const players = roster({ rb1: { position: 'RB' }, rb2: { position: 'RB' } })
    expect(scoreLineupWeek({ week: 5, players, slots: SLOTS, starterIds: ['qb1'] })).toEqual({ scored: false, skipReason: 'thin_projections' })
  })

  it('refuses to score a team with no saved lineup', () => {
    expect(scoreLineupWeek({ week: 5, players: roster(), slots: SLOTS, starterIds: [] })).toEqual({ scored: false, skipReason: 'no_lineup' })
  })
})

describe('the pattern rule', () => {
  it('needs consecutive scored weeks under the line, and steps over unscored weeks', () => {
    expect(lowWeekRun([{ week: 3, ratio: 0.7 }, { week: 4, ratio: null }, { week: 5, ratio: 0.8 }], 0.85)).toEqual([3, 5])
    expect(lowWeekRun([{ week: 3, ratio: 0.7 }, { week: 4, ratio: 0.95 }, { week: 5, ratio: 0.8 }], 0.85)).toEqual([5])
  })

  it('one bad week is never a pattern, at any sensitivity', () => {
    for (const s of ['low', 'medium', 'high'] as const) {
      expect(lineupIntegrityPattern([{ week: 4, ratio: 1 }, { week: 5, ratio: 0.2 }], s).pattern).toBe(false)
    }
  })

  it('medium flags two weeks under 85%; low needs three under 80%; high flags two under 90%', () => {
    const two = [{ week: 4, ratio: 0.82 }, { week: 5, ratio: 0.83 }]
    expect(lineupIntegrityPattern(two, 'medium').pattern).toBe(true)
    expect(lineupIntegrityPattern(two, 'low').pattern).toBe(false)
    expect(lineupIntegrityPattern([{ week: 3, ratio: 0.7 }, ...two.map((w) => ({ ...w, ratio: 0.75 }))], 'low').pattern).toBe(true)
    expect(lineupIntegrityPattern([{ week: 4, ratio: 0.88 }, { week: 5, ratio: 0.89 }], 'high').pattern).toBe(true)
    expect(lineupIntegrityPattern([{ week: 4, ratio: 0.88 }, { week: 5, ratio: 0.89 }], 'medium').pattern).toBe(false)
  })
})

describe('pick ownership', () => {
  it('lowers the risk one level only when the team does not own its own first', () => {
    expect(adjustForPickOwnership('high', false)).toBe('medium')
    expect(adjustForPickOwnership('medium', false)).toBe('low')
    expect(adjustForPickOwnership('low', false)).toBe('low')
    expect(adjustForPickOwnership('high', true)).toBe('high')
    expect(adjustForPickOwnership('high', null)).toBe('high')
  })

  it('says why, and says nothing when the league has no picks', () => {
    expect(pickOwnershipNote(false, 2027)).toMatch(/Does not own its own 2027 first-round pick/)
    expect(pickOwnershipNote(true, 2027)).toMatch(/Owns its own 2027 first-round pick/)
    expect(pickOwnershipNote(null, 2027)).toBeNull()
  })
})

describe('the report', () => {
  it('reads as one line per week a commissioner can post', () => {
    const weeks = [
      { week: 4, ratio: 1, startedTopCount: 9, starterCount: 9 },
      { week: 5, ratio: null, startedTopCount: null, starterCount: null },
      { week: 6, ratio: 0.9, startedTopCount: 8, starterCount: 9 },
    ]
    const text = buildLineupReportText({ teamName: 'Gridiron Gang', season: 2026, weeks })
    expect(text).toContain('Week 4: started 9 of 9 highest-projected players (100% of the best possible projection).')
    expect(text).toContain('Week 5: not scored')
    expect(text).toContain('Season: 95%')
    expect(summarizeTeamScores(weeks)).toMatchObject({ weeksScored: 2, fullWeeks: 1, lowestWeek: { week: 6, ratio: 0.9 } })
  })
})

describe('mergeSnapshotPlayers — freezing at kickoff', () => {
  const NOW = '2026-11-08T18:00:00.000Z'

  it('refreshes a player whose game has not started', () => {
    const prior = { a: { proj: 10, status: null, frozenAt: null } }
    const out = mergeSnapshotPlayers({ prior, current: { a: { proj: 12, status: null, frozenAt: null } }, lockedIds: new Set(), nowIso: NOW })
    expect(out).toEqual({ changed: true, players: { a: { proj: 12, status: null, frozenAt: null } } })
  })

  it('freezes a player at kickoff with the reading he had, and never changes him again', () => {
    const prior = { a: { proj: 10, status: 'Questionable', frozenAt: null } }
    const kickoff = mergeSnapshotPlayers({ prior, current: { a: { proj: 3, status: 'Out', frozenAt: null } }, lockedIds: new Set(['a']), nowIso: NOW })
    expect(kickoff.players.a).toEqual({ proj: 10, status: 'Questionable', frozenAt: NOW })
    const later = mergeSnapshotPlayers({ prior: kickoff.players, current: { a: { proj: 0, status: 'IR', frozenAt: null } }, lockedIds: new Set(['a']), nowIso: '2026-11-09T02:00:00.000Z' })
    expect(later).toEqual({ changed: false, players: kickoff.players })
  })

  it('captures a player first seen already locked once, and freezes him', () => {
    const out = mergeSnapshotPlayers({ prior: {}, current: { a: { proj: 7, frozenAt: null } }, lockedIds: new Set(['a']), nowIso: NOW })
    expect(out.players.a).toEqual({ proj: 7, frozenAt: NOW })
  })

  it('keeps a player who left the roster, and writes nothing when nothing moved', () => {
    const prior = { gone: { proj: 9, frozenAt: NOW }, a: { proj: 5, frozenAt: null } }
    const out = mergeSnapshotPlayers({ prior, current: { a: { proj: 5, frozenAt: null } }, lockedIds: new Set(), nowIso: NOW })
    expect(out).toEqual({ changed: false, players: prior })
  })
})
