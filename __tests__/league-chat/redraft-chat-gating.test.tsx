import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

/*
 * Redraft League chat (batch A4) is GATED: the event cards, the framed Chimmy bubbles, the pinned
 * score and the `.rdc` scope appear only when LeagueShell passes `redraftSport`. Every other league,
 * the comms drawer and the draft room render the same conversation and must not change. Driven
 * against the harness fixture (the wire shape /api/league/chat returns), fetch answered BY URL.
 */

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u-me' } }, status: 'authenticated' }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/league/L1',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/chimmy', () => ({ ChimmyChatShell: () => <div data-testid="chimmy-shell" /> }))
vi.mock('@/components/commish/BroadcastModal', () => ({ default: () => null }))

import LeagueChatSurface from '@/components/chat/LeagueChatSurface'
import { fixtureMatchup, fixtureMessages } from '@/app/e2e/redraft-league/chat/redraftChatFixture'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/api/app/leagues/L1/chat')) return json({ viewerUserId: 'u-me', presence: [], messages: fixtureMessages('NFL') })
      if (u.includes('/pinned')) return json({ pinned: [] })
      if (u.includes('/typing')) return json({ typing: [] })
      return json({})
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function row(id: string): HTMLElement {
  const el = document.querySelector(`[data-message-id="${id}"]`)
  if (!el) throw new Error(`no row ${id}`)
  return el as HTMLElement
}

async function mount(redraft: boolean) {
  render(
    <LeagueChatSurface
      leagueId="L1"
      leagueName="Sunday Night Redraft"
      platform="allfantasy"
      isCommissioner
      teamCount={12}
      importedLeagueCount={0}
      {...(redraft ? { redraftSport: 'nfl' as const, matchup: fixtureMatchup('NFL') } : {})}
    />,
  )
  await screen.findByText('fourteen bucks well spent')
}

describe('redraft league chat — off unless the league is a native redraft league', () => {
  it('without redraftSport: no scope, no cards, no pinned score; notices stay bubbles', async () => {
    await mount(false)
    expect(screen.getByTestId('league-chat-surface').classList.contains('rdc')).toBe(false)
    expect(screen.getByTestId('league-chat-surface').hasAttribute('data-rd-chat')).toBe(false)
    expect(document.querySelectorAll('[data-rd-event]').length).toBe(0)
    expect(document.querySelectorAll('[data-event-kind]').length).toBe(0)
    expect(document.querySelectorAll('.af-cm-row-system').length).toBe(0)
    expect(screen.queryByTestId('redraft-chat-pinned-score')).toBeNull()
    // The trade notice is still drawn exactly as before: the owner's bubble.
    expect(within(row('fx-trade-accepted')).getByRole('article')).toBeTruthy()
  })

  it('with redraftSport: authorless notices are system-row cards with their data', async () => {
    await mount(true)
    expect(screen.getByTestId('league-chat-surface').classList.contains('rdc')).toBe(true)
    const cards = [...document.querySelectorAll('[data-rd-event]')].map(el => [el.getAttribute('data-rd-event'), el.closest('[data-message-id]')?.getAttribute('data-message-id')])
    expect(cards).toEqual([
      ['trade', 'fx-trade-accepted'],
      ['claim', 'fx-claim-won'],
      ['claim', 'fx-fa-added'],
      ['score', 'fx-final'],
    ])
    for (const id of ['fx-trade-accepted', 'fx-claim-won', 'fx-fa-added', 'fx-final']) {
      expect(row(id).classList.contains('af-cm-row-system')).toBe(true)
      // A system row has no bubble and no actions.
      expect(row(id).querySelector('.af-cm-bubble')).toBeNull()
      expect(row(id).querySelector('.af-cm-hoverbar')).toBeNull()
    }
    expect(within(row('fx-trade-accepted')).getByText('Trade accepted')).toBeTruthy()
    expect(within(row('fx-claim-won')).getByText(/\$14 FAAB/)).toBeTruthy()
    expect(within(row('fx-fa-added')).queryByText(/FAAB/)).toBeNull()
    expect(within(row('fx-final')).getByTestId('redraft-chat-event-score').textContent).toContain('98.6')
  })

  it("with redraftSport: Chimmy's trade take and recap stay messages you can act on", async () => {
    await mount(true)
    expect(row('fx-chimmy-trade').getAttribute('data-event-kind')).toBe('trade')
    expect(row('fx-recap').getAttribute('data-event-kind')).toBe('recap')
    // Still a bubble with the actions sheet (react, reply, pin…).
    fireEvent.keyDown(within(row('fx-chimmy-trade')).getByRole('article'), { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    // People's own messages are untouched rows.
    expect(row('fx-own').getAttribute('data-mine')).toBe('true')
    expect(row('fx-own').hasAttribute('data-event-kind')).toBe(false)
  })

  it('with redraftSport and a matchup: the score is pinned from the snapshot', async () => {
    await mount(true)
    const pinned = screen.getByTestId('redraft-chat-pinned-score')
    expect(pinned.getAttribute('aria-label')).toBe('Live: Fourth & Long 98.6, Gridiron Ghosts 87.2')
  })
})
