import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { summariseLineupCheck } from '@/lib/core-app/lineupCheck'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, LineupSlot, MyTeamData } from '@/lib/core-app/myTeam'

function player(id: string, over: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    sleeperId: id, name: `Player ${id}`, position: 'WR', team: 'DEN', sport: 'NFL', imageUrl: null,
    gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
    preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 10,
    afProjectedPoints: 10, afEngineProjectedPoints: 10, indoors: false, weather: null,
    market: null, onBye: false, ...over,
  }
}
const slot = (label: string, p: LineupPlayer | null, extra: Partial<LineupSlot> = {}): LineupSlot => ({
  slotLabel: label, player: p, empty: p == null, unresolvedId: null, benchCheck: null, ...extra,
})

/*
 * The KBFL roster on 2026-10-02: Jayden Daniels OUT at QB, Ben Sauls questionable at K, three
 * starters already past kickoff, and one bench comparison inside the 2-point margin.
 */
const KBFL: LineupSlot[] = [
  slot('QB', player('daniels', { name: 'Jayden Daniels', ruledOut: true, injuryStatus: 'Out' })),
  slot('K', player('sauls', { name: 'Ben Sauls', injuryStatus: 'Questionable' })),
  slot('FLEX', player('homer', { name: 'Travis Homer', gameDay: { state: 'final', points: 5.4 } })),
  slot('IDP', player('jackson', { name: "D'Marco Jackson" }), {
    benchCheck: { verdict: 'close', benchName: 'Joey Porter', benchProjected: 9.2, starterName: "D'Marco Jackson", starterProjected: 8.3 },
  }),
]

describe('summariseLineupCheck', () => {
  it('lists certain losses first, warnings last, and leaves "close" comparisons alone', () => {
    const { items, locked } = summariseLineupCheck(KBFL)
    expect(items.map((i) => `${i.kind}:${i.name}`)).toEqual(['out:Jayden Daniels', 'questionable:Ben Sauls'])
    expect(locked).toBe(1)
  })

  it('offers a bench swap only past the margin, with the gain', () => {
    const { items } = summariseLineupCheck([
      slot('WR', player('a', { name: 'Starter A' }), {
        benchCheck: { verdict: 'swap', benchName: 'Bench B', benchProjected: 14.5, starterName: 'Starter A', starterProjected: 11.2 },
      }),
    ])
    expect(items).toEqual([
      expect.objectContaining({ kind: 'swap', name: 'Starter A', replacement: { name: 'Bench B', projected: 14.5, gain: 3.3 } }),
    ])
  })

  it('folds a replacement into an OUT or bye line rather than listing the slot twice', () => {
    const { items } = summariseLineupCheck([
      slot('QB', player('q', { name: 'Hurt QB', ruledOut: true }), {
        benchCheck: { verdict: 'swap', benchName: 'Backup QB', benchProjected: 12, starterName: 'Hurt QB', starterProjected: 0 },
      }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'out', replacement: { name: 'Backup QB' } })
  })

  it('anchors an empty slot by index and never advises on a locked starter', () => {
    const { items, locked } = summariseLineupCheck([
      slot('FLEX', null),
      slot('RB', player('l', { ruledOut: true, gameDay: { state: 'started', points: null } })),
    ])
    expect(items).toEqual([expect.objectContaining({ kind: 'empty', anchor: 'lineup-slot-0' })])
    expect(locked).toBe(1)
  })
})

function data(starters: LineupSlot[], over: Partial<MyTeamData> = {}): MyTeamData {
  return {
    league: { id: 'l1', name: 'KBFL', platform: 'espn', format: 'dynasty', sourceLink: { href: 'https://example.test/lineup', label: 'ESPN' } },
    team: { available: false, reason: 'n/a' },
    starters: { available: true, data: starters },
    bench: { available: false, reason: 'none' },
    ir: { available: false, reason: 'none' },
    taxi: { available: false, reason: 'none' },
    lock: { available: false, reason: 'n/a' },
    projections: { available: false, reason: 'n/a' },
    projectionBasis: { notes: [], scoringKnown: false },
    nextMatchup: { available: false, reason: 'n/a' },
    upcomingByes: [],
    rosterGrade: { available: false, reason: 'n/a' },
    liveScore: { available: false, reason: 'n/a' },
    ...over,
  } as unknown as MyTeamData
}

describe('the Lineup check card', () => {
  it('links each problem to its row and offers the platform fix', () => {
    const { container } = render(<MyTeam data={data(KBFL)} />)
    const card = container.querySelector('.af-mt-check')!
    const links = [...card.querySelectorAll('a.af-mt-check-item')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#lineup-player-daniels', '#lineup-player-sauls'])
    expect(links[0].textContent).toContain('Jayden Daniels is ruled out — find a replacement')
    expect(card.textContent).toContain('1 starter has reached kickoff; confirm individual locks on your platform.')
    expect(card.querySelector('a.af-mt-check-fix')?.getAttribute('href')).toBe('https://example.test/lineup')
    // Every link target exists on the page.
    for (const a of links) expect(container.querySelector(a.getAttribute('href')!)).not.toBeNull()
  })

  it('says the lineup is clear when it is', () => {
    const { container } = render(<MyTeam data={data([slot('WR', player('ok'))])} />)
    const card = container.querySelector('.af-mt-check')!
    expect(card.getAttribute('data-clear')).toBe('true')
    expect(card.textContent).toContain('No issues were identified among the starters we could check')
    expect(card.querySelector('a.af-mt-check-fix')).toBeNull()
  })

  it('is absent in a Best Ball league, where the provider sets the lineup', () => {
    const { container } = render(<MyTeam data={data(KBFL, { bestBall: true })} />)
    expect(container.querySelector('.af-mt-check')).toBeNull()
  })
})

describe('lineup evidence gaps', () => {
  it('suppresses change advice at kickoff even when gameDay is absent or stale', () => {
    const now = Date.parse('2026-10-04T17:00:00Z')
    const kickedOff = player('past', { ruledOut: true, kickoff: new Date(now), gameDay: { state: 'upcoming', points: null } })
    expect(summariseLineupCheck([slot('WR', kickedOff)], now)).toMatchObject({ items: [], locked: 1 })
  })
  it('does not show an unresolved filled slot as a clear lineup', () => {
    const unresolved = slot('FLEX', null, { empty: false, unresolvedId: 'unknown' })
    expect(summariseLineupCheck([unresolved])).toMatchObject({ items: [], unresolved: 1 })
    const card = render(<MyTeam data={data([unresolved])} />).container.querySelector('.af-mt-check')!
    expect(card.getAttribute('data-clear')).toBe('false')
    expect(card.textContent).toContain('filled slot(s) could not be checked')
    expect(card.textContent).not.toContain('Nothing to change')
  })
  it('presents a projected swap as a candidate with provider rules unverified', () => {
    const starters = [slot('WR', player('one'), { benchCheck: { verdict: 'swap', benchName: 'Bench', benchProjected: 15, starterName: 'Starter', starterProjected: 10 } })]
    const card = render(<MyTeam data={data(starters)} />).container.querySelector('.af-mt-check')!
    expect(card.textContent).toContain('Compare Bench with Player one')
    expect(card.textContent).toContain('Confirm eligibility, locks, and AutoSubs')
    expect(card.textContent).not.toContain('Start Bench over')
  })
})
