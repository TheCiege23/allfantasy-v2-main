import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

/** The Settings lock sub-page. `fetch` is the only seam. */

import { SettingsLockPanel } from '@/components/league-settings/home/SettingsLockPanel'

const groups = (locked: string[], unlocked: Record<string, string> = {}) =>
  ['scoring', 'rosters', 'keepers', 'trades', 'waivers', 'playoffs'].map((g) => ({ group: g, locked: locked.includes(g), unlockedUntil: unlocked[g] ?? null }))

let view: Record<string, unknown>
let calls: Array<{ method: string; body: unknown }>

beforeEach(() => {
  calls = []
  view = { season: 2026, seasonUnderway: true, canEdit: true, groups: groups(['scoring', 'trades']), votes: [] }
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') calls.push({ method, body: JSON.parse(String(init?.body)) })
    return { ok: true, status: 200, json: async () => (method === 'GET' ? view : { ok: true }) }
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const box = (r: ReturnType<typeof render>, area: string) => r.getByLabelText(`Lock ${area} for the season`) as HTMLInputElement

describe('SettingsLockPanel', () => {
  it('mid-season: locked areas cannot be unticked, open ones can be locked, and each locked area offers a vote', async () => {
    const r = render(<SettingsLockPanel leagueId="L" />)
    await waitFor(() => expect(box(r, 'scoring').checked).toBe(true))
    expect(box(r, 'scoring').disabled).toBe(true)
    expect(box(r, 'waivers').disabled).toBe(false)
    expect(r.getAllByRole('button', { name: 'Ask the league to unlock' })).toHaveLength(2)
    fireEvent.click(box(r, 'waivers'))
    await waitFor(() => expect(calls).toEqual([{ method: 'PUT', body: { groups: ['scoring', 'trades', 'waivers'] } }]))
  })

  it('posting a vote sends the area, the days and the reason', async () => {
    const r = render(<SettingsLockPanel leagueId="L" />)
    fireEvent.click((await r.findAllByRole('button', { name: 'Ask the league to unlock' }))[0])
    fireEvent.change(r.getByLabelText('Voting stays open for'), { target: { value: '3' } })
    fireEvent.change(r.getByLabelText('Why (shows in league chat, optional)'), { target: { value: 'Provider changed' } })
    fireEvent.click(r.getByRole('button', { name: 'Post the vote' }))
    await waitFor(() => expect(calls).toEqual([{ method: 'POST', body: { group: 'scoring', days: 3, reason: 'Provider changed' } }]))
  })

  it('before the draft the commissioner can untick a locked area; no vote is offered', async () => {
    view = { ...view, seasonUnderway: false }
    const r = render(<SettingsLockPanel leagueId="L" />)
    await waitFor(() => expect(box(r, 'scoring').disabled).toBe(false))
    expect(r.queryAllByRole('button', { name: 'Ask the league to unlock' })).toHaveLength(0)
    fireEvent.click(box(r, 'scoring'))
    await waitFor(() => expect(calls).toEqual([{ method: 'PUT', body: { groups: ['trades'] } }]))
  })

  it('shows an open vote and an area opened by a vote; a member sees status only', async () => {
    view = {
      ...view, canEdit: false,
      groups: groups(['scoring', 'trades'], { scoring: '2026-10-23T12:00:00Z' }),
      votes: [{ id: 'v1', group: 'trades', status: 'voting', closesAt: '2026-10-22T12:00:00Z', yes: null, no: null }],
    }
    const r = render(<SettingsLockPanel leagueId="L" />)
    await r.findByText(/Unlocked by league vote until/)
    expect(r.getByText(/League vote open until/)).toBeTruthy()
    expect(r.queryAllByRole('checkbox')).toHaveLength(0)
    expect(r.getAllByTestId('settings-lock-vote')[0].textContent).toMatch(/^Trades: vote open until/)
  })
})
