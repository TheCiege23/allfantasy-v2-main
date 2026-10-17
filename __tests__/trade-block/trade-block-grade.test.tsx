/**
 * The trade block shows THE grade (2026-09-28): each card another manager listed carries a suggested
 * offer from the viewer's roster for that player, graded from the viewer's side.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ findPackages: vi.fn() }))
vi.mock('@/lib/trade-discovery/redraftTradeDiscovery', () => ({ findPackages: h.findPackages }))

import { packageGradeInputs, tradeBlockOffers } from '@/lib/trade-block/tradeBlockOffers'
import { BlockOfferLine } from '@/app/league/[leagueId]/tabs/redraft/TradeBlockPanel'

const code = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const player = (id: string, name: string) => ({ kind: 'player' as const, playerId: id, playerName: name, position: 'WR', value: 100 })
const roster = (rosterId: string) => ({ rosterId, teamName: rosterId, stance: 'middle', weakPositions: [], strongPositions: [], players: [] }) as never
const GRADED = { graded: true, letter: 'B', partnerLetter: 'D', label: 'Slightly favors you', giveValue: 900, getValue: 1100 }

describe('packageGradeInputs', () => {
  it('players by id and name, FAAB by amount; an unnamed player is named as unpriceable', () => {
    expect(
      packageGradeInputs([
        player('6813', 'Travis Kelce'),
        { kind: 'faab', faabAmount: 12, value: 200 },
        { kind: 'player', playerId: 'x', value: null },
      ]),
    ).toEqual({
      assets: [
        { kind: 'player', playerId: '6813', name: 'Travis Kelce' },
        { kind: 'faab', amount: 12 },
      ],
      unpriceable: ['a player the league has no name for'],
    })
  })
})

describe('tradeBlockOffers', () => {
  const base = {
    viewerRosterId: 'me',
    rosters: [roster('me'), roster('r1'), roster('r2')],
    sport: 'NFL',
    draftPickTrading: false,
  }

  beforeEach(() => {
    h.findPackages.mockReset().mockImplementation(({ targetPlayerId }: { targetPlayerId: string }) => [
      { giveAssets: [player('g1', 'My WR')], receiveAssets: [player(targetPlayerId, `Target ${targetPlayerId}`)] },
    ])
  })

  it('offers on other managers’ cards only, for exactly the listed player, graded from the viewer side', async () => {
    const grade = vi.fn(async () => GRADED as never)
    const offers = await tradeBlockOffers({
      ...base,
      items: [
        { id: 'mine', rosterId: 'me', playerId: 'p0' },
        { id: 'i1', rosterId: 'r1', playerId: 'p1' },
      ],
      grade,
      limit: 8,
    })
    expect([...offers.keys()]).toEqual(['i1'])
    expect(h.findPackages.mock.calls[0]![0]).toMatchObject({ targetPlayerId: 'p1', max: 1 })
    expect(grade.mock.calls[0]).toEqual([
      { assets: [{ kind: 'player', playerId: 'g1', name: 'My WR' }], unpriceable: [] },
      { assets: [{ kind: 'player', playerId: 'p1', name: 'Target p1' }], unpriceable: [] },
    ])
    expect(offers.get('i1')).toEqual({
      gives: ['My WR'],
      receives: ['Target p1'],
      grade: { graded: true, letter: 'B', partnerLetter: 'D', label: 'Slightly favors you', giveValue: 900, getValue: 1100 },
    })
  })

  it('is bounded; a card with no fitting package gets none; a failed grade keeps the offer ungraded', async () => {
    h.findPackages
      .mockImplementationOnce(() => []) // i1: nothing fits
      .mockImplementationOnce(() => [{ giveAssets: [player('g1', 'My WR')], receiveAssets: [player('other', 'Not the target')] }]) // i2: wrong player
    const grade = vi.fn(async () => {
      throw new Error('boom')
    })
    const offers = await tradeBlockOffers({
      ...base,
      items: [
        { id: 'i1', rosterId: 'r1', playerId: 'p1' },
        { id: 'i2', rosterId: 'r2', playerId: 'p2' },
        { id: 'i3', rosterId: 'r1', playerId: 'p3' },
        { id: 'i4', rosterId: 'r2', playerId: 'p4' },
      ],
      grade,
      limit: 3,
    })
    expect(h.findPackages).toHaveBeenCalledTimes(3)
    expect([...offers.keys()]).toEqual(['i3'])
    expect(offers.get('i3')!.grade).toBeNull()
  })

  it('a viewer with no roster in the discovery league gets no offers', async () => {
    const offers = await tradeBlockOffers({ ...base, viewerRosterId: 'ghost', items: [{ id: 'i1', rosterId: 'r1', playerId: 'p1' }], grade: vi.fn(), limit: 8 })
    expect(offers.size).toBe(0)
  })
})

describe('BlockOfferLine', () => {
  it('draws the offer and both letters, yours first; a withheld grade says why; no offer draws nothing', () => {
    const { container, rerender } = render(
      <BlockOfferLine offer={{ gives: ['My WR'], receives: ['Travis Kelce'], grade: { ...GRADED, graded: true } }} />,
    )
    expect(screen.getByTestId('block-offer').textContent).toBe(
      'Suggested offer: send My WR for Travis KelceGrade: You B · Them D — Slightly favors you',
    )
    rerender(<BlockOfferLine offer={{ gives: ['A'], receives: ['B'], grade: { graded: false, reason: 'No values.' } }} />)
    expect(screen.getByTestId('block-offer-grade-withheld').textContent).toBe('Not graded: No values.')
    rerender(<BlockOfferLine offer={null} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('wiring', () => {
  it('the block route grades offers from the viewer’s side, bounded, and never fails the block', () => {
    const route = code('app/api/redraft/trades/trade-block/route.ts')
    expect(route).toMatch(/gradeDeal\(await \(grader \?\?= createLeagueTradeGrader\(\{ leagueId, userId \}\)[\s\S]{0,60}viewerSide: true \}\)/)
    expect(route).toMatch(/limit: GRADED_BLOCK_OFFERS/)
    expect(route).toMatch(/items\.map\(\(i\) => \(\{ \.\.\.i, suggestedOffer: offers\[i\.id\] \?\? null \}\)\)/)
  })

  it('the panel shows the offer on each league card', () => {
    expect(code('app/league/[leagueId]/tabs/redraft/TradeBlockPanel.tsx')).toMatch(/<BlockOfferLine offer=\{i\.suggestedOffer\} \/>/)
  })
})
