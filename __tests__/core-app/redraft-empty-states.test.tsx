/**
 * Empty and loading states on the redraft screens: the screen-shaped skeleton, the titled
 * "nothing yet" Standings card, and the single Matchup card when no matchup is resolved.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))

import CoreScreenSkeleton from '@/components/core-app/CoreScreenSkeleton'
import { screenFromCorePath, skeletonKindForScreen } from '@/lib/core-app/screenSkeletonKind'
import { Standings, standingsWaitForScores } from '@/components/core-app/screens/Standings'
import Matchup from '@/components/core-app/screens/Matchup'
import type { MatchupData } from '@/lib/core-app/matchup'

beforeEach(() => {
  ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  }
})
afterEach(() => {
  cleanup()
  delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
})

describe('screen-shaped skeleton', () => {
  it('maps screens to the layout that will land, and anything unknown to the generic cards', () => {
    expect(skeletonKindForScreen('standings')).toBe('table')
    expect(skeletonKindForScreen('matchup')).toBe('scoreboard')
    expect(skeletonKindForScreen('live')).toBe('scoreboard')
    expect(skeletonKindForScreen('my-team')).toBe('roster')
    expect(skeletonKindForScreen('trades')).toBe('cards')
    expect(skeletonKindForScreen(null)).toBe('cards')
  })

  it('reads the arriving screen from a link, relative or absolute', () => {
    expect(screenFromCorePath('/core/standings?league=x')).toBe('standings')
    expect(screenFromCorePath('https://allfantasy.ai/core/my-team?league=x')).toBe('my-team')
    expect(screenFromCorePath('/core?league=x')).toBe('home')
    expect(screenFromCorePath('/league/abc')).toBeNull()
  })

  it('draws a stat strip over rows for a table screen, and the card grid without a screen', () => {
    const { container, unmount } = render(<CoreScreenSkeleton screen="standings" />)
    expect(container.querySelector('[data-skeleton]')?.getAttribute('data-skeleton')).toBe('table')
    expect(container.querySelectorAll('.af-sk-stat')).toHaveLength(4)
    expect(container.querySelector('.af-sk-cards')).toBeNull()
    unmount()
    const generic = render(<CoreScreenSkeleton />)
    expect(generic.container.querySelector('.af-sk-cards')).not.toBeNull()
    expect(generic.container.querySelector('.af-sk-rows')).toBeNull()
  })
})

describe('Standings before any week is scored', () => {
  const reason = 'no weekly results have been synced for this league yet — the board is built from scored weeks, and there are none on file'

  it('is a titled card that says the table fills in once a week is scored', () => {
    render(<Standings data={{ available: false, leagueName: 'L', history: [], reason }} />)
    const card = screen.getByTestId('standings-empty')
    expect(card.textContent).toContain('No standings to show yet')
    expect(card.textContent).toContain('once the first week of the season has been scored')
  })

  it('promises nothing when the refusal is not about waiting for scores', () => {
    expect(standingsWaitForScores(reason)).toBe(true)
    expect(standingsWaitForScores('this league is no longer connected')).toBe(false)
    render(<Standings data={{ available: false, leagueName: 'L', history: [], reason: 'this league is no longer connected' }} />)
    expect(screen.getByTestId('standings-empty').textContent).not.toContain('has been scored')
  })
})

describe('Matchup with no matchup resolved', () => {
  function noMatchup(): MatchupData {
    return {
      league: { id: 'l1', name: 'L', platform: 'native', logoUrl: null, sourceLink: null, lineupLink: null },
      week: { available: false, reason: 'no weekly results stored for this league' },
      extraMatchup: null,
      teams: { available: false, reason: 'no matchup resolved, so there are no teams to name' },
      sides: { available: false, reason: 'no matchup resolved' },
      lineups: { available: false, reason: 'no matchup resolved, so there are no lineups to pair' },
      identityNote: null,
      playerScoring: { available: false, reason: 'no matchup resolved, so no per-player scoring was looked for' },
      winProbability: { available: false, reason: 'n/a' },
      projectedFinal: { available: false, reason: 'no matchup resolved, so there is nothing to project' },
      yetToPlay: { available: false, reason: 'n/a' },
      starterCountsBySide: null,
    } as unknown as MatchupData
  }

  it('says it once, in one titled card, instead of three empty sections', () => {
    const { container } = render(<Matchup data={noMatchup()} />)
    expect(screen.getByTestId('matchup-empty').textContent).toContain('No matchup to show yet')
    expect(container.querySelector('.af-mu-h2h')).toBeNull()
    // The title and hint say it; no raw reason fragment repeats it, and the week line stays quiet.
    expect(container.textContent).not.toMatch(/no matchup resolved/i)
    expect(container.textContent).not.toMatch(/no weekly results stored/i)
  })
})
