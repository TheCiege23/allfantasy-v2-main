/**
 * The small dynasty / theme fixes of 2026-11-05:
 *   - a gold crown on a dynasty league's rail tile (and nothing on any other league);
 *   - the bracket promo marks itself "in a league" so phones can render it as one slim row;
 *   - the chat launcher follows the dynasty and redraft identities instead of a literal cyan;
 *   - Trades' status colours use /core's measured light palette in light mode (the deadline chip was
 *     #fbbf24 on white, ~1.7:1);
 *   - My team names wrap above the phone layout instead of being cut mid-word.
 * The CSS checks read the SHIPPED files and also assert each new block is top-level (CLAUDE.md:
 * a nested @media silently moves rules out of their band).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

const nav = vi.hoisted(() => ({ router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} } }))
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams('league=l1'),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'

const LEAGUES = [
  { id: 'l1', name: 'The Deep!', platform: 'sleeper', mark: 'TD', sport: 'NFL', dynasty: true },
  { id: 'l2', name: 'Sunday Night Redraft', platform: 'sleeper', mark: 'SN', sport: 'NFL' },
]

function shell(props: Record<string, unknown> = {}) {
  return render(
    <AfCoreShell active="home" leagues={LEAGUES as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} {...props}>
      <div>screen</div>
    </AfCoreShell>,
  ).container
}

describe('rail crown', () => {
  it('draws one crown, on the dynasty league only', () => {
    const c = shell({ selectedLeagueId: 'l2' })
    const crowns = c.querySelectorAll('[data-testid=rail-dynasty-crown]')
    expect(crowns).toHaveLength(1)
    expect(crowns[0].closest('a')?.getAttribute('aria-label') ?? crowns[0].closest('a')?.textContent).toMatch(/The Deep!/)
  })
})

describe('bracket promo', () => {
  it('says when it is inside a league, so the phone layout can slim it', () => {
    expect(shell({ selectedLeagueId: 'l1' }).querySelector('[data-testid=core-bracket-entry]')?.getAttribute('data-in-league')).toBe('true')
    expect(shell({}).querySelector('[data-testid=core-bracket-entry]')?.hasAttribute('data-in-league')).toBe(false)
  })
})

describe('copy', () => {
  it('names a dynasty league in Spanish', () => {
    expect(coreUiCopy('Dynasty league', 'es')).toBe('Liga dinastía')
  })
})

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
/** Brace depth at the first occurrence of `needle` (0 = top level). */
function depthAt(css: string, needle: string): number {
  const body = strip(css)
  const at = body.indexOf(needle)
  if (at < 0) throw new Error(`not found: ${needle}`)
  let d = 0
  for (let i = 0; i < at; i++) d += body[i] === '{' ? 1 : body[i] === '}' ? -1 : 0
  return d
}

describe('CSS', () => {
  it('the chat launcher follows the dynasty and redraft identities, at top level', () => {
    const dyn = read('components/core-app/af-core-dynasty.css')
    expect(strip(dyn)).toMatch(/\.af-core\.af-shell\[data-dynasty-background=true\] \.af-cm-launch\{background:var\(--dyn-gold\);color:var\(--dyn-ink\)/)
    expect(depthAt(dyn, '.af-cm-launch{')).toBe(0)
    const rd = read('components/core-app/af-core-redraft.css')
    expect(strip(rd)).toMatch(/\.af-core\.af-shell\[data-format=redraft\] \.af-cm-launch\{background:var\(--rd-accent\);color:var\(--rd-accent-ink\)/)
    expect(depthAt(rd, '.af-cm-launch{')).toBe(0)
  })

  it('the rail crown is styled at top level and inside the tile (the art clips)', () => {
    const dyn = read('components/core-app/af-core-dynasty.css')
    expect(depthAt(dyn, '.af-rail-crown{')).toBe(0)
    expect(strip(dyn)).toMatch(/\.af-rail-crown\{position:absolute;left:1px;bottom:1px/)
    // af-core-dynasty.css keeps exactly one @media block (core-shell-dynasty.test.tsx pins the same).
    expect(strip(dyn).match(/@media/g)?.length).toBe(1)
  })

  it('Trades status colours use the light palette in light mode', () => {
    const tc = strip(read('components/core-app/af-trade-center.css'))
    const block = tc.slice(tc.indexOf("html[data-mode='light'] .af-core .af-tc {"))
    const body = block.slice(0, block.indexOf('}'))
    expect(body).toContain('--tc-warn: var(--warn)')
    expect(body).toContain('--tc-good: var(--good)')
    expect(body).toContain('--tc-bad: var(--bad)')
  })

  it('the phone promo and the desktop name wrap are their own top-level @media blocks', () => {
    const shellCss = read('components/core-app/af-core-shell.css')
    expect(depthAt(shellCss, ".af-core .af-core-bracket-promo[data-in-league='true'] { flex-wrap")).toBe(1)
    const mt = read('components/core-app/af-my-team.css')
    expect(depthAt(mt, '@media (min-width: 721px)')).toBe(0)
    expect(depthAt(mt, '.af-core .af-mt-player-name { flex-wrap: wrap')).toBe(1)
  })
})
