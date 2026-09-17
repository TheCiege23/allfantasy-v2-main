import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import {
  buildStartSitScenario,
  buildWaiverScenario,
  looksLikeStartSit,
  looksLikeWaiverMove,
  parseWaiverMove,
  renderStartSitScenarioBlock,
  renderWaiverScenarioBlock,
  type LineupScenarioDeps,
  type WeekPlayer,
} from '@/lib/chimmy/lineupScenarioGrounding'
import { readReadyScenario, type ReadyStartSitScenario, type ReadyWaiverScenario } from '@/lib/chimmy/tradeScenarioTypes'
import { ChimmyScenarioCard } from '@/components/core-app/comms/ChimmyScenario'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'

/**
 * Scenario comparisons beyond trades (Chimmy item 8): start/sit and waiver add/drop, resolved against
 * the asker's real roster, in THIS WEEK's projections scored under THE LEAGUE'S OWN rules.
 *
 * The data seams are injected; `computeLeagueProjectedPoints` is the real engine, so every number
 * below is a component line run through a real rulebook.
 */

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN']
const FULL_PPR = { rec: 1, rec_yd: 0.1, rush_yd: 0.1 }
const HALF_PPR = { rec: 0.5, rec_yd: 0.1, rush_yd: 0.1 }
const WEEK = { season: '2026', week: 3 }

const team = (teamId: string, managerUserId: string) =>
  ({ teamId, managerUserId, displayName: teamId, ownerName: teamId }) as unknown as CanonicalWorld['teams'][number]
const roster = (rosterId: string, teamId: string, playerIds: string[], reserveIds: string[] = []) =>
  ({ rosterId, teamId, playerIds, reserveIds, taxiIds: [] }) as unknown as CanonicalWorld['rosters'][number]

const MINE = ['qb1', 'rb1', 'rb2', 'rb3', 'wr1', 'wr2', 'te1', 'wr3', 'wr4', 'k1', 'rb-ir']

const world = (over: { slots?: string[] | null; scoring?: unknown; sport?: string } = {}) =>
  ({
    league: {
      sport: over.sport ?? 'NFL',
      season: 2026,
      currentWeek: 3,
      scoringPresetId: 'ppr',
      // The canonical world carries the WRAPPER, as `narrowScoringSettings` builds it.
      scoringSettings: 'scoring' in over ? over.scoring : { scoring_settings: FULL_PPR },
      rosterSettings: { starterSlots: over.slots === undefined ? SLOTS : over.slots },
    },
    teams: [team('t1', 'viewer-1'), team('t2', 'rival-2')],
    rosters: [roster('r1', 't1', MINE, ['rb-ir']), roster('r2', 't2', ['wr9'])],
  }) as unknown as CanonicalWorld

const NAMES = new Map<string, { name: string | null; position: string | null }>([
  ['qb1', { name: 'Josh Allen', position: 'QB' }],
  ['rb1', { name: 'Bijan Robinson', position: 'RB' }],
  ['rb2', { name: 'Jahmyr Gibbs', position: 'RB' }],
  ['rb3', { name: 'Tank Bigsby', position: 'RB' }],
  ['wr1', { name: 'CeeDee Lamb', position: 'WR' }],
  ['wr2', { name: 'Garrett Wilson', position: 'WR' }],
  ['te1', { name: 'Sam LaPorta', position: 'TE' }],
  ['wr3', { name: 'Jayden Reed', position: 'WR' }],
  ['wr4', { name: 'Rashid Shaheed', position: 'WR' }],
  ['k1', { name: 'Harrison Butker', position: 'K' }],
  ['rb-ir', { name: 'Nick Chubb', position: 'RB' }],
  ['wr9', { name: 'Puka Nacua', position: 'WR' }],
])

/** A line worth `points` under any rulebook here: rushing yards only, at 0.1 a yard. */
const yards = (points: number) => ({ rush_yd: points * 10 })

