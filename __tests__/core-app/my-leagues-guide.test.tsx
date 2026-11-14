import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * The My Leagues guide (2026-11-14). Found on the owner's 82-league account: 70 leagues sat in "Needs you",
 * because any warning chip put a league there — 23 of them only had hurt BENCH players and 17 had not
 * drafted yet. Cards printed "1 STARTER FLAGGED" twice and "COMMISH" beside "YOU COMMISH". Pinned here:
 * the honest tiers, the headline, plain-word reasons, one copy of each fact, and the folds.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}))

import { MyLeaguesV4 } from '@/components/core-app/screens/MyLeaguesV4'
import type { MyLeaguesLeague } from '@/lib/core-app/myLeagues'
import { extraChips, leagueTier, myLeaguesHeadline, parseReason } from '@/lib/core-app/myLeaguesGuide'

type Chip = { label: string; tone?: string | null }
const chip = (label: string, tone: string | null = 'warn'): Chip => ({ label, tone })

describe('leagueTier', () => {
  it('a starter who is out, or an empty slot, needs you (the ranker marks it urgent)', () => {
    expect(leagueTier({ priority: 'urgent', chips: [chip('1 STARTER OUT', 'bad')] })).toBe('needs')
  })

  it('a questionable starter needs you', () => {
    expect(leagueTier({ chips: [chip('1 STARTER FLAGGED')] })).toBe('needs')
  })

  it('an unchecked lineup and a draft under way need you', () => {
    expect(leagueTier({ chips: [chip('LINEUP NOT VERIFIED')] })).toBe('needs')
    expect(leagueTier({ priority: 'draft', chips: [chip('DRAFTING', 'live')] })).toBe('needs')
  })

  it('hurt bench players alone do NOT need you — the league stays in season', () => {
    expect(leagueTier({ chips: [chip('3 FLAGGED'), chip('YOU COMMISH', 'good')] })).toBe('playing')
  })

  it('a league waiting on its draft gets its own group', () => {
    expect(leagueTier({ chips: [chip('PRE DRAFT')], matchupNote: 'No scores read yet' })).toBe('predraft')
  })

  it('a pre-draft league with a real problem still needs you', () => {
    expect(leagueTier({ chips: [chip('PRE DRAFT'), chip('LINEUP NOT VERIFIED')] })).toBe('needs')
  })

  it('season over or no roster is quiet; otherwise in season', () => {
    expect(leagueTier({ chips: [chip('SEASON OVER', null)] })).toBe('quiet')
    expect(leagueTier({ chips: [], matchupNote: 'No roster imported yet' })).toBe('quiet')
    expect(leagueTier({ chips: [] })).toBe('playing')
  })
})

describe('parseReason / extraChips', () => {
  it('reads the 34a chip into a phrase key with its count', () => {
    expect(parseReason('2 STARTERS OUT')).toEqual({ key: 'startersOut', n: 2 })
    expect(parseReason('1 STARTER FLAGGED')).toEqual({ key: 'startersQuestionable', n: 1 })
    expect(parseReason('7 FLAGGED')).toEqual({ key: 'playersHurt', n: 7 })
    expect(parseReason('PRE DRAFT')).toEqual({ key: 'preDraft' })
    expect(parseReason('SOMETHING NEW')).toEqual({ key: 'raw', label: 'SOMETHING NEW' })
    expect(parseReason(null)).toBeNull()
  })

  it('drops the chip the reason line already says, and YOU COMMISH (the badge says it)', () => {
    const chips = [chip('1 STARTER FLAGGED'), chip('YOU COMMISH', 'good'), chip('BEST BALL · AUTO LINEUP', null)]
    expect(extraChips(chips, '1 STARTER FLAGGED').map((c) => c.label)).toEqual(['BEST BALL · AUTO LINEUP'])
  })
})

describe('myLeaguesHeadline', () => {
  it('leads with lineup fixes and counts the questionable ones separately', () => {
    const h = myLeaguesHeadline([
      { priority: 'urgent', chips: [chip('1 STARTER OUT', 'bad')] },
      { chips: [chip('1 STARTER FLAGGED')] },
      { chips: [chip('2 STARTERS FLAGGED')] },
      { chips: [chip('4 FLAGGED')] },
      { chips: [chip('PRE DRAFT')] },
    ])
    expect(h).toEqual({ fix: 1, questionable: 2, drafting: 0, predraft: 1, needs: 3, lead: 'fix' })
  })

  it('says nothing needs you when nothing does', () => {
    expect(myLeaguesHeadline([{ chips: [chip('2 FLAGGED')] }]).lead).toBe('clear')
    expect(myLeaguesHeadline([]).lead).toBe('empty')
  })

  // Live 2026-11-14: "17 waiting on a draft" above a "Before the draft" group of 19 — two pre-draft
  // Survivor leagues each carried an Exile Island, and the group counts the island under its league.
  it('counts an Exile Island in its Survivor league’s group, as the screen shows it', () => {
    const h = myLeaguesHeadline([
      { id: 'sv', chips: [chip('PRE DRAFT')] },
      { id: 'ex', exileOf: 'sv', chips: [chip('1 STARTER FLAGGED')] },
      { id: 'other', chips: [chip('PRE DRAFT')] },
    ])
    expect(h.predraft).toBe(3)
    // Shown under "Before the draft", so it is not also counted as needing you.
    expect(h.questionable).toBe(0)
    expect(h.needs).toBe(0)
  })

  it('an island whose league is not in the list keeps its own group, and a league is never its own island', () => {
    expect(myLeaguesHeadline([{ id: 'ex', exileOf: 'gone', chips: [chip('1 STARTER FLAGGED')] }])).toMatchObject({ questionable: 1, needs: 1 })
    expect(myLeaguesHeadline([{ id: 'sv', exileOf: 'sv', chips: [chip('PRE DRAFT')] }]).predraft).toBe(1)
  })
})

