/**
 * The owner's Spanish wording rulings (2026-10-06), and the five disagreements #2107 left marked ⚠.
 *
 * 1. A waiver RUN / waiver PROCESSING is «procesamiento de reclamos», app-wide. «Agentes libres» is
 *    only ever the players themselves. The sweep below scans every source file for the old renderings
 *    and expects none, so a new screen that writes «procesamiento de agentes libres» fails here.
 * 2. "Commissioner networks" is «Redes de comisionados», from ONE source (the shell's).
 * 3. A task's priority on the networks page reads the workspace badge's feminine labels.
 * 4. "…not yet integrated…" is «aún no», from ONE source (`cosErrorText`).
 * 5. "<template> generated successfully." keeps two shapes on purpose (a list line and prose).
 * 6. "This league could not be read." reads /core's translation; "Average margin" keeps two, because
 *    the two screens mean different numbers.
 * 7. A waiver CLAIM is «reclamo» (masculine), the waiver ORDER is «prioridad de reclamo» and a waiver
 *    DEADLINE is «plazo de reclamos». A second sweep forbids the old renderings, and every singular
 *    «red de comisionado» is the plural «red de comisionados».
 * 8. "Fix all": no Spanish value says «waiver(s)» at all. The wire, the players and the Waivers
 *    screen (and a settings tab titled "Waivers") are «agentes libres»; the waiver system / type is
 *    «reclamos»; a run is «procesamiento de reclamos»; a waiver period is «período de reclamos».
 *    The only survivor is "Waiver Warriors", a made-up team NAME on the landing page.
 *
 * Every changed string is pinned in Spanish AND asserted unchanged in English.
 */
import React from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

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

import { CommissionerNetworks } from '@/components/commissioner-os/networks/CommissionerNetworks'
import { cardsCopy, cosLoaderText, taskPriorityLabelText } from '@/lib/commissioner-os/i18n/cardsCopy'
import { NETWORKS_LINK_ES, deadlineLabelText, leagueEventNameText, shellText } from '@/lib/commissioner-os/i18n/shellCopy'
import { analyticsDataText, cosErrorText, reportText, taskText } from '@/lib/commissioner-os/i18n/analyticsCopy'
import { automationText, composedEventText, toolsText } from '@/lib/commissioner-os/i18n/toolsCopy'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'
import { alertGroupText } from '@/lib/core-app/homeBandsCopy'
import { buildLeagueCalendar, type CalendarInput } from '@/lib/core-app/commissioner/calendar'
import { NO_REVIEW_SIGNALS, reviewSignalCards } from '@/lib/core-app/commissioner/signals'
import { translations } from '@/lib/i18n/translations'
import { activityChart, waiverParticipationChart } from '@/lib/core-app/commissioner/charts'
import { abandonedTeamsFlag } from '@/lib/core-app/commissioner/health'
import { resolveMemberActivity } from '@/lib/core-app/commissioner/activity'
import { buildLeagueAreas, type HubLeague } from '@/lib/core-app/commissioner/areas'
import { commissionerFormatCards } from '@/lib/core-app/commissioner/formatCards'
import { RECIPES, recipeCatalogEntry } from '@/lib/core-app/commissioner/recipes'
import { coverageText } from '@/lib/core-app/homeBandsCopy'
import { leagueRecommendationText } from '@/lib/core-app/leagueRecommendationText'
import { pitchLineText } from '@/lib/core-app/finderTradeValueCopy'
import { WAIVER_EDGE_ES } from '@/lib/core-app/playerCardCopy'
import { pitchLine } from '@/lib/core-app/tradePitch'
import { HOME_TOPICS } from '@/lib/core-app/help-topics/home'
import { CAREER_TOPICS } from '@/lib/core-app/help-topics/career'
import UserOsCard from '@/components/decision-os/UserOsCard'
import type { CommissionerLeagueProfile } from '@/lib/commissioner-os/profile/types'
import type { ManagerPresence, PresenceManager } from '@/lib/core-app/managerPresence'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'
import { getLandingCopy } from '@/lib/i18n/landing-copy'
import { getNocturneCopy } from '@/components/landing/nocturne/copy.i18n'
import { LANDING_COPY as JOURNEY_COPY } from '@/components/landing/journey/copy'
import { DRAFT_TOPICS } from '@/lib/core-app/help-topics/draft'
import { OUTLOOK_TOPICS } from '@/lib/core-app/help-topics/outlook'
import { RANKINGS_TOPICS } from '@/lib/core-app/help-topics/rankings'
import { TRADES_TOPICS } from '@/lib/core-app/help-topics/trades'
import { WAIVERS_TOPICS } from '@/lib/core-app/help-topics/waivers'
import { teamWorkspaceCopy } from '@/lib/core-app/teamWorkspaceCopy'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  lang.language = 'en'
})

const ROOT = process.cwd()
const RUN = 'Próximo procesamiento de reclamos'

/* ── 1. The waiver sweep ─────────────────────────────────────────────────────── */

/**
 * Every way a waiver RUN was rendered before the ruling: as «… agentes libres» (the players), as
 * «… solicitudes de agentes libres» after a processing verb, or with the anglicism «waivers».
 */
const FORBIDDEN: RegExp[] = [
  /procesamiento de (los )?agentes libres/i,
  /ejecuci[oó]n de (los )?agentes libres/i,
  /procesos? de (los )?agentes libres/i,
  /ronda de (los )?agentes libres/i,
  /proces(a|ar|ó|aron|an) (los |las solicitudes de )?agentes libres/i,
  /agentes libres (de esta liga )?se procesan/i,
  /(procesamiento|proceso|ejecuci[oó]n) de (los )?waivers?\b/i,
  /se procesan los waivers/i,
]

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

