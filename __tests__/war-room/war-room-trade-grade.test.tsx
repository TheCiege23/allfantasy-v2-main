/**
 * The War Room trade analyzer (redraft + dynasty) shows THE grade (2026-09-28) in place of the
 * engines' own accept/reject/neutral verdict.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ createGrader: vi.fn(), gradeDeal: vi.fn() }))
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({ createLeagueTradeGrader: h.createGrader, gradeDeal: h.gradeDeal }))

import {
  WAR_ROOM_EMPTY_SIDE_REASON,
  gradeWarRoomTrade,
  warRoomGradeInputs,
  warRoomTradeSide,
} from '@/lib/decision-os/trade/warRoomTradeGrade'
import { WarRoomTradeGradeLine } from '@/app/league/[leagueId]/tabs/WarRoomTradeGradeLine'

const code = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const PLAYERS = [
  { playerId: '6813', playerName: 'Travis Kelce' },
  { playerId: '8148', playerName: "Ja'Marr Chase" },
]
const PICKS = [{ id: 'fdp:2027:1:A', season: 2027, round: 1 }]

describe('warRoomTradeSide', () => {
  it('resolves ids against the War Room’s own rosters; anything not on a roster is unknown', () => {
    expect(
      warRoomTradeSide({ playerIds: ['6813', '6813', 'ghost', 7], pickIds: ['fdp:2027:1:A', 'nope'], players: PLAYERS, picks: PICKS }),
    ).toEqual({
      players: [{ playerId: '6813', name: 'Travis Kelce' }],
      picks: [{ season: 2027, round: 1, label: '2027 round 1' }],
      unknown: ['ghost', 'nope'],
    })
  })
})

describe('warRoomGradeInputs', () => {
  it('prices named players and placed picks; an unnamed player or unknown id is named as unpriceable', () => {
    expect(
      warRoomGradeInputs({
        players: [{ playerId: '6813', name: 'Travis Kelce' }, { playerId: 'x', name: null }],
        picks: [{ season: 2027, round: 1, label: '2027 round 1' }],
        unknown: ['ghost'],
      }),
    ).toEqual({
      assets: [
        { kind: 'player', playerId: '6813', name: 'Travis Kelce' },
        { kind: 'pick', year: 2027, round: 1, label: '2027 round 1' },
      ],
      unpriceable: ['a player the league has no name for', 'an asset not on any roster (ghost)'],
    })
  })
})

describe('gradeWarRoomTrade', () => {
  const side = (id: string, name: string) => ({ players: [{ playerId: id, name }], picks: [], unknown: [] })

  beforeEach(() => {
    h.createGrader.mockReset().mockResolvedValue({ grader: true })
    h.gradeDeal.mockReset().mockResolvedValue({ graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', giveValue: 6100, getValue: 5200 })
  })

  it('an empty side is not graded, and no grader is loaded', async () => {
    expect(
      await gradeWarRoomTrade({ leagueId: 'L1', userId: 'u1', viewerSide: true, outgoing: side('6813', 'Travis Kelce'), incoming: { players: [], picks: [], unknown: [] } }),
    ).toEqual({ graded: false, reason: WAR_ROOM_EMPTY_SIDE_REASON })
    expect(h.createGrader).not.toHaveBeenCalled()
  })

  it('grades on the league’s grader from the analysed side, passing viewerSide through', async () => {
    const g = await gradeWarRoomTrade({
      leagueId: 'L1',
      userId: 'u1',
      viewerSide: false,
      outgoing: side('6813', 'Travis Kelce'),
      incoming: side('8148', "Ja'Marr Chase"),
    })
    expect(g).toEqual({ graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', giveValue: 6100, getValue: 5200 })
    expect(h.createGrader).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1' })
    expect(h.gradeDeal.mock.calls[0]![1]).toMatchObject({
      give: { assets: [{ kind: 'player', playerId: '6813', name: 'Travis Kelce' }] },
      get: { assets: [{ kind: 'player', playerId: '8148', name: "Ja'Marr Chase" }] },
      viewerSide: false,
    })
  })

  it('a withheld grade keeps its reason; a failure is a withheld grade, never a throw', async () => {
    h.gradeDeal.mockResolvedValueOnce({ graded: false, reason: 'No values.', basis: null })
    const args = { leagueId: 'L1', userId: 'u1', viewerSide: true, outgoing: side('6813', 'K'), incoming: side('8148', 'C') }
    expect(await gradeWarRoomTrade(args)).toEqual({ graded: false, reason: 'No values.' })
    h.gradeDeal.mockRejectedValueOnce(new Error('boom'))
    expect(await gradeWarRoomTrade(args)).toEqual({ graded: false, reason: 'This trade could not be graded just now.' })
  })
})

describe('WarRoomTradeGradeLine', () => {
  it('draws both letters, the label and the league values; a withheld grade says why', () => {
    const { rerender } = render(
      <WarRoomTradeGradeLine testId="g" grade={{ graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', giveValue: 6100, getValue: 5200 }} />,
    )
    expect(screen.getByTestId('g').textContent).toBe('League grade: You D · Them B — Slightly favors opponentYou get 5,200 for 6,100 in league value')
    rerender(<WarRoomTradeGradeLine testId="g" grade={{ graded: false, reason: 'No values.' }} />)
    expect(screen.getByTestId('g-withheld').textContent).toBe('Not graded: No values.')
  })
})

describe('wiring', () => {
  for (const [kind, route, panel] of [
    ['redraft', 'app/api/leagues/[leagueId]/redraft-war-room/[action]/route.ts', 'app/league/[leagueId]/tabs/redraft/RedraftWarRoomPanel.tsx'],
    ['dynasty', 'app/api/leagues/[leagueId]/dynasty-war-room/[action]/route.ts', 'app/league/[leagueId]/tabs/dynasty/DynastyWarRoomPanel.tsx'],
  ] as const) {
    it(`${kind}: the route grades trade-analyze from the analysed roster’s side and returns it`, () => {
      const src = code(route)
      expect(src).toMatch(/gradeWarRoomTrade\(\{[\s\S]{0,80}viewerSide: rosterId === context\.userRosterId/)
      expect(src).toMatch(/NextResponse\.json\(\{ tradeAnalysis: analysis, tradeGrade \}\)/)
    })

    it(`${kind}: 🛑 the panel shows the private verdict only when no grade came back`, () => {
      const src = code(panel)
      expect(src).toMatch(/\{tradeGrade \? \(\s*<WarRoomTradeGradeLine grade=\{tradeGrade\}/)
      expect(src).toMatch(/setTradeGrade\(analyzed\.tradeGrade \?\? null\)/)
    })
  }

  it('the dynasty route resolves picks too', () => {
    expect(code('app/api/leagues/[leagueId]/dynasty-war-room/[action]/route.ts')).toMatch(/pickIds: body\.outgoingPickIds, players, picks/)
  })
})