/*
 * Best lineup from the ACTIVE roster: QB 22 · RB 18, 16 · WR 17, 12 · TE 10 · FLEX Reed 11 = 106.
 * Chubb (IR) projects 30 — if he were counted he would start and every total would move.
 */
const BASE_LINES: Record<string, Record<string, unknown>> = {
  qb1: yards(22), rb1: yards(18), rb2: yards(16), rb3: yards(7), wr1: yards(17), wr2: yards(12), te1: yards(10),
  wr3: yards(11), wr4: yards(8), k1: yards(9), 'rb-ir': yards(30), wr9: yards(15), 'sl-bateman': yards(14),
}
let lines: Record<string, Record<string, unknown>> = BASE_LINES

const BATEMAN: WeekPlayer = { playerId: 'sl-bateman', name: 'Rashod Bateman', position: 'WR' }

let deps: LineupScenarioDeps
const resolveWorld = vi.fn()
const loadPlayerNames = vi.fn()
const latestWeek = vi.fn()
const loadWeekLines = vi.fn()
const findWeekPlayersByName = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  lines = BASE_LINES
  resolveWorld.mockResolvedValue(world())
  loadPlayerNames.mockResolvedValue(NAMES)
  latestWeek.mockResolvedValue(WEEK)
  loadWeekLines.mockImplementation(async (args: { playerIds: string[]; positions: ReadonlyMap<string, string | null> }) =>
    new Map(
      args.playerIds
        .filter((id) => lines[id])
        .map((id) => [id, { position: args.positions.get(id) ?? null, componentStats: lines[id]! }]),
    ),
  )
  findWeekPlayersByName.mockImplementation(async ({ name }: { name: string }) => ({
    players: name === 'Rashod Bateman' ? [BATEMAN] : [],
    complete: true,
  }))
  deps = { resolveWorld, loadPlayerNames, latestWeek, loadWeekLines, findWeekPlayersByName }
})

const startSit = (message: string, userId = 'viewer-1') =>
  buildStartSitScenario({ message, leagueId: 'L1', userId }, deps)
const waiver = (message: string, engineClaims: unknown[] | null = null, userId = 'viewer-1') =>
  buildWaiverScenario({ message, leagueId: 'L1', userId, engineClaims: engineClaims as never }, deps)

const ready = <T extends { status: string }>(s: T | null): Extract<T, { status: 'ready' }> => {
  expect(s?.status).toBe('ready')
  return s as Extract<T, { status: 'ready' }>
}
const unresolved = (s: { status: string; reason?: string; detail?: string } | null) => {
  expect(s?.status).toBe('unresolved')
  return s as { reason: string; detail: string }
}
const unresolvedReason = (s: { status: string; reason?: string } | null) => unresolved(s).reason

