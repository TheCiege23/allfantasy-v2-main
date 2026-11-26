/**
 * The chop ceremony (owner's "fun" list, 2026-11-25). The moment itself already existed: an armed card, "Drop
 * the blade", the stamp. Two things were wrong with it, and these are the tests for both:
 *
 *   - it re-armed on EVERY visit, so the newest card on the page always asked for a press to show a chop the
 *     manager had already watched;
 *   - replaying a past chop named the week where the team's name belongs ("Chopped @Week 3").
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GuillotineChopExtras, GuillotineChopMoment, chopSeenKey } from '@/components/guillotine/GuillotineSpecialtyHome'
import { choppedTeamNames } from '@/components/guillotine/guillotineHomeModel'

vi.mock('@/components/scenario-explainer/WhatDoINeed', () => ({ ChopExplainerBlock: () => null }))

const chop = (week: number) => ({
  week,
  bottom: [{ rosterId: 'r3', name: 'Edges', points: 90 }, { rosterId: 'r4', name: 'Forks', points: 85 }, { rosterId: 'r9', name: 'Daggers', points: 60 }],
  choppedRosterIds: ['r9'],
  releases: [],
})
const moment = () => screen.getByTestId('guillotine-chop-moment')
const mount = (week = 5) => render(<GuillotineChopMoment leagueId="L" lastChop={chop(week)} aliveCount={10} />)

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('seeing a chop once', () => {
  it('the first visit is armed, and the manager drops the blade', () => {
    mount()
    expect(moment().getAttribute('data-state')).toBe('armed')
    fireEvent.click(screen.getByTestId('guillotine-drop-blade'))
    expect(moment().getAttribute('data-state')).toBe('chopped')
    expect(window.localStorage.getItem(chopSeenKey('L'))).toBe('5')
  })

  it('🛑 the next visit opens on the result: no press needed to see a chop already watched', () => {
    mount()
    fireEvent.click(screen.getByTestId('guillotine-drop-blade'))
    cleanup()
    mount()
    expect(moment().getAttribute('data-state')).toBe('chopped')
    expect(screen.queryByTestId('guillotine-drop-blade')).toBeNull()
    expect(moment().textContent).toContain('Daggers is out')
  })

  it('Replay arms it again, for anyone who wants to watch it twice', () => {
    window.localStorage.setItem(chopSeenKey('L'), '5')
    mount()
    fireEvent.click(screen.getByRole('button', { name: /replay/i }))
    expect(moment().getAttribute('data-state')).toBe('armed')
    expect(screen.getByTestId('guillotine-drop-blade')).toBeTruthy()
  })

  it('a new chop is a new moment: last week being watched does not spoil this one', () => {
    window.localStorage.setItem(chopSeenKey('L'), '5')
    mount(6)
    expect(moment().getAttribute('data-state')).toBe('armed')
  })

  it('and the page swaps the moment when the week changes, without carrying its state over', () => {
    const home = (week: number) => ({ lastChop: chop(week), aliveCount: 10, waiverLabel: null }) as never
    const { rerender } = render(<GuillotineChopExtras leagueId="L" home={home(5)} />)
    fireEvent.click(screen.getByTestId('guillotine-drop-blade'))
    expect(moment().getAttribute('data-state')).toBe('chopped')
    rerender(<GuillotineChopExtras leagueId="L" home={home(6)} />)
    expect(moment().getAttribute('data-state')).toBe('armed')
  })

  it('each league remembers its own', () => {
    window.localStorage.setItem(chopSeenKey('other-league'), '9')
    mount()
    expect(moment().getAttribute('data-state')).toBe('armed')
  })

  it('with no storage to remember it in, it simply starts armed, as it always did', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    mount()
    expect(moment().getAttribute('data-state')).toBe('armed')
    fireEvent.click(screen.getByTestId('guillotine-drop-blade'))
    expect(moment().getAttribute('data-state')).toBe('chopped')
  })

  it('a value that is not a week is read as "not seen"', () => {
    window.localStorage.setItem(chopSeenKey('L'), 'nonsense')
    mount()
    expect(moment().getAttribute('data-state')).toBe('armed')
  })
})

describe('who a replayed chop names', () => {
  const chopped = [
    { name: 'Fumble Recovery', week: 1 },
    { name: 'Bench Mob', week: 2 },
    { name: ' Taco Tuesday FC ', week: 3 },
    { name: 'Two-Minute Drill', week: 3 },
  ]

  it('the team that was chopped that week, not the week', () => {
    expect(choppedTeamNames(chopped, 2)).toBe('Bench Mob')
  })

  it('both teams of a double chop', () => {
    expect(choppedTeamNames(chopped, 3)).toBe('Taco Tuesday FC & Two-Minute Drill')
  })

  it('nothing when no name is known, so the overlay never reads "Chopped @Week 3"', () => {
    expect(choppedTeamNames(chopped, 9)).toBeUndefined()
    expect(choppedTeamNames([{ name: '  ', week: 4 }, { name: null, week: 4 }], 4)).toBeUndefined()
    expect(choppedTeamNames(null, 1)).toBeUndefined()
  })
})
