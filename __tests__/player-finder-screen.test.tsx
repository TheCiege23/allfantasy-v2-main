import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PlayerDetail, RecommendedMove } from '@/lib/core-app/playerFinder'
import type { LeagueImpact } from '@/lib/core-app/playerImpact'
import type { PlayerLeagueView } from '@/lib/core-app/playerLeagueView'

/*
 * The Player Finder's signed-in states, rendered from a fixture.
 *
 * The dev server can show the public page without a session; it cannot show
 * the cross-league table, the league-in-context card, the move cards or the
 * verdict, because every one of them is gated on a user. This renders the
 * handoff's worked example — Dalton Kincaid across three leagues you play and
 * one where @tashaR has him — and pins the strings a reader acts on: who owns
 * him, where to fix it, and what the fixes are worth.
 */

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))

import PlayerFinder from '@/components/core-app/screens/PlayerFinder'

function impact(
  over: Partial<LeagueImpact> & Pick<LeagueImpact, 'leagueId' | 'leagueName' | 'platform' | 'slot'>,
): LeagueImpact {
  return {
    platformLeagueId: null,
    season: 2026,
    exactSlot: null,
    slotConfirmed: true,
    isStarting: over.slot === 'STARTER',
    afPoints: { available: false, reason: 'unpriced in fixture' },
    replacements: { available: false, reason: 'none in fixture' },
    startOver: null,
    ...over,
  }
}

const IMPACT: LeagueImpact[] = [
  impact({
    leagueId: 'L-warriors',
    leagueName: 'Waiver Warriors',
    platform: 'yahoo',
    platformLeagueId: '55',
    slot: 'STARTER',
    exactSlot: 'TE',
    afPoints: { available: true, data: { points: 11.1, matchedKeys: 4, scoredKeys: 20 } },
  }),
  impact({
    leagueId: 'L-dragons',
    leagueName: 'Dynasty Dragons',
    platform: 'sleeper',
    platformLeagueId: '123456',
    slot: 'BENCH',
    afPoints: { available: true, data: { points: 15.4, matchedKeys: 4, scoredKeys: 30 } },
    startOver: { playerId: 'fergie', name: 'Jake Ferguson', position: 'TE', slot: 'FLEX', afPoints: 13.0, delta: 2.4 },
    replacements: {
      available: true,
      data: [{ playerId: 'fergie', name: 'Jake Ferguson', position: 'TE', team: 'DAL', afPoints: 13.0, delta: -2.4, injuryStatus: null, from: 'STARTER' }],
    },
  }),
  impact({
    leagueId: 'L-elites',
    leagueName: 'End Zone Elites',
    platform: 'espn',
    platformLeagueId: '777',
    slot: 'IR SLOT',
    afPoints: { available: true, data: { points: 10.6, matchedKeys: 4, scoredKeys: 28 } },
  }),
]

const CLAIM: RecommendedMove = {
  leagueId: 'L-warriors',
  leagueName: 'Waiver Warriors',
  platform: 'yahoo',
  projectionWeek: 12,
  affectedProjection: 9.4,
  freeAgents: [{ playerId: '9', name: 'Isaiah Likely', position: 'TE', projectedPoints: 12.3, delta: 2.9 }],
  claimTarget: { kind: 'none' },
}