describe('waiver run / processing is «procesamiento de reclamos», app-wide', () => {
  it('no source file renders a waiver run as «… de agentes libres»', () => {
    const files = ['lib', 'components', 'app'].flatMap((d) => sourceFiles(join(ROOT, d)))
    // A positive control: the scan must actually have reached the copy modules it exists for.
    const rel = files.map((f) => relative(ROOT, f).replace(/\\/g, '/'))
    for (const must of [
      'lib/commissioner-os/i18n/shellCopy.ts',
      'lib/commissioner-os/i18n/toolsCopy.ts',
      'lib/core-app/coreUiCopy.ts',
      'lib/core-app/commissionerHubCopy.ts',
      'lib/core-app/commissioner/calendar.ts',
      'lib/core-app/help-topics/waivers.ts',
      'lib/i18n/translations.ts',
    ])
      expect(rel, must).toContain(must)
    expect(FORBIDDEN[0].test('Próximo procesamiento de agentes libres'), 'the pattern itself must match').toBe(true)

    const hits: string[] = []
    files.forEach((file, i) => {
      const src = readFileSync(file, 'utf8')
      // Cheap whole-file screen first; only a file that matches is split into lines for the report.
      if (!FORBIDDEN.some((re) => re.test(src))) return
      src.split('\n').forEach((line, n) => {
        if (FORBIDDEN.some((re) => re.test(line))) hits.push(`${rel[i]}:${n + 1}: ${line.trim().slice(0, 140)}`)
      })
    })
    expect(hits).toEqual([])
  }, 180_000)

  it('"Next waiver processing" has ONE translator: the Mission Control KPI and the workspace deadline task read it', () => {
    expect(leagueEventNameText('Next waiver processing', 'es')).toBe(RUN)
    expect(deadlineLabelText('Next waiver processing in 2 days', 'es')).toBe(`${RUN}: en 2 días`)
    expect(deadlineLabelText('Next waiver processing on 2026-11-02', 'es')).toBe(`${RUN}: el 2026-11-02`)
    expect(
      taskText('Next waiver processing: this deadline is published in league settings. Review requirements before the recorded time.', 'es'),
    ).toBe(`${RUN}: esta fecha límite está publicada en los ajustes de la liga. Revisa los requisitos antes de la hora registrada.`)
    // The deadline task's other event names still read the shell's words, unchanged.
    expect(taskText('Trade deadline: this deadline is published in league settings. Review requirements before the recorded time.', 'es')).toMatch(
      new RegExp(`^${leagueEventNameText('Trade deadline', 'es')}: `),
    )
    // English untouched.
    expect(leagueEventNameText('Next waiver processing', 'en')).toBe('Next waiver processing')
    expect(deadlineLabelText('Next waiver processing in 2 days', 'en')).toBe('Next waiver processing in 2 days')
  })

  it('/core\'s "Next waiver run" reads the same words', () => {
    expect(coreUiCopy('Next waiver run', 'es')).toBe(RUN)
    expect(coreUiCopy('Next waiver run', 'en')).toBe('Next waiver run')
  })

  it('the Automation Center names the waiver job «Procesamiento de reclamos por lotes»', () => {
    expect(automationText('Waiver batch processing', 'es')).toBe('Procesamiento de reclamos por lotes')
    expect(composedEventText('Waiver batch processing failed on its last run.', 'es')).toBe(
      'Procesamiento de reclamos por lotes: falló en su última ejecución.',
    )
    const desc =
      'Settles pending waiver claims for leagues that run batched waivers, in FAAB or rolling-priority order. Only applies to leagues whose waivers are run by AllFantasy — an imported league settles its waivers on its own platform, so this never has work to do for one.'
    expect(automationText(desc, 'es')).toContain('Solo se aplica a las ligas cuyos reclamos procesa AllFantasy')
    expect(automationText('Waiver batch processing', 'en')).toBe('Waiver batch processing')
    expect(automationText(desc, 'en')).toBe(desc)
  })

  const calendarInput = (over: Partial<CalendarInput>): CalendarInput => ({
    now: new Date('2026-10-06T12:00:00Z'),
    leagueId: 'lg1',
    platformLabel: 'Sleeper',
    native: true,
    status: 'in_season',
    season: 2026,
    draftAt: null,
    waivers: { type: 'faab', dayOfWeek: 3, timeUtc: '09:00' },
    tradeDeadlineWeek: null,
    noTradeDeadline: false,
    playoffStartWeek: null,
    currentWeek: 5,
    weekStarts: new Map(),
    dues: null,
    polls: [],
    ...over,
  })

  it("the Commissioner Hub calendar's waiver event and its three gaps", () => {
    const es = (over: Partial<CalendarInput>) => buildLeagueCalendar(calendarInput({ ...over, language: 'es' }))
    const en = (over: Partial<CalendarInput>) => buildLeagueCalendar(calendarInput({ ...over, language: 'en' }))

    expect(es({}).events.find((e) => e.kind === 'waivers')?.title).toBe('Procesamiento de reclamos')
    expect(en({}).events.find((e) => e.kind === 'waivers')?.title).toBe('Waivers process')

    expect(es({ native: false }).gaps).toContain('Los reclamos se procesan en Sleeper, y su horario de procesamiento no se importa.')
    expect(en({ native: false }).gaps).toContain('Waivers process on Sleeper, and its processing schedule isn’t imported.')

    expect(es({ waivers: { type: 'fcfs', dayOfWeek: null, timeUtc: null } }).gaps.join('\n')).toContain(
      'Esta liga no tiene procesamiento de reclamos: los fichajes son por orden de llegada.',
    )

    expect(es({ waivers: { type: 'faab', dayOfWeek: null, timeUtc: null } }).gaps).toContain(
      'No está fijada la hora del procesamiento de reclamos de esta liga.',
    )
    expect(en({ waivers: { type: 'faab', dayOfWeek: null, timeUtc: null } }).gaps).toContain('This league’s waiver processing time isn’t set.')
  })

  it('the overdue-claims review card', () => {
    const signals = { ...NO_REVIEW_SIGNALS, overdueWaiverClaims: 2 }
    const es = reviewSignalCards('lg1', signals, 'es').find((c) => c.id === 'review:waivers')
    const en = reviewSignalCards('lg1', signals, 'en').find((c) => c.id === 'review:waivers')
    expect(es?.detail).toBe('Estos reclamos ya deberían haberse resuelto en un procesamiento de reclamos. Procésalos para resolverlos.')
    expect(en?.detail).toBe('These claims should have been decided by a waiver run by now. Run waivers to process them.')
    // «Abrir agentes libres» is the WAIVERS SCREEN (where the players are) — not a run, kept.
    expect(es?.action?.label).toBe('Abrir agentes libres')
  })

  it("the Commissioner Hub's waiver oversight and audit log", () => {
    const cases: Array<[string, string]> = [
      ['Ran waivers by hand', 'Procesó los reclamos a mano'],
      // The audit log's name for the scheduled run (`waivers.processLeague`) reads like the manual one.
      ['Processed waiver claims', 'Procesó los reclamos'],
      ['No waiver run has processed in this league yet.', 'Aún no ha habido ningún procesamiento de reclamos en esta liga.'],
      [
        '1 claim is waiting. Only the primary commissioner can run waivers manually.',
        '1 reclamo está esperando. Solo el comisionado principal puede procesar los reclamos manualmente.',
      ],
      [
        '3 claims are waiting. Only the primary commissioner can run waivers manually.',
        '3 reclamos están esperando. Solo el comisionado principal puede procesar los reclamos manualmente.',
      ],
      ['Run waivers now · 3 waiting', 'Procesar reclamos ahora · 3 en espera'],
      ['Nothing processed — waivers are locked or no claims were waiting.', 'No se procesó nada: los reclamos están bloqueados o no había ninguno esperando.'],
    ]
    for (const [english, spanish] of cases) {
      expect(hubCopy(english, 'es'), english).toBe(spanish)
      expect(hubCopy(english, 'en'), english).toBe(english)
    }
  })

  it('the home alert group for a processed waiver run', () => {
    expect(alertGroupText('waiver_processed', 'waiver results', 'es')).toBe('resultados de reclamos')
    expect(alertGroupText('waiver_processed', 'waiver results', 'en')).toBe('waiver results')
  })

  it('the legacy i18n table: the notification category and the War Room "today" row', () => {
    expect(translations.es['settings.notifications.category.waiver_processing']).toBe('Procesamiento de reclamos')
    expect(translations.es['dashboard.warroom.today.waiversProcess']).toBe('Se procesan los reclamos')
    expect(translations.en['settings.notifications.category.waiver_processing']).toBe('Waiver processing')
    expect(translations.en['dashboard.warroom.today.waiversProcess']).toBe('Waivers process')
  })
})

