/** Pure lineup-move rules behind NativeLineupScreen's click AND drag flows (NFL, NBA, NHL, MLB). */
import { describe, expect, it } from 'vitest'
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import type { RosterLineupLists } from '@/lib/league/lineup-swap'
import { resolveLineupMove, seatStartersInSlots, startersOnBye, type LineupMoveContext } from '@/lib/league/native/lineupMoves'
import { isIrEligibleStatus } from '@/lib/roster-lineup-engine/irEligibility'

const slot = (index: number, label: string, allowedPositions: string[]): ExpandedStarterSlot =>
  ({ index, label, allowedPositions, isFlexible: allowedPositions.length > 1 }) as ExpandedStarterSlot
const lists = (p: Partial<RosterLineupLists>): RosterLineupLists => ({ starters: [], bench: [], ir: [], taxi: [], devy: [], ...p })

function ctx(over: Partial<LineupMoveContext> & Pick<LineupMoveContext, 'lists' | 'slots'>, pos: Record<string, string>): LineupMoveContext {
  return { positionOf: (id) => pos[id], isLocked: () => false, canIr: () => false, ...over }
}

const NFL = [slot(0, 'QB', ['QB']), slot(1, 'RB', ['RB']), slot(2, 'WR', ['WR']), slot(3, 'FLEX', ['RB', 'WR', 'TE'])]
const nflPos = { qb: 'QB', rb: 'RB', wr: 'WR', te: 'TE', rb2: 'RB', wr2: 'WR' }

