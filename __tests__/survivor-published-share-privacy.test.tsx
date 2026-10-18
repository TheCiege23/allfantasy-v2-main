import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  afterEach(() => { vi.unstubAllGlobals() })

  it('hides the result, vote scroll and share action before the Torch Ceremony', () => {
    const { unmount } = render(<SurvivorTribalCouncilView leagueId="league-1" summary={summary(false)} names={{ 'secret-roster': 'Secret manager' }} />)
    expect(screen.getByText(/Chimmy will reveal the result/)).toBeTruthy()
    expect(screen.queryByText(/Make a share card/)).toBeNull()
    expect(screen.queryByText(/Private voter/)).toBeNull()
    expect(screen.queryByText(/Eliminated: Secret manager/)).toBeNull()
    unmount()
  })

  it('never offers the out card to other managers, even after the reveal', () => {
    for (const viewer of [undefined, 'someone-else']) {
      const { unmount } = render(<SurvivorTribalCouncilView leagueId="league-1" summary={summary(true, viewer)} names={{ 'secret-roster': 'Secret manager' }} />)
      expect(screen.queryByText(/Make a share card/)).toBeNull()
      expect(screen.queryByText(/Share your exit/)).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
      unmount()
    }
  })

  it('offers the eliminated manager an opt-in card after the public result is released', async () => {
    const outMoment = {
      id: 'm-out', type: 'out', week: 5, title: 'Voted out', subtitle: 'Week 5', iconPath: '/survivor/weekly/torch-out-icon.svg',
      headline: 'Secret manager’s torch is out', offeredNote: '', published: false, pageUrl: 'https://www.allfantasy.ai/l/league-1/moment/m-out',
      imageUrl: { post: '/api/share/survivor/m-out?f=post', story: '/api/share/survivor/m-out?f=story', link: '/api/share/survivor/m-out?f=link' }, isSubject: true,
    }
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(String(url).startsWith('/api/share/survivor?') ? { enabled: true, moments: [outMoment] } : {}), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = render(<SurvivorTribalCouncilView leagueId="league-1" summary={summary(true, 'secret-roster')} names={{ 'secret-roster': 'Secret manager' }} />)
    // Nothing is fetched or shown until the manager opts in.
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/share/survivor'))).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Make a share card/ }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith('/api/share/survivor?leagueId=league-1', expect.anything())
    expect(screen.getByRole('img', { name: /Voted out card/ }).getAttribute('src')).toBe('/api/share/survivor/m-out?f=post')
    // The share UI itself never carries ballot data.
    expect(within(screen.getByRole('dialog')).queryByText(/Private voter/)).toBeNull()
    unmount()
  })

  it('does not offer the out card to the eliminated manager before the reveal', () => {
    const { unmount } = render(<SurvivorTribalCouncilView leagueId="league-1" summary={summary(false, 'secret-roster')} names={{ 'secret-roster': 'Secret manager' }} />)
    expect(screen.queryByText(/Make a share card/)).toBeNull()
    unmount()
  })
})