describe('start/sit', () => {
  it('picks the one in the best lineup and prices the difference, for this week', async () => {
    const s = ready(await startSit('Should I start Jayden Reed or Tank Bigsby?'))
    expect(s.contested).toBe(true)
    expect(s.startPlayerId).toBe('wr3')
    const [reed, bigsby] = s.options
    expect(reed).toMatchObject({ playerId: 'wr3', points: 11, inBestLineup: true, lineupIfStarted: 106 })
    expect(bigsby).toMatchObject({ playerId: 'rb3', points: 7, inBestLineup: false, lineupIfStarted: 102 })
    expect(s.delta).toBe(4)
    expect(s.unit).toBe('league_points_week')
    expect(s.week).toEqual(WEEK)
  })

  /*
   * 🛑 THE REASON THIS KIND DOES NOT USE THE AF PER-GAME FIGURE. That figure is full PPR in every
   * league. Same two component lines, two rulebooks, two different answers.
   */
  it("answers under THIS league's rules — a half-PPR league flips a full-PPR answer", async () => {
    lines = { ...BASE_LINES, wr3: { rec: 6, rec_yd: 50 }, rb3: yards(9) }
    expect(ready(await startSit('Start Jayden Reed or Tank Bigsby?')).startPlayerId).toBe('wr3') // 11 vs 9

    resolveWorld.mockResolvedValue(world({ scoring: { scoring_settings: HALF_PPR } }))
    const half = ready(await startSit('Start Jayden Reed or Tank Bigsby?'))
    expect(half.startPlayerId).toBe('rb3') // 8 vs 9
    expect(half.options.map((o) => o.points)).toEqual([8, 9])
  })

  it('hands the loader the unwrapped rulebook, the feed week and every active position', async () => {
    await startSit('Start Jayden Reed or Tank Bigsby?')
    const call = loadWeekLines.mock.calls[0]![0]
    expect(call.rules).toEqual(FULL_PPR)
    expect(call.week).toEqual(WEEK)
    expect(call.positions.get('te1')).toBe('TE')
  })

  it('🛑 never starts a player on injured reserve', async () => {
    const s = ready(await startSit('Should I start Jayden Reed or Tank Bigsby?'))
    // Chubb projects 30; counted, he would start at RB and lift every total.
    expect(s.options[0].lineupIfStarted).toBe(106)
    expect(loadWeekLines.mock.calls[0]![0].playerIds).not.toContain('rb-ir')
    expect(await startSit('Start Nick Chubb or Tank Bigsby?').then(unresolvedReason)).toBe('players_not_on_roster')
  })

  it('says when there is no real choice — both start', async () => {
    const s = ready(await startSit('Start Bijan Robinson or CeeDee Lamb?'))
    expect(s.contested).toBe(false)
    expect(s.startPlayerId).toBeNull()
    expect(s.delta).toBeNull()
    expect(s.options.every((o) => o.inBestLineup)).toBe(true)
  })

  /*
   * 🛑 "IF STARTED" MUST ACTUALLY START THEM. The best lineup without Shaheed starts Reed at FLEX and
   * scores 106 — it does not start Bigsby, so it cannot be "the lineup if Bigsby starts".
   */
  it('says when there is no real choice — neither starts — and still prices each one started', async () => {
    const s = ready(await startSit('Start Tank Bigsby or Rashid Shaheed?'))
    expect(s.contested).toBe(false)
    expect(s.options.every((o) => !o.inBestLineup)).toBe(true)
    expect(s.options.map((o) => o.lineupIfStarted)).toEqual([102, 103])
  })

  it('refuses a player no starting slot takes', async () => {
    expect(await startSit('Start Jayden Reed or Harrison Butker?').then(unresolvedReason)).toBe('no_starting_slot')
  })

  it('refuses a player on another roster, and a name matching nobody is not a question', async () => {
    expect(await startSit('Start Jayden Reed or Puka Nacua?').then(unresolvedReason)).toBe('players_not_on_roster')
    expect(await startSit('Start Joe Nobody or Jim Nobody?')).toBeNull()
  })

  it('refuses to compare a player this week has no line for', async () => {
    const { rb3: _dropped, ...rest } = BASE_LINES
    lines = rest
    const r = unresolved(await startSit('Start Jayden Reed or Tank Bigsby?'))
    expect(r.reason).toBe('unpriced_player')
    expect(r.detail).toContain('Tank Bigsby has no week 3 projection')
  })

  it('says which slot every total leaves out', async () => {
    resolveWorld.mockResolvedValue(world({ slots: [...SLOTS, 'DEF'] }))
    const s = ready(await startSit('Start Jayden Reed or Tank Bigsby?'))
    expect(s.unfilledSlots).toEqual(['DEF'])
    expect(renderStartSitScenarioBlock(s)).toContain('Every total leaves out DEF')
  })

  it('refuses without lineup slots, or with unknown slots', async () => {
    resolveWorld.mockResolvedValue(world({ slots: null }))
    expect(await startSit('Start Jayden Reed or Tank Bigsby?').then(unresolvedReason)).toBe('unknown_slots')
    resolveWorld.mockResolvedValue(world({ slots: [...SLOTS, 'MYSTERY_FLEX'] }))
    expect(await startSit('Start Jayden Reed or Tank Bigsby?').then(unresolvedReason)).toBe('unknown_slots')
  })

  /*
   * 🛑 THE USER'S DECISION: REFUSE, NEVER A GENERIC NUMBER UNDER A "YOUR LEAGUE" LABEL.
   */
  it('refuses a league with no rulebook, a non-NFL league, a missing feed week, and a roster nothing prices', async () => {
    resolveWorld.mockResolvedValue(world({ scoring: null }))
    const noRules = unresolved(await startSit('Start Jayden Reed or Tank Bigsby?'))
    expect(noRules.reason).toBe('no_scoring_rules')
    expect(noRules.detail).toContain('a generic projection would not be yours')
    // Metadata with an empty rulebook is not a rulebook.
    resolveWorld.mockResolvedValue(world({ scoring: { scoring_settings: { rules: {}, preset: 'custom' } } }))
    expect(await startSit('Start Jayden Reed or Tank Bigsby?').then(unresolvedReason)).toBe('no_scoring_rules')
    resolveWorld.mockResolvedValue(world({ sport: 'NBA' }))
    expect(await startSit('Start Jayden Reed or Tank Bigsby?').then(unresolvedReason)).toBe('sport_not_supported')
    expect(loadWeekLines).not.toHaveBeenCalled()

    resolveWorld.mockResolvedValue(world())
    latestWeek.mockResolvedValue(null)
    expect(await startSit('Start Jayden Reed or Tank Bigsby?').then(unresolvedReason)).toBe('no_projection_week')
    latestWeek.mockResolvedValue(WEEK)
    lines = {}
    expect(await startSit('Start Jayden Reed or Tank Bigsby?').then(unresolvedReason)).toBe('no_league_projections')
  })

  it('does not load the league for a question that is not start/sit, or names three of yours', async () => {
    expect(await startSit('How is Jayden Reed and Tank Bigsby doing?')).toBeNull()
    expect(resolveWorld).not.toHaveBeenCalled()
    expect(await startSit('Start Jayden Reed, Tank Bigsby or Rashid Shaheed?')).toBeNull()
  })

  it('refuses without a claimed team', async () => {
    expect(await startSit('Start Jayden Reed or Tank Bigsby?', 'stranger').then(unresolvedReason)).toBe('no_viewer_roster')
  })
})

