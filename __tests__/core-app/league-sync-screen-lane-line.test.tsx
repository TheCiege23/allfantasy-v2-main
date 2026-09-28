// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncPauseButton', () => ({ default: () => null }))

import { LeagueSync } from '@/components/core-app/screens/LeagueSync'
import type { LeagueSyncResult } from '@/lib/core-app/leagueSync'

function data(rostersReadAt: Date | null): LeagueSyncResult {
  const now = Date.now()
  return {
    available: true,
    syncKey: null,
    syncPaused: false,
    league: { id: 'l1', name: 'Test League', platform: 'sleeper' },
    connectedSince: null,
    seasonsOnFile: { available: false, reason: 'none' },
    status: 'ok',
    lastReadAt: new Date(now - 200 * 60_000),
    rostersReadAt,
    lastAttemptedAt: null,
    consecutiveFailures: 0,
    lastError: null,
    rows: [],
    coarse: false,
    orphanedRun: null,
  }
}

describe('Sync screen header', () => {
  it('shows the rosters & transactions read under the full read', () => {
    const html = renderToStaticMarkup(
      <LeagueSync data={data(new Date(Date.now() - 4 * 60_000))} manageHref="/import" />,
    )
    expect(html).toContain('Last full read')
    expect(html).toContain('3h ago')
    expect(html).toMatch(/Rosters &amp; transactions\s*<span[^>]*>4m ago<\/span>/)
  })

  it('keeps the old single line when the lane has never read this league', () => {
    const html = renderToStaticMarkup(<LeagueSync data={data(null)} manageHref="/import" />)
    expect(html).toContain('>Last read<')
    expect(html).not.toContain('Rosters &amp; transactions')
  })
})
