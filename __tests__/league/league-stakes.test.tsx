/**
 * "This week's stakes" on the native league home (2026-10-13): Survivor immunity + council,
 * Big Brother HOH + the block + veto, Guillotine chop line + your margin.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BigBrotherSummary } from '@/components/big-brother/types'
import type { SurvivorSummary } from '@/components/survivor/types'
import { bigBrotherPhaseLabel, bigBrotherStakes, guillotineStakes, survivorPhase, survivorStakes, type GuillotineSummaryLite } from '@/lib/league/format-stakes'
import { LeagueStakesCard, stakesEndpoint, stakesFormatFor } from '@/components/league/native/LeagueStakesCard'

afterEach(() => vi.unstubAllGlobals())

const label = (lines: { label: string; value: string }[], name: string) => lines.find((line) => line.label === name)?.value

function survivor(over: Partial<SurvivorSummary> = {}): SurvivorSummary {
  return {
    config: {} as SurvivorSummary['config'],
    currentWeek: 4,
    tribes: [
      { id: 'tA', name: 'Tagi', slotIndex: 0, members: [] },
      { id: 'tB', name: 'Pagong', slotIndex: 1, members: [] },
    ],
    council: null,
    challenges: [],
    jury: [],
    exileLeagueId: null,
    exileTokens: [],
    votedOutHistory: [],
    merged: false,
    myRosterId: 'r1',
    myTribeId: 'tB',
    myIdols: [],
    finale: null,
    rosterDisplayNames: { r1: 'Me', r2: 'Rich', r3: 'Sue' },
    ...over,
  } as SurvivorSummary
}

describe('Survivor stakes', () => {
  it('nothing before the draft: no tribes, no council, no challenges', () => {
    expect(survivorStakes(survivor({ tribes: [] }))).toBeNull()
  })

  it('immunity, who goes to council, and your tribe — and you are told to vote', () => {
    const stakes = survivorStakes(survivor({
      challenges: [{ id: 'c', week: 4, challengeType: 'x', lockAt: null, resultJson: {}, winnerTribeId: 'tA' }],
      council: { id: 'k', week: 4, phase: 'voting_open', attendingTribeId: 'tB', voteDeadlineAt: '2026-11-08T23:00:00.000Z', closedAt: null, eliminatedRosterId: null },
    }))!
    expect(stakes.title).toBe('Tribal Council')
    expect(label(stakes.lines, 'Immunity')).toBe('Tagi')
    expect(label(stakes.lines, 'Tribal Council')).toBe('Pagong')
    expect(label(stakes.lines, 'Your tribe')).toBe('Pagong')
    expect(stakes.you).toEqual({ text: 'You are going to Tribal Council. Cast your vote before it closes.', tone: 'danger' })
    expect(stakes.deadlineIso).toBe('2026-11-08T23:00:00.000Z')
    expect(stakes.tab).toBe('survivor_tribal')
  })

  it('a castaway already voted out is not told to vote', () => {
    const stakes = survivorStakes(survivor({
      votedOutHistory: [{ rosterId: 'r1', week: 2 }],
      council: { id: 'k', week: 4, phase: 'voting_open', attendingTribeId: 'tB', voteDeadlineAt: '2026-11-08T23:00:00.000Z', closedAt: null, eliminatedRosterId: null },
    }))!
    expect(stakes.you).toBeNull()
  })

  it('your tribe winning immunity is good news; a closed council names who went', () => {
    const stakes = survivorStakes(survivor({
      challenges: [{ id: 'c', week: 4, challengeType: 'x', lockAt: null, resultJson: {}, winnerTribeId: 'tB' }],
      council: { id: 'k', week: 4, phase: 'closed', attendingTribeId: 'tA', voteDeadlineAt: '2026-11-08T23:00:00.000Z', closedAt: '2026-11-08T23:05:00.000Z', eliminatedRosterId: 'r3', isRevealed: true },
    }))!
    expect(stakes.you).toEqual({ text: 'Your tribe won immunity this week.', tone: 'good' })
    expect(label(stakes.lines, 'Voted out')).toBe('Sue')
    expect(stakes.deadlineIso).toBeNull()
    expect(stakes.tab).toBe('survivor')
  })

  it('after the merge everyone goes, and immunity is by name', () => {
    const stakes = survivorStakes(survivor({
      merged: true,
      challenges: [{ id: 'c', week: 4, challengeType: 'x', lockAt: null, resultJson: {}, winnerUserNames: ['Rich'] }],
      council: { id: 'k', week: 4, phase: 'voting_open', attendingTribeId: null, voteDeadlineAt: '2026-11-08T23:00:00.000Z', closedAt: null, eliminatedRosterId: null },
    }))!
    expect(label(stakes.lines, 'Immunity')).toBe('Rich')
    expect(label(stakes.lines, 'Tribal Council')).toBe('Everyone')
    expect(label(stakes.lines, 'Your tribe')).toBeUndefined()
  })

  it('the finale shows finalists and the jury count', () => {
    const stakes = survivorStakes(survivor({
      finale: { open: true, closed: false, finalists: [{ rosterId: 'r2' }, { rosterId: 'r3' }], juryVotesSubmitted: 3, juryVotesRequired: 7, winnerRosterId: null, crownedAt: null, myJuryVote: null, voteCount: null, bonusVotesByFinalist: null, tieBreakSeasonPoints: null },
    }))!
    expect(stakes.title).toBe('Finale')
    expect(label(stakes.lines, 'Finalists')).toBe('Rich, Sue')
    expect(label(stakes.lines, 'Jury votes')).toBe('3 of 7 in')
  })

  it('the phase label the hero used is unchanged', () => {
    expect(survivorPhase(null).label).toBe('…')
    expect(survivorPhase(survivor()).label).toBe('Tribe Phase · Week 4')
    expect(survivorPhase(survivor({ merged: true })).label).toBe('Merge · Week 4')
  })
})

function bb(over: Partial<BigBrotherSummary['cycle']> & { myStatus?: BigBrotherSummary['myStatus']; finalNomineeRosterIds?: string[]; ballotClosed?: boolean } = {}): BigBrotherSummary {
  const { myStatus = 'SAFE', finalNomineeRosterIds = [], ballotClosed = false, ...cycle } = over
  return {
    config: { sport: 'NFL', finaleFormat: 'x', juryStartMode: 'x' },
    cycle: {
      id: 'cy', week: 3, phase: 'NOMINATIONS_LOCKED', hohRosterId: 'r2', nominee1RosterId: 'r3', nominee2RosterId: 'r4',
      vetoWinnerRosterId: null, vetoParticipantRosterIds: null, vetoUsed: false, vetoSavedRosterId: null, replacementNomineeRosterId: null,
      evictedRosterId: null, voteDeadlineAt: null, voteOpenedAt: null, closedAt: null, ...cycle,
    },
    finalNomineeRosterIds,
    eligibility: null,
    jury: [],
    finalists: [],
    ballot: { canVote: true, voteDeadlineAt: cycle.voteDeadlineAt ?? null, closed: ballotClosed },
    myRosterId: 'r1',
    myStatus,
    remainingCount: 9,
    rosterDisplayNames: { r1: 'Me', r2: 'Hoh Person', r3: 'Nom One', r4: 'Nom Two', r5: 'Veto Kid' },
  } as BigBrotherSummary
}

describe('Big Brother stakes', () => {
  it('nothing before the first cycle', () => {
    expect(bigBrotherStakes({ ...bb(), cycle: null })).toBeNull()
  })

  it('HOH, the two on the block, veto not played, houseguests left', () => {
    const stakes = bigBrotherStakes(bb())!
    expect(stakes.title).toBe('Nominations')
    expect(label(stakes.lines, 'Head of Household')).toBe('Hoh Person')
    expect(label(stakes.lines, 'On the block')).toBe('Nom One & Nom Two')
    expect(label(stakes.lines, 'Power of Veto')).toBe('Not played yet')
    expect(label(stakes.lines, 'Houseguests left')).toBe('9')
    expect(stakes.deadlineIso).toBeNull()
  })

  it('after the veto the FINAL nominees are on the block, and the vote has a deadline', () => {
    const stakes = bigBrotherStakes(bb({ phase: 'VOTING_OPEN', vetoWinnerRosterId: 'r5', vetoUsed: true, voteDeadlineAt: '2026-11-09T01:00:00.000Z', finalNomineeRosterIds: ['r4', 'r1'], myStatus: 'NOMINATED' }))!
    expect(label(stakes.lines, 'On the block')).toBe('Nom Two & Me')
    expect(label(stakes.lines, 'Power of Veto')).toBe('Veto Kid (used)')
    expect(stakes.you?.tone).toBe('danger')
    expect(stakes.deadlineIso).toBe('2026-11-09T01:00:00.000Z')
    expect(stakes.tab).toBe('bb_voting')
  })

  it('a closed ballot has no deadline', () => {
    expect(bigBrotherStakes(bb({ voteDeadlineAt: '2026-11-09T01:00:00.000Z', ballotClosed: true }))!.deadlineIso).toBeNull()
  })

  it('the phase label the hero used is unchanged', () => {
    expect(bigBrotherPhaseLabel(null)).toBe('House')
    expect(bigBrotherPhaseLabel(bb({ phase: 'VETO_CHALLENGE_OPEN' }))).toBe('Veto')
    expect(bigBrotherPhaseLabel(bb({ phase: 'HOH_OPEN' }))).toBe('Head of Household')
  })
})

function guillotine(over: Partial<GuillotineSummaryLite> = {}): GuillotineSummaryLite {
  return {
    weekOrPeriod: 6,
    dangerTiers: [
      { rosterId: 'a', displayName: 'Low', tier: 'chop_zone', pointsFromChopZone: 0 },
      { rosterId: 'b', displayName: 'Next', tier: 'danger', pointsFromChopZone: 3.5 },
      { rosterId: 'c', displayName: 'Me', tier: 'danger', pointsFromChopZone: 7.25 },
      { rosterId: 'd', displayName: 'Top', tier: 'safe', pointsFromChopZone: 30 },
    ],
    survivalStandings: [{ rosterId: 'a' }, { rosterId: 'b' }, { rosterId: 'c' }, { rosterId: 'd' }],
    config: { teamsPerChop: 1, eliminationStartWeek: 2 },
    myRosterId: 'c',
    ...over,
  }
}

describe('Guillotine stakes', () => {
  it('nothing before there are danger tiers', () => {
    expect(guillotineStakes(guillotine({ dangerTiers: [] }))).toBeNull()
  })

  it('the chop line, who is just above it, and your margin', () => {
    const stakes = guillotineStakes(guillotine())!
    expect(stakes.title).toBe('Week 6 chop')
    expect(label(stakes.lines, 'Chop line')).toBe('Low')
    expect(label(stakes.lines, 'Just above it')).toBe('Next +3.5 · Me (you) +7.3')
    expect(label(stakes.lines, 'Teams left')).toBe('4')
    expect(stakes.you).toEqual({ text: "You're 7.3 pts clear of the chop line.", tone: 'neutral' })
  })

  it('two chops a week: both bottom teams are on the line, and the margin is to the second of them', () => {
    const stakes = guillotineStakes(guillotine({ config: { teamsPerChop: 2, eliminationStartWeek: 2 } }))!
    expect(label(stakes.lines, 'Chop line (2 go)')).toBe('Low, Next')
    expect(stakes.you?.text).toBe("You're 3.8 pts clear of the chop line.")
  })

  it('on the line is danger', () => {
    expect(guillotineStakes(guillotine({ myRosterId: 'a' }))!.you).toEqual({ text: "You're on the chop line right now.", tone: 'danger' })
  })

  it('before the first chop week the title says when chops start', () => {
    expect(guillotineStakes(guillotine({ weekOrPeriod: 1, config: { teamsPerChop: 1, eliminationStartWeek: 3 } }))!.title).toBe('Chops start week 3')
  })
})

describe('the card', () => {
  it('only specialty formats get one', () => {
    expect(stakesFormatFor({ leagueVariant: 'survivor' })).toBe('survivor')
    expect(stakesFormatFor({ leagueVariant: 'big_brother' })).toBe('big_brother')
    expect(stakesFormatFor({ guillotineMode: true })).toBe('guillotine')
    expect(stakesFormatFor({ leagueVariant: 'guillotine' })).toBe('guillotine')
    expect(stakesFormatFor({ leagueVariant: null })).toBeNull()
    expect(stakesEndpoint('L 1', 'guillotine')).toBe('/api/leagues/L%201/guillotine/summary')
  })

  it('fetches the format summary and opens the right tab', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => guillotine() }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const onSelectTab = vi.fn()
    render(<LeagueStakesCard leagueId="L1" format="guillotine" onSelectTab={onSelectTab} />)
    expect(await screen.findByTestId('league-stakes-title')).toHaveTextContent('Week 6 chop')
    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/L1/guillotine/summary', expect.anything())
    expect(screen.getByTestId('league-stakes-you')).toHaveTextContent('7.3 pts clear')
    fireEvent.click(screen.getByTestId('league-stakes-open'))
    expect(onSelectTab).toHaveBeenCalledWith('guillotine')
  })

  it('shows the vote deadline when there is one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => bb({ phase: 'VOTING_OPEN', voteDeadlineAt: '2026-11-09T01:00:00.000Z' }) }) as Response))
    render(<LeagueStakesCard leagueId="L1" format="big_brother" onSelectTab={vi.fn()} />)
    expect(await screen.findByTestId('league-stakes-deadline')).toHaveTextContent(/^Eviction vote closes /)
  })

  it('renders nothing before the season, or when the summary fails', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => survivor({ tribes: [] }) }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const first = render(<LeagueStakesCard leagueId="L1" format="survivor" onSelectTab={vi.fn()} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByTestId('league-stakes')).toBeNull()
    first.unmount()

    const failing = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Not a guillotine league' }) }) as Response)
    vi.stubGlobal('fetch', failing)
    render(<LeagueStakesCard leagueId="L1" format="guillotine" onSelectTab={vi.fn()} />)
    await waitFor(() => expect(failing).toHaveBeenCalled())
    expect(screen.queryByTestId('league-stakes')).toBeNull()
  })
})