describe('waiver add/drop', () => {
  it('prices the add against the drop, for this week', async () => {
    const s = ready(await waiver('Should I add Rashod Bateman and drop Tank Bigsby?'))
    expect(s.add).toMatchObject({ playerId: 'sl-bateman', points: 14 })
    expect(s.drop).toMatchObject({ playerId: 'rb3', points: 7 })
    // Bateman takes a WR slot, Wilson moves to FLEX: 22+18+16+17+14+10+12 = 109.
    expect(s.lineup).toEqual({ before: 106, after: 109, delta: 3, unit: 'league_points_week' })
    expect(s.week).toEqual(WEEK)
    expect(s.source).toBe('named')
    expect(s.rosterRoomUnchecked).toBe(false)
    expect(s.unfilledSlots).toEqual([])
  })

  it("prices the free agent with the roster, under the league's rules, with its own position", async () => {
    await waiver('Add Rashod Bateman?')
    const call = loadWeekLines.mock.calls[0]![0]
    expect(call.playerIds).toContain('sl-bateman')
    expect(call.positions.get('sl-bateman')).toBe('WR')
    expect(call.rules).toEqual(FULL_PPR)
    expect(findWeekPlayersByName).toHaveBeenCalledWith({ week: WEEK, name: 'Rashod Bateman' })
  })

  it('reads "drop Y for X" as dropping Y', async () => {
    const s = ready(await waiver('Drop CeeDee Lamb for Rashod Bateman'))
    expect(s.drop?.playerId).toBe('wr1')
    expect(s.lineup?.after).toBe(103)
    expect(s.lineup?.delta).toBe(-3)
  })

  it('says roster room was not checked when no drop is named', async () => {
    const s = ready(await waiver('Add Rashod Bateman?'))
    expect(s.drop).toBeNull()
    expect(s.rosterRoomUnchecked).toBe(true)
    expect(s.lineup?.delta).toBe(3)
  })

  it('dropping a reserved player changes no lineup', async () => {
    const s = ready(await waiver('Add Rashod Bateman and drop Nick Chubb'))
    expect(s.drop?.playerId).toBe('rb-ir')
    expect(s.lineup?.delta).toBe(3)
  })

  it('refuses a rostered add (by name or by id), an unknown add, an ambiguous add, and a drop not on your roster', async () => {
    expect(await waiver('Add Puka Nacua?').then(unresolvedReason)).toBe('add_rostered')
    findWeekPlayersByName.mockResolvedValueOnce({ players: [{ playerId: 'wr9', name: 'Pooka Nacua', position: 'WR' }], complete: true })
    expect(await waiver('Add Pooka Nacua?').then(unresolvedReason)).toBe('add_rostered')
    expect(await waiver('Add Joe Nobody?').then(unresolvedReason)).toBe('add_not_found')
    findWeekPlayersByName.mockResolvedValue({ players: [BATEMAN, { ...BATEMAN, playerId: 'sl-other' }], complete: true })
    expect(await waiver('Add Rashod Bateman?').then(unresolvedReason)).toBe('ambiguous_player')
    findWeekPlayersByName.mockResolvedValue({ players: [BATEMAN], complete: true })
    expect(await waiver('Add Rashod Bateman and drop Puka Nacua').then(unresolvedReason)).toBe('drop_not_on_roster')
  })

  it('does not call a partial search a finding', async () => {
    findWeekPlayersByName.mockResolvedValue({ players: [], complete: false })
    const r = unresolved(await waiver('Add Joe Nobody?'))
    expect(r.reason).toBe('add_not_found')
    expect(r.detail).toContain('could not be searched in full')
  })

  it('an unpriced add, or an unpriced active drop, is shown with the lineup marked not computed', async () => {
    const { 'sl-bateman': _fa, ...noFa } = BASE_LINES
    lines = noFa
    const s = ready(await waiver('Add Rashod Bateman?'))
    expect(s.add.points).toBeNull()
    expect(s.lineup).toBeNull()
    expect(s.lineupUnavailable).toBe("Rashod Bateman has no week 3 projection that this league's rules can score.")

    const { rb3: _drop, ...noDrop } = BASE_LINES
    lines = noDrop
    const d = ready(await waiver('Add Rashod Bateman and drop Tank Bigsby'))
    expect(d.lineup).toBeNull()
    expect(d.lineupUnavailable).toContain('Tank Bigsby has no week 3 projection')
  })

  it('refuses the same leagues start/sit refuses', async () => {
    resolveWorld.mockResolvedValue(world({ scoring: null }))
    expect(await waiver('Add Rashod Bateman?').then(unresolvedReason)).toBe('no_scoring_rules')
    resolveWorld.mockResolvedValue(world({ sport: 'MLB' }))
    expect(await waiver('Add Rashod Bateman?').then(unresolvedReason)).toBe('sport_not_supported')
    expect(findWeekPlayersByName).not.toHaveBeenCalled()
  })

  it("falls back to the engine's TOP claim when nobody is named, and says so", async () => {
    const s = ready(
      await waiver('Who should I pick up this week?', [
        { addPlayerName: 'Someone Else', dropPlayerName: null, priorityRank: 2, compositeScore: 60, faabBid: 3 },
        { addPlayerName: 'Rashod Bateman', dropPlayerName: 'Tank Bigsby', priorityRank: 1, compositeScore: 71, faabBid: 12 },
      ]),
    )
    expect(s.source).toBe('engine_top_claim')
    expect(s.add.playerId).toBe('sl-bateman')
    expect(s.drop?.playerId).toBe('rb3')
    expect(s.engine).toEqual({ compositeScore: 71, faabBid: 12 })
  })

  it('stays silent without a named add or engine claims, with two adds, or for a non-waiver question', async () => {
    expect(await waiver('Who should I pick up this week?')).toBeNull()
    expect(await waiver('Add Rashod Bateman or Jayden Reed?')).toBeNull()
    expect(await waiver('How is Rashod Bateman doing?')).toBeNull()
    expect(resolveWorld).not.toHaveBeenCalled()
  })
})

