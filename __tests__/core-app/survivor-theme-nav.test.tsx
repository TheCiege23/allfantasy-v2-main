import { cleanup, render } from '@testing-library/react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * A Survivor league's tabs are named after the show, and it has no Defense Hub (the owner's call,
 * 2026-10-31). Every other league keeps the standard names, so the rename must follow the SELECTED
 * league and nothing else.
 */

const nav = vi.hoisted(() => ({ router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} } }))
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'
import {
  SURVIVOR_NAV_LABELS,
  leagueThemeForTypeKey,
  themeNavItems,
  themeSectionHeading,
} from '@/lib/core-app/survivorTheme'

afterEach(cleanup)

const LEAGUES = [{ id: 'l1', name: 'The Outcast Isles', platform: 'allfantasy', mark: 'O' }]

function shell(props: Record<string, unknown>) {
  // One shell at a time: a second mounted shell renders no section nav of its own.
  cleanup()
  const { container } = render(
    <AfCoreShell active="home" leagues={LEAGUES as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} selectedLeagueId="l1" hasIdpDefense {...props}>
      <div>screen</div>
    </AfCoreShell>,
  )
  const nav = container.querySelector('#af-nav') as HTMLElement
  return {
    root: container.querySelector('.af-shell') as HTMLElement,
    labels: Array.from(nav.querySelectorAll('.af-nav-label')).map((n) => n.textContent),
    headings: Array.from(nav.querySelectorAll('.af-nav-heading')).map((n) => n.textContent),
    hrefs: Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? ''),
  }
}

describe('the shell in a Survivor league', () => {
  it('names the tabs after the show, keeps every link, and hides Defense Hub', () => {
    const standard = shell({})
    const survivor = shell({ leagueTheme: 'survivor' })

    expect(standard.labels).toContain('Defense Hub')
    expect(survivor.labels).not.toContain('Defense Hub')
    expect(survivor.hrefs.some((h) => h.startsWith('/core/defense-hub'))).toBe(false)

    for (const name of ['Camp', 'Your shelter', 'Strategy hut', 'Supply drop', 'Beach deals', 'The marooning', 'Challenge feed', 'Tribe standings', 'Island map']) {
      expect(survivor.labels).toContain(name)
    }
    expect(survivor.labels).not.toContain('Standings')
    expect(survivor.labels).not.toContain('War Room')
    // Same screens, same order: only Defense Hub is gone.
    expect(survivor.hrefs).toEqual(standard.hrefs.filter((h) => !h.startsWith('/core/defense-hub')))
    // Account-wide entries keep their names.
    expect(survivor.labels).toContain('Settings')
    expect(survivor.labels).toContain('Brackets')
  })

  it('renames the league sections and marks the root for the island theme', () => {
    const survivor = shell({ leagueTheme: 'survivor' })
    expect(survivor.headings).toContain('The island')
    expect(survivor.headings).toContain('This episode')
    expect(survivor.headings).not.toContain('This league')
    expect(survivor.root.getAttribute('data-league-theme')).toBe('survivor')

    const standard = shell({})
    expect(standard.headings).toContain('This league')
    expect(standard.root.hasAttribute('data-league-theme')).toBe(false)
  })
})

describe('survivorTheme', () => {
  it('applies only to a Survivor league', () => {
    expect(leagueThemeForTypeKey('survivor')).toBe('survivor')
    for (const key of ['redraft', 'dynasty', 'zombie', 'guillotine', null, undefined]) expect(leagueThemeForTypeKey(key)).toBeNull()
    const items = [{ key: 'standings', label: 'Standings' }, { key: 'defense-hub', label: 'Defense Hub' }]
    expect(themeNavItems(items, null)).toBe(items)
    expect(themeNavItems(items, 'survivor')).toEqual([{ key: 'standings', label: 'Tribe standings' }])
    expect(themeSectionHeading('history', 'Your record', 'survivor')).toBe('Your record')
    expect(themeSectionHeading('top', null, 'survivor')).toBeNull()
  })

  it('has a Spanish name for every Survivor label', () => {
    const copy = readFileSync(resolve(process.cwd(), 'lib/core-app/coreUiCopy.ts'), 'utf8')
    for (const label of [...Object.values(SURVIVOR_NAV_LABELS), 'The island', 'This episode']) {
      expect(copy, label).toMatch(new RegExp(`^\\s+('${label}'|${label}): '`, 'm'))
    }
  })

  it('ships the scene art the theme points at', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/core-app/af-survivor-theme.css'), 'utf8')
    const scenes = [...css.matchAll(/url\('(\/survivor\/scenes\/[a-z]+\.svg)'\)/g)].map((m) => m[1])
    expect(scenes.length).toBeGreaterThan(0)
    for (const s of scenes) expect(existsSync(resolve(process.cwd(), 'public' + s)), s).toBe(true)
  })

  it('is chosen on the server from the selected league', () => {
    const page = readFileSync(resolve(process.cwd(), 'app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')
    expect(page).toContain('leagueTheme={leagueThemeForTypeKey(tradeLeagueTypeKey)}')
  })
})
