import { describe, expect, it } from 'vitest'
import {
  byeWindowVerdict,
  describeOpenSlotsAhead,
  detectPositionRuns,
  openStarterSlotsAhead,
  picksUntilNextTurn,
} from '@/lib/draft-helper/draftContextSignals'
import { computeDraftRecommendation, type RecommendationInput } from '@/lib/draft-helper/RecommendationEngine'

/*
 * Draft-context signals (2026-11-14). The scenario is the owner's own: a KBI tournament redraft
 * drafted in week 10 whose stage scores weeks 11–12, so a week-11 or week-12 bye is a lost half of
 * the stage, and a bye already played is the safe choice.
 */

const KBI_WINDOW = { startWeek: 11, endWeek: 12, label: 'KBI round 2' }

describe('byeWindowVerdict', () => {
  it('penalises a bye inside the window, scaled to the window length', () => {
    const twoWeek = byeWindowVerdict(11, KBI_WINDOW)
    const season = byeWindowVerdict(11, { startWeek: 1, endWeek: null })
    expect(twoWeek.status).toBe('in_window')
    expect(season.status).toBe('in_window')
    expect(twoWeek.score).toBeLessThan(season.score)
  })

  it('rewards a bye already played, ignores one after the window, and is neutral when unknown', () => {
    expect(byeWindowVerdict(7, KBI_WINDOW)).toEqual({ status: 'played', score: 2 })
    expect(byeWindowVerdict(14, KBI_WINDOW)).toEqual({ status: 'after_window', score: 0 })
    expect(byeWindowVerdict(null, KBI_WINDOW)).toEqual({ status: 'unknown', score: 0 })
    expect(byeWindowVerdict(11, null)).toEqual({ status: 'unknown', score: 0 })
  })
})

describe('the engine with a scoring window', () => {
  const base: RecommendationInput = {
    available: [
      // Slightly better by ADP, but on bye in week 11 — half of a two-week stage.
      { name: 'Week Eleven Bye', position: 'WR', team: 'AAA', adp: 60, byeWeek: 11 },
      { name: 'Bye Played', position: 'WR', team: 'BBB', adp: 63, byeWeek: 7 },
    ],
    teamRoster: [{ position: 'QB' }, { position: 'RB' }, { position: 'RB' }, { position: 'WR' }],
    rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
    round: 4,
    pick: 16,
    totalTeams: 16,
    sport: 'NFL',
  }

  it('without a window the ADP leader wins (unchanged behaviour)', () => {
    expect(computeDraftRecommendation(base).recommendation?.player.name).toBe('Week Eleven Bye')
  })

  it('with the KBI window the player whose bye is already played wins, and says why', () => {
    const r = computeDraftRecommendation({ ...base, scoringWindow: KBI_WINDOW })
    expect(r.recommendation?.player.name).toBe('Bye Played')
    expect(r.recommendation?.reason).toContain('bye already played')
    expect(r.scoringWindowInsight).toContain('KBI round 2 (weeks 11–12)')
    expect(r.scoringWindowInsight).toContain('Week Eleven Bye, wk 11')
  })
})

describe('position runs', () => {
  it('detects a run in the last half round', () => {
    const recent = ['RB', 'QB', 'WR', 'WR', 'TE', 'WR', 'WR', 'RB']
    expect(detectPositionRuns(recent, 16)).toEqual([{ position: 'WR', count: 4, window: 8 }])
  })

  it('ignores an ordinary spread and a short history', () => {
    expect(detectPositionRuns(['RB', 'WR', 'QB', 'TE', 'RB', 'WR', 'QB', 'TE'], 16)).toEqual([])
    expect(detectPositionRuns(['WR', 'WR', 'WR'], 16)).toEqual([])
  })

  it('a run at a needed position moves it up and is named', () => {
    const r = computeDraftRecommendation({
      available: [
        { name: 'Back', position: 'RB', adp: 50 },
        { name: 'Catcher', position: 'WR', adp: 52 },
      ],
      teamRoster: [{ position: 'QB' }, { position: 'RB' }, { position: 'RB' }],
      rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR'],
      round: 4,
      pick: 2,
      totalTeams: 16,
      sport: 'NFL',
      recentPickPositions: ['WR', 'WR', 'RB', 'WR', 'WR', 'QB', 'WR', 'TE'],
    })
    expect(r.runInsight).toContain('Run on WR (5 of the last 8 picks)')
    expect(r.recommendation?.player.name).toBe('Catcher')
  })
})

describe('teams picking before your next turn (facts, not labels)', () => {
  it('counts snake picks to the next turn', () => {
    // 16-team snake: slot 16 picks 4.01 (overall 49) and next 5.16 (overall 80).
    expect(picksUntilNextTurn({ currentOverall: 49, targetSlot: 16, totalTeams: 16, snake: true })).toBe(0)
    expect(picksUntilNextTurn({ currentOverall: 50, targetSlot: 16, totalTeams: 16, snake: true })).toBe(30)
    // Linear: the same slot every 16 picks.
    expect(picksUntilNextTurn({ currentOverall: 50, targetSlot: 16, totalTeams: 16, snake: false })).toBe(14)
  })

  it('counts open starting slots among the teams ahead and phrases them as counts', () => {
    const facts = openStarterSlotsAhead({
      teamsAhead: [['QB', 'RB', 'WR'], ['RB', 'RB', 'WR'], ['QB', 'WR', 'WR']],
      rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'],
    })
    expect(facts.find((f) => f.position === 'TE')).toEqual({ position: 'TE', teams: 3, of: 3 })
    expect(facts.find((f) => f.position === 'QB')).toEqual({ position: 'QB', teams: 1, of: 3 })
    const text = describeOpenSlotsAhead(facts, 3)!
    expect(text).toContain('3 of 3 still need a starting TE')
    expect(text).not.toMatch(/will (take|draft|pick)/i)
  })
})
