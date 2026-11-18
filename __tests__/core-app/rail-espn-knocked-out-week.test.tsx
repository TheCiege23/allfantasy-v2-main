import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))

import { RailRowBody } from '@/components/core-app/RailRowBody'
import { allPlayWeeks, espnAllPlayEliminationSize, espnKnockoutWeek } from '@/lib/core-app/espnKnockoutWeek'
import { railRecordsFrom, type RailRecordTeam } from '@/lib/core-app/railRecordRank'

afterEach(cleanup)

/*
 * ESPN "Washington Pro Knockout PPR League" (18 teams, WEEKLY_ALL_PLAY_POINTS + WEEKLY_ELIMINATION) as
 * synced on 2026-11-18, in the middle of week 11: every `LeagueTeam` row's record and ESPN rank. ESPN's
 * own KO'D table that day listed weeks 10, 9, 8 (ceejay's Cool Team), 7 … 1.
 */
const team = (externalId: string, wins: number, losses: number, currentRank: number, ties = 0): RailRecordTeam => ({
  leagueId: 'wash', externalId, wins, losses, ties, pointsFor: 0, currentRank,
})
// Two survivors carry a tie each (78-46-1, 57-67-1): an all-play game, so it counts toward the week.
const WASHINGTON: RailRecordTeam[] = [
  team('4', 85, 40, 1), team('2', 82, 43, 2), team('18', 78, 46, 3, 1), team('15', 75, 50, 4),
  team('14', 62, 63, 5), team('6', 57, 68, 6), team('16', 57, 67, 7, 1), team('7', 54, 71, 8),
  team('13', 59, 66, 9), // "I Need FAAB $$, TRADES", out in week 10
  team('17', 69, 48, 10), team('9', 52, 56, 11), // ceejay's Cool Team, out in week 8
  team('3', 48, 50, 12), team('12', 32, 55, 13), team('5', 28, 47, 14), team('11', 19, 43, 15),
  team('8', 23, 25, 16), team('10', 4, 29, 17), team('1', 0, 17, 18),
]
const ESPN_KO_WEEK: Record<string, number> = { '13': 10, '17': 9, '9': 8, '3': 7, '12': 6, '5': 5, '11': 4, '8': 3, '10': 2, '1': 1 }

describe('espnKnockoutWeek', () => {
  it("names the week of every team ESPN knocked out, and no week for the 8 still alive", () => {
    for (const me of WASHINGTON) {
      expect(espnKnockoutWeek({ size: 18, me, league: WASHINGTON }), me.externalId).toBe(ESPN_KO_WEEK[me.externalId] ?? null)
    }
  })

  it('counts weeks from all-play games: 17 + 16 + … + 10 = 108 is 8 weeks of 18 teams', () => {
    expect(allPlayWeeks(108, 18)).toBe(8)
    expect(allPlayWeeks(17, 18)).toBe(1)
    expect(allPlayWeeks(109, 18)).toBeNull()
    expect(allPlayWeeks(0, 18)).toBeNull()
  })

  it('does not name a latest-week knockout without a rank that places it below the survivors', () => {
    const faab = WASHINGTON.find((t) => t.externalId === '13')!
    expect(espnKnockoutWeek({ size: 18, me: { ...faab, currentRank: null }, league: WASHINGTON })).toBeNull()
    expect(espnKnockoutWeek({ size: 18, me: { ...faab, currentRank: 8 }, league: WASHINGTON })).toBeNull()
    // Two teams level with the survivors and one place for a knockout: ambiguous, so nothing.
    const extra = [...WASHINGTON, team('99', 60, 65, 19)]
    expect(espnKnockoutWeek({ size: 18, me: faab, league: extra })).toBeNull()
  })

  it("applies only under ESPN's stated all-play elimination rules", () => {
    expect(espnAllPlayEliminationSize({ scoringType: 'WEEKLY_ALL_PLAY_POINTS', enhancement: 'WEEKLY_ELIMINATION', size: '18' })).toBe(18)
    expect(espnAllPlayEliminationSize({ scoringType: 'H2H_POINTS', enhancement: null, size: '10' })).toBeNull()
    expect(espnAllPlayEliminationSize({ scoringType: 'H2H_POINTS', enhancement: 'WEEKLY_ELIMINATION', size: '18' })).toBeNull()
    expect(espnAllPlayEliminationSize({ scoringType: 'WEEKLY_ALL_PLAY_POINTS', enhancement: 'WEEKLY_ELIMINATION', size: null })).toBeNull()
  })
})

describe('the league list row', () => {
  const mine = [{ leagueId: 'wash', externalId: '9' }]

  it('reads "Knocked out · Week 8" with the record and no rank', () => {
    const record = railRecordsFrom(mine, WASHINGTON, new Map([['wash', 18]])).wash
    expect(record).toMatchObject({ wins: 52, losses: 56, rank: null, knockedOutWeek: 8 })
    render(<RailRowBody name="Washington Pro Knockout PPR League" platform="espn" m={null} showScoreStatus={false} record={record} />)
    expect(screen.getByTestId('rail-knocked-out').textContent).toBe('Knocked out · Week 8')
    expect(screen.getByTestId('rail-knocked-out').querySelector('.af-rail-row-rank[data-knocked-out]')).not.toBeNull()
    expect(screen.queryByText('Matchup unavailable from ESPN')).toBeNull()
    expect(screen.getByText('52-56')).toBeTruthy()
    expect(screen.queryByText(/11th/)).toBeNull()
  })

  it('keeps the plain record and rank for a league ESPN does not run as all-play elimination', () => {
    const record = railRecordsFrom(mine, WASHINGTON).wash
    expect(record).toMatchObject({ rank: 11 })
    expect(record.knockedOutWeek).toBeUndefined()
    render(<RailRowBody name="Washington Pro Knockout PPR League" platform="espn" m={null} showScoreStatus={false} record={record} />)
    expect(screen.queryByTestId('rail-knocked-out')).toBeNull()
    expect(screen.getByText('Matchup unavailable from ESPN')).toBeTruthy()
  })

  it('leaves a survivor alone', () => {
    const record = railRecordsFrom([{ leagueId: 'wash', externalId: '4' }], WASHINGTON, new Map([['wash', 18]])).wash
    expect(record).toMatchObject({ rank: 1 })
    expect(record.knockedOutWeek).toBeUndefined()
  })
})
