// @vitest-environment node
/**
 * 🛑 THE WAIVER SCORER'S POSITION FILTER WAS WRONG IN BOTH DIRECTIONS AT ONCE.
 *
 * `scoreWaiverCandidates` skipped `['K','DEF','LB','DL','DB','EDGE','IDP']` unconditionally, in
 * every league.
 *
 * Too aggressive: an IDP league starts linebackers every week, and `LB` was on that list, so the
 * defensive half of its lineup got no waiver advice at all.
 *
 * Too narrow, and this is the half that shipped WRONG advice rather than none: the wire is
 * normalised by `SportPlayerPoolResolver` (EDGE→DE, OLB/ILB/MLB→LB, SS/FS→S, NT→DT), so the
 * positions that actually reach the scorer are QB, RB, WR, TE, K, DST, DE, DT, LB, CB and S. Only
 * `K` and `LB` of those were ever on the list — `DE`, `DT`, `CB` and `S` were scored, ranked and
 * given a FAAB bid in redraft leagues that start no defenders at all.
 *
 * The rule under test: a position only some leagues start is scored only on POSITIVE EVIDENCE from
 * the league's own slots. Absence of evidence produces no recommendation, never a wrong one.
 */
import { describe, expect, it } from 'vitest'

import { suggestWaiverPickups } from '@/lib/waiver-ai-engine/suggest'
import {
  computeTeamNeeds,
  mapSlotToPositions,
  foldPosition,
  IDP_POSITIONS,
  TEAM_UNIT_POSITIONS,
} from '@/lib/waiver-engine/team-needs'
import type { WaiverAIServiceInput } from '@/lib/waiver-ai-engine'

const starter = (id: string, position: string, team: string, value: number) => ({
  id,
  name: id,
  position,
  team,
  slot: 'starter' as const,
  age: 26,
  value,
})
const bench = (id: string, position: string, team: string, value: number) => ({
  ...starter(id, position, team, value),
  slot: 'bench' as const,
})

/** A redraft league that starts nothing defensive. */
const OFFENSE_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN']

/**
 * The same league in an IDP format: one discrete slot per defensive group.
 *
 * ⚠ ONE SLOT PER STARTER ON THE ROSTER, DELIBERATELY. An extra slot with nobody in it is a real
 * unfilled need worth the whole league median, and it sorts ABOVE a filled-but-weak slot — which
 * is how the first draft of this fixture made the code look broken when it was the fixture that was.
 */
const IDP_SLOTS = [...OFFENSE_SLOTS, 'LB', 'DL', 'DB']

/* Every offensive slot filled, with one deliberately weak back so the wire RB has a slot to beat. */
const OFFENSE_ROSTER = [
  starter('my-qb', 'QB', 'BUF', 3200),
  starter('my-rb1', 'RB', 'DET', 2800),
  starter('my-rb2', 'RB', 'NYG', 700),
  starter('my-wr1', 'WR', 'MIA', 4100),
  starter('my-wr2', 'WR', 'CIN', 2900),
  starter('my-te', 'TE', 'KC', 2600),
  starter('my-flex', 'WR', 'LAR', 2500),
  bench('bench-wr', 'WR', 'CAR', 300),
  bench('bench-rb', 'RB', 'LV', 1100),
]

/*
 * The IDP roster starts a weak linebacker and carries a spare one, so a better wire LB has both a
 * slot to improve and a same-position body to drop.
 */
const IDP_ROSTER = [
  ...OFFENSE_ROSTER,
  starter('my-lb', 'LB', 'CHI', 600),
  starter('my-dl', 'DE', 'SF', 2000),
  starter('my-db', 'CB', 'NYJ', 1800),
  bench('bench-lb', 'LB', 'ATL', 400),
]

