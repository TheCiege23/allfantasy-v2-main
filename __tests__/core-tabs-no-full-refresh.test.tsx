/**
 * Clicking a /core tab repainted the WHOLE app — rail, nav and league tabs — as a skeleton, then
 * rebuilt it (reported 2026-09-25 on KBFL: "the whole page refreshed visually").
 *
 * Cause: `loading.tsx` lived inside the `[[...screen]]` segment, and Next keys a segment's loading
 * boundary on the child segment's value, so each tab mounted a fresh boundary. It now lives above
 * the `(shell)` route group, whose key does not change between tabs, and the shell answers the
 * wait itself: the clicked link lights up and only the screen area swaps to its skeleton.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CoreNavPendingContext, CoreScreenArea, pendingCoreNavTarget } from '@/components/core-app/coreNavPending'

const ROOT = process.cwd()
const click = {
  button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: null, download: false,
}
const HERE = 'https://allfantasy.ai/core/matchup?league=L1'

describe('which clicks raise the pending state', () => {
  it('a plain click to another /core screen is a navigation to wait for', () => {
    expect(pendingCoreNavTarget({ ...click, href: '/core/trades?league=L1', currentHref: HERE })).toBe('/core/trades?league=L1')
    expect(pendingCoreNavTarget({ ...click, href: '/core?league=L2', currentHref: HERE })).toBe('/core?league=L2')
  })

  it('the same league on another screen, and another league on the same screen, both count', () => {
    expect(pendingCoreNavTarget({ ...click, href: '/core/matchup?league=L2', currentHref: HERE })).toBe('/core/matchup?league=L2')
  })

  it('🛑 the page already open never counts — it would hold a skeleton that no navigation clears', () => {
    expect(pendingCoreNavTarget({ ...click, href: '/core/matchup?league=L1', currentHref: HERE })).toBeNull()
    expect(pendingCoreNavTarget({ ...click, href: '/core/matchup?league=L1#coverage', currentHref: HERE })).toBeNull()
  })

  it('a click the browser handles itself (new tab, modifier, other button, download) never counts', () => {
    const href = '/core/trades?league=L1'
    expect(pendingCoreNavTarget({ ...click, href, currentHref: HERE, metaKey: true })).toBeNull()
    expect(pendingCoreNavTarget({ ...click, href, currentHref: HERE, ctrlKey: true })).toBeNull()
    expect(pendingCoreNavTarget({ ...click, href, currentHref: HERE, shiftKey: true })).toBeNull()
    expect(pendingCoreNavTarget({ ...click, href, currentHref: HERE, altKey: true })).toBeNull()
    expect(pendingCoreNavTarget({ ...click, href, currentHref: HERE, button: 1 })).toBeNull()
    expect(pendingCoreNavTarget({ ...click, href, currentHref: HERE, target: '_blank' })).toBeNull()
    expect(pendingCoreNavTarget({ ...click, href, currentHref: HERE, download: true })).toBeNull()
    expect(pendingCoreNavTarget({ ...click, href, currentHref: HERE, target: '_self' })).toBe(href)
  })

  it('leaving /core, or leaving the site, is not a /core screen change', () => {
    expect(pendingCoreNavTarget({ ...click, href: '/settings', currentHref: HERE })).toBeNull()
    expect(pendingCoreNavTarget({ ...click, href: '/import', currentHref: HERE })).toBeNull()
    expect(pendingCoreNavTarget({ ...click, href: '/corefake', currentHref: HERE })).toBeNull()
    expect(pendingCoreNavTarget({ ...click, href: 'https://sleeper.com/core/x', currentHref: HERE })).toBeNull()
    expect(pendingCoreNavTarget({ ...click, href: null, currentHref: HERE })).toBeNull()
  })
})

describe('the screen area', () => {
  it('shows the screen normally', () => {
    render(
      <CoreNavPendingContext.Provider value={false}>
        <CoreScreenArea><p>Trade Center</p></CoreScreenArea>
      </CoreNavPendingContext.Provider>,
    )
    expect(screen.getByText('Trade Center')).toBeVisible()
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it('swaps to the screen skeleton while a navigation is in flight, keeping the screen mounted but hidden', () => {
    render(
      <CoreNavPendingContext.Provider value={true}>
        <CoreScreenArea><p>Trade Center</p></CoreScreenArea>
      </CoreNavPendingContext.Provider>,
    )
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    // Still mounted — an abandoned navigation gives back exactly the screen that was left.
    expect(screen.getByText('Trade Center')).toBeInTheDocument()
    expect(screen.getByText('Trade Center')).not.toBeVisible()
  })
})

/** Every `loading.tsx` under a directory, as repo-relative paths. */
function loadingFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...loadingFiles(full))
    else if (name === 'loading.tsx') out.push(full.slice(ROOT.length + 1).replace(/\\/g, '/'))
  }
  return out
}

describe('where the /core loading boundary lives', () => {
  it('🛑 there is exactly one, above the (shell) group — none inside it, where it would be keyed per tab', () => {
    expect(loadingFiles(resolve(ROOT, 'app/core'))).toEqual(['app/core/loading.tsx'])
    expect(existsSync(resolve(ROOT, 'app/core/(shell)/[[...screen]]/page.tsx'))).toBe(true)
  })

  it('the page wraps its screen in the area that answers a click, and the tabs opt in', () => {
    const page = readFileSync(resolve(ROOT, 'app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')
    expect(page).toMatch(/<CoreScreenArea>\s*<CoreScreenErrorBoundary/)
    const tabs = readFileSync(resolve(ROOT, 'components/core-app/LeagueTabs.tsx'), 'utf8')
    // Both the full strip and the compact (league-first) strip.
    expect(tabs.match(/className="af-lt-tab"\s+(?:\/\*[\s\S]*?\*\/\s+)?data-core-nav=""/g)?.length).toBe(2)
    const shell = readFileSync(resolve(ROOT, 'components/core-app/AfCoreShell.tsx'), 'utf8')
    for (const cls of ['af-rail-tile af-platform', 'af-nav-item', 'af-tabbar-item']) {
      expect(shell).toMatch(new RegExp(`className="${cls}"\\s+data-core-nav=""`))
    }
    expect(shell).toMatch(/onClickCapture=\{markNavigation\}/)
  })
})
