import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BracketChallenge } from '@/components/core-app/screens/BracketChallenge'
import { SPORT_SHELLS, firstRoundPairs, toClientShell } from '@/lib/brackets/sportShell'
import type { BracketChallengeData, BracketSide } from '@/lib/core-app/bracketChallenge'

/*
 * `next/link` reads the App Router context and throws when it is absent, which
 * says nothing about this screen. Stubbed to the anchor it renders in practice.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

/**
 * /core/bracket keeps its champion and series-length picks in component state
 * and nowhere else: no route, no table, no entry. A reload clears them.
 *
 * The screen used to say "Nothing you pick is lost when the field locks", which
 * promised the one thing it does not do. These tests pin the honest version:
 * the screen says the picks are not saved, on every render (not only while
 * seeding is pending, because they are not saved after seeding either), and a
 * remount really does start empty — so if someone later wires persistence, the
 * second test goes red and tells them to change the copy with it.
 */

const shell = toClientShell(SPORT_SHELLS.mlb)

function side(label: string): BracketSide {
  const perSide = shell.teamCount / 2
  return {
    label,
    slots: Array.from({ length: perSide }, (_, i) => ({
      seed: i + 1,
      team: null,
      bye: shell.byeSeeds.includes(i + 1),
    })),
    pairs: firstRoundPairs(shell),
  }
}

function data(seedsPending: boolean): BracketChallengeData {
  return {
    shell,
    sports: [{ key: 'mlb', label: 'MLB', available: true }],
    sides: [side('American League'), side('National League')],
    pool: [
      { id: 't-1', name: 'Club One', shortName: 'ONE', logo: null },
      { id: 't-2', name: 'Club Two', shortName: 'TWO', logo: null },
    ],
    seedsPending,
  }
}

afterEach(cleanup)

describe('BracketChallenge — picks are a preview, and the screen says so', () => {
  it.each([true, false])('never promises persistence (seedsPending=%s)', (seedsPending) => {
    const { container } = render(<BracketChallenge data={data(seedsPending)} />)
    const text = container.textContent ?? ''

    expect(text).not.toMatch(/nothing you pick is lost/i)
    expect(text).not.toMatch(/\b(are|is) saved\b/i)

    const note = screen.getByTestId('af-bk-unsaved')
    expect(note.textContent).toMatch(/not saved/i)
    expect(note.textContent).toMatch(/reload/i)
    // Points at where picks DO persist: a pool, entered from the Brackets hub.
    expect(note.querySelector('a')?.getAttribute('href')).toBe('/brackets')
  })

  it('a remount starts empty — the picks live in component state only', () => {
    const first = render(<BracketChallenge data={data(true)} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't-2' } })
    fireEvent.click(screen.getByRole('button', { name: '6' }))
    expect(screen.getByRole('combobox')).toHaveProperty('value', 't-2')
    expect(screen.getByRole('button', { name: '6' }).getAttribute('aria-pressed')).toBe('true')
    first.unmount()

    render(<BracketChallenge data={data(true)} />)
    expect(screen.getByRole('combobox')).toHaveProperty('value', '')
    expect(screen.getByText('Pick your champion')).toBeTruthy()
    expect(screen.getByRole('button', { name: '6' }).getAttribute('aria-pressed')).toBe('false')
  })
})
