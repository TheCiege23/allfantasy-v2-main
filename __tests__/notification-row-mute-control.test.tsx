import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import NotificationRowMute from '@/components/core-app/screens/NotificationRowMute'

/**
 * The row "Mute" control on /core/notifications (2026-09-14).
 *
 * 🛑 THE CASE THAT MATTERS MOST IS THE FAILED READ. The edit is built on the league's
 * stored entry; building it on nothing would replace that league's existing mutes. So a
 * profile read that fails must write NOTHING.
 */

type Call = { url: string; method: string; body: unknown }
let calls: Call[]
let getResponse: () => Response | Promise<Response>
let patchOk: boolean

beforeEach(() => {
  calls = []
  patchOk = true
  getResponse = () =>
    new Response(
      JSON.stringify({
        notificationPreferences: {
          leagues: { L1: { mutedCategories: ['chat_mentions'] }, L2: { enabled: false } },
          quietHours: { startHour: 22, endHour: 7, enabled: true },
        },
      }),
      { status: 200 },
    )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (method === 'GET') return getResponse()
      return new Response('{}', { status: patchOk ? 200 : 500 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const patches = () => calls.filter((c) => c.method === 'PATCH')

describe('NotificationRowMute', () => {
  it('offers the alert type only when the row knows it', () => {
    const { rerender } = render(<NotificationRowMute leagueId="L1" leagueName="Dynasty" category="trade_proposals" />)
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(screen.getByRole('menuitem', { name: /Trade proposals from Dynasty/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Everything from Dynasty/ })).toBeTruthy()

    rerender(<NotificationRowMute leagueId="L1" leagueName="Dynasty" category={null} />)
    expect(screen.queryByRole('menuitem', { name: /Trade proposals/ })).toBeNull()
  })

  it('🛑 mutes the league with a one-league patch built on what is stored, and Undo restores it', async () => {
    render(<NotificationRowMute leagueId="L1" leagueName="Dynasty" category="trade_proposals" />)
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Everything from Dynasty/ }))

    await screen.findByText('Muted')
    expect(patches()).toHaveLength(1)
    expect(patches()[0].body).toEqual({
      notificationPreferences: { leagues: { L1: { mutedCategories: ['chat_mentions'], enabled: false } } },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(patches()).toHaveLength(2))
    expect(patches()[1].body).toEqual({
      notificationPreferences: { leagues: { L1: { mutedCategories: ['chat_mentions'] } } },
    })
    await screen.findByRole('button', { name: 'Mute' })
  })

  it('mutes one alert type, keeping the league’s other mutes', async () => {
    render(<NotificationRowMute leagueId="L1" leagueName="Dynasty" category="trade_proposals" />)
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Trade proposals from Dynasty/ }))

    await screen.findByText('Muted')
    const body = patches()[0].body as { notificationPreferences: { leagues: Record<string, { mutedCategories: string[] }> } }
    expect(Object.keys(body.notificationPreferences.leagues)).toEqual(['L1'])
    expect(body.notificationPreferences.leagues.L1.mutedCategories.sort()).toEqual(['chat_mentions', 'trade_proposals'])
  })

  it('🛑 writes NOTHING when the stored settings cannot be read', async () => {
    getResponse = () => new Response('nope', { status: 500 })
    render(<NotificationRowMute leagueId="L1" leagueName="Dynasty" category="trade_proposals" />)
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Everything from Dynasty/ }))

    await screen.findByRole('button', { name: /Not saved/ })
    expect(patches()).toHaveLength(0)
  })

  it('says so when the save itself fails, rather than claiming Muted', async () => {
    patchOk = false
    render(<NotificationRowMute leagueId="L1" leagueName="Dynasty" category="trade_proposals" />)
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Everything from Dynasty/ }))

    await screen.findByRole('button', { name: /Not saved/ })
    expect(screen.queryByText('Muted')).toBeNull()
  })
})
