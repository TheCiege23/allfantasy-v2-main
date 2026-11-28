/**
 * The weekly recap's storylines, from facts only (lib/league-chat/nativeRecapStorylines.ts).
 *
 * Since 2026-11-28 the file holds only what no other system produces: rivalry games, rivalry week, trades and pickups.
 * Its own closest game, biggest margin, lowest score, streaks and upsets were copies of rules other systems own (the
 * weekly awards calculator and the drama engine) and are gone; the tests below pin that they stay gone.
 */
import { describe, expect, it } from 'vitest'

import { buildStorylineFacts, rivalryPairKey, storylineLines, type SeasonGame } from '@/lib/league-chat/nativeRecapStorylines'

const g = (week: number, homeId: string, awayId: string, homeScore: number, awayScore: number): SeasonGame => ({ week, homeId, awayId, homeScore, awayScore })

// Week 4: D beats A (a rivalry pair), C routs B.
const week4: SeasonGame[] = [g(4, 'D', 'A', 101.4, 100.9), g(4, 'B', 'C', 60, 140)]
const names: Record<string, string> = { A: 'Aces', B: 'Bears', C: 'Colts', D: 'Dons' }

describe("the week's storylines", () => {
  const facts = buildStorylineFacts({ week: 4, weekGames: week4, rivalryPairs: new Set([rivalryPairKey('A', 'D')]), rivalryWeek: true })

  it('a rivalry game names the winner, and rivalry week is said once', () => {
    expect(facts.rivalries).toEqual([{ aId: 'D', bId: 'A', winnerId: 'D' }])
    const lines = storylineLines({ ...facts, trades: [{ aId: 'A', bId: 'C' }], pickups: [{ rosterId: 'C', playerName: 'J. Doe', points: 24.6 }] }, (id) => names[id]!)
    expect(lines[0]).toBe('  🔥 It was rivalry week.')
    expect(lines).toContain('  ⚔️ Rivalry: Dons beat Aces')
    expect(lines).toContain('  🤝 Trade completed: Aces and Colts')
    expect(lines).toContain('  🧲 Pickup that paid off: J. Doe started for Colts and scored 24.6')
  })

  it('a tied rivalry game names both teams', () => {
    const tied = buildStorylineFacts({ week: 4, weekGames: [g(4, 'A', 'D', 90, 90)], rivalryPairs: new Set([rivalryPairKey('A', 'D')]), rivalryWeek: false })
    expect(storylineLines(tied, (id) => names[id]!)).toEqual(['  ⚔️ Rivalry: Aces and Dons tied'])
  })

  it('🛑 no copied rules: no closest game, margin, low score, streak or upset is produced', () => {
    const lines = storylineLines({ ...facts, trades: [], pickups: [] }, (id) => names[id]!)
    expect(Object.keys(facts).sort()).toEqual(['pickups', 'rivalries', 'rivalryWeek', 'trades'])
    for (const word of ['Closest', 'Biggest margin', 'Lowest score', 'straight', 'Upset']) {
      expect(lines.join('\n')).not.toContain(word)
    }
  })

  it('a quiet week says nothing rather than inventing a story', () => {
    const quiet = buildStorylineFacts({ week: 1, weekGames: [g(1, 'A', 'B', 100, 100)], rivalryPairs: new Set(), rivalryWeek: false })
    expect(storylineLines(quiet, (id) => names[id]!)).toEqual([])
  })

  it('pickups keep the three biggest scores, and a zero is not a payoff', () => {
    const f = buildStorylineFacts({
      week: 4, weekGames: week4, rivalryPairs: new Set(), rivalryWeek: false,
      pickups: [1, 9, 0, 14, 22].map((points, i) => ({ rosterId: 'A', playerName: `P${i}`, points })),
    })
    expect(f.pickups.map((p) => p.points)).toEqual([22, 14, 9])
  })
})
