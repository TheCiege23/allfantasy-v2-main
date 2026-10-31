/**
 * Batch A6: the Schedule tab's season calendar draws only what the league carries, and the restyled
 * tab sources carry no hardcoded dark colour utilities (the reason they broke in light mode).
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ScheduleView } from '@/app/league/[leagueId]/tabs/redraft/ScheduleView'

afterEach(cleanup)

const matchup = (week: number) => ({
  id: `m${week}`, week, slot: 0, type: 'regular', homeRosterId: 'r1', awayRosterId: 'r2', homeName: `Home ${week}`, awayName: `Away ${week}`,
  homeDivisionId: null, awayDivisionId: null, homeDivisionName: null, awayDivisionName: null, divisionGame: false, bye: false,
  repeatCycle: 0, sourceRound: week, status: 'scheduled', locked: false, homeScore: null, awayScore: null,
})
const schedule = {
  generated: true, season: 2026, currentWeek: 3, regularSeasonWeeks: 4, playoffStartWeek: 5, validationIssues: [], standings: [],
  playoffQualificationSnapshot: { seeds: [], bubbleRosterIds: [], eliminatedRosterIds: [] },
  weeks: [1, 2, 3, 4].map(w => ({ week: w, status: w < 3 ? 'completed' : 'scheduled', locked: false, isCurrent: w === 3, matchups: [matchup(w)], byeRosterIds: [] })),
}

describe('ScheduleView season calendar', () => {
  it('marks the deadline and playoff weeks when the league carries them', () => {
    render(<ScheduleView schedule={schedule as never} totalWeeks={6} tradeDeadlineWeek={4} />)
    expect(screen.getByTestId('redraft-schedule-cal-week-4').getAttribute('data-deadline')).toBe('true')
    expect(screen.getByTestId('redraft-schedule-cal-week-5').getAttribute('data-kind')).toBe('playoff')
    expect(screen.getByTestId('redraft-schedule-cal-week-6').getAttribute('data-championship')).toBe('true')
    expect((screen.getByTestId('redraft-schedule-cal-week-6') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('redraft-schedule-cal-week-3').getAttribute('data-state')).toBe('now')
    expect(screen.getByText('Trade deadline · Wk 4')).toBeTruthy()
  })

  it('without totalWeeks or a deadline (the legacy Season Hub caller) draws neither', () => {
    render(<ScheduleView schedule={schedule as never} />)
    expect(screen.queryByTestId('redraft-schedule-cal-week-5')).toBeNull()
    expect(document.querySelector('[data-deadline]')).toBeNull()
    expect(screen.queryByText(/Trade deadline/)).toBeNull()
  })

  it('picking a week shows its matchups (the week picker testid is kept)', () => {
    render(<ScheduleView schedule={schedule as never} totalWeeks={6} />)
    expect(screen.getByTestId('redraft-schedule-week-picker')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^W1\b/ }))
    expect(screen.getByText('Week 1 matchups')).toBeTruthy()
    expect(screen.getByText('Home 1')).toBeTruthy()
  })
})

describe('no hardcoded dark colours in the restyled tab sources', () => {
  const FILES = [
    'app/league/[leagueId]/tabs/ScoresTab.tsx',
    'app/league/[leagueId]/tabs/WarRoomTab.tsx',
    'app/league/[leagueId]/tabs/AICoachingTab.tsx',
    'app/league/[leagueId]/tabs/redraft/ScheduleView.tsx',
    'app/league/[leagueId]/tabs/redraft/RedraftWarRoomPanel.tsx',
    'app/league/[leagueId]/tabs/redraft/WeekControlPanel.tsx',
    'app/league/[leagueId]/tabs/redraft/ScheduleRegeneratePanel.tsx',
    'components/ai/coaching/AICoachingPage.tsx',
    'components/ai/coaching/FranchisePlanCard.tsx',
    'components/ai/coaching/RosterHealthPanel.tsx',
    'components/ai/coaching/CoachingActionPlan.tsx',
  ]
  // `border-white/[0.06]` is kept once, deliberately: it is the shared AFWarRoomPlanSpotlight's own prop.
  const DARK = /(?<![\w-])(?:text-white|bg-black|bg-white\/|bg-\[#|text-\[#|text-(?:violet|cyan|sky|amber|rose|emerald)-\d)/
  for (const rel of FILES) {
    it(rel, () => {
      const offending = readFileSync(rel, 'utf8').split('\n').filter(l => DARK.test(l))
      expect(offending).toEqual([])
    })
  }
  it('the guard fires on the old form (positive control)', () => {
    expect(DARK.test('className="text-white/45 bg-[#07071a]"')).toBe(true)
    expect(DARK.test('className="rdt-faint rdt-surface"')).toBe(false)
  })
})
