/**
 * Commissioner OS — League Analytics, Reports and Workspace in Spanish (2026-10-06, group C3).
 *
 * Every screen is rendered from REAL loader output, not hand-written strings:
 *   - analytics: `liveAnalyticsClient.getSnapshot()` with only its I/O mocked (the Decision OS hop,
 *     the warehouse reads, the readiness flag), so the KPI labels, the "(last 90d)" window, the
 *     competitive-balance sentences, the calendar week labels and the activity types are the ones
 *     live.ts / warehouseReads.ts / dataWindow.ts actually build. Plus the demo fixture.
 *   - reports: `liveReportsClient` over the real catalog, with history rows whose summaries come from
 *     each template's own `summarise`. Plus the demo fixture.
 *   - workspace: `liveWorkspaceClient` over task rows built by the scanner's real `detect*`
 *     functions (taskSources.ts, operationalTasks.ts).
 * Then every word of the page — text, `title`, `aria-label`, `placeholder` — is read against the
 * screens' own English vocabulary, and English mode is held to what it said before.
 *
 * What is cut from the scan, and why, is listed in `NOT_OURS`.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/commissioner-os',
  useSearchParams: () => new URLSearchParams(),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

// ── The loaders' I/O, and only their I/O ──────────────────────────────────────────────────────
const io = vi.hoisted(() => ({ intelFails: false }))
vi.mock('@/lib/commissioner-ui/liveReadiness', () => ({ isLiveReady: async () => true, setLiveReady: () => {} }))
vi.mock('@/lib/commissioner-ui/resolveActiveLeagueId', () => ({ resolveActiveLeagueId: async () => 'league-1' }))
vi.mock('@/lib/decision-os/behavioral/api/real-data-provider', () => ({ lookbackDays: () => 90 }))
vi.mock('@/lib/commissioner-ui/adapter/transport', () => ({
  callDecisionOS: async (_module: string, path: string) => {
    if (io.intelFails) return { data: null, error: { category: 'upstream_unavailable', message: 'down', moduleId: 'analytics', retryable: true, timestamp: '' } }
    if (path.includes('/trend')) {
      return {
        data: {
          data: { available: true, direction: 'up', magnitude: 3, scoreDelta: 3, previousScore: 61, currentScore: 64, capturedAt: '2026-10-01', comparedToCapturedAt: '2026-09-24' },
        },
        error: null,
      }
    }
    return {
      data: {
        data: {
          leagueEngagementScore: 64,
          participationDistribution: { totalManagers: 7, activeManagers: 5, inactiveManagers: 2, activePercent: 71, inactivePercent: 29 },
          tradeActivity: { tier: 'none', perManagerRate: 0 },
          waiverActivity: { tier: 'moderate', perManagerRate: 1.2 },
        },
      },
      error: null,
    }
  },
}))
const DAY = 86_400_000
const feed = vi.hoisted(() => ({ ageDays: 18 as number | null }))
vi.mock('@/lib/league-history/leagueWarehouseReads', () => ({
  readActivityWindow: async () => ({
    lastActivityAt: feed.ageDays == null ? null : new Date(Date.now() - feed.ageDays * 86_400_000),
    tradeCount: 7,
    waiverCount: 40,
    eventCount: 1234,
  }),
  latestScoredSeason: async () => 2025,
  readSeasonPoints: async () => [
    { teamName: 'Tiburones', pointsFor: 2210.4, pointsAgainst: 1980.2 },
    { teamName: 'Halcones', pointsFor: 1890.1, pointsAgainst: 2105.7 },
  ],
  readSeasonPointsForDistribution: async () => [2210.4, 1890.1],
  readMargins: async () => ({ games: 98, blowouts: 40, oneScore: 22, averageMargin: 21.4 }),
  readSeasonSpread: async () => ({ high: 2210.4, low: 1890.1 }),
  readTitles: async () => ({ titleSeasons: 6, distinctChampions: 4 }),
  readSeasonPointTotals: async () => [{ season: '2024', averagePointsFor: 1900 }, { season: '2025', averagePointsFor: 2000 }],
  readTransactionsByWeek: async () => [
    { weekStart: new Date('2026-08-03T00:00:00Z'), tradeCount: 2, waiverCount: 5 },
    { weekStart: new Date('2026-09-07T00:00:00Z'), tradeCount: 0, waiverCount: 3 },
  ],
  readManagerActivity: async () => [
    { managerName: 'Ana Ruiz', currentCount: 90, priorCount: 80 },
    { managerName: 'Beto Cruz', currentCount: 26, priorCount: 130 },
    { managerName: 'Carla Díaz', currentCount: 13, priorCount: 117 },
  ],
  readActivityMix: async () => [
    { activityType: 'waiver', count: 218 },
    { activityType: 'roster_move', count: 184 },
    { activityType: 'draft_pick', count: 96 },
    { activityType: 'trade', count: 34 },
  ],
  readManagerFingerprints: async () => [
    { managerName: 'Ana Ruiz', aggression: 30, activity: 20, tradeFrequency: 60, riskTolerance: 40, labels: [] },
  ],
  readFingerprintAxisMax: async () => ({ aggression: 45, activity: 38, tradeFrequency: 100, riskTolerance: 63 }),
  readAllTimeRecords: async () => [
    { teamName: 'Tiburones', wins: 50, losses: 30, seasons: 6, titles: 2 },
    { teamName: 'Halcones', wins: 30, losses: 50, seasons: 6, titles: 0 },
  ],
}))
const NOW = new Date()
const reportRows = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('@/lib/commissioner-reports/reportStore', () => ({
  readLastRunByTemplate: async () => new Map(),
  readReportHistory: async () => reportRows.rows,
}))
const taskRows = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('@/lib/commissioner-workspace/taskStore', () => ({
  readLeagueTasks: async () => taskRows.rows,
  hasEverBeenScanned: async () => true,
}))

import { LeagueAnalyticsView } from '@/components/commissioner-os/analytics/LeagueAnalyticsView'
import { ReportsView } from '@/components/commissioner-os/reports/ReportsView'
import { WorkspaceView } from '@/components/commissioner-os/workspace/WorkspaceView'
import { liveAnalyticsClient } from '@/lib/commissioner-ui/analytics/decision-os-client/live'
import { demoAnalyticsClient } from '@/lib/commissioner-ui/analytics/decision-os-client/demo'
import { liveReportsClient } from '@/lib/commissioner-ui/reports/decision-os-client/live'
import { demoReportsClient } from '@/lib/commissioner-ui/reports/decision-os-client/demo'
import { liveWorkspaceClient } from '@/lib/commissioner-ui/workspace/decision-os-client/live'
import { REPORT_TEMPLATES } from '@/lib/commissioner-reports/reportCatalog'
import { detectInactiveManagers, detectNeverImported, detectOrphanTeams, detectStaleImport } from '@/lib/commissioner-workspace/taskSources'
import { detectOperationalConditions } from '@/lib/commissioner-workspace/operationalTasks'
import { decideCoreDepth } from '@/lib/core-app/coreDepthAccess'
import { WORKSPACE_QUEUES } from '@/lib/commissioner-ui/workspace/queues'
import { analyticsDataText, cosLinkText, reportTemplateText, reportText, taskText, workspaceCopy } from '@/lib/commissioner-os/i18n/analyticsCopy'
import { CommissionerFreeUntilNote } from '@/components/commissioner-os/shell/CommissionerFreeUntilNote'
import { commissionerSectionName } from '@/lib/commissioner-os/i18n/shellCopy'
import type { LeagueAnalyticsSnapshot } from '@/lib/commissioner-ui/analytics/decision-os-client'

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\b/
/**
 * The three screens' own English, word by word. The fixture's names (Ana Ruiz, Tiburones…) avoid
 * every one. "No" is not here — it is Spanish too — so the English sentences that start with it are
 * caught by their next word. Nor is "ago": it is Spanish August ("03 ago"); "18 days ago" is caught
 * by "days".
 */
