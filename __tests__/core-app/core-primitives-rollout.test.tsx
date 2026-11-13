/**
 * The redraft league screens on the shared page pieces (components/core-app/primitives). Two halves:
 *
 *   1. Every migrated screen draws its page title through PageHeader — rendered for the screens that
 *      mount with a small fixture, read from source for the rest — and none hand-rolls an `<h1>`.
 *   2. No stylesheet still sizes a migrated screen's title. The size is `--af-title-size` (30px, 26px
 *      at 760px and below) in af-primitives.css; a screen rule naming its title class would put back
 *      the drift (18px to 34px across screens) this rollout removed.
 *
 * Matchup joined in 2026-11 (core-primitives-part2): its title is PageHeader's "Matchup" with the
 * week as the eyebrow; the league name stays in the banner as text. Its empty card is on EmptyState.
 */
import React from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))
// `prefetch` is a prop next/link consumes, so jsdom never sees it; the stand-in writes it down.
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a href={String(href)} data-prefetch={prefetch === false ? 'false' : undefined} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
  usePathname: () => '/core/schedule',
  useSearchParams: () => new URLSearchParams('league=l1'),
}))

import { Standings } from '@/components/core-app/screens/Standings'
import Matchup from '@/components/core-app/screens/Matchup'
import LeagueMoves from '@/components/core-app/screens/LeagueMoves'
import LeagueSchedule from '@/components/core-app/screens/LeagueSchedule'
import { LeagueCareer } from '@/components/core-app/screens/LeagueCareer'
import type { MatchupData } from '@/lib/core-app/matchup'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'
import type { LeagueCareerResult } from '@/lib/core-app/leagueCareer'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** Each migrated screen, the file that draws its page header, and the class its title carries. */
const MIGRATED: Array<{ screen: string; file: string; title: string | null }> = [
  { screen: 'Standings', file: 'components/core-app/screens/Standings.tsx', title: 'af-st-title' },
  { screen: 'Waivers', file: 'components/core-app/screens/Waivers.tsx', title: 'af-wv-title' },
  { screen: 'Live scores', file: 'components/core-app/screens/LiveScores.tsx', title: 'af-live-title' },
  { screen: 'Trades', file: 'components/core-app/screens/TradeCenter.tsx', title: null },
  { screen: 'Schedule', file: 'components/core-app/screens/LeagueSchedule.tsx', title: null },
  { screen: 'Moves', file: 'components/core-app/screens/LeagueMoves.tsx', title: null },
  { screen: 'Season Outlook (all leagues)', file: 'components/core-app/screens/SeasonOutlook.tsx', title: 'af-so-title' },
  { screen: 'Season Outlook (league)', file: 'components/core-app/screens/SeasonOutlookLeague.tsx', title: 'af-sol-title' },
  { screen: 'War Room (Scout)', file: 'components/core-app/screens/Scout.tsx', title: 'af-sc-title' },
  { screen: 'Rankings', file: 'components/core-app/rankings/RankingsHero.tsx', title: 'af-rk-title' },
  { screen: 'Rankings · Compare', file: 'components/core-app/screens/RankingsCompare.tsx', title: 'af-rk-title' },
  { screen: 'Rankings · How ranking works', file: 'components/core-app/screens/RankingsFaq.tsx', title: 'af-rk-title' },
  { screen: 'Player Finder', file: 'components/core-app/screens/PlayerFinder.tsx', title: 'af-pf-title' },
  { screen: 'League career', file: 'components/core-app/screens/LeagueCareer.tsx', title: 'af-lc-title' },
  { screen: 'Your week (league)', file: 'components/core-app/screens/YourWeekLeague.tsx', title: 'af-wl-title' },
  { screen: 'Matchup', file: 'components/core-app/screens/Matchup.tsx', title: null },
]

/**
 * Element selectors that used to size a migrated screen's bare h1 (Trades' `.af-tc-head h1`, the team
 * workspace's `.af-tw h1` under Schedule and Moves). A title with no class of its own is caught here.
 */
const BARE_H1_SELECTORS = [/\.af-tc-head\s+h1\b/, /\.af-tw\s+h1\b/, /\.af-wv\s*>\s*h1\b/, /\.af-pf-rail\s*>\s*h1\b/]

