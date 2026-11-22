/**
 * 🛑 THE BALLOT MUST LOAD UNDER STRICT MODE.
 *
 * SurvivorVoteCast guarded every `setView` on a `mounted` ref that only an effect CLEANUP touched:
 * `useRef(true)` + `useEffect(() => () => { mounted.current = false }, [])`. Strict Mode (on in this app's
 * development builds) mounts, cleans up and mounts again with the ref kept — so the flag stayed false and
 * every /survivor/state response was thrown away: the ballot sat on its loading skeleton forever with a
 * 200 in hand and no error (2026-11-07). React re-runs effects the same way for a hidden-then-shown
 * subtree, so this is not only a development problem. Rendering inside <StrictMode> reproduces it.
 */
import React, { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/survivor/L1/tribal',
  useSearchParams: () => new URLSearchParams(),
}))

import { SurvivorVoteCast } from '@/components/survivor/weekly/SurvivorVoteCast'

const TRIBAL = {
  active: true, councilId: 'c9', status: 'voting_open', phase: 'voting', week: 9, attendingTribeId: 't1',
  votingOpensAt: null, votingDeadline: '2099-01-01T00:00:00.000Z', ballotsDueAt: null, isRevealed: false,
  you: {
    isEligibleVoter: true, hasVoted: false, yourVoteTargetUserId: null, yourVoteTargetName: null, voteLocked: false, voteLate: false,
    voteDoesNotCount: false, eligibleTargets: [{ userId: 'u2', displayName: 'Morgan' }], playableIdols: [], additionalVotes: [],
    isSafeFromVote: false, voteChangeAllowed: true,
  },
  ballot: { selfVotesAllowed: false, candidates: [
    { userId: 'u1', rosterId: 'r1', displayName: 'Ciege', weekScore: 101.4, isSelf: true, isImmune: false, canReceiveYourVote: false },
    { userId: 'u2', rosterId: 'r2', displayName: 'Morgan', weekScore: 118.2, isSelf: false, isImmune: false, canReceiveYourVote: true },
  ] },
  votesIn: { submittedCount: 1, eligibleVoterCount: 2 }, host: null, revote: null, reveal: null,
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Survivor ballot', () => {
  it('shows the ballot once /survivor/state answers, even under Strict Mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ tribalCouncil: TRIBAL }) })))
    const { container } = render(
      <StrictMode>
        <SurvivorVoteCast leagueId="L1" tribeName="Tala" backHref="/survivor/L1" idolHref="/league/L1" />
      </StrictMode>,
    )
    await waitFor(() => expect(container.textContent).toContain('Morgan'), { timeout: 4000 })
    expect(container.querySelector('[role=status][aria-label="Loading your ballot"]')).toBeNull()
  })

  it('still shows its error card, with Try again, when the read fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'nope' }) })))
    const { container } = render(
      <StrictMode>
        <SurvivorVoteCast leagueId="L1" tribeName="Tala" backHref="/survivor/L1" idolHref="/league/L1" />
      </StrictMode>,
    )
    await waitFor(() => expect(container.querySelector('[data-testid=survivor-state-ballot_error]')).not.toBeNull(), { timeout: 4000 })
  })
})
