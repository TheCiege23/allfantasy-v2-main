import { describe, expect, it } from 'vitest'
import { buildNativeWeeklyRecap } from '@/lib/league-chat/nativeWeeklyRecap'
import { RECIPES, defaultRecipeValue } from '@/lib/core-app/commissioner/recipes'

describe('native weekly recap', () => {
  it('can be enabled for native leagues while remaining opt-in', () => {
    const recipe = RECIPES.find((item) => item.key === 'weeklyRecap')!
    expect(recipe.unavailableReason({ platform: 'manual', sport: 'NFL' })).toBeNull()
    expect(recipe.unavailableReason({ platform: 'fantrax', sport: 'NFL' })).not.toBeNull()
    expect(defaultRecipeValue('weeklyRecap', 'manual')).toBe(false)
  })
  it('reports finalized results, ties, leaders and the top score without inventing awards', () => {
    const recap = buildNativeWeeklyRecap({
      leagueName: 'Test League',
      season: 2026,
      week: 4,
      games: [
        { home: 'Hawks', away: 'Bears', homeScore: 101.25, awayScore: 95.5 },
        { home: 'Foxes', away: 'Owls', homeScore: 88, awayScore: 88 },
      ],
      leaders: [
        { name: 'Hawks', wins: 3, losses: 1, ties: 0 },
        { name: 'Foxes', wins: 2, losses: 1, ties: 1 },
      ],
    })
    expect(recap).toContain('Hawks 101.3 def. Bears 95.5')
    expect(recap).toContain('Foxes 88.0 tied Owls 88.0')
    expect(recap).toContain('Hawks (3-1)')
    expect(recap).toContain('Foxes (2-1-1)')
    expect(recap).toContain('Top score: Hawks, 101.3')
  })
})