describe('resolveLineupMove', () => {
  it('bench → occupied slot swaps the two players (NFL)', () => {
    const r = resolveLineupMove(ctx({ lists: lists({ starters: ['qb', 'rb', 'wr', 'te'], bench: ['rb2'] }), slots: NFL }, nflPos), 'rb2', { kind: 'starter', slotIndex: 1 })
    expect(r).toEqual({ ok: true, next: lists({ starters: ['qb', 'rb2', 'wr', 'te'], bench: ['rb'] }) })
  })

  it('starter → starter swap is refused when the displaced player cannot fill the vacated slot', () => {
    // TE (FLEX) onto WR: ineligible in the first place.
    const c = ctx({ lists: lists({ starters: ['qb', 'rb', 'wr', 'te'] }), slots: NFL }, nflPos)
    expect(resolveLineupMove(c, 'te', { kind: 'starter', slotIndex: 2 })).toMatchObject({ ok: false })
    // WR (slot 2) into FLEX holding a TE: the TE cannot go back into the WR slot.
    const r = resolveLineupMove(c, 'wr', { kind: 'starter', slotIndex: 3 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/WR/)
    // RB (slot 1) into FLEX holding a WR2: WR2 cannot play RB either.
    const c2 = ctx({ lists: lists({ starters: ['qb', 'rb', 'wr', 'wr2'] }), slots: NFL }, nflPos)
    expect(resolveLineupMove(c2, 'rb', { kind: 'starter', slotIndex: 3 }).ok).toBe(false)
    // RB2 (FLEX) and RB (RB slot) swap fine.
    const c3 = ctx({ lists: lists({ starters: ['qb', 'rb', 'wr', 'rb2'] }), slots: NFL }, nflPos)
    expect(resolveLineupMove(c3, 'rb2', { kind: 'starter', slotIndex: 1 })).toEqual({ ok: true, next: lists({ starters: ['qb', 'rb2', 'wr', 'rb'] }) })
  })

  it('an ineligible drop is rejected with the slot named', () => {
    const r = resolveLineupMove(ctx({ lists: lists({ starters: ['qb', 'rb', 'wr', 'te'], bench: ['rb2'] }), slots: NFL }, nflPos), 'rb2', { kind: 'starter', slotIndex: 0 })
    expect(r).toEqual({ ok: false, reason: 'Not eligible for QB.' })
  })

  it('locked players cannot move and cannot be displaced', () => {
    const base = { lists: lists({ starters: ['qb', 'rb', 'wr', 'te'], bench: ['rb2'] }), slots: NFL }
    const lockedRb = ctx({ ...base, isLocked: (id) => id === 'rb', lockReason: () => 'Game started' }, nflPos)
    expect(resolveLineupMove(lockedRb, 'rb', { kind: 'bench' })).toEqual({ ok: false, reason: 'Game started' })
    expect(resolveLineupMove(lockedRb, 'rb2', { kind: 'starter', slotIndex: 1 }).ok).toBe(false)
  })

  it('benching a starter with no replacement leaves the slot empty', () => {
    const r = resolveLineupMove(ctx({ lists: lists({ starters: ['qb', 'rb', 'wr', 'te'], bench: ['rb2'] }), slots: NFL }, nflPos), 'rb', { kind: 'bench' })
    expect(r).toEqual({ ok: true, next: lists({ starters: ['qb', '', 'wr', 'te'], bench: ['rb2', 'rb'] }) })
  })

  it('benching is refused when the bench is full', () => {
    const r = resolveLineupMove(ctx({ lists: lists({ starters: ['qb', 'rb', 'wr', 'te'], bench: ['rb2'] }), slots: NFL, limits: { bench: 1 } }, nflPos), 'rb', { kind: 'bench' })
    expect(r).toMatchObject({ ok: false })
  })

  it('IR: an eligible injured player moves in and back out to the bench; a healthy one is refused', () => {
    const base = { lists: lists({ starters: ['qb', 'rb', 'wr', 'te'], bench: ['rb2'] }), slots: NFL, limits: { ir: 1 } }
    const c = ctx({ ...base, canIr: (id) => id === 'rb' }, nflPos)
    const toIr = resolveLineupMove(c, 'rb', { kind: 'ir' })
    expect(toIr).toEqual({ ok: true, next: lists({ starters: ['qb', '', 'wr', 'te'], bench: ['rb2'], ir: ['rb'] }) })
    expect(resolveLineupMove(c, 'rb2', { kind: 'ir' }).ok).toBe(false)
    if (!toIr.ok) throw new Error('unreachable')
    const back = resolveLineupMove({ ...c, lists: toIr.next }, 'rb', { kind: 'bench' })
    expect(back).toEqual({ ok: true, next: lists({ starters: ['qb', '', 'wr', 'te'], bench: ['rb2', 'rb'], ir: [] }) })
    // IR full.
    expect(resolveLineupMove({ ...c, lists: toIr.next, canIr: () => true }, 'rb2', { kind: 'ir' }).ok).toBe(false)
    // No IR slots in this league.
    expect(resolveLineupMove({ ...c, limits: { ir: 0 } }, 'rb', { kind: 'ir' }).ok).toBe(false)
  })

  it('NBA, NHL and MLB slots use the same eligibility', () => {
    const NBA = [slot(0, 'PG', ['PG']), slot(1, 'G', ['PG', 'SG']), slot(2, 'UTIL', ['PG', 'SG', 'SF', 'PF', 'C'])]
    const nba = ctx({ lists: lists({ starters: ['pg', 'sg', 'c'], bench: ['pf'] }), slots: NBA }, { pg: 'PG', sg: 'SG', c: 'C', pf: 'PF' })
    expect(resolveLineupMove(nba, 'pf', { kind: 'starter', slotIndex: 1 })).toEqual({ ok: false, reason: 'Not eligible for G.' })
    expect(resolveLineupMove(nba, 'pf', { kind: 'starter', slotIndex: 2 })).toEqual({ ok: true, next: lists({ starters: ['pg', 'sg', 'pf'], bench: ['c'] }) })

    const NHL = [slot(0, 'C', ['C']), slot(1, 'D', ['D']), slot(2, 'G', ['G'])]
    const nhl = ctx({ lists: lists({ starters: ['c1', 'd1', 'g1'], bench: ['g2'] }), slots: NHL }, { c1: 'C', d1: 'D', g1: 'G', g2: 'G' })
    expect(resolveLineupMove(nhl, 'g2', { kind: 'starter', slotIndex: 1 }).ok).toBe(false)
    expect(resolveLineupMove(nhl, 'g2', { kind: 'starter', slotIndex: 2 })).toEqual({ ok: true, next: lists({ starters: ['c1', 'd1', 'g2'], bench: ['g1'] }) })

    const MLB = [slot(0, 'C', ['C']), slot(1, 'UTIL', ['C', '1B', '2B', 'SS', '3B', 'OF']), slot(2, 'P', ['SP', 'RP', 'P'])]
    const mlb = ctx({ lists: lists({ starters: ['c', 'of', 'sp'], bench: ['rp'] }), slots: MLB }, { c: 'C', of: 'OF', sp: 'SP', rp: 'RP' })
    expect(resolveLineupMove(mlb, 'rp', { kind: 'starter', slotIndex: 1 }).ok).toBe(false)
    expect(resolveLineupMove(mlb, 'rp', { kind: 'starter', slotIndex: 2 })).toEqual({ ok: true, next: lists({ starters: ['c', 'of', 'rp'], bench: ['sp'] }) })
  })
})

describe('resolveLineupMove — taxi squad', () => {
  const base = () => lists({ starters: ['qb', 'rb', 'wr', 'te'], bench: ['rb2'], taxi: ['wr2'] })

  it('bench → taxi and taxi → bench move the player between the two lists', () => {
    const c = ctx({ lists: base(), slots: NFL, limits: { taxi: 3 } }, nflPos)
    expect(resolveLineupMove(c, 'rb2', { kind: 'taxi' })).toEqual({ ok: true, next: lists({ starters: ['qb', 'rb', 'wr', 'te'], taxi: ['wr2', 'rb2'] }) })
    expect(resolveLineupMove(c, 'wr2', { kind: 'bench' })).toEqual({ ok: true, next: lists({ starters: ['qb', 'rb', 'wr', 'te'], bench: ['rb2', 'wr2'] }) })
  })

  it('a taxi player cannot go straight into a starting slot', () => {
    const r = resolveLineupMove(ctx({ lists: base(), slots: NFL }, nflPos), 'wr2', { kind: 'starter', slotIndex: 2 })
    expect(r).toMatchObject({ ok: false, reason: 'Move him from the taxi squad to the bench first.' })
  })

  it('refuses when the league has no taxi squad, the squad is full, or the player is not eligible', () => {
    expect(resolveLineupMove(ctx({ lists: base(), slots: NFL, limits: { taxi: 0 } }, nflPos), 'rb2', { kind: 'taxi' })).toMatchObject({ ok: false, reason: 'This league has no taxi squad.' })
    expect(resolveLineupMove(ctx({ lists: base(), slots: NFL, limits: { taxi: 1 } }, nflPos), 'rb2', { kind: 'taxi' })).toMatchObject({ ok: false, reason: 'Your taxi squad is full.' })
    expect(resolveLineupMove(ctx({ lists: base(), slots: NFL, canTaxi: () => false }, nflPos), 'rb2', { kind: 'taxi' })).toMatchObject({ ok: false, reason: 'This player is not eligible for the taxi squad.' })
  })

  it('moving a taxi player to the taxi squad again is a no-op', () => {
    expect(resolveLineupMove(ctx({ lists: base(), slots: NFL }, nflPos), 'wr2', { kind: 'taxi' })).toMatchObject({ ok: false, noop: true })
  })
})

describe('startersOnBye', () => {
  const players: Record<string, { byeWeek?: number | null; opponent?: string | null }> = {
    a: { byeWeek: 7, opponent: null },
    b: { byeWeek: 9, opponent: 'KC' },
    c: { byeWeek: null, opponent: 'BYE' },
    d: { byeWeek: null, opponent: null },
  }
  it('flags a starter whose bye is this week or whose opponent is BYE, and nobody else', () => {
    expect(startersOnBye(['a', 'b', 'c', 'd', ''], (id) => players[id], 7)).toEqual(['a', 'c'])
  })
  it('does not guess when the week is unknown', () => {
    expect(startersOnBye(['a', 'b'], (id) => players[id], null)).toEqual([])
  })
})

describe('seatStartersInSlots', () => {
  it('leaves an already slot-ordered lineup untouched', () => {
    expect(seatStartersInSlots(['qb', 'rb', 'wr', 'te'], NFL, (id) => nflPos[id as keyof typeof nflPos])).toEqual(['qb', 'rb', 'wr', 'te'])
  })

  it('re-seats a lineup saved with an empty slot (the server stores starters compacted)', () => {
    // Saved as [qb, wr, te] after the RB was benched; padding alone would put the WR in the RB slot.
    expect(seatStartersInSlots(['qb', 'wr', 'te', ''], NFL, (id) => nflPos[id as keyof typeof nflPos])).toEqual(['qb', '', 'wr', 'te'])
  })

  it('never drops a starter it cannot place (unknown positions keep their order)', () => {
    expect(seatStartersInSlots(['a', 'b', '', ''], NFL, () => undefined)).toEqual(['a', 'b', '', ''])
  })
})

describe('isIrEligibleStatus', () => {
  it('follows the league IR flags', () => {
    const none = { irAllowOut: false, irAllowCovid: false, irAllowSuspended: false, irAllowNA: false, irAllowDNR: false, irAllowDoubtful: false }
    expect(isIrEligibleStatus(none, 'IR')).toBe(true)
    expect(isIrEligibleStatus(none, 'Out')).toBe(false)
    expect(isIrEligibleStatus({ ...none, irAllowOut: true }, 'Out')).toBe(true)
    expect(isIrEligibleStatus(none, '')).toBe(false)
    expect(isIrEligibleStatus(none, 'healthy')).toBe(false)
  })
})
