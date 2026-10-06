/**
 * Commissioner OS's tools in Spanish (2026-10-06) — Automations, Notifications, the Activity Stream,
 * Search, Help and Settings (`components/commissioner-os/{automations,notifications,activity,search,
 * help,settings}` and their pages), from lib/commissioner-os/i18n/toolsCopy.ts.
 *
 * Every screen renders REAL loader output: the live clients themselves run, with only their storage
 * mocked — the automation ledger, the readiness flag, Prisma's league row, and the four upstream
 * modules notifications and activity compose over. The help screen renders the shipped catalog whole,
 * every article expanded. So a loader sentence reworded at its source shows up here as English.
 *
 * Each screen is then scanned — visible text plus every title, aria-label and placeholder — against
 * the screens' English vocabulary, weekdays and months. What is cut before scanning is DATA ONLY, each
 * with its reason in `DATA_TEXT`.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/commissioner-os',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

/* ── Storage only: the loaders above it are the real ones ─────────────────────────────────────── */

const NOW = new Date('2026-10-06T16:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

vi.mock('@/lib/commissioner-ui/liveReadiness', () => ({ isLiveReady: async () => true, setLiveReady: async () => {} }))
vi.mock('@/lib/commissioner-automations/automationLedgerReads', () => ({
  readAutomationAggregates: async () => [
    // ran five hours ago, all good
    { jobType: 'workspace.refreshTasks', totalRuns: 40, successCount: 39, failureCount: 0, skippedCount: 1, lastRunAt: hoursAgo(5), lastRunStatus: 'completed' },
    // the production shape: 2 completed, 249 skipped, silent for weeks → critical, and its last run "was not fully successful"
    { jobType: 'waivers.processLeague', totalRuns: 251, successCount: 2, failureCount: 0, skippedCount: 249, lastRunAt: hoursAgo(24 * 79), lastRunStatus: 'skipped' },
    // a job the catalog does not describe — `describe()`'s fallback copy
    { jobType: 'mystery.job', totalRuns: 3, successCount: 1, failureCount: 2, skippedCount: 0, lastRunAt: hoursAgo(30), lastRunStatus: 'failed' },
    // reports.generateScheduled has no ledger row: the declared-but-never-run zero entry
  ],
  readAutomationRuns: async (jobType: string) => [
    { id: `${jobType}-1`, jobType, leagueId: 'L42', startedAt: hoursAgo(5), durationMs: 1200, status: 'completed', errorMessage: null, metadata: null },
    { id: `${jobType}-2`, jobType, leagueId: null, startedAt: hoursAgo(29), durationMs: 800, status: 'completed', errorMessage: null, metadata: null },
    { id: `${jobType}-3`, jobType, leagueId: 'L42', startedAt: hoursAgo(53), durationMs: null, status: 'skipped', errorMessage: null, metadata: null },
  ],
}))
vi.mock('@/lib/commissioner-ui/league-health/decision-os-client/live', () => ({
  liveLeagueHealthClient: {
    getRisks: async () => ({ data: [{ id: 'r1', severity: 'elevated', description: 'Low engagement — league activity is below healthy levels' }], error: null }),
  },
}))
vi.mock('@/lib/commissioner-ui/recommendations/decision-os-client/live', () => ({
  liveRecommendationsClient: {
    getQueue: async () => ({
      data: [{ id: 'rec1', severity: 'critical', title: 'Find replacement managers for abandoned teams', createdAt: hoursAgo(2).toISOString(), sourceModuleId: 'recommendations' }],
      error: null,
    }),
  },
}))
// Report-template names are the Reports module's (Commissioner OS analytics group); a neutral one here.
vi.mock('@/lib/commissioner-ui/reports/decision-os-client/live', () => ({
  liveReportsClient: {
    getHistory: async () => ({
      data: [
        { id: 'rep1', templateName: 'Digest 7', status: 'failed', failureReason: null, generatedAt: hoursAgo(3).toISOString() },
        { id: 'rep2', templateName: 'Digest 6', status: 'ready', generatedAt: hoursAgo(170).toISOString() },
      ],
      error: null,
    }),
    getTemplates: async () => ({ data: [], error: null }),
  },
}))
vi.mock('@/lib/commissioner-ui/workspace/decision-os-client/live', () => ({
  liveWorkspaceClient: {
    getTasks: async () => ({
      data: [{ id: 't1', title: 'Resolve all pending disputes this week', status: 'completed', updatedAt: hoursAgo(10).toISOString() }],
      error: null,
    }),
  },
}))
vi.mock('@/lib/commissioner-ui/managers/decision-os-client/live', () => ({
  liveManagerIntelligenceClient: { getManagerDirectory: async () => ({ data: [{ id: 'm1', managerName: 'Avery Quinn' }], error: null }) },
}))
vi.mock('@/lib/commissioner-ui/resolveActiveLeagueId', () => ({ resolveActiveLeagueId: async () => 'L42', listActiveLeaguesForUser: async () => [] }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: async () => ({
        name: 'Dynasty Warriors',
        platform: 'sleeper',
        platformLeagueId: '1048576000000000000',
        sport: 'NFL',
        settings: {
          leagueSize: 12,
          season: 2026,
          league_variant: 'DYNASTY_SUPERFLEX',
          isDynasty: true,
          matchup_frequency: 'weekly',
          roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'IR'],
          rosterSettings: { benchSlots: 2, irSlots: 1, taxiSlots: 4 },
          waiverSettings: { waiverType: 'faab', faabBudget: 200 },
          playoffSettings: { playoffTeams: 6, playoffStartWeek: 15 },
          commissionerSettings: { tradeDeadlineWeek: 12 },
          draftSettings: { draftType: 'snake' },
          scoringSettings: { format: 'custom', source: 'sleeper', rules: {} as Record<string, number> },
        },
      }),
    },
  },
}))

