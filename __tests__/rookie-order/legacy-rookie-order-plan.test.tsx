/**
 * The Draft tab's rookie draft order (DraftSettingsCommissionerPanel → PUT .../rookie-draft-order): the
 * preview and worst record first are free; automating lowest max PF is the league owner's AF Commissioner
 * plan — the route says which through `canAutomate`, and refuses with AF_COMMISSIONER_REQUIRED.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})
vi.mock('@/components/league-settings/LiveRookieOrderPanel', () => ({ LiveRookieOrderPanel: () => null }))

import { DraftSettingsCommissionerPanel } from '@/components/league-settings/DraftSettingsCommissionerPanel'

type Call = { url: string; method: string; body: any }

function stub(rookie: Record<string, unknown>, put: { status: number; body: unknown } = { status: 200, body: { ok: true } }) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null })
    if (u.includes('rookie-draft-order') && init?.method === 'PUT') return { ok: put.status < 400, status: put.status, json: async () => put.body }
    if (u.includes('rookie-draft-order')) {
      return { ok: true, status: 200, json: async () => ({ slots: [], season: 2027, savedMode: 'worst_to_first', enabled: false, isCommissioner: true, ...rookie }) }
    }
    if (u.includes('/draft/settings')) {
      return { ok: true, status: 200, json: async () => ({ isCommissioner: true, config: { draft_type: 'linear', rounds: 4, timer_seconds: 90 }, teams: [], hasAfCommissionerSub: false }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }))
  return calls
}
const autoSwitch = (r: ReturnType<typeof render>) => r.getByRole('switch', { name: translations[lang.language]['draft.autoSetOrder'] }) as HTMLButtonElement

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
  lang.language = 'en'
})

describe('legacy rookie draft order, on the Draft tab', () => {
  it('without the owner’s plan the switch still works: worst record first is free, and no plan note shows', async () => {
    const calls = stub({ canAutomate: false })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await waitFor(() => expect(autoSwitch(r).disabled).toBe(false))
    expect(r.queryByTestId('rookie-auto-plan')).toBeNull()
    fireEvent.click(autoSwitch(r))
    fireEvent.click(r.getByText(translations.en['draft.saveRookieSettings']))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ mode: 'worst_to_first', enabled: true })
  })

  it('without the plan, choosing lowest max PF says it is part of AF Commissioner', async () => {
    stub({ canAutomate: false, savedMode: 'reverse_max_pf', enabled: true })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    expect((await r.findByTestId('rookie-auto-plan')).textContent).toContain(translations.en['lsEd.dr.rookieAutoPlan'])
    expect(autoSwitch(r).disabled).toBe(false)
  })

  it('on the plan: no note, the switch works, and the save sends it', async () => {
    const calls = stub({ canAutomate: true })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await waitFor(() => expect(autoSwitch(r).disabled).toBe(false))
    expect(r.queryByTestId('rookie-auto-plan')).toBeNull()
    fireEvent.click(autoSwitch(r))
    fireEvent.click(r.getByText(translations.en['draft.saveRookieSettings']))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ mode: 'worst_to_first', enabled: true })
  })

  it('a refusal reads in the viewer’s language, not the server’s English', async () => {
    lang.language = 'es'
    stub({ canAutomate: true }, { status: 402, body: { error: 'AF Commissioner is required to order the rookie draft by lowest max points for.', errorCode: 'AF_COMMISSIONER_REQUIRED' } })
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await waitFor(() => expect(autoSwitch(r).disabled).toBe(false))
    fireEvent.click(autoSwitch(r))
    fireEvent.click(r.getByText(translations.es['draft.saveRookieSettings'] ?? translations.en['draft.saveRookieSettings']))
    await r.findByText(translations.es['lsEd.dr.rookieAutoPlan']!)
    expect(r.container.textContent).not.toContain('AF Commissioner is required to order')
  })
})
