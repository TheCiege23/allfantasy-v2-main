/**
 * War Room · "the room at a glance": every live team's rank in the league, column by column, and your
 * strongest and weakest column beside it. Every number comes from the standings Scout already holds.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => {
    const { prefetch: _p, ...attrs } = rest as Record<string, unknown>
    return <a href={href} {...(attrs as Record<string, string>)}>{children as never}</a>
  },
}))

const lang = vi.hoisted(() => ({ value: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.value }),
}))

import { Scout } from '@/components/core-app/screens/Scout'
import { buildRoomGrid, roomGridTier } from '@/lib/core-app/scoutRoomGrid'
import type { ScoutData, ScoutedManager, ScoutStanding } from '@/lib/core-app/scout'

const standing = (seed: number, pointsFor: number, form: ScoutStanding['form'], powerRank: number): ScoutStanding => ({
  seed,
  record: { wins: 3, losses: 2, ties: 0 },
  pointsFor,
  pointsAgainst: 500,
  form,
  zone: 'playoff',
  gamesBack: 0,
  powerRank,
})

const manager = (id: string, s: ScoutStanding | null, over: Partial<ScoutedManager> = {}): ScoutedManager => ({
  managerId: id,
  teamName: `Team ${id}`,
  ownerName: null,
  avatarUrl: null,
  isYou: false,
  isNextOpponent: false,
  standing: s,
  eliminated: null,
  picks: null,
  ...over,
})

const ROOM: ScoutedManager[] = [
  manager('a', standing(1, 600, ['W', 'W', 'W', 'W', 'L'], 2)),
  manager('b', standing(2, 640, ['W', 'L', 'W', 'L', 'W'], 1)),
  // You: 3rd seed, tied 3rd on points, the best form, 5th on power.
  manager('me', standing(3, 590, ['W', 'W', 'W', 'W', 'W'], 5), { isYou: true, teamName: 'My Squad' }),
  manager('d', standing(4, 590, ['L', 'L', 'W', 'L', 'L'], 3)),
  manager('e', standing(5, 500, ['L', 'L', 'L', 'L', 'L'], 4)),
]

function scoutData(managers: ScoutedManager[]): ScoutData {
  return {
    league: { id: 'lg1', name: 'The Gauntlet', sport: 'NFL' },
    you: { managerId: 'me', teamName: 'My Squad', standing: managers.find((m) => m.isYou)?.standing ?? null },
    week: { seasonYear: 2026, week: 6 },
    opponent: null,
    managers: { available: true, data: managers },
    basis: { available: true, data: { season: 2026, throughWeek: 5, seasonComplete: false, orderBasis: 'Order is winning percentage.' } },
    format: { kind: 'redraft', elimination: false, bestBall: false, dynasty: false, picks: null },
  }
}

const render = (data: ScoutData) =>
  renderToStaticMarkup(
    <Scout data={data} gamePlanHref="/core/war-room?view=plan" matchupHref="/core/matchup" standingsHref="/core/standings" tradesHref="/core/trades" />,
  )

describe('buildRoomGrid', () => {
  it('ranks every column from the standings, with ties sharing the better rank', () => {
    const grid = buildRoomGrid(ROOM)!
    expect(grid.columns).toEqual(['seed', 'power', 'pointsFor', 'form'])
    expect(grid.outOf).toBe(5)
    const me = grid.rows.find((r) => r.isYou)!
    expect(me.cells.map((c) => [c.column, c.rank])).toEqual([
      ['seed', 3],
      ['power', 5],
      ['pointsFor', 3],
      ['form', 1],
    ])
    // d is level with you on points for: both 3rd, and nobody is 4th.
    expect(grid.rows.find((r) => r.managerId === 'd')!.cells.find((c) => c.column === 'pointsFor')!.rank).toBe(3)
    expect(grid.rows.find((r) => r.managerId === 'e')!.cells.find((c) => c.column === 'pointsFor')!.rank).toBe(5)
  })

  it("reads your strongest and weakest column off your own row", () => {
    const grid = buildRoomGrid(ROOM)!
    expect(grid.you?.strongest).toMatchObject({ column: 'form', rank: 1 })
    expect(grid.you?.weakest).toMatchObject({ column: 'power', rank: 5 })
  })

  it('leaves out chopped teams and teams the table does not place', () => {
    const grid = buildRoomGrid([
      ...ROOM,
      manager('chopped', standing(6, 900, ['W'], 6), { eliminated: { week: 3 } }),
      manager('unplaced', null),
    ])!
    expect(grid.outOf).toBe(5)
    expect(grid.rows.map((r) => r.managerId)).not.toContain('chopped')
    expect(grid.rows.map((r) => r.managerId)).not.toContain('unplaced')
  })

  it('drops the form column before anyone has played, and the grid below three teams', () => {
    const noForm = ROOM.map((m) => ({ ...m, standing: { ...m.standing!, form: [] } }))
    expect(buildRoomGrid(noForm)!.columns).toEqual(['seed', 'power', 'pointsFor'])
    expect(buildRoomGrid(ROOM.slice(0, 2))).toBeNull()
  })

  it('shades a rank into five steps, strongest first', () => {
    expect([1, 3, 6, 9, 12].map((r) => roomGridTier(r, 12))).toEqual([1, 2, 3, 4, 5])
  })
})

describe('Scout · the room at a glance', () => {
  it('draws the grid and your two tiles', () => {
    lang.value = 'en'
    const html = render(scoutData(ROOM))
    expect(html).toContain('The room at a glance')
    expect(html).toMatch(/data-you="true"[^]*?My Squad[^]*?>YOU</)
    expect(html).toContain('Your strongest')
    expect(html).toMatch(/af-sc-room-tile-rank af-num">1st</)
    expect(html).toMatch(/af-sc-room-tile-rank af-num">5th</)
    expect(html).toContain('My Squad: 5th of 5 in power rank')
  })

  it('says it in Spanish', () => {
    lang.value = 'es'
    const html = render(scoutData(ROOM))
    lang.value = 'en'
    expect(html).toContain('La liga de un vistazo')
    expect(html).toContain('Tu punto más fuerte')
    expect(html).toMatch(/af-sc-room-tile-rank af-num">1\.º</)
    expect(html).toContain('Sala de estrategia')
  })

  it('draws nothing when fewer than three teams are on the table', () => {
    const html = render(scoutData(ROOM.slice(0, 2)))
    expect(html).not.toContain('af-sc-room')
  })
})
