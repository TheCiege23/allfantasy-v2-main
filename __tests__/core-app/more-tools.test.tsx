import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { buildToolsHub } from '@/lib/core-app/toolsHub'
import { MORE_TOOLS, moreToolsScreenFor } from '@/lib/core-app/moreTools'
import { MoreToolsLinks } from '@/components/core-app/MoreToolsLinks'

/**
 * Tools (/core/tools) left the nav on 2026-11-12. Its cards either repeated a nav entry or moved
 * to the screen they belong to (lib/core-app/moreTools.ts). This guard is what stops a link the hub
 * offered from quietly becoming unreachable: every href the hub builds must be either in
 * MORE_TOOLS or in the list below of places it was already reachable from.
 */
afterEach(cleanup)

/** Hub links that already had a home in /core, and where. Base path only (query dropped). */
const ALREADY_REACHABLE: Record<string, string> = {
  '/core/trades': 'nav: Trades — the one trade finder lives there (2026-11-12)',
  '/core/waivers': 'nav: Waivers (inside a league)',
  '/core/draft-hq': 'nav: Draft HQ',
  '/core/season-outlook': 'nav: Season Outlook',
  '/core/rankings': 'nav: Rankings (its panels are tabs there)',
  '/core/share': 'Your career links it',
  '/tokens': 'Plans & tokens (/pricing) links it',
  '/pricing': 'nav: Plans & tokens',
  '/settings': 'nav: Settings',
  '/import': 'the rail’s Connect a platform card',
  '/core/commissioner': 'nav: Commissioner (for anyone who runs a league)',
}

const base = (href: string) => href.split(/[?#]/)[0]!

describe('the Tools hub, after it left the nav', () => {
  it('every link it offered still has a home', () => {
    const hub = buildToolsHub({ issues: [], stats: { leaguesPlayed: 1, tradesOnFile: 1, connectedLeagues: 1 }, selectedLeagueId: null })
    const hubHrefs = hub.groups.flatMap((g) => g.tools.flatMap((t) => [t.href, ...(t.alternates ?? []).map((a) => a.href)]))
    expect(hubHrefs.length).toBeGreaterThan(15)
    const moved = new Set(Object.values(MORE_TOOLS).flatMap((ls) => ls.map((l) => l.href)))
    const homeless = hubHrefs.filter((h) => !moved.has(h) && !(base(h) in ALREADY_REACHABLE))
    expect(homeless).toEqual([])
  })

  it('maps each screen key to its link set, and nothing else', () => {
    expect(moreToolsScreenFor('trades')).toBe('trades')
    expect(moreToolsScreenFor('draft-hq')).toBe('draft')
    expect(moreToolsScreenFor('rankings')).toBe('rankings')
    expect(moreToolsScreenFor('players')).toBe('players')
    expect(moreToolsScreenFor('home')).toBeNull()
    expect(moreToolsScreenFor('tools')).toBeNull()
  })
})

describe('MoreToolsLinks', () => {
  /* The trade tools are one tool since 2026-11-12; the finder is on the Trades screen this list sits on. */
  it('lists the Trade Analyzer and Trade History on Trades, with Trade History marked Pro', () => {
    render(<MoreToolsLinks screen="trades" language="en" />)
    const section = screen.getByTestId('more-tools-trades')
    expect(within(section).getByRole('heading').textContent).toBe('More tools')
    const links = within(section).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/trade-evaluator', '/af-legacy?tab=finder'])
    const history = links[1]!
    expect(history.textContent).toContain('Trade History')
    expect(history.textContent).toContain('Pro')
    expect(links[0]!.textContent).not.toContain('Pro')
  })

  it('follows the language switch', () => {
    render(<MoreToolsLinks screen="rankings" language="es" />)
    const section = screen.getByTestId('more-tools-rankings')
    expect(within(section).getByRole('heading').textContent).toBe('Más herramientas')
    // Rankings carries four links since 2026-11-14 (Compare, Your career and Find a league moved here from its header).
    expect(within(section).getAllByRole('link').map((a) => a.textContent).join(' ')).toContain('Comparar mánagers')
  })
})
