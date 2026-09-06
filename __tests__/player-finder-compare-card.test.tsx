import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PlayerDetail } from '@/lib/core-app/playerFinder'
import type { LeagueImpact } from '@/lib/core-app/playerImpact'

/*
 * The compare card: two heads, a verdict, the side-by-side tiles, and one
 * league table with a column per player. Pins the strings a reader acts on —
 * the verdict, the lineup note, who holds the other one — and the two links
 * that leave the card (Swap, Clear).
 */

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))

import { PlayerCompare } from '@/components/core-app/player-finder/PlayerCompare'

function impact(over: Partial<LeagueImpact> & Pick<LeagueImpact, 'leagueId' | 'leagueName' | 'platform' | 'slot'>, points: number | null): LeagueImpact {
  return {
    platformLeagueId: null,
    season: 2026,
    exactSlot: null,
    slotConfirmed: true,
    isStarting: over.slot === 'STARTER',
    afPoints: points != null ? { available: true, data: { points, matchedKeys: 4, scoredKeys: 20 } } : { available: false, reason: 'unpriced in fixture' },
    replacements: { available: false, reason: 'none in fixture' },
    startOver: null,
    ...over,
  }
}

const BASE: Omit<PlayerDetail, 'player' | 'leagues' | 'impact'> = {
  identityResolved: true,
  bio: { height: null, weight: null, age: 27, college: null },
  injury: { available: true, data: { status: 'Active', description: null, reportedAt: null } },
  seasonStats: { available: false, reason: 'none' },
  projection: { available: true, data: { points: 13.8, season: '2026', week: 12 } },
  snapShare: { available: true, data: { share: 0.78, snaps: 400, teamSnaps: 513, games: 8, basis: 'offense' } },
  positionRank: { available: true, data: { rank: 6, outOf: 118, position: 'TE' } },
  recommendedMoves: { available: false, reason: 'none' },
  freshness: { label: '12m ago', stale: false },
  rosterCoverage: { unmatched: [] },
}

