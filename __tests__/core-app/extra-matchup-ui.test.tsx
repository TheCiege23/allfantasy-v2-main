import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))

import { RailRowBody } from '@/components/core-app/RailRowBody'
import { MatchupView } from '@/app/league/[leagueId]/tabs/redraft/MatchupView'
import { ScheduleView } from '@/app/league/[leagueId]/tabs/redraft/ScheduleView'

afterEach(cleanup)

const LINE = "Extra matchup vs Top Dogs (last week's top scorer) · 120.3–101.5"
const VIEW = { role: 'leftover' as const, otherRosterId: 'r2', teamName: 'Top Dogs', reason: 'top_scorer' as const, countsForYou: true, yourScore: 120.25, theirScore: 101.5, final: true, label: "Extra matchup vs Top Dogs (last week's top scorer)", line: LINE }

describe('the extra matchup is drawn', () => {
  it('on the league rail', () => {
    render(<RailRowBody name="Odd League" platform="allfantasy" m={{ yourTeam: 'Mine', yourAvatarUrl: null, yourScore: 120.25, opponentTeam: 'Top Dogs', opponentAvatarUrl: null, opponentScore: 101.5, scored: true, unpaired: false, week: 4, native: true, extraMatchup: { label: VIEW.label, line: LINE, yourScore: 120.25, theirScore: 101.5 } }} />)
    expect(screen.getByTestId('rail-extra-matchup').textContent).toBe(LINE)
  })

  it("on the league page's week matchup: the bye team's opponent is the chosen team, with its score", () => {
    const bye = { id: 'bye', week: 4, status: 'final', homeScore: 120.25, awayScore: 0, homeRosterId: 'r1', awayRosterId: null, homeRoster: { id: 'r1', teamName: 'Mine', wins: 1, losses: 2, pointsFor: 300 }, awayRoster: null }
    render(<MatchupView matchup={bye as never} selectedRosterId="r1" sport="NFL" extraMatchup={VIEW} />)
    expect(screen.getByTestId('redraft-extra-matchup').textContent).toBe(LINE)
    expect(screen.getByText('Top Dogs')).toBeTruthy()
    expect(screen.getByText('101.50')).toBeTruthy()
  })

  it('on the schedule: "Extra matchup" instead of "Bye week"', () => {
    const matchup = { id: 'bye', week: 4, slot: 2, type: 'bye', homeRosterId: 'r1', awayRosterId: null, homeName: 'Mine', awayName: null, homeDivisionId: null, awayDivisionId: null, homeDivisionName: null, awayDivisionName: null, divisionGame: false, bye: true, repeatCycle: 0, sourceRound: 4, status: 'final', locked: true, homeScore: 120.25, awayScore: null, extraMatchup: { opponentRosterId: 'r2', opponentName: 'Top Dogs', line: LINE } }
    const schedule = { generated: true, currentWeek: 4, regularSeasonWeeks: 14, playoffStartWeek: 15, validationIssues: [], playoffQualificationSnapshot: { seeds: [], bubbleRosterIds: [], eliminatedRosterIds: [] }, weeks: [{ week: 4, status: 'completed', locked: true, isCurrent: true, matchups: [matchup], byeRosterIds: ['r1'] }], standings: [] }
    render(<ScheduleView schedule={schedule as never} />)
    expect(screen.getByText('Extra matchup')).toBeTruthy()
    expect(screen.getByTestId('redraft-schedule-extra-matchup').textContent).toBe(LINE)
  })

  it('a plain bye still says "Bye week"', () => {
    const matchup = { id: 'bye', week: 4, slot: 2, type: 'bye', homeRosterId: 'r1', awayRosterId: null, homeName: 'Mine', awayName: null, bye: true, status: 'scheduled', divisionGame: false }
    const schedule = { generated: true, currentWeek: 4, regularSeasonWeeks: 14, playoffStartWeek: 15, validationIssues: [], playoffQualificationSnapshot: { seeds: [], bubbleRosterIds: [], eliminatedRosterIds: [] }, weeks: [{ week: 4, matchups: [matchup], byeRosterIds: ['r1'] }], standings: [] }
    render(<ScheduleView schedule={schedule as never} />)
    expect(screen.getByText('Bye week')).toBeTruthy()
    expect(screen.queryByTestId('redraft-schedule-extra-matchup')).toBeNull()
  })
})
