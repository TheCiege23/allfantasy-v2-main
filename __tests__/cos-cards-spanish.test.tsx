/**
 * Commissioner OS cards and the four screens built from them, in Spanish (2026-10-06):
 * components/commissioner-os/{cards,recommendations,league-health,managers,networks}.
 *
 * Every screen is rendered in Spanish from REAL loader output — the demo and stub clients'
 * fixtures as they are, and the live clients' sentences built exactly as their source builds them.
 * The live sentences come from functions that are not exported (`toRisks`, `toEvidencePoints`,
 * `titleFor`, `riskFlagFor`) and from the behavioural pipeline, which needs a database, so each one
 * is held to its source file verbatim instead: a reworded loader sentence fails here rather than
 * silently going English.
 *
 * Then the whole render is scanned — text, `title`, `aria-label`, `placeholder` — for the screens'
 * English vocabulary, weekdays and months. The one thing cut out is C1's `PreviewDataBanner`, which
 * is not this group's (`dataMode="live"` keeps it off the page). Demo names (Sam Rivera, Priya
 * Natarajan, Blue Ridge Bandits …) stay, and avoid every word in the scan.
 *
 * English mode is asserted unchanged at the end.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

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

import { RecommendationsView } from '@/components/commissioner-os/recommendations/RecommendationsView'
import { LeagueHealthView } from '@/components/commissioner-os/league-health/LeagueHealthView'
import { ManagerIntelligenceView } from '@/components/commissioner-os/managers/ManagerIntelligenceView'
import { CommissionerNetworks } from '@/components/commissioner-os/networks/CommissionerNetworks'
import {
  AlertCard,
  SummaryCard,
  RecommendationCard,
  ActivityMixDonut,
  AllTimeRecordChart,
  DistributionBarChart,
  ManagerFingerprintRadar,
} from '@/components/commissioner-os/cards'
import { demoRecommendationsClient } from '@/lib/commissioner-ui/recommendations/decision-os-client/demo'
import { stubRecommendationsClient } from '@/lib/commissioner-ui/recommendations/decision-os-client/stub'
import { demoLeagueHealthClient } from '@/lib/commissioner-ui/league-health/decision-os-client/demo'
import { stubLeagueHealthClient } from '@/lib/commissioner-ui/league-health/decision-os-client/stub'
import { demoManagerIntelligenceClient } from '@/lib/commissioner-ui/managers/decision-os-client/demo'
import { stubManagerIntelligenceClient } from '@/lib/commissioner-ui/managers/decision-os-client/stub'
import type { CommissionerRecommendationContract, CommissionerRecommendationStatus } from '@/lib/commissioner-ui/contracts'
import type { LeagueHealthDetail, LeagueHealthEvidencePoint, LeagueHealthRisk } from '@/lib/commissioner-ui/league-health/decision-os-client'
import type { ManagerDnaProfile } from '@/lib/commissioner-ui/managers/decision-os-client/types'
import { cardsCopy, cosLoaderText } from '@/lib/commissioner-os/i18n/cardsCopy'

const source = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8')

/**
 * Same harness as commissioner-os-charts-render: only the responsive container gets a chart-sized box.
 * Per test, because `vi.unstubAllGlobals()` after each one also takes the ResizeObserver stub away.
 */
