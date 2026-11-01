/**
 * The three Devy import surfaces that stayed English in the Spanish UI: the downloadable audit
 * `.txt`, each conflict's engine description, and the import page header.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'
import { tInterpolate } from '@/lib/i18n/tInterpolate'
import type { ImportAuditSummary } from '@/lib/devy/mergeExecutionEngine'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es', serverLanguage: 'en' as string, session: { user: { id: 'u1' } } as unknown }))

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[h.language]?.[k] ?? dict.en[k] ?? k
  return { useOptionalLanguage: () => ({ language: h.language, t }) }
})
vi.mock('@/hooks/useAfSubGate', () => ({ useAfSubGate: () => ({ handleApiResponse: async () => true }) }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => h.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/preferences/ServerRenderPreferenceResolver', () => ({
  resolveServerRenderPreferences: vi.fn(async () => ({ language: h.serverLanguage, timezone: 'America/New_York' })),
}))

import { formatImportAuditPlainText } from '@/app/devy/lib/formatImportAuditText'
import { localizeConflictDescription } from '@/app/devy/lib/importWizardModel'
import { ImportWizard } from '@/app/devy/components/ImportWizard'

const trFor = (lang: 'en' | 'es') => (key: string, vars?: Record<string, string | number>) =>
  tInterpolate(k => translations[lang]?.[k] ?? translations.en[k] ?? k, key, vars ?? {})

const fullAudit: ImportAuditSummary = {
  playersImported: 12,
  unmatchedPlayers: [{ id: 'p9', name: 'Nobody Known' }],
  conflictsResolved: 2,
  conflictsPending: 1,
  managersMatched: 3,
  managersUnmatched: [{ id: 'm9', label: 'Ghost Manager' }],
  historySeasonsImported: 3,
  picksImported: 40,
  missingImages: ['a', 'b'],
  missingSchoolLogos: ['c'],
  dataConfidenceScore: 'medium',
  notes: ['Some players could not be matched automatically.', 'Some managers need manual linking.', 'Something new from the engine.'],
}
const fullSession = { id: 'S1', status: 'merged', mergedAt: '2026-10-02T00:00:00Z', summary: { a: 1 } }
const emptyAudit: ImportAuditSummary = { ...fullAudit, unmatchedPlayers: [], managersUnmatched: [], notes: [], missingImages: [], missingSchoolLogos: [] }
const emptySession = { id: 'S2', status: 'matching', mergedAt: null }

// Output of the formatter before it took a language (captured from that version, 0d15038ab).
const LEGACY_FULL =
  'ALLFANTASY — DEVY IMPORT AUDIT\n==============================\n\nSession ID: S1\nStatus: merged\nMerged at: 2026-10-02T00:00:00Z\n\n--- Summary ---\nData confidence: medium\nPlayers imported (matched): 12\nConflicts resolved: 2\nConflicts pending: 1\nManagers matched: 3\nHistory seasons imported: 3\nPicks imported (league total): 40\n\n--- Unmatched players ---\n- Nobody Known (p9)\n\n--- Managers needing link ---\n- Ghost Manager (m9)\n\n--- Notes ---\n- Some players could not be matched automatically.\n- Some managers need manual linking.\n- Something new from the engine.\n\n--- Assets ---\nMissing images: 2\nMissing school logos: 1\n\n--- Raw session summary (JSON) ---\n{\n  "a": 1\n}\n\n--- End ---'
const LEGACY_EMPTY =
  'ALLFANTASY — DEVY IMPORT AUDIT\n==============================\n\nSession ID: S2\nStatus: matching\nMerged at: —\n\n--- Summary ---\nData confidence: medium\nPlayers imported (matched): 12\nConflicts resolved: 2\nConflicts pending: 1\nManagers matched: 3\nHistory seasons imported: 3\nPicks imported (league total): 40\n\n--- Unmatched players ---\n(none)\n\n--- Managers needing link ---\n(none)\n\n--- Notes ---\n(none)\n\n--- End ---'

beforeEach(() => {
  h.language = 'en'
  h.serverLanguage = 'en'
})
afterEach(() => cleanup())

describe('audit .txt in the reader’s language', () => {
  it('English is byte-identical to the file written before, with or without options', () => {
    expect(formatImportAuditPlainText(fullAudit, fullSession)).toBe(LEGACY_FULL)
    expect(formatImportAuditPlainText(emptyAudit, emptySession)).toBe(LEGACY_EMPTY)
    const enT = (k: string) => translations.en[k] ?? k
    expect(formatImportAuditPlainText(fullAudit, fullSession, { language: 'en', t: enT })).toBe(LEGACY_FULL)
    expect(formatImportAuditPlainText(emptyAudit, emptySession, { language: 'en' })).toBe(LEGACY_EMPTY)
  })

  it('Spanish labels, status, confidence and known notes; unknown notes pass through', () => {
    const text = formatImportAuditPlainText(fullAudit, fullSession, { language: 'es' })
    const lines = text.split('\n')
    expect(lines[0]).toBe('ALLFANTASY — AUDITORÍA DE IMPORTACIÓN DEVY')
    expect(lines[1]).toBe('='.repeat(lines[0]!.length))
    for (const line of [
      'ID de la sesión: S1',
      'Estado: Combinada',
      'Combinada el: 2026-10-02T00:00:00Z',
      '--- Resumen ---',
      'Confianza de los datos: media',
      'Jugadores importados (emparejados): 12',
      'Conflictos resueltos: 2',
      'Conflictos abiertos: 1',
      'Mánagers vinculados: 3',
      'Temporadas de historial importadas: 3',
      'Selecciones de draft importadas (total de la liga): 40',
      '--- Jugadores sin coincidencia ---',
      '- Nobody Known (p9)',
      '--- Mánagers por vincular ---',
      '- Ghost Manager (m9)',
      '--- Notas ---',
      '- Algunos jugadores no se pudieron emparejar automáticamente.',
      '- Algunos mánagers hay que vincularlos a mano.',
      '- Something new from the engine.',
      '--- Imágenes ---',
      'Fotos de jugadores que faltan: 2',
      'Logos de universidades que faltan: 1',
      '--- Resumen de la sesión sin procesar (JSON) ---',
      '--- Fin ---',
    ]) {
      expect(lines).toContain(line)
    }
    expect(text).not.toMatch(/devyImport\./)
    for (const english of ['Session ID', 'Status:', 'Summary', 'Unmatched players', 'Notes ---', 'End ---', 'Merged at']) {
      expect(text).not.toContain(english)
    }
    const empty = formatImportAuditPlainText(emptyAudit, { ...emptySession, status: 'not_a_status' }, { language: 'es' })
    expect(empty.split('\n').filter(l => l === '(ninguno)')).toHaveLength(3)
    expect(empty).toContain('Estado: not_a_status')
    expect(empty).toContain('Combinada el: —')
  })

  it('the wizard download is Spanish for a Spanish reader, and the “report is in English” note is gone', async () => {
    h.language = 'es'
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      const path = url.pathname + url.search
      const json =
        path === '/api/devy/import?sessionId=S1'
          ? { session: { id: 'S1', leagueId: 'L1', status: 'merged', mergedAt: '2026-10-02T00:00:00Z' } }
          : path === '/api/devy/import/audit?sessionId=S1'
            ? { audit: fullAudit, session: { ...fullSession, summary: null } }
            : { error: 'unhandled' }
      return new Response(JSON.stringify(json), { status: 'error' in json ? 500 : 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    const created: Blob[] = []
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b)
      return 'blob:x'
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    fireEvent.click(await screen.findByTestId('import-audit-download'))
    const text = await created[0]!.text()
    expect(text.split('\n')[0]).toBe('ALLFANTASY — AUDITORÍA DE IMPORTACIÓN DEVY')
    expect(text).toContain('Jugadores importados (emparejados): 12')
    expect(screen.getByTestId('import-step-audit').textContent).not.toContain('inglés')
    click.mockRestore()
  })
})

describe('conflict descriptions', () => {
  const es = trFor('es')
  const en = trFor('en')
  const cases = [
    ['duplicate_player', 'Player ip42 matched from multiple external rows.', 'El jugador ip42 coincide con varias filas de las fuentes.'],
    [
      'graduated_devy_on_nfl_roster',
      'Player Travis Hunter appears as devy and on NFL roster across sources.',
      'Travis Hunter aparece como prospecto devy y en una plantilla de la NFL en las fuentes.',
    ],
    ['username_mismatch', 'Manager Bob (the GM) could not be matched to an AllFantasy user.', 'El mánager Bob (the GM) no se pudo vincular a un usuario de AllFantasy.'],
  ] as const

  it.each(cases)('%s renders in Spanish and stays as written in English', (type, raw, spanish) => {
    expect(localizeConflictDescription(type, raw, es)).toBe(spanish)
    expect(localizeConflictDescription(type, raw, en)).toBe(raw)
  })

  it('unknown wording, or a sentence under another type, falls back to the raw text', () => {
    expect(localizeConflictDescription('username_mismatch', 'Manager Bob could not be matched', es)).toBe('Manager Bob could not be matched')
    expect(localizeConflictDescription('conflicting_picks', 'Sources disagree on 2027 picks.', es)).toBe('Sources disagree on 2027 picks.')
    expect(localizeConflictDescription('duplicate_player', 'Manager Bob could not be matched to an AllFantasy user.', es)).toBe(
      'Manager Bob could not be matched to an AllFantasy user.',
    )
  })

  it('the wizard shows the Spanish description under the Spanish title and hint', async () => {
    h.language = 'es'
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      const path = url.pathname + url.search
      const json =
        path === '/api/devy/import?sessionId=S1'
          ? { session: { id: 'S1', leagueId: 'L1', status: 'conflict_review', mergedAt: null } }
          : path === '/api/devy/import/conflicts?sessionId=S1'
            ? {
                conflicts: [
                  { id: 'c1', conflictType: 'username_mismatch', description: 'Manager Bob could not be matched to an AllFantasy user.', resolution: 'pending' },
                  { id: 'c2', conflictType: 'other_kind', description: 'Something the engine says now.', resolution: 'pending' },
                ],
              }
            : { error: 'unhandled' }
      return new Response(JSON.stringify(json), { status: 'error' in json ? 500 : 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    render(<ImportWizard leagueId="L1" initialSessionId="S1" />)
    expect(await screen.findByTestId('import-conflict-desc-c1')).toHaveTextContent(
      'El mánager Bob no se pudo vincular a un usuario de AllFantasy.',
    )
    expect(screen.getByTestId('import-conflict-c1')).toHaveTextContent('Mánager sin vincular')
    expect(screen.getByTestId('import-conflict-desc-c2')).toHaveTextContent('Something the engine says now.')
  })
})

describe('import page header', () => {
  async function renderPage() {
    const { default: DevyImportPage } = await import('@/app/devy/[leagueId]/import/page')
    const el = await DevyImportPage({ params: Promise.resolve({ leagueId: 'L1' }) })
    render(el)
  }

  it.each([
    ['es', '← Liga', 'Importar'],
    ['en', '← League', 'Import'],
  ] as const)('%s', async (lang, back, title) => {
    h.serverLanguage = lang
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 500 })) as typeof fetch
    await renderPage()
    const link = screen.getByRole('link', { name: back })
    expect(link).toHaveAttribute('href', '/league/L1')
    expect(screen.getByText(title, { selector: 'header span' })).toBeInTheDocument()
  })
})

describe('the new keys', () => {
  const newKeys = Object.keys(translations.en).filter(k => /^devyImport\.(auditText|conflictDesc|page)\./.test(k))

  it('exist in English and Spanish, with matching placeholders and real Spanish', () => {
    expect(newKeys.length).toBe(26)
    for (const k of newKeys) {
      expect(translationsEsParity[k], k).toBeTruthy()
      expect(translations.es[k], k).toBe(translationsEsParity[k])
      const ph = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort()
      expect(ph(translations.es[k]!), k).toEqual(ph(translations.en[k]!))
    }
    expect(newKeys.filter(k => translations.es[k] === translations.en[k])).toEqual([])
  })

  it('every devyImport key is in both languages, and the Spanish never says waiver', () => {
    const en = Object.keys(translations.en).filter(k => k.startsWith('devyImport.'))
    const es = Object.keys(translationsEsParity).filter(k => k.startsWith('devyImport.'))
    expect(es.sort()).toEqual(en.sort())
    for (const k of es) expect(translationsEsParity[k]!.toLowerCase(), k).not.toContain('waiver')
    expect(en).not.toContain('devyImport.audit.downloadNote')
  })
})
