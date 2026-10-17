import { describe, expect, it } from 'vitest'
import { buildMatchupStrip, describeRemaining, nextStripState } from '@/lib/live/matchupStrip'
import type { MatchupData } from '@/lib/core-app/matchup'

const team = (teamName: string, isYou: boolean) => ({ teamName, ownerName: '', record: null, isYou, avatarUrl: null })
const side = (teamName: string, points: number, isYou: boolean) => ({ ...team(teamName, isYou), points })

function data(over: Partial<MatchupData> = {}): MatchupData {
  return {
    league: { id: 'L', name: 'L', platform: 'sleeper', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 4, season: 2026, isFinal: false } },
    teams: { available: true, data: { you: team('Me', true), opponent: team('Them', false) } },
    sides: { available: true, data: { you: side('Me', 80.5, true), opponent: side('Them', 70, false) } },
    lineups: { available: false, reason: 'x' },
    identityNote: null,
    playerScoring: { available: false, reason: 'x' },
    winProbability: { available: true, data: { pWin: 0.63, projectedMargin: 5, confidence: 'm', detail: '' } },
    projectedFinal: { available: false, reason: 'x' },
    yetToPlay: { available: false, reason: 'x' },
    starterCounts: { upcoming: 3, live: 2, final: 5, unknown: 0 },
    starterCountsBySide: {
      you: { upcoming: 1, live: 1, final: 3, unknown: 0 },
      opponent: { upcoming: 2, live: 1, final: 2, unknown: 0 },
    },
    ...over,
  } as MatchupData
}

describe('buildMatchupStrip', () => {
  it('says a failed read is a failure, even with data in hand', () => {
    expect(buildMatchupStrip(null, true)).toEqual({ kind: 'failed' })
    expect(buildMatchupStrip(data(), true)).toEqual({ kind: 'failed' })
  })
  it('renders nothing when no matchup resolved', () => {
    expect(buildMatchupStrip(null)).toBeNull()
  })
  it('reports margin, win probability and remaining starters', () => {
    const s = buildMatchupStrip(data())
    expect(s).toMatchObject({ kind: 'scored', margin: 10.5, pWin: 0.63, remaining: { you: { upcoming: 1, live: 1 }, opponent: { upcoming: 2, live: 1 } } })
  })
  it('never presents an unscored week as 0-0', () => {
    const s = buildMatchupStrip(data({ sides: { available: false, reason: 'unplayed' } }))
    expect(s).toEqual({ kind: 'scheduled', week: 4, you: 'Me', opponent: 'Them' })
  })
  it('gives the reason when teams cannot be identified', () => {
    const s = buildMatchupStrip(
      data({ teams: { available: false, reason: 'n' }, sides: { available: false, reason: 'cannot tell your team' } }),
    )
    expect(s).toEqual({ kind: 'unavailable', reason: 'cannot tell your team' })
  })
  it('omits remaining and pWin rather than guessing', () => {
    const s = buildMatchupStrip(
      data({
        starterCounts: { upcoming: 3, live: 2, final: 4, unknown: 1 },
        starterCountsBySide: {
          you: { upcoming: 1, live: 1, final: 3, unknown: 0 },
          opponent: { upcoming: 2, live: 1, final: 1, unknown: 1 },
        },
        winProbability: { available: false, reason: 'x' },
      }),
    )
    // One side with an unknown game state is unknown on its own; the other side still counts.
    expect(s).toMatchObject({ kind: 'scored', pWin: null, remaining: { you: { upcoming: 1, live: 1 }, opponent: null } })
    expect(buildMatchupStrip(data({ starterCountsBySide: null }))).toMatchObject({ remaining: null })
  })
})

describe('nextStripState', () => {
  const good = buildMatchupStrip(data())!
  it('takes a fresh reading and clears stale', () => {
    const next = buildMatchupStrip(data({ sides: { available: true, data: { you: side('Me', 90, true), opponent: side('Them', 70, false) } } }))!
    expect(nextStripState(good, next)).toEqual({ strip: next, stale: false })
  })
  it('keeps the last good strip and marks it stale when a poll fails', () => {
    expect(nextStripState(good, 'error')).toEqual({ strip: good, stale: true })
  })
  it('has nothing to call stale when the first read fails', () => {
    expect(nextStripState(null, 'error')).toEqual({ strip: null, stale: false })
  })
  it('lets a server "no matchup" replace the strip, since that is a real answer', () => {
    expect(nextStripState(good, null)).toEqual({ strip: null, stale: false })
  })
})

describe('describeRemaining', () => {
  it('says what is left, per team, and never a number it cannot back', () => {
    expect(describeRemaining({ upcoming: 2, live: 1 })).toBe('3 to play (1 live)')
    expect(describeRemaining({ upcoming: 2, live: 0 })).toBe('2 to play')
    expect(describeRemaining({ upcoming: 0, live: 0 })).toBe('none left')
    expect(describeRemaining(null)).toBe('unknown')
  })
})
