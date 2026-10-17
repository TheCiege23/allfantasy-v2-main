import { describe, expect, it } from 'vitest'

import { buildAssistantFeedByPlayerName, getAssistantFeedForPlayer } from '@/lib/draft-room/assistantFeedLookup'

/*
 * 🛑 The draft room's feed kept the LAST injury row under a name (2026-10-11), so a healthy Vikings
 * WR Justin Jefferson carried the Browns LB's injury into the player panel and the draft copilot.
 */
const injuries = [
  { playerName: 'Justin Jefferson', team: 'Cleveland Browns', status: 'Out', note: 'Hamstring' },
  { playerName: 'Rome Odunze', team: 'Chicago Bears', status: 'Questionable', note: 'Ankle' },
]

describe('draft assistant feed injuries', () => {
  const map = buildAssistantFeedByPlayerName([{ title: 'Jefferson catches 9 in win', playerName: 'Justin Jefferson', team: 'MIN' }], injuries)

  it("a namesake on another club is not this player's injury", () => {
    const snap = getAssistantFeedForPlayer(map, 'Justin Jefferson', 'MIN')
    expect(snap?.injuryStatus ?? null).toBeNull()
    expect(snap?.headlineTitle).toBe('Jefferson catches 9 in win')
  })

  it('his own club binds, against the feed’s full team name', () => {
    expect(getAssistantFeedForPlayer(map, 'Justin Jefferson', 'CLE')?.injuryStatus).toBe('Out')
    expect(getAssistantFeedForPlayer(map, 'Rome Odunze', 'CHI')?.injuryStatus).toBe('Questionable')
  })

  it('without a club, a name the rows agree on one club for still binds', () => {
    expect(getAssistantFeedForPlayer(map, 'Rome Odunze')?.injuryStatus).toBe('Questionable')
  })

  it('without a club, a name two clubs share binds nobody', () => {
    const both = buildAssistantFeedByPlayerName([], [...injuries, { playerName: 'Justin Jefferson', team: 'Minnesota Vikings', status: 'Questionable', note: null }])
    expect(getAssistantFeedForPlayer(both, 'Justin Jefferson')).toBeNull()
    expect(getAssistantFeedForPlayer(both, 'Justin Jefferson', 'MIN')?.injuryStatus).toBe('Questionable')
  })
})
