/**
 * Every roster-move writer keeps a starter's lineup SLOT (`lineup_sections.starters[i].slotIndex`,
 * lib/league/lineupSlotPositions.ts), not just his place in the starters list.
 *
 * The native lineup screen sent positions; the league Team tab's save did not, so a Team-tab save
 * stored a compacted list and the next load re-seated everyone (FLEX RB slid into RB2). The same drop
 * sat in the roster board (`useRosterManager`), the AutoCoach swap and Chimmy's lineup planner. Each
 * case below drives the real writer, stores through the save route's normalizer with a JSON round-trip
 * (what the JSONB column returns), and reads back through the screen's real reader.
 */
import { describe, expect, it } from 'vitest'
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import { buildLineupListsFromPlayerData } from '@/lib/league/lineup-swap'
import { seatStartersInSlots } from '@/lib/league/native/lineupMoves'
import { buildPersistedRosterDataFromRosterState } from '@/lib/roster/buildPersistedRosterDataFromRosterState'
import { buildPlayerDataFromSections, getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { buildLineupSaveRoster, buildPlayerRow } from '@/app/league/[leagueId]/tabs/team-tab-roster-helpers'
import {
  buildRosterStateFromPlayerData,
  inRosterSection,
  serializeRosterState,
  swapRosterSeats,
} from '@/components/app/roster/useRosterManager'
import { buildAutoCoachSwapSections } from '@/lib/autocoach/AutoCoachEngine'
import { planLineupMoves, type PlanPlayer } from '@/lib/chimmy/actions/lineupPlan'
import type { PlayerMap } from '@/lib/hooks/useSleeperPlayers'

const slot = (index: number, label: string, allowedPositions: string[]): ExpandedStarterSlot => ({
  index,
  label,
  allowedPositions,
  isFlexible: allowedPositions.length > 1,
})
// QB, RB1, RB2, WR1, WR2, TE, FLEX
const NFL = [
  slot(0, 'QB', ['QB']),
  slot(1, 'RB1', ['RB']),
  slot(2, 'RB2', ['RB']),
  slot(3, 'WR1', ['WR']),
  slot(4, 'WR2', ['WR']),
  slot(5, 'TE', ['TE']),
  slot(6, 'FLEX', ['RB', 'WR', 'TE']),
]
// PG, SG, SF, PF, C, UTIL1, UTIL2, UTIL3
const ALL_NBA = ['PG', 'SG', 'SF', 'PF', 'C']
const NBA = [
  slot(0, 'PG', ['PG']),
  slot(1, 'SG', ['SG']),
  slot(2, 'SF', ['SF']),
  slot(3, 'PF', ['PF']),
  slot(4, 'C', ['C']),
  slot(5, 'UTIL', ALL_NBA),
  slot(6, 'UTIL', ALL_NBA),
  slot(7, 'UTIL', ALL_NBA),
]
const POS: Record<string, string> = {
  qb: 'QB', rbA: 'RB', rbB: 'RB', rbF: 'RB', wrA: 'WR', wrB: 'WR', te: 'TE',
  pg: 'PG', sg: 'SG', sf: 'SF', pf: 'PF', c: 'C', u1: 'PG', u2: 'C', u3: 'SF',
}
const positionOf = (id: string) => POS[id]
const PLAYERS: PlayerMap = Object.fromEntries(Object.entries(POS).map(([id, position]) => [id, { name: id, position, team: 'X' }])) as unknown as PlayerMap

/** Saved through the save route's normalizer, then a JSON round-trip. */
const store = (rosterState: unknown, existing: unknown = {}) =>
  JSON.parse(JSON.stringify(buildPersistedRosterDataFromRosterState(rosterState, existing))) as Record<string, unknown>
const reload = (playerData: unknown, slots: ExpandedStarterSlot[]) =>
  seatStartersInSlots(buildLineupListsFromPlayerData(playerData, slots.length).starters, slots, positionOf)
const lists = (starters: string[], bench: string[] = []) => ({ starters, bench, ir: [], taxi: [], devy: [] })
const startersOf = (pd: Record<string, unknown>) => (pd.lineup_sections as { starters: Array<Record<string, unknown>> }).starters
const benchOf = (pd: Record<string, unknown>) => (pd.lineup_sections as { bench: Array<Record<string, unknown>> }).bench

/** The Team tab's save body before this fix: one row per filled slot, and no slot on any of them. */
const teamTabBodyBeforeFix = (l: ReturnType<typeof lists>) => ({
  starters: l.starters.filter(Boolean).map((id) => buildPlayerRow(id, PLAYERS)),
  bench: l.bench.map((id) => buildPlayerRow(id, PLAYERS)),
  ir: [], taxi: [], devy: [],
})

describe('league Team tab save', () => {
  it('positive control: the old body loses which slot the FLEX RB was in', () => {
    // RB2 benched, FLEX keeps its RB.
    const layout = ['qb', 'rbA', '', 'wrA', 'wrB', 'te', 'rbF']
    const back = reload(store(teamTabBodyBeforeFix(lists(layout, ['rbB']))), NFL)
    expect(back).not.toEqual(layout)
    expect(back[6]).toBe('') // FLEX came back empty...
    expect(back[2]).not.toBe('') // ...and the FLEX RB was moved into RB2
  })

  it('a FLEX starter stays in FLEX and the emptied RB2 stays empty', () => {
    const layout = ['qb', 'rbA', '', 'wrA', 'wrB', 'te', 'rbF']
    const saved = store(buildLineupSaveRoster(lists(layout, ['rbB']), PLAYERS))
    expect(startersOf(saved).map((r) => [r.id, r.slotIndex])).toEqual([['qb', 0], ['rbA', 1], ['wrA', 3], ['wrB', 4], ['te', 5], ['rbF', 6]])
    expect(saved.starters).toEqual(['qb', 'rbA', 'wrA', 'wrB', 'te', 'rbF']) // legacy list unchanged
    expect(reload(saved, NFL)).toEqual(layout)
  })

  it('a UTIL starter keeps UTIL slot 2, not UTIL 1', () => {
    const layout = ['pg', 'sg', 'sf', 'pf', 'c', '', 'u2', 'u3']
    expect(reload(store(teamTabBodyBeforeFix(lists(layout, ['u1']))), NBA)).not.toEqual(layout)
    expect(reload(store(buildLineupSaveRoster(lists(layout, ['u1']), PLAYERS)), NBA)).toEqual(layout)
  })

  it('bench, IR, taxi and devy rows never carry a slot', () => {
    const body = buildLineupSaveRoster({ starters: ['qb', ''], bench: ['rbA'], ir: ['te'], taxi: ['wrA'], devy: ['wrB'] }, PLAYERS)
    expect(body.starters[0].slotIndex).toBe(0)
    for (const k of ['bench', 'ir', 'taxi', 'devy'] as const) expect('slotIndex' in body[k][0]).toBe(false)
  })
})

describe('roster board (useRosterManager) save', () => {
  const stored = () =>
    store(buildLineupSaveRoster(lists(['qb', 'rbA', '', 'wrA', 'wrB', 'te', 'rbF'], ['rbB']), PLAYERS))

  it('reading and re-saving the board keeps every starter in his slot', () => {
    const pd = stored()
    const state = buildRosterStateFromPlayerData(pd)
    expect(state.starters.map((p) => p.slotIndex)).toEqual([0, 1, 3, 4, 5, 6])
    const resaved = JSON.parse(JSON.stringify(serializeRosterState(state, pd)))
    expect(startersOf(resaved).map((r) => r.slotIndex)).toEqual([0, 1, 3, 4, 5, 6])
    expect(reload(resaved, NFL)).toEqual(reload(pd, NFL))
  })

  it('a swap gives the incoming player the outgoing starter his slot; the benched one loses it', () => {
    const state = buildRosterStateFromPlayerData(stored())
    const out = state.starters.find((p) => p.id === 'rbF')!
    const into = state.bench.find((p) => p.id === 'rbB')!
    const { intoA, intoB } = swapRosterSeats(out, into)
    expect(intoA).toMatchObject({ id: 'rbB', slot: 'starters', slotIndex: 6 })
    expect(intoB.slot).toBe('bench')
    expect('slotIndex' in intoB).toBe(false)
  })

  it('moving a starter to the bench drops his slot, so he cannot bring it back later', () => {
    const state = buildRosterStateFromPlayerData(stored())
    const benched = inRosterSection(state.starters[0], 'bench')
    expect('slotIndex' in benched).toBe(false)
    const resaved = serializeRosterState({ ...state, starters: state.starters.slice(1), bench: [...state.bench, benched] }, {})
    expect(benchOf(resaved).every((r) => !('slotIndex' in r))).toBe(true)
  })
})

describe('AutoCoach swap', () => {
  it('the replacement takes the benched starter his FLEX slot', () => {
    const sections = getNormalizedLineupSections(store(buildLineupSaveRoster(lists(['qb', 'rbA', '', 'wrA', 'wrB', 'te', 'rbF'], ['rbB']), PLAYERS)))
    const next = buildAutoCoachSwapSections(sections, { id: 'rbF' }, { id: 'rbB', position: 'RB' })
    const pd = JSON.parse(JSON.stringify(buildPlayerDataFromSections({}, next)))
    expect(startersOf(pd).find((r) => r.id === 'rbB')?.slotIndex).toBe(6)
    expect(benchOf(pd).find((r) => r.id === 'rbF')).not.toHaveProperty('slotIndex')
    expect(reload(pd, NFL)).toEqual(['qb', 'rbA', '', 'wrA', 'wrB', 'te', 'rbB'])
  })
})

describe('Chimmy "set my lineup"', () => {
  const planPlayers = new Map<string, PlanPlayer>(Object.entries(POS).map(([id, position]) => [id, { playerId: id, name: id, position }]))
  const run = (pd: Record<string, unknown>, moves: Array<{ playerId: string; to: 'starters' | 'bench' }>) =>
    planLineupMoves({ playerData: pd, rosterPlayerIds: pd.players as string[], slots: NFL, players: planPlayers, moves })

  it('reads stored positions, seats the incoming RB in the empty RB2, and writes every slot', () => {
    // RB2 is empty and the FLEX holds a RB. Read in list order, everyone after the hole is one slot off.
    const pd = store(buildLineupSaveRoster(lists(['qb', 'rbA', '', 'wrA', 'wrB', 'te', 'rbF'], ['rbB']), PLAYERS))
    const r = run(pd, [{ playerId: 'rbB', to: 'starters' }])
    if (!r.ok) throw new Error(r.reason)
    expect(r.moveIn).toEqual([{ playerId: 'rbB', slot: 'RB2' }])
    const next = JSON.parse(JSON.stringify(r.nextPlayerData))
    expect(startersOf(next).map((x) => [x.id, x.slotIndex])).toEqual([['qb', 0], ['rbA', 1], ['rbB', 2], ['wrA', 3], ['wrB', 4], ['te', 5], ['rbF', 6]])
    expect(reload(next, NFL)).toEqual(['qb', 'rbA', 'rbB', 'wrA', 'wrB', 'te', 'rbF'])
  })

  it('benching a starter leaves his slot empty and takes the slot off his row', () => {
    const pd = store(buildLineupSaveRoster(lists(['qb', 'rbA', 'rbB', 'wrA', 'wrB', 'te', 'rbF']), PLAYERS))
    const r = run(pd, [{ playerId: 'rbB', to: 'bench' }])
    if (!r.ok) throw new Error(r.reason)
    const next = JSON.parse(JSON.stringify(r.nextPlayerData))
    expect(benchOf(next).find((x) => x.id === 'rbB')).not.toHaveProperty('slotIndex')
    expect(reload(next, NFL)).toEqual(['qb', 'rbA', '', 'wrA', 'wrB', 'te', 'rbF'])
  })
})