import { AutomationCenterView } from '@/components/commissioner-os/automations/AutomationCenterView'
import { NotificationPanel } from '@/components/commissioner-os/notifications/NotificationPanel'
import { ActivityStreamView } from '@/components/commissioner-os/activity/ActivityStreamView'
import { CommissionerSearchPalette } from '@/components/commissioner-os/search/CommissionerSearchPalette'
import { HelpCenterView } from '@/components/commissioner-os/help/HelpCenterView'
import { LeagueSettingsView } from '@/components/commissioner-os/settings/LeagueSettingsView'
import NotificationsPage from '@/app/commissioner-os/notifications/page'
import SearchPage from '@/app/commissioner-os/search/page'
import { CommissionerPlatformProvider, useCommissionerPlatform } from '@/components/commissioner-os/providers/CommissionerPlatformProvider'
import { liveAutomationClient } from '@/lib/commissioner-ui/automations/decision-os-client/live'
import { liveNotificationsClient } from '@/lib/commissioner-ui/notifications/decision-os-client/live'
import { liveActivityClient } from '@/lib/commissioner-ui/activity/decision-os-client/live'
import { liveSearchClient } from '@/lib/commissioner-ui/search/decision-os-client/live'
import { SETTINGS_RESULTS } from '@/lib/commissioner-ui/search/decision-os-client/settingsResults'
import { liveSettingsClient } from '@/lib/commissioner-ui/settings/decision-os-client/live'
import { HELP_ARTICLES, HELP_GLOSSARY } from '@/lib/commissioner-ui/help/helpCatalog'
import { prisma } from '@/lib/prisma'
import type { AutomationCatalogEntry, AutomationExecutionEntry } from '@/lib/commissioner-ui/automations/decision-os-client'
import type { CommissionerActivityEventContract, CommissionerNotificationPayload, CommissionerSearchResultContract } from '@/lib/commissioner-ui/contracts'
import type { LeagueSettingsSnapshot } from '@/lib/commissioner-ui/settings/decision-os-client'
import {
  AUTOMATION_COPY_KEYS,
  HELP_COPY_KEYS,
  LINK_COPY_KEYS,
  SCORING_RULE_KEYS,
  SETTINGS_RESULT_KEYS,
  composedEventText,
  helpText,
  scoringRuleText,
  settingsText,
} from '@/lib/commissioner-os/i18n/toolsCopy'

