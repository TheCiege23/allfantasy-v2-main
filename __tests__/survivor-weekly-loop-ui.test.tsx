// @vitest-environment jsdom
/**
 * Weekly-loop handoff UI: the vote screen writes the name, drops it through the existing private
 * vote command (the same one @Chimmy uses), shows a count only, and the torch-out plays once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

import { SurvivorVoteCast } from '@/components/survivor/weekly/SurvivorVoteCast'
import { SurvivorWeeklyMoments } from '@/components/survivor/weekly/SurvivorWeeklyMoments'
import { SurvivorAvatar, SurvivorOutChip } from '@/components/survivor/weekly/SurvivorAvatar'

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: on, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: on && query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
}

function view(overrides: Record<string, unknown> = {}) {
  return {
    active: true, councilId: 'c6', status: 'voting_open', phase: 'pre_merge', week: 6, attendingTribeId: 'vela',
    votingOpensAt: null, votingDeadline: new Date(Date.now() + 100_000_000).toISOString(), isRevealed: false,
    you: {
      isEligibleVoter: true, hasVoted: false, yourVoteTargetUserId: null, yourVoteTargetName: null, voteLocked: false,
      voteLate: false, voteDoesNotCount: false, eligibleTargets: [], isSafeFromVote: false, voteChangeAllowed: true,
      playableIdols: [{ idolId: 'i1', powerType: 'vote_shield', label: 'Immunity idol', alreadyPlayed: false }],
    },
    ballot: {
      selfVotesAllowed: false,
      candidates: [
        { userId: 'u8', rosterId: 'r8', displayName: 'Open Team 8', weekScore: 96.2, isSelf: false, isImmune: false, canReceiveYourVote: true },
        { userId: 'u4', rosterId: 'r4', displayName: 'Open Team 4', weekScore: 104.8, isSelf: false, isImmune: false, canReceiveYourVote: true },
        { userId: 'u5', rosterId: 'r5', displayName: 'Open Team 5', weekScore: 142.6, isSelf: false, isImmune: true, canReceiveYourVote: false },
        { userId: 'me', rosterId: 'rme', displayName: 'TheCiege26', weekScore: 118, isSelf: true, isImmune: false, canReceiveYourVote: false },
      ],
    },
    votesIn: { submittedCount: 2, eligibleVoterCount: 4 },
    host: null, revote: null, reveal: null,
    ...overrides,
  } as never
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('SurvivorVoteCast', () => {
  beforeEach(() => reducedMotion(true))

  it('disables yourself and the immune manager, and shows the count only', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<SurvivorVoteCast leagueId="L1" tribeName="Vela" backHref="/survivor/L1" idolHref="/league/L1?tab=survivor" initialView={view()} />)
    const picks = screen.getAllByTestId('survivor-vote-pick')
    expect(picks.map(p => (p as HTMLButtonElement).disabled)).toEqual([false, false, true, true])
    expect(screen.getAllByText('Immune this week').some(el => el.classList.contains('swl-pick-sub'))).toBe(true)
    expect(screen.getByText('That’s you')).toBeTruthy()
    expect(screen.getByText(/You can’t vote for yourself\. Open Team 5 won immunity this week/)).toBeTruthy()
    expect(screen.getByTestId('survivor-votes-in').textContent).toContain('2 of 4 managers have voted. Who voted for whom stays sealed.')
    expect(screen.getByText('Tribal Council · Week 6 · Tribe Vela')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Play idol ›' }).getAttribute('href')).toBe('/league/L1?tab=survivor')
    expect((screen.getAllByTestId('survivor-vote-drop')[0] as HTMLButtonElement).disabled).toBe(true)
  })

  it('writes the chosen name, drops it through the @Chimmy ballot command, then offers a change', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return new Response(JSON.stringify({ ok: true }), { status: 200 })
      return new Response(JSON.stringify({ tribalCouncil: view({ votesIn: { submittedCount: 3, eligibleVoterCount: 4 } }) }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SurvivorVoteCast leagueId="L1" tribeName="Vela" backHref="/survivor/L1" initialView={view()} />)
    fireEvent.click(screen.getAllByTestId('survivor-vote-pick')[0])
    expect(screen.getByTestId('survivor-vote-ink').textContent).toBe('Open Team 8')
    fireEvent.click(screen.getAllByTestId('survivor-vote-drop')[0])
    await waitFor(() => expect(screen.getByTestId('survivor-vote-confirm').textContent).toContain('Your vote is in the urn'))
    const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!
    expect(post[0]).toBe('/api/leagues/L1/survivor/submit-vote')
    expect(JSON.parse(String(post[1]!.body))).toEqual({ action: 'submit-vote', message: '@Chimmy <@u8>' })
    await waitFor(() => expect(screen.getByTestId('survivor-votes-in').textContent).toContain('3 of 4'))
    fireEvent.click(screen.getAllByTestId('survivor-vote-change')[0])
    expect((screen.getAllByTestId('survivor-vote-pick')[1] as HTMLButtonElement).disabled).toBe(false)
  })

  it('surfaces a rejected ballot and stays on the ballot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'The vote window is closed.' }), { status: 409 })))
    render(<SurvivorVoteCast leagueId="L1" backHref="/survivor/L1" initialView={view()} />)
    fireEvent.click(screen.getAllByTestId('survivor-vote-pick')[1])
    fireEvent.click(screen.getAllByTestId('survivor-vote-drop')[0])
    expect((await screen.findByRole('alert')).textContent).toBe('The vote window is closed.')
    expect(screen.queryByTestId('survivor-vote-confirm')).toBeNull()
  })

  it('hides Change my vote when the league locks the first vote', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<SurvivorVoteCast leagueId="L1" backHref="/survivor/L1" initialView={view({ you: { ...(view() as { you: object }).you, hasVoted: true, yourVoteTargetUserId: 'u8', yourVoteTargetName: 'Open Team 8', voteChangeAllowed: false, voteLocked: true } })} />)
    expect(screen.getByTestId('survivor-vote-confirm')).toBeTruthy()
    expect(screen.queryByTestId('survivor-vote-change')).toBeNull()
  })
})

describe('SurvivorWeeklyMoments', () => {
  it('plays the torch-out once and records it as seen; shows the immunity win', async () => {
    reducedMotion(true)
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return new Response(JSON.stringify({ ok: true }), { status: 200 })
      return new Response(JSON.stringify({
        torchOut: { key: 'torch:c6', councilId: 'c6', week: 6, userId: 'u8', rosterId: 'r8', name: 'Open Team 8', isYou: false, exileEnabled: true, seen: false },
        immunity: [{ key: 'immunity:6:vela', week: 6, tribeId: 'vela', tribeName: 'Vela', userId: 'u5', rosterId: 'r5', name: 'Open Team 5', score: 142.6, isYou: false, seen: true }],
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SurvivorWeeklyMoments leagueId="L1" exileHref="/survivor/L1/exile" />)
    expect((await screen.findByTestId('survivor-torch-out')).textContent).toContain('Open Team 8, your torch is out')
    expect(screen.getByTestId('survivor-immunity-win').textContent).toContain('Open Team 5 wins immunity')
    expect(screen.getByTestId('survivor-immunity-win').textContent).toContain('Top score in Tribe Vela with 142.6 points. Safe at Tribal Council and can’t receive votes this week.')
    expect(screen.getByTestId('survivor-torch-exile').getAttribute('href')).toBe('/survivor/L1/exile')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leagues/L1/survivor/moments', expect.objectContaining({ method: 'POST', body: JSON.stringify({ key: 'torch:c6' }) })))
  })

  it('does not replay a torch-out the user has already seen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      torchOut: { key: 'torch:c6', councilId: 'c6', week: 6, userId: 'u8', rosterId: 'r8', name: 'Open Team 8', isYou: false, exileEnabled: false, seen: true },
      immunity: [],
    }), { status: 200 })))
    const { container } = render(<SurvivorWeeklyMoments leagueId="L1" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="survivor-torch-out"]')).toBeNull()
  })
})

describe('SurvivorAvatar', () => {
  it('immune gets the necklace badge; out gets the snuffed torch and the Out chip', () => {
    const { container } = render(<><SurvivorAvatar name="Open Team 5" status="immune" /><SurvivorAvatar name="Open Team 8" status="out" /><SurvivorOutChip week={6} /></>)
    const avatars = container.querySelectorAll('.swl-av')
    expect(avatars[0].getAttribute('data-status')).toBe('immune')
    expect(avatars[0].querySelector('img')?.getAttribute('src')).toBe('/survivor/weekly/immunity-necklace-icon.svg')
    expect(avatars[0].textContent).toContain('O5')
    expect(avatars[1].querySelector('img')?.getAttribute('src')).toBe('/survivor/weekly/torch-out-icon.svg')
    expect(screen.getByTestId('survivor-out-chip').textContent).toBe('Out · Wk 6')
  })
})
