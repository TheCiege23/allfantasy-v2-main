import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { buildSurvivorCommissionerTodo, type SurvivorCommissionerTodoFacts } from '@/lib/survivor/survivorCommissionerTodo'
import { SurvivorCommissionerTodoCard } from '@/components/survivor/SurvivorCommissionerTodoCard'

/** One weekly to-do list for the commissioner, built from live state. The usual answer: nothing. */
const quietWeek: SurvivorCommissionerTodoFacts = {
  leagueId: 'lg', week: 6, phase: 'pre_merge', draftStatus: 'completed', leagueSize: 16, claimedManagers: 16,
  setupIssues: [], lastError: null, paused: false, autoReveal: true,
  council: { week: 6, status: 'voting_open', isRevealed: false, tiePhase: null },
  scoresPending: true, sentAlertKeys: [], tribeRedrawPending: false,
}
const ids = (facts: Partial<SurvivorCommissionerTodoFacts>) => buildSurvivorCommissionerTodo({ ...quietWeek, ...facts }).items.map(item => item.id)

describe('buildSurvivorCommissionerTodo', () => {
  it('says nothing is needed in an ordinary week', () => {
    const todo = buildSurvivorCommissionerTodo(quietWeek)
    expect(todo.items).toEqual([])
    expect(todo.actionCount).toBe(0)
    expect(todo.headline).toBe('Nothing needed for week 6. Chimmy runs the season; you get an alert if that changes.')
  })

  it('before the draft: open seats and setup gaps, and nothing about a week', () => {
    const todo = buildSurvivorCommissionerTodo({ ...quietWeek, week: null, phase: 'pre_draft', draftStatus: 'pre_draft', claimedManagers: 13, setupIssues: ['Exile is enabled but its side league is not linked.'], council: null })
    expect(todo.items.map(item => [item.id, item.title])).toEqual([['fill_seats', 'Fill 3 open seats'], ['fix_setup', 'Fix one setup problem before the draft']])
    expect(todo.headline).toBe('2 things need you.')
    // Seats stop mattering once the draft has started.
    expect(ids({ claimedManagers: 13 })).toEqual([])
  })

  it('lists a council only when it is waiting on the commissioner', () => {
    expect(ids({ council: { week: 6, status: 'tie_pending', isRevealed: false, tiePhase: 'commissioner_tiebreak_required' } })).toEqual(['break_tie'])
    // A tie the engine settles by itself (revote, rocks) is not a chore.
    expect(ids({ council: { week: 6, status: 'tie_pending', isRevealed: false, tiePhase: 'revote' } })).toEqual([])
    expect(ids({ autoReveal: false, council: { week: 6, status: 'closed', isRevealed: false, tiePhase: null } })).toEqual(['read_votes'])
    expect(ids({ autoReveal: true, council: { week: 6, status: 'closed', isRevealed: false, tiePhase: null } })).toEqual([])
    expect(ids({ autoReveal: false, council: { week: 6, status: 'closed', isRevealed: true, tiePhase: null } })).toEqual([])
  })

  it('a pause wins over the error it is recorded as; a real error is listed once', () => {
    expect(ids({ paused: true, lastError: 'PAUSED: commissioner' })).toEqual(['resume'])
    expect(ids({ lastError: 'PAUSED: commissioner' })).toEqual([])
    expect(ids({ lastError: 'boom' })).toEqual(['automation_error'])
  })

  it('keeps an overdue alert on the list only while its condition holds', () => {
    expect(ids({ sentAlertKeys: ['scores_overdue:6'] })).toEqual(['scores_overdue'])
    expect(ids({ sentAlertKeys: ['scores_overdue:6'], scoresPending: false })).toEqual([])
    expect(ids({ sentAlertKeys: ['scores_overdue:5'] })).toEqual([])
    expect(ids({ sentAlertKeys: ['jury_overdue:2027-01-12T00:00:00.000Z'] })).toEqual(['jury_overdue'])
    expect(ids({ sentAlertKeys: ['jury_overdue:x'], phase: 'complete' })).toEqual([])
  })

  it('a pending tribe redraw is a heads-up, listed after the actions, and does not count as one', () => {
    const todo = buildSurvivorCommissionerTodo({ ...quietWeek, tribeRedrawPending: true, lastError: 'boom' })
    expect(todo.items.map(item => [item.id, item.tone])).toEqual([['automation_error', 'action'], ['tribe_redraw', 'heads_up']])
    expect(todo.actionCount).toBe(1)
    expect(todo.headline).toBe('One thing needs you.')
    expect(buildSurvivorCommissionerTodo({ ...quietWeek, tribeRedrawPending: true }).headline).toMatch(/^Nothing needed/)
  })

  it('links every item into the commissioner tools', () => {
    const todo = buildSurvivorCommissionerTodo({ ...quietWeek, paused: true, tribeRedrawPending: true, autoReveal: false, council: { week: 6, status: 'closed', isRevealed: false, tiePhase: null } })
    expect(Object.fromEntries(todo.items.map(item => [item.id, item.href]))).toEqual({
      resume: '/survivor/lg/commissioner?tab=tribal',
      read_votes: '/survivor/lg/tribal',
      tribe_redraw: '/survivor/lg/commissioner?tab=tribes',
    })
  })

  it('says the season is over once it is', () => {
    const todo = buildSurvivorCommissionerTodo({ ...quietWeek, phase: 'complete', lastError: 'boom', tribeRedrawPending: true })
    expect(todo.items).toEqual([])
    expect(todo.headline).toBe('The season is over. Nothing needed.')
  })
})

describe('SurvivorCommissionerTodoCard', () => {
  it('shows the one-line all-clear', () => {
    render(<SurvivorCommissionerTodoCard todo={buildSurvivorCommissionerTodo(quietWeek)} />)
    expect(screen.getByRole('heading', { name: 'Your to-do · week 6' })).toBeTruthy()
    expect(screen.getByText(/Nothing needed for week 6/)).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('shows each item with its action link', () => {
    render(<SurvivorCommissionerTodoCard todo={buildSurvivorCommissionerTodo({ ...quietWeek, council: { week: 6, status: 'tie_pending', isRevealed: false, tiePhase: 'commissioner_tiebreak_required' } })} />)
    expect(screen.getByText('One thing needs you.')).toBeTruthy()
    expect(screen.getByText('Break the week 6 tie')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Break the tie' }).getAttribute('href')).toBe('/survivor/lg/tribal')
  })
})
