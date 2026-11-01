/**
 * Challenge builder UI: the manager's Camp card (answer once, your answer, results, "My rewards"
 * with the tribemate / steal choice) and the commissioner's builder panel (the form validates with
 * the server's own rules before it can save; settle previews before it pays).
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SurvivorChallengeBoardCard } from '@/components/survivor/SurvivorChallengeBoardCard'
import { SurvivorChallengeBuilderPanel } from '@/components/survivor/SurvivorChallengeBuilderPanel'

type Call = { url: string; body: Record<string, unknown> | null }
let calls: Call[] = []
let routes: Record<string, unknown> = {}

function mockFetch() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, body })
    const key = Object.keys(routes).find((k) => url.includes(k) && (!body || !k.startsWith('GET ')))
    const payload = body?.action ? routes[`POST ${body.action}`] ?? { ok: true } : key ? routes[key] : {}
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}

const openChallenge = {
  id: 'c1', week: 9, title: 'SNF total', question: 'Guess the combined score.', kind: 'game_total_closest', scope: 'tribe', status: 'open',
  opensAt: '2026-11-01T14:00:00Z', locksAt: '2026-11-02T01:00:00Z', inputKind: 'number', options: [], prizeText: '$20 FAAB per player',
  wager: null, uniqueAnswers: true, sealed: false, mine: null, answers: null, resultSummary: null, myResult: null,
}

beforeEach(() => { routes = {}; mockFetch() })
afterEach(() => { vi.unstubAllGlobals() })

describe('SurvivorChallengeBoardCard', () => {
  it('shows an open challenge and submits one answer', async () => {
    routes['challenge-board'] = { challenges: [openChallenge] }
    routes['/api/survivor/rewards'] = { rewards: [] }
    render(<SurvivorChallengeBoardCard leagueId="L1" />)
    expect(await screen.findByText('SNF total')).toBeTruthy()
    expect(screen.getByText(/the first answer from your tribe counts for everyone/)).toBeTruthy()
    expect(screen.getByText('No two entries may give the same answer.')).toBeTruthy()
    const submit = screen.getByRole('button', { name: 'Submit — no take backs' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Your number'), { target: { value: '47' } })
    fireEvent.click(submit)
    await waitFor(() => expect(calls.some((c) => c.url.includes('challenge-board') && c.body?.challengeId === 'c1')).toBe(true))
    expect(calls.find((c) => c.body?.challengeId === 'c1')!.body).toEqual({ leagueId: 'L1', challengeId: 'c1', answer: { value: 47 } })
  })

  it('shows the tribe’s answer, results, and the reward choice', async () => {
    routes['challenge-board'] = { challenges: [
      { ...openChallenge, mine: { answer: { value: 44 }, wager: null, byMe: false } },
      { ...openChallenge, id: 'c2', title: 'MNF winner', status: 'complete', resultSummary: '🏆 MNF winner: settled.', myResult: 'won', answers: [{ name: 'Koa', answer: 'Chiefs' }] },
    ] }
    routes['/api/survivor/rewards'] = { rewards: [{ rewardId: 'rw1', status: 'awaiting_choice', holder: true, text: '100 points to place on a tribemate (week 9) — waiting for your choice', targets: [{ rosterId: 'r2', name: 'Ben' }] }] }
    render(<SurvivorChallengeBoardCard leagueId="L1" />)
    expect(await screen.findByTestId('challenge-mine')).toBeTruthy()
    expect(screen.getByTestId('challenge-mine').textContent).toMatch(/Your tribe’s answer: 44/)
    expect(screen.getByTestId('challenge-my-result').textContent).toBe('You won')
    fireEvent.change(screen.getByLabelText('Choose who'), { target: { value: 'r2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/survivor/rewards' && c.body?.targetRosterId === 'r2')).toBe(true))
  })
})

describe('SurvivorChallengeBuilderPanel', () => {
  const meta = { currentWeek: 9, season: 2026, sport: 'NFL', merged: false, lang: 'en', faabWeeklyCap: 40 }
  it('blocks saving until the draft is valid, then creates it', async () => {
    routes['type=challenges'] = { challenges: [], meta }
    routes['type=challenge_games'] = { games: [] }
    render(<SurvivorChallengeBuilderPanel leagueId="L1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'New challenge' }))
    expect(screen.getByTestId('challenge-builder-error').textContent).toMatch(/title/)
    const save = screen.getByRole('button', { name: 'Save challenge' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Your number' } })
    fireEvent.change(screen.getByLabelText('Question or instructions'), { target: { value: 'Pick a number.' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'custom_number' } })
    await waitFor(() => expect(screen.queryByTestId('challenge-builder-error')).toBeNull())
    fireEvent.click(save)
    await waitFor(() => expect(calls.some((c) => c.body?.action === 'challenge_create')).toBe(true))
    expect(calls.find((c) => c.body?.action === 'challenge_create')!.body!.challenge).toMatchObject({ title: 'Your number', kind: 'custom_number', scope: 'individual' })
  })

  it('settle shows a preview first, and only the confirm pays', async () => {
    routes['type=challenges'] = { meta, challenges: [{ id: 'c9', week: 9, title: 'Custom', status: 'locked', answers: 2, entrants: [], resultSummary: null, autoSource: 'manual',
      config: { builder: 1, kind: 'custom_choice', scope: 'individual', question: 'Q', options: [{ id: 'o1', label: 'A' }, { id: 'o2', label: 'B' }], game: null, player: null, line: null, prizes: [], deferWeeks: 0, missPenalty: null, wager: null, uniqueAnswers: false, sealed: false, allOverRule: 'closest_overall', opensAt: '2026-11-01T14:00:00Z', locksAt: '2026-11-01T20:00:00Z' } }] }
    routes['POST challenge_settle_preview'] = { ok: true, pending: null, preview: { truthLabel: 'A', voided: false, places: [{ place: 1, names: ['Ana'] }], payouts: [{ name: 'Ana', text: '+20 points', reason: 'prize' }] } }
    render(<SurvivorChallengeBuilderPanel leagueId="L1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settle' }))
    fireEvent.change(screen.getByLabelText('True answer'), { target: { value: 'o1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview result' }))
    expect(await screen.findByTestId('challenge-settle-preview')).toBeTruthy()
    expect(calls.some((c) => c.body?.action === 'challenge_settle')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and pay' }))
    await waitFor(() => expect(calls.some((c) => c.body?.action === 'challenge_settle')).toBe(true))
    expect(calls.find((c) => c.body?.action === 'challenge_settle')!.body).toMatchObject({ challengeId: 'c9', confirm: true, manual: { truth: { optionId: 'o1' } } })
  })
})
