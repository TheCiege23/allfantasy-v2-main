// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncPauseButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/RemoveLeagueButton', () => ({
  default: () => <button data-testid="remove-league">Remove from My Leagues</button>,
}))

import { LeagueSync } from '@/components/core-app/screens/LeagueSync'
import type { LeagueSyncResult } from '@/lib/core-app/leagueSync'

function data(rostersReadAt: Date | null, extra: Partial<Extract<LeagueSyncResult, { available: true }>> = {}): LeagueSyncResult {
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
    providerGone: null,
    canRemove: false,
    ...extra,
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

describe('Sync screen: the provider deleted this league', () => {
  const goneData = (canRemove: boolean) =>
    data(null, {
      status: 'gone',
      lastReadAt: null,
      consecutiveFailures: 3,
      lastError: 'league gone at provider: Sleeper returned no league',
      providerGone: { checkedAt: new Date('2026-09-28T02:00:00Z'), detail: 'Sleeper returned no league' },
      canRemove,
    })

  it('says what happened and offers the actions that can fix it', () => {
    const html = renderToStaticMarkup(<LeagueSync data={goneData(true)} manageHref="/import" />)
    expect(html).toContain('Gone from Sleeper')
    expect(html).toContain('Sleeper no longer has this league')
    expect(html).toContain('href="/import"')
    expect(html).toContain('Import the new league')
    expect(html).toContain('data-testid="remove-league"')
    // The generic retry alert says "Reconnecting the platform is usually what fixes it" — which
    // is false for a deleted league, so it must not render beside the honest one.
    expect(html).not.toContain('failed runs in a row')
    expect(html).not.toContain('Never synced')
  })

  it('does not offer removal on a row the viewer did not import', () => {
    const html = renderToStaticMarkup(<LeagueSync data={goneData(false)} manageHref="/import" />)
    expect(html).toContain('Sleeper no longer has this league')
    expect(html).not.toContain('data-testid="remove-league"')
  })

  it('renders nothing new for a healthy league', () => {
    const html = renderToStaticMarkup(<LeagueSync data={data(null)} manageHref="/import" />)
    expect(html).not.toContain('no longer has this league')
  })
})
