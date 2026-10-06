/**
 * Commissioner OS Spanish — the closing follow-up (2026-10-06), after the five group PRs
 * (#2098, #2099, #2100, #2104, #2105) ran in parallel and left some strings translated twice.
 *
 * Two kinds of assertion, kept apart on purpose:
 *
 * 1. CONSOLIDATIONS must not change a single byte any reader sees. `fixtures/cos-spanish-closing-golden.json`
 *    was dumped from the PRE-consolidation translators (the deleted copies included) over every
 *    input their former callers pass — every section id, every related-link label, every severity
 *    tier, every deadline shape. Each entry is replayed here through the SURVIVOR. A drift of one
 *    accent fails the entry that drifted.
 * 2. WIRINGS are meant to change Spanish output: names and sentences that were left English now go
 *    through the translator that owns them. Those render in Spanish and assert no English is left.
 */
import React from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/commissioner-os',
  useSearchParams: () => new URLSearchParams(),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import GOLDEN from './fixtures/cos-spanish-closing-golden.json'
import { MissionControlView, type MissionControlViewProps } from '@/components/commissioner-os/mission-control/MissionControlView'
import { SEVERITY_LABELS } from '@/components/commissioner-os/cards/severityStyles'
import { getModuleLabel } from '@/lib/commissioner-ui/navigation/moduleNav'
import type { CommissionerModuleId } from '@/lib/commissioner-ui/navigation/moduleNav'
import type { SeverityTier } from '@/lib/commissioner-ui/tokens/colors'
import type { CommissionerNotificationSeverity } from '@/lib/commissioner-ui/contracts/notifications'
import { commissionerOsText } from '@/lib/core-app/commissionerOsText'
import { demoRecommendationsClient } from '@/lib/commissioner-ui/recommendations/decision-os-client/demo'
import { stubRecommendationsClient } from '@/lib/commissioner-ui/recommendations/decision-os-client/stub'
import { deadlineLabelText, moduleLabelText, summaryHeadlineText } from '@/lib/commissioner-os/i18n/shellCopy'
import * as cards from '@/lib/commissioner-os/i18n/cardsCopy'
import { reportText, workspaceCopy } from '@/lib/commissioner-os/i18n/analyticsCopy'
import {
  composedEventText,
  eventSeverityText,
  relatedLinkText,
  searchResultTitleText,
  settingsText,
  toolsText,
} from '@/lib/commissioner-os/i18n/toolsCopy'

const ROOT = join(__dirname, '..')
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8')

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

/* ── 1. Consolidations: the survivor reproduces every former caller's output ─────────────────── */

/** Each golden key is `<former translator>|<language>|<input>`; this names the survivor that replaces it. */
function survivor(kind: string, language: string, input: string): string {
  switch (kind) {
    case 'section': // toolsCopy.sectionNameText → shellCopy.moduleLabelText
      return moduleLabelText(input as CommissionerModuleId, getModuleLabel(input as CommissionerModuleId), language)
    case 'link':
      return relatedLinkText(input, language)
    case 'page':
      return searchResultTitleText({ category: 'page', title: input }, language)
    case 'tier': // toolsCopy.severityTierText → cardsCopy.severityLabelText
    case 'cardTier':
      return cards.severityLabelText(input as SeverityTier, `EN-${input}`, language)
    case 'event':
      return eventSeverityText(input as CommissionerNotificationSeverity, `EN-${input}`, language)
    case 'toolsText':
      return toolsText(input, language)
    case 'settingsText':
      return settingsText(input, language)
    case 'deadline':
      return deadlineLabelText(input, language)
    case 'reportText':
      return reportText(input, language)
    case 'cardsCopy':
      return cards.cardsCopy(input, language)
    case 'loader':
      return cards.cosLoaderText(input, language)
    case 'wsSeverity': // analyticsCopy.workspaceCopy().severity → cardsCopy.taskPriorityLabelText
      return cards.taskPriorityLabelText(input as SeverityTier, `EN-${input}`, language)
    case 'ageBand':
      return workspaceCopy(language)!.ageBand(input)
    default:
      throw new Error(`no survivor for ${kind}`)
  }
}

