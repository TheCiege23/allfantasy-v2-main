import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SurvivorTribalCouncilView } from '@/components/survivor/SurvivorTribalCouncilView'
import type { SurvivorSummary } from '@/components/survivor/types'

function summary(isRevealed: boolean, myRosterId?: string): SurvivorSummary {
  return {
    config: { mode: 'survivor', tribeCount: 4, tribeSize: 5, mergeTrigger: 'week', mergeWeek: 8, mergePlayerCount: 10, juryStartAfterMerge: 1, exileReturnEnabled: true, exileReturnTokens: 4, voteDeadlineDayOfWeek: 2, voteDeadlineTimeUtc: '00:00', selfVoteDisallowed: true, seasonThemeLabel: 'Island League' },
    currentWeek: 5, tribes: [], challenges: [], jury: [], exileLeagueId: null, exileTokens: [], votedOutHistory: [], merged: false, myIdols: [], myRosterId,
    council: { id: 'c-1', week: 5, phase: 'pre_merge', attendingTribeId: 't-1', voteDeadlineAt: '2026-12-01T00:00:00Z', closedAt: '2026-12-01T00:00:00Z', eliminatedRosterId: 'secret-roster', isRevealed, revealSequence: [{ type: 'vote', voterName: 'Private voter', targetName: 'Secret manager' }] },
  }
}

describe('published Survivor share privacy', () => {
  it('hides the result, vote scroll and share action before the Torch Ceremony', () => {
    const { unmount } = render(<SurvivorTribalCouncilView leagueId="league-1" summary={summary(false)} names={{ 'secret-roster': 'Secret manager' }} />)
    expect(screen.getByText(/Chimmy will reveal the result/)).toBeTruthy()
    expect(screen.queryByText(/Share this published moment/)).toBeNull()
    expect(screen.queryByText(/Private voter/)).toBeNull()
    expect(screen.queryByText(/Eliminated: Secret manager/)).toBeNull()
    unmount()
  })

  it('never offers the out card to other managers, even after the reveal', () => {
    for (const viewer of [undefined, 'someone-else']) {
      const { unmount } = render(<SurvivorTribalCouncilView leagueId="league-1" summary={summary(true, viewer)} names={{ 'secret-roster': 'Secret manager' }} />)
      expect(screen.queryByText(/Make a share card/)).toBeNull()
      expect(screen.queryByText(/Share this published moment/)).toBeNull()
      expect(screen.queryByText(/Secret manager has left the island/)).toBeNull()
      unmount()
    }
  })

  it('offers the eliminated manager an opt-in card after the public result is released', () => {
    const { unmount } = render(<SurvivorTribalCouncilView leagueId="league-1" summary={summary(true, 'secret-roster')} names={{ 'secret-roster': 'Secret manager' }} />)
    expect(screen.queryByText(/Share this published moment/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Make a share card/ }))
    expect(screen.getByText(/Share this published moment/)).toBeTruthy()
    expect(screen.getByText(/Secret manager has left the island/)).toBeTruthy()
    unmount()
  })

  it('does not offer the out card to the eliminated manager before the reveal', () => {
    const { unmount } = render(<SurvivorTribalCouncilView leagueId="league-1" summary={summary(false, 'secret-roster')} names={{ 'secret-roster': 'Secret manager' }} />)
    expect(screen.queryByText(/Make a share card/)).toBeNull()
    unmount()
  })
})
