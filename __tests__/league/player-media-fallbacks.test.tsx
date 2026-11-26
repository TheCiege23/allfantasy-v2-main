/**
 * Every player row carries a face and a club, in every sport (owner request, 2026-11-25).
 *
 * The two shared avatars:
 *  - league screens (`NativeScreenParts` `PlayerAvatar`: Matchup, Lineup, Trades): the crest used to
 *    vanish when it was missing or 404'd, leaving the corner blank. It now falls back to the team
 *    registry crest for the league's sport, then to the abbreviation chip.
 *  - draft room (`components/app/draft-room/PlayerAvatar`): a badge logo that 404'd left an empty
 *    grey box; it now falls back to the abbreviation chip it already drew for a missing URL.
 */
// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/components/core-app/player-card/PlayerCardProvider', () => ({
  usePlayerCard: () => ({ open: () => {}, close: () => {}, isOpen: false }),
}))
// The draft image lazy-loads behind an IntersectionObserver jsdom does not have: draw it plainly.
vi.mock('@/components/app/draft-room/LazyDraftImage', () => ({
  LazyDraftImage: ({ src, alt, testId, onError }: { src: string; alt: string; testId?: string; onError?: () => void }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} data-testid={testId} onError={() => onError?.()} />
  ),
}))

import { PlayerAvatar as LeagueAvatar } from '@/components/league/native/screens/NativeScreenParts'
import { PlayerAvatar as DraftAvatar } from '@/components/app/draft-room/PlayerAvatar'
import { PlayerFace, clubAbbr } from '@/components/core-app/boards/PlayerFace'
import { MatchupStarterRow } from '@/components/matchup-center/MatchupStarterRow'
import WaiverClaimDrawer from '@/components/waiver-wire/WaiverClaimDrawer'

describe('league-screen PlayerAvatar', () => {
  it('draws the headshot and the passed crest', () => {
    const { container } = render(<LeagueAvatar name="Jalen Hurts" headshotUrl="https://x/h.jpg" teamLogoUrl="https://x/phi.png" team="PHI" sport="NFL" />)
    expect(container.querySelector('img:not(.nls-pavatar-crest)')?.getAttribute('src')).toBe('https://x/h.jpg')
    expect(screen.getByTestId('nls-pavatar-crest').getAttribute('src')).toBe('https://x/phi.png')
  })

  it('falls back to initials when the headshot fails, and to the abbreviation when the crest fails', () => {
    const { container } = render(<LeagueAvatar name="Jalen Hurts" headshotUrl="https://x/h.jpg" teamLogoUrl="https://x/phi.png" team="PHI" sport="NFL" />)
    fireEvent.error(container.querySelector('img:not(.nls-pavatar-crest)')!)
    expect(screen.getByTestId('nls-pavatar-initials').textContent).toBe('JH')
    fireEvent.error(screen.getByTestId('nls-pavatar-crest'))
    expect(screen.queryByTestId('nls-pavatar-crest')).toBeNull()
    expect(screen.getByTestId('nls-pavatar-crest-abbr').textContent).toBe('PHI')
  })

  it.each([
    ['NFL', 'PHI'],
    ['NBA', 'LAL'],
    ['MLB', 'NYY'],
    ['NHL', 'BOS'],
    ['NCAAF', 'ALA'],
    ['NCAAB', 'DUKE'],
  ])('%s: with no crest URL from the feed, the registry crest for %s is drawn', (sport, team) => {
    render(<LeagueAvatar name="A Player" headshotUrl={null} teamLogoUrl={null} team={team} sport={sport} />)
    expect(screen.getByTestId('nls-pavatar-crest').getAttribute('src')).toContain(team.toLowerCase())
    expect(screen.getByTestId('nls-pavatar-initials').textContent).toBe('AP')
  })

  it('a club the registry does not know (soccer codes today) gets the abbreviation chip, never a blank corner', () => {
    render(<LeagueAvatar name="Bukayo Saka" team="ARS" sport="SOCCER" />)
    expect(screen.queryByTestId('nls-pavatar-crest')).toBeNull()
    expect(screen.getByTestId('nls-pavatar-crest-abbr').textContent).toBe('ARS')
  })

  it('a free agent gets no club chip', () => {
    render(<LeagueAvatar name="Free Guy" team="FA" sport="NFL" />)
    expect(screen.queryByTestId('nls-pavatar-crest')).toBeNull()
    expect(screen.queryByTestId('nls-pavatar-crest-abbr')).toBeNull()
  })

  it('control: the registry is not consulted without a sport, so nothing is guessed', () => {
    render(<LeagueAvatar name="A Player" team="PHI" />)
    expect(screen.queryByTestId('nls-pavatar-crest')).toBeNull()
    expect(screen.getByTestId('nls-pavatar-crest-abbr').textContent).toBe('PHI')
  })
})

