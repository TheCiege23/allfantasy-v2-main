import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * Where the activation and phone-alert asks surface: the decision queue's empty state, the import's
 * success screen, the weekly emails, and the chat bubble under Chimmy's latest answer.
 */

const push = vi.hoisted(() => ({ subscribe: vi.fn() }))
vi.mock('@/lib/push-notifications/useWebPushSubscription', () => ({
  useWebPushSubscription: () => ({ supported: true, permission: 'default', subscribed: false, busy: false, error: null, subscribe: push.subscribe, unsubscribe: vi.fn() }),
}))
vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import { DecisionQueue } from '@/components/core-app/home/DecisionQueue'
import { ImportDone } from '@/components/core-app/import/ImportDone'
import { renderLineupCheck } from '@/lib/chimmy-alerts/lineupCheck'
import { renderWaiverCheck } from '@/lib/chimmy-alerts/waiverCheck'
import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

describe('the decision queue with no leagues', () => {
  it('does not call an unreadable account "all clear"', () => {
    const { rerender } = render(<DecisionQueue issues={[]} scopeLabel="All leagues" scopeKey="all" nowIso="2026-09-25T00:00:00Z" noLeagues />)
    expect(screen.getByText('Nothing to decide yet.')).toBeTruthy()
    expect(screen.queryByText('Nothing is waiting on you.')).toBeNull()
    rerender(<DecisionQueue issues={[]} scopeLabel="All leagues" scopeKey="all" nowIso="2026-09-25T00:00:00Z" />)
    expect(screen.getByText('Nothing is waiting on you.')).toBeTruthy()
  })
})

describe('the import success screen', () => {
  it("offers Chimmy's lineup check in the league just connected", () => {
    render(
      <ImportDone
        providerLabel="Sleeper"
        leagueHref="/core?league=lg_1"
        stats={[]}
        onImportAnother={vi.fn()}
        chimmyAction={{ href: '/chimmy/chat?leagueId=lg_1', label: 'Have Chimmy check your lineup' }}
      />,
    )
    expect(screen.getByTestId('import-done-chimmy').getAttribute('href')).toBe('/chimmy/chat?leagueId=lg_1')
  })
})

describe('the weekly emails', () => {
  it('both end with a way to get them on your phone', () => {
    const lineup = renderLineupCheck(
      [{ leagueId: 'L1', leagueName: 'Ice Kings', week: 3, issues: [{ kind: 'empty_slots', count: 1 }] }],
      { baseUrl: 'https://allfantasy.ai' },
    )!
    const waivers = renderWaiverCheck(
      [
        {
          leagueId: 'L1',
          leagueName: 'Ice Kings',
          week: 4,
          netGain: 4,
          faabRemaining: null,
          add: { playerId: 'a', name: 'A', position: 'RB', team: 'PIT', imageUrl: null, projected: 12, ownPct: null, startPct: null },
          drop: { playerId: 'd', name: 'D', position: 'WR', team: 'NYJ', imageUrl: null, projected: 8, ownPct: null, startPct: null },
        },
      ],
      { baseUrl: 'https://allfantasy.ai' },
    )!
    for (const html of [lineup.email.html, waivers.email.html]) {
      expect(html).toContain('href="https://allfantasy.ai/core/notifications"')
      expect(html).toContain('Turn on alerts')
    }
  })
})

describe('the chat bubble', () => {
  it('asks for phone alerts under the latest delivered answer, not under a refusal', async () => {
    let answer = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url)
        if (u === '/api/push/subscribe') return json(200, { configured: true, vapidPublicKey: 'BKEY' })
        if (u === '/api/ai/events') return json(200, { ok: true })
        if (u === '/api/chat/chimmy' && init?.method === 'POST') {
          return answer
            ? json(200, { response: 'Start Warren.', meta: { toolsUsed: ['get_roster'] } })
            : json(412, { error: 'needs league', details: { message: 'Which league?' } })
        }
        return json(200, {})
      }),
    )
    render(<CommsDrawer open onClose={vi.fn()} mode="overlay" leagues={[]} pageLeagueId={null} chimmyTokenCost={9} initialTab="chimmy" />)
    const ask = (q: string) => {
      const input = screen.getByLabelText('Message')
      fireEvent.change(input, { target: { value: q } })
      fireEvent.submit(input.closest('form')!)
    }
    ask('Who do I start?')
    await waitFor(() => expect(screen.getByText('Start Warren.')).toBeTruthy())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn on alerts' })).toBeTruthy())

    answer = false
    ask('And the other league?')
    await waitFor(() => expect(screen.getByText('Which league?')).toBeTruthy())
    // The latest turn is a refusal: no ask under it, and none left under the older answer either.
    expect(screen.queryByRole('button', { name: 'Turn on alerts' })).toBeNull()
  })
})
