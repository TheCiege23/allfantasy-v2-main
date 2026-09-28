import { describe, expect, it } from 'vitest'

import { MAX_FOLLOW_UPS, readFollowUps, suggestChimmyFollowUps } from '@/lib/chimmy/followUps'
import { CHIMMY_TOOL_SPECS } from '@/lib/chimmy/tools/chimmyTools'

describe('suggestChimmyFollowUps', () => {
  it('suggests the next analyst question after a lineup answer', () => {
    expect(suggestChimmyFollowUps({ toolsUsed: ['find_league_by_name', 'optimize_my_lineup'], leagueScoped: true })).toEqual([
      'How does my matchup look this week?',
      'Who is the best pickup for my weakest spot?',
      'What are my playoff odds?',
    ])
  })

  it('offers to grade a trade idea after a trade search, and a search after a graded trade', () => {
    expect(suggestChimmyFollowUps({ toolsUsed: ['find_trade_ideas'], leagueScoped: true })[0]).toBe(
      'Grade the first trade idea for my lineup',
    )
    expect(suggestChimmyFollowUps({ toolsUsed: ['evaluate_trade'], leagueScoped: true })).toContain(
      'Find me a trade that fills my weakest spot',
    )
    /* Both are about ONE league's rosters: never offered with none in scope. */
    const global = suggestChimmyFollowUps({ toolsUsed: ['find_trade_ideas'], leagueScoped: false })
    expect(global).not.toContain('Grade the first trade idea for my lineup')
    expect(global).not.toContain('Find me a trade that fills my weakest spot')
  })

  it('never suggests re-running a tool the answer already used', () => {
    const out = suggestChimmyFollowUps({ toolsUsed: ['get_playoff_outlook', 'get_my_matchup'], leagueScoped: true })
    expect(out).not.toContain('What are my playoff odds?')
    expect(out).not.toContain('How does my matchup look this week?')
    expect(out.length).toBeGreaterThan(0)
  })

  /* Without a league in scope, "set my lineup" cannot be answered until one is picked. */
  it('offers only cross-league questions when no league is in scope', () => {
    const out = suggestChimmyFollowUps({ toolsUsed: [], leagueScoped: false })
    expect(out).toEqual([
      'How are my playoff odds across all my leagues?',
      'Which of my matchups are coin flips this week?',
      "Who's hurt on my teams?",
    ])
    expect(out).not.toContain('Set my best lineup for this week')
  })

  it('never returns more than three, and never duplicates', () => {
    for (const spec of CHIMMY_TOOL_SPECS) {
      for (const leagueScoped of [true, false]) {
        const out = suggestChimmyFollowUps({ toolsUsed: [spec.function.name], leagueScoped })
        expect(out.length).toBeLessThanOrEqual(MAX_FOLLOW_UPS)
        expect(new Set(out).size).toBe(out.length)
      }
    }
  })
})

describe('readFollowUps', () => {
  it('keeps short strings only, three at most', () => {
    expect(readFollowUps(['a', 2, '', 'b', 'x'.repeat(121), 'c', 'd'])).toEqual(['a', 'b', 'c'])
  })
  it('returns null for anything that is not a usable list', () => {
    expect(readFollowUps(undefined)).toBeNull()
    expect(readFollowUps('Set my lineup')).toBeNull()
    expect(readFollowUps([])).toBeNull()
  })
})
