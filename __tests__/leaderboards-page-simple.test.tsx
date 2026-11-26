import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** /leaderboards on a phone (2026-11-25, the simplify pass). */
import LeaderboardsPage from '@/app/leaderboards/page'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      entries: [
        { rank: 1, managerId: 'mgr-1', displayName: 'Draft Ace', value: 3.9, extra: { count: 3, grade: 'A' } },
        { rank: 2, managerId: 'mgr-2-abcdefghijkl', displayName: null, value: 3.8, extra: { count: 4, grade: 'A-' } },
      ],
      total: 412,
      generatedAt: new Date().toISOString(),
    }),
  })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/leaderboards', () => {
  it('short tab labels two across on a phone, the full name over the list, no intro', async () => {
    render(<LeaderboardsPage />)
    const tabs = screen.getByTestId('leaderboards-tabs')
    expect(tabs.className).toMatch(/(^|\s)grid-cols-2(\s|$)/)
    expect(screen.getByTestId('leaderboards-tab-championships').textContent).toBe('Titles')
    expect((await screen.findByTestId('leaderboards-current-board')).textContent).toBe('Best draft grades')
    expect(document.body.textContent).not.toMatch(/Best draft grades, most championships/)
    expect(document.body.textContent).not.toMatch(/Deterministic metrics/)
  })

  it('each row is the name, then one detail line; a nameless manager is not shown by id', async () => {
    render(<LeaderboardsPage />)
    expect((await screen.findByTestId('leaderboards-row-detail-1')).textContent).toBe('Grade A · 3 seasons')
    const row2 = screen.getByTestId('leaderboards-row-2')
    expect(row2.textContent).toContain('Unnamed manager')
    expect(row2.textContent).not.toContain('mgr-2-abcdef')
  })
})