describe('every consolidation is byte-identical for every former caller', () => {
  const entries = Object.entries(GOLDEN as Record<string, string>)

  it('the golden set covers every consolidated translator (positive control)', () => {
    const kinds = new Set(entries.map(([k]) => k.split('|')[0]))
    for (const k of ['section', 'link', 'page', 'tier', 'cardTier', 'event', 'toolsText', 'settingsText', 'deadline', 'reportText', 'cardsCopy', 'loader', 'wsSeverity', 'ageBand']) {
      expect(kinds, k).toContain(k)
    }
    expect(entries.length).toBeGreaterThan(200)
  })

  it.each(entries)('%s', (key, expected) => {
    const [kind, language, ...rest] = key.split('|')
    expect(survivor(kind!, language!, rest.join('|'))).toBe(expected)
  })

  it('the feminine task-priority badge stays feminine, and the masculine severity badge masculine', () => {
    // A task's PRIORITY ("prioridad", feminine) and a condition's LEVEL ("nivel", masculine) are two
    // agreements of one scale. Neither is a duplicate of the other.
    expect(cards.taskPriorityLabelText('critical', SEVERITY_LABELS.critical, 'es')).toBe('Crítica')
    expect(cards.severityLabelText('critical', SEVERITY_LABELS.critical, 'es')).toBe('Crítico')
    for (const tier of Object.keys(SEVERITY_LABELS) as SeverityTier[]) {
      expect(cards.taskPriorityLabelText(tier, SEVERITY_LABELS[tier], 'en')).toBe(SEVERITY_LABELS[tier])
    }
  })

  it('the event scale’s "Crítico" is the condition scale’s, from one table', () => {
    expect(eventSeverityText('critical', 'Critical', 'es')).toBe(cards.severityLabelText('critical', 'Critical', 'es'))
  })

  it('no Commissioner OS copy module keeps its own section-name or severity table', () => {
    const tools = src('lib/commissioner-os/i18n/toolsCopy.ts')
    for (const literal of ["'Centro de control'", "'Salud de la liga'", "'Flujo de actividad'", "'Crítico'", "'Elevado'"]) {
      expect(tools, literal).not.toContain(literal)
    }
    expect(src('lib/commissioner-os/i18n/analyticsCopy.ts')).not.toContain("'Informativa'")
  })
})

/* ── 1b. Two equivalences proved over a corpus, rather than a golden ─────────────────────────── */

/** The fixed strings and template samples both recommendation translators know. */
function translatorCorpus(): string[] {
  const keysOf = (file: string, table: string) => {
    const body = src(file).split(`const ${table}: Record<string, string> = {`)[1]!.split('\n}\n')[0]!
    return [...body.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z]\w*))\s*:/gm)].map((m) =>
      (m[1] ?? m[2] ?? m[3])!.replace(/\\'/g, "'"),
    )
  }
  const exact = keysOf('lib/core-app/commissionerOsText.ts', 'EXACT')
  const loader = keysOf('lib/commissioner-os/i18n/cardsCopy.ts', 'LOADER_ES')
  expect(exact.length, 'commissionerOsText EXACT keys').toBeGreaterThan(30)
  expect(loader.length, 'cardsCopy LOADER_ES keys').toBeGreaterThan(50)
  const samples = [
    // commissionerOsText RULES
    '3 inactive managers — engagement at risk',
    'Possible integrity concern: 2 abandoned teams — immediate action needed',
    'League health: at risk',
    'Overall score 41/100 (declining). 2 issue(s) flagged.',
    '2 trade(s) this period',
    'Draft grades ready for 12 team(s)',
    'Week 4 power rankings ready',
    'Rivalry: Heated tier (score 71)',
    'Draft in 3 days',
    'Zebra vs Quokka: Blood Feud rivalry',
    'Major upset in week 3: Zebra over Quokka',
    // cardsCopy LOADER_RULES
    '2 manager(s) are at critical risk of abandoning the league. Direct outreach is recommended immediately.',
    '1 manager(s) have not been active recently. Reach out to re-engage them before they abandon the league.',
    '3 of 12 managers are active',
    '2 manager(s) at critical retention risk',
    'League-wide retention risk is high.',
    'This league is asking medium attention of its commissioner right now.',
    '2 of the 9 managers seen in this window are no longer active in it.',
    'Engagement declining for 3 weeks — may benefit from a personal check-in',
  ]
  return [...exact, ...loader, ...samples]
}

