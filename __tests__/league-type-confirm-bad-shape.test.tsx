import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LeagueTypeConfirm from '@/components/league/LeagueTypeConfirm'

/*
 * A 200 whose body is not the league-type shape must hide the card, not crash the page around it.
 *
 * It used to store the body first and read `suggestion` second, so a body without `suggestion`
 * reached render and threw on `state.suggestion.suggested` — found on the import done screen,
 * which mounts this card.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function stub(body: unknown) {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('LeagueTypeConfirm — unexpected response shapes', () => {
  it.each([
    ['an empty object', {}],
    ['a different payload', { auths: [] }],
    ['a suggestion with no reasons', { suggestion: { suggested: 'dynasty' } }],
    ['null', null],
  ])('renders nothing for %s', async (_label, body) => {
    const fetchMock = stub(body)
    const errors: unknown[] = []
    const onError = (e: ErrorEvent) => errors.push(e.error)
    window.addEventListener('error', onError)
    const { container } = render(<LeagueTypeConfirm leagueId="L1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    window.removeEventListener('error', onError)
    expect(errors).toEqual([])
    expect(container.innerHTML).toBe('')
  })

  it('still renders for a well-formed response', async () => {
    stub({
      leagueId: 'L1',
      leagueName: 'Seven Seas',
      storedType: null,
      suggestion: { suggested: 'dynasty', confidence: 'high', reasons: ['Taxi squad'], detectedBuyIn: null, looksNonCompetitive: false },
      confirmation: null,
      rankableType: null,
      canConfirm: true,
    })
    const { container } = render(<LeagueTypeConfirm leagueId="L1" />)
    await waitFor(() => expect(container.innerHTML).not.toBe(''))
  })
})