const ROOT = process.cwd()
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const SETTINGS_READS = 'lib/commissioner-settings/leagueSettingsReads.ts'

/** Every stat key `STAT_LABELS` names, so the scoring list renders all of them. */
const STAT_BLOCK = /const STAT_LABELS[^{]*\{([\s\S]*?)\n\}/.exec(src(SETTINGS_READS))![1]
const STAT_KEYS = [...STAT_BLOCK.matchAll(/\b([a-z][a-z0-9_]*): '([^']+)'/g)].map((m) => m[1])

/* ── The scan ─────────────────────────────────────────────────────────────────────────────────── */

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/
/**
 * The six screens' own English, word by word. Not here, because Spanish keeps them: "Commissioner OS"
 * and "Decision OS" (product names), "Draft", "Playoffs", "Safety", "IR", "FAAB", "TD", "FG", "PAT",
 * "IDP", "QB", "TE", "Devy", "KPI", "PDF", "CSV", "UTC", "stub", "demo".
 */
const OWN_EN =
  /\b(Automations?|Enabled|Disabled|Success|Failure|Skipped|Succeeded|Failed|Run outcomes|Days?|Last ran|success|runs?|View|History|When|Result|Duration|Summary|Notifications?|Unread|Mark|Muted|Mute|Unmute|caught up|Info|Warning|Critical|Healthy|Elevated|Standard|Advisory|Human|System|ago|Just now|Activity|All|Search|Recent|No results|navigate|Recommendations?|Managers?|Tasks?|Reports?|Settings|Pages|Help|Glossary|Read more|Show|Getting Started|Workflows?|Troubleshooting|Guides?|League|Health|Mission Control|Workspace|Scoring|Format|Template|captured|Read-only|Rules|season|Week|Teams|Season|Sport|Matchups|Roster|Bench|Taxi|Waivers?|Playoff teams|Playoffs start|Trade deadline|Draft type|Yes|Passing|Rushing|Receiving|Reception|Fumble|Interception|Sack|Points|Daily|Every|needs attention|ran successfully|generated|scan|batch|processing|generation|Completed|Platform-wide|Unknown|the|and|of|to|is|your|this|with|from|for|not|yet|here)\b/

/** DATA, not the app's words — cut before scanning. */
const DATA_TEXT: Record<string, string> = {
  '[data-scan-skip]': 'test harness controls',
}

function ownText(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement
  for (const sel of Object.keys(DATA_TEXT)) copy.querySelectorAll(sel).forEach((n) => n.remove())
  const attrs = [...copy.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap((n) => [
    n.getAttribute('title') ?? '',
    n.getAttribute('aria-label') ?? '',
    n.getAttribute('placeholder') ?? '',
  ])
  const nodes: string[] = []
  const walker = copy.ownerDocument.createTreeWalker(copy, 4 /* NodeFilter.SHOW_TEXT */)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n.textContent ?? '')
  return [copy.textContent ?? '', nodes.join(' '), ...attrs].join(' | ')
}

function expectSpanish(out: string, label: string) {
  expect(out, label).not.toMatch(EN_DAY)
  expect(out, label).not.toMatch(EN_MONTH)
  const hit = out.match(OWN_EN)
  expect(hit?.[0] ?? null, `${label}: …${hit ? out.slice(Math.max(0, hit.index! - 80), hit.index! + 80) : ''}…`).toBeNull()
}

afterEach(() => {
  cleanup()
  lang.language = 'en'
  window.localStorage.clear()
})

/* ── Real loader output ────────────────────────────────────────────────────────────────────────── */

let catalog: AutomationCatalogEntry[] = []
let historyById: Record<string, AutomationExecutionEntry[]> = {}
let notifications: CommissionerNotificationPayload[] = []
let events: CommissionerActivityEventContract[] = []
let searchIndex: CommissionerSearchResultContract[] = []
let snapshot: LeagueSettingsSnapshot | null = null

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)

  // Every labelled stat, plus one nobody has labelled (its raw key is data and stays).
  const rules = Object.fromEntries([...STAT_KEYS.map((k, i) => [k, (i % 7) - 2 || 0.5]), ['bonus_unlabelled', 1]])
  const findFirst = prisma.league.findFirst as unknown as () => Promise<{ settings: { scoringSettings: { rules: Record<string, number> } } }>
  const row = await findFirst()
  row.settings.scoringSettings.rules = rules
  ;(prisma.league as unknown as { findFirst: () => Promise<unknown> }).findFirst = async () => row

  catalog = (await liveAutomationClient.getCatalog()).data!
  for (const a of catalog) historyById[a.id] = (await liveAutomationClient.getExecutionHistory(a.id)).data!
  notifications = (await liveNotificationsClient.getNotifications()).data!
  events = (await liveActivityClient.getEvents()).data!
  searchIndex = (await liveSearchClient.getIndex()).data!
  snapshot = (await liveSettingsClient.getSnapshot()).data
})

