/**
 * The created-league settings hub, in both languages (2026-10-05).
 *
 * 🛑 THE HUB WAS ENGLISH-ONLY: the tab bar (desktop sidebar and mobile chips), the General /
 * Waivers / Trades / Playoffs / Scoring / Roster / Rules / League Helper tabs' own copy, the
 * Commissioner tab's audit placeholder and co-commissioner notice, the duplicate-manager warnings,
 * and the remove-from-AllFantasy panel with its confirm dialog. The editors these tabs embed (draft,
 * roster, playoff, per-sport scoring, devy, best ball, league type) are separate changes.
 *
 * The guard reads every `lsHub.` / `lsModal.` key the files name plus the tab keys built at runtime.
 * The renders click through every tab of the real control center (children it does not own are
 * mocked) and scan each TEXT NODE, title and aria-label for the English the hub used to print.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: { div: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div> },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/hooks/useLeagueSettingsSectionAutosave', () => ({ useLeagueSettingsSectionAutosave: () => ({ queuePatch: vi.fn(), saving: false }) }))
const stub = vi.hoisted(() => (name: string, isDefault = false) => (isDefault ? { default: () => null } : { [name]: () => null }))
vi.mock('@/app/league/[leagueId]/components/LeagueRulesSummarySection', () => stub('LeagueRulesSummarySection'))
vi.mock('@/app/league/[leagueId]/components/ScoringSettingsFullSection', () => stub('ScoringSettingsFullSection'))
vi.mock('@/components/league-settings/PlayoffSettingsEditor', () => stub('PlayoffSettingsEditor'))
vi.mock('@/components/league-settings/RosterSettingsEditor', () => stub('RosterSettingsEditor'))
vi.mock('@/components/league-settings/DraftSettingsCommissionerPanel', () => stub('DraftSettingsCommissionerPanel'))
vi.mock('@/components/league-settings/NflScoringSettingsPanel', () => stub('NflScoringSettingsPanel'))
vi.mock('@/components/league-settings/NbaScoringSettingsPanel', () => stub('NbaScoringSettingsPanel'))
vi.mock('@/components/league-settings/NcaabScoringSettingsPanel', () => stub('NcaabScoringSettingsPanel'))
vi.mock('@/components/league-settings/MlbScoringSettingsPanel', () => stub('MlbScoringSettingsPanel'))
vi.mock('@/components/league-settings/NhlScoringSettingsPanel', () => stub('NhlScoringSettingsPanel'))
vi.mock('@/components/league-settings/NcaafScoringSettingsPanel', () => stub('NcaafScoringSettingsPanel'))
vi.mock('@/components/league-settings/SoccerScoringSettingsPanel', () => stub('SoccerScoringSettingsPanel'))
vi.mock('@/components/devy/settings/DevyLeagueSettingsHub', () => stub('DevyLeagueSettingsHub'))
vi.mock('@/components/league-settings/BestBallSettingsCommissionerPanel', () => stub('BestBallSettingsCommissionerPanel'))
vi.mock('@/components/league/LeagueTypeConfirm', () => stub('LeagueTypeConfirm', true))
vi.mock('@/components/league-settings/CommissionerControlPanel', () => stub('CommissionerControlPanel'))
vi.mock('@/components/league-settings/MemberSettingsCommissionerPanel', () => stub('MemberSettingsCommissionerPanel'))
vi.mock('@/components/league-settings/CoOwnerSettingsPanel', () => stub('CoOwnerSettingsPanel'))
vi.mock('@/components/league-settings/DivisionSettingsCommissionerPanel', () => stub('DivisionSettingsCommissionerPanel'))
vi.mock('@/components/league-settings/LeagueDuesTrackerPanel', () => stub('LeagueDuesTrackerPanel'))
vi.mock('@/components/league-settings/LeagueHistoryPanel', () => stub('LeagueHistoryPanel'))

import { LeagueSettingsControlCenter } from '@/components/league-settings/LeagueSettingsControlCenter'
import { DuplicateManagerWarningsSection } from '@/components/league-settings/DuplicateManagerWarningsSection'
import { DeleteLeagueFromAfPanel } from '@/app/league/[leagueId]/components/DeleteLeagueFromAfPanel'

const ROOT = resolve(__dirname, '..')
const FILES = [
  'components/league-settings/LeagueSettingsControlCenter.tsx', 'components/league-settings/DuplicateManagerWarningsSection.tsx',
  'app/league/[leagueId]/components/DeleteLeagueFromAfPanel.tsx',
  ...['GeneralTab', 'WaiversTab', 'AISettingsTab', 'ConceptRulesTab', 'TradesTab', 'PlayoffsTab', 'ScoringTab', 'RostersTab', 'CommissionerTab'].map((f) => `components/league-settings/tabs/${f}.tsx`),
]
const TAB_IDS = ['general', 'draft', 'roster', 'scoring', 'waivers', 'trades', 'playoffs', 'members', 'notifications', 'permissions', 'commissioner', 'conceptRules', 'ai']

describe('every key the hub names exists in BOTH languages', () => {
  const keys = [...new Set(FILES.flatMap((f) => [...readFileSync(resolve(ROOT, f), 'utf8').matchAll(/['"`]((?:lsHub|lsModal)\.[A-Za-z0-9_.]+)['"`]/g)].map((m) => m[1]!)))]
  it('🛑 read from the files', () => {
    expect(keys.length).toBeGreaterThanOrEqual(70) // the scan must see the real keys
    expect(keys).toEqual(expect.arrayContaining(['lsHub.ai.intro', 'lsHub.del.body1', 'lsHub.dup.title', 'lsHub.cr.note']))
    expect(keys.filter((k) => !translations.en[k])).toEqual([])
    expect(keys.filter((k) => !translations.es[k])).toEqual([])
  })
  it('the tab labels built at runtime (`lsHub.tab.${id}` / `…Short`)', () => {
    const src = readFileSync(resolve(ROOT, FILES[0]!), 'utf8')
    for (const id of TAB_IDS) expect(src, id).toContain(`'${id}'`)
    const missing = TAB_IDS.flatMap((id) => [`lsHub.tab.${id}`, `lsHub.tab.${id}Short`]).filter((k) => !translations.en[k] || !translations.es[k])
    expect(missing).toEqual([])
  })
  it('placeholders match across languages', () => {
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join()
    expect(keys.filter((k) => ph(translations.en[k]!) !== ph(translations.es[k]!))).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------------------- */

