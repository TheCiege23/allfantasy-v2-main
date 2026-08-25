import { describe, expect, it } from 'vitest'
import {
  attributeUnit,
  classifyScoring,
  describePlay,
  isBigPlay,
  parseRollingInsightsPlay,
  primaryPlayer,
} from '@/lib/sports/rollingInsightsPlay'

/** Shaped from contracts/rolling-insights/PLAY-BY-PLAY.yaml, not from a live call. */
function play(overrides: Record<string, unknown> = {}) {
  return {
    sequence: 2,
    quarter: 1,
    gameClock: '14:56 - 1st',
    event: 'pass',
    down: 1,
    yardsToGo: 10,
    yardLine: 'BUF 25',
    yardsGained: 8,
    possession: 'Buffalo Bills',
    success: true,
    isBlocked: false,
    isReturned: false,
    isReversed: false,
    isFirstDown: false,
    isRecovered: false,
    isTouchdown: false,
    isChallenged: false,
    isScoringPlay: false,
    description: 'Allen pass to Diggs for 8 yards',
    players: [
      { id: 1234, name: 'Josh Allen', role: 'passer', action: 'pass', position: 'QB', teamAbbr: 'BUF' },
      { id: 5678, name: 'Stefon Diggs', role: 'receiver', action: 'receive', position: 'WR', teamAbbr: 'BUF' },
    ],
    ...overrides,
  }
}

describe('parseRollingInsightsPlay', () => {
  it('parses the contract shape', () => {
    const p = parseRollingInsightsPlay(play())
    expect(p).not.toBeNull()
    expect(p!.sequence).toBe(2)
    expect(p!.event).toBe('pass')
    expect(p!.yardLine).toBe('BUF 25')
  })

  /* `possession` is a FULL NAME here, an abbreviation on full_box. */
  it('resolves the full-name possession field to a canonical team', () => {
    const p = parseRollingInsightsPlay(play())!
    expect(p.possessionTeam).toBe('nfl:BUF')
  })

  /* Integer here, string on /injuries — normalized so a join cannot mismatch. */
  it('normalizes participant ids to strings', () => {
    const p = parseRollingInsightsPlay(play())!
    expect(p.players[0].id).toBe('1234')
  })

  it('falls back to not_available for an unrecognised event', () => {
    const p = parseRollingInsightsPlay(play({ event: 'something_new' }))!
    expect(p.event).toBe('not_available')
  })

  /*
   * A malformed element must not become a 0-yard non-scoring play, which would
   * be silently counted in any aggregate.
   */
  it('returns null rather than inventing a play', () => {
    expect(parseRollingInsightsPlay(null)).toBeNull()
    expect(parseRollingInsightsPlay({})).toBeNull()
    expect(parseRollingInsightsPlay({ event: 'pass' })).toBeNull()
  })

  it('keeps sequence as given, since it is non-contiguous', () => {
    // NFL 2, MLB 41, NBA 6 in the contract's samples — a high-water mark, not a count.
    expect(parseRollingInsightsPlay(play({ sequence: 41 }))!.sequence).toBe(41)
  })
})

describe('classifyScoring — the biggest gotcha in the schema', () => {
  /* Touchdown is NOT in the event enum; reading `event` alone misses every one. */
  it('finds a touchdown that the event enum does not name', () => {
    const p = parseRollingInsightsPlay(play({ event: 'pass', isTouchdown: true, isScoringPlay: true }))!
    expect(p.event).toBe('pass')
    expect(classifyScoring(p)).toBe('touchdown')
  })

  it('requires a field goal to have succeeded', () => {
    const made = parseRollingInsightsPlay(play({ event: 'field_goal', success: true }))!
    const missed = parseRollingInsightsPlay(play({ event: 'field_goal', success: false }))!
    expect(classifyScoring(made)).toBe('field_goal')
    expect(classifyScoring(missed)).toBe('none')
  })

  it('reads extra points and two-point tries from details', () => {
    const p = parseRollingInsightsPlay(play())!
    expect(classifyScoring(p, { pointsAfterTouchdown: { type: 'extra_point' } })).toBe('extra_point')
    expect(classifyScoring(p, { pointsAfterTouchdown: { type: 'two_point_conversion' } })).toBe('two_point')
  })

  it('classifies a safety', () => {
    const p = parseRollingInsightsPlay(play({ event: 'safety' }))!
    expect(classifyScoring(p)).toBe('safety')
  })

  it('says none for an ordinary play', () => {
    expect(classifyScoring(parseRollingInsightsPlay(play())!)).toBe('none')
  })
})

