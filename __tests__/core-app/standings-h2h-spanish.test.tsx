// @vitest-environment jsdom
/**
 * Standings in a head-to-head league, in the reader's language (2026-10-05). #1989 translated the
 * table a guillotine league shows; a live Spanish sweep of a head-to-head dynasty league then found the
 * parts only such a league draws still English — "What is at stake", the path sentence, the rooting
 * pairs, the projection basis, the head-to-head grid, the streak and schedule-strength tooltips, the
 * column heads and the view controls. This renders the whole screen with odds in Spanish and sweeps the
 * text AND every aria-label/title for English, with an English control.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

import { Standings } from '@/components/core-app/screens/Standings'
import type { LeagueStandingsResult } from '@/lib/core-app/leagueStandings'
import type { StandingsOdds } from '@/lib/core-app/standingsOdds'
import { DEFAULT_STANDINGS_VIEW } from '@/lib/core-app/standingsView'
import {
  advanceWeek,
  buildStandingsBoard,
  type StandingsRules,
  type TeamMeta,
  type WeekRow,
  type WeekSnapshot,
} from '@/lib/core-app/standingsModel'

const RULES: StandingsRules = {
  playoffTeams: 2,
  playoffTeamsSource: 'league',
  byes: 0,
  regularSeasonEnd: null,
  tiebreakers: ['points_for', 'head_to_head'],
  tiebreakerSource: 'platform',
  rankIsOfficial: false,
  platformLabel: 'Sleeper',
}
const IDS = ['1', '2', '3', '4']
const row = (week: number, m: number, id: string, pf: number, pa: number): WeekRow => ({ week, rosterId: id, matchupId: m, pointsFor: pf, pointsAgainst: pa })

function snapshots(weeks: number): WeekSnapshot[] {
  const out: WeekSnapshot[] = []
  for (let w = 1; w <= weeks; w += 1) {
    const rows = [
      row(w, 1, '1', 150, 120 + w),
      row(w, 1, '2', 120 + w, 150),
      row(w, 2, '3', w % 2 ? 110 : 100, w % 2 ? 100 : 110),
      row(w, 2, '4', w % 2 ? 100 : 110, w % 2 ? 110 : 100),
    ]
    out.push(advanceWeek(out[w - 2] ?? null, 2026, w, rows, IDS, `s${w}`))
  }
  return out
}
const teams = (): TeamMeta[] =>
  IDS.map((id) => ({ rosterId: id, name: `Club ${id}`, avatarUrl: null, isYou: id === '3', division: null, reported: null }))
const board = () =>
  buildStandingsBoard({
    season: 2026,
    snapshots: snapshots(4),
    unplayed: [
      { week: 5, a: '1', b: '3' },
      { week: 5, a: '2', b: '4' },
      { week: 6, a: '1', b: '4' },
      { week: 6, a: '2', b: '3' },
    ],
    teams: teams(),
    rules: RULES,
  })

const ODDS: StandingsOdds = {
  byRoster: {
    '1': { playoffPct: 97.4, byePct: 0, modelled: true, sosRank: 4, sosOpponentMu: 104 },
    '2': { playoffPct: 0.3, byePct: 0, modelled: true, sosRank: 3, sosOpponentMu: 105 },
    '3': { playoffPct: 55.2, byePct: 0, modelled: false, sosRank: 1, sosOpponentMu: 140 },
    '4': { playoffPct: 47.1, byePct: 0, modelled: true, sosRank: 2, sosOpponentMu: 138 },
  },
  sosRanked: 4,
  leagueMu: 121,
  iterations: 10_000,
  you: { rosterId: '3', playoffPct: 55.2, whatDecidesIt: 'Get to 4 wins — 2 of your last 2 — and you are in more often than not.' },
  stakes: {
    week: 5,
    opponentName: 'Club 1',
    ifWin: 81.2,
    ifLose: 30.4,
    clinchOnWin: true,
    helpIfLose: ['Club 4'],
    rooting: [{ a: { id: '2', name: 'Club 2' }, b: { id: '4', name: 'Club 4' }, ifA: 66.1, ifB: 40.4, rootFor: '2' }],
  },
  basis: '10,000 simulations per league.',
  href: '/core/season-outlook?league=L1',
}

function data(): LeagueStandingsResult {
  return {
    available: true,
    league: { id: 'L1', name: 'Liga Prueba', platform: 'sleeper' },
    season: 2026,
    week: 5,
    seasonComplete: false,
    teams: [],
    you: null,
    trend: [],
    recent: [],
    projection: {
      available: true,
      data: {
        mid: 640,
        low: 600,
        high: 680,
        weeksRemaining: 2,
        basis: 'Projects your 110.0 per week across the 2 games left. The range is one standard deviation of your own weekly scoring over 4 scored weeks.',
      },
    },
    scoredWeeks: 4,
    history: [],
    board: board(),
  } as unknown as LeagueStandingsResult
}

beforeEach(() => {
  window.history.replaceState(null, '', '/core/standings?league=L1')
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  h.language = 'en'
})

function screenText(language: 'en' | 'es', layout: 'table' | 'cards' = 'table'): string {
  h.language = language
  const { container } = render(<Standings data={data()} odds={ODDS} view={{ ...DEFAULT_STANDINGS_VIEW, layout }} />)
  const attrs = [...container.querySelectorAll('[aria-label],[title]')].map((e) => `${e.getAttribute('aria-label') ?? ''} | ${e.getAttribute('title') ?? ''}`)
  return `${container.textContent ?? ''}\n${attrs.join('\n')}`
}

// Shell words only English uses. Fixture names ("Club N", "Liga Prueba") are none of these.
const ENGLISH =
  /\b(the|your|you|with|this|that|from|for|of|is|are|and|wins?|lost|points|week|games?|played|last|next|streak|strk|record|team|schedule|hardest|odds|share|root|lose|stake|against|across|projects?|range|head to head|view|standings|sort|ascending|descending|unknown|over|magic|efficiency|median)\b/i

describe('Standings (head-to-head) in Spanish', () => {
  it('reads Spanish across the stakes, the grid, the tooltips and the controls', () => {
    const t = screenText('es')
    for (const es of [
      'Qué está en juego',
      'probabilidad de playoffs',
      'Llega a 4 victorias',
      'Tu partido · semana 5 vs Club 1',
      'Si ganas, estás dentro en prácticamente todas las temporadas simuladas.',
      'Si pierdes, lo que más necesitas es que Club 4 se quede fuera de playoffs.',
      'Apoya a · semana 5',
      'Cara a cara',
      'Proyecta tus 110.0 por semana',
      'Compartir clasificación',
    ]) {
      expect(t, es).toContain(es)
    }
    const leftover = t.replace(/Club \d|Liga Prueba|Sleeper|AllFantasy|AF Power|Season Outlook/g, '').match(ENGLISH)
    expect(
      leftover?.[0] ?? null,
      `English left: "${leftover?.input?.slice(Math.max(0, (leftover.index ?? 0) - 70), (leftover.index ?? 0) + 70).replace(/\n/g, ' ⏎ ')}"`,
    ).toBeNull()
  })

  it('CONTROL — English is unchanged', () => {
    const t = screenText('en')
    for (const en of [
      'What is at stake',
      'playoff odds',
      'Your game · week 5 vs Club 1',
      'Win and you are in, in essentially every simulated season.',
      'Root for · week 5',
      'Head to head',
      'Projects your 110.0 per week',
      'hardest remaining schedule of 4',
    ]) {
      expect(t, en).toContain(en)
    }
    expect(t).not.toMatch(/Qué está en juego|Apoya a|Cara a cara/)
  })

  /*
   * The phone card layout labels each figure itself, separately from the table's column heads. The
   * 2026-10-06 live check found five of them English after the table was fixed — this test rendered
   * only the table, so it could not see them.
   */
  it('the card layout (phones) reads Spanish too', () => {
    const t = screenText('es', 'cards')
    for (const es of ['Racha', 'Número mágico', 'Probabilidad de playoffs', 'Calendario restante', 'más difícil de 4']) {
      expect(t, es).toContain(es)
    }
    const leftover = t.replace(/Club \d|Liga Prueba|Sleeper|AllFantasy|AF Power|Season Outlook/g, '').match(ENGLISH)
    expect(
      leftover?.[0] ?? null,
      `English left in cards: "${leftover?.input?.slice(Math.max(0, (leftover.index ?? 0) - 70), (leftover.index ?? 0) + 70).replace(/\n/g, ' ⏎ ')}"`,
    ).toBeNull()
  })

  it('CONTROL — the card layout in English, read from the card labels themselves', () => {
    // The labels, not the page: "Playoff odds" also appears elsewhere on the screen, so a page-wide
    // contains() would pass with Spanish leaked into these labels.
    h.language = 'en'
    const { container } = render(<Standings data={data()} odds={ODDS} view={{ ...DEFAULT_STANDINGS_VIEW, layout: 'cards' }} />)
    const labels = new Set([...container.querySelectorAll('dt')].map((d) => d.textContent?.trim()))
    for (const en of ['Streak', 'Magic number', 'Playoff odds', 'Schedule left']) expect(labels.has(en), en).toBe(true)
    expect([...labels].filter((l) => /Racha|Número mágico|Probabilidad de playoffs|Calendario restante/.test(l ?? ''))).toEqual([])
    expect(container.textContent).toContain('hardest of 4')
  })
})