/* ── 2 & 3. Networks ─────────────────────────────────────────────────────────── */

const NETWORKS = {
  eligibleLeagues: [{ id: 'lg1', name: 'Iron Horse Dynasty', sport: 'NFL' }],
  networks: [
    {
      id: 'n1',
      name: 'Sunday Crew',
      members: [{ leagueId: 'lg1', role: 'host', label: null, league: { id: 'lg1', name: 'Iron Horse Dynasty', sport: 'NFL' } }],
      queue: [
        { id: 't1', leagueId: 'lg1', title: 'Rook', priority: 'advisory', status: 'open' },
        { id: 't2', leagueId: 'lg1', title: 'Pawn', priority: 'positive', status: 'open' },
        { id: 't3', leagueId: 'lg1', title: 'Knight', priority: 'critical', status: 'open' },
      ],
      history: [],
    },
  ],
}
const stubFetch = () => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => NETWORKS })) as unknown as typeof fetch)

describe('Commissioner networks', () => {
  it('"Commissioner networks" is «Redes de comisionados» from one source: the sidebar link and the page heading', () => {
    expect(NETWORKS_LINK_ES).toBe('Redes de comisionados')
    expect(shellText('Commissioner networks', 'es')).toBe(NETWORKS_LINK_ES)
    expect(cardsCopy('Commissioner networks', 'es')).toBe(NETWORKS_LINK_ES)
    expect(cardsCopy('Commissioner networks', 'en')).toBe('Commissioner networks')
  })

  it("a queued task's priority reads the workspace badge's labels, lower-cased in its parentheses", async () => {
    lang.language = 'es'
    stubFetch()
    const { container } = render(<CommissionerNetworks />)
    await screen.findByText('Sunday Crew')
    const text = container.textContent ?? ''
    expect(text).toContain('Redes de comisionados')
    for (const tier of ['advisory', 'positive', 'critical'] as const)
      expect(text, tier).toContain(`(${taskPriorityLabelText(tier, tier, 'es').toLocaleLowerCase('es')})`)
    expect(text).toContain('(informativa)')
    expect(text).toContain('(saludable)')
    expect(text).not.toContain('(aviso)')
    expect(text).not.toContain('(positiva)')
  })

  it('English is unchanged', async () => {
    stubFetch()
    const { container } = render(<CommissionerNetworks />)
    await screen.findByText('Sunday Crew')
    for (const s of ['Commissioner networks', '(advisory)', '(positive)', '(critical)']) expect(container.textContent, s).toContain(s)
  })
})

/* ── 4. "not yet integrated" ─────────────────────────────────────────────────── */

describe('"The live Decision OS backend is not yet integrated…"', () => {
  const MSG = 'The live Decision OS backend is not yet integrated in this environment.'
  it('reads «aún no» from one source, for every screen that shows it', () => {
    const es = 'El backend en vivo de Decision OS aún no está integrado en este entorno.'
    expect(cosErrorText(MSG, 'es')).toBe(es)
    expect(toolsText(MSG, 'es')).toBe(es)
    expect(cosErrorText(MSG, 'en')).toBe(MSG)
    expect(toolsText(MSG, 'en')).toBe(MSG)
  })
})

/* ── 5. "<template> generated successfully." ─────────────────────────────────── */

describe('"<template> generated successfully." keeps two shapes', () => {
  it('a list line in the activity feed, prose in the Reports preview', () => {
    expect(composedEventText('Weekly Recap generated successfully.', 'es')).toBe('Weekly Recap: se generó correctamente.')
    expect(reportText('Weekly Recap generated successfully.', 'es')).toBe('Weekly Recap se generó correctamente.')
    expect(composedEventText('Weekly Recap generated successfully.', 'en')).toBe('Weekly Recap generated successfully.')
    expect(reportText('Weekly Recap generated successfully.', 'en')).toBe('Weekly Recap generated successfully.')
  })

  it('no ⚠ in the Commissioner OS copy modules is still "pending a decision"', () => {
    for (const f of ['analyticsCopy', 'cardsCopy', 'shellCopy', 'toolsCopy']) {
      const src = readFileSync(join(ROOT, 'lib', 'commissioner-os', 'i18n', `${f}.ts`), 'utf8')
      expect(src, f).not.toMatch(/pending a decision/i)
      expect(src, f).not.toMatch(/left as shipped/i)
    }
  })
})

/* ── 6. Shared with /core, or not ────────────────────────────────────────────── */

describe("strings Commissioner OS shares with /core's coreUiCopy", () => {
  it('"This league could not be read." means the same thing on both, so COS reads /core\'s translation', () => {
    const msg = 'This league could not be read.'
    expect(coreUiCopy(msg, 'es')).not.toBe(msg)
    expect(toolsText(msg, 'es')).toBe(coreUiCopy(msg, 'es'))
    expect(toolsText(msg, 'en')).toBe(msg)
  })

  it('"Average margin" means two different numbers, so each screen keeps its own word', () => {
    // League Analytics: the league's mean margin of VICTORY. /core's Rivalry Radar: your signed
    // point difference against one rival.
    expect(analyticsDataText('Average margin', 'es')).toBe('Margen promedio')
    expect(coreUiCopy('Average margin', 'es')).toBe('Diferencia media')
    expect(analyticsDataText('Average margin', 'en')).toBe('Average margin')
  })
})

/* ── 7. A waiver CLAIM is «reclamo» ──────────────────────────────────────────── */

/**
 * The owner's ruling (2026-10-06): one manager's waiver claim is «reclamo» (masculine), the waiver
 * order is «prioridad de reclamo», a waiver deadline is «plazo de reclamos». «Agentes libres» stays
 * for the players themselves and for the Waivers screen. Plus the networks errors' singular
 * «red de comisionado», which #2113 found beside the plural heading.
 */
