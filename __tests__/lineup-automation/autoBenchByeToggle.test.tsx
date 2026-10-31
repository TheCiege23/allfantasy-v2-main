/** The lineup screen's "bench my starters on bye automatically" switch. */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

import { AutoBenchByeToggle } from '@/components/league/native/screens/AutoBenchByeToggle'

const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response

afterEach(() => vi.unstubAllGlobals())

describe('AutoBenchByeToggle', () => {
  it('shows the owner’s current setting and saves a change', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? json({ on: true }) : json({ available: true, on: false })))
    vi.stubGlobal('fetch', fetchMock)
    render(<AutoBenchByeToggle leagueId="L1" />)
    const box = (await screen.findByRole('checkbox')) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    await waitFor(() => expect(box.checked).toBe(true))
    const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')!
    expect(put[0]).toBe('/api/league/auto-bench-bye')
    expect(JSON.parse(String(put[1]!.body))).toEqual({ leagueId: 'L1', on: true })
  })

  it('is hidden in a league that cannot use it', async () => {
    const fetchMock = vi.fn(async () => json({ available: false, on: false, reason: 'daily_lineups' }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<AutoBenchByeToggle leagueId="L1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="auto-bench-bye-toggle"]')).toBeNull()
  })
})
