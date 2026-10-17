import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * Owner's report, 2026-10-03: in a guillotine league Scout's cards said "Bye spot", "Playoff spot",
 * "Outside the playoffs". An elimination league has no playoffs. Its cards now say Eliminated (already
 * chopped), On the bubble (bottom of the live field this week, the cut banner's own ordering) or Safe —
 * and nothing while the week cannot be ranked.
 */

const lang = vi.hoisted(() => ({ value: 'en' as 'es' | 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.value }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>{children as never}</a>
  ),
}))

import { Scout } from '@/components/core-app/screens/Scout'

afterEach(() => {
  lang.value = 'en'
})

const standing = (zone: string) => ({ seed: 1, record: { wins: 0, losses: 0, ties: 0 }, pointsFor: 300, pointsAgainst: 0, form: [], zone, gamesBack: 1, powerRank: 1 })
const mgr = (id: string, zone: string, over: Record<string, unknown> = {}) => ({
  managerId: id,
  teamName: `Team ${id}`,
  ownerName: null,
  avatarUrl: null,
  isYou: false,
  isNextOpponent: false,
  eliminated: null,
  picks: null,
  standing: standing(zone),
  ...over,
})

const data = (elimination: boolean) => ({
  league: { id: 'lg', name: 'The Axe', sport: 'NFL' },
  you: null,
  week: { seasonYear: 2026, week: 4 },
  opponent: null,
  // The season table's playoff zones — exactly what a guillotine card must NOT print.
  managers: {
    available: true,
    data: [mgr('1', 'bye', { isYou: true }), mgr('2', 'playoff'), mgr('3', 'out'), mgr('4', 'out', { eliminated: { week: 2 } })],
  },
  basis: { available: false, reason: 'x' },
  format: { kind: elimination ? 'guillotine' : 'redraft', elimination, bestBall: false, dynasty: false, picks: null },
})

const STANDING = { rank: 1, outOf: 3, overCut: 20, basis: 'points', placesAboveCut: 2, cutLine: 50, elimination: true, bubble: ['3'] }

/** The zone chip on each card, in card order. */
const chips = (html: string) => [...html.matchAll(/class="af-sc-zone"[^>]*>([^<]+)</g)].map((m) => m[1])

describe('Scout cards in an elimination league', () => {
  it('say Safe / On the bubble / Eliminated — never a playoff zone', () => {
    const html = renderToStaticMarkup(
      <Scout data={data(true) as never} gamePlanHref="/p" matchupHref="/m" standingsHref="/s" tradesHref="/t" eliminationStanding={STANDING as never} />,
    )
    expect(chips(html)).toEqual(['Safe', 'Safe', 'On the bubble', 'Eliminated'])
    expect(html).not.toMatch(/Bye spot|Playoff spot|Outside the playoffs|back of a playoff spot/)
  })

  it('say nothing about safe or bubble while the week cannot be ranked — a chopped team is still Eliminated', () => {
    const html = renderToStaticMarkup(
      <Scout data={data(true) as never} gamePlanHref="/p" matchupHref="/m" standingsHref="/s" tradesHref="/t" eliminationStanding={null} />,
    )
    expect(chips(html)).toEqual(['Eliminated'])
    expect(html).not.toMatch(/Bye spot|Playoff spot|Outside the playoffs/)
  })

  it('in Spanish too', () => {
    lang.value = 'es'
    const html = renderToStaticMarkup(
      <Scout data={data(true) as never} gamePlanHref="/p" matchupHref="/m" standingsHref="/s" tradesHref="/t" eliminationStanding={STANDING as never} />,
    )
    expect(chips(html)).toEqual(['A salvo', 'A salvo', 'En el límite', 'Eliminado'])
  })

  it('CONTROL: a league with playoffs keeps its playoff zones', () => {
    const html = renderToStaticMarkup(<Scout data={data(false) as never} gamePlanHref="/p" matchupHref="/m" standingsHref="/s" tradesHref="/t" />)
    expect(chips(html)).toEqual(['Bye spot', 'Playoff spot', 'Outside the playoffs', 'Outside the playoffs'])
  })
})