describe('draft-room PlayerAvatar team badge', () => {
  it('a badge logo that fails to load becomes the abbreviation chip, not an empty box', () => {
    render(<DraftAvatar headshotUrl={null} displayName="Aaron Judge" teamLogoUrl="https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png" teamAbbr="NYY" position="OF" />)
    const logo = screen.getByTestId('player-avatar-team-logo')
    expect(screen.queryByText('NYY')).toBeNull()
    fireEvent.error(logo)
    expect(screen.queryByTestId('player-avatar-team-logo')).toBeNull()
    expect(screen.getByText('NYY')).toBeTruthy()
  })
})

describe('/core boards PlayerFace crest corner', () => {
  it('shows the abbreviation when there is no crest, and when the crest fails to load', () => {
    const { container, rerender } = render(<PlayerFace name="Saquon Barkley" teamLogoUrl={null} team="PHI" />)
    expect(container.querySelector('.af-crest-abbr')?.textContent).toBe('PHI')
    rerender(<PlayerFace name="Saquon Barkley" teamLogoUrl="https://x/phi.png" team="PHI" />)
    const crest = container.querySelector('img.af-bd-club')!
    expect(container.querySelector('.af-crest-abbr')).toBeNull()
    fireEvent.error(crest)
    expect(container.querySelector('.af-crest-abbr')?.textContent).toBe('PHI')
  })

  it('a free agent has no club, so no corner', () => {
    const { container } = render(<PlayerFace name="Free Guy" team="FA" />)
    expect(container.querySelector('.af-crest-abbr')).toBeNull()
    expect(clubAbbr('Free Agent')).toBeNull()
    expect(clubAbbr('nyy')).toBe('NYY')
  })
})

describe('classic matchup row (embedded imports)', () => {
  const slot = (name: string, team: string | null) =>
    ({ playerId: name, name, position: 'C', team, opponent: 'BOS', headshotUrl: null, currentPoints: 1, projectedPoints: 2, gameStatus: 'upcoming', gameLabel: 'Tue 7:00 PM' }) as never

  it('draws the crest on each photo for the league sport, with initials for a missing photo', () => {
    render(<MatchupStarterRow position="C" sport="NHL" left={slot('Connor McDavid', 'EDM')} right={slot('Nathan MacKinnon', 'COL')} />)
    expect(screen.getAllByTestId('matchup-row-team-logo')).toHaveLength(2)
    expect(screen.getByText('CM')).toBeTruthy()
    expect(screen.getByText('NM')).toBeTruthy()
  })

  it('a player with no club gets no crest', () => {
    render(<MatchupStarterRow position="C" left={slot('Free Guy', 'FA')} right={null} />)
    expect(screen.queryByTestId('matchup-row-team-logo')).toBeNull()
  })
})

describe('waiver claim drawer header', () => {
  it('shows the player with initials and the team abbreviation when no images are passed', () => {
    render(
      <WaiverClaimDrawer
        open
        onClose={() => {}}
        player={{ id: 'p1', name: 'Aaron Judge', position: 'OF', team: 'NYY' }}
        faabMode={false}
        faabRemaining={null}
        hasOpenRosterSpot
        rosterPlayerIds={[]}
        rosterPlayers={[]}
        onSubmit={async () => {}}
      />,
    )
    expect(screen.getByTestId('waiver-claim-avatar-initials').textContent).toBe('AJ')
    expect(screen.getAllByText('NYY').length).toBeGreaterThan(0)
  })
})
