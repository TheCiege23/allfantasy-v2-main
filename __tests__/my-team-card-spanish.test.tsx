/**
 * My Team's matchup card in Spanish (2026-10-03). Its three server-written lines — the forecast's
 * refusal, "No projected totals — <why>" and the no-matchup footnote — printed raw English under a
 * Spanish screen. They go through `myTeamCardReasonText` now: the card's own two reasons there, the
 * rest through the Matchup screen's `matchupReasonText`, so one sentence has one Spanish.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import { myTeamCardReasonText } from '@/lib/core-app/myTeamReasonText'
import { BEST_BALL_REASON } from '@/lib/core-app/matchupForecast'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
/**
 * Words that only appear in an English sentence here — "no" and "a" are Spanish too, and "feed" is
 * a loanword the Matchup translations keep («el feed de proyecciones»).
 */
const ENGLISH = /\b(the|your|this|for|yet|matchup|recorded|schedule|league|starters?|could|priced|scoring|projection|rules)\b/i

/** Every quoted or template literal in the `nextMatchup:` entries of myTeam.ts, digits filled in. */
function cardReasonLiterals(): string[] {
  const src = read('lib/core-app/myTeam.ts')
  const out: string[] = []
  /* From each `nextMatchup:` entry to the next sibling key at the same indent — the entry can be a
     ternary (`matchup ? {…} : {…}`), which a brace-matching regex stops inside. */
  for (const m of src.matchAll(/\n(\s+)nextMatchup:/g)) {
    const start = m.index! + m[0].length
    const rest = src.slice(start)
    const end = rest.search(new RegExp(`\\n${m[1]}[A-Za-z]+:`))
    const entry = end === -1 ? rest : rest.slice(0, end)
    for (const lit of entry.matchAll(/(['`])((?:(?!\1)[^\n])+)\1/g)) {
      const s = lit[2]!.replace(/\$\{[^}]*\}/g, '4')
      if (/\s/.test(s)) out.push(s) // prose only — not `available`-style identifiers
    }
  }
  return [...new Set(out)]
}

describe('the card’s reasons have Spanish', () => {
  it('🛑 every nextMatchup reason myTeam.ts can write — read from the source, so a new one fails here', () => {
    const reasons = cardReasonLiterals()
    // The scan must see both real reasons, or it asserts nothing.
    expect(reasons).toEqual(expect.arrayContaining(['no schedule on file for this league yet', 'no week 4 matchup recorded for your team yet']))
    for (const r of reasons) {
      const es = myTeamCardReasonText(r, 'es')
      expect(es, r).not.toBe(r)
      expect(es, r).not.toMatch(ENGLISH)
    }
  })

  it('both reasons `unpricedReason` can carry, read from their own constants', () => {
    const constant = (path: string, name: string) => {
      const m = read(path).match(new RegExp(`${name}\\s*=\\s*\\n?\\s*(['"])((?:(?!\\1).)+)\\1`))
      expect(m, name).not.toBeNull()
      return m![2]!
    }
    for (const r of [
      constant('lib/core-app/playerProjections.ts', 'NOTHING_LEAGUE_SCORED_REASON'),
      constant('lib/projections/leagueScoring.ts', 'NO_LEAGUE_SCORING_REASON'),
    ]) {
      const es = myTeamCardReasonText(r, 'es')
      expect(es, r).not.toBe(r)
      expect(es, r).not.toMatch(ENGLISH)
    }
  })

  it('passes English through untouched, and never blanks an unknown reason', () => {
    expect(myTeamCardReasonText('no week 4 matchup recorded for your team yet', 'en')).toBe('no week 4 matchup recorded for your team yet')
    expect(myTeamCardReasonText('something new', 'es')).toBe('something new')
    expect(myTeamCardReasonText(null, 'es')).toBe('')
  })
})

const player = (over: Partial<LineupPlayer> = {}): LineupPlayer => ({
  sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
  gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
  preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8,
  afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null, market: null, onBye: false, ...over,
})
const side = (over: Record<string, unknown> = {}) => ({ rosterId: 4, teamName: 'Mine', managerName: 'me', avatarUrl: null, projected: null, afProjected: null, projectedFrom: 0, starterCount: 9, ...over })
const page = (nextMatchup: unknown) =>
  ({
    league: { id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty', sourceLink: { href: 'https://sleeper.com/leagues/1/team', label: 'Sleeper' } },
    team: { available: false, reason: 'n/a' },
    starters: { available: true, data: [{ slotLabel: 'QB', player: player(), empty: false, unresolvedId: null }] },
    bench: { available: true, data: [] }, ir: { available: false, reason: 'none' }, taxi: { available: false, reason: 'none' },
    lock: { available: false, reason: 'n/a' },
    projections: { available: true, data: { total: 19.8, projected: 1, unprojected: 0, season: '2026', week: 4, afTotal: 22.4, afEngineTotal: 21.1, afProjected: 1, standardComparable: true } },
    projectionBasis: { notes: [], scoringKnown: true },
    nextMatchup, upcomingByes: [], rosterGrade: { available: false, reason: 'n/a' }, liveScore: { available: false, reason: 'n/a' },
  }) as unknown as MyTeamData

const NOTHING = read('lib/core-app/playerProjections.ts').match(/NOTHING_LEAGUE_SCORED_REASON\s*=\s*\n?\s*"([^"]+)"/)![1]!
const unpriced = page({
  available: true,
  data: {
    seasonYear: 2026, week: 4, you: side(), opponent: side({ rosterId: 7, teamName: 'Them' }), bye: false,
    unpricedReason: NOTHING,
    forecast: { available: false, refusal: 'best_ball', reason: BEST_BALL_REASON },
  },
})
const noMatchup = page({ available: false, reason: 'no week 4 matchup recorded for your team yet' })

describe('the card, rendered', () => {
  it('says all three lines in Spanish', () => {
    lang.language = 'es'
    const a = render(<MyTeam data={unpriced} />).container
    const win = a.querySelector('.af-mt-mu-win[data-available="false"]')!.textContent!
    expect(win).toContain('Sin probabilidad de victoria')
    expect(win).not.toMatch(ENGLISH)
    const edge = [...a.querySelectorAll('.af-mt-mu-edge')].map((e) => e.textContent!).find((t) => t.includes('Sin totales proyectados'))!
    expect(edge).toBeTruthy()
    expect(edge).not.toMatch(ENGLISH)
    const b = render(<MyTeam data={noMatchup} />).container
    expect(b.textContent).toContain('aún no hay enfrentamiento de la semana 4 registrado para tu equipo')
    expect(b.textContent).not.toContain('matchup recorded')
    lang.language = 'en'
  })

  it('switches live, both ways, with no reload', () => {
    lang.language = 'en'
    const r = render(<MyTeam data={noMatchup} />)
    expect(r.container.textContent).toContain('no week 4 matchup recorded for your team yet')
    lang.language = 'es'
    r.rerender(<MyTeam data={noMatchup} />)
    expect(r.container.textContent).toContain('aún no hay enfrentamiento de la semana 4')
    lang.language = 'en'
    r.rerender(<MyTeam data={noMatchup} />)
    expect(r.container.textContent).toContain('no week 4 matchup recorded for your team yet')
  })
})
