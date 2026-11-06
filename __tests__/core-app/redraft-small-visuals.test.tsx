// @vitest-environment jsdom
/**
 * Three small visual fixes seen live on allfantasy.ai (2026-11-06):
 * - Live scores · "Around the league": team names were cut mid-word with an ellipsis. They now wrap.
 * - Portfolio's empty state said the same thing twice (title, then the service's English-only
 *   `reason`). Title, body and hint now each say something different, in en and es.
 * - Career overview · "Your rivals": at ~800px the third name read "KingGinger…". Names now wrap to
 *   two lines; the record keeps its own column.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

let language: 'en' | 'es' = 'en'
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={String(href)} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))

import { LiveLeagueGames } from '@/components/core-app/screens/LiveLeagueGames'
import { Portfolio } from '@/components/core-app/screens/Portfolio'
import { CareerRivalsCard } from '@/components/core-app/career/CareerRivalsCard'
import { portfolioHeaderMessages } from '@/lib/core-app/messages/portfolioHeader'
import type { PortfolioData } from '@/lib/core-app/portfolio'
import type { CareerRival } from '@/lib/core-app/careerRecordBook'
import type { ScoreboardTeam } from '@/lib/core-app/leagueScoreboard'

const css = (file: string) =>
  readFileSync(join(process.cwd(), 'components/core-app', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Every top-level (unwrapped) declaration block for `selector`, joined. */
function rulesFor(source: string, selector: string): string {
  const out: string[] = []
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|[},])\\s*${esc}\\s*\\{([^}]*)\\}`, 'g')
  for (let m = re.exec(source); m; m = re.exec(source)) out.push(m[2])
  return out.join(';')
}

afterEach(() => {
  cleanup()
  language = 'en'
})

describe('Live scores · Around the league names', () => {
  const CSS = css('af-live-league-games.css')

  it('wraps a team name instead of cutting it with an ellipsis', () => {
    const rule = rulesFor(CSS, '.af-core .af-llg-name')
    expect(rule).not.toBe('')
    expect(rule).toMatch(/white-space:\s*normal/)
    expect(rule).not.toMatch(/text-overflow:\s*ellipsis/)
    expect(rule).not.toMatch(/white-space:\s*nowrap/)
    // No later rule (phone band included) puts the ellipsis back.
    expect(CSS).not.toMatch(/\.af-llg-name[^{]*\{[^}]*text-overflow:\s*ellipsis/)
  })

  it('never lets a column grow wider than a phone screen', () => {
    expect(rulesFor(CSS, '.af-core .af-llg-list')).toMatch(/minmax\(min\(100%,\s*\d+px\),\s*1fr\)/)
  })

  it('renders the full name, not a truncated one', () => {
    const team = (rosterId: string, teamName: string): ScoreboardTeam => ({
      rosterId, teamName, managerName: null, avatarUrl: null, points: 80, projected: 100, projectedFrom: 9, starterCount: 9, isYou: false,
    })
    const long = 'Fourth & Forever and Ever Dynasty'
    render(
      <LiveLeagueGames
        leagueId="lg"
        data={{
          week: 9,
          allUnplayed: false,
          weekFinal: false,
          games: [{ matchupId: 2, teams: [team('1', long), team('2', 'Hurts Donut')], winProbability: null, unplayed: false, margin: null }],
        } as never}
      />,
    )
    expect(screen.getByText(long).className).toBe('af-llg-name')
  })
})

describe('Portfolio empty state', () => {
  const empty: PortfolioData = {
    leagues: { available: false, reason: 'no leagues claimed to your account yet — import one to get started' } as PortfolioData['leagues'],
    commissionedCount: 0,
  }

  for (const lang of ['en', 'es'] as const) {
    it(`says three different things in ${lang}`, () => {
      language = lang
      const { container } = render(<Portfolio data={empty} />)
      const card = screen.getByTestId('portfolio-empty')
      const title = card.querySelector('.af-empty-card-title')?.textContent ?? ''
      const body = card.querySelector('.af-empty-card-body')?.textContent ?? ''
      const hint = card.querySelector('.af-empty-card-hint')?.textContent ?? ''
      const m = portfolioHeaderMessages[lang]
      expect([title, body, hint]).toEqual([m.emptyTitle, m.emptyBody, m.emptyHint])
      expect(new Set([title, body, hint]).size).toBe(3)
      // The service's English reason restated the title; it is no longer shown in either language.
      expect(container.textContent).not.toContain('no leagues claimed to your account yet')
    })
  }

  it('is translated, not English twice', () => {
    const { en, es } = portfolioHeaderMessages
    expect(es.emptyBody).not.toBe(en.emptyBody)
    expect(es.emptyHint).not.toBe(en.emptyHint)
  })
})

describe('Career overview · Your rivals names', () => {
  const CSS = css('af-career-redesign.css')

  it('wraps a name to at most two lines instead of an ellipsis on line one', () => {
    const rule = rulesFor(CSS, '.af-crr-name')
    expect(rule).not.toBe('')
    expect(rule).toMatch(/white-space:\s*normal/)
    expect(rule).not.toMatch(/white-space:\s*nowrap/)
    expect(rule).toMatch(/-webkit-line-clamp:\s*2/)
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('keeps the record in its own non-shrinking column', () => {
    expect(rulesFor(CSS, '.af-crr-rec')).toMatch(/flex:\s*none/)
  })

  it('renders the whole name', () => {
    const rival = (key: string, name: string): CareerRival => ({
      key, name, meetings: 5, wins: 3, losses: 2, ties: 0, pointsFor: 0, pointsAgainst: 0, leagues: ['L'], seasons: [2024], lastSeason: 2024,
    })
    render(<CareerRivalsCard rivals={[rival('a', 'waiverwire'), rival('b', 'tacotuesday'), rival('c', 'KingGingerbreadSnaps')]} ledgerHref="/core/career" />)
    expect(screen.getByText('KingGingerbreadSnaps').className).toBe('af-crr-name')
  })
})
