/**
 * The demo Chimmy page: a LIMIT becomes a sign-up / AF Pro card, a service FAILURE stays a plain
 * "try again", and a working answer earns a one-line AF Pro note.
 *
 * The split matters in both directions. Offering AF Pro on an outage implies paying fixes it, which
 * it does not; offering "Try again" on a limit sends the visitor into a wall for ten minutes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { DemoChimmy } from '@/components/demo-league/DemoChimmy'

const reply = (status: number, body: Record<string, unknown>) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

function ask() {
  render(<DemoChimmy />)
  fireEvent.click(screen.getByRole('button', { name: 'Who is the best team right now and why?' }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DemoChimmy limit card', () => {
  it.each([
    ['demo_limit', /opens up again in a few minutes/],
    ['daily_cap', /resets tomorrow/],
  ])('a %s 429 shows sign-up and AF Pro, and no Try again', async (code, when) => {
    const fetchMock = reply(429, { demo: true, error: 'You have reached the demo limit.', code })
    vi.stubGlobal('fetch', fetchMock)
    ask()
    const card = await screen.findByTestId('demo-chimmy-limit')
    expect(card.textContent).toMatch(when)
    expect(card.textContent).toContain('AF Pro includes 100 Chimmy answers a day')
    expect(screen.getByRole('link', { name: 'Sign up free' }).getAttribute('href')).toBe('/signup')
    expect(screen.getByRole('link', { name: 'See AF Pro' }).getAttribute('href')).toBe('/upgrade?plan=pro&from=demo-chimmy')
    expect(screen.queryByTestId('demo-chimmy-retry')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1) // a limit is not silently retried
  })

  it('an untagged 429 (some other limiter) is a plain error, not an upsell', async () => {
    vi.stubGlobal('fetch', reply(429, { error: 'Too many requests — try again in a minute.' }))
    ask()
    await screen.findByTestId('demo-chimmy-retry')
    expect(screen.queryByTestId('demo-chimmy-limit')).toBeNull()
  })

  it('a service failure offers Try again and never AF Pro', async () => {
    vi.stubGlobal('fetch', reply(503, { error: "Chimmy couldn't get an answer through just now.", code: 'chimmy_unavailable', retryable: false }))
    ask()
    await screen.findByTestId('demo-chimmy-retry')
    expect(screen.queryByTestId('demo-chimmy-limit')).toBeNull()
    expect(screen.queryByText(/AF Pro/)).toBeNull()
  })

  it('after a real answer, a one-line AF Pro note appears under the chat', async () => {
    vi.stubGlobal('fetch', reply(200, { demo: true, answer: 'Turbo Tacos — 791 PF, #1 in the league.', truncated: false }))
    ask()
    const note = await screen.findByTestId('demo-chimmy-pro-note')
    expect(note.textContent).toBe('Want deeper answers about your own league? AF Pro includes 100 Chimmy answers a day.')
    expect(screen.getByRole('link', { name: 'AF Pro' }).getAttribute('href')).toBe('/upgrade?plan=pro&from=demo-chimmy')
  })

  it('no note before anything has been answered', async () => {
    render(<DemoChimmy />)
    await waitFor(() => expect(screen.queryByTestId('demo-chimmy-pro-note')).toBeNull())
  })
})
