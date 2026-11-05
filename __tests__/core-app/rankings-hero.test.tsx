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

function hero(showLevel: boolean, community: { rank: number; of: number } | null = { rank: 6, of: 214 }) {
  return render(<RankingsHero computedLine="Calculated" actions={<a href="/x">Compare</a>} you={you} community={community} showLevel={showLevel} />)
}

describe('RankingsHero', () => {
  it('shows where you stand on Community and your level, then the dark level card', () => {
    hero(true)
    expect(screen.getByTestId('rk-pills').textContent).toBe('#6of 214 · Community15Level · Pro Bowler III')
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

  it('leaves the level card to My portfolio’s own body there, and drops the Community pill when you are not ranked', () => {
    hero(false, null)
    expect(screen.queryByTestId('rk-levelcard')).toBeNull()
    expect(screen.getByTestId('rk-pills').textContent).toBe('15Level · Pro Bowler III')
  })

  it('reads in Spanish', () => {
    lang.language = 'es'
    hero(true)
    expect(screen.getByTestId('rk-pills').textContent).toContain('de 214 · Comunidad')
    expect(screen.getByTestId('rk-levelcard').textContent).toContain('Niv. 15 de 25')
  })
})

describe('RankingsBoardHead', () => {
  it('states the population and, on Overall only, the score equation with its weights', () => {
    const { rerender } = render(<RankingsBoardHead shown={10} population={214} you={{ rank: 6, of: 214 }} overall />)
    expect(screen.getByTestId('rk-boardhead').textContent).toContain('10 of 214 managers ranked')
    const weights = [...screen.getByRole('list', { name: 'Score components and their weights' }).querySelectorAll('li')].map((li) => li.textContent)
    expect(weights).toEqual(['Win rate 30%', 'Scoring 20%', 'Titles 25%', 'Playoffs 25%'])
    rerender(<RankingsBoardHead shown={10} population={214} you={null} overall={false} />)
    expect(screen.queryByRole('list', { name: 'Score components and their weights' })).toBeNull()
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
