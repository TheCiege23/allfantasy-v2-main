// @vitest-environment jsdom
/**
 * Season Outlook, one league, in the reader's language (2026-10-05). A live Spanish sweep found the
 * whole screen English — its own copy, the shared outlook parts, the what-if panel, the freshness chip,
 * and every sentence the loader writes. This renders each tab in Spanish, asserts the words, and runs
 * an English word-list sweep over the text AND every aria-label/title; then the same screen in English
 * as a control. The loader sentences in the fixture are the generators' real templates, so a changed
 * template falls back to English here and fails the sweep rather than shipping half-translated.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children as never}
    </a>
  ),
}))

import SeasonOutlookLeague from '@/components/core-app/screens/SeasonOutlookLeague'
import { FreshnessChip } from '@/components/sports-os/FreshnessChip'
import { outlookText } from '@/lib/core-app/outlookSpanish'
import type { OutlookLeague, OutlookTeam, SwingMatchup } from '@/lib/core-app/seasonOutlook'
import type { OutlookFocus } from '@/lib/core-app/seasonOutlookFocus'

afterEach(() => {
  cleanup()
  h.language = 'en'
})

function team(id: string, over: Partial<OutlookTeam> = {}): OutlookTeam {
  return {
    rosterId: id,
    name: `Club ${id}`,
    isYou: false,
    wins: 2,
    losses: 1,
    pointsFor: 330,
    seed: Number(id),
    playoffPct: 50,
    byePct: 12,
    titlePct: 10,
    missPct: 50,
    range: { playoff: { lo: 40, hi: 61 }, bye: { lo: 8, hi: 16 }, title: { lo: 7, hi: 13 } },
    status: null,
    modelled: true,
    weeksFitted: 30,
    weeklyMean: 110,
    expectedWins: 1.8,
    schedule: { pastOpponentMu: 112, remainingOpponentMu: 108, pastRank: 2, remainingRank: 4, leagueMu: 110, pastGames: 3, remainingGames: 5 },
    ...over,
  }
}

const you = team('3', { isYou: true, playoffPct: 63.4, titlePct: 14.2, byePct: 21, missPct: 36.6 })

// Real generator templates (seasonOutlookFocus / seasonOutlook), with names that are not English words.
const focus: OutlookFocus = {
  scenario: {
    leagueId: 'L1',
    basisWeek: { season: '2026', week: 4 },
    refusal: null,
    slots: ['QB', 'RB'],
    teams: [
      { rosterId: '3', name: 'Club 3', isYou: true, players: [] },
      { rosterId: '1', name: 'Club 1', isYou: false, players: [] },
    ],
    freeAgents: [],
    sim: {
      teams: ['1', '2', '3', '4'].map((id) => ({ rosterId: id, wins: 2, losses: 1, pointsFor: 330, profile: { mu: 110, sigma: 20, n: 30 } })),
      remaining: [
        { week: 4, a: '3', b: '1' },
        { week: 4, a: '2', b: '4' },
      ],
      playoffTeams: 2,
      byeTeams: 0,
    },
    seed: 3,
    weeks: [4],
    youRosterId: '3',
  },
  drivers: [
    { key: 'schedule', label: 'Remaining schedule', detail: '4th hardest of 4: opponents average 108.2 against a league average of 110.4.', impact: -6.2, spread: false },
    { key: 'swing', label: 'Week 4 vs Club 1', detail: 'Win and you are at 80%; lose and you are at 44%.', impact: 12, spread: true },
    { key: 'strength', label: 'Your scoring', detail: '11.3 points a week above the league average, over 85 weeks on file.', impact: 3.1, spread: false },
    { key: 'luck', label: 'Record against points', detail: '1.2 win more than your weekly scores would have earned against the whole league (0.8 expected).', impact: 2.2, spread: false },
    { key: 'injuries', label: 'Injuries', detail: 'Zed Okoro is ruled out — 9.4 lineup points in week 4, if only for that week.', impact: -2.1, spread: false },
    { key: 'byes', label: 'Bye weeks', detail: "Measured against every team's byes. Your worst is week 7: Zed Okoro, Ike Bamba off, 18.2 lineup points.", impact: -1.4, spread: false },
  ],
  moves: [
    {
      key: 'lineup-4',
      kind: 'lineup',
      title: 'Set your best lineup for week 4',
      detail: 'Start Ike Bamba over Zed Okoro (out).',
      week: 4,
      pointsPerWeek: 3.5,
      playoffDelta: 2.4,
      titleDelta: 0.6,
      href: '/core/my-team?league=L1',
    },
    {
      key: 'waiver-9',
      kind: 'waiver',
      title: 'Add Moe Diallo, drop Ike Bamba',
      detail: 'WR, KC — 12.1 projected in week 4. Worth about 2.3 lineup points a week to you.',
      week: null,
      pointsPerWeek: 2.3,
      playoffDelta: 1.1,
      titleDelta: 0.2,
      href: '/core/waivers?league=L1',
    },
  ],
  durability: {
    basisWeek: { season: '2026', week: 4 },
    starters: 9,
    age: { averageAge: 26.4, knownAges: 8, older: [{ name: 'Zed Okoro', position: 'RB', age: 30 }] },
    depth: [{ position: 'TE', healthy: 0, starters: 1 }],
    injuries: [{ name: 'Zed Okoro', status: 'Out', kind: 'out', starting: true }],
    injuryFeedNote: 'The injury feed is behind, so injury marks may be missing.',
    byes: [{ week: 7, players: ['Zed Okoro', 'Ike Bamba'], pointsLost: 18.2 }],
    concentration: {
      topPosition: { position: 'WR', share: 0.34 },
      topPlayer: { name: 'Ike Bamba', share: 0.22 },
      stack: { team: 'KC', players: ['Ike Bamba', 'Moe Diallo', 'Zed Okoro'] },
    },
    flags: [
      '1 starter is ruled out and still in your lineup.',
      'No healthy backup at TE.',
      'Week 7: two or more starters on bye.',
      'Ike Bamba is 22% of your projected lineup.',
      '3 starters play for KC.',
    ],
  } as never,
  branchIterations: 2000,
  notes: ['2 factors moved your odds by less than 1 point and are not listed.'],
}

const swing: SwingMatchup = {
  leagueId: 'L1',
  leagueName: 'Liga Prueba',
  week: 4,
  opponentName: 'Club 1',
  ifWin: 80,
  ifLose: 44,
  swing: 36,
  clinchOnWin: false,
  helpIfLose: ['Club 2'],
}

function league(over: Partial<OutlookLeague> = {}): OutlookLeague {
  return {
    leagueId: 'L1',
    leagueName: 'Liga Prueba',
    platform: 'sleeper',
    season: 2026,
    weeksRemaining: 5,
    playoffTeams: 4,
    byeTeams: 2,
    you,
    teams: [team('1'), team('2', { playoffPct: 91 }), you, team('4', { modelled: false })],
    whatDecidesIt: 'Get to 6 wins — 4 of your last 5 — and you are in nine times in ten.',
    href: '/core?league=L1',
    milestones: {
      totalGames: 8,
      winsForLikely: 5,
      winsForSafe: 6,
      cutWinsMedian: 5,
      cutWinsLow: 4,
      cutWinsHigh: 6,
      cutPointsMedian: 880,
      cutPointsLow: 820,
      cutPointsHigh: 940,
      projectedWins: 5,
      projectedPoints: 890,
      oddsByWins: [null, null, 0, 5, 30, 62, 93, 100, null],
      currentWins: 2,
      maxWins: 7,
    },
    assumptions: {
      iterations: 10000,
      rangeBatches: 10,
      rangeRunsPerBatch: 500,
      seasonsFitted: [2024, 2025, 2026],
      weeksFitted: { min: 28, median: 30, max: 31 },
      teams: 4,
      modelledTeams: 3,
      remainingGames: 10,
      regularSeasonEndWeek: 8,
      playoffTeams: { value: 4, source: 'league' },
      byes: { value: 2, source: 'standard' },
      tiebreak: 'Wins, then points for.',
      computedAt: '2026-09-17T12:00:00Z',
      reused: true,
      missing: [
        '1 team has fewer than 3 completed weeks, so its games are left unplayed in every run.',
        'Divisions and head-to-head tiebreaks are not modelled: seeding is wins plus half a win per final tie, then points for.',
        'Weekly scores are independent draws: bye weeks, injuries and trades only enter through the scenario tools.',
      ],
    },
    focus,
    ...over,
  }
}

const PRIORITIES = [
  { leagueName: 'Otra Liga', reason: 'On the bubble at 52% with 11 to play — this is where a lineup call is worth the most.', href: '/core/season-outlook?league=L2' },
]
const BASIS =
  "10,000 simulations per league, played over each league's own remaining schedule, playoff field and byes."

/** Every tab's text plus every aria-label and title, read tab by tab. */
function wholeScreen(language: 'en' | 'es'): string {
  h.language = language
  const { container } = render(
    <SeasonOutlookLeague league={league()} swing={swing} basis={BASIS} priorities={PRIORITIES} />,
  )
  const chunks: string[] = []
  const read = () => {
    chunks.push(container.textContent ?? '')
    for (const e of container.querySelectorAll('[aria-label],[title],[data-v],option,optgroup')) {
      chunks.push(e.getAttribute('aria-label') ?? '', e.getAttribute('title') ?? '', e.getAttribute('data-v') ?? '', e.getAttribute('label') ?? '')
    }
  }
  read()
  for (const tab of [...container.querySelectorAll('[role="tab"]')]) {
    fireEvent.click(tab)
    read()
  }
  return chunks.join('\n')
}

