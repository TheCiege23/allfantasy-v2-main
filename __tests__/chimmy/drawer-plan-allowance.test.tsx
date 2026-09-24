import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const consent = vi.hoisted(() => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('@/lib/tokens/client-confirm', () => consent)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

/**
 * AF Pro includes Chimmy, 100 answers a day. A subscriber must SEE that — before asking, instead of a
 * token price they will not pay, and under each answer as the count moves.
 */

const ALLOWANCE = { included: true, planName: 'AF Pro', used: 0, limit: 100, resetsAt: '2026-09-25T00:00:00.000Z' }

describe('Chimmy drawer — plan allowance', () => {
  beforeEach(() => {
    sessionStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) =>
        String(url) === '/api/chat/chimmy'
          ? {
              ok: true,
              status: 200,
              json: async () => ({
                response: 'Start Jayden Reed.',
                meta: { planAllowance: { ...ALLOWANCE, used: 37 } },
              }),
            }
          : { ok: true, status: 200, json: async () => ({}) },
      ),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  function open(allowance: typeof ALLOWANCE | null) {
    render(
      <CommsDrawer
        open
        onClose={vi.fn()}
        mode="overlay"
        leagues={[{ id: 'l0', name: 'KBFL', platform: 'sleeper' }] as never}
        pageLeagueId={null}
        chimmyTokenCost={10}
        chimmyPlanAllowance={allowance}
        initialTab="chimmy"
        userId="u1"
      />,
    )
  }

  it('tells a subscriber what is included instead of quoting a token price', () => {
    open(ALLOWANCE)
    expect(screen.getByText('Included with AF Pro: 100 of 100 Chimmy answers left today. After that, answers cost 10 tokens.')).toBeTruthy()
    expect(screen.queryByText(/may cost 10 tokens/)).toBeNull()
  })

  it('still quotes the price to everyone else', () => {
    open(null)
    expect(screen.getByText('Chimmy answers may cost 10 tokens. Free lookups and typing cost nothing.')).toBeTruthy()
  })

  it('marks an included answer and moves the count, with no consent prompt', async () => {
    open(ALLOWANCE)
    const box = screen.getByLabelText('Message') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'Set my best lineup' } })
    fireEvent.submit(box.closest('form') as HTMLFormElement)
    expect(await screen.findByText('Included with AF Pro · 37 of 100 today')).toBeTruthy()
    expect(screen.getByText('Included with AF Pro: 63 of 100 Chimmy answers left today. After that, answers cost 10 tokens.')).toBeTruthy()
    expect(consent.confirmTokenSpend).not.toHaveBeenCalled()
  })
})
