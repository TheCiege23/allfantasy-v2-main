import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { Dash3ATriage, type TriageBookRow } from '@/components/core-app/screens/Dash3ATriage'

/**
 * The founder's complaint, pinned: "it shouldn't be random."
 *
 * The loader owns the ordering, so these cover the card's half — that it
 * renders the facts the ordering is built on, and that a player with no price
 * is shown as unpriced rather than as worthless.
 */

const NOW = new Date('2026-09-06T16:00:00Z')

function row(over: Partial<TriageBookRow> = {}): TriageBookRow {
  return {
    initials: 'AJ',
    name: 'Ashton Jeanty',
    imageUrl: null,
    leagues: [
      {
        id: 'l1',
        name: 'Bla bla bla',
        platform: 'sleeper',
        imageUrl: null,
        slot: 'starter',
        bench: [{ name: 'Tyjae Spears', position: 'RB' }],
      },
      { id: 'l2', name: 'Guillotine League 26', platform: 'sleeper', imageUrl: null, slot: 'bench' },
      { id: 'l3', name: 'Work League', platform: 'espn', imageUrl: null, slot: 'ir' },
    ],
    note: 'RB · Out',
    position: 'RB',
    team: 'LV',
    sport: 'NFL',
    status: 'Out',
    exposure: '3 of 61',
    exposureCount: 3,
    exposureTotal: 61,
    startingIn: 1,
    benchIn: 1,
    irIn: 1,
    taxiIn: 0,
    description: 'Ruled out — ankle. Did not practice Friday.',
    value: { value: 6400, overallRank: 14, positionRank: 4 },
    reportedAt: NOW.toISOString(),
    reportedAgo: '3h ago',
    nextKickoffAt: null,
    tone: 'bad',
    ...over,
  }
}

const BASIS = { format: 'DYNASTY', qbFormat: 'ONE_QB' }

describe('Dash3ATriage — the facts the ordering is built on', () => {
  it('splits the slots instead of only counting lineups', () => {
    const { container } = render(<Dash3ATriage book={[row()]} now={NOW} valueBasis={BASIS} />)
    const text = container.textContent ?? ''
    expect(text).toContain('starter in 1')
    expect(text).toContain('bench in 1')
    expect(text).toContain('IR in 1')
    // Zero counts are omitted, not printed as "taxi in 0".
    expect(text).not.toContain('taxi in')
  })

  it('names the slot on each league chip', () => {
    const { container } = render(<Dash3ATriage book={[row()]} now={NOW} valueBasis={BASIS} />)
    const slots = [...container.querySelectorAll('.af-triage-slot')].map((n) => n.textContent)
    expect(slots).toEqual(['STARTER', 'bench', 'IR'])
  })

  it('shows no slot at all when the roster could not be read', () => {
    // A roster the loader could not read contributes no slot AND no count —
    // this fixture matches what the loader would actually emit.
    const unknown = row({
      leagues: [{ id: 'l1', name: 'Bla bla bla', platform: 'sleeper', imageUrl: null, slot: null }],
      benchIn: 0,
      irIn: 0,
      taxiIn: 0,
    })
    const { container } = render(<Dash3ATriage book={[unknown]} now={NOW} valueBasis={BASIS} />)
    // Never defaults to "bench" — an unread roster is unknown, not benched.
    expect(container.querySelectorAll('.af-triage-slot').length).toBe(0)
    expect(container.textContent).not.toContain('bench')
  })

  it("renders the feed's own sentence about what happened", () => {
    const { container } = render(<Dash3ATriage book={[row()]} now={NOW} valueBasis={BASIS} />)
    expect(container.textContent).toContain('Ruled out — ankle')
  })

  it('renders nothing about the injury beyond the status when no description exists', () => {
    const bare = row({ description: null })
    const { container } = render(<Dash3ATriage book={[bare]} now={NOW} valueBasis={BASIS} />)
    expect(container.querySelectorAll('.af-triage-note').length).toBe(0)
    // No invented timeline.
    expect(container.textContent).not.toMatch(/expected|weeks out|return/i)
  })

  it('shows rank when priced', () => {
    const { container } = render(<Dash3ATriage book={[row()]} now={NOW} valueBasis={BASIS} />)
    expect(container.textContent).toContain('#14 overall')
    expect(container.textContent).toContain('RB4')
  })

  it('shows NO value chip when unpriced — never a last-place rank', () => {
    const unpriced = row({ value: null })
    const { container } = render(<Dash3ATriage book={[unpriced]} now={NOW} valueBasis={BASIS} />)
    expect(container.querySelectorAll('.af-triage-value').length).toBe(0)
    const text = container.textContent ?? ''
    expect(text).not.toContain('#')
    expect(text).not.toContain('999')
  })

  it('states the price basis once, and only when a row is actually priced', () => {
    const priced = render(<Dash3ATriage book={[row()]} now={NOW} valueBasis={BASIS} />)
    const basis = priced.container.textContent ?? ''
    expect(basis).toContain('not adjusted for your scoring')
    expect(basis).toContain('NFL only')
    expect(priced.container.querySelectorAll('.af-triage-basis').length).toBe(1)

    const unpriced = render(
      <Dash3ATriage book={[row({ value: null })]} now={NOW} valueBasis={BASIS} />,
    )
    expect(unpriced.container.querySelectorAll('.af-triage-basis').length).toBe(0)
  })

  describe('replacement cover', () => {
    it('names bench cover you already own, inside the league it applies to', () => {
      const { container } = render(<Dash3ATriage book={[row()]} now={NOW} valueBasis={BASIS} />)
      expect(container.textContent).toContain('cover: Tyjae Spears')
    })

    it('offers no cover for a league where he is benched — nothing to decide there', () => {
      const benched = row({
        leagues: [
          {
            id: 'l2',
            name: 'Work League',
            platform: 'espn',
            imageUrl: null,
            slot: 'bench',
            bench: [{ name: 'Should Not Show', position: 'RB' }],
          },
        ],
      })
      const { container } = render(<Dash3ATriage book={[benched]} now={NOW} valueBasis={BASIS} />)
      expect(container.textContent).not.toContain('Should Not Show')
    })

    it('says nothing rather than something vague when the bench holds no cover', () => {
      const noCover = row({
        leagues: [
          { id: 'l1', name: 'Bla bla bla', platform: 'sleeper', imageUrl: null, slot: 'starter', bench: [] },
        ],
      })
      const { container } = render(<Dash3ATriage book={[noCover]} now={NOW} valueBasis={BASIS} />)
      expect(container.textContent).not.toContain('cover:')
    })

    it('sends you to free agents, not to a search for the injured player', () => {
      const { container } = render(<Dash3ATriage book={[row()]} now={NOW} valueBasis={BASIS} />)
      expect(container.textContent).toContain('Find a free agent')
    })
  })

  it('still renders nothing when no starter is in doubt', () => {
    const benched = row({ startingIn: 0, tone: 'bad' })
    const { container } = render(<Dash3ATriage book={[benched]} now={NOW} valueBasis={BASIS} />)
    expect(container.innerHTML).toBe('')
  })
})