describe('parsing', () => {
  it('assigns names by the verb before them', () => {
    expect(parseWaiverMove('Should I add Rashod Bateman and drop Tank Bigsby?')).toEqual({
      add: ['Rashod Bateman'],
      drop: ['Tank Bigsby'],
    })
    expect(parseWaiverMove('Add Rashod Bateman for Tank Bigsby')).toEqual({ add: ['Add Rashod Bateman'], drop: ['Tank Bigsby'] })
    expect(parseWaiverMove('Drop Tank Bigsby for Rashod Bateman')).toEqual({ add: ['Rashod Bateman'], drop: ['Drop Tank Bigsby'] })
    expect(parseWaiverMove('Rashod Bateman looks good')).toEqual({ add: [], drop: [] })
  })

  it('recognises the two question shapes', () => {
    expect(looksLikeStartSit('Should I start Jayden Reed or Tank Bigsby?')).toBe(true)
    expect(looksLikeStartSit('Should I start Jayden Reed?')).toBe(false)
    expect(looksLikeWaiverMove('Who is the best waiver pickup?')).toBe(true)
    expect(looksLikeWaiverMove('Who wins tonight?')).toBe(false)
  })
})

describe('prompt blocks', () => {
  it('a start/sit block names the week and the rules, gives the numbers, and names what is not modelled', async () => {
    const block = renderStartSitScenarioBlock((await startSit('Start Jayden Reed or Tank Bigsby?'))!)
    expect(block).toContain("START/SIT SCENARIO (computed from this league's real roster, with week 3 projections scored under this league's own rules")
    expect(block).toContain('Jayden Reed (WR): 11.0 points in week 3 — IN your best lineup.')
    expect(block).toContain('Start Jayden Reed: your best lineup scores 106.0; starting Tank Bigsby instead scores 102.0 (-4.0).')
    expect(block).toMatch(/Not modelled: weather/)
    const both = renderStartSitScenarioBlock((await startSit('Start Bijan Robinson or CeeDee Lamb?'))!)
    expect(both).toContain('start both')
  })

  it('a waiver block gives the numbers, flags an unchecked roster, and says it is one week', async () => {
    const block = renderWaiverScenarioBlock((await waiver('Add Rashod Bateman?'))!)
    expect(block).toContain('Add: Rashod Bateman (WR), 14.0 points in week 3.')
    expect(block).toContain('whether the roster has room was NOT checked')
    expect(block).toContain('Starting lineup, week 3: 106.0 before, 109.0 after (+3.0)')
    expect(block).toContain('This is ONE week')
  })

  it('an unresolved block tells the model not to invent a comparison', async () => {
    const block = renderWaiverScenarioBlock((await waiver('Add Puka Nacua?'))!)
    expect(block).toMatch(/^WAIVER SCENARIO: NOT COMPUTED\./)
    expect(block).toContain('Do not present a before/after')
  })
})

