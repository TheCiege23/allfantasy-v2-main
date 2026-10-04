/**
 * League-settings panels speak English in English (2026-10-04).
 *
 * 🛑 34 keys used by five panels — co-owner, division, dues, history, member — existed ONLY in
 * lib/i18n/translations-es-parity.ts. The provider resolves the reader's language, then English,
 * then the KEY ITSELF, so an English commissioner read "history.noSeasons", "member.selectManager",
 * "division.autoAssign"… as the interface. Same class as the commissioner control panel (#2032).
 *
 * The guard reads every components/league-settings file for its t('…') calls and requires each key
 * in both dictionaries — the check that would have caught all of these.
 *
 * The same panels also wrote English straight into the markup — "Num of Divisions", "Member Payment
 * Status", the member filter chips, every load/save error — so a Spanish reader got a half-English
 * panel. The renders at the bottom read each panel in Spanish against the English it used to print.
 */
import React from 'react'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
/* The provider's own resolution: the language, then English, then the key itself. */
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})

vi.mock('@/components/league-settings/DuplicateManagerWarningsSection', () => ({ DuplicateManagerWarningsSection: () => null }))

import { LeagueHistoryPanel } from '@/components/league-settings/LeagueHistoryPanel'
import { CoOwnerSettingsPanel } from '@/components/league-settings/CoOwnerSettingsPanel'
import { DivisionSettingsCommissionerPanel } from '@/components/league-settings/DivisionSettingsCommissionerPanel'
import { LeagueDuesTrackerPanel } from '@/components/league-settings/LeagueDuesTrackerPanel'
import { MemberSettingsCommissionerPanel } from '@/components/league-settings/MemberSettingsCommissionerPanel'

const DIR = resolve(__dirname, '../components/league-settings')
/*
 * CommissionerControlPanel's `commControl.*` keys get their English in #2032, which carries its own
 * equivalent guard (commissioner-control-panel-i18n). Excluded here only until that lands, so this
 * change does not depend on it.
 */
const PENDING_ELSEWHERE = new Set(['CommissionerControlPanel.tsx'])

function keysByFile(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && !PENDING_ELSEWHERE.has(e.name)) {
        const keys = [...new Set([...readFileSync(p, 'utf8').matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+\.[A-Za-z0-9_.]+)['"]/g)].map((m) => m[1]!))]
        if (keys.length) out.set(p.slice(DIR.length + 1).replace(/\\/g, '/'), keys)
      }
    }
  }
  walk(DIR)
  return out
}

describe('every key a league-settings panel uses resolves in both languages', () => {
  it('🛑 read from the panels’ own source — a key English lacks renders as the raw key', () => {
    const files = keysByFile()
    // The scan must see the five panels and their real calls, or it asserts nothing.
    for (const f of ['CoOwnerSettingsPanel.tsx', 'DivisionSettingsCommissionerPanel.tsx', 'LeagueDuesTrackerPanel.tsx', 'LeagueHistoryPanel.tsx', 'MemberSettingsCommissionerPanel.tsx']) {
      expect(files.has(f), f).toBe(true)
    }
    const missing = (lng: 'en' | 'es') => [...files].flatMap(([f, keys]) => keys.filter((k) => !translations[lng][k]).map((k) => `${f}: ${k}`))
    expect(missing('en')).toEqual([])
    expect(missing('es')).toEqual([])
  })
})

describe('a panel, rendered', () => {
  it('shows words, not keys, in English — and Spanish in Spanish', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ seasons: [] }) })))
    lang.language = 'en'
    const en = render(<LeagueHistoryPanel leagueId="l1" />)
    await en.findByText('No past seasons found.')
    expect(en.container.textContent).toContain('History fills in as seasons are completed')
    expect(en.container.textContent).not.toMatch(/\bhistory\.[a-zA-Z]/)
    en.unmount()
    lang.language = 'es'
    const es = render(<LeagueHistoryPanel leagueId="l1" />)
    await es.findByText('No se encontraron temporadas históricas.')
    lang.language = 'en'
    vi.unstubAllGlobals()
  })
})