// Shell words that only English uses. Names in the fixture are chosen to be none of these.
const ENGLISH =
  /\b(the|your|you|with|this|that|from|for|of|is|are|and|wins?|points|week|lineup|waivers|playoff odds|seed|schedule|roster|title|bye|range|record|starters?|projected|season|team|trade|clinch|matchup|simulations?|assumed|stated|modelled|healthy|backup|injury|injuries|drivers?|moves?)\b/i

describe('Season Outlook (one league) in Spanish', () => {
  it('the forecast, the next action, the drivers and every tab read Spanish', () => {
    const t = wholeScreen('es')
    for (const es of [
      'Proyección de temporada',
      'Tu pronóstico · 3.º puesto',
      'igualado con el corte · 5 por jugar',
      'Descanso en primera ronda',
      'ganar el cuadro',
      'Llega a 6 victorias',
      'Siguiente acción',
      'Pon tu mejor alineación para la semana 4',
      'Alinea a Ike Bamba en lugar de Zed Okoro (fuera).',
      'Lo que más mueve tu temporada',
      '4.º calendario más difícil de 4',
      'Si ganas, quedas en 80%; si pierdes, en 44%.',
      'Cómo clasificas',
      'Necesitarías que Club 2 también se quedara fuera.',
      'te clasifica 9 de cada 10 veces',
      'victorias para el 4.º puesto, normalmente',
      'Añade a Moe Diallo y suelta a Ike Bamba',
      'Te vale unos 2.3 puntos de alineación por semana.',
      'Sin suplente sano en TE.',
      'Semana 7: dos o más titulares en descanso.',
      'Ike Bamba es el 22% de tu alineación proyectada.',
      'El parte de lesiones va con retraso',
      'Simulaciones',
      'Victorias y luego puntos a favor.',
      '1 equipo tiene menos de 3 semanas completas',
      'Dónde poner tu atención',
      'En la burbuja con 52%',
      'Qué lo decide',
      'Muy pocas semanas completas para modelar',
      'Arma un escenario',
    ]) {
      expect(t, es).toContain(es)
    }
    const names = /Ike Bamba|Zed Okoro|Moe Diallo|Club \d|Liga Prueba|Otra Liga/g
    const leftover = t.replace(names, '').match(ENGLISH)
    expect(leftover?.[0] ?? null, `English left on the Spanish screen: "${leftover?.input?.slice(Math.max(0, (leftover.index ?? 0) - 60), (leftover.index ?? 0) + 60)}"`).toBeNull()
  })

  it('CONTROL — the same screen in English is unchanged', () => {
    const t = wholeScreen('en')
    for (const en of [
      'Season Outlook',
      'Your forecast · 3rd seed',
      'level with the cut · 5 to play',
      'First-round bye',
      'Next action',
      'Set your best lineup for week 4',
      'Start Ike Bamba over Zed Okoro (out).',
      'What moves your season most',
      'How you clinch',
      'gets you in 9 times in 10',
      'wins for the 4th seed, usually',
      'No healthy backup at TE.',
      'Wins, then points for.',
      'Where to spend your attention',
      'What decides it',
    ]) {
      expect(t, en).toContain(en)
    }
    expect(t).not.toMatch(/Proyección de temporada|Siguiente acción|Cómo clasificas/)
  })

  it('the cannot-identify-you state', () => {
    h.language = 'es'
    const { container } = render(<SeasonOutlookLeague league={league({ you: null })} swing={null} basis="x" />)
    expect(container.textContent).toContain('No sabemos cuál es tu equipo en esta liga.')
  })
})