describe('two translations that were applied twice', () => {
  it('Mission Control no longer pre-translates recommendation fields: the card’s own pass gives the same bytes', async () => {
    const recs = [...((await demoRecommendationsClient.getQueue()).data ?? []), ...((await stubRecommendationsClient.getQueue()).data ?? [])]
    const corpus = [...translatorCorpus(), ...recs.flatMap((r) => [r.title, r.rationale])]
    for (const s of corpus) {
      // before: the card drew cosLoaderText(commissionerOsText(s)); after: cosLoaderText(s)
      expect(cards.cosLoaderText(s, 'es'), s).toBe(cards.cosLoaderText(commissionerOsText(s, 'es'), 'es'))
      expect(cards.cosLoaderText(s, 'en'), s).toBe(cards.cosLoaderText(commissionerOsText(s, 'en'), 'en'))
    }
  })

  it('the activity translator still says exactly what commissionerOsText said, for everything that knew it', () => {
    for (const s of translatorCorpus()) {
      const before = commissionerOsText(s, 'es')
      if (before !== s) expect(composedEventText(s, 'es'), s).toBe(before)
      expect(composedEventText(s, 'en'), s).toBe(s)
    }
  })
})

/* ── 2. Wirings: names and sentences that were left English ─────────────────────────────────── */

/** The English these wirings exist to remove: our automation and report names, and the loaders' sentences. */
const LEFT_ENGLISH =
  /League task scan|Waiver batch processing|Scheduled report generation|Weekly Commissioner Digest|Season Recap|Manager Engagement Report|Trade & Transaction Summary|needs? attention|failed|generated|ran successfully|Managers at risk|has no manager|no longer active|Newest/

function missionControlProps(over: Partial<MissionControlViewProps>): MissionControlViewProps {
  return {
    leagueHealth: { score: 70, tier: 'standard', trendLabel: '', trendDirection: 'flat', driver: 'Unavailable' },
    recommendations: [],
    managerHighlights: [],
    kpis: { openRecommendations: 0, activeRisks: 0, engagementScore: 70, nextDeadlineLabel: 'Trade deadline in 3 weeks' },
    recentActivity: [],
    automationSummary: { totalCount: 3, activeCount: 3, needsAttentionCount: 0, headline: '3 automations running normally' },
    analyticsSummary: { headline: '4 KPIs tracked', kpiCount: 4 },
    reportsSummary: { headline: '1 report ready', scheduledCount: 0, readyCount: 1 },
    notificationsSummary: { headline: 'No unread notifications', unreadCount: 0, criticalCount: 0 },
    activityTrend: null,
    dataMode: 'live',
    ...over,
  }
}

