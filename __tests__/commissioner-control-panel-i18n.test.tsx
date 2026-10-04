/**
 * The commissioner control panel, in both languages (2026-10-03).
 *
 * 🛑 ITS 26 `commControl.*` KEYS HAD SPANISH ONLY. They lived in translations-es-parity.ts and never
 * in the English block, and the provider's fallback chain ends at the key itself — so an English
 * commissioner saw "commControl.editLineups", "commControl.lockRosterDesc"… as the menu, since April.
 * The e2e click audit clicks by test id, which is how a raw-key UI stayed green.
 *
 * The roster header ("Starters · OWN % · START %") and "Bench" were English literals; they go
 * through t() now — «Titulares · % PROP. · % TIT.», «Banca».
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/league/l1',
  useSearchParams: () => new URLSearchParams(),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
/* The provider's own resolution: the language's dictionary, then English, then the key itself. */
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})

import { CommissionerControlPanel } from '@/components/league-settings/CommissionerControlPanel'

const panelSource = readFileSync(resolve(__dirname, '../components/league-settings/CommissionerControlPanel.tsx'), 'utf8')
const keysUsed = [...new Set([...panelSource.matchAll(/\bt\(\s*['"](commControl\.[A-Za-z0-9_.]+)['"]/g)].map((m) => m[1]!))]

describe('every key the panel uses exists in BOTH languages', () => {
  it('🛑 read from the panel’s own source — a key missing from either dictionary renders raw', () => {
    expect(keysUsed.length).toBeGreaterThanOrEqual(19) // the scan must see the real calls (19 distinct, measured)
    expect(keysUsed).toEqual(expect.arrayContaining(['commControl.starters', 'commControl.ownPct', 'commControl.startPct', 'commControl.bench']))
    expect(keysUsed.filter((k) => !translations.en[k])).toEqual([])
    expect(keysUsed.filter((k) => !translations.es[k])).toEqual([])
    // And the two are not the same string by accident — Spanish is Spanish.
    expect(translations.es['commControl.ownPct']).toBe('% PROP.')
    expect(translations.es['commControl.startPct']).toBe('% TIT.')
    expect(translations.es['commControl.starters']).toBe('Titulares')
  })
})

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = url.includes('division-settings')
      ? { teams: [{ id: 't1', teamName: 'Team One', ownerName: 'owner', wins: 1, losses: 0 }] }
      : url.includes('roster-locks')
        ? { lockedRosters: {} }
        : url.includes('roster-players')
          ? { players: [
              { playerId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', slotType: 'starter', ownPct: 90, startPct: 70 },
              { playerId: 'p2', name: 'Jo Reyes', position: 'WR', team: 'KC', slotType: 'bench', ownPct: 40, startPct: 10 },
            ] }
          : {}
    return { ok: true, json: async () => body }
  }))
}

describe('the panel, rendered', () => {
  it('shows English words in English — no raw keys anywhere on the menu', async () => {
    lang.language = 'en'
    stubFetch()
    const { container, findByText } = render(<CommissionerControlPanel leagueId="l1" />)
    await findByText('Edit Lineups & Matchups')
    expect(container.textContent).not.toMatch(/commControl\./)
    vi.unstubAllGlobals()
  })

  it('shows the roster header in Spanish — «Titulares · % PROP. · % TIT.» and «Banca»', async () => {
    lang.language = 'es'
    stubFetch()
    const { container, findByText } = render(<CommissionerControlPanel leagueId="l1" />)
    fireEvent.click(await findByText('Editar Alineaciones y Puntuaciones/Récords de Matchups')) // the button, not the card's heading
    fireEvent.click(await findByText('owner')) // the picker shows the owner's name
    await waitFor(() => expect(container.textContent).toContain('% PROP.'))
    const text = container.textContent!
    for (const s of ['Titulares', '% PROP.', '% TIT.', 'Banca']) expect(text).toContain(s)
    expect(text).not.toMatch(/\bOWN %|\bSTART %|\bStarters\b|\bBench\b|commControl\./)
    vi.unstubAllGlobals()
    lang.language = 'en'
  })
})