const DETAIL: PlayerDetail = {
  player: {
    externalId: 'ri-1',
    sport: 'NFL',
    sleeperId: '10236',
    name: 'Dalton Kincaid',
    position: 'TE',
    team: 'Buffalo Bills',
    imageUrl: null,
    number: 86,
    rosteredIn: 3,
    platforms: ['yahoo', 'sleeper', 'espn'],
  },
  identityResolved: true,
  bio: { height: null, weight: null, age: 27, college: 'Utah' },
  injury: { available: true, data: { status: 'Active', description: 'Ankle', reportedAt: null } },
  seasonStats: { available: false, reason: 'none in fixture' },
  leagues: {
    available: true,
    data: [
      { leagueId: 'L-warriors', leagueName: 'Waiver Warriors', platform: 'yahoo', format: 'Standard', platformLeagueId: '55', season: 2026, slot: 'STARTER', isYours: true, owner: null },
      { leagueId: 'L-dragons', leagueName: 'Dynasty Dragons', platform: 'sleeper', format: 'Dynasty PPR', platformLeagueId: '123456', season: 2026, slot: 'BENCH', isYours: true, owner: null },
      { leagueId: 'L-elites', leagueName: 'End Zone Elites', platform: 'espn', format: 'Keeper', platformLeagueId: '777', season: 2026, slot: 'IR SLOT', isYours: true, owner: null },
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
  projection: { available: true, data: { points: 13.8, season: '2026', week: 12 } },
  snapShare: { available: true, data: { share: 0.78, snaps: 400, teamSnaps: 513, games: 8, basis: 'offense' } },
  positionRank: { available: true, data: { rank: 6, outOf: 118, position: 'TE' } },
  impact: { available: true, data: IMPACT },
  recommendedMoves: { available: true, data: [CLAIM] },
  freshness: { label: '12m ago', stale: false },
  rosterCoverage: { unmatched: [] },
}

const LEAGUE_VIEW: PlayerLeagueView = {
  leagueId: 'L-gang',
  leagueName: 'Gridiron Gang',
  platform: 'espn',
  platformLeagueId: '888',
  season: 2026,
  format: '0.5 PPR',
  ownership: {
    kind: 'other',
    slot: 'STARTER',
    owner: { teamName: "Tasha's Titans", ownerName: 'tashaR', avatarUrl: null, externalId: '1', record: '4-2', isCommissioner: false },
  },
  afPoints: { available: true, data: { points: 9.8, matchedKeys: 3, scoredKeys: 12, week: 12, season: '2026' } },
  positionRank: { available: true, data: { rank: 4, outOf: 61, position: 'TE' } },
  yourTeam: { teamName: 'Cafe Con Chimmy', externalId: '2' },
  rosterCount: 12,
  coverage: { sampled: 12, matched: 12, fraction: 1, usable: true },
}

function renderCore(extra: Partial<React.ComponentProps<typeof PlayerFinder>> = {}) {
  return render(
    <PlayerFinder query="Dalton Kincaid" matches={[DETAIL.player]} detail={DETAIL} leagueCount={6} {...extra} />,
  )
}

describe('Player Finder — core view', () => {
  it('keeps the SEO heading order: h1 Player Finder, h2 the player', () => {
    renderCore()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Player Finder')
    expect(screen.getByRole('heading', { level: 2, name: 'Dalton Kincaid' })).toBeInTheDocument()
  })

  it('lists recent searches in the rail, linking each back into the finder', () => {
    renderCore({
      recent: [
        { sport: 'NFL', externalId: 'ri-9', sleeperId: '9', name: 'Isaiah Likely', position: 'TE', team: 'BAL', searchedAt: new Date() },
      ],
    })
    const region = screen.getByRole('region', { name: 'Recently searched' })
    const link = within(region).getByRole('link', { name: /Isaiah Likely/ })
    expect(link.getAttribute('href')).toBe('/core/players?q=Isaiah%20Likely&player=NFL%3Ari-9')
  })

  it('names the leagues whose rosters could not be read instead of dropping them', () => {
    renderCore({
      detail: { ...DETAIL, rosterCoverage: { unmatched: [{ leagueId: 'L-espn2', leagueName: 'Office Pool', platform: 'espn' }] } },
    })
    expect(screen.getByText(/Not checked: Office Pool/)).toBeInTheDocument()
    expect(screen.getByText(/ESPN player ids/)).toBeInTheDocument()
  })

  it('says where he is across your leagues, and that someone else has him elsewhere', () => {
    renderCore()
    expect(screen.getByText(/on 3 of your 6 leagues, across Yahoo, Sleeper and ESPN/)).toBeInTheDocument()
    expect(screen.getByText(/rostered by others in 1/)).toBeInTheDocument()
    expect(screen.getByText('Ready · Ankle')).toBeInTheDocument()
  })

  it('renders every league as a row, with the manager who has him named', () => {
    renderCore()
    const rows = screen.getAllByRole('row').slice(1) // drop the header row
    expect(rows).toHaveLength(4)

    const gang = rows.find((r) => within(r).queryByText('Gridiron Gang'))!
    expect(gang).toHaveAttribute('data-tone', 'other')
    expect(within(gang).getByText('rostered by @tashaR')).toBeInTheDocument()
    expect(within(gang).getByRole('link', { name: /Trade for Kincaid/ })).toHaveAttribute('href', '/core/trades?league=L-gang')
  })

  it('a benched player who beats a starter is a red row that links to the platform lineup', () => {
    renderCore()
    const rows = screen.getAllByRole('row').slice(1)
    const dragons = rows.find((r) => within(r).queryByText('Dynasty Dragons'))!
    expect(dragons).toHaveAttribute('data-tone', 'bad')
    expect(within(dragons).getByRole('link', { name: /Where to fix it/ })).toHaveAttribute(
      'href',
      'https://sleeper.com/leagues/123456/team',
    )
    expect(within(dragons).getByText('15.4')).toBeInTheDocument()
  })

  it('a starter is "nothing to do", and the rows are ordered by what needs you', () => {
    renderCore()
    const rows = screen.getAllByRole('row').slice(1)
    const names = rows.map((r) => within(r).getByRole('link', { name: /Warriors|Dragons|Elites|Gang/ }).textContent)
    expect(names).toEqual(['Dynasty Dragons', 'End Zone Elites', 'Waiver Warriors', 'Gridiron Gang'])
    expect(within(rows[2]).getByText('Nothing to do')).toBeInTheDocument()
  })

  it('composes the three move cards in order and prices the verdict from the league-scored two', () => {
    renderCore()
    const moves = screen.getByRole('region', { name: 'Recommended moves' })
    const titles = within(moves).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(titles).toEqual([
      'Swap Ferguson out for Kincaid at FLEX',
      "Move Kincaid off IR — he's active",
      'Claim Isaiah Likely over Kincaid',
    ])
    expect(within(moves).getByRole('link', { name: 'Open in Sleeper' })).toHaveAttribute('target', '_blank')

    const verdict = screen.getByRole('region', { name: 'Chimmy verdict' })
    expect(verdict).toHaveTextContent('He is misplaced in 2 of 3 leagues. 2 fixes for +13.0.')
    // The phone's buttons are in the DOM (CSS shows them only below 720px), one per platform screen.
    const opens = within(verdict).getAllByRole('link', { name: /^Open in / })
    expect(opens.map((a) => a.textContent)).toEqual(['Open in Sleeper', 'Open in ESPN'])
  })
})

describe('Player Finder — league in context', () => {
  it('leads with who has him in the held league and offers the trade', () => {
    renderCore({ selectedLeagueId: 'L-gang', leagueView: LEAGUE_VIEW })
    // The heading that names the card also carries the platform chip and the format.
    const card = screen.getByRole('region', { name: /Gridiron Gang/ })
    expect(card).toHaveAttribute('data-kind', 'other')
    expect(within(card).getByText("Tasha's Titans")).toBeInTheDocument()
    expect(within(card).getByText('@tashaR · 4-2')).toBeInTheDocument()
    expect(within(card).getByText('THEY START HIM')).toBeInTheDocument()
    expect(within(card).getByText('9.8')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /Trade for Kincaid/ })).toHaveAttribute('href', '/core/trades?league=L-gang')
    // ESPN has no trade URL; a trade is proposed from the other manager's team page (team 1 = Tasha).
    expect(within(card).getByRole('link', { name: 'Open in ESPN' })).toHaveAttribute(
      'href',
      'https://fantasy.espn.com/football/team?leagueId=888&teamId=1&seasonId=2026',
    )
  })

  /*
   * Guap, 2026-09-02: a held league FILTERS. The other three leagues are not
   * on the screen at all, and "All leagues →" is the way back to them.
   */
  it('filters the table to the held league and offers the way out', () => {
    renderCore({ selectedLeagueId: 'L-gang', leagueView: LEAGUE_VIEW })
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveAttribute('data-held', 'true')
    expect(within(rows[0]).getByText('Gridiron Gang')).toBeInTheDocument()
    expect(screen.queryByText('Dynasty Dragons')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'In this league' })).toBeInTheDocument()
    const outs = screen.getAllByRole('link', { name: 'All leagues →' })
    expect(outs.length).toBeGreaterThan(0)
    expect(outs[0].getAttribute('href')).toBe('/core/players?q=Dalton%20Kincaid&player=NFL%3Ari-1')
    expect(outs[0].getAttribute('href')).not.toContain('league=')
  })

  it('in league mode the header carries the league’s own projection and rank', () => {
    renderCore({ selectedLeagueId: 'L-gang', leagueView: LEAGUE_VIEW })
    // 9.8 under Gridiron Gang's scoring replaces the feed's 13.8; TE4 of 61 replaces TE6 of 118.
    expect(screen.getAllByText('9.8').length).toBeGreaterThan(0)
    expect(screen.queryByText('13.8')).not.toBeInTheDocument()
    expect(screen.getByText('TE4')).toBeInTheDocument()
    expect(screen.getByText(/of 61 priced TEs/)).toBeInTheDocument()
  })

  it('in league mode the verdict names the one move instead of counting leagues', () => {
    renderCore({ selectedLeagueId: 'L-dragons', leagueView: null })
    expect(screen.getByText("Swap Ferguson out for Kincaid at FLEX — +2.4 under this league's scoring.")).toBeInTheDocument()
    expect(screen.getByText('Verdict · this league')).toBeInTheDocument()
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1)
  })

  it('keeps the held league in the search form and in every match link', () => {
    const { container } = renderCore({ selectedLeagueId: 'L-gang', leagueView: LEAGUE_VIEW })
    expect(container.querySelector('input[name="league"]')).toHaveAttribute('value', 'L-gang')
    const match = screen.getByRole('link', { name: /Dalton Kincaid.*TE · Buffalo Bills/ })
    expect(match.getAttribute('href')).toContain('&league=L-gang')
  })

  it('states a free agent and an unread league differently', () => {
    renderCore({
      selectedLeagueId: 'L-gang',
      leagueView: { ...LEAGUE_VIEW, ownership: { kind: 'free-agent' } },
    })
    expect(screen.getByText('Unrostered in this league')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Claim Kincaid/ })).toBeInTheDocument()
  })
})

