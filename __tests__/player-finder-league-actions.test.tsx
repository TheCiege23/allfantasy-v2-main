import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))

import { LeagueActionCards } from '@/components/core-app/player-finder/LeagueActionCards'
import { PhoneFold } from '@/components/core-app/player-finder/PhoneFold'
import { PhoneSearchDock } from '@/components/core-app/player-finder/PhoneSearchDock'
import { buildLeagueCards, cardForFree, cardForSlot } from '@/lib/core-app/leagueActions'
import type { LeagueSlot } from '@/lib/core-app/playerFinder'
import type { FreeAgentBidRow } from '@/lib/core-app/freeAgentBids'

/*
 * One-tap actions per league and the phone layout (Guap, 2026-10-08): Start / Bench / Trade / Add,
 * each straight to the platform screen that makes the move — and never a "Start him" button over a
 * page that cannot start anyone.
 */

const slot = (over: Partial<LeagueSlot>): LeagueSlot => ({
  leagueId: 'L1',
  leagueName: 'KBFL',
  platform: 'sleeper',
  format: null,
  platformLeagueId: '123',
  season: 2026,
  teamExternalId: '7',
  slot: 'STARTER',
  isYours: true,
  owner: null,
  ...over,
})

const free = (over: Partial<FreeAgentBidRow> = {}): FreeAgentBidRow => ({
  leagueId: 'F1',
  leagueName: 'Maye 26',
  platform: 'sleeper',
  claim: { href: 'https://sleeper.com/leagues/555/players', label: 'Open in Sleeper', platformLabel: 'Sleeper', screen: 'Waivers', external: true },
  bid: null,
  room: null,
  note: null,
  ...over,
})

describe('leagueActions', () => {
  it('a starter: Bench him, straight to the verified Sleeper lineup; the trade and the league home in the sheet', () => {
    const c = cardForSlot(slot({}))
    expect(c.state).toBe('start')
    expect(c.primary).toEqual({ kind: 'bench', href: 'https://sleeper.com/leagues/123/team', external: true, platformLabel: 'Sleeper' })
    expect(c.more.map((a) => a.kind)).toEqual(['lineup', 'trade_away', 'league_home'])
    expect(c.more.find((a) => a.kind === 'trade_away')!.href).toBe('/core/trades?league=L1')
  })

  it('on your bench: Start him; on IR: move him off it', () => {
    expect(cardForSlot(slot({ slot: 'BENCH' })).primary!.kind).toBe('start')
    expect(cardForSlot(slot({ slot: 'IR SLOT' })).primary!.kind).toBe('activate')
  })

  it('🛑 best ball: no lineup button at all — the platform sets that lineup', () => {
    const c = cardForSlot(slot({ bestBall: true }))
    expect(c.primary).toBeNull()
    expect(c.more.map((a) => a.kind)).toEqual(['trade_away', 'league_home'])
  })

  it('🛑 a platform with no verified lineup screen (MFL) never gets "Start him" — at most its league page, named as such', () => {
    const c = cardForSlot(slot({ platform: 'mfl', slot: 'BENCH' }))
    expect(c.primary === null || c.primary.kind === 'open_league').toBe(true)
  })

  it('a native league starts on its own team tab', () => {
    const c = cardForSlot(slot({ platform: 'allfantasy', slot: 'BENCH', platformLeagueId: null }))
    expect(c.primary).toMatchObject({ kind: 'start', href: '/league/L1?view=team', external: false })
  })

  it('someone else’s: Trade for him on AllFantasy (it grades the offer), and Propose on the platform when verified', () => {
    const c = cardForSlot(slot({ isYours: false, slot: 'NOT YOURS', owner: { teamName: 'Titans', ownerName: 'tasha', avatarUrl: null, externalId: '9' } }))
    expect(c.owner).toBe('@tasha')
    expect(c.primary).toMatchObject({ kind: 'trade_for', href: '/core/trades?league=L1', external: false })
    expect(c.more[0]).toMatchObject({ kind: 'propose', href: 'https://sleeper.com/leagues/123/trades' })
  })

  it('free: Add him through the row’s own claim link; no claim link, no button', () => {
    expect(cardForFree(free()).primary).toMatchObject({ kind: 'add', href: 'https://sleeper.com/leagues/555/players' })
    expect(cardForFree(free({ claim: null })).primary).toBeNull()
  })

  it('cards: yours first, then free, then other managers’ — and a free row for a league already held is not doubled', () => {
    const cards = buildLeagueCards(
      [slot({ leagueId: 'O', isYours: false, slot: 'NOT YOURS' }), slot({ leagueId: 'B', slot: 'BENCH' }), slot({ leagueId: 'S' })],
      [free({ leagueId: 'F1' }), free({ leagueId: 'S' })],
    )
    expect(cards.map((c) => `${c.leagueId}:${c.state}`)).toEqual(['S:start', 'B:bench', 'F1:free', 'O:other'])
  })
})

