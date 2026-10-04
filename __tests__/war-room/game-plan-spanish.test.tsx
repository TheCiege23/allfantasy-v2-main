/**
 * Game Plan in the reader's language (2026-10-04). It is a client component that never read the
 * language, so the room on the War Room and the plan inline on Scout stayed English in Spanish mode —
 * including what the loaders write: the injury designation on a chip, the lock label, and the
 * "Lineups as of" stamp from the shared Refresh control. Each Spanish case has an English control, so
 * a translation that leaks into English mode fails here too.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => {
    const { prefetch: _p, ...attrs } = rest as Record<string, unknown>
    return <a href={href} {...(attrs as Record<string, string>)}>{children as never}</a>
  },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/war-room',
  useSearchParams: () => new URLSearchParams(),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { GamePlan } from '@/components/core-app/screens/GamePlan'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { lockState } from '@/lib/core-app/lineupLock'
import { asOfLabel } from '@/components/core-app/player-finder/RefreshLineups'
import type { GameDayTriage, TriageRow } from '@/lib/core-app/gameDayTriage'

// Sunday 2026-09-27, 11:40a ET.
const NOW = '2026-09-27T15:40:00.000Z'
const league = (id: string) => ({ leagueId: id, leagueName: `League ${id}`, platform: 'allfantasy', platformLeagueId: null, season: 2026, teamId: null })
const row = (name: string, kickoff: string | null, label: string, extra: Partial<TriageRow> = {}): TriageRow => ({
  player: { sport: 'NFL', externalId: `x-${name}`, sleeperId: name, name, position: 'WR', team: 'NYG', imageUrl: null },
  status: { label, tone: 'warn' },
  description: null,
  reportedAt: null,
  leagues: [league('A')],
  kickoff,
  noGame: false,
  inactive: null,
  bye: false,
  ...extra,
})

const DATA: GameDayTriage = {
  rows: [
    row('Soon Guy', '2026-09-27T17:00:00.000Z', 'Questionable'), // locks in 1h 20m
    row('Later Guy', '2026-09-29T00:15:00.000Z', 'Doubtful'), // Mon 8:15p ET — over a day away
    row('Gone Guy', '2026-09-27T13:30:00.000Z', 'Out'), // kicked off
    row('Bye Guy', null, 'Probable', { bye: true }),
  ],
  week: { season: 2026, week: 4 },
  leaguesRead: 2,
  startersRead: 20,
  bestBallLeagues: 1,
  unsupportedLeagues: 2,
  rostersAsOf: '2026-09-27T14:40:00.000Z',
  emptySlots: [{ ...league('B'), count: 2 }],
}

const render = (language: 'en' | 'es', data: Partial<GameDayTriage> = {}, scope: 'all' | 'league' = 'all', showHead = true) => {
  lang.language = language
  return renderToStaticMarkup(
    <GamePlan data={{ ...DATA, ...data }} nowIso={NOW} weekHref="/core/week" waiversHref="/core/waivers" scope={scope} showHead={showHead} />,
  )
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}
/**
 * Visible text: tags removed WITHOUT spaces, so "2026<!-- -->." stays "2026." The "?" tips are cut first —
 * their Spanish deliberately quotes the feed's English designations ("Questionable, Doubtful").
 */
const text = (html: string) =>
  html.replace(/<span class="af-info-para">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '')

