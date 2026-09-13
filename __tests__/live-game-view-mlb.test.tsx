/**
 * The MLB game view: R-H-E line score, live at-bat (diamond, count, strike zone),
 * spray chart, at-bats by inning, batting/pitching box score, pitchers of record.
 */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))

import { LiveGameView } from '@/components/core-app/screens/LiveGameView'
import { trimEspnGameSummary } from '@/lib/live/espnGameSummary'
import { MLB_OPTS, rawMlb } from './fixtures/espn-mlb-summary'

const view = (live = false) =>
  render(
    <LiveGameView
      initial={{ detail: trimEspnGameSummary(rawMlb({ live }), MLB_OPTS), stale: false, failed: false }}
      sport="MLB"
      gameId="401816920"
      backHref="/core/live?sport=MLB"
    />,
  )

describe('LiveGameView — MLB', () => {
  it('line score has nine innings then R H E', () => {
    const { container } = view()
    const heads = [...container.querySelectorAll('.af-gv-lines thead th')].map((th) => th.textContent)
    expect(heads).toEqual(['', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'R', 'H', 'E'])
    const col = container.querySelectorAll('.af-gv-lines tbody tr')[0] as HTMLElement
    expect([...col.querySelectorAll('td')].slice(-3).map((td) => td.textContent)).toEqual(['1', '1', '0'])
  })

  it('a final has no at-bat panel but names the pitchers of record', () => {
    const { container } = view()
    expect(container.querySelector('.af-gv-atbat')).toBeNull()
    const decisions = [...container.querySelectorAll('.af-gv-decision')]
    expect(decisions).toHaveLength(2)
    expect(decisions[0]!.textContent).toContain('Winning Pitcher')
    expect(decisions[0]!.textContent).toContain('6.1 IP')
  })

  it('spray chart: a home run and a hit, no marker for the strikeout, and a team filter', () => {
    const { container } = view()
    const chart = container.querySelector('.af-gv-diamond') as SVGElement
    expect(chart.querySelectorAll('.af-gv-bb')).toHaveLength(2)
    expect(chart.querySelectorAll('.af-gv-bb[data-kind="hr"]')).toHaveLength(1)
    expect(chart.querySelector('.af-gv-bb[data-kind="hr"]')!.getAttribute('r')).toBe('11')
    expect(screen.getByText('2 hits · 1 HR')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'DET' }))
    expect(chart.querySelectorAll('.af-gv-bb')).toHaveLength(1)
    expect(screen.getByText('1 hit · 0 HR')).toBeInTheDocument()
  })

  it('play-by-play: scoring at-bats newest first; All plays shows the bottom half before the top', () => {
    const { container } = view()
    const scoring = [...container.querySelectorAll('.af-gv-bplay')]
    expect(scoring).toHaveLength(2)
    expect(scoring[0]!.textContent).toContain('tripled')
    expect(scoring[0]!.textContent).toContain('Bot 1st')

    fireEvent.click(screen.getByRole('button', { name: 'All plays' }))
    expect([...container.querySelectorAll('.af-gv-period-head')].map((h) => h.textContent)).toEqual(['Bottom 1st', 'Top 1st'])
    const rows = [...container.querySelectorAll('.af-gv-bplay')]
    expect(rows).toHaveLength(3)
    expect(within(rows[0] as HTMLElement).getByText('Peck stole second.')).toBeInTheDocument()
    expect(rows[2]!.textContent).toContain('3 P')
  })

  it('box score: batting columns, a substitute row, a team row, and the pitching decision', () => {
    const { container } = view()
    const col = container.querySelector('.af-gv-box-team[data-team="27"]') as HTMLElement
    const batting = col.querySelector('table[data-kind="batting"]') as HTMLElement
    expect([...batting.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Batters', 'AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K', 'AVG'])
    expect(batting.querySelector('tr[data-sub="true"]')!.textContent).toContain('J. Beck')
    expect(batting.querySelector('.af-gv-bbox-total')!.textContent).toContain('Team')
    expect(col.querySelector('table[data-kind="pitching"]')!.textContent).toContain('(L, 0-8)')
  })

  it('live: diamond, count, the batter and pitcher, and this at-bat\'s pitches on the zone', () => {
    const { container } = view(true)
    const panel = container.querySelector('.af-gv-atbat') as HTMLElement
    expect(panel.querySelector('rect[data-base="third"]')!.getAttribute('data-on')).toBe('true')
    expect(panel.querySelector('rect[data-base="first"]')!.getAttribute('data-on')).toBe('false')
    const on = (label: string) => panel.querySelectorAll(`.af-live-count-row[data-count="${label}"] .af-live-count-dot[data-on="true"]`).length
    expect([on('B'), on('S'), on('O')]).toEqual([1, 1, 0])
    // The mocked headshot prints the name too, so read the name element itself.
    expect([...panel.querySelectorAll('.af-live-atbat-name')].map((n) => n.textContent)).toEqual(['Gabriel Hughes', 'Riley Greene'])
    expect(panel.querySelectorAll('.af-gv-zone .af-gv-pitch')).toHaveLength(2)
    expect([...panel.querySelectorAll('.af-gv-pitches li')].map((li) => li.getAttribute('data-kind'))).toEqual(['strike', 'ball'])
  })

  it('live last play cards show the batting line for the batter and the pitching line for the pitcher', () => {
    const { container } = view(true)
    const cards = [...container.querySelectorAll('.af-gv-pcard')] as HTMLElement[]
    expect(cards.map((c) => within(c).getAllByRole('term').map((t) => t.textContent))).toEqual([
      ['H-AB', 'R', 'RBI', 'HR'],
      ['IP', 'H', 'ER', 'K'],
    ])
    fireEvent.click(screen.getByRole('button', { name: 'All plays' }))
    expect(container.querySelector('.af-gv-bplay')!.textContent).toContain('Riley Greene at bat')
  })
})
