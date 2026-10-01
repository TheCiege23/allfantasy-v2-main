import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('code=ABC123&focus=rivalry'),
}))

vi.mock('@/lib/analytics/client', () => ({ sendProductAnalyticsBeacon: vi.fn() }))

import JoinByCodePage from '@/app/join/page'

describe('activity-focused league invitation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/preview?')) return { ok: true, json: async () => ({ leagueId: 'L1', name: 'League One', sport: 'NFL', requiresPassword: false }) }
      if (url === '/api/leagues/join') return { ok: false, status: 401, json: async () => ({ error: 'Sign in to join a league' }) }
      return { ok: true, json: async () => ({}) }
    }))
  })

  it('keeps the invite and rivalry destination through account creation', async () => {
    render(<JoinByCodePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Join league' }))
    const account = await screen.findByRole('link', { name: 'Create account' })
    expect(account.getAttribute('href')).toBe('/signup?callbackUrl=%2Fjoin%3Fcode%3DABC123%26focus%3Drivalry')
    expect(screen.getByText(/explore rivalries/)).toBeTruthy()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/leagues/join', expect.any(Object)))
  })
})
