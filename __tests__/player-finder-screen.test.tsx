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
    startOver: { playerId: 'fergie', name: 'Jake Ferguson', position: 'TE', team: 'DAL', slot: 'FLEX', afPoints: 13.0, delta: 2.4 },
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
  // Sunday 2026-10-25, 1:00pm ET — the lock every "yours" row counts down to.
  game: { available: true, data: { kickoff: '2026-10-25T17:00:00.000Z', opponent: 'MIA', home: true, week: 12, season: 2026, preseason: false } },
  // Ferguson (DAL) shares the 1:00 slate; nobody else's club is mapped, so nobody else reads as locked.
  kickoffs: { BUF: '2026-10-25T17:00:00.000Z', MIA: '2026-10-25T17:00:00.000Z', DAL: '2026-10-25T17:00:00.000Z' },
  scheduleWeek: { season: 2026, week: 12 },
  kickoffsUnresolved: 0,
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

  it('in the core view, shows every other owner most reachable first instead of the single-league card', () => {
    const pirates: NonNullable<React.ComponentProps<typeof PlayerFinder>['windows']>[number] = {
      ...PRESENCE.data,
      leagueId: 'L-pirates',
      leagueName: 'Pirate League',
      platform: 'sleeper',
      managers: [{ ...PRESENCE.data.managers[0], ownerName: 'mikeD', window: { weekday: 6, startHour: 10, endHour: 12, daypart: 'morning', precision: 'window', share: 0.6, sample: 9, zone: 'ET' } }],
    }
    renderCore({ windows: [PRESENCE.data, pirates], windowsUnread: 1, nowIso: '2026-10-24T14:30:00.000Z' })
    const side = screen.getByRole('complementary', { name: 'What to do' })
    const card = within(side).getByRole('region', { name: 'Trade windows · who’s reachable' })
    expect(within(side).queryByRole('region', { name: 'Trade window · when they move' })).toBeNull()
    const rows = within(card).getAllByRole('listitem')
    expect(within(rows[0]).getByText('Pirate League · Sleeper')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Gridiron Gang · ESPN')).toBeInTheDocument()
    expect(within(card).getByText(/1 more league where someone else has him could not be read/)).toBeInTheDocument()
  })

  it('in league mode, keeps the single-league card even when cross-league windows were passed', () => {
    renderCore({ selectedLeagueId: 'L-gang', leagueView: LEAGUE_VIEW, presence: PRESENCE, windows: [PRESENCE.data], nowIso: '2026-10-24T14:30:00.000Z' })
    const side = screen.getByRole('complementary', { name: 'What to do' })
    expect(within(side).getByRole('region', { name: 'Trade window · when they move' })).toBeInTheDocument()
    expect(within(side).queryByRole('region', { name: 'Trade windows · who’s reachable' })).toBeNull()
  })

  it('keeps the column out when there is neither impact nor a window', () => {
    renderCore({ selectedLeagueId: 'L-gang', leagueView: LEAGUE_VIEW })
    expect(screen.queryByRole('complementary', { name: 'What to do' })).not.toBeInTheDocument()
  })
})

