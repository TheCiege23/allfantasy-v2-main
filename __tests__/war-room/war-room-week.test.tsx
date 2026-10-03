/**
 * "This week across your leagues" on the universal War Room (step 4a).
 *
 * The strip is a VIEW of the rail's own read, with the rail's rules: a dash and "Not started" — never
 * 0.0 — on an unplayed fixture, "last import" on a history fallback, rank and cut in an elimination
 * week. It ranks nothing by win probability; it links to the board that does.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>{children as never}</a>
  ),
}))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))

import { WarRoomWeek } from '@/components/core-app/screens/WarRoomWeek'
import type { RailMatchup } from '@/lib/core-app/railMatchups'
import type { WeekLineups } from '@/lib/core-app/weekLineups'

const proj = (afEngine: number | null) => ({ projected: null, afProjected: null, afEngine, afEngineFrom: 9, pricedFrom: 9, starterCount: 9 }) as unknown as RailMatchup['yourProjection']

const m = (leagueId: string, over: Partial<RailMatchup>): RailMatchup => ({
  leagueId,
  yourTeam: 'My Team',
  yourAvatarUrl: null,
  yourScore: 0,
  yourProjection: null,
  opponentTeam: 'Their Team',
  opponentAvatarUrl: null,
  opponentScore: 0,
  opponentProjection: null,
  unpaired: false,
  standing: null,
  scored: false,
  freshAt: null,
  source: 'live_cache',
  season: 2026,
  week: 5,
  ...over,
})

const lineups = (byLeague: Record<string, RailMatchup>): WeekLineups => ({ byLeague, projectionWeek: { season: '2026', week: 5 } })
const leagues = [
  { id: 'A', name: 'Alpha League' },
  { id: 'B', name: 'Bravo League' },
  { id: 'C', name: 'Charlie League' },
  { id: 'D', name: 'Delta League' },
]
const render = (l: WeekLineups | null, ls = leagues) => renderToStaticMarkup(<WarRoomWeek lineups={l} leagues={ls} boardHref="/core/matchup" />)
const order = (html: string) => [...html.matchAll(/class="af-wrw-league">([^<]+)</g)].map((x) => x[1])

describe('WarRoomWeek', () => {
  const data = lineups({
    A: m('A', { scored: true, yourScore: 88.4, opponentScore: 80.1 }), // ahead 8.3
    B: m('B', { scored: true, yourScore: 70.0, opponentScore: 95.5 }), // behind 25.5
    C: m('C', { yourProjection: proj(110), opponentProjection: proj(114) }), // projected -4
    D: m('D', { unpaired: true, opponentTeam: null, standing: { rank: 11, outOf: 12, overCut: 3.2, basis: 'points', placesAboveCut: 1, cutLine: 60, elimination: true } }),
  })

  it('puts the matchup you are losing worst first, then the rest by margin, elimination last', () => {
    expect(order(render(data))).toEqual(['Bravo League', 'Charlie League', 'Alpha League', 'Delta League'])
  })

  it('states a played score and the margin in words', () => {
    const html = render(data)
    expect(html).toContain('70.0–95.5</span> behind by 25.5')
    expect(html).toContain('88.4–80.1</span> ahead by 8.3')
    expect(html).toContain('ahead in 1, behind in 2')
  })

  it('never prints 0.0 for an unplayed fixture', () => {
    const html = render(lineups({ C: m('C', {}) }), [leagues[2]!])
    expect(html).toContain('Not started')
    expect(html).not.toContain('0.0')
  })

  it('shows rank and the cut in an elimination week, not an opponent', () => {
    const html = render(data)
    expect(html).toContain('Elimination week · #11 of 12 · 3.2 over the cut')
    expect(html).not.toContain('vs an unnamed team')
  })

  it('labels a history fallback as the last import', () => {
    const html = render(lineups({ A: m('A', { scored: true, yourScore: 90, opponentScore: 80, source: 'history_fallback' }) }), [leagues[0]!])
    expect(html).toContain('· last import')
  })

  it('links each row to that league’s matchup, and the strip to the ranked board', () => {
    const html = render(data)
    expect(html).toContain('href="/core/matchup?league=B"')
    expect(html).toContain('href="/core/matchup"')
    expect(html).toContain('ranked by win probability')
  })

  it('renders nothing when the rail read failed, rather than claiming a quiet week', () => {
    expect(render(null)).toBe('')
  })

  it('renders nothing for leagues with no matchup row', () => {
    expect(render(lineups({}))).toBe('')
  })

  it('says "You were chopped" in an elimination league you are out of — not "No head-to-head this week"', () => {
    const html = render(lineups({ D: m('D', { unpaired: true, opponentTeam: null, standing: null, eliminated: true }) }), [leagues[3]!])
    expect(html).toContain('You were chopped')
    expect(html).not.toContain('No head-to-head this week')
  })
})