describe('migrated screens draw their title through PageHeader', () => {
  it.each(MIGRATED)('$screen uses PageHeader and hand-rolls no <h1>', ({ file }) => {
    const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    expect(src).toMatch(/<PageHeader\b/)
    expect(src).toMatch(/from '@\/components\/core-app\/primitives(\/PageHeader)?'/)
    expect(src).not.toMatch(/<h1\b/)
  })

  it('Matchup’s league name is banner text now, not a second heading', () => {
    const src = read('components/core-app/screens/Matchup.tsx')
    expect(src).toMatch(/<p className="af-mu-league-name">/)
    expect(src).not.toMatch(/<h1 className="af-mu-league-name">/)
  })
})

describe('rendered: the page header is the shared one', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      observe() {}
      disconnect() {}
    }
  })
  afterEach(() => {
    cleanup()
    delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
  })

  /** The one h1 on the page, inside the shared header, carrying the primitive's class. */
  function pageTitle(container: HTMLElement): HTMLElement {
    const h1s = [...container.querySelectorAll('h1')]
    expect(h1s).toHaveLength(1)
    expect(h1s[0].classList.contains('af-pg-title')).toBe(true)
    expect(h1s[0].closest('header.af-pg-head')).not.toBeNull()
    return h1s[0]
  }

  const league = {
    id: 'l1',
    name: 'Kings of Buffalo',
    sport: 'NFL',
    season: 2026,
  }
  const homeData = {
    league,
    importCoverage: { capabilities: { trades: true } },
    buzz: { available: false, reason: 'n/a' },
    calendar: [],
    timeline: { available: false, reason: 'n/a' },
    weekPicker: null,
    scoreboard: { available: false, reason: 'no fixtures on file' },
  } as unknown as LeagueHomeData

  it('Standings (before a scored week): PageHeader over the shared EmptyState card', () => {
    const { container } = render(
      <Standings data={{ available: false, leagueName: 'Kings of Buffalo', history: [], reason: 'this league is no longer connected' }} />,
    )
    const h1 = pageTitle(container)
    expect(h1.textContent).toBe('Standings')
    expect(h1.classList.contains('af-st-title')).toBe(true)
    // The redraft stylesheet colours the eyebrow through this class; it must still be there.
    expect(container.querySelector('.af-pg-eyebrow.af-st-eyebrow')?.textContent).toBe('Kings of Buffalo')
    const card = screen.getByTestId('standings-empty')
    expect(card.className).toBe('af-empty-card')
    expect(card.querySelector('.af-empty-card-body')?.textContent).toBe('this league is no longer connected')
  })

  it('Moves and Schedule: PageHeader inside the team workspace', () => {
    const moves = render(<LeagueMoves data={homeData} />)
    expect(pageTitle(moves.container).textContent).toBe('Moves')
    expect(moves.container.querySelector('.af-pg-sub')?.textContent).toContain('Kings of Buffalo')
    cleanup()
    const schedule = render(<LeagueSchedule data={homeData} />)
    expect(pageTitle(schedule.container).textContent).toBe('Schedule and deadlines')
    expect(schedule.container.querySelector('.af-pg-actions a')?.getAttribute('href')).toBe('/core/my-team?league=l1')
  })

  it('League career (no history yet): PageHeader with the league as the eyebrow', () => {
    const data = { available: false, leagueName: 'Kings of Buffalo', reason: 'no seasons on file' } as unknown as LeagueCareerResult
    const { container } = render(<LeagueCareer data={data} allLeaguesHref="/core/career" />)
    expect(pageTitle(container).textContent).toBe('Your career here')
    expect(container.querySelector('.af-pg-eyebrow.af-lc-eyebrow')?.textContent).toBe('Kings of Buffalo')
  })

  it('Matchup (no matchup resolved): PageHeader titled Matchup over the shared EmptyState card, its lineup link still not prefetched', () => {
    const data = {
      league: { id: 'l1', name: 'L', platform: 'native', logoUrl: null, sourceLink: null, lineupLink: null },
      week: { available: false, reason: 'no weekly results stored for this league' },
      extraMatchup: null,
      teams: { available: false, reason: 'no matchup resolved, so there are no teams to name' },
      sides: { available: false, reason: 'no matchup resolved' },
      lineups: { available: false, reason: 'no matchup resolved, so there are no lineups to pair' },
      identityNote: null,
      playerScoring: { available: false, reason: 'n/a' },
      winProbability: { available: false, reason: 'n/a' },
      projectedFinal: { available: false, reason: 'n/a' },
      yetToPlay: { available: false, reason: 'n/a' },
      starterCountsBySide: null,
    } as unknown as MatchupData
    const { container } = render(<Matchup data={data} />)
    const card = screen.getByTestId('matchup-empty')
    expect(card.className).toBe('af-empty-card')
    expect(card.querySelector('.af-empty-card-mark')?.textContent).toBe('vs')
    const link = card.querySelector('.af-empty-card-links a')
    expect(link?.getAttribute('href')).toBe('/core/my-team?league=l1')
    expect(link?.getAttribute('data-prefetch')).toBe('false')
    // The page title is the shared header's; with no week on file there is no eyebrow.
    expect(pageTitle(container).textContent).toBe('This week’s matchup')
    expect(container.querySelector('.af-pg-eyebrow')).toBeNull()
    expect(container.querySelector('p.af-mu-league-name')?.textContent).toBe('L')
  })
})

