/**
 * The commissioner's draft date + time are wall-clock in the LEAGUE's timezone, not the viewer's.
 * The test process runs in Pacific/Honolulu (UTC-10, no DST) so any use of the browser zone shows up
 * as a 5–6 hour error against a New York / Chicago league.
 */
import React from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict.en[k] ?? k
  return { useLanguage: () => ({ language: 'en', t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: 'en', t }) }
})

import { DraftSettingsCommissionerPanel } from '@/components/league-settings/DraftSettingsCommissionerPanel'

type Call = { url: string; method: string; body: any }

function stub(settings: Record<string, unknown>) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null })
    if (u.includes('rookie-draft-order')) return { ok: false, status: 400, json: async () => ({ error: 'not dynasty' }) }
    if (u.includes('/draft/settings') && init?.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ ok: true }) }
    if (u.includes('/draft/settings')) return { ok: true, status: 200, json: async () => settings }
    return { ok: true, status: 200, json: async () => ({}) }
  }))
  return calls
}

const BASE = {
  isCommissioner: true,
  hasAfCommissionerSub: false,
  config: { draft_type: 'snake', rounds: 15, timer_seconds: 90 },
  teams: [],
  computedRounds: { rounds: 14, rosterSpots: 14, countsTaxiAndDevy: false },
}

const ORIGINAL_TZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Pacific/Honolulu' })
afterAll(() => { if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ })
afterEach(() => { vi.unstubAllGlobals(); cleanup() })

const dateInput = (c: HTMLElement) => c.querySelector('input[type="date"]') as HTMLInputElement
const timeInput = (c: HTMLElement) => c.querySelector('input[type="time"]') as HTMLInputElement

describe('DraftSettingsCommissionerPanel — league timezone', () => {
  it('control: the test process really is in Honolulu', () => {
    expect(new Date('2026-09-10T12:00:00Z').getHours()).toBe(2)
  })

  it('saves the date + time as wall-clock in the league timezone (America/New_York, EDT)', async () => {
    const calls = stub({ ...BASE, timezone: 'America/New_York' })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('Save Draft Settings')
    fireEvent.change(dateInput(r.container), { target: { value: '2026-09-10' } })
    fireEvent.change(timeInput(r.container), { target: { value: '19:30' } })
    fireEvent.click(r.getByText('Save Draft Settings'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body.draftDate).toBe('2026-09-10T23:30:00.000Z')
  })

  it('uses EST after the fall-back change', async () => {
    const calls = stub({ ...BASE, timezone: 'America/New_York' })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('Save Draft Settings')
    fireEvent.change(dateInput(r.container), { target: { value: '2026-11-01' } })
    fireEvent.change(timeInput(r.container), { target: { value: '19:30' } })
    fireEvent.click(r.getByText('Save Draft Settings'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body.draftDate).toBe('2026-11-02T00:30:00.000Z')
  })

  it('displays a saved instant in the league timezone and saves it back unchanged', async () => {
    const calls = stub({ ...BASE, timezone: 'America/Chicago', draftDate: '2026-09-11T00:30:00.000Z' })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await waitFor(() => expect(dateInput(r.container).value).toBe('2026-09-10'))
    expect(timeInput(r.container).value).toBe('19:30')
    expect(r.getByTestId('draft-schedule-tz').textContent).toContain('CDT')
    fireEvent.click(r.getByText('Save Draft Settings'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body.draftDate).toBe('2026-09-11T00:30:00.000Z')
  })

  it('falls back to America/New_York when the league has no timezone', async () => {
    const calls = stub({ ...BASE })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('Save Draft Settings')
    fireEvent.change(dateInput(r.container), { target: { value: '2026-12-05' } })
    fireEvent.change(timeInput(r.container), { target: { value: '19:30' } })
    fireEvent.click(r.getByText('Save Draft Settings'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body.draftDate).toBe('2026-12-06T00:30:00.000Z')
  })
})
