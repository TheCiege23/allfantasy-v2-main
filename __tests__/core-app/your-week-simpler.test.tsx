/**
 * Your week, one league, simpler (2026-11-14): the h1 is your game in words, "Week" for a weekly sport,
 * the series in plain words, and the folded Blueprint saying each thing once.
 */
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import YourWeekLeague from '@/components/core-app/screens/YourWeekLeague'
import { yourWeekLeagueMessages } from '@/lib/core-app/messages/yourWeekLeague'
import { buildWeeklySwings } from '@/lib/core-app/weeklySportPlan'
import type { LeagueWeekBoard, WeekMatchup } from '@/lib/core-app/weekBoard'
import type { WeeklyBlueprint } from '@/lib/core-app/weeklyBlueprint'

function matchup(over: Partial<WeekMatchup> = {}): WeekMatchup {
  return {
    leagueId: 'l1', leagueName: 'Sample League', platform: 'sleeper', leagueImageUrl: null, season: 2026, week: 10,
    opponent: { rosterId: '2', name: 'Sample Dolphins', avatarUrl: null }, elimination: false,
    projection: { you: 120, them: 119, margin: 1, winProbability: 0.52 }, form: null, yourSampleWeeks: 5,
    live: null, href: '/core/matchup?league=l1',
    ...over,
  } as WeekMatchup
}

const board = (over: Partial<LeagueWeekBoard> = {}): LeagueWeekBoard =>
  ({
    leagueId: 'l1', leagueName: 'Sample League', platform: 'sleeper', season: 2026, week: 10, sport: 'NFL',
    yours: matchup(), sidelines: [], rivalry: { wins: 2, losses: 5, ties: 0, meetings: 7, averageMargin: -24 },
    records: {}, yourRosterId: '1', yourTeamName: 'Sample You', yourAvatarUrl: null,
    ...over,
  }) as LeagueWeekBoard

const h1 = () => screen.getByRole('heading', { level: 1 }).textContent

describe('Your week — the headline is your game', () => {
  it('in progress, final, and before kickoff', () => {
    const { unmount } = render(<YourWeekLeague board={board({ yours: matchup({ live: { you: 0, them: 13, margin: -13, final: false } }) })} allWeeksHref="/w" />)
    expect(h1()).toBe('Week 10: you trail Sample Dolphins 0.0 to 13.0')
    unmount()
    const won = render(<YourWeekLeague board={board({ yours: matchup({ live: { you: 141.2, them: 120.5, margin: 20.7, final: true } }) })} allWeeksHref="/w" />)
    expect(h1()).toBe('Week 10: you beat Sample Dolphins 141.2 to 120.5')
    won.unmount()
    // A scoreboard with no points yet is "you vs", never a 0–0 tie.
    render(<YourWeekLeague board={board({ yours: matchup({ live: { you: 0, them: 0, margin: 0, final: false } }) })} allWeeksHref="/w" />)
    expect(h1()).toBe('Week 10: you vs Sample Dolphins')
  })

  it('says Week in a weekly sport and Period elsewhere; the league moves to the eyebrow', () => {
    const { container, unmount } = render(<YourWeekLeague board={board()} allWeeksHref="/w" />)
    expect(h1()).toBe('Week 10: you vs Sample Dolphins')
    expect(container.textContent).toContain('Your week · Sample League · 2026')
    expect(container.textContent).not.toContain('Period')
    unmount()
    render(<YourWeekLeague board={board({ sport: 'NBA' })} allWeeksHref="/w" />)
    expect(h1()).toBe('Period 10: you vs Sample Dolphins')
  })

  it('the series in plain words, not a "signed scoring advantage"', () => {
    const { container } = render(<YourWeekLeague board={board()} allWeeksHref="/w" />)
    expect(container.textContent).toContain('Sample Dolphins lead the series over 7 meetings, and they’ve outscored you by 24.0 a game.')
    expect(container.textContent).not.toContain('signed scoring advantage')
    const m = yourWeekLeagueMessages.en
    expect(m.rivalryPoints(3.2)).toBe('and you’ve outscored them by 3.2 a game')
    expect(m.rivalryPoints(0.01)).toBe('and you’re even on points')
    expect(yourWeekLeagueMessages.es!.headline!('Semana 10', 'X', 'live', 0, 13)).toBe('Semana 10: pierdes contra X 0.0 a 13.0')
  })
})

describe('Your week — the Blueprint says the sport advice once', () => {
  it('on the first card of a sport only; Chimmy’s prompts keep it', () => {
    const data = {
      actions: [
        { id: 'a', leagueId: 'l', leagueName: 'Mine', kind: 'monitor', count: 1, href: '/x', evidence: { empty: 0, out: 0, bye: 0, questionable: 1 }, period: 10 },
        { id: 'b', leagueId: 'l', leagueName: 'Mine', kind: 'playoff', count: 1, href: '/y', period: 11, playoffScenarios: { ifWin: 0.7, ifLose: 0 } },
      ],
      sportPlans: [{ leagueId: 'l', sport: 'NFL' }],
    } as unknown as WeeklyBlueprint
    const [first, second] = buildWeeklySwings(data)
    const advice = 'Check bye weeks, injury designations and each player’s kickoff before replacing a starter.'
    expect(first!.detail).toContain(advice)
    expect(second!.detail).not.toContain(advice)
    expect(second!.prompt).toContain(advice)
  })
})