/* ── CSS: no stylesheet sizes a migrated title ─────────────────────────────────────────────── */

function cssFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.css')) out.push(p)
    }
  }
  walk(join(ROOT, 'components'))
  walk(join(ROOT, 'app'))
  return out
}

/** Every innermost `selector { declarations }` block, comments stripped (prose about a rule is not a rule). */
function rules(css: string): Array<{ selector: string; body: string }> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }))
}

const SETS_SIZE = /(^|;)\s*font(-size)?\s*:/

/** Rules that size a migrated title: they name its class (or an old bare-h1 selector) and set a font size. */
function titleSizers(css: string): string[] {
  const classes = [...new Set(MIGRATED.map((m) => m.title).filter((c): c is string => Boolean(c)))]
  return rules(css)
    .filter(({ selector, body }) => {
      if (!SETS_SIZE.test(body)) return false
      const names = classes.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(selector))
      return names || BARE_H1_SELECTORS.some((re) => re.test(selector))
    })
    .map(({ selector }) => selector.replace(/\s+/g, ' '))
}

describe('no stylesheet still sizes a migrated screen’s title', () => {
  const files = cssFiles()

  it('reads the stylesheets at all (a scan of nothing passes everything)', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((f) => f.endsWith('af-standings.css'))).toBe(true)
  })

  it('finds no title-sizing rule in any stylesheet', () => {
    const found = files.flatMap((f) => titleSizers(readFileSync(f, 'utf8')).map((s) => `${f.slice(ROOT.length + 1)}: ${s}`))
    expect(found).toEqual([])
  })

  it('positive control: the old rules, put back, are reported', () => {
    const old = [
      '.af-st-title { margin: 0; font-size: 28px; }',
      '@media (max-width: 560px) { .af-core .af-sc-title { font-size: 18px; } }',
      '.af-tc-head h1 { margin: 4px 0 6px; font-size: 34px; }',
      '.af-tw h1 { font-size:clamp(24px,3vw,34px); }',
      '.af-rk-title { font: 900 22px/1.1 Archivo, sans-serif; }',
      '/* .af-lc-title { font-size: 23px; } */ .af-lc-banner { padding: 4px; }',
      '.af-st-title-row { font-size: 12px; } .af-wl-title-row { gap: 4px; }',
    ].join('\n')
    expect(titleSizers(old)).toEqual(['.af-st-title', '.af-core .af-sc-title', '.af-tc-head h1', '.af-tw h1', '.af-rk-title'])
  })

  it('the title size is the one token, read by the primitive', () => {
    const prim = read('components/core-app/primitives/af-primitives.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(prim).toMatch(/\.af-core \.af-pg-title \{[^}]*font: 800 var\(--af-title-size, 30px\)/)
  })

  it('keeps the redraft sport bar under the Waivers and Player Finder titles, on their new classes', () => {
    const css = read('components/core-app/af-core-redraft-waivers-finder.css')
    expect(css).toContain(':is(.af-wv-head .af-wv-title,.af-pf-head .af-pf-title)::after{content:')
    expect(css).not.toMatch(/h1\.af-display|h1\.af-pf-h1/)
  })
})
