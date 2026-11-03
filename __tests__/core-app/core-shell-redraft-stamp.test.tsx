/**
 * AfCoreShell stamps the redraft identity on its root ONLY when told the open league is a native
 * redraft league — `data-format="redraft"` + `data-sport` — and stamps nothing otherwise, so every
 * other league type and every no-league page renders exactly as before. Plus the CSS wiring that makes
 * the stamp mean something on /core: the foundation's token blocks must match `.af-shell`, and the
 * shell must load them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { REDRAFT_SPORT_THEMES } from '@/lib/league-media/redraftIdentity'

const nav = vi.hoisted(() => ({ router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} } }))
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams('league=l1'),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'

const LEAGUES = [{ id: 'l1', name: 'Sunday Night Redraft', platform: 'allfantasy', mark: 'SN', sport: 'NBA' }]

function root(props: Record<string, unknown>) {
  const { container } = render(
    <AfCoreShell active="my-team" leagues={LEAGUES as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} {...props}>
      <div>screen</div>
    </AfCoreShell>,
  )
  return container.querySelector('.af-core.af-shell')!
}

describe('AfCoreShell redraft stamp', () => {
  it.each(REDRAFT_SPORT_THEMES)('a native redraft %s league stamps data-format=redraft + its sport', (sport) => {
    const el = root({ selectedLeagueId: 'l1', nativeLeague: true, redraftSport: sport })
    expect(el.getAttribute('data-format')).toBe('redraft')
    expect(el.getAttribute('data-sport')).toBe(sport)
  })

  it('a league that is not native redraft (null) stamps nothing', () => {
    const el = root({ selectedLeagueId: 'l1', nativeLeague: true, redraftSport: null })
    expect(el.hasAttribute('data-format')).toBe(false)
    expect(el.hasAttribute('data-sport')).toBe(false)
  })

  it('no league open and no prop (every older caller) stamps nothing', () => {
    const el = root({})
    expect(el.hasAttribute('data-format')).toBe(false)
    expect(el.hasAttribute('data-sport')).toBe(false)
  })
})

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('redraft CSS reaches the /core shell', () => {
  const foundation = strip(read('components/league/native/redraft-identity.css'))
  it.each(REDRAFT_SPORT_THEMES)('%s: a dark and a light token block both match the .af-shell root', (sport) => {
    const sel = `.af-core:is(.nl-workspace,.af-shell)[data-format=redraft][data-sport=${sport}]{`
    expect(foundation.split('\n').filter(l => l.startsWith(sel))).toHaveLength(1)
    expect(foundation.split('\n').filter(l => l.startsWith(`html[data-mode='light'] ${sel}`))).toHaveLength(1)
  })

  it('the accent re-pointing block matches the .af-shell root', () => {
    expect(foundation).toMatch(/\.af-core:is\(\.nl-workspace,\.af-shell\)\[data-format=redraft\]\[data-sport\]\{\s*--accent:var\(--rd-accent-text\)/)
  })

  it('the /core page passes the decision for the selected league (statement, not a comment)', () => {
    // Anchored to a line start: a comment naming the prop cannot satisfy it (CLAUDE.md, the
    // source-inspection test that matched its own explanatory comment).
    const page = read('app/core/(shell)/[[...screen]]/page.tsx')
    expect(page).toMatch(/^\s*redraftSport=\{coreShellRedraftSport\(selectedLeagueRow, selectedLeaguePlatform, selectedLeagueRecord\)\}\s*$/m)
  })

  it('AfCoreShell loads the foundation tokens, then the shell batch file', () => {
    const src = read('components/core-app/AfCoreShell.tsx')
    const a = src.indexOf("import '@/components/league/native/redraft-identity.css'")
    const b = src.indexOf("import '@/components/core-app/af-core-redraft.css'")
    expect(a).toBeGreaterThan(-1)
    expect(b).toBeGreaterThan(a)
  })

  it('the shell batch file has no hex colour, and its @media blocks are top-level', () => {
    const css = strip(read('components/core-app/af-core-redraft.css'))
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    let depth = 0
    for (const m of css.matchAll(/@media|\{|\}/g)) {
      if (m[0] === '@media') expect(depth).toBe(0)
      else depth += m[0] === '{' ? 1 : -1
    }
    expect(depth).toBe(0)
  })
})
