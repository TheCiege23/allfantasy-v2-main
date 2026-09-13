/**
 * The college basketball game view: two halves in the line score and the
 * play-by-play, and the NCAA court on the shot chart.
 */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({
  default: ({ name }: { name: string }) => <span data-testid="face">{name}</span>,
}))

import { LiveGameView, playTypeLabel } from '@/components/core-app/screens/LiveGameView'
import { trimEspnGameSummary } from '@/lib/live/espnGameSummary'
import { NCAAB_OPTS, rawNcaab } from './fixtures/espn-ncaab-summary'

const view = () =>
  render(
    <LiveGameView
      initial={{ detail: trimEspnGameSummary(rawNcaab(), NCAAB_OPTS), stale: false, failed: false }}
      sport="NCAAB"
      gameId="401825532"
      backHref="/core/live?sport=NCAAB"
    />,
  )

describe('playTypeLabel', () => {
  it('splits ESPN college type names and never calls a free throw "Made"', () => {
    expect(playTypeLabel('LayUpShot')).toBe('Layup Shot')
    expect(playTypeLabel('JumpShot')).toBe('Jump Shot')
    expect(playTypeLabel('MadeFreeThrow')).toBe('Free Throw')
    expect(playTypeLabel('Pass Reception')).toBe('Pass Reception')
    expect(playTypeLabel(null)).toBeNull()
  })
})

describe('LiveGameView — college basketball', () => {
  it('line score has two halves then OT', () => {
    const { container } = view()
    expect([...container.querySelectorAll('.af-gv-lines thead th')].map((th) => th.textContent)).toEqual(['', '1', '2', 'OT', 'T'])
  })

  it('play-by-play pages by half: opens on OT, then 1st Half / 2nd Half', () => {
    const { container } = view()
    const heads = () => [...container.querySelectorAll('.af-gv-period-head')].map((h) => h.textContent)
    expect(heads()).toEqual(['Overtime'])
    expect(screen.getByRole('button', { name: 'OT' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('group', { name: 'Half' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'H1' }))
    expect(heads()).toEqual(['1st Half'])
    fireEvent.click(screen.getByRole('button', { name: 'All plays' }))
    fireEvent.click(screen.getByRole('button', { name: 'H2' }))
    expect(heads()).toEqual(['2nd Half'])
    expect(screen.queryByText(/subbing in/)).toBeNull()
  })

  it('shot chart draws the NCAA court: 12 ft lane and the 22 ft 1.75 in arc', () => {
    const { container } = view()
    const lines = container.querySelector('.af-gv-court-lines[data-court="college"]') as SVGElement
    expect(lines.querySelector('rect')!.getAttribute('width')).toBe('12')
    expect(lines.querySelector('path')!.getAttribute('d')).toMatch(/^M3\.35 0 .*A22\.15 22\.15/)
    const court = container.querySelector('.af-gv-court') as SVGElement
    expect(court.querySelectorAll('.af-gv-shot[data-made="true"]')).toHaveLength(2)
    expect(court.querySelectorAll('.af-gv-shot[data-made="false"]')).toHaveLength(1)
  })

  it('box score and last play read the basketball line', () => {
    const { container } = view()
    const ill = container.querySelector('.af-gv-box-team[data-team="356"]') as HTMLElement
    expect(within(ill).getByText('Bench')).toBeInTheDocument()
    expect(within(ill).getByText('Did not play')).toBeInTheDocument()
    // ESPN's college type "LayUpShot" reads as words.
    expect(container.querySelector('.af-gv-lastplay-title')!.textContent).toBe('Layup Shot')
    const card = container.querySelector('.af-gv-pcard') as HTMLElement
    expect(card.querySelector('.af-gv-pcard-name')!.textContent).toBe('Donovan Dent')
    expect(within(card).getAllByRole('term').map((t) => t.textContent)).toEqual(['PTS', 'REB', 'AST', 'FG'])
  })
})
