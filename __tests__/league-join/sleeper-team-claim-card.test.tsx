import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SleeperTeamClaim } from '@/components/league-join/SleeperTeamClaim'

/* Pick your team → get a code → put it in your Sleeper team name → verify. */

let posts: Array<Record<string, unknown>> = []
let verifyReply: { status: number; body: Record<string, unknown> } = { status: 200, body: { ok: true, leagueId: 'L1' } }

beforeEach(() => {
  posts = []
  verifyReply = { status: 200, body: { ok: true, leagueId: 'L1' } }
  globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    posts.push(body)
    if (body.action === 'sleeper_claim_teams') {
      return new Response(JSON.stringify({ teams: [{ externalId: '1', teamName: 'Hammer Time', ownerName: 'joe', avatarUrl: null }, { externalId: '3', teamName: 'Iron Horse', ownerName: 'kim', avatarUrl: null }] }))
    }
    if (body.action === 'sleeper_claim_start') return new Response(JSON.stringify({ ok: true, code: 'AF-7K2Q' }))
    return new Response(JSON.stringify(verifyReply.body), { status: verifyReply.status })
  }) as never
})

describe('SleeperTeamClaim', () => {
  it('walks pick → code → verify → claimed', async () => {
    const onClaimed = vi.fn()
    render(<SleeperTeamClaim leagueId="L1" onClaimed={onClaimed} />)
    fireEvent.click(await screen.findByRole('radio', { name: /Iron Horse/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Get my code' }))
    expect((await screen.findByTestId('sleeper-claim-code')).textContent).toBe('AF-7K2Q')
    expect(posts.find((p) => p.action === 'sleeper_claim_start')).toEqual({ action: 'sleeper_claim_start', leagueId: 'L1', teamExternalId: '3' })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await screen.findByTestId('sleeper-claim-done')
    expect(onClaimed).toHaveBeenCalledTimes(1)
  })

  it('says what Sleeper shows when the code is not in the name yet', async () => {
    verifyReply = { status: 409, body: { error: 'x', code: 'code_not_found', seenTeamName: 'Iron Horse' } }
    render(<SleeperTeamClaim leagueId="L1" />)
    fireEvent.click(await screen.findByRole('radio', { name: /Iron Horse/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Get my code' }))
    await screen.findByTestId('sleeper-claim-code')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect((await screen.findByRole('alert')).textContent).toContain('We see your Sleeper team name as “Iron Horse”. Add AF-7K2Q to it and save')
  })

  it('an expired code goes back to picking, with the reason shown', async () => {
    verifyReply = { status: 409, body: { error: 'That code expired. Get a new one.', code: 'no_code' } }
    render(<SleeperTeamClaim leagueId="L1" />)
    fireEvent.click(await screen.findByRole('radio', { name: /Hammer Time/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Get my code' }))
    await screen.findByTestId('sleeper-claim-code')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That code expired. Get a new one.')
    expect(screen.getByRole('button', { name: 'Get my code' })).toBeTruthy()
  })

  it('says so when every team is taken', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ teams: [] }))) as never
    render(<SleeperTeamClaim leagueId="L1" />)
    await screen.findByTestId('sleeper-claim-none')
  })
})