/*
 * The trade window (2026-09-05): who to pitch and when they move. It lives in
 * the decision column, which now renders for it even when there is no
 * per-league impact to grade — a NOT YOURS league has nothing to fix, and
 * everything to pitch.
 */
describe('Player Finder — trade window', () => {
  const PRESENCE: NonNullable<React.ComponentProps<typeof PlayerFinder>['presence']> = {
    available: true,
    data: {
      leagueId: 'L-gang',
      leagueName: 'Gridiron Gang',
      platform: 'espn',
      platformLeagueId: '888',
      season: 2026,
      timeZone: 'America/New_York',
      zone: 'ET',
      player: { sleeperId: '10236', position: 'TE' },
      holder: 'other',
      managers: [
        {
          role: 'owner',
          teamName: "Tasha's Titans",
          ownerName: 'tashaR',
          avatarUrl: null,
          externalId: '1',
          record: '4-2',
          rank: 3,
          need: null,
          startsHim: true,
          window: { weekday: 0, startHour: 10, endHour: 12, daypart: 'morning', precision: 'window', share: 0.8, sample: 12, zone: 'ET' },
          lastMove: { at: '2026-10-20T18:00:00.000Z', kind: 'trade' },
          moves: 13,
        },
      ],
      activityIngested: true,
      newestMove: '2026-10-20T18:00:00.000Z',
      unattributed: 0,
    },
  }

  it('opens the decision column for the window alone in a league where he is not yours', () => {
    renderCore({ selectedLeagueId: 'L-gang', leagueView: LEAGUE_VIEW, presence: PRESENCE, nowIso: '2026-10-24T14:30:00.000Z' })
    const side = screen.getByRole('complementary', { name: 'What to do' })
    expect(within(side).getByRole('region', { name: 'Trade window · when they move' })).toBeInTheDocument()
    expect(within(side).getByText('@tashaR usually moves Sun 10a–12p ET')).toBeInTheDocument()
    expect(within(side).getByText(/They start Kincaid in Gridiron Gang\. Ask what it takes\. Pitch Sun 10a–12p, not now\./)).toBeInTheDocument()
    // No trade visual on the screen, so Grade it opens the Trade Center for the league.
    expect(within(side).getByRole('link', { name: 'Grade it' })).toHaveAttribute('href', '/core/trades?league=L-gang')
  })

  it('keeps the column out when there is neither impact nor a window', () => {
    renderCore({ selectedLeagueId: 'L-gang', leagueView: LEAGUE_VIEW })
    expect(screen.queryByRole('complementary', { name: 'What to do' })).not.toBeInTheDocument()
  })
})

