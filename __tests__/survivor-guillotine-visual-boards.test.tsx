import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSGConfig } from '@/lib/survivor-guillotine/config'
import { buildTribeRace, type SGVisualInput } from '@/lib/survivor-guillotine/visual-model'
import {
  buildBladeMeter, buildMultiRace, buildReversals, buildTribeDraw, selectReleasedPlayers, sgChopCardFromHistory,
  sgTribeCountOptions,
} from '@/lib/survivor-guillotine/visual-boards'
import { SGVisualSet } from '@/components/survivor-guillotine/SGVisualSet'
import type { SGPower } from '@/lib/survivor-guillotine/types'

afterEach(() => cleanup())

const team = (id: string) => ({ legacyRosterId: id, teamName: `Team ${id.toUpperCase()}`, ownerName: id, eliminatedAt: null })
const power = (over: Partial<SGPower>): SGPower => ({ id: 'p', kind: 'personal_immunity', binding: 'player', playerId: 'pl1',
  ownerId: 'a1', expiresAfterPeriod: 10, status: 'held', targetTeamId: null, revealed: false, ...over })

/** Three tribes of two, Tribe Champion: champions a1 / b1 / c1. */
function threeTribes(points: Record<string, number>, over: Partial<SGVisualInput> = {}): SGVisualInput {
  const ids = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2']
  const config = { ...defaultSGConfig('NFL'), teamCount: 6, tribeCount: 3, periodOverrides: { 1: 'tribe_champion' as const } }
  return {
    season: { config, currentPeriod: 1, status: 'active', periodHistory: {},
      tribes: ids.map((id) => ({ rosterId: id, tribeId: `tribe-${'abc'.indexOf(id[0])}` })),
      periodState: { period: 1, matchups: [], champions: ['a1', 'b1', 'c1'], sitOuts: [], priorSitOuts: [], ceremonyAt: null, ceremonyStarted: false } },
    ownRosterId: 'b2', teams: ids.map(team),
    scores: Object.entries(points).map(([rosterId, totalPoints]) => ({ rosterId, totalPoints, status: 'live' })), powers: [], ...over,
  }
}

