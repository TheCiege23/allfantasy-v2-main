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

function stub(settings: Record<string, unknown>, randomize: Record<string, unknown> = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null })
    if (u.includes('rookie-draft-order')) return { ok: false, status: 400, json: async () => ({ error: 'not dynasty' }) }
    if (u.includes('/randomize-order')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, times: 7, teams: [
        { position: 1, teamId: 't2', teamName: 'Bees', ownerName: 'Lee', avatarUrl: null, isEmpty: false },
        { position: 2, teamId: 't1', teamName: 'Aces', ownerName: 'Pat', avatarUrl: null, isEmpty: false },
      ], ...randomize }) }
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
    { position: 1, teamId: 't1', teamName: 'Aces', ownerName: 'Pat', avatarUrl: null, isEmpty: false },
    { position: 2, teamId: 't2', teamName: 'Bees', ownerName: 'Lee', avatarUrl: null, isEmpty: false },
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

    // Every hour 1–24 is listed, but the ones beyond the standard list are locked to the plan.
    const timer = r.container.querySelectorAll('select')[1] as HTMLSelectElement
    const opt = (sec: number) => timer.querySelector(`option[value="${sec}"]`) as HTMLOptionElement | null
    expect(opt(10800)?.disabled).toBe(true)
    expect(opt(10800)?.textContent).toBe('3 Hours · AF Commissioner')
    expect(opt(86400)?.disabled).toBe(true)
    expect(opt(7200)?.disabled).toBe(false)
    expect(r.getByTestId('draft-hourly-locked').textContent).toMatch(/AF Commissioner or AF Supreme/)

    // Randomize = one shuffle; no count or chosen-by controls without the plan.
    expect(r.queryByTestId('draft-randomize-controls')).toBeNull()
    fireEvent.click(r.getByRole('button', { name: /Randomize/ }))
    await waitFor(() => expect(calls.some((c) => c.url.includes('/randomize-order'))).toBe(true))
    expect(calls.find((c) => c.url.includes('/randomize-order'))!.body).toEqual({ times: 1 })

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

    // Every hour is selectable with the plan.
    expect((timer.querySelector('option[value="10800"]') as HTMLOptionElement).disabled).toBe(false)
    expect(r.queryByTestId('draft-hourly-locked')).toBeNull()

    // Randomize: the count and who chose it come from dropdowns, not a typed number.
    fireEvent.change(r.getByLabelText('Number of randomizes'), { target: { value: '7' } })
    fireEvent.change(r.getByLabelText('Number chosen by'), { target: { value: 't2' } })
    fireEvent.click(r.getByRole('button', { name: 'Randomize 7×' }))
    await r.findByText('Randomized 7 times — posted to league chat.')
    expect(calls.find((c) => c.url.includes('/randomize-order'))!.body).toEqual({ times: 7, chosenByTeamId: 't2' })
  })

  it('shows every shuffle the server made, then lands on the saved order', async () => {
    stub({ ...BASE, hasAfCommissionerSub: true }, {
      times: 3,
      stepTeams: [
        { teamName: 'Aces', ownerName: 'Pat', avatarUrl: null },
        { teamName: 'Bees', ownerName: 'Lee', avatarUrl: null },
      ],
      steps: [[1, 0], [0, 1], [1, 0]],
    })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await r.findByLabelText('Number of randomizes')
    fireEvent.change(r.getByLabelText('Number of randomizes'), { target: { value: '3' } })
    fireEvent.click(r.getByRole('button', { name: 'Randomize 3×' }))
    // Each pass is on screen in turn, with its place in the run and a log line.
    await r.findByText('Shuffle 1 of 3')
    expect(r.getByText('Shuffle 1: Bees picks first')).toBeTruthy()
    await r.findByText('Shuffle 2 of 3', undefined, { timeout: 3000 })
    expect(r.getByText('Shuffle 2: Aces picks first')).toBeTruthy()
    await r.findByText('Shuffle 3 of 3', undefined, { timeout: 3000 })
    // Then the progress goes and the saved order is the one listed.
    await r.findByText('Randomized 3 times — posted to league chat.', undefined, { timeout: 3000 })
    expect(r.queryByTestId('draft-randomize-progress')).toBeNull()
    expect(r.getAllByText('Shuffle 3: Bees picks first').length).toBe(1)
  }, 10000)

  it('empty schedule looks tappable: placeholders, not a blank box', async () => {
    stub({ ...BASE, hasAfCommissionerSub: false })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await r.findByPlaceholderText('MM/DD/YYYY')
    expect(r.getByText('Pick a time')).toBeTruthy()
    expect(r.getByRole('button', { name: 'Open calendar' })).toBeTruthy()
  })

  it('the draft date can be typed, and a date that does not exist is refused', async () => {
    const calls = stub({ ...BASE, hasAfCommissionerSub: false })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    const date = await r.findByLabelText('Date')
    fireEvent.change(date, { target: { value: '02/30/2027' } })
    fireEvent.blur(date)
    await r.findByText('Enter a real date, like MM/DD/YYYY.')
    fireEvent.change(date, { target: { value: '8/29/2027' } })
    fireEvent.blur(date)
    await waitFor(() => expect(r.queryByText('Enter a real date, like MM/DD/YYYY.')).toBeNull())
    // The calendar's own input follows the typed date.
    expect((r.container.querySelector('input[type="date"]') as HTMLInputElement).value).toBe('2027-08-29')
    expect((date as HTMLInputElement).value).toBe('08/29/2027')
    fireEvent.click(r.getByText('Save Draft Settings'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body.draftDate).toMatch(/^2027-08-(29|30)T/)
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

  describe('Autostart toggle', () => {
    const REDRAFT = { sport: 'NFL', leagueType: 'redraft', isDynasty: false, platform: 'allfantasy', survivorMode: false, guillotineMode: false, leagueVariant: null }

    it('is hidden for a native redraft league, whose draft starts at its time anyway, with a note in its place', async () => {
      stub({ ...BASE, autostartEnabled: false, scheduledStartLeague: REDRAFT })
      const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
      await r.findByText('14 rounds · from 14 roster spots')
      expect(r.queryByRole('switch', { name: 'Autostart Draft' })).toBeNull()
      expect(r.getByText('Drafts start automatically at the scheduled time.')).toBeTruthy()
    })

    it('is shown for a survivor league, which still honours it', async () => {
      stub({ ...BASE, autostartEnabled: true, scheduledStartLeague: { ...REDRAFT, survivorMode: true } })
      const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
      await r.findByText('14 rounds · from 14 roster spots')
      expect(r.getByRole('switch', { name: 'Autostart Draft' }).getAttribute('aria-checked')).toBe('true')
      expect(r.queryByText('Drafts start automatically at the scheduled time.')).toBeNull()
    })
  })
})