const RIVAL = (n: number, idp: boolean) => ({
  players: [
    starter(`r${n}-qb`, 'QB', 'DAL', 3000),
    starter(`r${n}-rb`, 'RB', 'DAL', 3400),
    starter(`r${n}-wr`, 'WR', 'DAL', 3600),
    starter(`r${n}-te`, 'TE', 'DAL', 2400),
    ...(idp
      ? [
          starter(`r${n}-lb`, 'LB', 'DAL', 2600),
          starter(`r${n}-dl`, 'DE', 'DAL', 2200),
          starter(`r${n}-db`, 'CB', 'DAL', 2100),
        ]
      : []),
  ],
})

const rosters = (mine: ReturnType<typeof starter>[], idp: boolean) => [
  { players: mine },
  ...Array.from({ length: 11 }, (_, i) => RIVAL(i + 1, idp)),
]

/* A wire carrying one of everything the normalised pool can actually emit. */
const WIRE = [
  { id: 'wire-rb', name: 'Waiver Back', position: 'RB', team: 'SEA', age: 24, value: 2600 },
  { id: 'wire-lb', name: 'Waiver Linebacker', position: 'LB', team: 'TEN', age: 25, value: 3000 },
  { id: 'wire-de', name: 'Waiver Edge', position: 'DE', team: 'HOU', age: 26, value: 2800 },
  { id: 'wire-cb', name: 'Waiver Corner', position: 'CB', team: 'GB', age: 24, value: 2400 },
  { id: 'wire-s', name: 'Waiver Safety', position: 'S', team: 'PHI', age: 27, value: 2300 },
  { id: 'wire-k', name: 'Waiver Kicker', position: 'K', team: 'BAL', age: 30, value: 2500 },
  { id: 'wire-dst', name: 'Waiver Defence', position: 'DST', team: 'CLE', age: null, value: 2500 },
]

function engineInput(idp: boolean, over: Partial<WaiverAIServiceInput> = {}): WaiverAIServiceInput {
  const roster = idp ? IDP_ROSTER : OFFENSE_ROSTER
  const rosterPositions = idp ? IDP_SLOTS : OFFENSE_SLOTS
  const allLeagueRosters = rosters(roster, idp)
  return {
    sport: 'NFL',
    leagueId: 'L1',
    leagueSettings: { numTeams: 12, isSF: false, isTEP: false, isDynasty: false, faabBudget: 100, faabRemaining: 60 },
    roster,
    rosterPositions,
    allLeagueRosters,
    currentWeek: 3,
    goal: 'balanced',
    maxResults: 12,
    availablePlayers: WIRE,
    /* Precomputed the way `loadWaiverPool` does it, which is where the slots become evidence. */
    teamNeeds: computeTeamNeeds(roster, rosterPositions, allLeagueRosters, 3),
    ...over,
  } as WaiverAIServiceInput
}

const positionsOf = (input: WaiverAIServiceInput) =>
  suggestWaiverPickups(input).suggestions.map((s) => s.position)

describe('mapSlotToPositions knows the defensive slots', () => {
  it('🛑 the discrete IDP slots are no longer unknown', () => {
    /* Each of these answered [] before, so the slot dropped out of the maths entirely. */
    expect(mapSlotToPositions('LB')).toContain('LB')
    expect(mapSlotToPositions('DL')).toEqual(expect.arrayContaining(['DE', 'DT']))
    expect(mapSlotToPositions('DB')).toEqual(expect.arrayContaining(['CB', 'S']))
  })

  it('an IDP_FLEX slot admits the spellings a real roster holds', () => {
    /* It used to answer ['LB','DL','DB'] — which no normalised Sleeper player ever matches. */
    const flex = mapSlotToPositions('IDP_FLEX')
    for (const pos of ['LB', 'DE', 'DT', 'CB', 'S']) expect(flex).toContain(pos)
  })

  it('folds the provider spellings a roster can carry against the slot it fills', () => {
    /* The wire is normalised; the roster side is not, so `OLB` must match an `LB` slot. */
    expect(mapSlotToPositions('LB')).toEqual(expect.arrayContaining(['OLB', 'ILB']))
    expect(mapSlotToPositions('DB')).toEqual(expect.arrayContaining(['SS', 'FS']))
  })

  it('a team defence matches whichever way the platform spells it', () => {
    expect(mapSlotToPositions('D/ST')).toContain('DEF')
    expect(mapSlotToPositions('DEF')).toContain('DST')
  })

  it('⚠ an unknown slot still answers [], so it can never widen what is recommended', () => {
    expect(mapSlotToPositions('WHATEVER')).toEqual([])
  })
})

