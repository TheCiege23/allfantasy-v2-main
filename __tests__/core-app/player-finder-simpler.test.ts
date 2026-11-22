/**
 * Player Finder, simpler (2026-11-14): the home's headline says how many of your starters may not play,
 * and /core/player-finder — the page's own name — opens it instead of falling through to Home.
 */
import { describe, expect, it } from 'vitest'
import { finderGuideMessages } from '@/lib/core-app/messages/finderGuide'
import { canonicalCoreScreen } from '@/lib/core-app/leagueNavigation'

describe('Player Finder — the headline answers', () => {
  const en = finderGuideMessages.en
  const es = finderGuideMessages.es!
  it('says how many starters may not play, or that none is flagged', () => {
    expect(en.homeFlagged(4)).toBe('4 of your starters may not play this week')
    expect(en.homeFlagged(1)).toBe('1 of your starters may not play this week')
    expect(en.homeClear).toBe('None of your starters is flagged this week')
    expect(en.homeSub).toBe('Search any player by name or team to see every league he’s in.')
    expect(es.homeFlagged!(4)).toBe('4 de tus titulares podrían no jugar esta semana')
    expect(es.homeFlagged!(1)).toBe('1 de tus titulares podría no jugar esta semana')
  })
})

describe('Player Finder — its own name is a link that works', () => {
  it('maps /core/player-finder and its spellings to the players screen, and leaves the rest alone', () => {
    expect(canonicalCoreScreen('player-finder')).toBe('players')
    expect(canonicalCoreScreen('Player-Finder')).toBe('players')
    expect(canonicalCoreScreen('playerfinder')).toBe('players')
    expect(canonicalCoreScreen('players')).toBe('players')
    expect(canonicalCoreScreen('roster')).toBe('my-team')
    expect(canonicalCoreScreen('standings')).toBe('standings')
  })
})
