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
import { cardsCopy, taskPriorityLabelText } from '@/lib/commissioner-os/i18n/cardsCopy'
import { NETWORKS_LINK_ES, deadlineLabelText, leagueEventNameText, shellText } from '@/lib/commissioner-os/i18n/shellCopy'
import { analyticsDataText, cosErrorText, reportText, taskText } from '@/lib/commissioner-os/i18n/analyticsCopy'
import { automationText, composedEventText, toolsText } from '@/lib/commissioner-os/i18n/toolsCopy'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'
import { alertGroupText } from '@/lib/core-app/homeBandsCopy'
import { buildLeagueCalendar, type CalendarInput } from '@/lib/core-app/commissioner/calendar'
import { NO_REVIEW_SIGNALS, reviewSignalCards } from '@/lib/core-app/commissioner/signals'
import { translations } from '@/lib/i18n/translations'

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
  /proceso de (los )?agentes libres/i,
  /ronda de (los )?agentes libres/i,
  /proces(a|ar|ó|aron|an) (los |las solicitudes de )?agentes libres/i,
  /agentes libres se procesan/i,
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
    expect(es?.detail).toBe('Un procesamiento de reclamos ya debería haber resuelto estas solicitudes. Procesa los reclamos para resolverlas.')
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
        '1 solicitud está esperando. Solo el comisionado principal puede procesar los reclamos manualmente.',
      ],
      [
        '3 claims are waiting. Only the primary commissioner can run waivers manually.',
        '3 solicitudes están esperando. Solo el comisionado principal puede procesar los reclamos manualmente.',
      ],
      ['Run waivers now · 3 waiting', 'Procesar reclamos ahora · 3 en espera'],
      ['Nothing processed — waivers are locked or no claims were waiting.', 'No se procesó nada: los reclamos están bloqueados o no había solicitudes esperando.'],
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
