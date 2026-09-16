// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LeagueTabs } from '@/components/core-app/LeagueTabs'
import { LEAGUE_SCREEN_KEYS, isLeagueScreen } from '@/lib/core-app/leagueScreens'
import { CORE_SURFACE_KEYS } from '@/lib/core-app/coreSurface'

// The tab bar mounts a client prewarm that needs the app router.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
}))

afterEach(() => cleanup())

describe('LEAGUE_SCREEN_KEYS', () => {
  it('is exactly the set of screens the in-league tab bar links to', () => {
    const { container } = render(
      <LeagueTabs leagueId="L1" leagueName="League" activeKey="home" hasScoredWeek tradeSupported draftSupported />,
    )
    const keys = new Set(
      [...container.querySelectorAll('a[href^="/core"]')].map((a) => {
        const path = new URL(a.getAttribute('href')!, 'http://x').pathname
        return path === '/core' ? 'home' : path.replace(/^\/core\//, '')
      }),
    )
    expect([...keys].sort()).toEqual([...LEAGUE_SCREEN_KEYS].sort())
  })

  it('leaves out the cross-league surfaces a league picker must not keep you on', () => {
    for (const key of ['portfolio', 'notifications', 'tools', 'rankings', 'career', 'sync']) {
      expect(CORE_SURFACE_KEYS as readonly string[]).toContain(key)
      expect(isLeagueScreen(key)).toBe(false)
    }
    expect(isLeagueScreen('trades')).toBe(true)
  })
})