describe('isBigPlay', () => {
  it('uses the contract threshold of 20 yards', () => {
    expect(isBigPlay(parseRollingInsightsPlay(play({ yardsGained: 19 }))!)).toBe(false)
    expect(isBigPlay(parseRollingInsightsPlay(play({ yardsGained: 20 }))!)).toBe(true)
  })

  it('treats a null gain as not big, never as unknown-therefore-big', () => {
    expect(isBigPlay(parseRollingInsightsPlay(play({ yardsGained: null }))!)).toBe(false)
  })
})

describe('attributeUnit — event alone is not enough', () => {
  it('reads a pick-six as defence even though the event is a pass', () => {
    const p = parseRollingInsightsPlay(
      play({
        event: 'pass',
        isTouchdown: true,
        players: [{ id: 1, name: 'A Corner', role: 'interceptor', action: 'intercepted', position: 'CB', teamAbbr: 'MIA' }],
      }),
    )!
    expect(attributeUnit(p)).toBe('defense')
  })

  it('keeps an ordinary pass on offence', () => {
    expect(attributeUnit(parseRollingInsightsPlay(play())!)).toBe('offense')
  })

  it('files kicks, punts and field goals as special teams', () => {
    for (const event of ['kickoff', 'punt', 'field_goal']) {
      expect(attributeUnit(parseRollingInsightsPlay(play({ event }))!)).toBe('special_teams')
    }
  })

  it('files a sack and a safety as defence', () => {
    expect(attributeUnit(parseRollingInsightsPlay(play({ event: 'sack' }))!)).toBe('defense')
    expect(attributeUnit(parseRollingInsightsPlay(play({ event: 'safety' }))!)).toBe('defense')
  })

  it('returns unknown rather than defaulting a penalty to a unit', () => {
    expect(attributeUnit(parseRollingInsightsPlay(play({ event: 'penalty' }))!)).toBe('unknown')
  })
})

describe('primaryPlayer', () => {
  it('prefers the receiver over the passer on a completion', () => {
    expect(primaryPlayer(parseRollingInsightsPlay(play())!)?.name).toBe('Stefon Diggs')
  })

  /*
   * GAPS.md N-06: it is unresolved whether `fumbler` names the player who
   * fumbled or the one who forced it. Those are opposite claims about opposite
   * teams, so the role is not used at all until the gap closes.
   */
  it('never attributes a play to the ambiguous fumbler role', () => {
    const p = parseRollingInsightsPlay(
      play({
        event: 'fumble',
        players: [{ id: 9, name: 'Ambiguous Guy', role: 'fumbler', action: 'fumble', position: 'RB', teamAbbr: 'BUF' }],
      }),
    )!
    expect(primaryPlayer(p)).toBeNull()
  })
})

describe('describePlay', () => {
  it('summarises a touchdown', () => {
    const p = parseRollingInsightsPlay(play({ isTouchdown: true, yardsGained: 34 }))!
    const out = describePlay(p)
    expect(out).toContain('Stefon Diggs')
    expect(out).toContain('34 yd')
    expect(out).toContain('TOUCHDOWN')
  })

  it('marks a big play that did not score', () => {
    const out = describePlay(parseRollingInsightsPlay(play({ yardsGained: 22 }))!)
    expect(out).toContain('(big play)')
  })
})
