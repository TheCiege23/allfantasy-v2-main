/**
 * Commissioner Draft tab (DraftSettingsCommissionerPanel) — behaviour on the subscription line.
 * Pure rules are covered in draft-settings-policy.test.ts; this pins what the panel shows and sends.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    if (u.includes('/randomize-order')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, times: 7, teams: [
        { position: 1, teamName: 'Bees', ownerName: 'Lee', avatarUrl: null, isEmpty: false },
        { position: 2, teamName: 'Aces', ownerName: 'Pat', avatarUrl: null, isEmpty: false },
      ] }) }
    }
    if (u.includes('/draft/settings') && init?.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ ok: true, config: { rounds: 14 } }) }
    if (u.includes('/draft/settings')) return { ok: true, status: 200, json: async () => settings }
    return { ok: true, status: 200, json: async () => ({}) }
  }))
  return calls
}

const BASE = {
  isCommissioner: true,
  config: { draft_type: 'snake', rounds: 15, timer_seconds: 90 },
  teams: [
    { position: 1, teamName: 'Aces', ownerName: 'Pat', avatarUrl: null, isEmpty: false },
    { position: 2, teamName: 'Bees', ownerName: 'Lee', avatarUrl: null, isEmpty: false },
  ],
  computedRounds: { rounds: 14, rosterSpots: 14, countsTaxiAndDevy: false },
}

afterEach(() => { vi.unstubAllGlobals(); cleanup() })

describe('DraftSettingsCommissionerPanel', () => {
  it('non-subscriber: read-only computed rounds, no custom timer, compact switches, live-draft badge, pause disabled', async () => {
    const calls = stub({ ...BASE, hasAfCommissionerSub: false })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('14 rounds · from 14 roster spots')
    expect(r.queryByText('Custom…')).toBeNull()
    expect(r.container.querySelector('[data-pace="fast"]')?.textContent).toBe('Live draft')
    // Every toggle is a real switch, named by its label.
    const switches = r.getAllByRole('switch')
    expect(switches.length).toBeGreaterThanOrEqual(3)
    for (const sw of switches) expect(sw.getAttribute('aria-checked')).toMatch(/^(true|false)$/)
    const pause = r.getByRole('switch', { name: 'Slow Draft Auto-Pause' })
    expect((pause as HTMLButtonElement).disabled).toBe(true)
    // Keepers block is gone.
    expect(r.queryByText(/Set Players|Keepers/)).toBeNull()

    // Randomize = one shuffle, no dialog.
    fireEvent.click(r.getByRole('button', { name: /Randomize/ }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/randomize-order'))).toBe(true))
    expect(calls.find((c) => c.url.includes('/randomize-order'))!.body).toEqual({ times: 1 })
    expect(r.queryByRole('dialog')).toBeNull()

    // Save sends the computed rounds, not the stale saved 15.
    fireEvent.click(r.getByText('Save Draft Settings'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ rounds: 14, timer_seconds: 90, slowDraftPauseEnabled: false })
  })

  it('subscriber: rounds selector, custom timer, slow badge enables the pause window, Randomize ×N dialog', async () => {
    const calls = stub({ ...BASE, hasAfCommissionerSub: true, config: { ...BASE.config, timer_seconds: 3600 }, slowDraftPauseEnabled: true })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('Slow draft')
    expect(r.getByTestId('draft-pause-window')).toBeTruthy()
    expect(r.getByRole('switch', { name: 'Slow Draft Auto-Pause' }).getAttribute('aria-checked')).toBe('true')
    expect(r.queryByTestId('draft-rounds-readonly')).toBeNull()
    expect(r.getByText('Match roster spots (14)')).toBeTruthy()

    // Custom: 25 minutes → middy, pause hidden.
    const timer = r.container.querySelectorAll('select')[1] as HTMLSelectElement
    fireEvent.change(timer, { target: { value: 'custom' } })
    const editor = await r.findByTestId('draft-custom-timer')
    // 1h pre-fills as "1 hours"; switch to minutes.
    expect((editor.querySelector('select') as HTMLSelectElement).value).toBe('hours')
    fireEvent.change(editor.querySelector('select')!, { target: { value: 'minutes' } })
    fireEvent.change(editor.querySelector('input')!, { target: { value: '25' } })
    fireEvent.click(r.getByText('Set'))
    await r.findByText('Middy draft')
    expect(r.queryByTestId('draft-pause-window')).toBeNull()
    expect(r.getByRole('switch', { name: 'Slow Draft Auto-Pause' }).getAttribute('aria-checked')).toBe('false')

    // Randomize opens the dialog; an out-of-range count is refused client-side.
    fireEvent.click(r.getByRole('button', { name: /^Randomize$/ }))
    const dialog = await r.findByRole('dialog')
    const input = dialog.querySelector('input')!
    fireEvent.change(input, { target: { value: '101' } })
    fireEvent.click(dialog.querySelectorAll('button')[1]!)
    await r.findByText('Enter a whole number from 1 to 100.')
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.click(dialog.querySelectorAll('button')[1]!)
    await r.findByText('Randomized 7 times — posted to league chat.')
    expect(calls.find((c) => c.url.includes('/randomize-order'))!.body).toEqual({ times: 7 })
  })

  it('empty schedule looks tappable: placeholders, not a blank box', async () => {
    stub({ ...BASE, hasAfCommissionerSub: false })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('Pick a date')
    expect(r.getByText('Pick a time')).toBeTruthy()
  })

  it('Fill with CI has an explanation bubble, and nothing in the panel says "AI"', async () => {
    stub({ ...BASE, hasAfCommissionerSub: false })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('Fill with CI')
    fireEvent.click(r.getByRole('button', { name: 'What does Fill with CI do?' }))
    await r.findByText(/Chimmy Intelligence \(CI\) adds a managed team to every empty seat/)
    expect(r.container.textContent).not.toMatch(/\bAI\b/)
    const titles = [...r.container.querySelectorAll('[title],[aria-label]')].map((e) => `${e.getAttribute('title') ?? ''} ${e.getAttribute('aria-label') ?? ''}`)
    expect(titles.join(' ')).not.toMatch(/\bAI\b/)
  })

  it('after Fill with CI the panel adopts the 30s clock, so Save cannot write the stale one back — even if the reload fails', async () => {
    const calls: Call[] = []
    let filled = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url)
      calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null })
      if (u.includes('rookie-draft-order')) return { ok: false, status: 400, json: async () => ({}) }
      if (u.includes('/fill-empty-slots')) { filled = true; return { ok: true, status: 200, json: async () => ({ ok: true, teamsCreated: 1, pickTimerSeconds: 30, cpuAutoPick: true }) } }
      if (u.includes('/draft/settings') && init?.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ ok: true }) }
      if (u.includes('/draft/settings')) {
        if (filled) throw new Error('network down') // the post-fill reload fails
        return { ok: true, status: 200, json: async () => ({ ...BASE, hasAfCommissionerSub: false, config: { ...BASE.config, timer_seconds: 28800 }, cpuAutoPickEnabled: false }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }))
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('Slow draft') // 8h before the fill
    fireEvent.click(r.getByText('Fill with CI'))
    await r.findByText('Live draft') // 30s after it
    expect(r.getByRole('switch', { name: 'CPU Auto Pick' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(r.getByText('Save Draft Settings'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ timer_seconds: 30, cpuAutoPick: true })
  })

  it('after Fill with CI the panel re-reads the authoritative settings', async () => {
    let filled = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      const u = String(url)
      if (u.includes('rookie-draft-order')) return { ok: false, status: 400, json: async () => ({}) }
      if (u.includes('/fill-empty-slots')) { filled = true; return { ok: true, status: 200, json: async () => ({ ok: true, teamsCreated: 0, message: 'All slots are already filled' }) } }
      if (u.includes('/draft/settings') && init?.method !== 'PATCH') {
        return { ok: true, status: 200, json: async () => ({
          ...BASE, hasAfCommissionerSub: false,
          config: { ...BASE.config, timer_seconds: filled ? 600 : 28800 },
          teams: filled ? [...BASE.teams, { position: 3, teamName: 'CI Team 3', ownerName: 'CI Team 3', avatarUrl: null, isEmpty: false }] : BASE.teams,
        }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }))
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('Slow draft')
    fireEvent.click(r.getByText('Fill with CI'))
    await r.findByText('CI Team 3')
    expect(r.getByText('Middy draft')).toBeTruthy() // 10 min from the reload
  })
})