describe('LeagueActionCards', () => {
  const cards = buildLeagueCards([slot({}), slot({ leagueId: 'L2', leagueName: 'Home', slot: 'BENCH', platform: 'yahoo', platformLeagueId: '55' })], [free()])

  it('every card leads with its one-tap move, opening the platform in a new tab', () => {
    render(<LeagueActionCards cards={cards} playerName="Josh Allen" proj={{ L1: '22.5' }} />)
    const bench = screen.getByRole('link', { name: 'Bench Allen in Sleeper' })
    expect(bench).toHaveAttribute('href', 'https://sleeper.com/leagues/123/team')
    expect(bench).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Start Allen in Yahoo' })).toHaveAttribute('href', 'https://football.fantasysports.yahoo.com/f1/55/7')
    expect(screen.getByRole('link', { name: 'Add Allen in Sleeper' })).toBeInTheDocument()
    expect(screen.getByText(/22\.5 pts/)).toBeInTheDocument()
  })

  it('"⋯" opens the sheet with every action; Escape and Close dismiss it', () => {
    render(<LeagueActionCards cards={cards} playerName="Josh Allen" />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions in KBFL' }))
    const sheet = screen.getByRole('dialog', { name: 'Allen in KBFL' })
    expect(within(sheet).getAllByRole('link').map((a) => a.textContent)).toEqual(['Bench Allen in Sleeper', 'Set lineup in Sleeper', 'Trade Allen away', 'League home'])
    expect(within(sheet).getByRole('button', { name: 'Close' })).toHaveFocus()
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More actions in Home' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders nothing with no cards', () => {
    const { container } = render(<LeagueActionCards cards={[]} playerName="Josh Allen" />)
    expect(container.innerHTML).toBe('')
  })
})

describe('PhoneFold', () => {
  it('starts folded and toggles; the body stays in the DOM (the phone stylesheet hides it)', () => {
    const { container } = render(
      <PhoneFold title="News">
        <p>headline</p>
      </PhoneFold>,
    )
    const fold = container.querySelector('.af-pf-fold')!
    expect(fold).toHaveAttribute('data-open', 'false')
    expect(screen.getByText('headline')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show News' }))
    expect(fold).toHaveAttribute('data-open', 'true')
    expect(screen.getByRole('button', { name: 'Hide News' })).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('PhoneSearchDock', () => {
  it('one tap brings the search back and focuses it', () => {
    const scrollIntoView = vi.fn()
    const { container } = render(
      <div>
        <aside className="af-pf-rail">
          <form className="af-pf-search-wrap">
            <input name="q" aria-label="Search players" />
          </form>
        </aside>
        <PhoneSearchDock />
      </div>,
    )
    const wrap = container.querySelector('.af-pf-search-wrap') as HTMLElement
    wrap.scrollIntoView = scrollIntoView
    fireEvent.click(container.querySelector('.af-pf-dock-btn')!)
    expect(scrollIntoView).toHaveBeenCalled()
    expect(container.querySelector('input[name="q"]')).toHaveFocus()
  })
})
