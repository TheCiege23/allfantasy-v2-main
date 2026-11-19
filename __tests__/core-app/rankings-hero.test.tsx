/**
 * The redraft Rankings restyle (2026-11-01): hero, level card, Community board head, avatar chips and
 * the "Why" button. The XP chips must be the published ladder rules, never the mock's invented ones.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, scroll: _s, ...rest }: { href: string; children: React.ReactNode; scroll?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { RankingsBoardHead, RankingsHero } from '@/components/core-app/rankings/RankingsHero'
import { RankTable } from '@/components/core-app/rankings/RankTable'
import { handleInitials } from '@/components/core-app/screens/Rankings'
import {
  RANK_XP_PER_CHAMPIONSHIP,
  RANK_XP_PER_DISTINCT_SEASON,
  RANK_XP_PER_IMPORT_WIN,
  RANK_XP_PER_PLAYOFF_APPEARANCE,
} from '@/lib/rank/rank-xp-constants'

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

const you = {
  handle: 'guap', level: 15, levelName: 'Pro Bowler III', tier: 'Pro Bowl', tierGroup: 5, totalLevels: 25,
  xp: 2340, progressPct: 78, xpToNext: 660, nextLevelName: 'All-Pro I',
}

function hero(showLevel: boolean, ranked = true) {
  return render(
    <RankingsHero
      computedLine="Calculated"
      actions={<a href="/x">Compare</a>}
      you={you}
      headline={ranked ? { kind: 'board', rank: 6, of: 214, board: null, next: { handle: 'alpha', gap: 4.4 } } : { kind: 'notRanked', min: 3 }}
      scope="global"
      showLevel={showLevel}
    />,
  )
}

describe('RankingsHero', () => {
  it('says where you stand as the headline (2026-11-14), then the dark level card — no pills', () => {
    hero(true)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('You’re #6 of 214 — 4.4 behind @alpha')
    expect(screen.queryByTestId('rk-pills')).toBeNull()
    const card = screen.getByTestId('rk-levelcard')
    expect(card.textContent).toContain('2,340 XP')
    expect(card.textContent).toContain('660 XP to All-Pro I')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('78')
  })

  it('earns XP by the published ladder rules, read from the constants', () => {
    hero(true)
    const chips = [...screen.getByRole('list', { name: 'How XP is earned' }).querySelectorAll('li')].map((li) => li.textContent)
    expect(chips).toEqual([
      `Win +${RANK_XP_PER_IMPORT_WIN}`,
      `Playoff berth +${RANK_XP_PER_PLAYOFF_APPEARANCE}`,
      `Season played +${RANK_XP_PER_DISTINCT_SEASON}`,
      `Title +${RANK_XP_PER_CHAMPIONSHIP}`,
    ])
  })

  it('leaves the level card to My portfolio’s own body there, and says when you are not ranked', () => {
    hero(false, false)
    expect(screen.queryByTestId('rk-levelcard')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('You’re not on this board yet — it needs 3+ league-seasons with results')
  })

  it('reads in Spanish', () => {
    lang.language = 'es'
    hero(true)
    // The number is formatted in the app's number locale, which this test does not switch.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Eres #6 de 214: a 4[.,]4 de @alpha$/)
    expect(screen.getByTestId('rk-levelcard').textContent).toContain('Niv. 15 de 25')
  })
})

describe('RankingsBoardHead', () => {
  it('says what the board is, and nothing the headline or the line under the board already says', () => {
    render(<RankingsBoardHead />)
    const head = screen.getByTestId('rk-boardhead').textContent ?? ''
    expect(head).toContain('Community leaderboard')
    expect(head).not.toMatch(/managers ranked|You #|30%/)
  })
})

describe('board rows', () => {
  it('two-character avatar from the handle', () => {
    expect(handleInitials('gridironghost')).toBe('GR')
    expect(handleInitials('_x9')).toBe('X9')
    expect(handleInitials('__')).toBe('?')
  })

  it('draws the avatar chip beside the name and "Why" as a button', () => {
    const { container } = render(
      <RankTable
        caption="Board"
        columns={[{ key: 'rank', label: '#' }, { key: 'manager', label: 'Manager' }, { key: 'why', label: 'Why' }]}
        rows={[{ id: 'a', cells: [{ text: '1' }, { text: '@alpha', initials: 'AL' }, { text: 'Why', href: '?explain=a', button: true }] }]}
        emptyText="none"
      />,
    )
    expect(container.querySelector('th[scope="row"] .af-rk-av')?.textContent).toBe('AL')
    expect(container.querySelector('a.af-rk-cellbtn')?.getAttribute('href')).toBe('?explain=a')
  })
})