const OWN_EN =
  /\b(Every|Measured|Newest|[Mm]anagers?|This season|Last season|Target|TARGET|Waiver|[Tt]rades?|Points|Season|League|Transactions|Competitive|What this league|All-time|records|fingerprints|Snapshot|Export|Time range|Headline|weeks?|days?|today|yesterday|Engagement|Active|Activity|High|Moderate|Low|None|Blowouts|One-score|Average|Scoring|Title|games|decided|seasons|Report|Templates|History|Status|Format|Generated|View|Download|Share|Unshare|Copy Link|Retry|Related|evidence|Next|Generate|Weekly|Monthly|Manual|Ready|Generating|Failed|Queued|Digest|Recap|Open|In Progress|Waiting|Completed|Archived|Mark|Follow Up|Reopen|Due|Critical|Elevated|Standard|Advisory|Needs Attention|High Priority|Due Soon|tasks?|Today|month|Wk|for|against|and|the|of|is|are|has|have|by|with|rows|Roster|Starting|Recorded|Accepted|team|stopped|connected)\b/

/**
 * Cut from the scan, each for a reason:
 *  - `.af-core-free-until`: the shared lock note (#2084, coreDepthLockCopy) — asserted Spanish on its
 *    own below rather than re-scanned.
 *  - The "Preview data —" banner: C1's PreviewDataBanner.tsx (fix/cos-shell-spanish), shown in demo mode.
 *  - "Decision OS", "CSV", "PDF", "KB": product and format names.
 */
