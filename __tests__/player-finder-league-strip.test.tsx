import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LeagueStrip } from '@/components/core-app/player-finder/LeagueStrip'
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
})