function league(id: string, over: Partial<MyLeaguesLeague>): MyLeaguesLeague {
  const base = {
    id,
    name: `League ${id}`,
    platform: 'sleeper',
    sport: 'NFL',
    isDynasty: false,
    isCommissioner: false,
    reason: null,
    chips: [],
    href: `/core?league=${id}`,
    actionLabel: 'Open league',
    ...over,
  } as unknown as MyLeaguesLeague
  return { ...base, tier: leagueTier(base) }
}

const LEAGUES = [
  league('out', { priority: 'urgent', reason: '1 STARTER OUT', chips: [chip('1 STARTER OUT', 'bad'), chip('YOU COMMISH', 'good')] as MyLeaguesLeague['chips'], isCommissioner: true, actionLabel: 'See who is flagged',
    matchup: { week: 10, scored: true, yourScore: 20.3, opponentScore: 18.1, opponent: 'Wounded Warriors', unpaired: false } }),
  league('q', { reason: '1 STARTER FLAGGED', chips: [chip('1 STARTER FLAGGED')] as MyLeaguesLeague['chips'],
    matchup: { week: 10, scored: false, yourScore: 0, opponentScore: 0, opponent: 'Hustead', unpaired: false } }),
  league('bench', { reason: '3 FLAGGED', chips: [chip('3 FLAGGED')] as MyLeaguesLeague['chips'], actionLabel: 'See who is flagged' }),
  league('pre', { reason: 'PRE DRAFT', chips: [chip('PRE DRAFT')] as MyLeaguesLeague['chips'], matchupNote: 'No scores read yet' }),
]

function renderBoard() {
  return render(
    <MyLeaguesV4
      leagues={LEAGUES}
      history={[]}
      counts={{ live: 4, history: 12, all: 16, needs: 2, playing: 1, quiet: 0, predraft: 1, commissioner: 1, drafting: 1, dynasty: 0 }}
      platforms={['sleeper']}
      coverage={[{ label: 'Records and standings', reason: 'no league result has been read yet' }]}
      notice={null}
      importHref="/import"
    />,
  )
}

describe('<MyLeaguesV4 /> — the guide', () => {
  it('the headline says how many leagues need a lineup fix, with the questionable ones as a chip', () => {
    const { container } = renderBoard()
    expect(container.querySelector('.af-mlg-title')?.textContent).toBe('1 league needs a lineup fix')
    const chips = [...container.querySelectorAll('.af-mlg-chip')].map((c) => c.textContent)
    expect(chips).toEqual(['1 more with a questionable starter', '1 waiting on a draft'])
    expect(screen.getByTestId('my-leagues-why').textContent).toContain('scores zero')
  })

  it('groups honestly: needs you, in season (bench injuries), before the draft', () => {
    const { container } = renderBoard()
    const group = (id: string) => [...container.querySelectorAll(`#${id} .af-ml-card-name`)].map((e) => e.textContent)
    expect(group('af-ml-needs')).toEqual(['League out', 'League q'])
    expect(group('af-ml-playing')).toEqual(['League bench'])
    expect(group('af-ml-predraft')).toEqual(['League pre'])
  })

  it('a card says its reason once, in plain words, and the commissioner once', () => {
    const { container } = renderBoard()
    const card = [...container.querySelectorAll('.af-ml-card')].find((c) => c.textContent?.includes('League out'))!
    expect(card.querySelector('.af-ml-reason')?.textContent).toBe('1 starter out')
    expect(card.querySelectorAll('.af-ml-tag').length).toBe(0)
    expect(card.textContent?.match(/COMMISH/g)?.length).toBe(1)
    expect(card.querySelector('.af-ml-note')?.textContent).toBe('Week 10 · 20.3–18.1 vs Wounded Warriors')
    expect(card.querySelector('.af-ml-open')?.textContent).toBe("See who's hurt")
  })

  it('an unscored game reads "Week 10 vs …", and a bench injury is a note, not a warning tint', () => {
    const { container } = renderBoard()
    const cards = [...container.querySelectorAll('.af-ml-card')]
    const q = cards.find((c) => c.textContent?.includes('League q'))!
    expect(q.querySelector('.af-ml-note')?.textContent).toBe('Week 10 vs Hustead')
    expect(q.querySelector('.af-ml-reason')?.textContent).toBe('1 starter questionable')
    const bench = cards.find((c) => c.textContent?.includes('League bench'))!
    expect(bench.querySelector('.af-ml-reason')?.textContent).toBe('3 players hurt')
    expect(bench.getAttribute('data-tone')).toBeNull()
  })

  it('folds the filters, the extra links, past seasons and the not-watched list', () => {
    renderBoard()
    const filters = screen.getByTestId('my-leagues-filters')
    expect(filters.hasAttribute('open')).toBe(false)
    expect(filters.textContent).toContain('Connect two leagues')
    expect(filters.textContent).toContain('My brackets')
    expect(filters.querySelector('select[aria-label="Filter by platform"]')).not.toBeNull()
    const foot = screen.getByTestId('my-leagues-foot')
    expect(foot.hasAttribute('open')).toBe(false)
    expect(foot.querySelector('summary')?.textContent).toBe("Past seasons (12) and what we can't see yet")
    expect(foot.textContent).toContain('Records and standings')
  })

  it('header keeps two actions: create and import', () => {
    const { container } = renderBoard()
    expect([...container.querySelectorAll('.af-ml-actions a')].map((a) => a.textContent)).toEqual(['Create a league', 'Import a league'])
  })
})