const NOT_OURS = [/Decision OS/g, /\bCSV\b/g, /\bPDF\b/g, /\bKB\b/g]

/** Elements that are not this group's: the shared lock note, and C1's preview banner (PreviewDataBanner.tsx). */
function notOurs(root: HTMLElement): Element[] {
  return [
    ...root.querySelectorAll('.af-core-free-until'),
    ...[...root.querySelectorAll('[role="status"]')].filter((el) => /^Preview data/.test(el.textContent ?? '')),
  ]
}

// No cloneNode: jsdom throws cloning a `background:` shorthand style, so the cuts are subtracted instead.
function pageWords(root: HTMLElement): string {
  const cut = notOurs(root)
  let body = root.textContent ?? ''
  for (const el of cut) body = body.replace(el.textContent ?? '', '')
  const attrs = [...root.querySelectorAll('*')]
    .filter((el) => !cut.some((c) => c.contains(el)))
    .flatMap((el) => ['title', 'aria-label', 'placeholder'].map((a) => el.getAttribute(a)).filter((v): v is string => !!v))
  let text = [body, ...attrs].join('\n')
  for (const re of NOT_OURS) text = text.replace(re, '')
  return text
}

function expectNoEnglish(root: HTMLElement) {
  const words = pageWords(root)
  expect(words.match(OWN_EN)?.[0] ?? null, words).toBeNull()
  expect(words.match(EN_MONTH)?.[0] ?? null, words).toBeNull()
  expect(words.match(EN_DAY)?.[0] ?? null, words).toBeNull()
}

// Every drawer and every queue is opened and re-scanned: ~17s alone, 45s+ beside the whole COS suite.
vi.setConfig({ testTimeout: 120_000 })

const STARTS = new Date('2026-10-15T04:00:00.000Z')
const freeUntil = decideCoreDepth('commissioner_depth', { live: false, startsAt: STARTS, hasPlan: false })

async function liveSnapshot(): Promise<LeagueAnalyticsSnapshot> {
  const res = await liveAnalyticsClient.getSnapshot()
  expect(res.error).toBeNull()
  return res.data!
}

beforeEach(() => {
  io.intelFails = false
  feed.ageDays = 18
})
afterEach(() => {
  cleanup()
  lang.language = 'en'
})

/* ── League Analytics ─────────────────────────────────────────────────────── */