describe('readReadyScenario', () => {
  it('passes well-formed ready scenarios of every kind, and treats no kind as a trade', async () => {
    const ss = ready(await startSit('Start Jayden Reed or Tank Bigsby?'))
    const wv = ready(await waiver('Add Rashod Bateman?'))
    expect(readReadyScenario(JSON.parse(JSON.stringify(ss)))).not.toBeNull()
    expect(readReadyScenario(JSON.parse(JSON.stringify(wv)))).not.toBeNull()
    expect(readReadyScenario({ status: 'ready', give: [{ playerId: 'a', name: 'A' }], get: [] })).not.toBeNull()
  })

  it('rejects anything half-shaped or unresolved', async () => {
    const wv = ready(await waiver('Add Rashod Bateman?'))
    const ss = ready(await startSit('Start Jayden Reed or Tank Bigsby?'))
    expect(readReadyScenario(null)).toBeNull()
    expect(readReadyScenario({ status: 'unresolved', kind: 'waiver' })).toBeNull()
    expect(readReadyScenario({ ...wv, add: { name: 'no id' } })).toBeNull()
    expect(readReadyScenario({ ...ss, options: [{ ...ss.options[0], points: 'x' }, ss.options[1]] })).toBeNull()
    // A kind this client does not know is refused, even when it carries a trade's fields.
    expect(readReadyScenario({ status: 'ready', kind: 'mystery', give: [{ playerId: 'a', name: 'A' }], get: [] })).toBeNull()
    // A card prints the playoff row's reason and the week — a ready shape without either would throw.
    const { playoffOdds: _odds, ...noOdds } = wv
    expect(readReadyScenario(noOdds)).toBeNull()
    const { week: _week, ...noWeek } = ss
    expect(readReadyScenario(noWeek)).toBeNull()
    expect(readReadyScenario({ status: 'ready', give: 'nope' })).toBeNull()
  })
})