describe('Mission Control names our automations and reports in Spanish', () => {
  it('"<automation> needs attention" and "Newest: <report>"', () => {
    lang.language = 'es'
    const { container } = render(
      <MissionControlView
        {...missionControlProps({
          automationSummary: { totalCount: 3, activeCount: 3, needsAttentionCount: 1, headline: 'League task scan needs attention' },
          reportsSummary: { headline: 'Newest: Weekly Commissioner Digest — 2 reports ready', scheduledCount: 1, readyCount: 2 },
        })}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Revisión de tareas de la liga: necesita atención')
    expect(text).toContain('Más reciente: Resumen semanal del comisionado · 2 informes listos')
    expect(text.match(LEFT_ENGLISH)?.[0] ?? null).toBeNull()
  })

  it('"<automation> and N others need attention"', () => {
    expect(summaryHeadlineText('Waiver batch processing and 2 others need attention', 'es', { automation: (n) => n.toUpperCase() })).toBe(
      'WAIVER BATCH PROCESSING y 2 más necesitan atención',
    )
  })

  it('a name the catalogs do not know passes through, and English is untouched', () => {
    lang.language = 'es'
    const a = render(<MissionControlView {...missionControlProps({ reportsSummary: { headline: 'Newest: Zebra Custom — 1 report ready', scheduledCount: 0, readyCount: 1 } })} />)
    expect(a.container.textContent).toContain('Más reciente: Zebra Custom · 1 informe listo')
    cleanup()
    lang.language = 'en'
    const b = render(
      <MissionControlView
        {...missionControlProps({ automationSummary: { totalCount: 3, activeCount: 3, needsAttentionCount: 1, headline: 'League task scan needs attention' } })}
      />,
    )
    expect(b.container.textContent).toContain('League task scan needs attention')
  })
})

describe('Mission Control’s Recent Activity summaries go through the activity translator', () => {
  /** One of each, as lib/commissioner-ui/activity/decision-os-client/live.ts writes them. */
  const SUMMARIES = [
    'Waiver batch processing failed on its last run.', // automation run
    'Season Recap generated successfully.', // report
    'Manager Engagement Report failed to generate.', // report
    'Managers at risk of leaving', // rec.title
    '2 of the 9 managers seen in this window are no longer active in it.', // risk.description
    'One team has no manager', // task.title
  ]

  it('the loader still writes these shapes', () => {
    const live = src('lib/commissioner-ui/activity/decision-os-client/live.ts')
    for (const s of ['summary: risk.description,', 'summary: rec.title,', 'summary: `${automation.name} failed on its last run.`,', 'summary: `${report.templateName} generated successfully.`,', 'summary: task.title,']) {
      expect(live, s).toContain(s)
    }
  })

  it('renders every one in Spanish', () => {
    lang.language = 'es'
    const { container } = render(
      <MissionControlView {...missionControlProps({ recentActivity: SUMMARIES.map((label, i) => ({ id: String(i), label, timestamp: '5h ago' })) })} />,
    )
    const text = container.textContent ?? ''
    for (const s of [
      'Procesamiento de reclamos por lotes: falló en su última ejecución.',
      'Resumen de temporada: se generó correctamente.',
      'Informe de participación de mánagers: no se pudo generar.',
      'Mánagers en riesgo de irse',
      '2 de los 9 mánagers vistos en esta ventana ya no están activos en ella.',
      'Un equipo no tiene mánager',
    ]) expect(text, s).toContain(s)
    expect(text.match(LEFT_ENGLISH)?.[0] ?? null).toBeNull()
  })
})

describe('notification and search text name reports in Spanish', () => {
  it('a failed report notification', () => {
    expect(composedEventText('Season Recap failed to generate — no partial file was produced.', 'es')).toBe(
      'Resumen de temporada: no se pudo generar. No se produjo ningún archivo parcial.',
    )
  })
  it('a report search result', () => {
    expect(searchResultTitleText({ category: 'report', title: 'Trade & Transaction Summary' }, 'es')).toBe('Resumen de intercambios y transacciones')
    expect(searchResultTitleText({ category: 'report', title: 'Trade & Transaction Summary' }, 'en')).toBe('Trade & Transaction Summary')
  })
})

/* ── 2b. "Free until": every Commissioner OS page follows the reader's language ──────────────── */

describe('no Commissioner OS page draws FreeUntilNote directly', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p)
    }
    return out
  }
  const pages = walk(join(ROOT, 'app/commissioner-os')).map((p) => p.slice(ROOT.length + 1).replace(/\\/g, '/'))
  const IMPORTS_LOCK = /(from\s+['"][^'"]*\/CoreDepthLock['"]|import\(\s*['"][^'"]*\/CoreDepthLock['"]|require\(\s*['"][^'"]*\/CoreDepthLock['"])/

  it('the census reads the pages (positive control)', () => {
    for (const p of ['app/commissioner-os/page.tsx', 'app/commissioner-os/automations/page.tsx', 'app/commissioner-os/activity/page.tsx']) expect(pages).toContain(p)
  })

  it('each page with a depth lock shows the shell’s language-following note', () => {
    const direct = pages.filter((p) => IMPORTS_LOCK.test(src(p)))
    expect(direct).toEqual([])
    for (const p of ['app/commissioner-os/automations/page.tsx', 'app/commissioner-os/activity/page.tsx']) {
      expect(src(p), p).toMatch(/<CommissionerFreeUntilNote access=\{depth\} \/>/)
    }
  })
})