describe('League Analytics in Spanish', () => {
  it('the live page reads Spanish end to end — KPIs, freshness, every chart, legend and aria-label', async () => {
    const snapshot = await liveSnapshot()
    lang.language = 'es'
    const { container } = render(
      <>
        <CommissionerFreeUntilNote access={freeUntil} />
        <LeagueAnalyticsView snapshot={snapshot} dataMode="live" />
      </>,
    )

    // The loader's own KPI row, window number included — translated, not restated.
    expect(container.textContent).toContain('Puntuación de participación de la liga')
    expect(container.textContent).toContain('+3 vs. la captura anterior')
    expect(container.textContent).toContain('Mánagers activos (últimos 90 d)')
    expect(container.textContent).toContain('5 de 7')
    expect(container.textContent).toContain('Ninguna · 7 en total')
    expect(container.textContent).toContain('Actividad de reclamos (últimos 90 d)')
    // Stale freshness: the pinned date with its month in Spanish, the count in the pinned en-US format.
    expect(container.textContent).toMatch(/La actividad más reciente de la liga es del \d{1,2} [a-z]{3} \d{4} \(hace 18 días\)\./)
    expect(container.textContent).toContain('Tenemos 1,234 eventos de esta liga en total.')
    // Charts: legends, calendar week axis, aria-labels.
    expect(container.textContent).toContain('Reclamos')
    expect(container.textContent).toContain('03 ago')
    expect(screen.getByRole('img', { name: /^Transacciones semanales: 03 ago, 5 reclamos y 2 intercambios; 07 sep/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /^Puntos a favor y en contra por equipo: Tiburones, 2210\.4 a favor/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /^Proporción de acciones de la liga por tipo: Reclamo, 218; Movimiento de plantilla, 184; Selección del draft, 96; Intercambio, 34\.$/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /^Récords históricos: Tiburones, 50 victorias y 30 derrotas en 6 temporadas, 2 títulos/ })).toBeTruthy()
    // Competitive balance, from warehouseReads' real sentences.
    expect(container.textContent).toContain('El 41% de los partidos se decidió por 30 puntos o más.')
    expect(container.textContent).toContain('40 de 98')
    expect(container.textContent).toContain('4 equipos distintos han ganado las últimas 6 temporadas.')
    expect(container.textContent).toContain('Totales de la temporada por equipo — 2025.')
    // The comparative call-out, with the Spanish joiner.
    expect(container.textContent).toContain('2 mánagers están por debajo de 5 acciones por semana. Cada uno estaba por encima de 9.1 antes — Beto Cruz y Carla Díaz.')
    // The range switcher and its scope line.
    expect(screen.getByRole('group', { name: 'Rango de tiempo' })).toBeTruthy()
    expect(container.textContent).toContain('2 semanas con actividad')
    // The page's free-until note (C1's CommissionerFreeUntilNote), in Spanish.
    expect(container.querySelector('.af-core-free-until')?.textContent).toMatch(/^Gratis hasta/)

    expectNoEnglish(container)
  })

  it('switching the range keeps the scope line and the buttons Spanish', async () => {
    const snapshot = await liveSnapshot()
    lang.language = 'es'
    const { container } = render(<LeagueAnalyticsView snapshot={snapshot} dataMode="live" />)
    fireEvent.click(screen.getByRole('button', { name: 'Últimas 4 semanas' }))
    expect(container.textContent).toContain('Últimas 2 semanas')
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }))
    expect(container.textContent).toContain('Las 2 temporadas registradas')
    expect(screen.getByRole('button', { name: 'Historial' }).getAttribute('title')).toBe('Cada temporada registrada')
    expectNoEnglish(container)
  })

  it('the degraded and never-recorded states, and the league-wide call-out', async () => {
    io.intelFails = true
    feed.ageDays = null
    const snapshot = await liveSnapshot()
    lang.language = 'es'
    const managerActivity = ['Ana Ruiz', 'Beto Cruz', 'Carla Díaz', 'Dani Paz'].map((managerName, i) => ({
      managerName,
      actionsPerWeek: 1 + i * 0.5,
      priorActionsPerWeek: 10 + i,
    }))
    const { container } = render(<LeagueAnalyticsView snapshot={{ ...snapshot, managerActivity }} dataMode="live" />)
    expect(container.textContent).toContain('La inteligencia de la liga en vivo no está disponible ahora mismo')
    expect(container.textContent).toContain('No hay actividad registrada para esta liga.')
    expect(container.textContent).toContain('4 de 4 mánagers están haciendo menos que antes. El mánager más activo bajó de 13 a 2.5 acciones por semana.')
    expectNoEnglish(container)
  })

  it('a current window and the empty panels say so in Spanish', async () => {
    feed.ageDays = 2
    const snapshot = await liveSnapshot()
    lang.language = 'es'
    const empty = { ...snapshot, transactionsByWeek: [], managerActivity: [], pointsForAgainst: [] }
    const { container } = render(<LeagueAnalyticsView snapshot={empty} dataMode="live" />)
    expect(container.textContent).toMatch(/Medido sobre los últimos 90 días\. Actividad más reciente: \d{1,2} [a-z]{3} \d{4} \(hace 2 días\)\./)
    expect(container.textContent).toContain('Todavía no hay historial semanal de salud para esta liga.')
    expect(container.textContent).toContain('Todavía no hay totales de puntuación para esta liga.')
    expectNoEnglish(container)
  })

  it('the error state translates the adapter message and the fallback', () => {
    lang.language = 'es'
    const a = render(<LeagueAnalyticsView snapshot={null} dataMode="live" errorMessage="The live Decision OS backend is not yet integrated in this environment." />)
    expect(a.container.textContent).toContain('El backend en vivo de Decision OS todavía no está integrado en este entorno.')
    a.unmount()
    const b = render(<LeagueAnalyticsView snapshot={null} dataMode="live" />)
    expect(b.container.textContent).toContain('No se pudo cargar la analítica de la liga en este momento.')
    expectNoEnglish(b.container)
  })

  it('the demo fixture: its KPI and balance words are Spanish, the health chart included', async () => {
    const demo = (await demoAnalyticsClient.getSnapshot()).data!
    lang.language = 'es'
    const { container } = render(<LeagueAnalyticsView snapshot={demo} dataMode="demo" />)
    for (const k of demo.kpis) {
      expect(analyticsDataText(k.label, 'es'), k.label).not.toBe(k.label)
      if (k.trend) expect(analyticsDataText(k.trend.label, 'es'), k.trend.label).not.toBe(k.trend.label)
    }
    for (const m of demo.competitiveBalance) {
      // A bare "142.3 pts" is a number and reads the same; every worded value is translated.
      for (const t of [m.label, m.value, m.interpretation]) if (!/^[\d.,]+ pts$/.test(t)) expect(analyticsDataText(t, 'es'), t).not.toBe(t)
    }
    expect(screen.getByRole('img', { name: /^Salud de la liga por semana\. Esta temporada va de 71 a 84, frente a una meta de/ })).toBeTruthy()
    expect(container.textContent).toContain('Sem. 1')
    expect(container.textContent).toMatch(/META \d+/)
  })

  it('English is unchanged', async () => {
    const snapshot = await liveSnapshot()
    const { container } = render(
      <>
        <CommissionerFreeUntilNote access={freeUntil} />
        <LeagueAnalyticsView snapshot={snapshot} dataMode="live" />
      </>,
    )
    expect(container.textContent).toContain('Active Managers (last 90d)')
    expect(container.textContent).toContain('None · 7 all-time')
    expect(container.textContent).toMatch(/Newest league activity is from [A-Z][a-z]{2} \d{1,2}, \d{4} \(18 days ago\)\./)
    expect(container.textContent).toContain('2 managers are below 5 actions a week. They were each above 9.1 earlier — Beto Cruz and Carla Díaz.')
    expect(screen.getByRole('img', { name: /^Weekly transactions: Aug 03, 5 waiver claims and 2 trades; Sep 07/ })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Time range' })).toBeTruthy()
    expect(container.textContent).toContain('Export CSV')
    expect(container.textContent).toMatch(/Snapshot generated [A-Z][a-z]{2} \d{1,2}, \d{4}/)
    expect(container.querySelector('.af-core-free-until')?.textContent).toMatch(/^Free until/)
    expect(container.textContent).not.toMatch(/Mánagers|Reclamos|Puntuación/)
  })
})