/* ---------------------------------------------------------------------------------------------- */

/** A fetch stub answering by URL fragment, first match wins. */
function stubFetch(routes: Array<[string, { ok?: boolean; status?: number; body: unknown }]>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const hit = routes.find(([frag]) => String(url).includes(frag))
    if (!hit) throw new Error(`unstubbed fetch ${url}`)
    const { ok = true, status = 200, body } = hit[1]
    return { ok, status, json: async () => body }
  }))
}

/**
 * The English each panel used to hard-code. Word-bounded and case-sensitive, so "AllFantasy" in the
 * dues disclaimer is not "All", and Spanish that happens to share letters cannot trip it.
 */
const FORMER_ENGLISH = [
  'Num of', 'Set number of', 'Division Names', 'Team Assignments', 'Assign...', 'Automatically generate',
  'Unknown', 'Saving...', 'Member Payment Status', 'per team', 'Paid', 'Seasons', 'Mark paid', 'Mark unpaid',
  'Copy invite link', 'Search members', 'All', 'Commissioner', 'Co-owner', 'Orphan', 'Assigned', 'Co-comm',
  'member', 'No teams match', 'Importing historical', 'Retry backfill', 'Historical backfill',
  'Failed to load', 'Request failed', 'Loading',
]
function englishIn(el: HTMLElement): string[] {
  // Each TEXT NODE on its own, never el.textContent: that glues siblings with no separator, so
  // "Auto-nombrado IA" + "Automatically…" reads "IAAutomatically" and the word boundary never
  // matches — the mutation control caught exactly that. Plus placeholders and tooltips.
  const nodes: string[] = []
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n.nodeValue ?? '')
  const attrs = [...el.querySelectorAll('[placeholder],[title]')].flatMap((n) => [n.getAttribute('placeholder') ?? '', n.getAttribute('title') ?? ''])
  const text = [...nodes, ...attrs].join(' | ')
  return FORMER_ENGLISH.filter((w) => new RegExp(`(^|[^A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(text))
}

describe('🛑 the panels’ own hard-coded English is gone in Spanish', () => {
  afterEach(() => { lang.language = 'en'; vi.unstubAllGlobals(); cleanup() })

  it('division settings — headings, the count picker, assignments', async () => {
    stubFetch([['division-settings', { body: {
      isCommissioner: true, isSurvivor: false,
      config: { count: 2, names: ['North', 'South'], teamAssignments: { t1: 0 }, aiNamingEnabled: false, lastUpdatedAt: null, lastUpdatedBy: null },
      teams: [{ id: 't1', teamName: 'Aces', ownerName: 'Pat', avatarUrl: null }, { id: 't2', teamName: null, ownerName: null, avatarUrl: null }],
    } }]])
    lang.language = 'es'
    const r = render(<DivisionSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('Núm. de Divisiones')
    for (const s of ['Establecer número de divisiones para la liga', 'Nombres de Divisiones', 'Asignaciones de Equipos', 'Desconocido', 'Asignar...']) {
      expect(r.container.textContent, s).toContain(s)
    }
    expect(englishIn(r.container)).toEqual([])
    expect(r.container.textContent).not.toMatch(/\bdivision\.[a-zA-Z]/)
  })

  it('division settings — and the same panel still reads English in English', async () => {
    stubFetch([['division-settings', { body: {
      isCommissioner: true, isSurvivor: true,
      config: { count: 0, names: [], teamAssignments: {}, aiNamingEnabled: false, lastUpdatedAt: null, lastUpdatedBy: null },
      teams: [],
    } }]])
    const r = render(<DivisionSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('Num of Tribes')
    expect(r.container.textContent).toContain('Set number of tribes for league')
    expect(r.container.textContent).toContain('No Tribes')
    expect(r.container.textContent).not.toMatch(/\bdivision\.[a-zA-Z]/)
  })

  it('dues tracker — payment status, the paid chip, the mark-paid tooltip', async () => {
    stubFetch([['/dues', { body: {
      isCommissioner: true, isMultiSeason: true, currentSeason: 2026,
      config: { enabled: true, amount: 50, currency: 'USD', paymentLink: null, paymentProvider: null, lastUpdatedAt: null, lastUpdatedBy: null,
        entries: [{ teamId: 't1', paid: true, paidSeasons: [], paidAt: null }] },
      teams: [{ id: 't1', teamName: 'Aces', ownerName: 'Pat', avatarUrl: null }, { id: 't2', teamName: 'Bees', ownerName: 'Lee', avatarUrl: null }],
    } }]])
    lang.language = 'es'
    const r = render(<LeagueDuesTrackerPanel leagueId="l1" />)
    await r.findByText('Estado de Pago de Miembros')
    for (const s of ['Pagado', 'por equipo', 'Temporadas']) expect(r.container.textContent, s).toContain(s)
    expect(r.container.querySelector('[title="Marcar como no pagado"]')).not.toBeNull()
    expect(r.container.querySelector('[title="Marcar como pagado"]')).not.toBeNull()
    expect(englishIn(r.container)).toEqual([])
  })

  it('member settings — invite, search, filter chips, badges, role', async () => {
    stubFetch([
      ['/managers', { body: {
        teams: [{ id: 'a', externalId: 'r1', teamName: 'Aces', ownerName: 'Pat', isCommissioner: true, isCoCommissioner: true, role: 'member' }],
        rosters: [{ id: 'r1', platformUserId: 'u1' }],
        managers: [{ rosterId: 'r1', userId: 'u1', displayName: 'Pat' }],
      } }],
      ['/roster-players', { body: {} }],
    ])
    lang.language = 'es'
    const r = render(<MemberSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('Copiar enlace de invitación')
    for (const s of ['Buscar miembros', 'Todos', 'Comisionado', 'Co-propietario', 'Huérfano', 'Asignado', 'Co-com.', 'miembro']) {
      expect(r.container.textContent, s).toContain(s)
    }
    expect(r.container.querySelector('input[placeholder="Equipo o dueño…"]')).not.toBeNull()
    expect(englishIn(r.container)).toEqual([])
    // An empty filter result speaks Spanish too.
    fireEvent.click(r.getByText('Huérfano'))
    expect(r.container.textContent).toContain('Ningún equipo coincide con este filtro.')
  })

  it('history — the background-import notice', async () => {
    stubFetch([['/history', { body: { seasons: [], historicalBackfill: { status: 'pending', startedAt: null, completedAt: null, error: null } } }]])
    lang.language = 'es'
    const r = render(<LeagueHistoryPanel leagueId="l1" />)
    await r.findByText(/Importando temporadas históricas/)
    expect(englishIn(r.container)).toEqual([])
  })

  it('history — a failed import, and its retry button', async () => {
    stubFetch([['/history', { body: { seasons: [], historicalBackfill: { status: 'failed', startedAt: null, completedAt: null, error: 'timeout' } } }]])
    lang.language = 'es'
    const r = render(<LeagueHistoryPanel leagueId="l1" />)
    await r.findByText('Reintentar importación')
    expect(r.container.textContent).toContain('La importación histórica tuvo un problema: timeout')
    expect(englishIn(r.container)).toEqual([])
  })

  it('co-owner — a load failure is reported in Spanish', async () => {
    stubFetch([['division-settings', { ok: false, status: 500, body: {} }]])
    lang.language = 'es'
    const r = render(<CoOwnerSettingsPanel leagueId="l1" />)
    await r.findByText('No se pudo cargar')
    expect(englishIn(r.container)).toEqual([])
  })
})
