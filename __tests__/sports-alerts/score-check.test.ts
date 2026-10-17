// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { checkFinalScore, isFinalStatus, type ScoreRow } from '@/lib/social-newsroom/scoreCheck'

// The resolver maps every spelling a provider uses onto one code, as the real team index does.
const CODES: Record<string, string> = {
  'Los Angeles Clippers': 'LAC',
  LAC: 'LAC',
  'Denver Nuggets': 'DEN',
  DEN: 'DEN',
  'Colorado Avalanche': 'COL',
  COL: 'COL',
  'Dallas Stars': 'DAL',
  DAL: 'DAL',
}
const resolve = (n: string) => CODES[n] ?? null

function row(over: Partial<ScoreRow>): ScoreRow {
  return { source: 'thesportsdb', homeTeam: '', awayTeam: '', homeScore: null, awayScore: null, startTime: new Date('2026-10-15T02:30:00Z'), status: 'FT', ...over }
}

describe('checkFinalScore — real rows from 2026-10-15', () => {
  it('flags Nuggets at Clippers, where two providers swapped the scores', () => {
    const tsdb = row({ homeTeam: 'Los Angeles Clippers', awayTeam: 'Denver Nuggets', homeScore: 110, awayScore: 122 })
    const espn = row({ source: 'espn_live', homeTeam: 'LAC', awayTeam: 'DEN', homeScore: 122, awayScore: 110, status: 'final' })
    expect(checkFinalScore(tsdb, [tsdb, espn], resolve)).toBe('conflict')
  })

  it('confirms Stars at Avalanche, where both providers agree', () => {
    const start = new Date('2026-10-15T00:30:00Z')
    const tsdb = row({ homeTeam: 'Colorado Avalanche', awayTeam: 'Dallas Stars', homeScore: 2, awayScore: 3, status: 'AP', startTime: start })
    const espn = row({ source: 'espn_live', homeTeam: 'COL', awayTeam: 'DAL', homeScore: 2, awayScore: 3, status: 'final', startTime: start })
    expect(checkFinalScore(tsdb, [tsdb, espn], resolve)).toBe('confirmed')
  })

  it('a provider listing home and away the other way round, with the same result, agrees', () => {
    const tsdb = row({ homeTeam: 'Los Angeles Clippers', awayTeam: 'Denver Nuggets', homeScore: 110, awayScore: 122 })
    const flipped = row({ source: 'espn', homeTeam: 'DEN', awayTeam: 'LAC', homeScore: 122, awayScore: 110, status: 'final' })
    expect(checkFinalScore(tsdb, [flipped], resolve)).toBe('confirmed')
  })

  it('one provider only is "single"; a non-final or far-off row from another provider is ignored', () => {
    const tsdb = row({ homeTeam: 'Los Angeles Clippers', awayTeam: 'Denver Nuggets', homeScore: 110, awayScore: 122 })
    const live = row({ source: 'espn_live', homeTeam: 'LAC', awayTeam: 'DEN', homeScore: 50, awayScore: 48, status: 'in_progress' })
    const nextDay = row({ source: 'espn', homeTeam: 'LAC', awayTeam: 'DEN', homeScore: 99, awayScore: 98, status: 'final', startTime: new Date('2026-10-16T02:30:00Z') })
    expect(checkFinalScore(tsdb, [tsdb, live, nextDay], resolve)).toBe('single')
  })

  it('reads every stored final status, and not the others', () => {
    for (const s of ['final', 'FT', 'AOT', 'AP']) expect(isFinalStatus(s)).toBe(true)
    for (const s of ['NS', 'scheduled', 'in_progress', null]) expect(isFinalStatus(s)).toBe(false)
  })
})