/* ── Reports ──────────────────────────────────────────────────────────────── */

function catalogHistory() {
  const data = { managerActivity: [1, 2, 3], transactionsByWeek: [1, 2], allTimeRecords: [1, 2, 3, 4], seasonComparison: [1, 2], managerFingerprints: [1], activityMix: [1, 2, 3] } as never
  return REPORT_TEMPLATES.map((t, i) => ({
    id: `r-${t.id}`,
    templateId: t.id,
    status: i === 3 ? 'failed' : 'ready',
    format: 'csv',
    generatedAt: new Date(NOW.getTime() - i * DAY),
    generatedByLabel: i === 0 ? 'Scheduled' : 'Ana Ruiz',
    summary: i === 3 ? `${t.name} could not be generated.` : t.summarise(12 + i, data),
    sizeBytes: 2048,
    shareStatus: 'private',
    failureReason: null,
  }))
}

describe('Reports in Spanish', () => {
  it('the live catalog and history read Spanish, the detail dialog included', async () => {
    reportRows.rows = catalogHistory()
    const templates = (await liveReportsClient.getTemplates()).data!
    const history = (await liveReportsClient.getHistory()).data!
    lang.language = 'es'
    render(
      <>
        <CommissionerFreeUntilNote access={freeUntil} />
        <ReportsView templates={templates} history={history} dataMode="live" />
      </>,
    )

    expect(document.body.textContent).toContain('Plantillas de informes')
    expect(document.body.textContent).toContain('Resumen semanal del comisionado')
    expect(document.body.textContent).toContain('Todo lo que un comisionado revisaría un lunes')
    expect(document.body.textContent).toContain('Solo manual')
    expect(screen.getByRole('img', { name: /^Ejecuciones de generación de informes por plantilla/ })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Generar informe' }).length).toBe(REPORT_TEMPLATES.length)
    expectNoEnglish(document.body)

    // Every row's dialog: the summary from `summarise`, the "generated by", the module links.
    for (const [i, button] of screen.getAllByRole('button', { name: 'Ver' }).entries()) {
      fireEvent.click(button)
      const dialog = screen.getByRole('dialog')
      expect(dialog.textContent).toMatch(/Generado el \d{1,2} [a-z]{3} \d{4}, \d{1,2}:\d{2} [ap]\. m\. E[SD]T por (Programado|Ana Ruiz)/)
      if (i === 0) expect(dialog.textContent).toContain('Resumen de 3 mánagers y 2 semanas de transacciones, 12 filas.')
      expectNoEnglish(document.body)
      fireEvent.keyDown(dialog, { key: 'Escape' })
    }
  })

  it('the preview fixture, the simulated generation and the share buttons', async () => {
    const templates = (await demoReportsClient.getTemplates()).data!
    const history = (await demoReportsClient.getHistory()).data!
    lang.language = 'es'
    vi.useFakeTimers()
    try {
      render(<ReportsView templates={templates} history={history} dataMode="demo" />)
      fireEvent.click(screen.getAllByRole('button', { name: 'Generar informe' })[0]!)
      expect(document.body.textContent).toContain('Generando')
      // Open the simulated row while it is generating, then after it finishes.
      fireEvent.click(screen.getAllByRole('button', { name: 'Ver' })[0]!)
      expect(screen.getByRole('dialog').textContent).toContain('Generando resumen semanal del comisionado…')
      expect(screen.getByRole('dialog').textContent).toContain('por Tú')
      await act(async () => {
        vi.advanceTimersByTime(2100)
      })
      const dialog = screen.getByRole('dialog')
      expect(dialog.textContent).toContain('Resumen semanal del comisionado se generó correctamente.')
      fireEvent.click(screen.getByRole('button', { name: 'Compartir' }))
      expect(screen.getByRole('button', { name: 'Dejar de compartir' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Copiar enlace' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Descargar PDF' })).toBeTruthy()
      // The fixture's names stay as written; its prose is Spanish.
      for (const r of history) expect(reportText(r.summary, 'es'), r.summary).not.toBe(r.summary)
      expectNoEnglish(document.body)
    } finally {
      vi.useRealTimers()
    }
  })

  it('empty and error states', () => {
    lang.language = 'es'
    const a = render(<ReportsView templates={[]} history={[]} dataMode="live" />)
    expect(a.container.textContent).toContain('Aún no hay informes.')
    expectNoEnglish(a.container)
    a.unmount()
    const b = render(<ReportsView templates={[]} history={[]} dataMode="live" errorMessage="No active league could be resolved for this session." />)
    expect(b.container.textContent).toContain('No se pudo determinar una liga activa para esta sesión.')
    expectNoEnglish(b.container)
  })

  it('English is unchanged', async () => {
    reportRows.rows = catalogHistory()
    const templates = (await liveReportsClient.getTemplates()).data!
    const history = (await liveReportsClient.getHistory()).data!
    render(<ReportsView templates={templates} history={history} dataMode="live" />)
    expect(document.body.textContent).toContain('Report Templates')
    expect(document.body.textContent).toContain('Weekly Commissioner Digest')
    expect(screen.getAllByRole('button', { name: 'Generate Report' }).length).toBe(REPORT_TEMPLATES.length)
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]!)
    expect(screen.getByRole('dialog').textContent).toMatch(/Generated [A-Z][a-z]{2} \d{1,2}, \d{4}, .* by Scheduled/)
    expect(screen.getByRole('dialog').textContent).toContain('Digest covering 3 managers and 2 weeks of transactions, 12 rows.')
    expect(document.body.textContent).not.toMatch(/Informe|Generado/)
  })
})

