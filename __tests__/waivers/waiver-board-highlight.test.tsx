import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

/* Arriving from the home's "Add <player> in <league>" button: ?player=9493&out=12500 */
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('player=9493&out=12500'),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/core/waivers',
}))

import { WaiverLineupBoard } from '@/components/core-app/WaiverLineupBoard'

const PAYLOAD = {
  state: 'ok',
  season: '2026',
  week: 7,
  currentLineupPoints: 120,
  candidates: [
    { sleeperId: '9493', name: 'Puka Nacua', position: 'WR', team: 'LAR', projectedPoints: 16, gain: 6.1, displaces: null },
    { sleeperId: '1', name: 'Someone Else', position: 'RB', team: 'SF', projectedPoints: 9, gain: 2, displaces: null },
  ],
  notes: [],
}

afterEach(() => vi.unstubAllGlobals())

describe('WaiverLineupBoard — the add the home button named', () => {
  it('prices the board with the injured starter at zero and highlights the named add', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => PAYLOAD }))
    vi.stubGlobal('fetch', fetchMock as never)
    const { container } = render(<WaiverLineupBoard leagueId="g26" />)
    await waitFor(() => expect(container.querySelector('[data-highlight="true"]')).toBeTruthy())
    expect(container.querySelector('[data-highlight="true"]')?.getAttribute('data-wlb-player')).toBe('9493')
    expect(container.querySelectorAll('[data-highlight="true"]').length).toBe(1)
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0])).filter((u) => u.includes('view=waiver-board'))
    expect(urls[0]).toContain('&unavailable=12500')
  })
})