describe('startablePositions is read from the league’s own slots', () => {
  it('a redraft offence-only league startables nothing defensive', () => {
    const needs = computeTeamNeeds(OFFENSE_ROSTER, OFFENSE_SLOTS, rosters(OFFENSE_ROSTER, false), 3)
    const startable = needs.startablePositions ?? []
    expect(startable).toEqual(expect.arrayContaining(['QB', 'RB', 'WR', 'TE']))
    for (const pos of [...IDP_POSITIONS]) expect(startable).not.toContain(pos)
  })

  it('an IDP league startables the positions its slots accept', () => {
    const needs = computeTeamNeeds(IDP_ROSTER, IDP_SLOTS, rosters(IDP_ROSTER, true), 3)
    const startable = needs.startablePositions ?? []
    for (const pos of ['LB', 'DE', 'DT', 'CB', 'S']) expect(startable).toContain(pos)
  })
})

describe('🛑 a league is offered only the positions it starts', () => {
  it('🛑 a redraft league is NOT offered an individual defender', () => {
    /*
     * THIS IS THE LIVE WRONG-ADVICE HALF. `DE`, `CB` and `S` were never on the old skip list, so
     * they were recommended here with a bid attached.
     */
    const got = positionsOf(engineInput(false))
    for (const pos of ['DE', 'DT', 'LB', 'CB', 'S']) expect(got).not.toContain(pos)
    /* The offence it should be recommending is still there, so this is not a blanket silence. */
    expect(got).toContain('RB')
  })

  it('🛑 an IDP league IS offered the linebacker it can start', () => {
    const got = positionsOf(engineInput(true))
    expect(got).toContain('LB')
    expect(got).toEqual(expect.arrayContaining(['DE', 'CB', 'S']))
  })

  it('names a same-position drop for the defender, which needs the asker’s own roster', () => {
    const top = suggestWaiverPickups(engineInput(true)).suggestions.find((s) => s.position === 'LB')
    expect(top?.playerName).toBe('Waiver Linebacker')
    /* The spare linebacker, not the cheapest body on the bench. */
    expect(top?.dropCandidate?.name).toBe('bench-lb')
  })

  it('attaches a FAAB bid inside the budget to the defensive add', () => {
    const top = suggestWaiverPickups(engineInput(true)).suggestions.find((s) => s.position === 'LB')
    expect(top?.faabBid ?? 0).toBeGreaterThan(0)
    expect(top?.faabBid ?? 0).toBeLessThanOrEqual(60)
  })

  it('🛑 a kicker and a team defence are refused even by a league that starts them', () => {
    /*
     * Not an oversight: every dimension is built from the market trade-value scale, and whole units
     * are not priced on it. These carry a value of 2500 here purely to prove the value gate is not
     * what is turning them away.
     */
    const withUnits = engineInput(true, {
      rosterPositions: [...IDP_SLOTS, 'K', 'DEF'],
      teamNeeds: computeTeamNeeds(IDP_ROSTER, [...IDP_SLOTS, 'K', 'DEF'], rosters(IDP_ROSTER, true), 3),
    })
    const got = positionsOf(withUnits)
    for (const pos of [...TEAM_UNIT_POSITIONS]) expect(got).not.toContain(pos)
  })

  it('🛑 no needs map means no defenders — the honest degrade, and the old behaviour exactly', () => {
    /* A caller that never computed the needs has supplied no evidence about this league. */
    const blind = engineInput(true, {
      teamNeeds: {
        weakestSlots: [],
        biggestNeed: null,
        byeWeekClusters: [],
        positionalDepth: [],
        dropCandidates: [],
      },
    })
    const got = positionsOf(blind)
    for (const pos of ['DE', 'DT', 'LB', 'CB', 'S']) expect(got).not.toContain(pos)
  })
})

