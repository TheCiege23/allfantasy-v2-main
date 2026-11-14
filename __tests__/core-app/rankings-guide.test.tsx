/**
 * The /core/rankings guide (2026-11-14): one headline per tab that says where you stand, the movement line,
 * the rank said once, the filters folded at every width, and one line under the board with "How this
 * board is scored" folded beneath it.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, scroll: _s, ...rest }: { href: string; children: React.ReactNode; scroll?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { movementParts, plainGap, rankingsHeadline } from '@/lib/core-app/rankingsGuide'
import { rankingsGuideMessages } from '@/lib/core-app/messages/rankingsGuide'
import { headlineText, movementText, RankingsBoardFoot, RankingsYouRow } from '@/components/core-app/rankings/RankingsGuide'
import { RankingsFilterBar } from '@/components/core-app/rankings/RankingsFilterBar'
import { DEFAULT_FILTERS } from '@/lib/core-app/rankingsEngine'
import { MORE_TOOLS } from '@/lib/core-app/moreTools'
import type { RankingsData } from '@/lib/core-app/rankings'

afterEach(cleanup)

const en = rankingsGuideMessages.en
const SRC = readFileSync(resolve(process.cwd(), 'components/core-app/screens/Rankings.tsx'), 'utf8')

const rival = (display: string, yourDisplay: string) => ({ userId: 'u', handle: 'Miles', rank: 17, level: 5, display, yourDisplay, headToHead: null, compareHref: '#' })
const base = (over: Partial<RankingsData>) =>
  ({ scope: 'global', signedIn: true, filters: DEFAULT_FILTERS, global: null, portfolio: null, league: null, classView: null, ...over }) as RankingsData
const global = (you: unknown, rivals: unknown[] = [], board = 'overall', label = 'Overall') =>
  ({ board, label, you, rivals }) as unknown as RankingsData['global']

describe('rankingsHeadline', () => {
  it('your place on the board, and how far behind the manager above you', () => {
    const h = rankingsHeadline(base({ global: global({ rank: 18, of: 19, display: '25.9', movement: {} }, [rival('30.3', '25.9')]) }))
    expect(h).toEqual({ kind: 'board', rank: 18, of: 19, board: null, next: { handle: 'Miles', gap: 4.4 } })
    expect(headlineText(h, en)).toBe('You’re #18 of 19 — 4.4 behind @Miles')
  })

  it('names a board other than Overall, and never subtracts a percentage', () => {
    const h = rankingsHeadline(base({ global: global({ rank: 5, of: 19, display: '51.2%', movement: {} }, [rival('58.8%', '51.2%')], 'winRate', 'Win %') }))
    expect(headlineText(h, en)).toBe('You’re #5 of 19 on the Win % board')
  })

  it('#1, not ranked, and signed out', () => {
    expect(headlineText(rankingsHeadline(base({ global: global({ rank: 1, of: 19, display: '77.6', movement: {} }) })), en)).toBe('You’re #1 of 19 in the community')
    expect(headlineText(rankingsHeadline(base({ global: global(null) })), en)).toBe('You’re not on this board yet — it needs 3+ league-seasons with results')
    expect(headlineText(rankingsHeadline(base({ signedIn: false, global: global(null) })), en)).toBe('Every ranked AllFantasy manager, on one board')
  })

  it('the other tabs say their own standing', () => {
    const portfolio = { score: { score: 25.94 }, globalRank: { rank: 18, of: 19 } } as unknown as RankingsData['portfolio']
    expect(headlineText(rankingsHeadline(base({ scope: 'portfolio', portfolio })), en)).toBe('Your manager score is 25.9 — #18 of 19 in the community')
    const league = {
      leagues: [],
      selected: { id: 'l', name: 'Kings', platform: 'sleeper', season: 2026, lastSyncedAt: null },
      board: { available: true, reason: null, week: 10, seasonComplete: false, rows: [{ rank: 1, isYou: false }, { rank: 2, isYou: true }, { rank: 3, isYou: false }] },
      power: null,
    } as unknown as RankingsData['league']
    expect(headlineText(rankingsHeadline(base({ scope: 'league', league })), en)).toBe('You’re #2 of 3 in Kings')
    const classView = { you: { status: 'established', division: 2, rating: 1612.4, games: 40 } } as unknown as RankingsData['classView']
    expect(headlineText(rankingsHeadline(base({ scope: 'class', classView })), en)).toBe('You’re in Division 2 — Class rating 1,612')
  })
})

describe('the small rules', () => {
  it('plainGap reads plain numbers only, and only a gap upward', () => {
    expect(plainGap('30.3', '25.9')).toBe(4.4)
    expect(plainGap('58.8%', '51.2%')).toBeNull()
    expect(plainGap('3 / 1.2', '0 / 0.7')).toBeNull()
    expect(plainGap('20', '25')).toBeNull()
  })

  it('movement: zero and unknown left out, a week that agrees with 7 days said once', () => {
    expect(movementParts({ sevenDay: null, week: 1, season: -13 })).toEqual([{ window: 'week', places: 1 }, { window: 'season', places: -13 }])
    expect(movementParts({ sevenDay: 1, week: 1, season: 0 })).toEqual([{ window: 'week', places: 1 }])
    expect(movementText({ sevenDay: null, week: 1, season: -13 }, en)).toBe('Up 1 this week · down 13 since last season')
    expect(movementText({ sevenDay: 0, week: null, season: null }, en)).toBeNull()
  })

  it('has Spanish for every key and never says «waiver»', () => {
    const es = rankingsGuideMessages.es!
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    const text = JSON.stringify(Object.values(es).map((v) => (typeof v === 'function' ? String(v) : v)))
    expect(text.toLowerCase()).not.toMatch(/waiver/)
  })
})

describe('the pieces', () => {
  it('the row under the headline: movement, Why and Ask Chimmy — no second rank, no My portfolio', () => {
    render(<RankingsYouRow movement={{ sevenDay: null, week: 1, season: -13 }} whyHref="?explain=me" chimmyHref="/chimmy" />)
    const row = screen.getByTestId('rk-yourow').textContent ?? ''
    expect(row).toContain('Up 1 this week · down 13 since last season')
    expect(screen.getByRole('link', { name: 'Why this rank?' }).getAttribute('href')).toBe('?explain=me')
    expect(row).not.toMatch(/#\d|My portfolio/)
  })

  it('the line under the board says who is ranked and when, once; how it is scored is folded', () => {
    render(
      <RankingsBoardFoot shown={19} population={35} belowSample={16} minSample={3} updated="Nov 14, 12:40 AM ET">
        <p>weights here</p>
      </RankingsBoardFoot>,
    )
    expect(screen.getByTestId('rk-boardfoot').querySelector('p')?.textContent).toBe(
      '19 of 35 managers ranked · 16 more need 3 league-seasons · updated Nov 14, 12:40 AM ET',
    )
    const fold = document.querySelector('details.af-rk-howscored') as HTMLDetailsElement
    expect(fold.open).toBe(false)
    expect(fold.querySelector('summary')?.textContent).toBe('How this board is scored')
  })

  it('the filters are one folded form at every width, open when a filter is set', () => {
    const options = { sports: [], platforms: [], types: [], formats: [], seasons: [] } as never
    const { container, unmount } = render(<RankingsFilterBar filters={DEFAULT_FILTERS} options={options} hidden={[]} resetHref="/r" label="All leagues" />)
    expect(container.querySelectorAll('form')).toHaveLength(1)
    expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(false)
    expect(container.querySelector('summary')?.textContent).toBe('Filters · All leagues')
    unmount()
    const { container: c2 } = render(
      <RankingsFilterBar filters={{ ...DEFAULT_FILTERS, sport: 'NFL' }} options={options} hidden={[]} resetHref="/r" label="NFL" />,
    )
    expect((c2.querySelector('details') as HTMLDetailsElement).open).toBe(true)
    expect(c2.querySelector('summary')?.textContent).toBe('Filters · NFL')
  })
})

describe('the screen says each thing once', () => {
  it('no "You on" box, no method card at the foot, two header buttons; the rest moved to More tools', () => {
    expect(SRC).not.toContain('aria-label="Your place on this board"')
    expect(SRC).not.toMatch(/You on \{g\.label\}/)
    expect(SRC).not.toContain('<MethodCard />')
    expect(SRC).toContain('<RankingsBoardFoot')
    expect(SRC).not.toMatch(/href="\/core\/career">Your Career/)
    expect(SRC).not.toMatch(/href="\/find-league">Find a League/)
    const hrefs = MORE_TOOLS.rankings.map((t) => t.href)
    expect(hrefs).toEqual(expect.arrayContaining(['/core/rankings?view=compare', '/core/career', '/find-league', '/manager-compare']))
  })
})