/* ── Workspace ────────────────────────────────────────────────────────────── */

function scannerTasks() {
  const now = new Date()
  const candidates = [
    detectStaleImport(new Date(now.getTime() - 20 * DAY), 100, now),
    detectInactiveManagers(
      [{ managerName: 'Ana Ruiz', currentCount: 0 }, { managerName: 'Beto Cruz', currentCount: 0 }, { managerName: 'Carla Díaz', currentCount: 0 }, { managerName: 'Dani Paz', currentCount: 4 }],
      new Date(now.getTime() - 2 * DAY),
      now,
    ),
    detectInactiveManagers([{ managerName: 'Ana Ruiz', currentCount: 0 }], new Date(now.getTime() - 2 * DAY), now),
    detectNeverImported(null, 0),
    detectOrphanTeams(1, 12),
    detectOrphanTeams(7, 12),
    ...detectOperationalConditions(
      {
        leagueId: 'league-1',
        inSeason: true,
        manual: true,
        rostersReadable: true,
        required: 9,
        rosters: [{ id: 'r1', name: 'Tiburones', starters: ['1', '2', '3'] }],
        settings: { tradeDeadlineAt: new Date(now.getTime() + 3 * DAY).toISOString() },
        pending: [{ id: 't1' }],
        scoring: [{ id: 's1', action: 'scoring.recalc.failed', period: '2026-7' }],
      },
      now,
    ),
    ...detectOperationalConditions(
      { leagueId: 'league-1', inSeason: true, manual: true, rostersReadable: false, required: 9, rosters: [], settings: {}, pending: [], scoring: [] },
      now,
    ),
  ].filter((c): c is NonNullable<typeof c> => c != null)
  expect(candidates.length).toBe(11)
  return candidates.map((c, i) => ({
    id: `task-${i}`,
    leagueId: 'league-1',
    sourceKey: c.sourceKey,
    title: c.title,
    description: c.description,
    status: ['open', 'in_progress', 'waiting_on_manager', 'waiting_on_league_vote', 'completed', 'archived'][i % 6],
    priority: c.priority,
    dueAt: c.dueAt ?? null,
    automationCandidate: c.automationCandidate,
    relatedLinks: c.relatedLinks,
    createdAt: new Date(now.getTime() - i * 4 * DAY),
    updatedAt: now,
    lastSeenAt: now,
    resolvedAt: null,
    autoResolvedAt: null,
  }))
}

