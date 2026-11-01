import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/*
 * Dynasty Era step 2 — the dynasty league chat look. Dynasty leagues get the ink room, the season
 * clock, labelled channels, pick chips on trade cards and the gold draft-order card; every other
 * league renders exactly what it did.
 */

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/league/L1',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/chimmy', () => ({ ChimmyChatShell: () => <div data-testid="chimmy-shell" /> }))
vi.mock('@/components/commish/BroadcastModal', () => ({ default: () => null }))

import LeagueChatPanel from '@/components/chat/LeagueChatPanel'
import { DynastyPickChip } from '@/components/chat/DynastyChatParts'
import { TradeCardView, type TradeCard } from '@/components/core-app/comms/TradeCardView'
import {
  dynastySeasonClock,
  pickChipTone,
  pickSlotLabel,
  readDynastyDraftOrderNotice,
} from '@/lib/league-chat/dynastyChatSkin'

const T = (min: number) => new Date(Date.UTC(2026, 9, 27, 14, min)).toISOString()

const TRADE_CARD = {
  manager: 'Comets',
  partner: 'Hawks',
  gave: [{ id: 'p1', name: 'Tony Pollard', position: 'RB', team: 'TEN' }],
  got: [{ id: 'p2', name: 'Garrett Wilson', position: 'WR', team: 'NYJ' }],
  picksGave: 0,
  picksGot: 2,
  season: 2026,
  week: 8,
}

const MESSAGES = [
  {
    id: 'trade1',
    text: 'Comets and Hawks made a deal.',
    createdAt: T(0),
    authorId: 'owner',
    authorName: 'Chimmy',
    messageType: 'trade',
    metadata: { chimmy: true, chimmyMoment: 'trade', tradeCard: TRADE_CARD },
  },
  {
    id: 'order1',
    text: 'Draft order randomized 3 times.',
    createdAt: T(1),
    authorId: 'owner',
    authorName: 'Commish',
    metadata: { category: 'Draft order', randomizeTimes: 3, order: ['Comets', 'Hawks', ''], isSystemMessage: true },
  },
  {
    id: 'rookie1',
    text: 'The 2027 rookie draft order is final.',
    createdAt: T(2),
    authorId: 'owner',
    authorName: 'Commish',
    messageType: 'host_announcement',
    metadata: { senderIsHost: true, contentType: 'rookie_order_update', season: 2026, lockedCount: 12, final: true },
  },
  /* A member who sets contentType themselves (the client allowlist keeps it) must not get the card. */
  {
    id: 'spoof1',
    text: 'totally official order',
    createdAt: T(3),
    authorId: 'sam',
    authorName: 'Sam',
    messageType: 'text',
    metadata: { contentType: 'rookie_order_update', final: true },
  },
  { id: 'mine1', text: 'Taxi call-ups are due Sunday', createdAt: T(4), authorId: 'me', authorName: 'Me' },
]

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/api/app/leagues/L1/chat')) return json({ viewerUserId: 'me', presence: [], messages: MESSAGES })
      if (u.includes('/pinned')) return json({ pinned: [] })
      if (u.includes('/typing')) return json({ typing: [] })
      return json({ status: 'ok' })
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const row = (id: string) => {
  const el = document.querySelector(`[data-message-id="${id}"]`)
  if (!el) throw new Error(`no row ${id}`)
  return el as HTMLElement
}

describe('dynastySeasonClock', () => {
  it('counts the startup season as Year 1', () => {
    expect(dynastySeasonClock({ season: 2026, sport: 'NFL', settings: { startup_season: 2023 } })).toEqual({ year: 4, season: 2026 })
    expect(dynastySeasonClock({ season: 2026, sport: 'NFL', settings: { startup_season: 2026 } })).toEqual({ year: 1, season: 2026 })
  })

  it('falls back to the season the league was created into', () => {
    expect(dynastySeasonClock({ season: 2026, sport: 'NFL', createdAt: '2024-06-01T12:00:00Z', settings: {} })).toEqual({ year: 3, season: 2026 })
  })

  it('is null rather than a guess when either end is missing or the result is below Year 1', () => {
    expect(dynastySeasonClock({ season: null, sport: 'NFL', settings: { startup_season: 2023 } })).toBeNull()
    expect(dynastySeasonClock({ season: 2026, sport: 'NFL', settings: {} })).toBeNull()
    expect(dynastySeasonClock({ season: 2024, sport: 'NFL', settings: { startup_season: 2026 } })).toBeNull()
  })
})

describe('draft-order notices', () => {
  it('reads the randomized order and the rookie notice from server-written metadata', () => {
    expect(readDynastyDraftOrderNotice(MESSAGES[1].metadata)).toEqual({ kind: 'randomized', order: ['Comets', 'Hawks', ''] })
    expect(readDynastyDraftOrderNotice(MESSAGES[2].metadata, 'host_announcement')).toEqual({ kind: 'rookie', final: true })
  })

  it('refuses a rookie notice that is not a host announcement', () => {
    expect(readDynastyDraftOrderNotice(MESSAGES[3].metadata, 'text')).toBeNull()
    expect(readDynastyDraftOrderNotice({ ...MESSAGES[2].metadata, senderIsHost: false }, 'host_announcement')).toBeNull()
    expect(readDynastyDraftOrderNotice({ tradeCard: TRADE_CARD }, 'trade')).toBeNull()
  })
})

