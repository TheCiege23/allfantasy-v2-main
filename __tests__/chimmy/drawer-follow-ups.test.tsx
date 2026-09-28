import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

/**
 * Follow-up chips under a Chimmy answer. The contract is the quick prompts': a tap FILLS the box and
 * spends nothing. Sending is a separate, deliberate act because every send can cost tokens.
 */

const chimmyCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url) === '/api/chat/chimmy')

describe('Chimmy follow-up chips', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
    fetchMock = vi.fn(async (url: unknown) => {
      if (String(url) === '/api/chat/chimmy') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            response: 'Start Jayden Reed over Tank Bigsby: +5.0 projected points.',
            meta: {
              followUps: ['How does my matchup look this week?', 'What are my playoff odds?', 42, ''],
              dataSources: ['optimize_my_lineup'],
            },
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  function ask(question: string) {
    render(
      <CommsDrawer
        open
        onClose={vi.fn()}
        mode="overlay"
        leagues={[{ id: 'l0', name: 'KBFL', platform: 'sleeper' }] as never}
        pageLeagueId={null}
        chimmyTokenCost={10}
        initialTab="chimmy"
        userId="u1"
      />,
    )
    const box = screen.getByLabelText('Message') as HTMLInputElement
    fireEvent.change(box, { target: { value: question } })
    fireEvent.submit(box.closest('form') as HTMLFormElement)
    return box
  }

  it('renders the server\'s follow-ups under the answer, dropping anything malformed', async () => {
    ask('Set my best lineup for this week')
    const group = await screen.findByRole('group', { name: 'Ask next' })
    const labels = Array.from(group.querySelectorAll('button')).map((b) => b.textContent)
    expect(labels).toEqual(['How does my matchup look this week?', 'What are my playoff odds?'])
  })

  it('fills the box on tap and sends nothing', async () => {
    const box = ask('Set my best lineup for this week')
    fireEvent.click(await screen.findByRole('button', { name: /What are my playoff odds\?/ }))
    expect(box.value).toBe('What are my playoff odds?')
    expect(chimmyCalls(fetchMock)).toHaveLength(1)
  })

  it('labels the new analyst tools as readable sources', async () => {
    ask('Set my best lineup for this week')
    await screen.findByRole('group', { name: 'Ask next' })
    fireEvent.click(await screen.findByRole('button', { name: 'What is this based on?' }))
    expect(await screen.findByText("Your best lineup, scored under your league's rules")).toBeTruthy()
  })
})
