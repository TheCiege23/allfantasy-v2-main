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
 *
 * 2026-10-04: so was the rest of the panel's own copy — the loading line, "Select a team…", "Week",
 * "Total Points", "Taxi Squad", "Devy Stash", "Draft Picks", the Commissioner / Member role line, the
 * schedule note and its button, and every save / recalc / load message. Nine of those keys already
 * existed in BOTH dictionaries and nothing called them.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

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

/* ---------------------------------------------------------------------------------------------- */

/** The English the panel used to print. Word-bounded, case-sensitive. */
const FORMER_ENGLISH = [
  'Loading', 'Select a team', 'Week', 'Total Points', 'N/A', 'Edit', 'Taxi Squad', 'IR', 'Devy Stash',
  'Draft Picks', 'No roster data', 'Commissioner', 'Member', 'Schedule editing', 'Edit Schedule Matchups',
  'Failed to', 'Request failed', 'Recalc', 'updated', 'saved',
]
/**
 * Each TEXT NODE on its own: textContent glues siblings with no separator ("Semana" + "1" + …), so a
 * word boundary in the joined string can miss an English word sitting against a Spanish one.
 */
function englishIn(el: HTMLElement): string[] {
  const nodes: string[] = []
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n.nodeValue ?? '')
  const text = nodes.join(' | ')
  return FORMER_ENGLISH.filter((w) => new RegExp(`(^|[^A-Za-z])${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}($|[^A-Za-z])`).test(text))
}

function stubRich(opts: { failLoad?: boolean } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (opts.failLoad && url.includes('division-settings')) return { ok: false, json: async () => ({}) }
    const body = url.includes('division-settings')
      ? { teams: [
          { id: 't1', teamName: 'Team One', ownerName: 'owner', wins: 1, losses: 0, isCommissioner: true },
          { id: 't2', teamName: 'Team Two', ownerName: 'mate', wins: 0, losses: 1 },
        ] }
      : url.includes('roster-locks')
        ? { lockedRosters: {} }
        : url.includes('roster-players')
          ? {
              players: [
                { playerId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', slotType: 'starter' },
                { playerId: 'p3', name: 'Al Taxi', position: 'RB', team: 'NYJ', slotType: 'taxi' },
                { playerId: 'p4', name: 'Cy Hurt', position: 'WR', team: 'SF', slotType: 'ir' },
                { playerId: 'p5', name: 'Di Devy', position: 'QB', team: 'UGA', slotType: 'devy' },
              ],
              draftPicks: [{ season: 2027, round: 1, originalOwner: null, pickLabel: '2027 1st' }],
            }
          : {}
    return { ok: true, json: async () => body }
  }))
}

describe('🛑 the panel’s own hard-coded English is gone in Spanish', () => {
  afterEach(() => { lang.language = 'en'; vi.unstubAllGlobals(); cleanup() })

  it('edit lineups — the team prompt, then week, totals, every roster section, draft picks', async () => {
    lang.language = 'es'
    stubRich()
    const r = render(<CommissionerControlPanel leagueId="l1" />)
    fireEvent.click(await r.findByText('Editar Alineaciones y Puntuaciones/Récords de Matchups'))
    await r.findByText('Seleccionar un equipo para ver la plantilla')
    expect(englishIn(r.container)).toEqual([])
    fireEvent.click(await r.findByText('owner'))
    await r.findByText('Picks del Draft')
    for (const s of ['Semana', 'Puntos Totales:', 'N/D', 'Editar', 'Taxi Squad', 'Lesionados', 'Reserva Devy']) {
      expect(r.container.textContent, s).toContain(s)
    }
    // "Taxi Squad" is the Spanish dictionary's own choice — it is not a leftover, so drop it here.
    expect(englishIn(r.container).filter((w) => w !== 'Taxi Squad')).toEqual([])
  })

  it('update commissioners — the role line under each team', async () => {
    lang.language = 'es'
    stubRich()
    const r = render(<CommissionerControlPanel leagueId="l1" />)
    fireEvent.click((await r.findAllByText('Actualizar Comisionados')).at(-1)!) // the button, not the heading
    await r.findByText('Team Two')
    expect(r.container.textContent).toContain('Comisionado')
    expect(r.container.textContent).toContain('Miembro')
    expect(englishIn(r.container)).toEqual([])
  })

  it('edit schedule — the note and its button', async () => {
    lang.language = 'es'
    stubRich()
    const r = render(<CommissionerControlPanel leagueId="l1" />)
    fireEvent.click((await r.findAllByText('Editar Matchups del Calendario')).at(-1)!)
    await r.findByText(/La edición del calendario está disponible/)
    expect(r.getAllByText('Editar Matchups del Calendario').length).toBeGreaterThanOrEqual(2)
    expect(englishIn(r.container)).toEqual([])
  })

  it('a load failure is reported in Spanish', async () => {
    lang.language = 'es'
    stubRich({ failLoad: true })
    const r = render(<CommissionerControlPanel leagueId="l1" />)
    await r.findByText('Editar Alineaciones y Matchups')
    // The main menu does not show the error; the sub-views do. Open one.
    fireEvent.click((await r.findAllByText('Actualizar Comisionados')).at(-1)!)
    await r.findByText('No se pudo cargar')
    expect(englishIn(r.container)).toEqual([])
  })

  it('the same panel still reads English in English', async () => {
    stubRich()
    const r = render(<CommissionerControlPanel leagueId="l1" />)
    fireEvent.click(await r.findByText('Edit Lineups & Matchup Scores/Records'))
    await r.findByText('Select a team to view its roster')
    fireEvent.click(await r.findByText('owner'))
    await r.findByText('Draft Picks')
    for (const s of ['Week', 'Total Points:', 'N/A', 'Taxi Squad', 'Injured Reserve', 'Devy Stash']) {
      expect(r.container.textContent, s).toContain(s)
    }
    expect(r.container.textContent).not.toMatch(/commControl\./)
  })
})
