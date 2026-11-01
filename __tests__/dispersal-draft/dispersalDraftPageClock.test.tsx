/**
 * The dispersal draft page reads the server's deadline (`pickDeadlineAt`), so polling no longer restarts the clock,
 * and any viewer's page asks the server to move on a pick whose clock has run out.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useParams: () => ({ leagueId: 'L', draftId: 'd1' }) }))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import DispersalDraftLivePage from '@/app/league/[leagueId]/dispersal-draft/[draftId]/page'

const state = (over: Record<string, unknown> = {}) => ({
  id: 'd1', leagueId: 'L', scenario: 'orphan', status: 'in_progress', participantRosterIds: ['r-me', 'r-other'], passedRosterIds: [],
  draftOrder: ['r-other', 'r-me'], currentPickIndex: 0, totalRounds: 1, picksPerRound: 2, assetPool: [], sourceRosterIds: ['orphan'],
  picks: [], currentRosterId: 'r-other', currentPickNumber: 1, isComplete: false, startedAt: null, completedAt: null,
  pickTimeSeconds: 120, autoPickOnTimeout: true, pickDeadlineAt: new Date(Date.now() + 90_000).toISOString(), ...over,
})

function stub(draft: ReturnType<typeof state>) {
  const patches: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    if (init?.method === 'PATCH') {
      patches.push(JSON.parse(String(init.body)))
      return { ok: true, json: async () => ({ state: structuredClone(draft) }) }
    }
    if (u.includes('/roster/me')) return { ok: true, json: async () => ({ rosterId: 'r-me' }) }
    if (u.includes('/api/league/settings')) return { ok: true, json: async () => ({ league: { teams: [] } }) }
    // A fresh object on every poll, as the real route returns.
    return { ok: true, json: async () => structuredClone(draft) }
  }))
  return patches
}

beforeEach(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the dispersal draft page clock', { timeout: 15_000 }, () => {
  it('counts down to the server’s deadline for everyone, not a fresh pick time on each poll', async () => {
    stub(state())
    render(<DispersalDraftLivePage />)
    const clock = await screen.findByTestId('dispersal-clock-others')
    await waitFor(() => expect(clock.textContent).toMatch(/01:(29|30) left/))
  })

  it('🛑 another team’s expired clock: the page asks the server to move on, once — not on every poll', async () => {
    const patches = stub(state({ pickDeadlineAt: new Date(Date.now() - 5_000).toISOString() }))
    render(<DispersalDraftLivePage />)
    await waitFor(() => expect(patches).toEqual([{ action: 'advance_expired' }]))
    // Past one 3-second poll, which hands the page a new state object.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 3600))
    })
    expect(patches).toEqual([{ action: 'advance_expired' }])
  })

  it('no clock (none set), no nudge', async () => {
    const patches = stub(state({ pickDeadlineAt: null, pickTimeSeconds: 0 }))
    render(<DispersalDraftLivePage />)
    await screen.findByText(/is on the clock/)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200))
    })
    expect(patches).toEqual([])
  })
})
