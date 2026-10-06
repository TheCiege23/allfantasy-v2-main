/**
 * Commissioner OS's shell and Mission Control in Spanish (2026-10-06) — group C1 of the five
 * Commissioner OS / player-card Spanish PRs.
 *
 * Renders the sidebar, the header (league picker, data-mode picker, bell), the breadcrumbs, the
 * access notice, the preview banner, the error state, the AF Commissioner lock and its "Free until"
 * note, and Mission Control on the stub and demo fixtures plus a live-shaped reading built from the
 * Mission Control loader's own sentences. Every visible word and every `title` / `aria-label` /
 * `placeholder` is read against the shell's English vocabulary, weekdays and months.
 *
 * What is deliberately NOT scanned, and why:
 * - `DEMO_PROSE` — the demo and stub fixtures' own sentences (a driver, manager callouts, an
 *   analytics headline). Seeded content stays as written; the app's words around it are Spanish.
 * - The cards' own words (components/commissioner-os/cards — group C2) and the activity summaries
 *   (the activity loader — group C4) are not this group's; the scan reads this group's vocabulary.
 *
 * The server-built sentences translated at render are held to their loaders' source text verbatim
 * below, so a reworded loader fails here rather than silently going English.
 */
import React from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
const nav = vi.hoisted(() => ({ pathname: '/commissioner-os' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
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

import { CommissionerOSProviders } from '@/components/commissioner-os/providers/CommissionerOSProviders'
import { CommissionerSidebar } from '@/components/commissioner-os/shell/CommissionerSidebar'
import { CommissionerHeader } from '@/components/commissioner-os/shell/CommissionerHeader'
import { CommissionerBreadcrumbs } from '@/components/commissioner-os/shell/CommissionerBreadcrumbs'
import { CommissionerAccessNotice } from '@/components/commissioner-os/shell/CommissionerAccessNotice'
import { CommissionerDepthLocked } from '@/components/commissioner-os/shell/CommissionerDepthLocked'
import { CommissionerFreeUntilNote } from '@/components/commissioner-os/shell/CommissionerFreeUntilNote'
import { LeagueSelector } from '@/components/commissioner-os/shell/LeagueSelector'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import { ErrorState } from '@/components/commissioner-os/states'
import { MissionControlView, type MissionControlViewProps } from '@/components/commissioner-os/mission-control/MissionControlView'
import { shortDate, mediumDate, longDate, dateTime } from '@/components/commissioner-os/primitives/pinnedTime'
import { stubDecisionOSClient } from '@/lib/commissioner-ui/decision-os-client/stub'
import { demoDecisionOSClient } from '@/lib/commissioner-ui/decision-os-client/demo'
import { stubAutomationClient } from '@/lib/commissioner-ui/automations/decision-os-client/stub'
import { demoAutomationClient } from '@/lib/commissioner-ui/automations/decision-os-client/demo'
import { stubAnalyticsClient } from '@/lib/commissioner-ui/analytics/decision-os-client/stub'
import { stubReportsClient } from '@/lib/commissioner-ui/reports/decision-os-client/stub'
import { demoReportsClient } from '@/lib/commissioner-ui/reports/decision-os-client/demo'
import { stubNotificationsClient } from '@/lib/commissioner-ui/notifications/decision-os-client/stub'
import { stubActivityClient } from '@/lib/commissioner-ui/activity/decision-os-client/stub'
import { formatRelativeTime } from '@/lib/commissioner-ui/utils/time'
import { COMMISSIONER_ALL_NAV_ITEMS } from '@/lib/commissioner-ui/navigation/moduleNav'
import { decideCoreDepth } from '@/lib/core-app/coreDepthAccess'
import {
  COMMISSIONER_SECTION_NAMES_ES,
  COS_LOCK_SUBJECT_KEYS,
  allClearText,
  commissionerSectionName,
  deadlineLabelText,
  healthDriverText,
  summaryHeadlineText,
} from '@/lib/commissioner-os/i18n/shellCopy'

const ROOT = join(__dirname, '..')
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/
const EN_MONTH =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\b/
/** The shell's and Mission Control's own English, word by word. Fixture names avoid every one. */
const OWN_EN =
  /\b(Mission Control|League Health|Recommendations|Manager Intelligence|Workspace|Automations?|League Analytics|Reports?|Settings|Activity|Help|Knowledge|Commissioner Hub|networks|Off|navigation|Search|Notifications?|unread|Profile|Breadcrumb|No leagues|Select league|Data mode|developer|curated|intelligence|Preview|dashboard|connected|Retry|Couldn|load|commissioners?|workspace|manages|account|syncing|Back to|Import|part of|Upgrade|Free until|then|Nothing|attention|good shape|available|reading|Open|Active|Risks|Engagement|Score|Next Deadline|deadline|Send|Digest|Review|Pending|Trades|Invite|over time|trailing|captures?|Each point|offseason|Today|Priorities|Recent|highlights|this week|open tasks|preview|Status|running|scheduled|ready|Newest|tracked|Unavailable|Just now|ago|weeks?|days?|hours?|within|Playoffs|waiver|engaged|recorded|managers|Driven)\b/
/**
 * Fixture prose, which stays as written (see the header). Each entry is the fixture's whole sentence,
 * so nothing of the app's own can hide inside one.
 */
const DEMO_PROSE = [
  'Driven by strong trade activity',
  'Strong trade activity and consistent lineup compliance',
  'Most active trader this season',
  'Engagement declining for 3 weeks',
  'Most active trader this season — 7 completed trades',
  'Engagement declining — 2 missed lineup deadlines',
  'Longest continuously active manager — 4th season',
]

function visibleText(root: HTMLElement): string {
  const parts: string[] = []
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? '')
  root.querySelectorAll('[title],[aria-label],[placeholder],option').forEach((el) => {
    for (const a of ['title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(a)
      if (v) parts.push(v)
    }
  })
  let text = parts.join(' \n ')
  for (const prose of DEMO_PROSE) text = text.split(prose).join(' ')
  return text
}

function expectNoEnglish(root: HTMLElement) {
  const text = visibleText(root)
  const hit = text.match(OWN_EN) ?? text.match(EN_DAY) ?? text.match(EN_MONTH)
  expect(hit?.[0] ?? null, `English left: …${hit ? text.slice(Math.max(0, (hit.index ?? 0) - 60), (hit.index ?? 0) + 60) : ''}…`).toBeNull()
}

afterEach(() => {
  cleanup()
  lang.language = 'en'
  nav.pathname = '/commissioner-os'
})

const LEAGUES = [
  { id: 'lg-1', name: 'Zebra Coast 12' },
  { id: 'lg-2', name: 'Quokka Bowl' },
]

function Shell() {
  return (
    <CommissionerOSProviders>
      <CommissionerSidebar activeLeagueId="lg-1" />
      <CommissionerHeader unreadNotificationCount={3} leagues={LEAGUES} activeLeagueId="lg-1" availableDataModes={['stub', 'demo', 'live']} />
      <CommissionerBreadcrumbs />
    </CommissionerOSProviders>
  )
}

async function missionControlProps(mode: 'stub' | 'demo'): Promise<MissionControlViewProps> {
  const mc = mode === 'demo' ? demoDecisionOSClient : stubDecisionOSClient
  const automations = mode === 'demo' ? demoAutomationClient : stubAutomationClient
  const reports = mode === 'demo' ? demoReportsClient : stubReportsClient
  const [health, highlights, kpis, events, automation, analytics, report, notifications, trend] = await Promise.all([
    mc.getLeagueHealthSummary(),
    mc.getManagerHighlights(),
    mc.getMissionControlKpis(),
    stubActivityClient.getEvents(),
    automations.getSummary(),
    stubAnalyticsClient.getSummary(),
    reports.getSummary(),
    stubNotificationsClient.getSummary(),
    mc.getActivityTrend(),
  ])
  return {
    leagueHealth: health.data!,
    // The recommendation card's words are C2's; Mission Control's own list is what is read here.
    recommendations: [],
    managerHighlights: highlights.data!,
    kpis: kpis.data!,
    // As app/commissioner-os/page.tsx maps them: the summary is the activity loader's (C4), the time is ours.
    recentActivity: (events.data ?? []).slice(0, 5).map((e) => ({ id: e.id, label: '·', timestamp: formatRelativeTime(e.timestamp) })),
    automationSummary: automation.data!,
    analyticsSummary: analytics.data!,
    reportsSummary: report.data!,
    notificationsSummary: notifications.data!,
    activityTrend: trend.data,
    dataMode: mode,
    canInviteCoCommissioner: true,
  }
}

/** A live-shaped reading, every sentence written the way the live loaders write it. */
function liveProps(base: MissionControlViewProps): MissionControlViewProps {
  return {
    ...base,
    dataMode: 'live',
    leagueHealth: {
      score: 41,
      tier: 'elevated',
      trendLabel: 'Not enough history yet to show a trend',
      trendDirection: 'flat',
      driver: 'Low engagement — league activity is below healthy levels (no league activity recorded in 18 days)',
    },
    managerHighlights: [{ id: 'm1', managerName: 'Zebra Coast 12 GM', callout: 'Active and engaged', tone: 'positive' }],
    kpis: { openRecommendations: 2, activeRisks: 1, engagementScore: 41, nextDeadlineLabel: 'Trade deadline in 3 weeks' },
    recentActivity: [
      { id: 'a', label: '·', timestamp: 'Just now' },
      { id: 'b', label: '·', timestamp: '5h ago' },
      { id: 'c', label: '·', timestamp: '2d ago' },
    ],
    automationSummary: { totalCount: 4, activeCount: 4, needsAttentionCount: 0, headline: '4 automations running normally' },
    analyticsSummary: { headline: 'League engagement score 41 — 3 of 12 managers active (no league activity recorded in 18 days)', kpiCount: 4 },
    reportsSummary: { headline: '2 scheduled reports, none generated yet', scheduledCount: 2, readyCount: 0 },
    notificationsSummary: { headline: '3 unread notifications', unreadCount: 3, criticalCount: 0 },
    recommendationsRead: true,
  }
}

describe('Commissioner OS shell — Spanish', () => {
  it('the sidebar, header and league picker read Spanish, attributes included', () => {
    lang.language = 'es'
    const { container, getByRole } = render(<Shell />)
    fireEvent.click(getByRole('button', { name: 'Zebra Coast 12' }))
    expectNoEnglish(container)
    const text = container.textContent ?? ''
    for (const name of Object.values(COMMISSIONER_SECTION_NAMES_ES)) expect(text).toContain(name)
    expect(text).toContain('Centro del comisionado')
    expect(text).toContain('Redes de comisionados')
    expect(container.querySelector('[aria-label="Notificaciones, 3 sin leer"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Buscar en Commissioner OS"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Elegir liga"]')).not.toBeNull()
    expect(text).toContain('En vivo (inteligencia real)')
    // League names are the user's own.
    expect(text).toContain('Quokka Bowl')
  })

  it('an empty league picker and the access notice read Spanish', () => {
    lang.language = 'es'
    const { container } = render(
      <div>
        <LeagueSelector leagues={[]} activeLeagueId={null} />
        <CommissionerAccessNotice />
      </div>,
    )
    expectNoEnglish(container)
    expect(container.textContent).toContain('Sin ligas')
    expect(container.textContent).toContain('Commissioner OS es para comisionados de liga')
    expect(container.textContent).toContain('Importar una liga')
  })

  it('the preview banner, the error state, the lock and its note read Spanish', () => {
    lang.language = 'es'
    const locked = decideCoreDepth('commissioner_depth', { live: true, startsAt: new Date('2026-10-15T04:00:00.000Z'), hasPlan: false })
    const free = decideCoreDepth('commissioner_depth', { live: false, startsAt: new Date('2026-10-15T04:00:00.000Z'), hasPlan: false })
    const { container } = render(
      <div>
        <PreviewDataBanner mode="demo" />
        <ErrorState onRetry={() => {}} />
        <CommissionerDepthLocked access={locked} what="Mission Control" />
        <CommissionerFreeUntilNote access={free} />
      </div>,
    )
    expectNoEnglish(container)
    expect(container.textContent).toContain('Datos de vista previa')
    expect(container.textContent).toContain('Reintentar')
    expect(container.textContent).toContain('Centro de control: parte de AF Commissioner')
    expect(container.textContent).toContain('luego, AF Commissioner')
  })

  it('every Commissioner OS lock subject has Spanish', () => {
    const subjects = new Set<string>()
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        const p = `${dir}/${entry}`
        if (statSync(join(ROOT, p)).isDirectory()) walk(p)
        else if (entry === 'page.tsx') for (const m of src(p).matchAll(/<CommissionerDepthLocked[^>]*what="([^"]+)"/g)) subjects.add(m[1])
      }
    }
    walk('app/commissioner-os')
    expect(subjects.size).toBeGreaterThan(0)
    for (const s of subjects) expect(COS_LOCK_SUBJECT_KEYS, s).toContain(s)
  })

  it('every nav label has a section name, and the English is unchanged', () => {
    for (const item of COMMISSIONER_ALL_NAV_ITEMS) {
      expect(commissionerSectionName(item.label, 'es'), item.label).toBe(COMMISSIONER_SECTION_NAMES_ES[item.id])
      expect(commissionerSectionName(item.label, 'en')).toBe(item.label)
    }
  })
})

describe('Mission Control — Spanish', () => {
  for (const mode of ['stub', 'demo'] as const) {
    it(`renders Spanish on the ${mode} fixtures`, async () => {
      lang.language = 'es'
      const { container } = render(<MissionControlView {...await missionControlProps(mode)} />)
      expectNoEnglish(container)
      expect(container.textContent).toContain('Prioridades de hoy')
    })
  }

  it('renders Spanish on a live-shaped reading', async () => {
    lang.language = 'es'
    const { container } = render(<MissionControlView {...liveProps(await missionControlProps('stub'))} />)
    expectNoEnglish(container)
    const text = container.textContent ?? ''
    expect(text).toContain('Fecha límite de intercambios: en 3 semanas')
    expect(text).toContain('Participación baja: la actividad de la liga está por debajo de lo saludable (sin actividad registrada en la liga en 18 días)')
    expect(text).toContain('Puntuación de participación de la liga 41: 3 de 12 mánagers activos')
    expect(text).toContain('hace 5 h')
    expect(text).toContain('Activo y participativo')
    // The all-clear on an elevated league says the score disagrees, in Spanish.
    expect(text).toContain('La salud de la liga está en nivel elevado')
  })

  it('a failed read reads Spanish', async () => {
    lang.language = 'es'
    const base = liveProps(await missionControlProps('stub'))
    const { container } = render(
      <MissionControlView
        {...base}
        leagueHealthAvailable={false}
        recommendationsRead={false}
        kpis={{ ...base.kpis, nextDeadlineLabel: 'Unavailable' }}
        automationSummary={{ ...base.automationSummary, headline: 'Unavailable' }}
        activityTrend={null}
      />,
    )
    expectNoEnglish(container)
    expect(container.textContent).toContain('No se pudieron cargar las recomendaciones.')
  })

  it('English mode is unchanged', async () => {
    const { container } = render(<MissionControlView {...liveProps(await missionControlProps('stub'))} />)
    const text = container.textContent ?? ''
    for (const s of [
      'Open Recommendations',
      'Trade deadline in 3 weeks',
      'Today’s Priorities',
      '4 automations running normally',
      '1 highlights this week',
      'Each point counts every event inside the trailing 90 days as of that day',
      'League health is elevated, so an empty list isn’t the whole picture.',
      '5h ago',
    ]) expect(text).toContain(s)
    cleanup()
    const shell = render(<Shell />)
    expect(shell.container.querySelector('[aria-label="Notifications, 3 unread"]')).not.toBeNull()
    expect(shell.container.textContent).toContain('Manager Intelligence')
    expect(shell.container.textContent).toContain('Commissioner Hub')
    cleanup()
    const misc = render(<div><PreviewDataBanner mode="demo" /><ErrorState onRetry={() => {}} /></div>)
    expect(misc.container.textContent).toContain('Preview data — this dashboard is not yet connected to live league intelligence. Every value here is demo (curated data).')
    expect(misc.container.textContent).toContain("Couldn't load this right now.")
  })
})

describe('server-built sentences are held to their loaders', () => {
  const live = src('lib/commissioner-ui/decision-os-client/live.ts')
  it('the Mission Control loader still writes what deadlineLabelText and healthDriverText read', () => {
    for (const s of [
      "'No upcoming deadlines configured'",
      "'Trade deadline' : 'Playoffs start'",
      "'Draft' : 'Next waiver processing'",
      '`${what} is this week`',
      "`${what} in ${event.weeksAway} week${event.weeksAway === 1 ? '' : 's'}`",
      '`${what} within the hour`',
      '`${what} in ${hoursAway} hours`',
      '`${what} on ${event.at.slice(0, 10)}`',
      '(no league activity has ever been recorded)',
      '(no league activity recorded in ${daysSinceLastActivity} days)',
      "'Active and engaged'",
    ]) expect(live, s).toContain(s)
    expect(deadlineLabelText('Playoffs start is this week', 'es')).toBe('Inicio de los playoffs: esta semana')
    expect(deadlineLabelText('Next waiver processing in 1 hours', 'es')).toBe('Próximo procesamiento de agentes libres: en 1 hora')
    expect(deadlineLabelText('Draft on 2026-08-30', 'es')).toBe('Draft: el 2026-08-30')
    expect(deadlineLabelText('No upcoming deadlines configured', 'es')).toBe('No hay fechas límite próximas configuradas')
    expect(healthDriverText('Something new (no league activity has ever been recorded)', 'es')).toBe(
      'Something new (nunca se ha registrado actividad en la liga)',
    )
  })

  it('the module summaries still write what summaryHeadlineText reads', () => {
    expect(src('lib/commissioner-ui/analytics/decision-os-client/live.ts')).toContain(
      '`League engagement score ${intel.leagueEngagementScore} — ${intel.participationDistribution.activeManagers} of ${intel.participationDistribution.totalManagers} managers active${caveat}`',
    )
    const automations = src('lib/commissioner-ui/automations/decision-os-client/live.ts')
    for (const s of [
      "`${entries.length} automation${entries.length === 1 ? '' : 's'} running normally`",
      '`${needsAttention[0].name} needs attention`',
      "`${needsAttention[0].name} and ${needsAttention.length - 1} other${needsAttention.length === 2 ? '' : 's'} need attention`",
    ]) expect(automations, s).toContain(s)
    const reports = src('lib/commissioner-ui/reports/decision-os-client/live.ts')
    for (const s of [
      "`${scheduled} scheduled report${scheduled === 1 ? '' : 's'}, none generated yet`",
      "`Newest: ${byName(ready[0].templateId)} — ${ready.length} report${ready.length === 1 ? '' : 's'} ready`",
    ]) expect(reports, s).toContain(s)
    expect(src('lib/commissioner-ui/notifications/decision-os-client/live.ts')).toContain(
      "unreadCount === 0 ? 'No unread notifications' : `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`",
    )
    expect(summaryHeadlineText('Waiver batch processing needs attention', 'es')).toBe('Waiver batch processing: necesita atención')
    expect(summaryHeadlineText('Waiver batch processing and 2 others need attention', 'es')).toBe(
      'Waiver batch processing y 2 más necesitan atención',
    )
    expect(summaryHeadlineText('Newest: Weekly Recap — 1 report ready', 'es')).toBe('Más reciente: Weekly Recap · 1 informe listo')
    expect(summaryHeadlineText('No unread notifications', 'es')).toBe('No hay notificaciones sin leer')
    expect(summaryHeadlineText('1 automation running normally', 'en')).toBe('1 automation running normally')
  })

  it('allClear.ts still writes what allClearText reads', () => {
    const allClear = src('lib/commissioner-ui/allClear.ts')
    for (const s of [
      '`Couldn’t load ${listName}.`',
      "'That isn’t the same as having none. Try again shortly.'",
      "'League health isn’t available yet, so this isn’t a verdict on the league.'",
      "`League health is ${healthTier === 'critical' ? 'critical' : 'elevated'}, so an empty list isn’t the whole picture.`",
    ]) expect(allClear, s).toContain(s)
    expect(allClearText('Couldn’t load risks.', 'es')).toBe('No se pudieron cargar los riesgos.')
  })

  it('the pinned dates read Spanish without leaving the pinned zone', () => {
    // 2026-09-10 02:30 UTC is still Sep 9 in New York.
    const at = '2026-09-10T02:30:00.000Z'
    expect(shortDate(at)).toBe('Sep 9')
    expect(shortDate(at, 'es')).toBe('9 sep')
    expect(mediumDate(at, 'es')).toBe('9 sep 2026')
    expect(longDate(at, 'es')).toBe('9 de septiembre de 2026')
    expect(dateTime(at, 'es')).toBe('9 sep 2026, 10:30 p. m. EDT')
    expect(longDate(null, 'es')).toBe('—')
  })
})
