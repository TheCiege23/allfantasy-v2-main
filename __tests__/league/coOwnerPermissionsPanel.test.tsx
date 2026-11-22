import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

/** The co-commissioner panel: per-area permission checkboxes, the cap of two, read-only for others. */

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }) }
})

import { CoOwnerSettingsPanel } from '@/components/league-settings/CoOwnerSettingsPanel'

const team = (id: string, name: string, extra: Record<string, boolean> = {}) => ({
  id, teamName: name, ownerName: name, avatarUrl: null, isCommissioner: false, isCoCommissioner: false, ...extra,
})

let isHead: boolean
let patches: Array<Record<string, unknown>>

beforeEach(() => {
  lang.language = 'en'
  isHead = true
  patches = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('division-settings')) {
      return { ok: true, json: async () => ({
        isCommissioner: isHead,
        teams: [team('h', 'Head', { isCommissioner: true }), team('a', 'Ann', { isCoCommissioner: true }), team('b', 'Bo', { isCoCommissioner: true }), team('c', 'Cy')],
      }) }
    }
    if (url.includes('co-commissioners') && (!init || init.method !== 'PATCH')) {
      return { ok: true, json: async () => ({ max: 2, scopes: { a: { scopes: ['trades'], configured: true }, b: { scopes: ['scoring', 'rosters', 'trades', 'money', 'chat', 'league'], configured: false } } }) }
    }
    patches.push(JSON.parse(String(init?.body)))
    return { ok: true, json: async () => ({ success: true }) }
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const box = (r: ReturnType<typeof render>, label: string) => r.getByLabelText(label) as HTMLInputElement

describe('CoOwnerSettingsPanel permissions', () => {
  it('shows each co-commissioner’s areas; ticking one saves the new list', async () => {
    const r = render(<CoOwnerSettingsPanel leagueId="L" />)
    await waitFor(() => expect(box(r, 'Ann: Trades').checked).toBe(true))
    expect(box(r, 'Ann: Money').checked).toBe(false)
    expect(box(r, 'Bo: Money').checked).toBe(true)
    fireEvent.click(box(r, 'Ann: Money'))
    await waitFor(() => expect(patches).toEqual([{ leagueId: 'L', memberId: 'a', scopes: ['trades', 'money'] }]))
    await waitFor(() => expect(box(r, 'Ann: Money').checked).toBe(true))
  })

  it('with two co-commissioners, adding a third is disabled', async () => {
    const r = render(<CoOwnerSettingsPanel leagueId="L" />)
    await r.findByLabelText('Ann: Trades')
    const add = r.getAllByRole('button').find((b) => b.textContent?.includes('Add') || b.getAttribute('title')?.includes('up to 2'))
    expect(add).toBeDefined()
    expect((add as HTMLButtonElement).disabled).toBe(true)
    expect(r.getByTestId('co-commish-cap').textContent).toContain('Up to 2 co-commissioners')
  })

  it('a non-head commissioner sees the granted areas but no checkboxes', async () => {
    isHead = false
    const r = render(<CoOwnerSettingsPanel leagueId="L" />)
    await waitFor(() => expect(r.getAllByTestId('co-commish-scopes')).toHaveLength(2))
    expect(r.queryAllByRole('checkbox')).toHaveLength(0)
    expect(r.getAllByTestId('co-commish-scopes')[0].textContent).toBe('ManagesTrades')
  })

  it('speaks Spanish in Spanish', async () => {
    lang.language = 'es'
    const r = render(<CoOwnerSettingsPanel leagueId="L" />)
    await r.findByLabelText('Ann: Dinero')
    expect(r.getByTestId('co-commish-cap').textContent).toContain('Hasta 2 co-comisionados')
  })
})
