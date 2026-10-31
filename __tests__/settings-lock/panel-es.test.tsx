/**
 * The settings lock panel in Spanish (lib/i18n/settings-lock-copy.ts): the areas, the explanation, the vote
 * form and the vote history, plus the route's refusal codes in the viewer's language. It is the Commissioner
 * Settings Permissions tab and a league settings home sub-page.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'es' as string }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { SettingsLockPanel } from '@/components/league-settings/home/SettingsLockPanel'
import { LOCK_AREA_COPY, LOCK_COPY, lockErrorCopy } from '@/lib/i18n/settings-lock-copy'
import { LOCK_GROUPS } from '@/lib/league/settingsLock'

const groups = (locked: string[]) => LOCK_GROUPS.map((g) => ({ group: g, locked: locked.includes(g), unlockedUntil: null }))
let view: Record<string, unknown>
let putResponse: { ok: boolean; body: Record<string, unknown> }

beforeEach(() => {
  lang.language = 'es'
  putResponse = { ok: true, body: { ok: true } }
  view = {
    season: 2026, seasonUnderway: true, canEdit: true, groups: groups(['scoring', 'trades']),
    votes: [{ id: 'v1', group: 'waivers', status: 'failed', closesAt: '2026-10-22T12:00:00Z', yes: 2, no: 5 }],
  }
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') return { ok: true, status: 200, json: async () => view }
    return { ok: putResponse.ok, status: putResponse.ok ? 200 : 409, json: async () => putResponse.body }
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SettingsLockPanel in Spanish', () => {
  it('names the areas, explains the lock and shows the vote history in Spanish', async () => {
    const r = render(<SettingsLockPanel leagueId="L" />)
    await r.findByText(LOCK_AREA_COPY.scoring.es.label)
    expect(r.getByText(LOCK_AREA_COPY.waivers.es.help)).toBeTruthy()
    expect(r.container.textContent).toContain('Bloquea cualquier área de tus reglas para la temporada 2026.')
    expect(r.container.textContent).toContain(LOCK_COPY.introUnderway.es.trim())
    expect(r.getAllByRole('button', { name: LOCK_COPY.askUnlock.es })).toHaveLength(2)
    expect(r.getByTestId('settings-lock-vote').textContent).toBe('Agentes libres: siguió bloqueado (2 a favor, 5 en contra)')
    expect((r.getByLabelText('Bloquear puntuación durante la temporada') as HTMLInputElement).checked).toBe(true)
  })

  it('the vote form is in Spanish', async () => {
    const r = render(<SettingsLockPanel leagueId="L" />)
    fireEvent.click((await r.findAllByRole('button', { name: LOCK_COPY.askUnlock.es }))[0])
    expect(r.getByText('¿Desbloquear puntuación?')).toBeTruthy()
    expect(r.getByLabelText(LOCK_COPY.voteDays.es)).toBeTruthy()
    expect(r.getByRole('option', { name: '1 día' })).toBeTruthy()
    expect(r.getByRole('button', { name: LOCK_COPY.postVote.es })).toBeTruthy()
  })

  it('a refusal the route names by code reads in Spanish, never the English server text', async () => {
    putResponse = { ok: false, body: { error: 'The season is under way, so waivers can only be unlocked by a league vote.', code: 'vote_required' } }
    const r = render(<SettingsLockPanel leagueId="L" />)
    fireEvent.click(await r.findByLabelText('Bloquear agentes libres durante la temporada'))
    await waitFor(() => expect(r.getByRole('alert').textContent).toBe(LOCK_COPY.err_vote_required.es))
  })

  it('an unknown refusal: Spanish gets the generic Spanish line, English keeps the server words', async () => {
    putResponse = { ok: false, body: { error: 'Something specific', code: 'mystery' } }
    const r = render(<SettingsLockPanel leagueId="L" />)
    fireEvent.click(await r.findByLabelText('Bloquear agentes libres durante la temporada'))
    await waitFor(() => expect(r.getByRole('alert').textContent).toBe(LOCK_COPY.saveFailed.es))
    cleanup()
    lang.language = 'en'
    const e = render(<SettingsLockPanel leagueId="L" />)
    fireEvent.click(await e.findByLabelText('Lock waivers for the season'))
    await waitFor(() => expect(e.getByRole('alert').textContent).toBe('Something specific'))
  })

  it('every string has both languages, the Spanish never says «waiver», and every route code is covered', () => {
    for (const [k, v] of Object.entries(LOCK_COPY)) {
      expect(v.en, k).toBeTruthy()
      expect(v.es, k).toBeTruthy()
      expect(v.es.toLowerCase(), k).not.toContain('waiver')
    }
    for (const g of LOCK_GROUPS) expect(`${LOCK_AREA_COPY[g].es.label} ${LOCK_AREA_COPY[g].es.help}`.toLowerCase()).not.toContain('waiver')
    for (const code of ['vote_required', 'not_locked', 'already_voting', 'bad_days', 'poll_failed']) expect(lockErrorCopy('es', code), code).toBeTruthy()
    expect(lockErrorCopy('es', 'constructor')).toBeNull()
  })
})
