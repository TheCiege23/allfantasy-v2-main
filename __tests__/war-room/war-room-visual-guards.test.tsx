/**
 * Guards for the War Room's step-3 visual fixes — the parts a later edit can silently undo.
 *
 * Browser measurements (Chromium and WebKit, 375 / 484-with-rail / 1024 / 1280 / 1920, dark and light)
 * were taken when this landed; the PR records them. These pin the properties that made them pass:
 *
 *   - The franchise block's stylesheet carries NO colour literal. Its hard-coded dark palette is what
 *     made typed text invisible in light mode (measured contrast 1.02:1).
 *   - Every rule in it is scoped under `.af-core`, where the theme tokens are defined.
 *   - The franchise title steps down to an <h2> when the page already has an <h1>.
 */

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: unknown }) => <a href={href}>{children as never}</a>,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { ConnectedFranchiseWarRoom } from '@/components/core-app/screens/ConnectedFranchiseWarRoom'

const css = (name: string) => readFileSync(`components/core-app/${name}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Every selector list, with the @-rules it sits inside. */
function selectors(source: string): Array<{ at: string[]; selector: string }> {
  const out: Array<{ at: string[]; selector: string }> = []
  const stack: string[] = []
  let buf = ''
  for (const ch of source) {
    if (ch === '{') {
      const sel = buf.trim()
      stack.push(sel)
      if (!sel.startsWith('@')) out.push({ at: stack.filter((s) => s.startsWith('@')), selector: sel })
      buf = ''
    } else if (ch === '}') {
      stack.pop()
      buf = ''
    } else if (ch === ';') buf = ''
    else buf += ch
  }
  return out
}

describe('af-connected-war-room.css follows the theme', () => {
  const source = css('af-connected-war-room.css')

  it('has no hex, rgb or hsl colour literal — tokens only', () => {
    expect(source.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([])
    expect(source.match(/\b(?:rgba?|hsla?)\(/gi) ?? []).toEqual([])
  })

  it('scopes every rule under .af-core', () => {
    // Split a selector list on top-level commas only — `:is(h1, h2)` is one selector.
    const unscoped = selectors(source)
      .flatMap((r) => r.selector.split(/,(?![^(]*\))/))
      .map((s) => s.trim())
      .filter((s) => !s.startsWith('.af-core '))
    expect(unscoped).toEqual([])
  })

  it('keeps the sticky switcher below the notch', () => {
    expect(source).toMatch(/\.af-cwr-mobile-switcher\s*\{[^}]*top:\s*env\(safe-area-inset-top/)
  })

  it('nests no @media inside another', () => {
    for (const r of selectors(source)) expect(r.at.filter((a) => a.startsWith('@media')).length).toBeLessThanOrEqual(1)
  })
})

describe('af-game-plan.css', () => {
  const source = css('af-game-plan.css')

  it('stacks rows by Game Plan’s own width, so a tablet with the rail open stacks too', () => {
    const inContainer = selectors(source).filter((r) => r.at.some((a) => a.startsWith('@container gp')))
    expect(inContainer.map((r) => r.selector)).toContain('.af-core .af-gp-row')
  })

  it('does not dim a locked row with opacity', () => {
    expect(source).not.toMatch(/\.af-gp-row\[data-locked\]\s*\{[^}]*opacity/)
  })
})

describe('the franchise title', () => {
  const side = {
    memberId: 'm1', role: 'PRIMARY', leagueId: 'lg1', memberLeagueId: 'ml1', name: 'League', platform: 'sleeper', sport: 'NFL',
    season: 2026, teamLabel: null, teamCandidates: [], avatarUrl: null, playerCount: 1, unavailableReason: null, draft: null,
    activity: null, sync: { lastSyncedAt: null, stale: false, detail: '', refreshHref: null }, players: [],
  }
  const render = (headingLevel?: 1 | 2) =>
    renderToStaticMarkup(
      <ConnectedFranchiseWarRoom linkId="L" franchiseName="The Empire" primaryMemberId={null} selectedLeagueId="lg1" sides={[side] as never} headingLevel={headingLevel} />,
    )

  it('is an <h1> on its own', () => {
    expect(render()).toContain('<h1>The Empire</h1>')
  })

  it('is an <h2> when the page already has its <h1>', () => {
    const html = render(2)
    expect(html).toContain('<h2>The Empire</h2>')
    expect(html).not.toContain('<h1>')
  })
})