describe('Game Plan in Spanish', () => {
  it('the heading, blurb, coverage line and footer', () => {
    const t = text(render('es'))
    expect(t).toContain('Plan de juego')
    expect(t).toContain('Semana 4 de 2026.')
    expect(t).toContain('20 titulares revisados en 2 ligas · 1 ya bloqueado y al final.')
    expect(t).toContain('Esto señala quién está en riesgo.')
    expect(t).toContain('Tu semana · todos los enfrentamientos →')
    expect(t).toContain('Agentes libres →')
    for (const en of ['Game plan', 'starters checked across', 'This flags who is at risk', 'Your week · every matchup']) {
      expect(t).not.toContain(en)
    }
  })

  it('the summary tiles and the leagues it skipped', () => {
    const html = render('es')
    const t = text(html)
    for (const es of ['Titulares señalados', 'Puestos vacíos', 'Ligas afectadas', 'Primer bloqueo']) expect(t).toContain(es)
    expect(t).toContain('1 liga best ball omitida: la plataforma arma esas alineaciones')
    expect(t).toContain('2 en una plataforma que todavía no podemos leer')
    expect(html).toContain('aria-label="Esta semana de un vistazo"')
    expect(t).not.toContain('best-ball league skipped')
  })

  it('the loader-written chip status and every lock form, weekday included', () => {
    const t = text(render('es'))
    expect(t).toContain('Dudoso')
    expect(t).toContain('Poco probable')
    expect(t).toContain('se bloquea en 1h 20m')
    expect(t).toContain('se bloquea lun 8:15p ET')
    expect(t).toContain('bloqueado · empezó dom 9:30a ET')
    expect(t).toContain('DESCANSA')
    for (const en of ['Questionable', 'Doubtful', 'locks in', 'kicked off', 'Mon 8:15p', 'ON BYE']) expect(t).not.toContain(en)
  })

  it('the empty-slot rows', () => {
    const html = render('es')
    const t = text(html)
    expect(t).toContain('2 puestos titulares vacíos')
    expect(t).toContain('un puesto vacío anota cero')
    expect(t).toContain('VACÍO')
    expect(t).toContain('complétalo antes del bloqueo de tu liga')
    expect(html).toContain('aria-label="Alineaciones con un puesto titular vacío"')
  })

  it('the Refresh control’s stamp and button', () => {
    const t = text(render('es'))
    expect(t).toContain('Alineaciones a las 10:40a ET · hace 1 h 0 min')
    expect(t).toContain('Actualizar mis alineaciones')
    expect(t).not.toContain('Lineups as of')
  })

  it('the league scope (inline on Scout) and its empty state', () => {
    const t = text(render('es', { rows: [], emptySlots: [] }, 'league', false))
    expect(t).toContain('Tu alineación en esta liga · qué arreglar antes del bloqueo · semana 4')
    expect(t).toContain('Ningún titular de esta alineación está señalado esta semana.')
  })

  it('the nothing-read empty state', () => {
    const t = text(render('es', { rows: [], emptySlots: [], startersRead: 0, leaguesRead: 0 }))
    expect(t).toContain('No se pudo leer ninguna alineación titular, así que aquí no se revisó nada.')
  })
})

describe('CONTROL — English is unchanged', () => {
  it('reads exactly the English it always did', () => {
    const t = text(render('en'))
    for (const en of [
      'Game plan',
      'Week 4 of 2026.',
      '20 starters checked across 2 leagues · 1 already locked and shown at the end.',
      'Questionable',
      'Doubtful',
      'locks in 1h 20m',
      'locks Mon 8:15p ET',
      'locked · kicked off Sun 9:30a ET',
      'ON BYE',
      '2 empty starting slots',
      '1 best-ball league skipped — the platform sets those lineups',
      'Lineups as of 10:40a ET · 1h 0m ago',
      'Refresh my lineups',
      'This flags who is at risk.',
    ]) {
      expect(t, en).toContain(en)
    }
    for (const es of ['Dudoso', 'se bloquea', 'Plan de juego', 'Actualizar']) expect(t).not.toContain(es)
  })
})

describe('the patterns, on the formatters’ real output', () => {
  it('every lockState form', () => {
    expect(coreUiCopy(lockState('2026-09-27T15:50:00.000Z', NOW).label, 'es')).toBe('se bloquea en 10 min')
    expect(coreUiCopy(lockState('2026-09-27T17:00:00.000Z', NOW).label, 'es')).toBe('se bloquea en 1h 20m')
    expect(coreUiCopy(lockState('2026-10-01T00:15:00.000Z', NOW).label, 'es')).toBe('se bloquea mié 8:15p ET')
    expect(coreUiCopy(lockState('2026-09-27T13:00:00.000Z', NOW).label, 'es')).toBe('bloqueado · empezó dom 9:00a ET')
    expect(coreUiCopy(lockState('nope', NOW).label, 'es')).toBe('hora de bloqueo desconocida')
  })

  it('every asOfLabel form', () => {
    const at = (minsAgo: number) => new Date(Date.parse(NOW) - minsAgo * 60_000).toISOString()
    for (const [mins, es] of [
      [0, /· ahora mismo$/],
      [5, /· hace 5 min$/],
      [125, /· hace 2 h 5 min$/],
      [3 * 24 * 60, /^Alineaciones (a las .+ · |de )hace 3 d$/],
    ] as const) {
      const en = asOfLabel(at(mins), NOW)!
      expect(coreUiCopy(en, 'es'), en).toMatch(es)
      expect(coreUiCopy(en, 'es'), en).not.toContain('ago')
    }
  })

  it('the refresh notes', () => {
    expect(coreUiCopy('Refreshing your lineups… 2 of 5', 'es')).toBe('Actualizando tus alineaciones… 2 de 5')
    expect(coreUiCopy('1 league could not be refreshed — reloading the rest', 'es')).toBe('1 liga no se pudo actualizar: recargando el resto')
    expect(coreUiCopy('3 leagues could not be refreshed — reloading the rest', 'es')).toBe('3 ligas no se pudieron actualizar: recargando el resto')
  })
})