function ctx(over: Record<string, unknown> = {}) {
  return {
    league: {
      id: 'l1', name: 'Test League', timezone: 'America/New_York', logoUrl: null, sport: 'NFL', userId: 'u1', settings: {}, teams: [],
      waiverType: 'rolling', waiverBudget: 100, waiverMinBid: 0, waiverHours: 24, tradeReviewHours: 48, tradeDeadlineWeek: 11,
      draftPickTrading: true, playoffTeams: 6, playoffStartWeek: 15, leagueSize: 12, leagueType: 'redraft', guillotineMode: true,
      survivorMode: false, bestBallMode: true, leagueVariant: null,
    },
    displayLeague: { id: 'l1', name: 'Test League', teamCount: 12 },
    userId: 'u1', userTeam: null, sleeperLeagueId: null, platformLeagueId: 'manual-l1', isCommissioner: true, isHeadCommissioner: false,
    sleeperMemberMap: {}, onGoToDraftTab: () => {}, hasAfCommissionerSub: false,
    ...over,
  } as never
}

/** The English the hub used to print. Word-bounded, case-sensitive, per text node / attribute. */
const FORMER_ENGLISH = [
  'Roster', 'Scoring', 'Members', 'Notifications', 'Alerts', 'Permissions', 'Perms', 'Commissioner Intelligence', 'Commish', 'Advanced Rule Support',
  'Rules', 'League Helper', 'Helper', 'League settings sections', 'Basic league notifications', 'Basics', 'Auto-save', 'Changes save automatically',
  'League name', 'Timezone', 'Logo URL', 'Changes apply', 'Waiver type', 'FAAB budget', 'Min bid', 'Waiver period', 'Rolling waivers', 'Reverse standings',
  'Control League Helper settings', 'League helper', 'Waiver watchlist', 'Trade health', 'Manager engagement', 'Draft readiness', 'In-chat setup',
  'Concept snapshot', 'Guillotine', 'Variant', 'On', 'Off', 'Deep specialty rules', 'Best Ball Settings', 'Commissioner concept notes',
  'Allow draft pick trading', 'Review window', 'Trade deadline', 'Quick schedule', 'Playoff teams', 'Playoffs start', 'Stages & brackets',
  'Scoring editor is not available', 'Roster slots and templates', 'Audit Log', 'Audit logging', 'Remove from AllFantasy', 'is limited to the head commissioner',
  'Possible duplicate manager', 'High risk', 'Join on hold', 'existing manager', 'Allow', 'Block', 'Mark as household', 'Request verification',
  'deletes this league', 'Only the AllFantasy account', 'Remove league from AllFantasy', 'This cannot be undone', 'Cancel', 'Remove', 'Close',
]
function englishIn(el: HTMLElement): string[] {
  const parts: string[] = []
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) parts.push(n.nodeValue ?? '')
  for (const e of el.querySelectorAll('[title],[aria-label]')) parts.push(e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? '')
  const hay = parts.join(' | ')
  return FORMER_ENGLISH.filter((x) => new RegExp(`(^|[^A-Za-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(hay))
}

describe('🛑 the hub reads Spanish in Spanish', () => {
  afterEach(() => { lang.language = 'en'; vi.unstubAllGlobals(); cleanup() })

  it.each([
    ['general', ['Básicos', 'Guardado automático', 'Nombre de la liga', 'Zona horaria', 'URL del logo']],
    ['waivers', ['Los cambios se aplican al registro oficial', 'Tipo de waivers', 'Waivers rotativos', 'Orden inverso de la clasificación', 'Presupuesto FAAB', 'Puja mínima', 'Periodo de waivers (h)']],
    ['trades', ['Permitir trades de picks del draft', 'Ventana de revisión (horas)', 'Límite de trades (n.º de semana)']],
    ['playoffs', ['Calendario rápido', 'Equipos en playoffs', 'Inicio de playoffs (semana)', 'Fases y brackets']],
    ['scoring', []],
    ['roster', ['Los puestos y plantillas de roster se guardan']],
    ['notifications', ['Las notificaciones básicas de la liga están en los ajustes de la cuenta.']],
    ['commissioner', ['Registro de auditoría', 'El registro de auditoría está listo', 'Quitar de AllFantasy', 'es solo para el comisionado principal.']],
    ['conceptRules', ['Resumen del formato', 'Guillotina: Activado', 'Survivor: Desactivado', 'Best ball: Activado', 'Variante: —', 'Ajustes de Best Ball', 'Notas del comisionado sobre el formato (fusión JSON)']],
    ['ai', ['Controla los ajustes del Asistente de la liga.', 'Asistente de la liga', 'Lista de seguimiento de waivers', 'Salud de trades', 'Participación de los managers', 'Preparación para el draft']],
  ])('%s', (tab, expected) => {
    lang.language = 'es'
    const r = render(<LeagueSettingsControlCenter ctx={ctx()} />)
    fireEvent.click(r.getAllByTestId(`league-settings-hub-tab-${tab}`)[0]!)
    const text = r.container.textContent ?? ''
    for (const s of expected) expect(text, s).toContain(s)
    // The tab bar itself, in both its forms.
    for (const s of ['Inteligencia del comisionado', 'Reglas avanzadas', 'Comisionado', 'Alertas', 'Permisos', 'Plantilla', 'Puntuación', 'Miembros']) expect(text, s).toContain(s)
    expect(englishIn(r.container)).toEqual([])
  })

  it('the scoring tab, for a sport without an editor', () => {
    lang.language = 'es'
    const r = render(<LeagueSettingsControlCenter ctx={ctx({ league: { ...(ctx() as never as { league: object }).league, sport: 'CURLING' } })} />)
    fireEvent.click(r.getAllByTestId('league-settings-hub-tab-scoring')[0]!)
    expect(r.container.textContent).toContain('El editor de puntuación todavía no está disponible para este deporte.')
    expect(englishIn(r.container)).toEqual([])
  })

  it('the duplicate-manager warnings', async () => {
    lang.language = 'es'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ flags: [
      { id: 'f1', riskLevel: 'high', status: 'pending_review', summary: 'server summary', reasons: [], comparedTeams: [], createdAt: '', commissionerNote: null },
    ] }) })))
    const r = render(<DuplicateManagerWarningsSection leagueId="l1" />)
    await r.findByText('Posible manager duplicado detectado')
    for (const s of ['Riesgo alto', 'Ingreso en espera', 'vs. manager existente', 'Permitir', 'Bloquear', 'Marcar como mismo hogar', 'Solicitar verificación']) {
      expect(r.container.textContent, s).toContain(s)
    }
    expect(englishIn(r.container)).toEqual([])
  })

  it('the remove-from-AllFantasy panel and its confirm dialog', () => {
    lang.language = 'es'
    const r = render(<DeleteLeagueFromAfPanel leagueId="l1" currentUserId="u1" leagueOwnerUserId="u1" />)
    expect(r.container.textContent).toContain('Quitar de AllFantasy borra esta liga de tu panel y los datos de AllFantasy vinculados a esta importación. No la borra ni la archiva en Sleeper, Yahoo, ESPN ni otras plataformas.')
    fireEvent.click(r.getByTestId('delete-league-af-open'))
    for (const s of ['¿Quitar de AllFantasy?', 'Esto no se puede deshacer desde la app.', 'Cancelar', 'Quitar']) expect(r.container.textContent, s).toContain(s)
    expect(englishIn(r.container)).toEqual([])
    cleanup()
    const other = render(<DeleteLeagueFromAfPanel leagueId="l1" currentUserId="u2" leagueOwnerUserId="u1" />)
    expect(other.container.textContent).toContain('Solo la cuenta de AllFantasy que importó esta liga puede quitarla aquí.')
    expect(englishIn(other.container)).toEqual([])
  })

  it('…and the hub still reads English in English, byte for byte where it is pinned', () => {
    const r = render(<LeagueSettingsControlCenter ctx={ctx()} />)
    for (const s of ['Commissioner Intelligence', 'Advanced Rule Support', 'League Helper', 'Commish', 'Alerts', 'Perms', 'Basics', 'Auto-save']) {
      expect(r.container.textContent, s).toContain(s)
    }
    fireEvent.click(r.getAllByTestId('league-settings-hub-tab-commissioner')[0]!)
    expect(r.container.textContent).toContain(
      'Remove from AllFantasy is limited to the head commissioner. Co-commissioners can manage members and settings but cannot start league removal here.',
    )
    cleanup()
    const d = render(<DeleteLeagueFromAfPanel leagueId="l1" currentUserId="u1" leagueOwnerUserId="u1" />)
    expect(d.container.textContent).toContain(
      'Remove from AllFantasy deletes this league from your dashboard and AllFantasy data tied to this import. It does not delete or archive the league on Sleeper, Yahoo, ESPN, or other platforms.',
    )
    expect(d.container.textContent).not.toMatch(/\blsHub\./)
  })
})