describe('Survivor Guilly follow-up boards', () => {
  it('offers only the engine\'s 2–4 tribe counts', () => {
    const opts = sgTribeCountOptions(12)
    expect(opts.filter((o) => o.allowed).map((o) => o.count)).toEqual([2, 3, 4])
    expect(opts.find((o) => o.count === 6)?.reason).toMatch(/2–4 tribes/)
    expect(opts.find((o) => o.count === 3)?.sizes).toBe('4 each')
  })

  it('3+ tribes: one tribe is immune and EVERY other tribe is in the chop field (engine rule)', () => {
    const race = buildTribeRace(threeTribes({ a1: 120, a2: 10, b1: 100, b2: 90, c1: 80, c2: 70 }))
    const rows = buildMultiRace(race)
    expect(rows.map((r) => [r.name, r.status])).toEqual([['Vela', 'immune'], ['Koa', 'chop_field'], ['Nalu', 'chop_field']])
  })

  it('blade meter measures the viewer against the engine chop field', () => {
    const data = threeTribes({ a1: 120, a2: 10, b1: 100, b2: 74, c1: 80, c2: 70 })
    const meter = buildBladeMeter(data)!
    // a2 (10) is lowest overall but immune; the blade is c2 at 70.
    expect(meter.blade).toBe(70)
    expect(meter.margin).toBe(4)
    expect(meter.tier).toBe('danger')
    expect(meter.bladeName).toBe('Team C2')
  })

  it('tells an immune-tribe viewer they are off the line', () => {
    const data = threeTribes({ a1: 120, a2: 10, b1: 100, b2: 74, c1: 80, c2: 70 }, { ownRosterId: 'a2' })
    expect(buildBladeMeter(data)?.tier).toBe('immune')
  })

  it('tribe draw shows only the viewer\'s own sealed powers, and names a player only from their own roster', () => {
    const data = threeTribes({}, { powers: [power({ id: 'mine', ownerId: 'b2', playerId: 'pl1' }), power({ id: 'theirs', ownerId: 'c1' })] })
    const draw = buildTribeDraw(data, [{ id: 'pl1', name: 'Garrett Wilson', position: 'WR', team: 'NYJ' }])
    expect(draw.tribe?.name).toBe('Koa')
    expect(draw.tribemates).toEqual(['Team B1'])
    expect(draw.idols.map((i) => i.id)).toEqual(['mine'])
    expect(draw.idols[0].attachedTo).toBe('Garrett Wilson (WR · NYJ)')
  })

  it('released players skip reversed chops and hosted-hidden periods, and mark claims', () => {
    const players = new Map([['x', { name: 'X', position: 'RB', team: 'DAL' }], ['y', { name: 'Y', position: 'WR', team: null }], ['z', { name: 'Z', position: 'QB', team: 'KC' }]])
    const rows = selectReleasedPlayers({
      chops: [
        { period: 4, rosterId: 'r4', releaseSnapshot: { playerData: ['z'] }, reversedAt: null },
        { period: 3, rosterId: 'r3', releaseSnapshot: { playerData: ['x', 'y'] }, reversedAt: null },
        { period: 2, rosterId: 'r2', releaseSnapshot: { playerData: ['z'] }, reversedAt: '2026-10-01' },
      ],
      hiddenPeriods: [4], rosterPlayerIds: (d) => (Array.isArray(d) ? d as string[] : []), ownedPlayerIds: new Set(['y']), players,
    })
    expect(rows.map((r) => [r.id, r.period, r.available])).toEqual([['x', 3, true], ['y', 3, false]])
  })

  it('reversal board follows the engine: restored, then the ceremony reruns', () => {
    const [r] = buildReversals([{ period: 9, rosterId: 'a1', score: 101.3, reversedAt: '2026-10-07T18:14:00Z', reason: 'final_score_correction' }],
      [team('a1'), team('b1')], { 9: { mode: 'merged', choppedTeamIds: ['b1'], savedTeamIds: [], scores: { a1: 101.3, b1: 101.0 }, immuneTribeId: null } })
    expect(r.restored).toBe('Team A1')
    expect(r.newlyChopped).toEqual(['Team B1'])
    expect(r.steps.map((s) => s.title)).toEqual(['Chop ran', 'Correction landed', 'Chop reversed', 'Ceremony reruns'])
  })

  it('chop card names only engine-published saves, never other idol plays', () => {
    const card = sgChopCardFromHistory(5, { mode: 'match_play', choppedTeamIds: ['b1'], savedTeamIds: [], protectedTeamIds: ['a1'],
      scores: {}, immuneTribeId: 'tribe-1' }, [team('a1'), team('b1')])
    expect(card.lines.join(' ')).not.toContain('Team A1')
    expect(card.lines).toEqual(['Koa won immunity.', 'Team B1 was chopped. Their players are on waivers.'])
  })

  it('wires the play-idol shortcut and the waiver board into the visual set', () => {
    const onPlay = vi.fn()
    const data = threeTribes({ a1: 120, a2: 10, b1: 100, b2: 74, c1: 80, c2: 70 }, { powers: [power({ id: 'idol1', ownerId: 'b2' })] })
    render(<SGVisualSet leagueId="L" isCommissioner={false} input={data} extras={{ onPlayPower: onPlay, faabRemaining: 412,
      releasedPlayers: [{ id: 'x', name: 'Player X', position: 'RB', team: 'DAL', fromRosterId: 'a2', period: 3, available: true }] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play idol' }))
    expect(onPlay).toHaveBeenCalledWith('idol1')
    expect(screen.getByTestId('sg-waivers').textContent).toContain('Player X')
    expect(screen.getByRole('link', { name: 'Place FAAB bids' }).getAttribute('href')).toBe('/waiver-wire?leagueId=L')
    expect(screen.getByTestId('sg-multirace')).toBeTruthy()
  })
})