describe('Player Finder — game day', () => {
  const NOW = '2026-10-25T16:18:00.000Z' // 42 minutes before his 1:00pm ET kickoff

  it('puts the lineup lock on every league where he is yours, and no banner while he is healthy', () => {
    renderCore({ nowIso: NOW })
    expect(screen.getAllByText('locks in 42 min')).toHaveLength(3) // Warriors, Dragons, Elites — not Gridiron Gang
    expect(screen.queryByRole('region', { name: 'Game day' })).toBeNull()
  })

  it('leads with the game-day banner when he is Out: status, kickoff, the lock, and an Open-lineup button per league where he starts', () => {
    renderCore({ detail: { ...DETAIL, injury: { available: true, data: { status: 'Out', description: 'Ankle', reportedAt: null } } }, nowIso: NOW })
    const banner = screen.getByRole('region', { name: 'Game day' })
    expect(banner).toHaveAttribute('data-tone', 'bad')
    expect(within(banner).getByText('Out · Ankle')).toBeInTheDocument()
    expect(within(banner).getByText('vs MIA · Sun 1:00p ET')).toBeInTheDocument()
    expect(within(banner).getByText('locks in 42 min')).toHaveAttribute('data-lock', 'soon')
    expect(within(banner).getByText('Starting in 1 of your league — move Kincaid before kickoff.')).toBeInTheDocument()
    // Waiver Warriors is the one league where he starts (Dragons: bench, Elites: IR); its button opens Yahoo.
    const buttons = within(banner).getAllByRole('link')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('Waiver Warriors')
    expect(buttons[0].getAttribute('href')).toMatch(/yahoo\.com\/f1\/55/)
    expect(buttons[0]).toHaveAttribute('target', '_blank')
    // The fixture's Yahoo slot carries no team id, so the verified lineup format cannot build; the league page is offered and labelled as such.
    expect(buttons[0].textContent).toMatch(/^Open (lineup in Yahoo|in Yahoo · League)/)
    // The banner sits above the tiles, at the top of the card.
    const card = banner.closest('.af-pf-detail') as HTMLElement
    expect(card.querySelector('.af-pf-gameday + .af-pf-compare-entry')).not.toBeNull()
  })

  it('says there is nothing to move when he is benched everywhere, and stays quiet with no kickoff on file', () => {
    const benched = { ...DETAIL, injury: { available: true, data: { status: 'Questionable', description: 'Knee', reportedAt: null } }, impact: { available: true, data: IMPACT.map((i) => ({ ...i, slot: 'BENCH', isStarting: false })) } }
    renderCore({ detail: benched, nowIso: NOW })
    const banner = screen.getByRole('region', { name: 'Game day' })
    expect(banner).toHaveAttribute('data-tone', 'warn')
    expect(within(banner).getByText('On your bench in 3 leagues — nothing to move before kickoff.')).toBeInTheDocument()
    expect(within(banner).queryByRole('link')).toBeNull()

    // No kickoff on file: no banner and no row chips — the card says nothing it cannot time.
    const { container } = renderCore({ detail: { ...benched, game: { available: false, reason: 'no game on the schedule for BUF in week 12' } }, nowIso: NOW })
    expect(container.querySelector('.af-pf-gameday')).toBeNull()
    expect(container.querySelectorAll('.af-pf-lock')).toHaveLength(0)
    expect(screen.getAllByRole('region', { name: 'Game day' })).toHaveLength(1) // only the first render's
  })
})