const KINCAID: PlayerDetail = {
  ...BASE,
  player: { externalId: 'ri-1', sport: 'NFL', sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', team: 'Buffalo Bills', imageUrl: null, number: 86, rosteredIn: 2, platforms: ['yahoo', 'sleeper'] },
  leagues: {
    available: true,
    data: [
      { leagueId: 'L-warriors', leagueName: 'Waiver Warriors', platform: 'yahoo', format: 'Standard', platformLeagueId: '55', season: 2026, slot: 'STARTER', isYours: true, owner: null },
      { leagueId: 'L-dragons', leagueName: 'Dynasty Dragons', platform: 'sleeper', format: 'Dynasty PPR', platformLeagueId: '123456', season: 2026, slot: 'BENCH', isYours: true, owner: null },
    ],
  },
  impact: {
    available: true,
    data: [
      impact({ leagueId: 'L-warriors', leagueName: 'Waiver Warriors', platform: 'yahoo', slot: 'STARTER' }, 11.1),
      impact({ leagueId: 'L-dragons', leagueName: 'Dynasty Dragons', platform: 'sleeper', slot: 'BENCH' }, 15.4),
    ],
  },
}

const FERGUSON: PlayerDetail = {
  ...BASE,
  bio: { height: null, weight: null, age: 26, college: null },
  injury: { available: true, data: { status: 'Questionable', description: 'Knee', reportedAt: null } },
  projection: { available: true, data: { points: 11.2, season: '2026', week: 12 } },
  snapShare: { available: false, reason: 'no snap counts on file' },
  positionRank: { available: true, data: { rank: 9, outOf: 118, position: 'TE' } },
  player: { externalId: 'ri-2', sport: 'NFL', sleeperId: '8130', name: 'Jake Ferguson', position: 'TE', team: 'Dallas Cowboys', imageUrl: null, number: 87, rosteredIn: 2, platforms: ['sleeper', 'espn'] },
  leagues: {
    available: true,
    data: [
      { leagueId: 'L-dragons', leagueName: 'Dynasty Dragons', platform: 'sleeper', format: 'Dynasty PPR', platformLeagueId: '123456', season: 2026, slot: 'STARTER', isYours: true, owner: null },
      {
        leagueId: 'L-gang',
        leagueName: 'Gridiron Gang',
        platform: 'espn',
        format: '0.5 PPR',
        platformLeagueId: '888',
        season: 2026,
        slot: 'NOT YOURS',
        isYours: false,
        owner: { teamName: "Tasha's Titans", ownerName: 'tashaR', avatarUrl: null, externalId: '1' },
      },
    ],
  },
  impact: { available: true, data: [impact({ leagueId: 'L-dragons', leagueName: 'Dynasty Dragons', platform: 'sleeper', slot: 'STARTER' }, 13.0)] },
}

function renderCard(extra: Partial<React.ComponentProps<typeof PlayerCompare>> = {}) {
  return render(
    <PlayerCompare
      a={KINCAID}
      b={FERGUSON}
      query="Dalton Kincaid"
      selectedLeagueId={null}
      signedIn
      swapHref="/core/players?q=Jake%20Ferguson&player=NFL%3Ari-2&vs=NFL%3Ari-1"
      clearHref="/core/players?q=Dalton%20Kincaid&player=NFL%3Ari-1"
      {...extra}
    />,
  )
}

describe('PlayerCompare', () => {
  it('heads the card with both players — the first as the page’s h2, the second as an h3 — and the verdict', () => {
    renderCard()
    expect(screen.getByRole('heading', { level: 2, name: 'Dalton Kincaid' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Jake Ferguson' })).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Questionable')).toBeInTheDocument()
    expect(screen.getByText('Kincaid beats Ferguson in the one priced league — biggest gap in Dynasty Dragons (+2.4 for Kincaid).')).toBeInTheDocument()
  })

  it('puts the same tiles side by side, marking the leader, and says when one side has no figure', () => {
    renderCard()
    const tiles = screen.getByRole('table', { name: 'Side by side' })
    const proj = within(tiles).getByText('Proj wk 12').closest('[role="row"]') as HTMLElement
    const cells = within(proj).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('13.8')
    expect(cells[0]).toHaveAttribute('data-lead', 'true')
    expect(cells[1]).toHaveTextContent('11.2')
    expect(cells[1]).not.toHaveAttribute('data-lead')
    const snap = within(tiles).getByText('Snap share').closest('[role="row"]') as HTMLElement
    expect(within(snap).getAllByRole('cell')[1]).toHaveTextContent('—')
    // A rank reads the other way: TE6 leads TE9.
    const rank = within(tiles).getByText('Pos rank').closest('[role="row"]') as HTMLElement
    expect(within(rank).getAllByRole('cell')[0]).toHaveTextContent('TE6')
    expect(within(rank).getAllByRole('cell')[0]).toHaveAttribute('data-lead', 'true')
    expect(within(rank).getAllByRole('cell')[1]).not.toHaveAttribute('data-lead')
    // Age is context, not a contest.
    const age = within(tiles).getByText('Age').closest('[role="row"]') as HTMLElement
    expect(within(age).getAllByRole('cell')[0]).not.toHaveAttribute('data-lead')
  })

  it('walks every league of either player with a column each, the gap, and the note', () => {
    renderCard()
    const table = screen.getByRole('table', { name: 'Across your leagues' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getByText(/Warriors|Dragons|Gang/).textContent)).toEqual(['Waiver Warriors', 'Dynasty Dragons', 'Gridiron Gang'])

    const dragons = rows[1]
    expect(within(dragons).getByText('Start Kincaid over Ferguson')).toBeInTheDocument()
    expect(within(dragons).getByText('+2.4', { selector: 'td' })).toHaveAttribute('data-tone', 'good')
    expect(within(dragons).getByText('15.4')).toBeInTheDocument()
    expect(within(dragons).getByText('13.0')).toBeInTheDocument()

    const warriors = rows[0]
    expect(within(warriors).getByText('not on a roster we read')).toBeInTheDocument()
    expect(within(warriors).getByText('—')).toBeInTheDocument()

    // Neither is yours in Gridiron Gang: the owner sits in the cell, and no note repeats it.
    const gang = rows[2]
    expect(within(gang).getByText('@tashaR')).toBeInTheDocument()
    expect(within(gang).getByText('not on a roster we read')).toBeInTheDocument()
    expect(within(gang).queryByText(/is @tashaR’s here/)).toBeNull()
  })

  it('notes who holds the other one in a league where the first is yours', () => {
    renderCard({
      a: {
        ...KINCAID,
        leagues: {
          available: true,
          data: [...(KINCAID.leagues.available ? KINCAID.leagues.data : []), { leagueId: 'L-gang', leagueName: 'Gridiron Gang', platform: 'espn', format: '0.5 PPR', platformLeagueId: '888', season: 2026, slot: 'STARTER', isYours: true, owner: null }],
        },
      },
    })
    const gang = screen.getAllByRole('row').find((r) => within(r).queryByText('Gridiron Gang'))!
    expect(within(gang).getByText('Ferguson is @tashaR’s here')).toBeInTheDocument()
  })

  it('links Swap and Clear where the screen told it to, and offers a third name against the first', () => {
    renderCard()
    expect(screen.getByRole('link', { name: 'Swap' })).toHaveAttribute('href', '/core/players?q=Jake%20Ferguson&player=NFL%3Ari-2&vs=NFL%3Ari-1')
    expect(screen.getByRole('link', { name: 'Clear' })).toHaveAttribute('href', '/core/players?q=Dalton%20Kincaid&player=NFL%3Ari-1')
    expect(screen.getByText('Compare Kincaid with someone else')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Compare with another player' })).toHaveValue('')
  })

  it('says a league could not be read rather than showing an empty cell', () => {
    renderCard({
      a: { ...KINCAID, rosterCoverage: { unmatched: [{ leagueId: 'L-gang', leagueName: 'Gridiron Gang', platform: 'espn' }] } },
    })
    const gang = screen.getAllByRole('row').find((r) => within(r).queryByText('Gridiron Gang'))!
    expect(within(gang).getByText('unchecked')).toBeInTheDocument()
  })

  it('gates the league table behind sign-in and keeps the tiles', () => {
    renderCard({ signedIn: false })
    expect(screen.getByText('Sign in to see the two of them across your leagues.')).toBeInTheDocument()
    expect(screen.queryByText('Dynasty Dragons')).toBeNull()
    expect(screen.getByRole('table', { name: 'Side by side' })).toBeInTheDocument()
  })
})
