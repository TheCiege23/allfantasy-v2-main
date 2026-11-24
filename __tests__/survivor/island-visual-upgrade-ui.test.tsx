/**
 * The island visual upgrade, rendered: the home page shows a short challenge list, an expired
 * challenge offers no answer box, Intel hides tiles a player can never open, and the ballot says
 * "votes are closed" instead of a 00:00:00 timer.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SurvivorChallengeBoardCard } from '@/components/survivor/SurvivorChallengeBoardCard'
import { SurvivorPremiumCommandCenterPanel } from '@/components/survivor/SurvivorPremiumCommandCenterPanel'
import { SURVIVOR_PREMIUM_COMMAND_TILES, resolveSurvivorPremiumTileAccess } from '@/lib/survivor/survivor-premium-access'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/survivor/L1', useParams: () => ({ leagueId: 'L1' }), useSearchParams: () => new URLSearchParams() }))

let routes: Record<string, unknown> = {}
beforeEach(() => {
  routes = {}
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    const key = Object.keys(routes).find((k) => url.includes(k))
    return new Response(JSON.stringify(key ? routes[key] : {}), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

const base = {
  week: 9, kind: 'game_total_closest', scope: 'individual', status: 'open', opensAt: '2026-11-01T14:00:00Z', inputKind: 'number',
  options: [], prizeText: '$5 FAAB', wager: null, uniqueAnswers: false, sealed: false, mine: null, answers: null, resultSummary: null, myResult: null,
}
const future = '2099-01-01T00:00:00Z'
const board = [
  { ...base, id: 'a', title: 'Open A', question: 'Q', locksAt: future },
  { ...base, id: 'b', title: 'Open B', question: 'Q', locksAt: future },
  { ...base, id: 'c', title: 'Open C', question: 'Q', locksAt: future },
  { ...base, id: 'd', title: 'Done D', question: 'Q', locksAt: '2026-11-01T18:00:00Z', status: 'complete', resultSummary: 'Settled.' },
]

describe('SurvivorChallengeBoardCard', () => {
  it('compact (the home page): at most two open challenges, no results, and a link to the rest', async () => {
    routes['challenge-board'] = { challenges: board }
    routes['/api/survivor/rewards'] = { rewards: [] }
    render(<SurvivorChallengeBoardCard leagueId="L1" compact allHref="/survivor/L1/challenges" />)
    expect(await screen.findByText('Open A')).toBeTruthy()
    expect(screen.getByText('Open B')).toBeTruthy()
    expect(screen.queryByText('Open C')).toBeNull()
    expect(screen.queryByText('Done D')).toBeNull()
    expect(screen.getByRole('link', { name: /See all 4 challenges/ }).getAttribute('href')).toBe('/survivor/L1/challenges')
  })

  it('compact shows nothing when every open challenge is past its lock time', async () => {
    routes['challenge-board'] = { challenges: [{ ...base, id: 'x', title: 'Missed it', question: 'Q', locksAt: '2026-11-02T01:00:00Z' }] }
    routes['/api/survivor/rewards'] = { rewards: [] }
    const { container } = render(<SurvivorChallengeBoardCard leagueId="L1" compact allHref="/survivor/L1/challenges" />)
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Missed it')).toBeNull()
    expect(container.querySelector('[data-testid="survivor-challenge-board"]')).toBeNull()
  })

  it('a challenge whose lock time has passed shows no answer box, even before the server marks it locked', async () => {
    routes['challenge-board'] = { challenges: [{ ...base, id: 'x', title: 'Missed it', question: 'Q', locksAt: '2026-11-02T01:00:00Z' }] }
    routes['/api/survivor/rewards'] = { rewards: [] }
    render(<SurvivorChallengeBoardCard leagueId="L1" />)
    expect(await screen.findByText('Missed it')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull()
    expect(screen.getByText(/Answers are locked/)).toBeTruthy()
  })
})

describe('SurvivorVoteCast past its deadline', () => {
  it('says the votes are in instead of a 00:00:00 timer', async () => {
    const { SurvivorVoteCast } = await import('@/components/survivor/weekly/SurvivorVoteCast')
    const view = {
      status: 'voting_open', week: 9, votingDeadline: '2026-11-10T01:00:00.000Z', votesIn: null,
      ballot: { candidates: [], selfVotesAllowed: false },
      you: { hasVoted: false, yourVoteTargetUserId: null, yourVoteTargetName: null, isEligibleVoter: true, isSafeFromVote: false, voteChangeAllowed: true, voteLocked: false, playableIdols: [] },
    }
    render(<SurvivorVoteCast leagueId="L1" backHref="/survivor/L1" initialView={view as never} />)
    expect(screen.getByRole('heading', { name: 'The votes are in' })).toBeTruthy()
    expect(screen.getByTestId('survivor-vote-closed').textContent).toMatch(/Voting has closed/)
    expect(document.body.textContent).not.toMatch(/00:00:00|closes in/)
  })
})

describe('SurvivorPremiumCommandCenterPanel on the player Intel page', () => {
  it('hides tiles only a commissioner can open, and drops the plan-name paragraph', async () => {
    routes['/survivor/premium'] = {
      ok: true,
      tiles: SURVIVOR_PREMIUM_COMMAND_TILES.map((tile) => ({ tileId: tile.tileId, access: resolveSurvivorPremiumTileAccess({ tileId: tile.tileId, plan: 'af_pro', isCommissioner: false }) })),
    }
    const hostOnly = SURVIVOR_PREMIUM_COMMAND_TILES.filter((tile) => {
      const a = resolveSurvivorPremiumTileAccess({ tileId: tile.tileId, plan: 'af_pro', isCommissioner: false })
      return a.ok === false && a.reason === 'commissioner_only'
    })
    expect(hostOnly.length).toBeGreaterThan(0)
    render(<SurvivorPremiumCommandCenterPanel leagueId="L1" tokensRemaining={null} tilesOnly />)
    await waitFor(() => expect(screen.queryByText('Commissioner only')).toBeNull())
    for (const tile of hostOnly) expect(screen.queryByTestId(`survivor-premium-tile-${tile.tileId}`)).toBeNull()
    expect(screen.queryByText(/AF Supreme/)).toBeNull()
  })
})