/* ── The loaders' English is what the copy keys on ────────────────────────────────────────────── */

describe('every loader string the screens show has Spanish', () => {
  it('the fixtures exercise what they claim (positive control)', () => {
    expect(catalog.map((a) => a.id).sort()).toEqual(['mystery.job', 'reports.generateScheduled', 'waivers.processLeague', 'workspace.refreshTasks'])
    expect(notifications.length).toBeGreaterThanOrEqual(5)
    expect(events.map((e) => e.type).sort()).toEqual(
      ['automation_executed', 'automation_failed', 'recommendation_created', 'report_failed', 'report_generated', 'risk_detected', 'task_completed'].sort()
    )
    expect(snapshot?.scoring.rules.length).toBe(STAT_KEYS.length + 1)
    expect(STAT_KEYS.length).toBeGreaterThan(50)
  })

  it('each automation key is verbatim in the live automation client', () => {
    const live = src('lib/commissioner-ui/automations/decision-os-client/live.ts').replace(/'\s*\+\s*'/g, '')
    // The catalog's prose is split across lines in the source: compare on collapsed whitespace.
    const flat = live.replace(/\s+/g, ' ')
    for (const key of AUTOMATION_COPY_KEYS) expect(flat, key).toContain(key)
  })

  it('every help article and glossary entry translates', () => {
    const strings = [
      ...HELP_ARTICLES.flatMap((a) => [a.title, a.summary, a.body]),
      ...HELP_GLOSSARY.flatMap((g) => [g.term, g.definition]),
    ]
    for (const s of strings) expect(HELP_COPY_KEYS, s.slice(0, 60)).toContain(s)
    for (const s of strings) expect(helpText(s, 'es'), s.slice(0, 60)).not.toBe(s)
    for (const label of HELP_ARTICLES.flatMap((a) => a.relatedLinks ?? []).map((l) => l.label)) expect(LINK_COPY_KEYS).toContain(label)
  })

  it('every settings-search result, group, entry and scoring label translates', () => {
    for (const r of SETTINGS_RESULTS) expect(SETTINGS_RESULT_KEYS).toContain(r.title)
    const SAME_IN_SPANISH = new Set(['IR', 'Draft', 'Playoffs', 'Safety', 'FG 0-19', 'FG 20-29', 'FG 30-39', 'FG 40-49', 'FG 50+'])
    for (const g of snapshot!.groups) {
      for (const s of [g.label, g.description, ...g.entries.map((e) => e.label)]) {
        if (!SAME_IN_SPANISH.has(s)) expect(settingsText(s, 'es'), s).not.toBe(s)
      }
    }
    const labelled = snapshot!.scoring.rules.filter((r) => r.label !== r.stat)
    expect(labelled.length).toBe(STAT_KEYS.length)
    for (const r of labelled) expect(SCORING_RULE_KEYS, r.label).toContain(r.label)
    for (const r of labelled) if (!SAME_IN_SPANISH.has(r.label)) expect(scoringRuleText(r.label, 'es'), r.label).not.toBe(r.label)
  })

  it('the composed notification and activity sentences are translated whole', () => {
    for (const text of [...notifications.map((n) => n.message), ...events.map((e) => e.summary)]) {
      expect(composedEventText(text, 'es'), text).not.toBe(text)
    }
  })
})