beforeEach(() => {
  class RO {
    constructor(private cb: ResizeObserverCallback) {}
    observe(el: Element) {
      this.cb(
        [{ target: el, contentRect: { width: 880, height: 360, top: 0, left: 0, bottom: 360, right: 880, x: 0, y: 0, toJSON: () => ({}) } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', RO)
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const big = this.classList?.contains('recharts-responsive-container')
    const width = big ? 880 : 60
    const height = big ? 360 : 20
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  }
})

afterEach(() => {
  cleanup()
  lang.language = 'en'
  vi.unstubAllGlobals()
})

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/
/** The screens' own English and the loaders' English, word by word. Demo names avoid every one. */
const OWN_EN =
  /\b(Critical|Elevated|Standard|Advisory|Healthy|Positive|confidence|[Ss]ignal|New|Viewed|Progress|Completed|Dismissed|Expired|Automated|Deferred|Resolved|View evidence|Dismiss|Other|Wins|Losses|Value|Aggression|Activity|Trading|Risk|risk|queue|Queue|severity|History|Nothing|caught up|No open|Score|score|What drives|narrative|Engagement|engagement|Retention|retention|Commissioner|commissioner|Managers?|managers?|window|Analysis|Category|Severity|Age|Recommendations?|recommendations?|Participation|participation|Data quality|Inputs|pipeline|No active|good shape|Couldn|isn’t|history|Behavioral|Rising|Steady|Declining|Consistent|gaps|Reliability|Tenure|seasons?|Unify|[Nn]etworks?|leagues?|Leagues?|host|member|Cancel|Delete|Edit|Loading|Attention|workspace|audit|Unknown|trades?|Trade|waiver|lineup|check-in|Send|Include|Set Up|Test|Stub|Act|inactive|active|deadline|Standings|the|and|is|are|has|have|with|of|for|this|on)\b/

/** Every visible string and every text-bearing attribute, so a `title` or `aria-label` cannot hide English. */
function allText(root: HTMLElement): string {
  const attrs = [...root.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap((el) =>
    ['title', 'aria-label', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  )
  return [root.textContent ?? '', ...attrs].join('\n')
}

function expectNoEnglish(root: HTMLElement) {
  const text = allText(root)
  const own = text.match(OWN_EN)
  expect(own?.[0] ?? null, `English left: "${own?.[0]}" in …${own ? text.slice(Math.max(0, own.index! - 60), own.index! + 60) : ''}…`).toBeNull()
  expect(text).not.toMatch(EN_DAY)
  expect(text).not.toMatch(EN_MONTH)
}

describe('the scan can fail', () => {
  it('catches English in text, in an aria-label, in a title and in a month', () => {
    for (const html of ['<p>Risk Analysis</p>', '<div aria-label="3 recommendations by severity"></div>', '<span title="View evidence"></span>', '<p>4 Oct</p>']) {
      const el = document.createElement('div')
      el.innerHTML = html
      expect(() => expectNoEnglish(el), html).toThrow()
    }
    const ok = document.createElement('div')
    ok.innerHTML = '<p>Análisis de riesgos · 4 oct · Sam Rivera</p>'
    expect(() => expectNoEnglish(ok)).not.toThrow()
  })
})

/* ── Live loader output, built as the source builds it ───────────────────────── */

/** recommendations/decision-os-client/live.ts — RECOMMENDATION_TITLES. */
const LIVE_TITLES = [
  'Managers at risk of leaving',
  'Inactive managers need outreach',
  'Trade activity has stalled',
  'Waiver wire is going unused',
  'Weekly recap would lift engagement',
]
/** behavioral/league-intelligence.ts — the recommendation messages, as templates. */
const liveMessages = (n: number) => [
  `${n} manager(s) are at critical risk of abandoning the league. Direct outreach is recommended immediately.`,
  `${n} manager(s) have not been active recently. Reach out to re-engage them before they abandon the league.`,
  'No trades have been made this season. Consider hosting a trade block or starting a league chat topic to spark activity.',
  'No waiver claims have been made. Post a waiver wire recap to show managers what is available.',
  'Post a weekly recap to highlight top performances and keep managers engaged.',
]
/** behavioral/league-intelligence.ts — healthNarrative, every branch. */
const liveNarrative = [
  '9 of 12 managers are active',
  'No manager data available',
  'No managers have recorded any activity',
  '7 of 12 managers are inactive',
  '2 manager(s) at critical retention risk',
  '1 manager(s) need engagement',
  'League is highly engaged across all activity types',
  'Strong manager participation this season',
  'High trade activity indicates strong manager investment',
  'Managers are actively working the waiver wire',
]
/** league-health/decision-os-client/live.ts — toRisks, every branch. */
const LIVE_RISKS: LeagueHealthRisk[] = [
  { id: 'risk-retention', category: 'Retention', severity: 'critical', description: 'League-wide retention risk is critical.' },
  { id: 'risk-retention-2', category: 'Retention', severity: 'elevated', description: 'League-wide retention risk is medium.' },
  { id: 'risk-workload', category: 'Commissioner load', severity: 'critical', description: 'This league is asking critical attention of its commissioner right now.' },
  { id: 'risk-participation', category: 'Participation', severity: 'elevated', description: '3 of the 9 managers seen in this window are no longer active in it.' },
  { id: 'risk-participation-1', category: 'Participation', severity: 'elevated', description: '1 of the 9 managers seen in this window is no longer active in it.' },
  { id: 'risk-participation-0', category: 'Participation', severity: 'critical', description: '1 of the 1 manager seen in this window is no longer active in it.' },
]
const LIVE_EVIDENCE: LeagueHealthEvidencePoint[] = [
  { label: 'Engagement Summary', detail: liveNarrative[0]! },
  { label: 'Top Concern', detail: liveNarrative[4]! },
  { label: 'Standout Signal', detail: liveNarrative[7]! },
  ...liveNarrative.slice(1).map((detail, i) => ({ label: i % 2 ? 'Top Concern' : 'Standout Signal', detail })),
]

describe('the live sentences are the loaders’ own, verbatim', () => {
  it('recommendation titles and messages', () => {
    const live = source('lib', 'commissioner-ui', 'recommendations', 'decision-os-client', 'live.ts')
    for (const title of LIVE_TITLES) expect(live).toContain(`'${title}'`)
    const pipeline = source('lib', 'decision-os', 'behavioral', 'league-intelligence.ts')
    expect(pipeline).toContain('`${criticalRiskManagers} manager(s) are at critical risk of abandoning the league. Direct outreach is recommended immediately.`')
    expect(pipeline).toContain('`${inactiveManagers} manager(s) have not been active recently. Reach out to re-engage them before they abandon the league.`')
    for (const fixed of liveMessages(0).slice(2)) expect(pipeline).toContain(`'${fixed}'`)
  })

  it('the health narrative', () => {
    const pipeline = source('lib', 'decision-os', 'behavioral', 'league-intelligence.ts')
    for (const t of [
      '`${activeManagers} of ${totalManagers} managers are active`',
      "'No manager data available'",
      "'No managers have recorded any activity'",
      '`${inactiveManagers} of ${totalManagers} managers are inactive`',
      '`${criticalRiskManagers} manager(s) at critical retention risk`',
      '`${inactiveManagers} manager(s) need engagement`',
      ...liveNarrative.slice(6).map((s) => `'${s}'`),
    ])
      expect(pipeline).toContain(t)
  })

  it('league health risks, evidence labels and manager flags', () => {
    const lh = source('lib', 'commissioner-ui', 'league-health', 'decision-os-client', 'live.ts')
    for (const t of [
      "category: 'Retention'",
      "category: 'Commissioner load'",
      "category: 'Participation'",
      '`League-wide retention risk is ${bandLabel(intel.retentionRisk).toLowerCase()}.`',
      '`This league is asking ${bandLabel(intel.commissionerWorkload).toLowerCase()} attention of its commissioner right now.`',
      "`${quiet} of the ${totalManagers} manager${totalManagers === 1 ? '' : 's'} seen in this window ${quiet === 1 ? 'is' : 'are'} no longer active in it.`",
      "{ label: 'Engagement Summary'",
      "{ label: 'Top Concern'",
      "{ label: 'Standout Signal'",
      "low: 'Low'",
      "medium: 'Medium'",
      "high: 'High'",
      "critical: 'Critical'",
      "?? 'Unknown'",
    ])
      expect(lh).toContain(t)
    const mgr = source('lib', 'commissioner-ui', 'managers', 'decision-os-client', 'live.ts')
    expect(mgr).toContain("'Major inactivity detected — may benefit from a personal check-in'")
    expect(mgr).toContain("'Engagement declining over recent periods — may benefit from a personal check-in'")
    expect(source('lib', 'commissioner-managers', 'managerNames.ts')).toContain("UNKNOWN_MANAGER_NAME = 'Unknown manager'")
  })

  it('the chart labels and all-clear sentences', () => {
    const charts = source('lib', 'commissioner-ui', 'charts', 'deriveChartSeries.ts')
    for (const t of ["critical: 'Critical'", "elevated: 'Elevated'", "advisory: 'Advisory'", "standard: 'Standard'", "positive: 'Positive'", "'Active in window'", "'Quiet in window'"])
      expect(charts).toContain(t)
    const allClear = source('lib', 'commissioner-ui', 'allClear.ts')
    for (const t of [
      '`Couldn’t load ${listName}.`',
      "'That isn’t the same as having none. Try again shortly.'",
      "'League health isn’t available yet, so this isn’t a verdict on the league.'",
      "`League health is ${healthTier === 'critical' ? 'critical' : 'elevated'}, so an empty list isn’t the whole picture.`",
    ])
      expect(allClear).toContain(t)
  })
})

/* ── Fixtures ────────────────────────────────────────────────────────────────── */

const ALL_STATUSES: CommissionerRecommendationStatus[] = ['new', 'viewed', 'in_progress', 'completed', 'dismissed', 'expired', 'automated', 'deferred', 'resolved']

async function everyRecommendation(): Promise<CommissionerRecommendationContract[]> {
  const demo = (await demoRecommendationsClient.getQueue()).data!
  const stub = (await stubRecommendationsClient.getQueue()).data!
  const live: CommissionerRecommendationContract[] = LIVE_TITLES.map((title, i) => ({
    id: `live-${i}`,
    title,
    rationale: liveMessages(i + 1)[i]!,
    severity: (['critical', 'elevated', 'standard', 'standard', 'advisory'] as const)[i]!,
    category: 'engagement',
    sourceModuleId: 'recommendations',
    createdAt: new Date().toISOString(),
  }))
  // Every lifecycle status, on a demo recommendation each, so every badge is drawn.
  const statuses = ALL_STATUSES.map((status, i) => ({ ...demo[i % demo.length]!, id: `status-${status}`, status }))
  return [...demo, ...stub, ...live, ...statuses]
}

/* ── Spanish ─────────────────────────────────────────────────────────────────── */

describe('Recommendations in Spanish', () => {
  it('the queue: tabs, the severity donut, every card, every status, confidence and severity', async () => {
    lang.language = 'es'
    const recs = await everyRecommendation()
    const { container } = render(<RecommendationsView recommendations={recs} dataMode="live" />)
    expect(screen.getByRole('tab', { name: 'Cola' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Historial' })).toBeTruthy()
    expect(screen.getByRole('tablist', { name: 'Vista de recomendaciones' })).toBeTruthy()
    expect(screen.getByText('Cola abierta por gravedad')).toBeTruthy()
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toMatch(/^\d+ recomendaciones por gravedad$/)
    expect(screen.getAllByText('Mánagers en riesgo de irse').length).toBeGreaterThan(0)
    expect(screen.getByText('2 mánagers no han estado activos recientemente. Contáctalos para recuperarlos antes de que abandonen la liga.')).toBeTruthy()
    expect(screen.getAllByText('Sam Rivera no ha enviado su alineación a tiempo dos semanas seguidas, tras una gran primera mitad.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Confianza alta · Un contacto personal ya ha resuelto casos parecidos en esta liga').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Contactar' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Elevado').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Aplazada').length).toBeGreaterThan(0)
    expectNoEnglish(container)

    fireEvent.click(screen.getByRole('tab', { name: 'Historial' }))
    for (const s of ['Completada', 'Descartada', 'Caducada', 'Resuelta']) expect(screen.getAllByText(s).length).toBeGreaterThan(0)
    expectNoEnglish(container)
  })

  it('the empty queue and the empty archive', () => {
    lang.language = 'es'
    const { container } = render(<RecommendationsView recommendations={[]} dataMode="live" />)
    expect(screen.getByText('Estás al día.')).toBeTruthy()
    expect(screen.getByText('No hay recomendaciones abiertas.')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Historial' }))
    expect(screen.getByText('Nada archivado recientemente.')).toBeTruthy()
    expectNoEnglish(container)
  })

  it('a card with evidence and dismiss controls', () => {
    lang.language = 'es'
    const { container } = render(
      <RecommendationCard
        title="Trade deadline approaching"
        rationale="Four teams have not made a roster move in over three weeks, with the deadline 9 days out."
        severity="advisory"
        confidence="developing_signal"
        primaryActionLabel="Send Reminder"
        status="in_progress"
        onPrimaryAction={() => {}}
        onDismiss={() => {}}
        onViewEvidence={() => {}}
      />,
    )
    expect(screen.getByRole('group', { name: 'Se acerca la fecha límite de intercambios' })).toBeTruthy()
    expect(screen.getByText('Señal en desarrollo')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver evidencia' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy()
    expect(screen.getByText('En curso')).toBeTruthy()
    expect(screen.getByText('Aviso')).toBeTruthy()
    expectNoEnglish(container)
  })
})

const demoDetail = async () => (await demoLeagueHealthClient.getHealthDetail()).data!

describe('League Health in Spanish', () => {
  it('the demo league: score, drivers, KPIs, risks, recommendations, participation and data quality', async () => {
    lang.language = 'es'
    const [risks, evidence, recs] = await Promise.all([
      demoLeagueHealthClient.getRisks(),
      demoLeagueHealthClient.getEvidence(),
      demoLeagueHealthClient.getRecommendations(),
    ])
    const { container } = render(
      <LeagueHealthView detail={await demoDetail()} risks={risks.data!} evidence={evidence.data!} recommendations={recs.data!} dataMode="live" />,
    )
    for (const s of [
      'Puntuación de salud de la liga',
      'Qué determina esta puntuación',
      'Alineaciones a tiempo',
      '11 de 12 equipos pusieron su alineación a tiempo esta semana',
      '7 intercambios completados esta temporada, por encima del promedio de 5 de la liga en 3 temporadas',
      'Puntuación de participación',
      'Riesgo de abandono',
      'Carga del comisionado',
      'Mánagers activos en la ventana',
      '11 de 12',
      'Análisis de riesgos',
      'Sam Rivera (Blue Ridge Bandits) no ha enviado su alineación a tiempo dos semanas seguidas',
      '14 d',
      'Recomendaciones',
      'Participación de los mánagers',
      'Calidad de los datos',
      'Datos disponibles',
    ])
      expect(screen.getAllByText(s).length, s).toBeGreaterThan(0)
    expect(screen.getByLabelText('11 de 12 mánagers vistos activos en la ventana de inteligencia')).toBeTruthy()
    expect(container.textContent).toContain('Activos en la ventana')
    expectNoEnglish(container)
  })

  it('live risks and evidence, every branch', async () => {
    lang.language = 'es'
    const { container } = render(
      <LeagueHealthView
        detail={{ ...(await demoDetail()), tier: 'elevated', retentionRisk: 'critical', commissionerWorkload: 'elevated', participation: { activeManagers: 6, totalManagers: 9 } }}
        risks={LIVE_RISKS}
        evidence={LIVE_EVIDENCE}
        recommendations={[]}
        dataMode="live"
      />,
    )
    for (const s of [
      'El riesgo de abandono en toda la liga es crítico.',
      'El riesgo de abandono en toda la liga es medio.',
      'Esta liga exige ahora una atención crítica de su comisionado.',
      '3 de los 9 mánagers vistos en esta ventana ya no están activos en ella.',
      '1 de los 9 mánagers vistos en esta ventana ya no está activo en ella.',
      '1 de 1 mánager visto en esta ventana ya no está activo en ella.',
      'Retención',
      'Resumen de participación',
      '9 de 12 mánagers están activos',
      '2 mánagers en riesgo crítico de abandono',
      '1 mánager necesita más participación',
      'Gran participación de los mánagers esta temporada',
      'Inactivos en la ventana',
      // the all-clear for an empty list while health is poor
      'La salud de la liga está en nivel elevado, así que una lista vacía no lo cuenta todo.',
    ])
      expect(container.textContent, s).toContain(s)
    expectNoEnglish(container)
  })

  it('every all-clear: unread lists, no reading, critical, healthy', async () => {
    lang.language = 'es'
    const base = await demoDetail()
    const unread = render(<LeagueHealthView detail={base} risks={[]} evidence={[]} recommendations={[]} dataMode="live" risksRead={false} recommendationsRead={false} />)
    expect(unread.container.textContent).toContain('No se pudieron cargar los riesgos.')
    expect(unread.container.textContent).toContain('No se pudieron cargar las recomendaciones.')
    expect(unread.container.textContent).toContain('Eso no significa que no haya nada. Vuelve a intentarlo en un momento.')
    expect(unread.container.textContent).toContain('No hubo señales narrativas disponibles para esta liga.')
    expectNoEnglish(unread.container)
    cleanup()
    const none = render(<LeagueHealthView detail={base} risks={[]} evidence={[]} recommendations={[]} dataMode="live" detailAvailable={false} />)
    expect(none.container.textContent).toContain('La salud de la liga aún no está disponible, así que esto no es un veredicto sobre la liga.')
    expectNoEnglish(none.container)
    cleanup()
    const critical = render(<LeagueHealthView detail={{ ...base, tier: 'critical' }} risks={[]} evidence={[]} recommendations={[]} dataMode="live" />)
    expect(critical.container.textContent).toContain('La salud de la liga está en nivel crítico, así que una lista vacía no lo cuenta todo.')
    expectNoEnglish(critical.container)
    cleanup()
    const healthy = render(<LeagueHealthView detail={base} risks={[]} evidence={[]} recommendations={[]} dataMode="live" />)
    expect(healthy.container.textContent).toContain('No hay riesgos activos.')
    expect(healthy.container.textContent).toContain('La liga está en buena forma.')
    expectNoEnglish(healthy.container)
  })

  it('the stub fixtures', async () => {
    lang.language = 'es'
    const [d, r, e] = await Promise.all([stubLeagueHealthClient.getHealthDetail(), stubLeagueHealthClient.getRisks(), stubLeagueHealthClient.getEvidence()])
    const { container } = render(<LeagueHealthView detail={d.data!} risks={r.data!} evidence={e.data!} recommendations={[]} dataMode="live" />)
    expect(container.textContent).toContain('Un mánager inactivo durante más de 3 semanas')
    expectNoEnglish(container)
  })
})

describe('Manager Intelligence in Spanish', () => {
  it('the demo directory, the stub, and the live shape', async () => {
    lang.language = 'es'
    const demo = (await demoManagerIntelligenceClient.getManagerDirectory()).data!
    const stub = (await stubManagerIntelligenceClient.getManagerDirectory()).data!
    const live: ManagerDnaProfile[] = [
      { id: 'l1', managerName: 'Unknown manager', engagementReliability: 'unreliable', riskFlag: 'Major inactivity detected — may benefit from a personal check-in' },
      { id: 'l2', managerName: 'Rook', engagementReliability: 'inconsistent', engagementTrend: 'declining', riskFlag: 'Engagement declining over recent periods — may benefit from a personal check-in' },
      { id: 'l3', managerName: 'Bishop', engagementReliability: 'reliable', engagementTrend: 'steady' },
    ]
    const { container } = render(<ManagerIntelligenceView managers={[...demo, ...stub.map((m) => ({ ...m, managerName: 'Knight' })), ...live]} dataMode="live" />)
    for (const s of [
      'Antigüedad: 3 temporadas',
      'Antigüedad: 1 temporada',
      'En alza',
      'En descenso',
      'Estable',
      'Fiabilidad: 96',
      'Fiabilidad: Muchas ausencias',
      'Fiabilidad: Algunas ausencias',
      'Fiabilidad: Constante',
      'El que más intercambia esta temporada: 7 intercambios completados',
      'Su participación baja desde hace 2 semanas: podría venirle bien un contacto personal',
      'El mánager activo sin interrupción desde hace más tiempo: 4.ª temporada',
      'Se unió hace poco como cocomisionado',
      'Mánager desconocido',
      'Inactividad importante detectada: podría venirle bien un contacto personal',
      'Su participación baja en los últimos periodos: podría venirle bien un contacto personal',
      'Priya Natarajan',
    ])
      expect(container.textContent, s).toContain(s)
    expectNoEnglish(container)
  })

  it('the empty directory', () => {
    lang.language = 'es'
    const { container } = render(<ManagerIntelligenceView managers={[]} dataMode="live" />)
    expect(screen.getByText('Aún no hay historial de mánagers.')).toBeTruthy()
    expectNoEnglish(container)
  })

  it('a real manager name is never run through a sentence translator', () => {
    lang.language = 'es'
    render(<ManagerIntelligenceView managers={[{ id: 'x', managerName: 'Act', tenureSeasons: 1 }]} dataMode="live" />)
    expect(screen.getByText('Act')).toBeTruthy()
  })
})

const NETWORKS = {
  eligibleLeagues: [{ id: 'lg1', name: 'Iron Horse Dynasty', sport: 'NFL' }],
  networks: [
    {
      id: 'n1',
      name: 'Sunday Crew',
      members: [
        { leagueId: 'lg1', role: 'host', label: null, league: { id: 'lg1', name: 'Iron Horse Dynasty', sport: 'NFL' } },
        { leagueId: 'lg2', role: 'member', label: null, league: { id: 'lg2', name: 'Harbor Kings', sport: 'NFL' } },
      ],
      queue: [{ id: 't1', leagueId: 'lg1', title: 'Rook', priority: 'standard', status: 'open' }],
      history: [{ id: 'h1', leagueId: 'lg2', summary: 'Rook', type: 'x', occurredAt: '2026-10-04T16:00:00.000Z' }],
    },
    { id: 'n2', name: 'Quiet Crew', members: [], queue: [], history: [] },
  ],
}

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch)
}

describe('Commissioner networks in Spanish', () => {
  it('the form, a network with its leagues, queue and history, the empty lists, and the delete confirm', async () => {
    lang.language = 'es'
    stubFetch(NETWORKS)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const { container } = render(<CommissionerNetworks />)
    expect(screen.getByText('Cargando redes…')).toBeTruthy()
    await screen.findByText('Sunday Crew')
    for (const s of [
      'Redes de comisionado',
      'Crear red',
      'Nombre de la red',
      'Ligas miembro (la primera liga seleccionada es la anfitriona)',
      'Ligas',
      '· anfitriona',
      '· miembro',
      'Cola de atención',
      '(estándar)',
      'Historial reciente',
      '4 oct',
      'No hay tareas abiertas registradas en el espacio de trabajo.',
      'No hay historial de auditoría registrado.',
    ])
      expect(container.textContent, s).toContain(s)
    expectNoEnglish(container)

    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]!)
    expect(confirm).toHaveBeenCalledWith('¿Eliminar esta red? Sus ligas y los datos de las ligas se conservan.')
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0]!)
    expect(screen.getByText('Editar red')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Guardar red' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy()
    expectNoEnglish(container)
  })

  it('no league to link, and an error from the route', async () => {
    lang.language = 'es'
    stubFetch({ eligibleLeagues: [], networks: [] })
    const first = render(<CommissionerNetworks />)
    await screen.findByText('Aún no tienes una liga que se pueda vincular.')
    expectNoEnglish(first.container)
    cleanup()
    stubFetch({ error: 'Unauthorized' }, false)
    const second = render(<CommissionerNetworks />)
    expect((await screen.findByRole('alert')).textContent).toBe('No autorizado')
    expectNoEnglish(second.container)
  })

  it('every route error and form fallback has Spanish', () => {
    const route = source('app', 'api', 'commissioner', 'networks', 'route.ts')
    const errors = [...route.matchAll(/error: '([^']+)'/g)].map((m) => m[1]!)
    expect(errors.length).toBeGreaterThan(5)
    const own = source('components', 'commissioner-os', 'networks', 'CommissionerNetworks.tsx')
    const fallbacks = [...own.matchAll(/\?\? '([^']+)'\)|new Error\('([^']+)'\)|: '([^']+)'\)/g)].map((m) => m[1] ?? m[2] ?? m[3]).filter(Boolean) as string[]
    expect(fallbacks.length).toBeGreaterThan(2)
    for (const e of [...errors, ...fallbacks]) expect(cardsCopy(e, 'es'), e).not.toBe(e)
  })
})

describe('the cards’ own words in Spanish', () => {
  it('AlertCard and SummaryCard: severity badges and a health-engine alert', () => {
    lang.language = 'es'
    const { container } = render(
      <div>
        <AlertCard message="URGENT: Unresolved disputes accumulating. Commissioner action required." severity="critical" />
        <AlertCard message="3 inactive managers — engagement at risk" severity="elevated" />
        <SummaryCard title="Salud" status="positive" summary="—" />
        <SummaryCard title="Salud" status="standard" summary="—" />
      </div>,
    )
    expect(container.textContent).toContain('URGENTE: se acumulan disputas sin resolver.')
    expect(container.textContent).toContain('3 mánagers inactivos: la participación está en riesgo')
    for (const s of ['Crítico', 'Elevado', 'Saludable', 'Estándar']) expect(screen.getAllByText(s).length, s).toBeGreaterThan(0)
    expectNoEnglish(container)
  })

  it('the charts: the donut fold, the record legend, the bar default and the radar axes', () => {
    lang.language = 'es'
    const many = Array.from({ length: 9 }, (_, i) => ({ label: `Tipo ${i}`, value: 10 - i }))
    const records = [{ teamName: 'Harbor Kings', wins: 40, losses: 20, seasons: 5, titles: 1 }]
    const managers = [{ managerName: 'Rook', aggression: 10, activity: 5, tradeFrequency: 20, riskTolerance: 3, labels: [] }]
    const { container } = render(
      <div>
        <ActivityMixDonut slices={many} ariaLabel="x" />
        <AllTimeRecordChart records={records} ariaLabel="x" />
        <DistributionBarChart data={[{ label: '1', value: 2 }]} ariaLabel="x" />
        <ManagerFingerprintRadar managers={managers} axisMax={{ aggression: 45, activity: 38, tradeFrequency: 100, riskTolerance: 63 }} ariaLabel="x" />
      </div>,
    )
    for (const s of ['Otros', 'Victorias', 'Derrotas', 'Agresividad', 'Actividad', 'Intercambios', 'Riesgo']) expect(container.textContent, s).toContain(s)
    expectNoEnglish(container)
  })

  it('the tooltip sentences the charts build', () => {
    expect(cardsCopy('Harbor Kings — 5 seasons, 1 title', 'es')).toBe('Harbor Kings — 5 temporadas, 1 título')
    expect(cardsCopy('Harbor Kings — 1 season, 2 titles', 'es')).toBe('Harbor Kings — 1 temporada, 2 títulos')
    expect(cardsCopy('12 of 45', 'es')).toBe('12 de 45')
    expect(cardsCopy('Value', 'es')).toBe('Valor')
  })

  it('unknown text passes through, and health-engine text still reaches commissionerOsText', () => {
    expect(cosLoaderText('Something new from the backend', 'es')).toBe('Something new from the backend')
    expect(cosLoaderText('League health is excellent', 'es')).toBe('La salud de la liga es excelente')
    expect(cardsCopy('Something new', 'es')).toBe('Something new')
  })
})

/* ── English is unchanged ────────────────────────────────────────────────────── */

describe('English mode is unchanged', () => {
  it('reads exactly the English it always did', async () => {
    lang.language = 'en'
    const recs = await everyRecommendation()
    const r = render(<RecommendationsView recommendations={recs} dataMode="live" />)
    for (const s of ['Open queue by severity', 'Queue', 'History', 'Managers at risk of leaving', 'High confidence · A personal check-in has resolved similar patterns in this league before', 'Send Check-In', 'Deferred', 'Elevated'])
      expect(r.container.textContent, s).toContain(s)
    expect(within(r.container).getByRole('tablist', { name: 'Recommendation view' })).toBeTruthy()
    cleanup()

    const [risks, evidence] = await Promise.all([demoLeagueHealthClient.getRisks(), demoLeagueHealthClient.getEvidence()])
    const lh = render(<LeagueHealthView detail={await demoDetail()} risks={[...risks.data!, ...LIVE_RISKS]} evidence={evidence.data!} recommendations={[]} dataMode="live" />)
    for (const s of [
      'League Health Score',
      'What drives this score',
      'Engagement score',
      'Retention risk',
      'Commissioner load',
      'Managers active in window',
      '11 of 12',
      'Risk Analysis',
      '14d',
      'League-wide retention risk is critical.',
      'Healthy',
      'How much of what the intelligence pipeline wanted for this league it actually had. A property of the inputs, not a confidence rating for any single finding above.',
      'No open recommendations.',
      'The league is in good shape.',
    ])
      expect(lh.container.textContent, s).toContain(s)
    expect(lh.container.querySelector('[aria-label="11 of 12 managers seen active in the intelligence window"]')).toBeTruthy()
    cleanup()

    const m = render(<ManagerIntelligenceView managers={(await demoManagerIntelligenceClient.getManagerDirectory()).data!} dataMode="live" />)
    for (const s of ['Tenure: 3 seasons', 'Tenure: 1 season', 'Rising', 'Reliability: 96', 'Most active trader this season — 7 completed trades'])
      expect(m.container.textContent, s).toContain(s)
    cleanup()

    stubFetch(NETWORKS)
    const n = render(<CommissionerNetworks />)
    await screen.findByText('Sunday Crew')
    for (const s of ['Commissioner networks', 'Create network', 'Leagues', '· host', '(standard)', 'Attention queue', 'Oct 4', 'Edit', 'Delete'])
      expect(n.container.textContent, s).toContain(s)
  })
})