describe('the freshness chip', () => {
  const meta = { source: 'cache', fetchedAt: Date.now() - 4 * 60_000 } as never
  it('reads Spanish, and English as a control', () => {
    h.language = 'es'
    let c = render(<FreshnessChip meta={meta} initialLabel="4m ago" initialWarn={false} />).container
    expect(c.textContent).toMatch(/^Actualizado hace 4 min/)
    cleanup()
    h.language = 'en'
    c = render(<FreshnessChip meta={meta} initialLabel="4m ago" initialWarn={false} />).container
    expect(c.textContent).toMatch(/^Updated 4m ago/)
  })
})

describe('outlookText — anchored whole, names untouched', () => {
  it('translates each loader template and leaves an unknown sentence English, not half-done', () => {
    expect(outlookText('Week 5 vs Aceman100', 'es')).toBe('Semana 5 vs Aceman100')
    expect(outlookText('The projection feed is on week 6, which is not one of this league\'s remaining weeks, so no lineup move is suggested.', 'es')).toMatch(/^La fuente de proyecciones está en la semana 6/)
    expect(outlookText('Trade with Club 1: send Zed Okoro, get nothing.', 'es')).toBe('Intercambio con Club 1: envías Zed Okoro, recibes nada.')
    expect(outlookText('Week 4: start Ike Bamba over Zed Okoro (+3.2 pts).', 'es')).toBe('Semana 4: alinea a Ike Bamba en lugar de Zed Okoro (+3.2 pts).')
    expect(outlookText('Zed Okoro out for 2 weeks.', 'es')).toBe('Zed Okoro fuera 2 semanas.')
    expect(outlookText('Win 2 of the last 6', 'es')).toBe('Gana 2 de los últimos 6')
    expect(outlookText('A sentence nobody wrote a pattern for.', 'es')).toBe('A sentence nobody wrote a pattern for.')
    expect(outlookText('Your scoring', 'en')).toBe('Your scoring')
  })
})