describe('Workspace in Spanish', () => {
  it('every scanner task, every queue, the age chart and every task drawer read Spanish', async () => {
    taskRows.rows = scannerTasks()
    const tasks = (await liveWorkspaceClient.getTasks()).data!
    for (const t of tasks) {
      expect(taskText(t.title, 'es'), t.title).not.toBe(t.title)
      expect(taskText(t.description, 'es'), t.description).not.toBe(t.description)
    }
    lang.language = 'es'
    render(<WorkspaceView tasks={tasks} dataMode="live" />)
    expect(screen.getByRole('tablist', { name: 'Colas de trabajo' })).toBeTruthy()
    expect(document.body.textContent).toContain('Tareas abiertas por antigüedad')
    expect(screen.getByRole('img', { name: /tareas abiertas agrupadas según el tiempo que llevan abiertas$/ })).toBeTruthy()
    expect(document.body.textContent).toContain('Los datos de la liga dejaron de llegar')
    expect(document.body.textContent).toContain('3 mánagers inactivos durante 14 días')
    expect(document.body.textContent).toContain('Ana Ruiz, Beto Cruz y Carla Díaz no han hecho ningún movimiento')
    expect(document.body.textContent).toContain('Tiburones: 3 de 9 puestos titulares obligatorios están cubiertos.')
    expect(document.body.textContent).toContain('Fecha límite de intercambios: esta fecha límite está publicada')
    expectNoEnglish(document.body)

    // Every task's drawer: its title opens it.
    for (const t of tasks) {
      fireEvent.click(screen.getByRole('button', { name: taskText(t.title, 'es') }))
      const dialog = screen.getByRole('dialog')
      expect(dialog.textContent).toContain('Evidencia relacionada')
      expectNoEnglish(document.body)
      fireEvent.keyDown(dialog, { key: 'Escape' })
    }

    for (const queue of WORKSPACE_QUEUES) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${workspaceCopy('es')!.queue[queue.id]!.label} \\(`) }))
      expectNoEnglish(document.body)
    }
  })

  it('a due date reads in Spanish on the card and in the drawer', async () => {
    taskRows.rows = scannerTasks().filter((t) => t.dueAt)
    const tasks = (await liveWorkspaceClient.getTasks()).data!
    expect(tasks.length).toBe(1)
    lang.language = 'es'
    render(<WorkspaceView tasks={tasks} dataMode="live" />)
    expect(document.body.textContent).toMatch(/Vence el \d{1,2} [a-z]{3}/)
    fireEvent.click(screen.getByRole('button', { name: 'Se acerca una fecha límite registrada de la liga' }))
    expect(screen.getByRole('dialog').textContent).toMatch(/Vence el \d{1,2} de [a-z]+ de \d{4}/)
    expectNoEnglish(document.body)
  })

  it('each queue empty state, and the error state', () => {
    lang.language = 'es'
    const a = render(<WorkspaceView tasks={[]} dataMode="live" />)
    for (const queue of WORKSPACE_QUEUES) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${workspaceCopy('es')!.queue[queue.id]!.label} \\(`) }))
      expect(a.container.textContent).toContain(workspaceCopy('es')!.queue[queue.id]!.emptyTitle)
      expectNoEnglish(a.container)
    }
    a.unmount()
    const b = render(
      <WorkspaceView
        tasks={[]}
        dataMode="live"
        errorMessage="This league has not been scanned yet. The workspace task scan runs daily; an empty list here would claim a clean bill of health nothing has checked."
      />,
    )
    expect(b.container.textContent).toContain('Esta liga todavía no se ha analizado.')
    expectNoEnglish(b.container)
  })

  it('English is unchanged', async () => {
    taskRows.rows = scannerTasks()
    const tasks = (await liveWorkspaceClient.getTasks()).data!
    render(<WorkspaceView tasks={tasks} dataMode="live" />)
    expect(screen.getByRole('tablist', { name: 'Work queues' })).toBeTruthy()
    expect(document.body.textContent).toContain('Open tasks by age')
    expect(document.body.textContent).toContain('League data has stopped arriving')
    expect(document.body.textContent).toContain('In Progress')
    expect(document.body.textContent).not.toMatch(/Colas|Tareas|Vence/)
  })
})