/* ── The screens, in Spanish ───────────────────────────────────────────────────────────────────── */

function OpenService({ id }: { id: 'notifications' | 'search' }) {
  const { openService } = useCommissionerPlatform()
  return <button type="button" data-scan-skip onClick={() => openService(id)} />
}

function clickAll(root: ParentNode, selector: string, match: RegExp) {
  for (const el of [...root.querySelectorAll<HTMLElement>(selector)]) if (match.test(el.textContent ?? '')) fireEvent.click(el)
}

/**
 * The Automation Center, with League task scan's history dialog open, read once per run with that
 * run's detail expanded (one detail row is open at a time). Returns the text of every read, joined —
 * scan text for Spanish, plain text for English.
 */
function renderAutomations(read: (root: HTMLElement) => string): string {
  render(<AutomationCenterView catalog={catalog} historyByAutomationId={historyById} dataMode="live" />)
  const card = [...document.body.querySelectorAll<HTMLElement>('[role="group"]')].find((g) =>
    /League task scan|Revisión de tareas de la liga/.test(g.textContent ?? '')
  )!
  const open = [...card.querySelectorAll('button')].find((b) => /Ver historial|View History/.test(b.textContent ?? ''))!
  fireEvent.click(open)
  const reads = [read(document.body)]
  const rows = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"] tr[role="button"]')]
  expect(rows.length).toBe(3)
  for (const row of rows) {
    fireEvent.click(row)
    reads.push(read(document.body))
  }
  return reads.join(' | ')
}

