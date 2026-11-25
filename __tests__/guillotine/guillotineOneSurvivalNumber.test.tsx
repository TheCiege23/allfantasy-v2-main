/**
 * One survival number for one question (owner's "fun" list and simplicity rule, 2026-11-25).
 *
 * The Chop page's list shows each team's chance of surviving THIS week, from the scores so far plus the games
 * each team has left. The "What do I need to avoid the chop?" block under it showed a second weekly number,
 * from season averages. Both methods are honest and they disagree mid-week, so the page said two different
 * things about the same week. When the list has its odds, the block keeps only what the list does not say.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ChopExplainerBlock } from '@/components/scenario-explainer/WhatDoINeed'
import { GuillotineChopExtras } from '@/components/guillotine/GuillotineSpecialtyHome'

const scenarios = {
  kind: 'guillotine',
  chop: {
    supported: true,
    week: 7,
    teamsPerChop: 1,
    chopWeeks: 6,
    you: { name: 'Axes', surviveWeekPct: 71, surviveAllPct: 22, expectedChopsSurvived: 3.1, safeScore: { p50: 96, p80: 104.2, p95: 117.6 } },
    table: [
      { name: 'Blades', isYou: false, surviveWeekPct: 93, surviveAllPct: 30 },
      { name: 'Axes', isYou: true, surviveWeekPct: 71, surviveAllPct: 22 },
    ],
    basis: 'We simulate the remaining chops from each team’s weekly average this season.',
  },
}

function mount(node: React.ReactElement) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => scenarios })))
  render(node)
  return screen.findByTestId('chop-explainer')
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the block under the list', () => {
  it('🛑 when the list shows this week’s odds, it does not show a second weekly number', async () => {
    const block = await mount(<ChopExplainerBlock leagueId="L" weekOdds={false} />)
    expect(screen.getByTestId('chop-explainer-you').textContent).toBe('Axes: 22% to outlast every remaining chop.')
    expect(block.textContent).not.toContain('to survive week 7')
    expect(block.textContent).not.toContain('to survive this week')
    expect(block.textContent).not.toContain('71%')
    expect(screen.queryByTestId('chop-explainer-week-table')).toBeNull()
  })

  it('it keeps what the list does not say: the score you need, and how it was worked out', async () => {
    const block = await mount(<ChopExplainerBlock leagueId="L" weekOdds={false} />)
    expect(block.textContent).toContain('Score 105 and you survive this week 4 times in 5 (118 for 19 in 20).')
    expect(block.textContent).toContain('We simulate the remaining chops')
  })

  it('[control] with no odds in the list, the weekly number and the table are still here', async () => {
    const block = await mount(<ChopExplainerBlock leagueId="L" />)
    expect(screen.getByTestId('chop-explainer-you').textContent).toBe('Axes: 71% to survive week 7, 22% to outlast every remaining chop.')
    expect([...screen.getByTestId('chop-explainer-week-table').querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Blades: 93% to survive this week',
      'Axes: 71% to survive this week',
    ])
    expect(block.textContent).toContain('Score 105')
  })
})

describe('the Chop page decides which, from its own list', () => {
  it('the list has odds: the weekly number is left to the list', async () => {
    await mount(<GuillotineChopExtras leagueId="L" home={null} boardHasOdds />)
    expect(screen.getByTestId('chop-explainer-you').textContent).toBe('Axes: 22% to outlast every remaining chop.')
  })

  it('the list has none (no projections that week): the block still gives a weekly number', async () => {
    await mount(<GuillotineChopExtras leagueId="L" home={null} boardHasOdds={false} />)
    expect(screen.getByTestId('chop-explainer-you').textContent).toContain('71% to survive week 7')
  })
})
