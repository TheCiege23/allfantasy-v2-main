/**
 * Settings → Pirate rules reads in light mode (2026-11-22, pirate audit items 1 and 6).
 *
 * The editor was hard-coded dark (bg-[#081625], text-white, text-slate-*); light mode turned its labels and the
 * numbers in its fields dark on navy. It is now the league's ONE Pirate rules editor (the deck's copy is gone), so
 * it also says each rule in the same words the deck summary uses.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { PirateRulesEditor } from '@/components/league-settings/home/PirateRulesEditor'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function editor() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rules: { protectionLimit: 3, claimHours: 24, selectionHours: 24, overflowGraceHours: 24, playoffClaims: false } }) }))
  render(<PirateRulesEditor leagueId="L" />)
  await screen.findByLabelText('Protected players')
  return screen.getByTestId('pirate-rules-editor')
}

describe('Pirate rules editor', () => {
  it('scopes itself to the pirate tokens and uses no class the light-mode rule rewrites', async () => {
    const el = await editor()
    expect(el.classList.contains('pr')).toBe(true)
    const offenders = [el, ...Array.from(el.querySelectorAll('*'))].map((n) => n.getAttribute('class') ?? '')
      .filter((c) => /text-white|text-slate|bg-\[#|text-\[#|text-amber|bg-amber|text-rose|text-emerald|accent-amber/.test(c))
    expect(offenders).toEqual([])
  })

  it('keeps every field labelled', async () => {
    await editor()
    for (const label of ['Protected players', 'Winner selection (hours)', 'Claim response (hours)', 'Roster drop deadline (hours)']) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
    expect(screen.getByRole('checkbox', { name: /Allow steals in playoffs/ })).toBeTruthy()
  })
})