describe('Spanish: every screen reads Spanish, with no English left', () => {
  it('Automations — catalog, charts, health, the history dialog with each run expanded', () => {
    lang.language = 'es'
    const out = renderAutomations(ownText)
    expectSpanish(out, 'automations')
    expect(out).toContain('Revisión de tareas de la liga')
    expect(out).toContain('Procesamiento de reclamos por lotes')
    expect(out).toContain('Generación de informes programados')
    expect(out).toContain('Cada día a las 08:40 UTC, una revisión por liga')
    expect(out).toContain('Última ejecución: 6 oct · 100% de éxito en 40 ejecuciones')
    expect(out).toContain('Resultados de las ejecuciones')
    expect(out).toContain('Desactivar Revisión de tareas de la liga')
    expect(out).toContain('historial de ejecuciones')
    expect(out).toContain('Omitida: ya se completó en esta ventana')
    expect(out).toContain('Liga L42')
    expect(out).toContain('Ejecución para toda la plataforma')
    // the job nobody described keeps its job-type name (data) and gets the fallback copy in Spanish
    expect(out).toContain('aún no está descrita en el catálogo del Centro de automatizaciones')
    expect(out).toContain('Revisión de tareas de la liga: historial de ejecuciones')
    expect(out).toContain('Crítico')
  })

  it('Notifications — the panel, its rows and the mute preferences, plus the page', () => {
    lang.language = 'es'
    render(
      <CommissionerPlatformProvider>
        <OpenService id="notifications" />
        <NotificationPanel notifications={notifications} />
      </CommissionerPlatformProvider>
    )
    act(() => {
      fireEvent.click(document.body.querySelector('[data-scan-skip]')!)
    })
    let out = ownText(document.body)
    expectSpanish(out, 'notifications panel')
    expect(out).toContain('Procesamiento de reclamos por lotes: necesita atención; su última ejecución no salió del todo bien.')
    expect(out).toContain('Digest 7: no se pudo generar. No se produjo ningún archivo parcial.')
    expect(out).toContain('Busca mánagers de reemplazo para los equipos abandonados')
    expect(out).toContain('Revisar automatización')
    expect(out).toContain('Marcar todo como leído')
    expect(out).toMatch(/hace \d+ h/)

    fireEvent.click(document.body.querySelector('[aria-label="Preferencias de notificaciones"]')!)
    out = ownText(document.body)
    expectSpanish(out, 'notification preferences')
    expect(out).toContain('Fuentes silenciadas')
    expect(out).toContain('Silenciar')
    cleanup()

    lang.language = 'es'
    render(
      <CommissionerPlatformProvider>
        <NotificationsPage />
      </CommissionerPlatformProvider>
    )
    out = ownText(document.body)
    expectSpanish(out, 'notifications page')
    expect(out).toContain('Abrir notificaciones')
  })

  it('Activity Stream — the tabs, every event, the source and initiator labels', () => {
    lang.language = 'es'
    const { container } = render(<ActivityStreamView events={events} dataMode="live" />)
    const out = ownText(container)
    expectSpanish(out, 'activity')
    expect(out).toContain('Revisión de tareas de la liga: se ejecutó correctamente.')
    expect(out).toContain('mystery.job: falló en su última ejecución.')
    expect(out).toContain('Digest 6: se generó correctamente.')
    expect(out).toContain('Resuelve todas las disputas pendientes esta semana')
    expect(out).toContain('Ver en Salud de la liga')
    expect(out).toContain('Iniciado por una persona')
    expect(out).toContain('Origen de la actividad')
  })

  it('Search — the palette with every category, and the page', () => {
    lang.language = 'es'
    render(
      <CommissionerPlatformProvider>
        <CommissionerSearchPalette index={searchIndex} />
      </CommissionerPlatformProvider>
    )
    act(() => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    })
    let out = ownText(document.body)
    // A manager's name is data.
    out = out.replaceAll('Avery Quinn', '')
    expectSpanish(out, 'search palette')
    for (const s of ['Páginas', 'Centro de control', 'Ayuda y centro de conocimiento', 'Reglas de puntuación', 'Revisión de tareas de la liga', 'Bienvenido a Commissioner OS', 'Artículos de ayuda', 'Buscar en Commissioner OS...', 'Intro para elegir']) {
      expect(out).toContain(s)
    }
    cleanup()

    lang.language = 'es'
    render(
      <CommissionerPlatformProvider>
        <SearchPage />
      </CommissionerPlatformProvider>
    )
    out = ownText(document.body)
    expectSpanish(out, 'search page')
    expect(out).toContain('Abrir búsqueda')
  })

  it('Help — every article expanded and the whole glossary', () => {
    lang.language = 'es'
    const { container } = render(<HelpCenterView articles={HELP_ARTICLES} glossary={HELP_GLOSSARY} dataMode="live" />)
    clickAll(container, 'button[aria-expanded="false"]', /Leer más/)
    expect(container.querySelectorAll('button[aria-expanded="true"]').length).toBe(HELP_ARTICLES.length)
    const out = ownText(container)
    expectSpanish(out, 'help')
    expect(out).toContain('Primeros pasos')
    expect(out).toContain('Glosario')
    expect(out).toContain('Ver el Centro de automatizaciones')
  })

  it('Help — a Spanish search finds a Spanish article, and an English one still finds it', () => {
    lang.language = 'es'
    const { container } = render(<HelpCenterView articles={HELP_ARTICLES} glossary={[]} dataMode="live" />)
    const input = container.querySelector('input[type="search"]')!
    fireEvent.change(input, { target: { value: 'flujo de actividad' } })
    expect(container.textContent).toContain('Cómo leer el Flujo de actividad')
    fireEvent.change(input, { target: { value: 'Reading the Activity' } })
    expect(container.textContent).toContain('Cómo leer el Flujo de actividad')
  })

  it('Settings — groups, entries, the scoring list in full, provenance and the read-only note', () => {
    lang.language = 'es'
    const { container } = render(<LeagueSettingsView snapshot={snapshot} dataMode="live" />)
    clickAll(container, 'button', /Ver las \d+ reglas/)
    // Data: the league's name and its titleised platform values, and a stat nobody has labelled.
    let out = ownText(container)
    for (const data of ['Dynasty Warriors', 'Dynasty Superflex', 'Nfl', 'bonus_unlabelled']) out = out.replaceAll(data, '')
    expectSpanish(out, 'settings')
    for (const s of [
      'Reglas tal como se importaron de Sleeper · 1048576000000000000 · temporada 2026',
      'Solo lectura aquí: cámbialas en Sleeper',
      'Plantilla',
      'Inicio de los playoffs',
      'Semana 15',
      'Semana 12',
      'Serpiente',
      'Semanal',
      'Sí',
      'Personalizado',
      'Yardas por pase',
      'reglas capturadas',
      '— no capturado',
    ]) {
      expect(out).toContain(s)
    }
  })

  it('Settings — an unreadable league reads its error in Spanish', () => {
    lang.language = 'es'
    const { container } = render(<LeagueSettingsView snapshot={null} dataMode="live" />)
    expect(container.textContent).toContain('No se pudo cargar la configuración de esta liga ahora mismo.')
    cleanup()
    lang.language = 'es'
    const again = render(<LeagueSettingsView snapshot={null} dataMode="live" errorMessage="No active league could be resolved for this session." />)
    expect(again.container.textContent).toContain('No se pudo determinar una liga activa para esta sesión.')
  })
})

