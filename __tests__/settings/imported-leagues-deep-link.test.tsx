// @vitest-environment jsdom
/**
 * League Imports consumer behavior: the panel renders a safe external source-platform link for an
 * imported league (no regression to PR #347's refresh polling — this test never clicks Resync, so the
 * saved-league snapshot simply renders).
 */
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: unknown }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}))

import { ImportedLeaguesPanel } from '@/app/settings/components/sections/ImportedLeaguesPanel'

const LEAGUE = {
  id: 'L1', name: 'HailShiva', platform: 'sleeper', platformLeagueId: '131353',
  hasUnifiedRecord: true, navigationLeagueId: 'L1', season: 2026, teamCount: 12, syncStatus: 'synced',
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ImportedLeaguesPanel — source-platform deep link', () => {
  it('renders a safe external "Open in Sleeper" link for an imported Sleeper league', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => (String(url).includes('/api/league/list') ? { leagues: [LEAGUE] } : {}),
      })) as unknown as typeof fetch,
    )
    render(<ImportedLeaguesPanel />)
    const link = await screen.findByRole('link', { name: /open hailshiva in sleeper/i })
    expect(link.getAttribute('href')).toBe('https://sleeper.com/leagues/131353/league')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    // The internal "Open" (AF app) link still exists and stays internal — not the external one.
    expect(screen.getByRole('link', { name: /^Open$/ }).getAttribute('href')).toBe('/league/L1')
  })
})