const FORBIDDEN_CLAIM: RegExp[] = [
  /reclamaci[oó]n(es)? de (los )?agentes libres/i,
  /solicitud(es)? de (los )?agentes libres/i,
  /orden de (los )?agentes libres/i,
  /plazos? de (los )?agentes libres/i,
  /(reclamos?|reclamaci[oó]n(es)?) de (los )?waivers?\b/i,
  /prioridad de (los )?waivers?\b/i,
  /red de comisionado(?!s)/i,
  // A claim is «reclamo» on its own, and the waiver order is «prioridad de reclamo»: neither takes
  // «de agentes libres», which is the players.
  /reclamos? de (los )?agentes libres/i,
  /prioridad de (los )?agentes libres/i,
]

describe('a waiver CLAIM is «reclamo», app-wide', () => {
  it('no source file renders a claim, the waiver order or a waiver deadline the old ways', () => {
    const files = ['lib', 'components', 'app'].flatMap((d) => sourceFiles(join(ROOT, d)))
    const rel = files.map((f) => relative(ROOT, f).replace(/\\/g, '/'))
    // Positive controls: the scan reached the modules the old renderings lived in, and every pattern
    // matches the rendering it was written for.
    for (const must of [
      'lib/commissioner-os/i18n/cardsCopy.ts',
      'lib/core-app/commissionerHubCopy.ts',
      'lib/core-app/homeBandsCopy.ts',
      'lib/core-app/coreUiCopy.ts',
      'lib/core-app/help-topics/home.ts',
      'lib/i18n/translations-es-parity.ts',
      'components/decision-os/UserOsCard.tsx',
    ])
      expect(rel, must).toContain(must)
    const samples = [
      'reclamaciones de agentes libres',
      'una solicitud de agentes libres',
      'Cambió el orden de agentes libres',
      'No hay plazos de agentes libres pendientes',
      'un reclamo de waivers',
      'la prioridad de waivers de cada equipo',
      'a una red de comisionado',
      'Resuelve los reclamos de agentes libres pendientes',
      'Prioridad de agentes libres rotativa',
    ]
    FORBIDDEN_CLAIM.forEach((re, i) => expect(re.test(samples[i]), String(re)).toBe(true))
    expect(FORBIDDEN_CLAIM.some((re) => re.test('Redes de comisionados')), 'the plural is allowed').toBe(false)
    expect(FORBIDDEN_CLAIM.some((re) => re.test('Abrir agentes libres')), 'the screen name is allowed').toBe(false)

    const hits: string[] = []
    files.forEach((file, i) => {
      const src = readFileSync(file, 'utf8')
      if (!FORBIDDEN_CLAIM.some((re) => re.test(src))) return
      src.split('\n').forEach((line, n) => {
        if (FORBIDDEN_CLAIM.some((re) => re.test(line))) hits.push(`${rel[i]}:${n + 1}: ${line.trim().slice(0, 140)}`)
      })
    })
    expect(hits).toEqual([])
  }, 180_000)

  it('Commissioner OS: the networks errors and the waiver-activity recommendation and pattern', () => {
    // The networks page's API errors are the cards' own strings; the rest is live loader text.
    const translate = (english: string, language: string) =>
      /commissioner network/.test(english) ? cardsCopy(english, language) : cosLoaderText(english, language)
    const cases: Array<[string, string]> = [
      ['A league already belongs to a commissioner network', 'Una de las ligas ya pertenece a una red de comisionados'],
      ['A league already belongs to another commissioner network', 'Una de las ligas ya pertenece a otra red de comisionados'],
      [
        'No waiver claims have been made. Post a waiver wire recap to show managers what is available.',
        // «agentes libres» here is the wire — the players on it — and stays.
        'No se ha hecho ningún reclamo. Publica un resumen de agentes libres para mostrar a los mánagers lo que hay disponible.',
      ],
      [
        'The same low-stakes waiver claim pattern has repeated for 3 consecutive weeks.',
        'El mismo patrón de reclamos de poca importancia se ha repetido 3 semanas seguidas.',
      ],
      ['Routine waiver approvals recurring weekly', 'Aprobaciones rutinarias de reclamos cada semana'],
    ]
    for (const [english, spanish] of cases) {
      expect(translate(english, 'es'), english).toBe(spanish)
      expect(translate(english, 'en'), english).toBe(english)
    }
    const desc =
      'Settles pending waiver claims for leagues that run batched waivers, in FAAB or rolling-priority order. Only applies to leagues whose waivers are run by AllFantasy — an imported league settles its waivers on its own platform, so this never has work to do for one.'
    expect(automationText(desc, 'es')).toMatch(/^Resuelve los reclamos pendientes en las ligas que los procesan por lotes, /)
  })

  it("the Commissioner Hub's waiver type, and the Waivers screen's Competitive Edge label", () => {
    // `WAIVER_TYPE_LABEL_ES` is module-private in a server module; read it where /core's own words are.
    const hub = readFileSync(join(ROOT, 'lib', 'core-app', 'commissionerHub.ts'), 'utf8')
    expect(hub).toContain(`rolling: '${coreUiCopy('Rolling waiver priority', 'es')}',`)
    expect(hub).toContain(`standard: '${coreUiCopy('Standard waiver priority', 'es')}',`)
    expect(coreUiCopy('Rolling waiver priority', 'es')).toBe('Prioridad de reclamo rotativa')
    expect(hub).toContain("rolling: 'Rolling waiver priority',")
    expect(WAIVER_EDGE_ES.aria).toBe('Ventaja competitiva · reclamos')
  })

  it("the Commissioner Hub's audit log, waiver panel and claim counts", () => {
    const cases: Array<[string, string]> = [
      ['Waiver claim', 'Reclamo'],
      ['Changed the waiver order', 'Cambió la prioridad de reclamo'],
      ['This run started and never finished, so some claims were not processed.', 'Este proceso empezó y nunca terminó, así que algunos reclamos no se procesaron.'],
      ['The last run processed no claims.', 'El último proceso no procesó ningún reclamo.'],
      [
        'Processes the claims waiting now, by this league’s rules. Settled claims are not re-run.',
        'Procesa los reclamos que esperan ahora, según las reglas de esta liga. Los reclamos ya resueltos no se vuelven a procesar.',
      ],
      ['Processed 1 claim.', 'Se procesó 1 reclamo.'],
      ['Processed 4 claims.', 'Se procesaron 4 reclamos.'],
    ]
    for (const [english, spanish] of cases) {
      expect(hubCopy(english, 'es'), english).toBe(spanish)
      expect(hubCopy(english, 'en'), english).toBe(english)
    }
  })

  it('the overdue-claims review card names its claims «reclamos»', () => {
    const one = reviewSignalCards('lg1', { ...NO_REVIEW_SIGNALS, overdueWaiverClaims: 1 }, 'es').find((c) => c.id === 'review:waivers')
    const two = reviewSignalCards('lg1', { ...NO_REVIEW_SIGNALS, overdueWaiverClaims: 2 }, 'es').find((c) => c.id === 'review:waivers')
    expect(one?.title).toBe('1 reclamo lleva más de una semana esperando')
    expect(two?.title).toBe('2 reclamos llevan más de una semana esperando')
    const en = reviewSignalCards('lg1', { ...NO_REVIEW_SIGNALS, overdueWaiverClaims: 2 }, 'en').find((c) => c.id === 'review:waivers')
    expect(en?.title).toBe('2 waiver claims waiting over a week')
  })

  it("the Commissioner Hub's charts, health flag, member activity, areas, calendar, format card and automation", () => {
    const now = new Date('2026-10-06T12:00:00Z')
    expect(activityChart([], now, 'es').subtitle).toBe('Intercambios, reclamos y cambios de plantilla por semana · últimas 8 semanas')
    expect(activityChart([], now, 'en').subtitle).toBe('Trades, waiver claims and roster moves per week · last 8 weeks')

    const rows = [
      { activityType: 'waiver', occurredAt: now, managerKeys: ['sleeper:1'] },
      { activityType: 'waiver', occurredAt: now, managerKeys: ['sleeper:1'] },
    ]
    const managers = [
      { key: '1', name: 'Xolo' },
      { key: '2', name: 'Zibba' },
    ]
    const wEs = waiverParticipationChart(rows, managers, 'es')
    const wEn = waiverParticipationChart(rows, managers, 'en')
    expect(wEs.subtitle).toBe('Reclamos por mánager · esta temporada')
    expect(wEs.takeaway).toBe('1 de 2 mánagers han hecho un reclamo · 2 reclamos en total.')
    expect(wEn.subtitle).toBe('Waiver claims by manager · this season')
    expect(wEn.takeaway).toBe('1 of 2 managers have made a claim · 2 claims in all.')

    type AbandonedInput = Parameters<typeof abandonedTeamsFlag>[0]
    const flag = (statuses: Array<'active' | 'inactive'>, language: string) =>
      abandonedTeamsFlag({
        managers: statuses.map((status, i) => ({ name: ['Xolo', 'Zibba'][i], status })),
        orphanTeams: [],
        totalTeams: statuses.length,
        action: { label: 'x', href: '/x', external: false },
        language,
      } as AbandonedInput)
    const qEs = flag(['inactive', 'inactive'], 'es')
    const qEn = flag(['inactive', 'inactive'], 'en')
    expect(qEs.measured && qEs.detail).toBe(
      'Ninguno de los 2 mánagers ha hecho un intercambio, un reclamo ni un cambio de plantilla en dos semanas. Es la liga la que está tranquila, no un equipo abandonado.',
    )
    expect(qEn.measured && qEn.detail).toBe(
      'None of the 2 managers has made a trade, waiver claim or roster move in two weeks. That is the league being quiet, not one team being abandoned.',
    )
    expect(JSON.stringify(flag(['inactive', 'active'], 'es'))).toContain('Sin intercambios, reclamos ni cambios de plantilla en 14 días: Xolo.')
    expect(JSON.stringify(flag(['inactive', 'active'], 'en'))).toContain('No trade, waiver claim or roster move in 14 days: Xolo.')

    const activity = (language: string) =>
      JSON.stringify(
        resolveMemberActivity(
          { kind: 'imported', managers: [{ managerName: 'Xolo', currentCount: 1, priorCount: 0, lastActionAt: now }], lastActivityAt: now, eventCount: 1 },
          now,
          14,
          language,
        ),
      )
    expect(activity('es')).toContain('los intercambios, reclamos y cambios de plantilla de los últimos 14 días')
    expect(activity('en')).toContain('trades, waiver claims and roster moves in the last 14 days')

    const imported: HubLeague = { id: 'L2', name: 'Zibba League', platform: 'sleeper', platformLeagueId: '987654321', season: 2026, native: false }
    const waiversArea = (language: string) => buildLeagueAreas(imported, language).find((a) => a.key === 'waivers')
    expect(waiversArea('es')?.description).toBe('Reclamos, FAAB y el último proceso.')
    expect(waiversArea('es')?.note).toBe('Los reclamos se procesan en Sleeper.')
    expect(waiversArea('en')?.description).toBe('Claims, FAAB and the last run.')
    expect(waiversArea('en')?.note).toBe('Claims are processed on Sleeper.')

    const calendar = (language: 'es' | 'en') =>
      buildLeagueCalendar({
        now,
        leagueId: 'lg1',
        platformLabel: 'Sleeper',
        native: true,
        status: 'in_season',
        season: 2026,
        draftAt: null,
        waivers: { type: 'faab', dayOfWeek: 3, timeUtc: '09:00' },
        tradeDeadlineWeek: null,
        noTradeDeadline: false,
        playoffStartWeek: null,
        currentWeek: 5,
        weekStarts: new Map(),
        dues: null,
        polls: [],
        language,
      }).events.find((e) => e.kind === 'waivers')
    expect(calendar('es')?.detail).toBe('Cada semana a esta hora. Los reclamos enviados antes se procesan juntos.')
    expect(calendar('en')?.detail).toBe('Every week at this time. Claims submitted before then are processed together.')

    const profile = { leagueId: 'L1', capabilityIds: ['elimination.guillotine'], aliasTags: [], conceptId: null, canonicalFormatId: null } as unknown as CommissionerLeagueProfile
    const guillotine = (language: string) => commissionerFormatCards(profile, null, language).find((c) => c.key === 'guillotine')
    expect(guillotine('es')?.detail).toBe('Revisa los cortes, las plantillas liberadas y los plazos de reclamos.')
    expect(guillotine('en')?.detail).toBe('Review cuts, released rosters and waiver timing.')

    const recipe = RECIPES.find((r) => r.key === 'inactivityWarning')!
    expect(recipeCatalogEntry(recipe, { platform: 'manual', sport: 'NFL' }, 'es').description).toBe(
      'Un aviso semanal amistoso que nombra a los mánagers sin intercambios, reclamos ni cambios de plantilla en 14 días.',
    )
    expect(recipeCatalogEntry(recipe, { platform: 'manual', sport: 'NFL' }, 'en').description).toBe(
      'A friendly weekly check-in naming managers with no trade, waiver claim or roster move in 14 days.',
    )
  })

  it('/core: "No waiver deadline is pending…", the home coverage and alert group, the league recommendation', () => {
    expect(coreUiCopy('No waiver deadline is pending across your leagues.', 'es')).toBe('No hay plazos de reclamos pendientes en tus ligas.')
    expect(coreUiCopy('No waiver deadline is pending across your leagues.', 'en')).toBe('No waiver deadline is pending across your leagues.')

    expect(coverageText({ label: 'Pending trade offers and waiver claims', reason: 'only completed transactions are read' })?.label).toBe(
      'Ofertas de intercambio y reclamos pendientes',
    )
    expect(alertGroupText('waiver_claim', 'waiver claims', 'es')).toBe('reclamos')
    expect(alertGroupText('waiver_claim', 'waiver claims', 'en')).toBe('waiver claims')

    const rec: Array<[string, string]> = [
      ['Waiver claims typically process overnight', 'Los reclamos suelen procesarse durante la noche'],
      [
        'Check when claims process or whether free agents can be added immediately',
        // «agentes libres» here ARE the players, and stay.
        'Comprueba cuándo se procesan los reclamos o si los agentes libres se pueden añadir al instante',
      ],
      ['Use your league’s actual claim schedule when planning moves', 'Planifica tus movimientos con el calendario real de reclamos de tu liga'],
    ]
    for (const [english, spanish] of rec) {
      expect(leagueRecommendationText(english, 'es'), english).toBe(spanish)
      expect(leagueRecommendationText(english, 'en'), english).toBe(english)
    }
  })

  it("the Player Finder's last move, and the User OS card's activity chip", () => {
    const now = new Date('2026-10-25T14:30:00.000Z')
    const manager: PresenceManager = {
      role: 'owner',
      teamName: 'Titanes',
      ownerName: 'tashaR',
      avatarUrl: null,
      externalId: '1',
      record: '4-2',
      rank: 3,
      need: null,
      startsHim: true,
      window: null,
      lastMove: { at: '2026-10-25T13:00:00.000Z', kind: 'waiver' },
      moves: 13,
    }
    const presence: ManagerPresence = {
      leagueId: 'L-gang',
      leagueName: 'Gridiron Gang',
      platform: 'sleeper',
      platformLeagueId: '123456',
      season: 2026,
      timeZone: 'America/New_York',
      zone: 'ET',
      player: { sleeperId: '10236', position: 'TE' },
      holder: 'other',
      managers: [manager],
      activityIngested: true,
      newestMove: '2026-10-25T13:00:00.000Z',
      unattributed: 0,
    }
    const args = { presence, manager, playerName: 'Dalton Kincaid', now, pkg: { give: ['Tony Pollard'], fairness: 'balanced' } }
    expect(pitchLineText(args, 'es').body).toContain('Último reclamo ganado: ')
    expect(pitchLineText(args, 'en')).toEqual(pitchLine(args))

    const snapshot = {
      leagueId: 'L1',
      managerId: 'm1',
      generatedAt: now.toISOString(),
      available: true,
      teamHealth: { participationTier: 'active', overallEngagementScore: 62, retentionRisk: 'low', retentionRiskReasons: [], isInactive: false, daysSinceLastActivity: 2 },
      activitySummary: { tradeEventCount: 2, waiverEventCount: 5, lineupEventCount: 8, draftEventCount: 0 },
      leagueTrend: { available: false, reason: 'no_snapshots' },
      managerDna: null,
      recommendations: null,
    } as unknown as UserOsSnapshot
    const { container, unmount } = render(<UserOsCard snapshot={snapshot} language="es" />)
    expect(container.textContent).toContain('Reclamos')
    expect(container.textContent).not.toContain('Reclamaciones')
    unmount()
    const { container: enContainer } = render(<UserOsCard snapshot={snapshot} language="en" />)
    expect(enContainer.textContent).toContain('Waiver claims')
  })

  it('the help topics name a claim «reclamo», without the anglicism', () => {
    expect(HOME_TOPICS.participationTier.es.body).toContain('2+ propuestas de cambio o reclamos, Activo')
    expect(HOME_TOPICS.commissionerTiles.es.body).toContain('hicieron un cambio, un reclamo o un movimiento de plantilla')
    expect(HOME_TOPICS.commissionerOverviewStats.es.body).toContain('ningún cambio, reclamo ni movimiento de plantilla')
    expect(HOME_TOPICS.activeManagers.es.body).toContain('hicieron un cambio, un reclamo o un movimiento de plantilla')
    expect(HOME_TOPICS.outstandingIssues.es.body).toContain('Aquí no se revisan reclamos, ofertas de intercambio ni votaciones.')
    expect(CAREER_TOPICS.competitiveEdge.es.body).toContain('sus traspasos completados y los reclamos que ganó esta temporada')
    // English untouched.
    expect(HOME_TOPICS.activeManagers.en.body).toContain('made a trade, waiver claim or roster move')
    expect(CAREER_TOPICS.competitiveEdge.en.body).toContain('the waiver claims they won this season')
  })

  it('the legacy i18n table: claims and the waiver priority', () => {
    const es = translations.es as Record<string, string>
    const en = translations.en as Record<string, string>
    const cases: Array<[string, string, string]> = [
      ['dashboard.warroom.commissionerHQ.action.pendingWaivers', '{{n}} reclamo(s) esperando tu revisión', '{{n}} waiver claim(s) awaiting your review'],
      [
        'dashboard.warroom.commissionerHQ.health.engagementWhy',
        'Actividad — proporción de alineaciones enviadas, cambios y reclamos activos en tu liga. Toca para ver el detalle completo.',
        'Activity — share of active lineup submissions, trades, and waiver claims across your league. Tap for the full breakdown.',
      ],
      ['decide.kpi.waiverPriority', 'prioridad de reclamo {{n}}', 'waiver priority {{n}}'],
      ['lsPanel.tools.editWaiverDesc', 'Cambia el presupuesto FAAB y la prioridad de reclamo de cada equipo.', 'Override FAAB budget and waiver priority per team.'],
      [
        'lsPanel.tools.hint.editWaiver',
        'Usa la app anfitriona para editar el FAAB y la prioridad de reclamo de cada equipo.',
        'Use the host to edit FAAB and waiver priority per team after you jump in.',
      ],
    ]
    for (const [key, spanish, english] of cases) {
      expect(es[key], key).toBe(spanish)
      expect(en[key], key).toBe(english)
    }
    expect(es['coowner.info']).toContain('hacer reclamos, proponer trades')
    expect(en['coowner.info']).toContain('make waiver claims, propose trades')
  })
})

