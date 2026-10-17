import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FOLD_AFTER, LeagueStrip } from '@/components/core-app/player-finder/LeagueStrip'
import { buildLeagueStrip } from '@/lib/core-app/leagueStrip'
import type { LeagueSlot } from '@/lib/core-app/playerFinder'

/*
 * The league strip: one chip per league under the player's name. The three states that are easy to
 * confuse stay apart — FREE (read, nobody has him), OTHER (someone does), UNKNOWN (we could not read
 * the league) — and a ruled-out starter is red.
 */

const slot = (leagueId: string, s: string, isYours: boolean, over: Partial<LeagueSlot> = {}): LeagueSlot => ({
  leagueId,
  leagueName: leagueId,
  platform: 'sleeper',
  format: null,
  platformLeagueId: null,
  season: 2026,
  teamExternalId: null,
  slot: s,
  isYours,
  owner: isYours ? null : { teamName: 'Titans', ownerName: 'tasha', avatarUrl: null, externalId: '2' },
  ...over,
})

const LEAGUES = [
  { id: 'A', name: 'Alpha' },
  { id: 'B', name: 'Bravo' },
  { id: 'C', name: 'Charlie' },
  { id: 'D', name: 'Delta' },
  { id: 'E', name: 'Echo' },
  { id: 'F', name: 'Foxtrot' },
]
const SLOTS = [slot('A', 'BENCH', true), slot('B', 'STARTER', true), slot('C', 'NOT YOURS', false), slot('D', 'IR SLOT', true)]
const base = { leagues: LEAGUES, scope: null, slots: SLOTS, unmatched: [{ leagueId: 'F' }], playerName: 'Tank Dell', readinessTone: null }

describe('buildLeagueStrip', () => {
  it('one chip per league, ordered by what needs you: start, bench, IR, free, someone else’s, unreadable', () => {
    const chips = buildLeagueStrip(base)
    expect(chips.map((c) => [c.leagueName, c.state, c.badge])).toEqual([
      ['Bravo', 'start', 'START'],
      ['Alpha', 'bench', 'BENCH'],
      ['Delta', 'ir', 'IR'],
      ['Echo', 'free', 'FA'],
      ['Charlie', 'other', 'Titans'],
      ['Foxtrot', 'unknown', '?'],
    ])
  })

  it('🛑 a league we cannot read is "?", never "FA" — unseen is not available', () => {
    const f = buildLeagueStrip(base).find((c) => c.leagueId === 'F')!
    expect(f.state).toBe('unknown')
    expect(f.sentence).toMatch(/can't read/)
  })

  it('a ruled-out starter is red; the same player on your bench is not', () => {
    const chips = buildLeagueStrip({ ...base, readinessTone: 'bad' })
    expect(chips.find((c) => c.leagueId === 'B')!.tone).toBe('bad')
    expect(chips.find((c) => c.leagueId === 'A')!.tone).toBe('none')
  })

  it('a best-ball starter is not flagged — the platform sets that lineup', () => {
    const chips = buildLeagueStrip({ ...base, slots: [slot('B', 'STARTER', true, { bestBall: true })], readinessTone: 'bad' })
    expect(chips.find((c) => c.leagueId === 'B')!.tone).toBe('good')
  })

  it('honours the saved league pick', () => {
    const chips = buildLeagueStrip({ ...base, scope: ['A', 'E'] })
    expect(chips.map((c) => c.leagueId)).toEqual(['A', 'E'])
  })
})

describe('LeagueStrip', () => {
  it('each chip links to the card scoped to its league, with the whole sentence for screen readers', () => {
    render(<LeagueStrip chips={buildLeagueStrip(base)} leagueHref={(id) => `/core/players?player=NFL%3A1&league=${id}`} />)
    const bravo = screen.getByRole('link', { name: 'Bravo: Dell is starting.' })
    expect(bravo).toHaveAttribute('href', '/core/players?player=NFL%3A1&league=B')
    expect(screen.getByText('Yours in 3 · available in 1 · elsewhere in 1 · can\'t read 1')).toBeInTheDocument()
  })

  it('renders nothing with no leagues', () => {
    const { container } = render(<LeagueStrip chips={[]} leagueHref={() => '#'} />)
    expect(container.innerHTML).toBe('')
  })

  /*
   * Guap, 2026-10-08: a 65-league manager got 65 chips, 4 of them his. Yours always show; past
   * FOLD_AFTER everything else folds behind one toggle per group.
   */
  describe('folds the leagues that are not yours', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `L${i}`, name: `League ${i}` }))
    const manySlots = [
      slot('L0', 'STARTER', true, { leagueName: 'League 0' }),
      slot('L1', 'BENCH', true, { leagueName: 'League 1' }),
      ...Array.from({ length: 14 }, (_, i) => slot(`L${i + 2}`, 'NOT YOURS', false, { leagueName: `League ${i + 2}` })),
    ]
    const chips = () => buildLeagueStrip({ ...base, leagues: many, slots: manySlots, unmatched: [{ leagueId: 'L19' }] })

    it('shows only your chips until a group is opened', () => {
      render(<LeagueStrip chips={chips()} leagueHref={(id) => `#${id}`} />)
      expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#L0', '#L1'])
      expect(screen.getByRole('button', { name: /Available in 3/ })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByRole('button', { name: /Can't read 1/ })).toBeInTheDocument()
      // The tally still counts every league — folding hides chips, not facts.
      expect(screen.getByText(/Yours in 2 · available in 3 · elsewhere in 14/)).toBeInTheDocument()
    })

    it('opening "Taken" lists the other managers’ leagues; tapping again folds them', () => {
      render(<LeagueStrip chips={chips()} leagueHref={(id) => `#${id}`} />)
      const taken = screen.getByRole('button', { name: /Taken in 14/ })
      fireEvent.click(taken)
      expect(taken).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getAllByRole('link')).toHaveLength(2 + 14)
      fireEvent.click(taken)
      expect(screen.getAllByRole('link')).toHaveLength(2)
    })

    it('says so when none are yours, rather than showing an empty row', () => {
      const none = buildLeagueStrip({ ...base, leagues: many, slots: manySlots.slice(2), unmatched: [] })
      render(<LeagueStrip chips={none} leagueHref={(id) => `#${id}`} />)
      expect(screen.getByText('Not on any of your rosters.')).toBeInTheDocument()
      expect(screen.queryAllByRole('link')).toHaveLength(0)
    })

    it(`does not fold at or under ${FOLD_AFTER} — a small account sees every chip`, () => {
      render(<LeagueStrip chips={buildLeagueStrip(base)} leagueHref={(id) => `#${id}`} />)
      expect(screen.queryByRole('button', { name: /Taken in/ })).toBeNull()
      expect(screen.getAllByRole('link')).toHaveLength(6)
    })
  })
})