describe('Player Finder — game-day home', () => {
  const NOW = '2026-10-25T16:18:00.000Z'
  const TRIAGE: NonNullable<React.ComponentProps<typeof PlayerFinder>['triage']> = {
    available: true,
    data: {
      week: { season: 2026, week: 12 },
      leaguesRead: 3,
      startersRead: 27,
      rows: [
        {
          player: { sport: 'NFL', externalId: 'ri-1', sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', team: 'BUF', imageUrl: null },
          status: { tone: 'bad', label: 'Out' },
          description: 'Ankle',
          reportedAt: null,
          leagues: [
            { leagueId: 'L-dragons', leagueName: 'Dynasty Dragons', platform: 'sleeper' },
            { leagueId: 'L-elites', leagueName: 'End Zone Elites', platform: 'espn' },
          ],
          kickoff: '2026-10-25T17:00:00.000Z',
          noGame: false,
          bye: false,
          inactive: null,
        },
        {
          player: { sport: 'NFL', externalId: 'ri-4', sleeperId: '8130', name: 'Jake Ferguson', position: 'TE', team: 'DAL', imageUrl: null },
          status: null,
          description: null,
          reportedAt: null,
          leagues: [{ leagueId: 'L-dragons', leagueName: 'Dynasty Dragons', platform: 'sleeper' }],
          kickoff: null,
          noGame: true,
          bye: false,
        },
      ],
    },
  }

  it('shows the flagged starters before any search, each row opening his card, with his lock', () => {
    render(<PlayerFinder query="" matches={[]} detail={null} leagueCount={6} signedIn triage={TRIAGE} nowIso={NOW} />)
    const card = screen.getByRole('region', { name: 'Game day · your flagged starters' })
    expect(within(card).getByText('3 of 6 lineups read · week 12')).toBeInTheDocument()
    const rows = within(card).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/core/players?q=Dalton%20Kincaid&player=NFL%3Ari-1')
    expect(within(rows[0]).getByText('Out · Ankle')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/starting in Dynasty Dragons · Sleeper, End Zone Elites · ESPN/)).toBeInTheDocument()
    expect(within(rows[0]).getByText('locks in 42 min')).toHaveAttribute('data-lock', 'soon')
    expect(rows[1]).toHaveAttribute('data-nogame', 'true')
    // A plain schedule gap (the fixture's `bye: false`): the chip says so, and there is no kickoff to count down to.
    expect(within(rows[1]).getByText('No game on the schedule')).toBeInTheDocument()
    expect(within(rows[1]).getByText('no kickoff to count down to')).toBeInTheDocument()
  })

  it('says the lineups are clear when nothing is flagged, gives the loader’s reason when it could not read, and stays out once a player is open', () => {
    render(<PlayerFinder query="" matches={[]} detail={null} leagueCount={6} signedIn triage={{ ...TRIAGE, data: { ...TRIAGE.data, rows: [] } }} nowIso={NOW} />)
    expect(screen.getByText('No flagged starters across your lineups week 12. Search any player above.')).toBeInTheDocument()

    render(<PlayerFinder query="" matches={[]} detail={null} leagueCount={0} signedIn triage={{ available: false, reason: 'connect a league to see your starters here' }} nowIso={NOW} />)
    expect(screen.getByText('connect a league to see your starters here.')).toBeInTheDocument()

    renderCore({ triage: TRIAGE, nowIso: NOW })
    expect(screen.getAllByRole('region', { name: 'Game day · your flagged starters' })).toHaveLength(2) // the two home renders above; none for the open card
  })

  it('shows a pregame inactive on the triage list with the announce clock instead of the report time', () => {
    const inactiveRow = { ...TRIAGE.data.rows[0]!, status: { tone: 'bad' as const, label: 'Inactive' }, reportedAt: '2026-10-25T15:32:00.000Z', inactive: { announcedAt: '2026-10-25T15:32:00.000Z', minutesBeforeKickoff: 88, clock: '11:32a ET' } }
    render(<PlayerFinder query="" matches={[]} detail={null} leagueCount={6} signedIn triage={{ ...TRIAGE, data: { ...TRIAGE.data, rows: [inactiveRow] } }} nowIso={NOW} />)
    const card = screen.getByRole('region', { name: 'Game day · your flagged starters' })
    expect(within(card).getByText('Inactive · Ankle')).toBeInTheDocument()
    expect(within(card).getByText('declared inactive at 11:32a ET · 88 min before kickoff')).toBeInTheDocument()
    expect(within(card).queryByText(/reported/)).toBeNull()
  })
})

