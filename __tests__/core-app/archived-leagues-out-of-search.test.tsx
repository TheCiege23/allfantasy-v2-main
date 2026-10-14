import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Archived leagues stay out of the /core league SEARCHES (2026-10-13, owner's call: "hide Blah2 from
 * search too"). Leagues the account hid itself stay searchable — that is the hidden-league rule in
 * league-preferences.test.tsx and it must not move. The open league always shows.
 */

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))
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
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { ScopeSwitcher } from '@/components/core-app/ScopeSwitcher'
import AfCoreShell from '@/components/core-app/AfCoreShell'

beforeEach(() => {
  // The top search also asks for players; answer with none so only league hits render.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ players: [] }))))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the league switcher', () => {
  const leagues = [
    { id: 'blah', name: 'Blah', platform: 'manual', sport: 'NFL' },
    { id: 'blah2', name: 'Blah2', platform: 'manual', sport: 'NFL' },
    { id: 'blahhid', name: 'Blah Hidden', platform: 'manual', sport: 'NFL' },
  ]
  const open = (props: Partial<React.ComponentProps<typeof ScopeSwitcher>> = {}) => {
    render(
      <ScopeSwitcher
        leagues={leagues}
        scopeValue={null}
        label="All leagues"
        selectedLeagueId={null}
        favoriteIds={[]}
        leagueScreen={false}
        hiddenIds={['blahhid', 'blah2']}
        archivedIds={['blah2']}
        {...props}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Viewing/ }))
  }
  const names = () => Array.from(document.querySelectorAll('.af-scope-league-name')).map((n) => n.textContent)
  const search = (value: string) => fireEvent.change(screen.getByRole('searchbox'), { target: { value } })

  it('leaves an archived league out of the list', () => {
    open()
    expect(names()).toEqual(['Blah'])
  })

  it('leaves an archived league out of search, while a league the account hid is still found', () => {
    open()
    search('blah')
    expect(names()).toEqual(['Blah', 'Blah Hidden'])
  })

  it('still shows the archived league when it is the open one', () => {
    open({ selectedLeagueId: 'blah2' })
    expect(names()).toContain('Blah2')
    search('blah')
    expect(names()).toContain('Blah2')
  })

  it('CONTROL: with no archived ids, search finds it again', () => {
    open({ archivedIds: [] })
    search('blah2')
    expect(names()).toEqual(['Blah2'])
  })
})

describe('the top-bar search', () => {
  const rail = [
    { id: 'blah', name: 'Blah', platform: 'manual', mark: 'M' },
    { id: 'blah2', name: 'Blah2', platform: 'manual', mark: 'M' },
  ]
  const shell = (props: Record<string, unknown> = {}) => (
    <AfCoreShell active="home" leagues={rail as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} {...props}>
      <div>screen</div>
    </AfCoreShell>
  )
  const hitNames = () => Array.from(document.querySelectorAll('.af-search-ac-name')).map((n) => n.textContent)
  const type = (value: string) => {
    const box = screen.getByPlaceholderText('Find a player or jump to a league')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value } })
  }

  it('does not offer an archived league', () => {
    render(shell({ archivedLeagueIds: ['blah2'] }))
    type('blah')
    expect(hitNames()).toEqual(['Blah'])
  })

  it('still offers the archived league when it is the open one', () => {
    render(shell({ archivedLeagueIds: ['blah2'], selectedLeagueId: 'blah2' }))
    type('blah')
    expect(hitNames()).toContain('Blah2')
  })

  it('CONTROL: with no archived ids, both leagues are offered', () => {
    render(shell())
    type('blah')
    expect(hitNames()).toEqual(['Blah', 'Blah2'])
  })
})

describe('the /core page wiring', () => {
  const page = readFileSync(join(process.cwd(), 'app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')

  it('hands the shell the archived ids, computed from the unfiltered played leagues', () => {
    expect(page).toMatch(/^\s*const shellArchivedIds = archivedLeagueIds\(playedLeagues\)$/m)
    expect(page).toMatch(/^\s*archivedLeagueIds=\{shellArchivedIds\}$/m)
  })
})
