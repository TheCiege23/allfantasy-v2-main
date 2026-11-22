/**
 * The weekly recap's storylines, from facts only (lib/league-chat/nativeRecapStorylines.ts, 2026-11-15).
 */
import { describe, expect, it } from 'vitest'

import { buildStorylineFacts, rivalryPairKey, storylineLines, type SeasonGame } from '@/lib/league-chat/nativeRecapStorylines'

const g = (week: number, homeId: string, awayId: string, homeScore: number, awayScore: number): SeasonGame => ({ week, homeId, awayId, homeScore, awayScore })

// A wins weeks 1-3; B loses weeks 1-3; week 4: D (0 wins) beats A (3 wins) — an upset, and A's streak ends.
const season: SeasonGame[] = [
  g(1, 'A', 'B', 120, 90), g(1, 'C', 'D', 100, 80),
  g(2, 'A', 'C', 110, 105), g(2, 'B', 'D', 95, 99),
  g(3, 'A', 'D', 130, 70), g(3, 'B', 'C', 88, 101),
  g(4, 'D', 'A', 101.4, 100.9), g(4, 'B', 'C', 60, 140),
]
const names: Record<string, string> = { A: 'Aces', B: 'Bears', C: 'Colts', D: 'Dons' }

describe('the week\'s storylines', () => {
  const facts = buildStorylineFacts({ week: 4, seasonGames: season, rivalryPairs: new Set([rivalryPairKey('A', 'D')]), rivalryWeek: true })

  it('closest game, biggest margin and lowest score come from this week\'s finals', () => {
    expect(facts.closest).toMatchObject({ winnerId: 'D', loserId: 'A' })
    expect(facts.closest!.margin).toBeCloseTo(0.5)
    expect(facts.blowout).toEqual({ winnerId: 'C', loserId: 'B', margin: 80 })
    expect(facts.lowScore).toEqual({ rosterId: 'B', score: 60 })
  })

  it('an upset is a win by a team with at least 2 fewer wins going in — counted before this week', () => {
    expect(facts.upsets).toEqual([{ winnerId: 'D', loserId: 'A', winnerWinsBefore: 1, loserWinsBefore: 3 }])
  })

  it('streaks of three or more after this week, win or loss', () => {
    // Bears lost all four; Colts won 3 of 4 but lost week 2, so theirs is 2 and is not a storyline.
    expect(facts.streaks).toEqual([{ rosterId: 'B', length: 4, kind: 'loss' }])
    const winning = buildStorylineFacts({ week: 3, seasonGames: season, rivalryPairs: new Set(), rivalryWeek: false })
    expect(winning.streaks).toContainEqual({ rosterId: 'A', length: 3, kind: 'win' })
  })

  it('a rivalry game names the winner, and rivalry week is said once', () => {
    expect(facts.rivalries).toEqual([{ aId: 'D', bId: 'A', winnerId: 'D' }])
    const lines = storylineLines({ ...facts, trades: [{ aId: 'A', bId: 'C' }], pickups: [{ rosterId: 'C', playerName: 'J. Doe', points: 24.6 }] }, (id) => names[id]!)
    expect(lines[0]).toBe('  🔥 It was rivalry week.')
    expect(lines).toContain('  ⚔️ Rivalry: Dons beat Aces')
    expect(lines).toContain('  😮 Upset: Dons (1 win going in) beat Aces (3 wins)')
    expect(lines).toContain('  🤝 Trade completed: Aces and Colts')
    expect(lines).toContain('  🧲 Pickup that paid off: J. Doe started for Colts and scored 24.6')
  })

  it('a quiet week says nothing rather than inventing a story', () => {
    const quiet = buildStorylineFacts({ week: 1, seasonGames: [g(1, 'A', 'B', 100, 100)], rivalryPairs: new Set(), rivalryWeek: false })
    expect(quiet.closest).toBeNull()
    expect(quiet.blowout).toBeNull()
    expect(quiet.upsets).toEqual([])
    expect(storylineLines(quiet, (id) => names[id]!)).toEqual(['  🧊 Lowest score: Aces, 100.0'])
  })

  it('pickups keep the three biggest scores, and a zero is not a payoff', () => {
    const f = buildStorylineFacts({
      week: 4, seasonGames: season, rivalryPairs: new Set(), rivalryWeek: false,
      pickups: [1, 9, 0, 14, 22].map((points, i) => ({ rosterId: 'A', playerName: `P${i}`, points })),
    })
    expect(f.pickups.map((p) => p.points)).toEqual([22, 14, 9])
  })
})