/* ── 8. No Spanish value says «waiver» ───────────────────────────────────────── */

/** The word itself — not `waiverPriority`, `waiver_claim`, `/core/waivers` or `{{waiverDay}}`. */
const WAIVER_WORD = /(?<![\w/#.\-{])waivers?(?![\w\-/}])/i
/** A made-up team NAME on the landing page's demo board — a name, not vocabulary. */
const PROPER_NAMES = /Waiver Warriors/g
const saysWaiver = (s: string) => WAIVER_WORD.test(s.replace(PROPER_NAMES, ''))

/** Every string leaf of a copy object. */
function leaves(value: unknown, path = '', out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof value === 'string') out.push([path, value])
  else if (typeof value === 'function') leaves((value as (p: null) => unknown)(null), `${path}()`, out)
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) leaves(v, path ? `${path}.${k}` : k, out)
  return out
}

/*
 * The source sweep. A string literal is Spanish when it sits in the es table of the legacy i18n
 * file or in its es-parity file, follows `es ?`, is keyed `es:` / `labelEs:` (any `…Es:`), is the
 * second argument of a two-language call (`L('Open waivers', '…')`), or reads as Spanish — the last
 * one a word-list heuristic that skips the landing page's other languages.
 */
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
const SPANISH_MARKS = /[áéíóúñ¿¡«»]/g
const SPANISH_WORDS =
  /\b(el|los|las|la|de|del|que|una|un|para|tus?|con|se|y|en|esta|este|por|al|reclamos?|agentes|ligas?|semana|equipos?|tiene|cuando|hoy|cambios|herramientas|diarios|rotativos|lista)\b/gi
