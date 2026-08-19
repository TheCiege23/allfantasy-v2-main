import { describe, it, expect } from 'vitest'
import { suggestLeagueType, typeIsRankable } from '@/lib/career/leagueTypeSuggestion'

/**
 * Every league name below is real, taken from production. Sleeper cannot
 * express most of these formats, so commissioners encode them in the name —
 * which makes the name useful evidence and terrible authority.
 */

describe('real production league names', () => {
  it('spots the tournament that is stored as redraft', () => {
    const s = suggestLeagueType({ name: 'KBI Smoke Black', currentType: 'redraft' })
    expect(s.suggested).toBe('tournament')
    // Medium, never high — a name is a commissioner's choice, not a setting.
    expect(s.confidence).toBe('medium')
  })

  it('refuses to credit "KBI Commish Chat" as a tournament', () => {
    // Matches every KBI pattern and is a chat room. Counting it would hand
    // someone tournament credit for talking.
    const s = suggestLeagueType({ name: 'KBI Commish Chat' })
    expect(s.suggested).toBeNull()
    expect(s.looksNonCompetitive).toBe(true)
  })

  it('declines to choose when a name matches two formats', () => {
    const s = suggestLeagueType({ name: 'Survivor Style Guillotine' })
    expect(s.suggested).toBeNull()
    expect(s.reasons.join(' ')).toContain('more than one format')
  })

  it('finds the zombie league', () => {
    expect(suggestLeagueType({ name: 'Beta 1 Zombie League' }).suggested).toBe('zombie')
  })

  it('reads the buy-in commissioners put in the name', () => {
    const s = suggestLeagueType({ name: '🪓 Guillotine League 26 ($20 / 2)' })
    expect(s.detectedBuyIn).toBe(20)
    expect(suggestLeagueType({ name: '$20 Pirate League' }).detectedBuyIn).toBe(20)
    expect(suggestLeagueType({ name: '🪓 Guillotine League 26 ($30)' }).detectedBuyIn).toBe(30)
  })

  it('does not invent a buy-in that is not there', () => {
    expect(suggestLeagueType({ name: 'NFC Dreaming!' }).detectedBuyIn).toBeNull()
  })
})

describe('platform evidence outranks a name', () => {
  it('trusts Sleeper guillotine mode over anything in the name', () => {
    // The one format Sleeper models natively.
    const s = suggestLeagueType({ name: 'Just A Normal League', guillotineMode: true })
    expect(s.suggested).toBe('guillotine')
    expect(s.confidence).toBe('high')
  })

  it('trusts the dynasty flag when no specialty marker is present', () => {
    const s = suggestLeagueType({ name: 'The Last IDP Dynasty!!', isDynasty: true })
    expect(s.suggested).toBe('dynasty')
    expect(s.confidence).toBe('high')
  })

  it('defaults to redraft at LOW confidence, not silently', () => {
    const s = suggestLeagueType({ name: 'Parbur' })
    expect(s.suggested).toBe('redraft')
    expect(s.confidence).toBe('low')
  })
})

describe('nothing here may move a rank on its own', () => {
  it('requires human confirmation before a type counts for ranking', () => {
    // Otherwise a league renamed "Zombie Apocalypse Dynasty" as a joke silently
    // promotes its winner.
    expect(typeIsRankable({ confirmedByUser: false })).toBe(false)
    expect(typeIsRankable({ confirmedByUser: true })).toBe(true)
  })

  it('always explains itself, so the prompt can show why', () => {
    for (const name of ['KBI Smoke Black', 'Beta 1 Zombie League', 'Parbur']) {
      expect(suggestLeagueType({ name }).reasons.length).toBeGreaterThan(0)
    }
  })

  it('handles a missing name without throwing', () => {
    const s = suggestLeagueType({ name: null })
    expect(s.suggested).toBe('redraft')
    expect(s.confidence).toBe('low')
  })
})