/* ── English is unchanged ──────────────────────────────────────────────────────────────────────── */

describe('English: the same screens read exactly as before', () => {
  it('Automations', () => {
    const out = renderAutomations((root) => root.textContent ?? '')
    expect(out).toContain('League task scan')
    expect(out).toContain('Last ran Oct 6 · 100% success over 40 runs')
    expect(out).toContain('Run outcomes')
    expect(out).toContain(
      "A skip is the idempotency guard finding the window's work already done — not a failure. It is shown separately because a job that skips constantly is telling you something different from one that fails."
    )
    expect(out).toContain('League task scan — Execution History')
    expect(out).toContain('Skipped — already completed for this window')
    expect(out).toContain('League L42')
    expect(document.body.querySelector('[aria-label="Disable League task scan"]')).not.toBeNull()
  })

  it('Notifications, Activity and Search', () => {
    render(
      <CommissionerPlatformProvider>
        <OpenService id="notifications" />
        <NotificationPanel notifications={notifications} />
      </CommissionerPlatformProvider>
    )
    act(() => {
      fireEvent.click(document.body.querySelector('[data-scan-skip]')!)
    })
    let out = document.body.textContent ?? ''
    expect(out).toContain('Waiver batch processing needs attention — its last run was not fully successful.')
    expect(out).toContain('Mark all as read')
    expect(out).toMatch(/\d+h ago/)
    cleanup()

    const { container } = render(<ActivityStreamView events={events} dataMode="live" />)
    out = container.textContent ?? ''
    expect(out).toContain('League task scan ran successfully.')
    expect(out).toContain('View in League Health')
    cleanup()

    render(
      <CommissionerPlatformProvider>
        <CommissionerSearchPalette index={searchIndex} />
      </CommissionerPlatformProvider>
    )
    act(() => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    })
    out = document.body.textContent ?? ''
    for (const s of ['Pages', 'Mission Control', 'Scoring rules', 'Help Articles', '↑↓ to navigate · Enter to select · Esc to close']) expect(out).toContain(s)
  })

  it('Help and Settings', () => {
    const { container } = render(<HelpCenterView articles={HELP_ARTICLES} glossary={HELP_GLOSSARY} dataMode="live" />)
    expect(container.textContent).toContain('Welcome to Commissioner OS')
    expect(container.textContent).toContain('Getting Started')
    cleanup()
    const settings = render(<LeagueSettingsView snapshot={snapshot} dataMode="live" />)
    clickAll(settings.container, 'button', /Show all \d+ rules/)
    const out = settings.container.textContent ?? ''
    expect(out).toContain('Rules as imported from Sleeper · 1048576000000000000 · 2026 season')
    expect(out).toContain('Read-only here — change these on Sleeper')
    expect(out).toContain('Week 15')
    expect(out).toContain('Snake')
    expect(out).toContain(`${snapshot!.scoring.ruleCount} rules captured`)
    expect(out).toContain('Passing yards')
  })
})