describe('the cards', () => {
  it('renders a start/sit with its verdict, its week, both options and what is not modelled', async () => {
    const s = ready(await startSit('Start Jayden Reed or Tank Bigsby?')) as ReadyStartSitScenario
    render(<ChimmyScenarioCard scenario={s} />)
    const card = screen.getByTestId('chimmy-scenario')
    expect(card.getAttribute('data-kind')).toBe('start_sit')
    expect(card.textContent).toContain('Start / sit · Start Jayden Reed')
    expect(card.textContent).toContain('Wk 3 pts')
    expect(card.textContent).toContain('league pts, wk 3')
    expect(card.textContent).toContain('Tank Bigsby (RB)')
    expect(card.textContent).toContain('+4.0')
    expect(screen.getByTestId('chimmy-scenario-not-modelled').textContent).toContain("league’s scoring")
    expect(screen.queryByTestId('chimmy-scenario-unfilled')).toBeNull()
  })

  it('renders a waiver move as one week, and the engine note only when the engine proposed it', async () => {
    const s = ready(await waiver('Add Rashod Bateman?')) as ReadyWaiverScenario
    const { unmount } = render(<ChimmyScenarioCard scenario={s} />)
    const card = screen.getByTestId('chimmy-scenario')
    expect(card.getAttribute('data-kind')).toBe('waiver')
    expect(card.textContent).toContain('14.0 wk 3')
    expect(card.textContent).toContain('league pts, wk 3')
    expect(card.textContent).toContain('nobody named')
    expect(card.textContent).toContain('+3.0')
    expect(screen.getByTestId('chimmy-scenario-one-week').textContent).toContain('Week 3 only')
    expect(screen.getByTestId('chimmy-scenario-room')).toBeTruthy()
    expect(screen.queryByTestId('chimmy-scenario-engine')).toBeNull()
    unmount()

    render(<ChimmyScenarioCard scenario={{ ...s, source: 'engine_top_claim', engine: { compositeScore: 71, faabBid: 12 } }} />)
    expect(screen.getByTestId('chimmy-scenario-engine').textContent).toContain('score 71/100')
  })

  it('does not warn about roster room when a drop is named, and names an unfilled slot', async () => {
    resolveWorld.mockResolvedValue(world({ slots: [...SLOTS, 'DEF'] }))
    const s = ready(await waiver('Add Rashod Bateman and drop Tank Bigsby')) as ReadyWaiverScenario
    render(<ChimmyScenarioCard scenario={s} />)
    expect(screen.getByTestId('chimmy-scenario').textContent).toContain('Tank Bigsby (RB)')
    expect(screen.queryByTestId('chimmy-scenario-room')).toBeNull()
    expect(screen.getByTestId('chimmy-scenario-unfilled').textContent).toContain('Totals leave out DEF')
  })
})
