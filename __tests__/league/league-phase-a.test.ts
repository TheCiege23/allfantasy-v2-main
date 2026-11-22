import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { injuryTag, injuryTone } from '@/lib/injuries/afInjuryTag'
import { afSideTotal } from '@/lib/matchup-center/afProjections'
import { afWinProbability, yetToPlayPositions } from '@/app/league/[leagueId]/tabs/team-tab-matchup-banner'
import type { MatchupPlayerSlot, MatchupSidePayload } from '@/lib/matchup-center/types'

const slot = (position: string, gameStatus: MatchupPlayerSlot['gameStatus'], af: number | null): MatchupPlayerSlot => ({
  playerId: position + gameStatus + String(af), name: 'x', position, team: null, opponent: null, headshotUrl: null,
  currentPoints: 0, projectedPoints: 10, hasRealProjection: true, afProjectedPoints: af, injuryStatus: null,
  newsBlurb: null, weatherSummary: null, gameStatus, gameLabel: '', aiInsight: null,
})
const side = (starters: MatchupPlayerSlot[]): MatchupSidePayload => {
  const af = afSideTotal(starters)
  return {
    rosterId: 'r', teamName: 't', avatarUrl: null, record: { wins: 0, losses: 0, ties: 0 }, winPct: 0,
    totalPoints: 0, projectedTotal: 40, projectedTotalIncludesFallback: false,
    afProjectedTotal: af.total, afProjectedFrom: af.from, starters, remainingStarters: 0,
  }
}

describe('injuryTag (one implementation for /core and the league page)', () => {
  it('keeps /core’s labels', () => {
    expect(['Questionable', 'Doubtful', 'Day-To-Day', 'Probable', 'Suspended indefinitely'].map(injuryTag)).toEqual(['Q', 'D', 'DTD', 'P', 'SUSP'])
  })
  it('shortens injured reserve to IR and keeps OUT / PUP', () => {
    expect(['Injured Reserve', 'IR', 'Out', 'PUP'].map(injuryTag)).toEqual(['IR', 'IR', 'OUT', 'PUP'])
  })
  it('never draws an uncertainty in the red of OUT', () => {
    expect(['P', 'Q', 'DTD', 'D', 'OUT', 'IR', 'SUSP'].map(injuryTone)).toEqual(['ok', 'warn', 'warn', 'risk', 'out', 'out', 'out'])
  })
})

describe('afSideTotal', () => {
  it('sums only starters that have an AF number and says how many', () => {
    expect(afSideTotal([slot('QB', 'upcoming', 20), slot('RB', 'upcoming', null), slot('WR', 'upcoming', 12.5)])).toEqual({ total: 32.5, from: 2 })
  })
  it('is null when no starter has one, never zero', () => {
    expect(afSideTotal([slot('QB', 'upcoming', null)])).toEqual({ total: null, from: 0 })
  })
})

describe('afWinProbability', () => {
  it('compares AF totals when AF covers every starter on both sides', () => {
    const p = afWinProbability(side([slot('QB', 'upcoming', 30)]), side([slot('QB', 'upcoming', 70)]))
    expect(p).toBeCloseTo(0.3)
  })
  it('gives no number when either side is only partly covered', () => {
    expect(afWinProbability(side([slot('QB', 'upcoming', 30), slot('RB', 'upcoming', null)]), side([slot('QB', 'upcoming', 70)]))).toBeNull()
  })
})

describe('yetToPlayPositions', () => {
  it('groups unfinished starters by position', () => {
    const s = side([slot('QB', 'upcoming', 1), slot('RB', 'live', 1), slot('RB', 'upcoming', 1), slot('WR', 'final', 1)])
    expect(yetToPlayPositions(s)).toBe('QB, 2 RB')
  })
})