describe('the defensive slots now reach the slot and depth maths', () => {
  it('a weak defensive starter registers as a weakest slot', () => {
    const needs = computeTeamNeeds(IDP_ROSTER, IDP_SLOTS, rosters(IDP_ROSTER, true), 3)
    const lb = needs.weakestSlots.find((s) => s.slot === 'LB')
    expect(lb).toBeTruthy()
    expect(lb?.currentPlayer).toBe('my-lb')
  })

  it('⚠ a filled defensive slot produces no phantom need worth the league median', () => {
    /*
     * The old IDP_FLEX mapping could not match a `CB`, so a filled slot read as empty and the gap
     * became the whole median. A well-stocked defence must register no need at all.
     */
    const stocked = [
      ...OFFENSE_ROSTER,
      starter('good-lb', 'LB', 'CHI', 4000),
      starter('good-dl', 'DE', 'SF', 4000),
      starter('good-db', 'CB', 'NYJ', 4000),
    ]
    const needs = computeTeamNeeds(stocked, IDP_SLOTS, rosters(stocked, true), 3)
    for (const slot of ['LB', 'DL', 'DB']) {
      expect(needs.weakestSlots.find((s) => s.slot === slot)).toBeUndefined()
    }
  })

  it('positional depth covers a rostered defensive position in an IDP league', () => {
    const needs = computeTeamNeeds(IDP_ROSTER, IDP_SLOTS, rosters(IDP_ROSTER, true), 3)
    expect(needs.positionalDepth.map((d) => d.position)).toEqual(expect.arrayContaining(['LB', 'DE', 'CB']))
  })

  it('and does not invent defensive depth rows for a league that starts none', () => {
    const needs = computeTeamNeeds(OFFENSE_ROSTER, OFFENSE_SLOTS, rosters(OFFENSE_ROSTER, false), 3)
    expect(needs.positionalDepth.map((d) => d.position).sort()).toEqual(['QB', 'RB', 'TE', 'WR'])
  })

  it('⚠ depth adds no row for a spelling nobody rosters, which would read as a hole', () => {
    /* `LB` startables ILB/OLB/MLB too; none is on a roster here, so none may appear. */
    const needs = computeTeamNeeds(IDP_ROSTER, IDP_SLOTS, rosters(IDP_ROSTER, true), 3)
    const seen = needs.positionalDepth.map((d) => d.position)
    for (const alias of ['ILB', 'OLB', 'MLB', 'DT', 'S', 'DL', 'DB']) expect(seen).not.toContain(alias)
  })
})
/**
 * 🛑 A BLOCKLIST COULD NOT HAVE CLOSED THIS, WHICH IS WHY THE RULE IS INVERTED.
 *
 * Measured against the real `SportsPlayer` table (24,179 NFL rows, on the test database):
 * positions are stored in at least three vocabularies — canonical (`LB`), provider aliases
 * (`OLB` 271, `SS` 187, `FS` 163, `ILB` 151, `NT` 104, `MLB` 8) and FULL WORDS from thesportsdb
 * (`Linebacker`, `Cornerback`, `Safety`, `Defensive End`; 2,076 rows, 582 carrying a sleeperId).
 *
 * And the full-word row is not a losing duplicate: `SportPlayerPoolResolver` dedupes on
 * `name|position|team`, so `Smith|LB|KC` and `Smith|Linebacker|KC` are different keys and BOTH
 * reach the wire, both priced off the same sleeperId. A filter naming `LB` turns away one spelling
 * of a man and recommends the other.
 */