describe('Player Finder — compare', () => {
  const FERGUSON: PlayerDetail = {
    ...DETAIL,
    player: { ...DETAIL.player, externalId: 'ri-2', sleeperId: '8130', name: 'Jake Ferguson', team: 'Dallas Cowboys', number: 87, rosteredIn: 1, platforms: ['sleeper'] },
    injury: { available: true, data: { status: 'Questionable', description: 'Knee', reportedAt: null } },
    projection: { available: true, data: { points: 11.2, season: '2026', week: 12 } },
    leagues: {
      available: true,
      data: [{ leagueId: 'L-dragons', leagueName: 'Dynasty Dragons', platform: 'sleeper', format: 'Dynasty PPR', platformLeagueId: '123456', season: 2026, slot: 'STARTER', isYours: true, owner: null }],
    },
    impact: { available: true, data: [impact({ leagueId: 'L-dragons', leagueName: 'Dynasty Dragons', platform: 'sleeper', slot: 'STARTER', afPoints: { available: true, data: { points: 13.0, matchedKeys: 4, scoredKeys: 30 } } })] },
    recommendedMoves: { available: false, reason: 'none in fixture' },
  }

  it('offers a compare box under the open player, and every other match row as the second name', () => {
    renderCore({ matches: [DETAIL.player, FERGUSON.player], selectedLeagueId: 'L-gang' })
    expect(screen.getByRole('combobox', { name: 'Compare with another player' })).toHaveValue('')
    // Once on the desktop match row, once on the phone's "also matched" chip; the same target either way.
    const vs = screen.getAllByRole('link', { name: 'Compare with Jake Ferguson' })
    expect(vs).toHaveLength(2)
    for (const a of vs) expect(a).toHaveAttribute('href', '/core/players?q=Dalton%20Kincaid&player=NFL%3Ari-1&vs=NFL%3Ari-2&league=L-gang')
    // The open player is not offered against himself.
    expect(screen.queryByRole('link', { name: 'Compare with Dalton Kincaid' })).toBeNull()
    // The single card is still the one on screen.
    expect(screen.queryByRole('heading', { level: 3, name: 'Jake Ferguson' })).toBeNull()
  })

  it('puts the two side by side in place of the single card when a second player is held, with Swap and Clear', () => {
    renderCore({ compare: FERGUSON, selectedLeagueId: 'L-gang' })
    expect(screen.getByRole('heading', { level: 2, name: 'Dalton Kincaid' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Jake Ferguson' })).toBeInTheDocument()
    expect(screen.getByText(/Kincaid beats Ferguson in the one priced league/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Swap' })).toHaveAttribute('href', '/core/players?q=Jake%20Ferguson&player=NFL%3Ari-2&vs=NFL%3Ari-1&league=L-gang')
    expect(screen.getByRole('link', { name: 'Clear' })).toHaveAttribute('href', '/core/players?q=Dalton%20Kincaid&player=NFL%3Ari-1&league=L-gang')
    // The single card's own sections are gone; the compare table has a column per player.
    expect(screen.queryByText(/on 3 of your 6 leagues/)).toBeNull()
    const table = screen.getByRole('table', { name: 'Across your leagues' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['League', 'Kincaid', 'Ferguson', 'Gap'])
  })
})

describe('Player Finder — signed out', () => {
  it('gates the league sections behind a sign-in reason and renders no verdict', () => {
    render(<PlayerFinder query="" matches={[]} detail={DETAIL} leagueCount={0} signedIn={false} />)
    expect(screen.getAllByText(/Sign in to see which of your leagues roster him/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('table')).toBeNull()
  })
})
