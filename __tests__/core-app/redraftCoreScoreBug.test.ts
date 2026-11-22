/**
 * Redraft batch B3 (/core Matchup + Live scores): the pure mappings behind the score bugs.
 * lib/core-app/redraftCoreScoreBug.ts.
 */
import { describe, expect, it } from 'vitest'
import { cleanPeriodLabel, liveGameBug, playerGameMark } from '@/lib/core-app/redraftCoreScoreBug'

const live = (sport: string, clockLabel: string | null, statusDetail = '') => ({ sport, isLive: true, completed: false, clockLabel, statusDetail })

describe('cleanPeriodLabel — the server label, per sport, never a period zero', () => {
  it.each([
    ['NFL', 'Q3 · 8:42', 'Q3 · 8:42'],
    ['NCAAF', 'Q2 · 1:15', 'Q2 · 1:15'],
    ['NBA', 'Q4 · 2:31', 'Q4 · 2:31'],
    ['NCAAB', '2H · 8:12', '2H · 8:12'],
    ['NHL', 'P2 · 12:41', 'P2 · 12:41'],
    ['MLB', 'Bot 6th', 'Bot 6th'],
    ['SOCCER', "2H · 67'", "2H · 67'"],
  ])('%s keeps %s', (sport, label, want) => {
    expect(cleanPeriodLabel(sport, label)).toBe(want)
  })

  it.each(['Q0', 'Q0 · 15:00', 'P0 · 20:00', 'Inn 0', '0H', '0OT · 5:00'])('drops the placeholder "%s"', (label) => {
    expect(cleanPeriodLabel('NFL', label)).toBeNull()
  })

  it('does not mistake a real tenth for a zero ("Q10" is not "Q0")', () => {
    expect(cleanPeriodLabel('NFL', 'P10')).toBe('P10')
  })

  it('NHL: the fourth period is OT; a fifth stays as sent (shootout or 2OT — the row cannot say)', () => {
    expect(cleanPeriodLabel('NHL', 'P4 · 3:10')).toBe('OT · 3:10')
    expect(cleanPeriodLabel('NHL', 'P4')).toBe('OT')
    expect(cleanPeriodLabel('NHL', 'P5')).toBe('P5')
    // Only NHL: a football "P4" (never produced, but) is not rewritten.
    expect(cleanPeriodLabel('NFL', 'P4')).toBe('P4')
  })

  it('empty and missing are null', () => {
    expect(cleanPeriodLabel('NFL', null)).toBeNull()
    expect(cleanPeriodLabel('NFL', '   ')).toBeNull()
  })
})

describe('liveGameBug — tone, lead word and label', () => {
  it('live: LIVE + the cleaned clock label', () => {
    expect(liveGameBug(live('NHL', 'P4 · 3:10'))).toEqual({ tone: 'live', word: 'LIVE', label: 'OT · 3:10' })
  })

  it('live with a period-zero clock falls back to the status text, then to no label — never "Q0"', () => {
    expect(liveGameBug(live('NFL', 'Q0 · 15:00', 'Halftime'))).toEqual({ tone: 'live', word: 'LIVE', label: 'Halftime' })
    expect(liveGameBug(live('NFL', 'Q0 · 15:00', 'Q0'))).toEqual({ tone: 'live', word: 'LIVE', label: null })
  })

  it('final: FINAL, and only the extra the feed adds ("Final/OT")', () => {
    const fin = (statusDetail: string) => liveGameBug({ sport: 'NHL', isLive: false, completed: true, clockLabel: 'FINAL', statusDetail })
    expect(fin('Final')).toEqual({ tone: 'final', word: 'FINAL', label: null })
    expect(fin('Final/OT')).toEqual({ tone: 'final', word: 'FINAL', label: 'Final/OT' })
  })

  it('upcoming: no word, the feed’s start text', () => {
    expect(liveGameBug({ sport: 'NBA', isLive: false, completed: false, clockLabel: null, statusDetail: 'Sun, 7:00 PM EST' })).toEqual({
      tone: 'upcoming',
      word: null,
      label: 'Sun, 7:00 PM EST',
    })
  })
})

describe('playerGameMark — a live board only, never for an empty or ruled-out slot', () => {
  it('maps the three known states on a live board', () => {
    for (const s of ['live', 'upcoming', 'final'] as const) expect(playerGameMark({ gameState: s }, true)).toBe(s)
  })
  it('is null before kickoff, for unknown states, empty slots and ruled-out starters', () => {
    expect(playerGameMark({ gameState: 'final' }, false)).toBeNull()
    expect(playerGameMark({ gameState: 'unknown' }, true)).toBeNull()
    expect(playerGameMark({ gameState: 'final', empty: true }, true)).toBeNull()
    expect(playerGameMark({ gameState: 'final', unavailable: 'out' }, true)).toBeNull()
    expect(playerGameMark(null, true)).toBeNull()
  })
})