describe('🛑 the spelling a provider happens to use cannot smuggle a player in', () => {
  const WORDY_WIRE = [
    { id: 'w-lb', name: 'Wordy Linebacker', position: 'Linebacker', team: 'TEN', age: 25, value: 3000 },
    { id: 'w-olb', name: 'Wordy Edge', position: 'Outside Linebacker', team: 'HOU', age: 26, value: 2900 },
    { id: 'w-cb', name: 'Wordy Corner', position: 'Cornerback', team: 'GB', age: 24, value: 2800 },
    { id: 'w-s', name: 'Wordy Safety', position: 'Safety', team: 'PHI', age: 27, value: 2700 },
    { id: 'w-de', name: 'Wordy End', position: 'Defensive End', team: 'SF', age: 28, value: 2600 },
    { id: 'w-k', name: 'Wordy Kicker', position: 'Kicker', team: 'BAL', age: 30, value: 2500 },
    { id: 'w-p', name: 'Wordy Punter', position: 'Punter', team: 'LV', age: 31, value: 2500 },
    { id: 'w-ol', name: 'Wordy Tackle', position: 'Offensive Lineman', team: 'DAL', age: 29, value: 2500 },
    { id: 'w-mgr', name: 'Wordy Manager', position: 'Manager', team: 'NYJ', age: null, value: 2500 },
    { id: 'w-rb', name: 'Wordy Back', position: 'Running Back', team: 'SEA', age: 24, value: 2600 },
  ]

  it('folds every spelling the table actually stores', () => {
    expect(foldPosition('Linebacker')).toBe('LB')
    expect(foldPosition('OUTSIDE LINEBACKER')).toBe('LB')
    expect(foldPosition('olb')).toBe('LB')
    expect(foldPosition('Defensive End')).toBe('DE')
    expect(foldPosition('Nose Tackle')).toBe('DT')
    expect(foldPosition('Safety')).toBe('S')
    expect(foldPosition('SS')).toBe('S')
    expect(foldPosition('Quarterback')).toBe('QB')
    expect(foldPosition('  Wide   Receiver ')).toBe('WR')
  })

  it('⚠ an unrecognised label folds to itself, never to a guess', () => {
    expect(foldPosition('CO-DRIVER')).toBe('CO-DRIVER')
    expect(foldPosition(null)).toBe('')
  })

  it('🛑 a redraft league is not offered the full-word copy of a defender', () => {
    const got = positionsOf(engineInput(false, { availablePlayers: WORDY_WIRE }))
    for (const pos of ['Linebacker', 'Outside Linebacker', 'Cornerback', 'Safety', 'Defensive End']) {
      expect(got).not.toContain(pos)
    }
    /* Still not silence: the back it CAN start is recommended, under its own spelling. */
    expect(got).toContain('Running Back')
  })

  it('🛑 an IDP league IS offered the full-word defender it can start', () => {
    const got = positionsOf(engineInput(true, { availablePlayers: WORDY_WIRE }))
    expect(got).toEqual(expect.arrayContaining(['Linebacker', 'Cornerback', 'Safety']))
  })

  it('🛑 a punter, a kicker, a lineman and a coach row are never recommended', () => {
    /* None is turned away by name — no slot in either league accepts any of them. */
    for (const idp of [false, true]) {
      const got = positionsOf(engineInput(idp, { availablePlayers: WORDY_WIRE }))
      for (const pos of ['Kicker', 'Punter', 'Offensive Lineman', 'Manager']) {
        expect(got).not.toContain(pos)
      }
    }
  })

  it('a fullback still fills a back or flex slot, so the rule does not turn one away', () => {
    expect(mapSlotToPositions('RB')).toContain('FB')
    expect(mapSlotToPositions('FLEX')).toContain('FB')
    const got = positionsOf(
      engineInput(false, {
        availablePlayers: [{ id: 'fb', name: 'Lead Back', position: 'Fullback', team: 'SF', age: 27, value: 2600 }],
      }),
    )
    expect(got).toContain('Fullback')
  })
})