describe('pick chips', () => {
  it('R1 is gold, later rounds and unknown rounds are the line outline', () => {
    expect(pickChipTone(1)).toBe('first')
    expect(pickChipTone(2)).toBe('later')
    expect(pickChipTone(null)).toBe('unknown')
    expect(pickSlotLabel(1, 4)).toBe('1.04')
  })

  it('renders the round, the season and the origin it is given — and nothing it is not', () => {
    const { unmount } = render(<DynastyPickChip round={1} season={2026} via="Tide" />)
    const first = screen.getByTestId('dynasty-pick-chip')
    expect(first.getAttribute('data-tone')).toBe('first')
    expect(first.textContent).toBe('2026 R1 · via Tide')
    unmount()

    const { unmount: u2 } = render(<DynastyPickChip round={2} season={2027} />)
    const later = screen.getByTestId('dynasty-pick-chip')
    expect(later.getAttribute('data-tone')).toBe('later')
    expect(later.textContent).toBe('2027 R2')
    u2()

    render(<DynastyPickChip />)
    const bare = screen.getByTestId('dynasty-pick-chip')
    expect(bare.getAttribute('data-tone')).toBe('unknown')
    expect(bare.textContent).toBe('Pick')
  })
})

describe('the completed trade card', () => {
  it('in a dynasty league: the eyebrow, and one plain chip per pick the card counted', () => {
    const { container } = render(<TradeCardView card={TRADE_CARD as TradeCard} dynasty />)
    expect(screen.getByText('Trade accepted')).toBeTruthy()
    const chips = screen.getAllByTestId('dynasty-pick-chip')
    expect(chips).toHaveLength(2)
    /* The card stores a count, never a round — no chip may claim to be a first. */
    expect(chips.every((c) => c.getAttribute('data-tone') === 'unknown')).toBe(true)
    expect(container.textContent).not.toContain('2 picks')
    expect(container.querySelector('.af-cm-trade')!.getAttribute('data-dynasty')).toBe('true')
  })

  it('everywhere else: exactly the old card', () => {
    const { container } = render(<TradeCardView card={TRADE_CARD as TradeCard} />)
    expect(container.textContent).toContain('2 picks')
    expect(screen.queryByText('Trade accepted')).toBeNull()
    expect(screen.queryByTestId('dynasty-pick-chip')).toBeNull()
    expect(container.querySelector('.af-cm-trade')!.hasAttribute('data-dynasty')).toBe(false)
  })
})

describe('LeagueChatPanel', () => {
  it('a dynasty league gets the ink room, the clock, labelled channels and the event cards', async () => {
    render(<LeagueChatPanel leagueId="L1" leagueName="Gridiron Dynasty" dynastyBackground dynastyClock={{ year: 4, season: 2026 }} channels />)
    await screen.findByText('Taxi call-ups are due Sunday')

    const panel = screen.getByTestId('league-chat-panel')
    expect(panel.getAttribute('data-dynasty-background')).toBe('true')
    expect(panel.getAttribute('style')).toContain('radial-gradient')
    const header = screen.getByTestId('dynasty-chat-header')
    expect(within(header).getByText('Gridiron Dynasty')).toBeTruthy()
    expect(screen.getByTestId('dynasty-chat-clock').textContent).toBe('Year 4 · 2026')
    expect(screen.getByTestId('league-chat-channel-trades').textContent).toBe('Trade block')
    expect(screen.getByTestId('league-chat-channel-general').textContent).toBe('League')

    expect(within(row('trade1')).getByText('Trade accepted')).toBeTruthy()
    expect(within(row('trade1')).getAllByTestId('dynasty-pick-chip')).toHaveLength(2)

    const order = within(row('order1')).getByTestId('dynasty-draft-order-card')
    expect(within(order).getByText('Draft order set')).toBeTruthy()
    const slots = within(order).getAllByTestId('dynasty-pick-chip')
    expect(slots.map((s) => s.textContent)).toEqual(['1.01Comets', '1.02Hawks', '1.03Open slot'])
    expect(slots.every((s) => s.getAttribute('data-tone') === 'first')).toBe(true)
    /* The announcement's own words still read in the bubble. */
    expect(within(row('order1')).getByText('Draft order randomized 3 times.')).toBeTruthy()

    expect(within(row('rookie1')).getByText('Rookie draft order set')).toBeTruthy()
    expect(within(row('spoof1')).queryByTestId('dynasty-draft-order-card')).toBeNull()
    /* Chimmy keeps its avatar; the dynasty look is the stylesheet's, scoped to the panel. */
    expect(within(row('trade1')).getByTestId('chimmy-avatar')).toBeTruthy()
  })

  it('omits the clock when it cannot be derived', async () => {
    render(<LeagueChatPanel leagueId="L1" leagueName="Gridiron Dynasty" dynastyBackground />)
    await screen.findByText('Taxi call-ups are due Sunday')
    expect(screen.getByTestId('dynasty-chat-header')).toBeTruthy()
    expect(screen.queryByTestId('dynasty-chat-clock')).toBeNull()
  })

  it('a non-dynasty league renders none of it', async () => {
    render(<LeagueChatPanel leagueId="L1" leagueName="Sunday Squad" dynastyClock={{ year: 4, season: 2026 }} channels />)
    await screen.findByText('Taxi call-ups are due Sunday')

    const panel = screen.getByTestId('league-chat-panel')
    expect(panel.hasAttribute('data-dynasty-background')).toBe(false)
    expect(panel.getAttribute('style')).not.toContain('radial-gradient')
    expect(screen.queryByTestId('dynasty-chat-header')).toBeNull()
    expect(screen.queryByTestId('dynasty-chat-clock')).toBeNull()
    expect(screen.getByTestId('league-chat-channel-trades').textContent).toBe('# trades')
    expect(screen.queryByText('Trade accepted')).toBeNull()
    expect(screen.queryByTestId('dynasty-pick-chip')).toBeNull()
    expect(screen.queryByTestId('dynasty-draft-order-card')).toBeNull()
    expect(within(row('trade1')).getByText(/2 picks/)).toBeTruthy()
  })
})