/* ── Every matcher is held to its loader's source ─────────────────────────── */

describe('the translators know the loaders’ exact English', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('live.ts / warehouseReads.ts still write the sentences the analytics matcher reads', () => {
    const live = src('lib/commissioner-ui/analytics/decision-os-client/live.ts')
    for (const s of ["'League Engagement Score'", 'vs previous capture', '` (last ${dataWindow.lookbackDays}d)`', 'label: `Active Managers${win}`', 'label: `Trade Activity${win}`', 'label: `Waiver Activity${win}`', '`${label} · ${allTimeCount} all-time`']) {
      expect(live, s).toContain(s)
    }
    const wh = src('lib/commissioner-ui/analytics/warehouseReads.ts')
    for (const s of ["label: 'Blowouts'", "label: 'One-score games'", "label: 'Average margin'", "label: 'Scoring spread'", "label: 'Title spread'", 'of games were decided by 30 points or more.', 'were decided by under 10 points.', 'Between the highest-scoring team (', 'A different team has won each of the last', "month: 'short', day: '2-digit'"]) {
      expect(wh, s).toContain(s)
    }
    // A sentence the matcher does NOT know comes back unchanged — the control for every `not.toBe` above.
    expect(analyticsDataText('A sentence nobody wrote.', 'es')).toBe('A sentence nobody wrote.')
  })

  it('the timeRange labels the view replaces are still the ones timeRange.ts defines', () => {
    const tr = src('lib/commissioner-ui/analytics/timeRange.ts')
    for (const s of ["label: 'This season'", "label: 'Last 4 weeks'", "label: 'All-time'", '`Last ${', '`All ${', '`Weeks 1–${seasonWeeks}, this season`', '} weeks with activity`']) expect(tr, s).toContain(s)
  })

  it('the deriveChartSeries age bands the workspace translates are still those', () => {
    const d = src('lib/commissioner-ui/charts/deriveChartSeries.ts')
    for (const s of ["label: 'Today'", "label: '1–6 days'", "label: '1–4 weeks'", "label: 'Over a month'"]) expect(d, s).toContain(s)
  })

  it('dates and section names are not re-implemented here', () => {
    expect(commissionerSectionName('Manager Intelligence', 'es')).not.toBe('Manager Intelligence')
    expect(cosLinkText('Manager Intelligence', 'es')).toBe(commissionerSectionName('Manager Intelligence', 'es'))
    expect(cosLinkText('analytics', 'es')).toBe(commissionerSectionName('League Analytics', 'es'))
    expect(cosLinkText('Sam Rivera — Manager Intelligence', 'es')).toBe(`Sam Rivera — ${commissionerSectionName('Manager Intelligence', 'es')}`)
    expect(cosLinkText('analytics', 'en')).toBe('analytics')
  })

  it('reportTemplateText — the exported report-name translator — knows every catalog template', () => {
    for (const t of REPORT_TEMPLATES) expect(reportTemplateText(t.name, 'es'), t.name).not.toBe(t.name)
    expect(reportTemplateText('Weekly Commissioner Digest', 'en')).toBe('Weekly Commissioner Digest')
    expect(reportTemplateText('A template nobody made', 'es')).toBe('A template nobody made')
  })

  it('dates come from pinnedTime', () => {
    // pinnedTime's own Spanish (C1) is what the screens call; this group adds no date formatter.
    expect(src('lib/commissioner-os/i18n/analyticsCopy.ts')).not.toMatch(/Intl\.DateTimeFormat|MONTH_ES|September/)
  })
})
