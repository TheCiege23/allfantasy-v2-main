/**
 * The draft room's text lists (my picks, recent wins, keepers, the intel queue, the post-draft recap)
 * draw a face through `DraftPlayerFace` (2026-11-26). Those rows hold a pick, not a pool row, so the
 * crest comes from the team registry for the draft's sport, and the shared `PlayerAvatar` falls back to
 * the abbreviation chip and initials.
 */
// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

// The draft image lazy-loads behind an IntersectionObserver jsdom does not have: draw it plainly.
vi.mock('@/components/app/draft-room/LazyDraftImage', () => ({
  LazyDraftImage: ({ src, alt, testId, onError }: { src: string; alt: string; testId?: string; onError?: () => void }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} data-testid={testId} onError={() => onError?.()} />
  ),
}))

import { DraftPlayerFace } from '@/components/app/draft-room/DraftPlayerFace'

describe('DraftPlayerFace', () => {
  it.each([
    ['NFL', 'KC'],
    ['NBA', 'BOS'],
    ['MLB', 'LAD'],
    ['NHL', 'EDM'],
    ['NCAAF', 'ALA'],
    ['NCAAB', 'DUKE'],
  ])('%s: with no logo URL on the pick, the registry crest for %s is drawn', (sport, team) => {
    render(<DraftPlayerFace name="Some Player" team={team} sport={sport} position="QB" />)
    expect(screen.getByTestId('draft-player-face-team-logo').getAttribute('src')).toContain(team.toLowerCase())
    expect(screen.getByTestId('draft-player-face-initials').textContent).toBe('SP')
  })

  it('soccer (no registry crests today) shows the abbreviation chip', () => {
    render(<DraftPlayerFace name="Bukayo Saka" team="ARS" sport="SOCCER" position="MID" />)
    expect(screen.queryByTestId('draft-player-face-team-logo')).toBeNull()
    expect(screen.getByText('ARS')).toBeTruthy()
  })

  it('a crest that fails to load becomes the abbreviation', () => {
    render(<DraftPlayerFace name="Aaron Judge" team="NYY" sport="MLB" position="OF" />)
    fireEvent.error(screen.getByTestId('draft-player-face-team-logo'))
    expect(screen.queryByTestId('draft-player-face-team-logo')).toBeNull()
    expect(screen.getByText('NYY')).toBeTruthy()
  })

  it('a passed logo URL wins over the registry', () => {
    render(<DraftPlayerFace name="Aaron Judge" team="NYY" sport="MLB" teamLogoUrl="https://cdn.example/stored-nyy.png" />)
    expect(screen.getByTestId('draft-player-face-team-logo').getAttribute('src')).toBe('https://cdn.example/stored-nyy.png')
  })

  it('a free agent gets no club corner at all', () => {
    const { container } = render(<DraftPlayerFace name="Free Guy" team="FA" sport="NFL" />)
    expect(screen.queryByTestId('draft-player-face-team-logo')).toBeNull()
    expect(container.textContent).toBe('FG')
  })
})