describe('Player Finder — report time and bye', () => {
  const NOW = '2026-10-25T16:18:00.000Z'
  // 28 clubs on file in week 9: a real bye slate. Buffalo is not among them.
  const BYE_SLATE = Object.fromEntries(
    ['ARI', 'ATL', 'BAL', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF'].map((c) => [c, '2026-10-25T17:00:00.000Z']),
  )

  it('says when the feed reported it, in the banner and the injury section', () => {
    renderCore({
      detail: { ...DETAIL, injury: { available: true, data: { status: 'Out', description: 'Ankle', reportedAt: new Date('2026-10-25T15:12:00.000Z') } } },
      nowIso: NOW,
    })
    const banner = screen.getByRole('region', { name: 'Game day' })
    expect(within(banner).getByText('reported Sun 11:12a ET')).toBeInTheDocument()
    expect(screen.getAllByText('reported Sun 11:12a ET')).toHaveLength(2) // banner + injury section
  })

  it('calls an Out that landed inside the pregame window "Inactive" and leads the banner with the announcement', () => {
    // Out reported 11:32a ET for a 1:00p kickoff — 88 minutes before: the inactive list.
    renderCore({
      detail: { ...DETAIL, injury: { available: true, data: { status: 'Out', description: 'Ankle', reportedAt: new Date('2026-10-25T15:32:00.000Z') } } },
      nowIso: NOW,
    })
    const banner = screen.getByRole('region', { name: 'Game day' })
    expect(banner).toHaveAttribute('data-inactive', 'true')
    expect(within(banner).getByText('Inactive · Ankle')).toBeInTheDocument()
    expect(within(banner).getByText('Declared inactive at 11:32a ET, 88 min before kickoff. Starting in 1 of your league — move Kincaid before kickoff.')).toBeInTheDocument()
    expect(within(banner).getByText('reported 46 min ago')).toBeInTheDocument()
    // The header chip says it too; the injury section keeps the feed's own word.
    expect(screen.getAllByText('Inactive · Ankle').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Out')).toBeInTheDocument()
  })

  it('does not call a Friday ruling inactive', () => {
    renderCore({
      detail: { ...DETAIL, injury: { available: true, data: { status: 'Out', description: 'Ankle', reportedAt: new Date('2026-10-23T20:31:00.000Z') } } },
      nowIso: NOW,
    })
    const banner = screen.getByRole('region', { name: 'Game day' })
    expect(banner).not.toHaveAttribute('data-inactive')
    expect(within(banner).getByText('Out · Ankle')).toBeInTheDocument()
    expect(screen.queryByText(/Declared inactive/)).toBeNull()
  })

  it('marks a bye beside readiness and leads with a bye banner that still offers the lineup buttons', () => {
    renderCore({
      detail: { ...DETAIL, game: { available: false, reason: 'no game on the schedule for BUF in week 9' }, kickoffs: BYE_SLATE, scheduleWeek: { season: 2026, week: 9 } },
      nowIso: NOW,
    })
    expect(screen.getAllByText('Bye · wk 9').length).toBeGreaterThanOrEqual(2) // header chip + banner chip
    const banner = screen.getByRole('region', { name: 'Game day' })
    expect(banner).toHaveAttribute('data-kind', 'bye')
    expect(within(banner).getByText('Ready · Ankle')).toBeInTheDocument() // readiness still shown: a Ready player on bye scores nothing
    expect(within(banner).getByText('On bye this week — Kincaid is in your starting lineup in 1 league; bench him before those lineups lock.')).toBeInTheDocument()
    expect(within(banner).getAllByRole('link')).toHaveLength(1)
    expect(screen.queryAllByText(/locks in/)).toHaveLength(0) // no kickoff, so no row clocks either
  })

  it('reads a schedule gap as "no game on the schedule", never as a bye', () => {
    // Week 1, 30 clubs on file: one fixture is missing, nobody is on bye.
    const gap = Object.fromEntries(Object.entries(BYE_SLATE).slice(0, 30 - 2))
    renderCore({
      detail: { ...DETAIL, game: { available: false, reason: 'no game on the schedule for BUF in week 1' }, kickoffs: { ...gap, TB: '2026-10-25T17:00:00.000Z', TEN: '2026-10-25T17:00:00.000Z', WAS: '2026-10-25T17:00:00.000Z', X1: '2026-10-25T17:00:00.000Z' }, scheduleWeek: { season: 2026, week: 1 } },
      nowIso: NOW,
    })
    expect(screen.getAllByText('No game on the schedule').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/Bye · wk/)).toBeNull()
    expect(screen.getByRole('region', { name: 'Game day' })).toHaveAttribute('data-kind', 'no-game')
  })
})

describe('Player Finder — legal bench swaps', () => {
  const KICKED_OFF = '2026-10-25T17:30:00.000Z' // the 1:00 games are under way

  it('marks a swap candidate whose game has kicked off as locked, never green, and last', () => {
    const detail: PlayerDetail = {
      ...DETAIL,
      impact: {
        available: true,
        data: [
          impact({
            leagueId: 'L-dragons',
            leagueName: 'Dynasty Dragons',
            platform: 'sleeper',
            slot: 'BENCH',
            afPoints: { available: true, data: { points: 15.4, matchedKeys: 4, scoredKeys: 30 } },
            replacements: {
              available: true,
              data: [
                { playerId: 'fergie', name: 'Jake Ferguson', position: 'TE', team: 'DAL', afPoints: 17.0, delta: 1.6, injuryStatus: null, from: 'STARTER' },
                { playerId: 'likely', name: 'Isaiah Likely', position: 'TE', team: 'BAL', afPoints: 12.3, delta: -3.1, injuryStatus: null, from: 'BENCH' },
              ],
            },
          }),
        ],
      },
    }
    renderCore({ detail, nowIso: KICKED_OFF })
    const card = screen.getByRole('region', { name: 'Swap candidates on your bench' })
    const rows = within(card).getAllByRole('listitem')
    // Likely (BAL, not in the map) is movable and first; Ferguson (DAL, kicked off) is locked and last despite the better number.
    expect(within(rows[0]).getByText('Isaiah Likely')).toBeInTheDocument()
    expect(rows[1]).toHaveAttribute('data-locked', 'true')
    expect(within(rows[1]).getByText(/locked · kicked off Sun 1:00p ET/)).toBeInTheDocument()
    expect(within(rows[1]).getByText('17.0')).not.toHaveAttribute('data-better')
    expect(within(card).getByText(/1 is locked — their games have kicked off/)).toBeInTheDocument()
  })

  it('keeps a locked recommended move in the list without its button, and says his own game has started in the banner', () => {
    renderCore({ detail: { ...DETAIL, injury: { available: true, data: { status: 'Out', description: 'Ankle', reportedAt: null } } }, nowIso: KICKED_OFF })
    // Kincaid (BUF) kicked off: the Dragons swap cannot be made.
    const moves = screen.getByRole('region', { name: 'Recommended moves' })
    const swap = within(moves).getByText(/Swap Ferguson out for Kincaid/).closest('li') as HTMLElement
    expect(within(swap).getByText('locked')).toBeInTheDocument()
    expect(within(swap).queryByRole('link', { name: /Open in Sleeper/ })).toBeNull()
    expect(within(swap).getByText(/locked — both games have kicked off/)).toBeInTheDocument()

    const banner = screen.getByRole('region', { name: 'Game day' })
    expect(within(banner).getByText('His game has kicked off — Kincaid is locked in your lineup in 1 league; nothing can move now.')).toBeInTheDocument()
    expect(within(banner).queryByRole('link')).toBeNull()
    expect(within(banner).getByText('locked · kicked off Sun 1:00p ET')).toHaveAttribute('data-lock', 'locked')
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

describe('Player Finder — IDP value', () => {
  /**
   * FantasyCalc prices no defenders, so 719 rostered players had no value anywhere. The tile
   * carries the league-free IDP board's number — and the reference league it is relative to.
   */
  const PARSONS: PlayerDetail = {
    ...DETAIL,
    player: { ...DETAIL.player, name: 'Micah Parsons', position: 'LB', team: 'Green Bay Packers' },
    idpValue: {
      value: 3284,
      positionRank: 4,
      reference: { numTeams: 12, idpStarters: 3, scoringFormat: 'IDP' },
      computedAt: '2026-09-06T15:00:00.000Z',
    },
  }

  it('shows the value for a defender', () => {
    renderCore({ detail: PARSONS })
    expect(screen.getByText('IDP value')).toBeInTheDocument()
    // Rendered with toLocaleString, so the separator matters to a reader.
    expect(screen.getByText('3,284')).toBeInTheDocument()
  })

  it('🛑 RENDERS THE REFERENCE LEAGUE BESIDE IT — the number is meaningless alone', () => {
    /*
     * "Worth 3,284" is a fact about a 12-team league starting three defenders, not about the
     * world. If this assertion ever fails, the tile is making a claim the board cannot support.
     */
    renderCore({ detail: PARSONS })
    expect(screen.getByText(/12-team/)).toBeInTheDocument()
    expect(screen.getByText(/3 IDP/)).toBeInTheDocument()
    expect(screen.getByText(/rank 4/)).toBeInTheDocument()
  })

  it('🛑 RENDERS NO TILE AT ALL when there is no value — not an empty one', () => {
    /*
     * A defender the board has not priced is UNMEASURED, not worthless, and "—" beside a value
     * label reads as the latter. The base DETAIL fixture carries no idpValue, which is also the
     * state every player is in before the cron has run.
     */
    renderCore({ detail: { ...PARSONS, idpValue: null } })
    expect(screen.queryByText('IDP value')).toBeNull()
    expect(screen.queryByText('3,284')).toBeNull()
  })

  it('[control] a non-defender never carries one', () => {
    renderCore()
    expect(screen.queryByText('IDP value')).toBeNull()
  })
})
