/**
 * SurvivorSeasonFixPanel in Spanish: every visible string comes from `survivorFix.*`, so a Spanish
 * commissioner reads no English, no raw key, and never «waiver». The English suites beside this one
 * (survivor-season-fix-panel, season-fix-override-redraw) pin the English copy unchanged.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'es' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const { interpolateTemplate } = await import('@/lib/i18n/interpolate')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useOptionalLanguage: () => ({ language: lang.language, t, tInterpolate: (k: string, v: Record<string, string | number> = {}) => interpolateTemplate(t(k), v) }) }
})

import { SurvivorSeasonFixPanel } from '@/components/survivor/SurvivorSeasonFixPanel'
import { translations } from '@/lib/i18n/translations'

const target = { councilId: 'c1', week: 5, eliminatedUserId: 'u-wrong', eliminatedName: 'Wes', resolved: true, candidates: [{ userId: 'u-right', name: 'Rae' }] }
let postReply: Record<string, unknown> = {}
beforeEach(() => {
  postReply = { ok: true }
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => (init?.method === 'POST' ? postReply : { target }) })))
})
afterEach(() => { vi.unstubAllGlobals(); cleanup() })

const ENGLISH = ['Correct a score', 'Remove a manager who quit', 'Change a Tribal result', 'Redraw the tribes', 'Start the merge', 'Choose a manager', 'voted out', 'Reason', 'Confirm', 'audit log', 'Apply correction']
const noEnglish = (text: string) => ENGLISH.filter((w) => text.includes(w))

describe('Season Fix panel in Spanish', () => {
  it('every tool, opened, reads in Spanish', async () => {
    const r = render(<SurvivorSeasonFixPanel leagueId="L1" managers={[{ userId: 'u1', name: 'Ava' }]} week={5} merged={false} />)
    for (const title of ['Corregir una puntuación', 'Retirar a un mánager que abandonó', 'Cambiar un resultado del Consejo Tribal', 'Volver a sortear las tribus', 'Empezar la fusión ahora']) {
      fireEvent.click(screen.getAllByText(title)[0]!)
      if (title.startsWith('Cambiar')) await screen.findByText(/fue expulsado\./)
      expect(noEnglish(r.container.textContent ?? ''), title).toEqual([])
      expect(r.container.textContent).not.toMatch(/survivorFix\./)
      fireEvent.click(screen.getAllByText(title)[0]!)
    }
  })

  it('the Tribal change says its outcome in Spanish', async () => {
    postReply = { ok: true, restoredPlayerIds: ['a', 'b'], claimedElsewherePlayerIds: ['c'], eliminationApplied: true }
    render(<SurvivorSeasonFixPanel leagueId="L1" managers={[]} week={5} merged={false} />)
    fireEvent.click(screen.getByText('Cambiar un resultado del Consejo Tribal'))
    fireEvent.change(await screen.findByLabelText('Mánager a expulsar en su lugar'), { target: { value: 'u-right' } })
    fireEvent.click(screen.getByText('Cambiar el resultado'))
    fireEvent.click(screen.getByText('Confirmar: expulsar a Rae'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(
      'Ahora el expulsado es Rae. Wes vuelve al juego con 2 de sus jugadores liberados. 1 jugador liberado ya lo había reclamado otro equipo y se queda allí.',
    ))
  })

  it('every survivorFix key exists in both languages, and the Spanish never says «waiver»', () => {
    const en = Object.keys(translations.en).filter((k) => k.startsWith('survivorFix.'))
    expect(en.length).toBeGreaterThan(50)
    for (const k of en) {
      expect(translations.es[k], k).toBeTruthy()
      expect(translations.es[k]).not.toBe(translations.en[k])
      expect(translations.es[k]!.toLowerCase()).not.toContain('waiver')
    }
  })
})
