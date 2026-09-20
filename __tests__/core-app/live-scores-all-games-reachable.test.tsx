import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { LiveScores } from '@/components/core-app/screens/LiveScores'
import type { LiveGameCard, LivePageData } from '@/lib/live/liveScoresPage'

/*
 * /core/live must let you reach EVERY game, not only your league's.
 *
 * 🛑 THE BUG THIS PINS, REPORTED FROM A PHONE: "the live scores tab doesn't show
 * the live sports, only my team." Three things combined to make it a dead end.
 *
 *   - `scopeLiveGamesToLeague(games, selectedLeagueId)` narrowed the slate
 *     unconditionally whenever a league was in context;
 *   - the My games / All games control rendered only when NO league was selected
 *     (`{!selectedLeagueId ? … : null}`), so it was hidden in exactly the state
 *     that needed it;
 *   - and the nav's own href always carries `?league=`.
 *
 * So every route into the screen arrived league-scoped with no way to widen it.
 * It was never a data problem: the games were fetched and then filtered away on
 * the client.
 *
 * ⚠ IT RENDERS THE COMPONENT RATHER THAN CALLING `scopeLiveGamesToLeague`.
 * `live-scores-league-scope.test.ts` already covers that helper, and the helper
 * was never wrong — the defect was at its CALL SITE and in what the header chose
 * to render. A test of the pure function stays green through this entire bug,
 * which is why it did.
 *
 * ⚠ AND IT SETS `scope` THROUGH `data.scope` RATHER THAN CLICKING. The component
 * seeds its state from the payload, so both states render with no fetch stub and
 * no timers — a click would exercise the poll path, which is a different claim
 * and a flakier one.
 */

function game(id: string, leagueIds: string[]): LiveGameCard {
  return {
    gameId: id,
    sport: 'NFL',
    week: 1,
    status: 'scheduled',
    statusDetail: 'Sun',
    clockLabel: null,
    isLive: false,
    completed: false,
    startTime: '2026-09-20T17:00:00.000Z',
    home: { abbrev: `${id}H`, name: `${id} home`, logo: '', score: null, record: null, linescores: [], hits: null, errors: null, leaders: [], shooting: null },
    away: { abbrev: `${id}A`, name: `${id} away`, logo: '', score: null, record: null, linescores: [], hits: null, errors: null, leaders: [], shooting: null },
    winProbability: null,
    topPerformer: null,
    leaders: [],
    situation: null,
    venue: null,
    broadcast: null,
    espnDetail: true,
    leadersArePregame: false,
    tieIns: leagueIds.map((leagueId) => ({
      leagueId,
      leagueName: leagueId,
      playerId: `${leagueId}-player`,
      playerName: `${leagueId} player`,
      position: 'WR',
      imageUrl: null,
      isStarter: true,
      points: 4.2,
    })),
    leaguesAffected: leagueIds.length,
  }
}

function payload(scope: 'my' | 'all'): LivePageData {
  return {
    sport: 'NFL',
    scope,
    counts: [{ sport: 'NFL', label: 'NFL', slateCount: 2 }],
    games: [game('mine', ['league-a']), game('theirs', ['league-b'])],
    impact: { totalPoints: 0, livePlayers: 0, liveGames: 0, biggestMover: null, plays: [], upNext: [] },
    lockAlerts: [],
    fetchedAt: '2026-09-20T17:00:00.000Z',
    hasRosterData: true,
    loadFailed: false,
  }
}

const cards = (c: HTMLElement) => c.querySelectorAll('.af-live-game').length

describe('/core/live reaches every game', () => {
  it('offers the My/All control even with a league selected', () => {
    const { container } = render(<LiveScores data={payload('my')} selectedLeagueId="league-a" />)
    const labels = [...container.querySelectorAll('.af-live-scope-btn')].map((b) => b.textContent?.trim())
    expect(labels).toEqual(['My games', 'All games'])
  })

  it('narrows to the league on "My games"', () => {
    const { container } = render(<LiveScores data={payload('my')} selectedLeagueId="league-a" />)
    expect(cards(container)).toBe(1)
    // Assert on the team abbrevs, which the card renders in every state. Tie-in
    // player names are only drawn for a live game, so asserting on those would
    // have made this pass or fail on the fixture's `status`, not on the scope.
    expect(container.textContent).toContain('mineH')
    expect(container.textContent).not.toContain('theirsH')
  })

  it('🛑 shows the whole slate on "All games", league selected or not', () => {
    const { container } = render(<LiveScores data={payload('all')} selectedLeagueId="league-a" />)
    expect(cards(container)).toBe(2)
    expect(container.textContent).toContain('mineH')
    expect(container.textContent).toContain('theirsH')
  })

  it('does not describe the slate as league-only while showing everything', () => {
    const { container } = render(<LiveScores data={payload('all')} selectedLeagueId="league-a" />)
    // The copy and the data attribute both followed `selectedLeagueId` rather than
    // the effective scope, so the page claimed "only games affecting starters in
    // this league" over a full slate.
    expect(container.textContent).not.toContain('Only games affecting starters in this league')
    expect(container.querySelector('.af-live[data-league-scoped="true"]')).toBeNull()
  })
})