const ENGLISH_WORDS = /\b(the|and|your|you|is|are|of|to|for|with|this|that|on|in|it|be|or|from|by|an)\b/gi
const OTHER_LANGUAGE =
  /[đăơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ一-鿿]|\b(ang|ng|mga|sa|kay|ay|và|của|lahat|naghihintay)\b/i
/** More Spanish than English, by marks and short function words. A capital "Y" is a variable name. */
function readsSpanish(text: string): boolean {
  if (OTHER_LANGUAGE.test(text)) return false
  const es = (text.match(SPANISH_MARKS)?.length ?? 0) + (text.match(SPANISH_WORDS)?.filter((w) => w !== 'Y').length ?? 0)
  return es > (text.match(ENGLISH_WORDS)?.length ?? 0)
}

function spanishWaiverLiterals(rel: string, rawSrc: string): string[] {
  // Blank out comments (keeping offsets and line numbers), so prose about the rule is not a hit.
  const src = rawSrc
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '))
  let esFrom = -1
  let esTo = -1
  if (rel === 'lib/i18n/translations.ts') {
    esFrom = src.indexOf('\n  es: {')
    esTo = esFrom + 5 + src.slice(esFrom + 5).search(/\n {2}[a-z]{2}: \{/)
  }
  const hits: string[] = []
  let prev: { start: number; end: number; text: string } | null = null
  for (const m of src.matchAll(LITERAL)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    // Counted only for a hit: counting every literal's line is quadratic in a 8,000-line file.
    const lineOf = () => src.slice(0, start).split('\n').length
    let text = m[1] ?? m[2] ?? m[3] ?? ''
    if (m[3] !== undefined && text.includes('${')) {
      // A template's `${…}` holes are code: sweep them as code, and judge the template on its own words.
      for (const hole of text.matchAll(/\$\{([^{}]*)\}/g))
        if (WAIVER_WORD.test(hole[1]))
          hits.push(...spanishWaiverLiterals(rel, hole[1]).map((h) => h.replace(/:\d+:/, `:${lineOf()}:`)))
      text = text.replace(/\$\{[^{}]*\}/g, ' ')
    }
    const last = prev
    prev = { start, end, text }
    if (!saysWaiver(text)) continue
    const before = src.slice(Math.max(0, start - 60), start)
    // An object key — but not the first branch of a ternary (`es ? 'Waivers' : 'Waivers'`).
    if (/^\s*:/.test(src.slice(end, end + 3)) && !/\?\s*$/.test(before)) continue
    const spanish =
      (esFrom >= 0 && start > esFrom && start < esTo) ||
      rel === 'lib/i18n/translations-es-parity.ts' ||
      /\b(es|isEs|isSpanish|spanish)\s*\?\s*$/.test(before) ||
      /===?\s*'es'\s*\?\s*$/.test(before) ||
      /(\b\w*Es|\bes)\s*:\s*$/.test(before) ||
      (last !== null &&
        /^\s*,\s*$/.test(src.slice(last.end, start)) &&
        // Only the two-language helpers (`L(en, es)`, `t(en, es)`): `series('waivers', 'Waivers', …)` is not one.
        /(?<![\w.])(L|t|tr|tx|bi)\(\s*$/.test(src.slice(Math.max(0, last.start - 12), last.start)) &&
        saysWaiver(last.text)) ||
      readsSpanish(text)
    if (spanish && !OTHER_LANGUAGE.test(text)) hits.push(`${rel}:${lineOf()}: ${text.replace(/\s+/g, ' ').slice(0, 140)}`)
  }
  return hits
}

describe('no Spanish value says «waiver» (the owner: "fix all")', () => {
  it('the sweep and its word test catch what they exist for, and nothing else', () => {
    // Positive controls — each shape the old code used, as the sweep sees it.
    const control = (rel: string, src: string) => spanishWaiverLiterals(rel, src).length
    expect(control('x.tsx', "const a = es ? 'Waivers' : 'Waivers'"), 'after es ?').toBe(1)
    expect(control('x.ts', "add('k', L('Open waivers', 'Abrir waivers'))"), 'second argument').toBe(1)
    expect(control('x.ts', "const t = { labelEs: 'Waivers' }"), '…Es: key').toBe(1)
    expect(control('lib/i18n/translations-es-parity.ts', '  "lsHub.tab.waivers": "Waivers",'), 'es-parity value').toBe(1)
    expect(control('x.ts', "body: 'Una semana de fantasy: resultados el martes, waivers el miércoles.'"), 'reads Spanish').toBe(1)
    expect(control('lib/i18n/translations.ts', '  en: {\n    "k": "Waivers"\n  },\n  es: {\n    "k": "Waivers"\n  },\n  vi: {\n  }'), 'translations.es only').toBe(1)
    // …and the shapes it must leave alone.
    expect(control('x.ts', "L('Open waivers', 'Abrir agentes libres')"), 'translated').toBe(0)
    expect(control('x.ts', "const href = '/core/waivers'; const k = 'waiverPriority'"), 'paths and ids').toBe(0)
    expect(control('x.ts', "const e = 'Waivers processed. 2 claims awarded.'"), 'English').toBe(0)
    expect(control('x.ts', "const v = 'Trên mọi giải cùng lúc: waiver hôm nay'"), 'another language').toBe(0)
    expect(control('x.ts', "tag: 'Tu WR en Waiver Warriors está Questionable'"), 'a team name').toBe(0)
    expect(control('x.ts', '/* the Waivers screens\' words, for el equipo */ const a = 1'), 'a comment').toBe(0)
    expect(control('x.ts', "d: \"Prices a waiver pickup: 'add X and drop Y'.\""), 'English with a capital Y').toBe(0)
    expect(control('x.tsx', "const s = `${es ? 'agentes libres' : 'waivers'}: ${why}`"), 'a template hole, translated').toBe(0)
    expect(control('x.tsx', "const s = `${es ? 'Waivers' : 'Waivers'}: ${why}`"), 'a template hole, not translated').toBe(1)
    expect(saysWaiver('{{weeks}} semanas · Waivers {{waiverDay}}')).toBe(true)
    expect(saysWaiver('Reclamos {{waiverDay}}')).toBe(false)
  })

  it('no source file has a Spanish string that says «waiver»', () => {
    const files = ['lib', 'components', 'app'].flatMap((d) => sourceFiles(join(ROOT, d)))
    const rel = files.map((f) => relative(ROOT, f).replace(/\\/g, '/'))
    for (const must of [
      'lib/i18n/translations.ts',
      'lib/i18n/translations-es-parity.ts',
      'lib/i18n/landing-copy.ts',
      'lib/core-app/help-topics/home.ts',
      'lib/core-app/teamWorkspaceCopy.ts',
      'components/landing/nocturne/copy.i18n.ts',
      'components/core-app/screens/DraftPhase4.tsx',
    ])
      expect(rel, must).toContain(must)
    const hits: string[] = []
    files.forEach((file, i) => {
      const src = readFileSync(file, 'utf8')
      if (!/waiver/i.test(src)) return
      hits.push(...spanishWaiverLiterals(rel[i], src.replace(/\r\n/g, '\n')))
    })
    expect(hits).toEqual([])
  }, 180_000)

  it('no Spanish copy object says «waiver»: the i18n table, the landing pages and every help topic', () => {
    const es = translations.es as Record<string, string>
    expect(Object.keys(es).length, 'the es table loaded').toBeGreaterThan(1000)
    const prices = { min: '$4.99', max: '$9.99' }
    const sources: Array<[string, unknown]> = [
      ['translations.es', es],
      ['landing (prices)', getLandingCopy('es', prices)],
      ['landing (no prices)', getLandingCopy('es', null)],
      ['nocturne', getNocturneCopy('es')],
      ['journey', JOURNEY_COPY.es],
      ...Object.entries({ HOME_TOPICS, CAREER_TOPICS, DRAFT_TOPICS, OUTLOOK_TOPICS, RANKINGS_TOPICS, TRADES_TOPICS, WAIVERS_TOPICS }).map(
        ([name, topics]): [string, unknown] => [name, Object.fromEntries(Object.entries(topics).map(([k, t]) => [k, (t as { es: unknown }).es]))],
      ),
    ]
    const hits: string[] = []
    for (const [name, obj] of sources) {
      const strings = leaves(obj)
      expect(strings.length, name).toBeGreaterThan(0)
      for (const [path, text] of strings) if (saysWaiver(text)) hits.push(`${name} ${path}: ${text.slice(0, 120)}`)
    }
    // The English beside them still says "waiver" — the walk reads real copy, not an empty shell.
    expect(leaves(getLandingCopy('en', null)).some(([, t]) => saysWaiver(t)), 'English landing control').toBe(true)
    expect(leaves(translations.en).some(([, t]) => saysWaiver(t)), 'English table control').toBe(true)
    expect(hits).toEqual([])
  })

  it('a sample, pinned in Spanish with its English unchanged', () => {
    const es = translations.es as Record<string, string>
    const en = translations.en as Record<string, string>
    const cases: Array<[string, string, string]> = [
      ['lsPanel.waiverType', 'Tipo de reclamos', 'Waiver type'],
      ['lsHub.wv.type', 'Tipo de reclamos', 'Waiver type'],
      ['lsPanel.waiver.rolling', 'Prioridad de reclamo rotativa', 'Rolling waivers'],
      ['lsHub.wv.rolling', 'Prioridad de reclamo rotativa', 'Rolling waivers'],
      ['lsHub.wv.reverse', 'Prioridad de reclamo por clasificación inversa', 'Reverse standings'],
      ['lsPanel.waiver.faab', 'FAAB (presupuesto)', 'FAAB (waiver budget)'],
      ['lsPanel.rules.budget', 'Presupuesto FAAB', 'Waiver / FAAB budget'],
      ['lsHub.wv.period', 'Período de reclamos (h)', 'Waiver period (hrs)'],
      ['lsPanel.rules.waiverTime', 'Período de reclamos', 'Waiver time'],
      ['lsHub.tab.waivers', 'Agentes libres', 'Waivers'],
      ['league.appSettings.subtab.waiverSettings', 'Agentes libres', 'Waiver Settings'],
      ['lsPanel.rules.waiversBudget', 'Agentes libres y presupuesto', 'Waivers & budget'],
      ['dashboard.warroom.waiverWire.title', 'Agentes libres', 'Waiver Wire'],
      ['dashboard.warroom.actionCenter.waiverDetail', 'Revisa los agentes libres', 'Check the waiver wire'],
      ['landing.previews.leagueDashboard.snippet', 'Semana 6 · Power rankings · Vistas previas de matchups · Prioridad de reclamo', 'Week 6 · Power rankings · Matchup previews · Waiver order'],
      ['createLeague.team.guillotineDaily', ' · período de reclamos de 2 días por defecto', ' · 2-day waiver freeze default'],
      ['decide.shadow.body', 'Importada de {{source}}. Edita alineaciones, trades y reclamos con libertad: los cambios se quedan en AllFantasy y nunca llegan a {{source}}, que sigue siendo el registro oficial de tu liga.', "Imported from {{source}}. Edit lineups, trades and waivers freely — changes stay inside AllFantasy and never reach {{source}}, which remains your league's system of record."],
      ['home.tools.waiver.cta', 'Abrir Asesor de agentes libres', 'Open Waiver Advisor'],
    ]
    for (const [key, spanish, english] of cases) {
      expect(es[key], key).toBe(spanish)
      expect(en[key], key).toBe(english)
    }

    // The help tip #2117 flagged: «waivers el miércoles» was the waiver RUN.
    expect(HOME_TOPICS.yourWeekRoutine.es.body).toContain(
      'resultados el martes, procesamiento de reclamos el miércoles, alineaciones de jueves a sábado',
    )
    // …and the second «waivers» there is the routine's step, which /core names «Agentes libres».
    expect(HOME_TOPICS.yourWeekRoutine.es.body).toContain('agentes libres cuando hiciste una incorporación esta semana')
    expect(HOME_TOPICS.yourWeekRoutine.en.body).toContain('results Tuesday, waivers Wednesday, lineups Thursday to Saturday')

    expect(teamWorkspaceCopy('Waiver claims and roster impact', 'es')).toBe('Reclamos y efecto en la plantilla')
    expect(teamWorkspaceCopy('Waiver deadlines', 'es')).toBe('Plazos de reclamos')
    expect(teamWorkspaceCopy('Waiver deadlines', 'en')).toBe('Waiver deadlines')

    expect(JSON.stringify(getNocturneCopy('es'))).toContain('Reclamos hoy')
    expect(JSON.stringify(getNocturneCopy('en'))).toContain('Waiver today')
    expect(JOURNEY_COPY.es.journey.waiverWednesday.eyebrow).toBe('Miércoles de reclamos')
    expect(JOURNEY_COPY.en.journey.waiverWednesday.eyebrow).toBe('Waiver Wednesday')
  })
})
