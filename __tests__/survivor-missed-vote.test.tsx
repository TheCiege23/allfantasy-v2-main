// @vitest-environment jsdom
/**
 * survivor-core §7 "Your vote wasn't cast", owner rule on #2484: an uncast vote simply doesn't
 * count. The card shows on the tribal page only to the manager who was eligible and did not vote,
 * and only once the council read has started. Never before the reveal, never to voters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ council: null as Record<string, unknown> | null }))
vi.mock('next/navigation', () => ({ useParams: () => ({ leagueId: 'L1' }) }))
vi.mock('@/lib/survivor/SurvivorUiContext', () => ({
  useSurvivorUi: () => ({ season: { activeCouncil: h.council, tribes: [], players: [], exileEnabled: true }, currentWeek: 6, refetch: vi.fn() }),
}))
vi.mock('@/components/league/survivor/SurvivorVoteRevealScrolls', () => ({ SurvivorVoteRevealScrolls: () => <div data-testid="scroll" /> }))
vi.mock('@/components/survivor/weekly/SurvivorWeeklyMoments', () => ({ SurvivorWeeklyMoments: () => null }))

import SurvivorTribalPage from '@/app/survivor/[leagueId]/tribal/page'
import { shouldShowMissedVote } from '@/components/survivor/core/SurvivorMissedVoteNotice'
import { SURVIVOR_STATES } from '@/components/survivor/core/SurvivorStateCard'

function view(over: { isRevealed?: boolean; isEligibleVoter?: boolean; hasVoted?: boolean; councilId?: string } = {}) {
  return { councilId: over.councilId ?? 'c6', isRevealed: over.isRevealed ?? true, you: { isEligibleVoter: over.isEligibleVoter ?? true, hasVoted: over.hasVoted ?? false } }
}

function serve(tribalCouncil: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tribalCouncil }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => { h.council = { id: 'c6', week: 6, status: 'revealed', isRevealed: true, revealSequence: [], attendingTribeId: null } })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('shouldShowMissedVote', () => {
  it('is true only for an eligible non-voter after the read starts', () => {
    expect(shouldShowMissedVote(view() as never)).toBe(true)
    expect(shouldShowMissedVote(view({ isRevealed: false }) as never)).toBe(false)
    expect(shouldShowMissedVote(view({ hasVoted: true }) as never)).toBe(false)
    expect(shouldShowMissedVote(view({ isEligibleVoter: false }) as never)).toBe(false)
    expect(shouldShowMissedVote(null)).toBe(false)
  })

  it('states the implemented rule: the vote just does not count, nothing else', () => {
    expect(SURVIVOR_STATES.missed_vote.body).toContain('no vote this week')
    expect(SURVIVOR_STATES.missed_vote.body).toContain('Nothing else counts against you')
    expect(SURVIVOR_STATES.missed_vote.body).not.toMatch(/self-vote|penalt|voted for you/i)
  })
})

describe('tribal page', () => {
  it('shows the card to a non-voter after the reveal', async () => {
    serve(view())
    render(<SurvivorTribalPage />)
    await waitFor(() => expect(screen.getByTestId('survivor-state-missed_vote')).toBeTruthy())
    expect(screen.getByRole('link', { name: 'Notification settings' }).getAttribute('href')).toBe('/settings?tab=notifications')
  })

  it('never shows it to a voter', async () => {
    const fetchMock = serve(view({ hasVoted: true }))
    render(<SurvivorTribalPage />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 30))
    expect(screen.queryByTestId('survivor-state-missed_vote')).toBeNull()
  })

  it('never shows it before the reveal, and does not even ask', async () => {
    h.council = { id: 'c6', week: 6, status: 'voting_closed', isRevealed: false, revealSequence: [], attendingTribeId: null }
    const fetchMock = serve(view({ isRevealed: true }))
    render(<SurvivorTribalPage />)
    await new Promise(r => setTimeout(r, 30))
    expect(screen.queryByTestId('survivor-state-missed_vote')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores a view for a different council', async () => {
    serve(view({ councilId: 'c7' }))
    render(<SurvivorTribalPage />)
    await new Promise(r => setTimeout(r, 30))
    expect(screen.queryByTestId('survivor-state-missed_vote')).toBeNull()
  })
})
