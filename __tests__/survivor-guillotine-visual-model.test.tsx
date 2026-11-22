import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultSGConfig } from '@/lib/survivor-guillotine/config'
import {
  buildCeremony, buildChopLine, buildIdolVault, buildTribeRace, sgTribeArt, shareCardsFor, type SGVisualInput,
} from '@/lib/survivor-guillotine/visual-model'
import { SGVisualSet } from '@/components/survivor-guillotine/SGVisualSet'
import type { SGPower } from '@/lib/survivor-guillotine/types'

afterEach(() => cleanup())

const ids = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']
function team(id: string, out = false) {
  return { legacyRosterId: id, teamName: `Team ${id.toUpperCase()}`, ownerName: id, eliminatedAt: out ? '2026-10-01T00:00:00Z' : null }
}
function power(over: Partial<SGPower>): SGPower {
  return { id: 'p', kind: 'personal_immunity', binding: 'player', playerId: 'x', ownerId: 'a1', expiresAfterPeriod: 10,
    status: 'held', targetTeamId: null, revealed: false, ...over }
}
function input(over: Partial<SGVisualInput> = {}, points: Record<string, number> = {}): SGVisualInput {
  const config = { ...defaultSGConfig('NFL'), teamCount: 6 }
  return {
    season: {
      config, currentPeriod: 1, status: 'active', periodHistory: {},
      tribes: ids.map((id) => ({ rosterId: id, tribeId: id.startsWith('a') ? 'tribe-0' : 'tribe-1' })),
      periodState: { period: 1, matchups: [{ team1: 'a1', team2: 'b1' }, { team1: 'a2', team2: 'b2' }, { team1: 'a3', team2: 'b3' }],
        champions: [], sitOuts: [], priorSitOuts: [], ceremonyAt: null, ceremonyStarted: false },
    },
    ownRosterId: 'a1',
    teams: ids.map((id) => team(id)),
    scores: Object.entries(points).map(([rosterId, totalPoints]) => ({ rosterId, totalPoints, status: 'live' })),
    powers: [],
    ...over,
  }
}

describe('Survivor Guilly visual model', () => {
  it('decides the Match Play race on matchup wins, not total tribe points (engine rule)', () => {
    // Tribe A wins two of three matchups narrowly; tribe B has far more total points.
    const race = buildTribeRace(input({}, { a1: 101, b1: 100, a2: 101, b2: 100, a3: 10, b3: 200 }))
    const a = race.tribes.find((t) => t.tribeId === 'tribe-0')!
    const b = race.tribes.find((t) => t.tribeId === 'tribe-1')!
    expect(b.totalPoints).toBeGreaterThan(a.totalPoints)
    expect(a.metric).toBe(2)
    expect(b.metric).toBe(1)
    expect(race.projectedImmuneTribeId).toBe('tribe-0')
    expect(a.standing).toBe('leading')
  })

  it('puts only managers outside the projected immune tribe on the chop line', () => {
    const data = input({}, { a1: 101, b1: 100, a2: 101, b2: 100, a3: 10, b3: 200 })
    const line = buildChopLine(data)
    const rows = line.groups.flatMap((g) => g.rows)
    expect(rows.map((r) => r.rosterId).sort()).toEqual(['b1', 'b2', 'b3'])
    // a3 has the lowest score in the league but sits in the immune tribe.
    expect(rows.find((r) => r.tier === 'chop_zone')?.rosterId).toBe('b1')
    expect(rows.find((r) => r.rosterId === 'b2')?.tier).toBe('danger')
    expect(rows.find((r) => r.rosterId === 'b3')?.tier).toBe('safe')
  })

  it('uses the whole field after the merge', () => {
    const data = input({}, { a1: 50, a2: 60, a3: 70, b1: 80, b2: 90, b3: 99 })
    data.season.config = { ...data.season.config, periodOverrides: { 1: 'merged' } }
    const line = buildChopLine(data)
    expect(line.groups).toHaveLength(1)
    expect(line.groups[0].rows.at(-1)?.rosterId).toBe('a1')
  })

  it('shows the viewer only their own powers and engine-revealed ones', () => {
    const vault = buildIdolVault(input({ powers: [
      power({ id: 'mine', ownerId: 'a1' }),
      power({ id: 'theirs-hidden', ownerId: 'b1' }),
      power({ id: 'theirs-used', ownerId: 'b2', status: 'used', revealed: true, kind: 'steal_player' }),
    ] }))
    expect(vault.mine.map((p) => p.id)).toEqual(['mine'])
    expect(vault.revealed.map((p) => p.id)).toEqual(['theirs-used'])
    expect(vault.mine[0].label).toBe('Personal Immunity')
  })

  it('never names an idol holder on a share card', () => {
    const data = input()
    data.season.periodHistory = { 1: { mode: 'match_play', choppedTeamIds: ['b1'], savedTeamIds: ['a1'], protectedTeamIds: ['a1'],
      scores: { a1: 10, b1: 9 }, immuneTribeId: null } }
    const cards = shareCardsFor(data)
    expect(cards.map((c) => c.key)).toContain('missed')
    expect(JSON.stringify(cards)).not.toMatch(/idol|immunity|Team A1/i)
  })

  it('builds the five-beat ceremony from the recorded period', () => {
    const steps = buildCeremony('3', { mode: 'match_play', choppedTeamIds: ['b1'], savedTeamIds: [], protectedTeamIds: [],
      scores: { b1: 88.25 }, immuneTribeId: 'tribe-0' }, ids.map((id) => team(id)))
    expect(steps.map((s) => s.key)).toEqual(['race', 'idols', 'chop', 'torch', 'release'])
    expect(steps[0].detail).toContain('Vela won immunity')
    expect(steps[2].detail).toBe('Team B1, 88.3.')
  })

  it('composes tribe art for any engine tribe id', () => {
    expect(sgTribeArt('tribe-1').name).toBe('Koa')
    expect(sgTribeArt('gauntlet-1').name).toBe('Vela')
    expect(sgTribeArt('tribe-3').buffSrc).toBe('/specialty/survguil/tribes/buff-red.svg')
  })

  it('renders without leaking another manager\'s hidden power', () => {
    render(<SGVisualSet leagueId="l" isCommissioner={false} input={input({ powers: [
      power({ id: 'theirs', ownerId: 'b1', kind: 'faab_bonus' }),
    ] }, { a1: 101, b1: 100 })} />)
    expect(screen.getByTestId('sg-visual-set')).toBeTruthy()
    expect(screen.queryByText('FAAB Cache')).toBeNull()
    expect(screen.getByText(/No powers on your team/)).toBeTruthy()
  })
})
