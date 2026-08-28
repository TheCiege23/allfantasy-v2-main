import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  leagueFind: vi.fn(),
  rosterFindMany: vi.fn(),
  valueFindMany: vi.fn(),
  fantasyCalc: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFind },
    roster: { findMany: h.rosterFindMany },
    allFantasyMarketPlayerValue: { findMany: h.valueFindMany },
  },
}))
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: h.fantasyCalc,
}))

import { buildAvailablePlayersContext } from '@/lib/chimmy/tools/availablePlayersTool'

const LEAGUE = 'l-1'
const USER = 'u-1'

/** Modelled on the real rows: Sleeper numeric ids in both spaces. */
function value(playerId: string, playerName: string, position: string, marketValue: number) {
  return { playerId, playerName, position, marketValue }
}

/** Mirrors the cached FantasyCalc shape: sleeperId lives on the nested identity. */
function fc(sleeperId: string, name: string, position: string, overallRank: number) {
  return { player: { sleeperId, name, position }, overallRank }
}

beforeEach(() => {
  vi.resetAllMocks()
  h.fantasyCalc.mockResolvedValue([])
  h.leagueFind.mockResolvedValue({ name: 'Beta 1 Zombie League', sport: 'NFL' })
  h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['9488', '9226'] } }])
  h.valueFindMany.mockResolvedValue([
    value('9488', 'Jaxon Smith-Njigba', 'Wide Receiver', 8163),
    value('9226', "De'Von Achane", 'RB', 7423),
    value('12527', 'Ashton Jeanty', 'RB', 7219),
  ])
})

describe('the pool is the league rosters subtracted from our value set', () => {
  it('lists only players nobody rosters', async () => {
    const out = await buildAvailablePlayersContext(LEAGUE, USER)

    expect(out).toContain('Ashton Jeanty')
    expect(out).not.toContain('Jaxon Smith-Njigba')
    expect(out).not.toContain('Achane')
  })

  it('counts the pool against the size of the value set', async () => {
    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toContain('1 of the 3 players we publish a value for')
  })

  /*
   * ⚠ EVERY TEAM'S ROSTER COUNTS, NOT THE READER'S. Subtracting only the user's
   * own players would report 19 other managers' rosters as free agents.
   */
  it('subtracts every roster in the league', async () => {
    h.rosterFindMany.mockResolvedValue([
      { playerData: { players: ['9488'] } },
      { playerData: { players: ['12527'] } },
    ])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).not.toContain('Ashton Jeanty')
    expect(h.rosterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: LEAGUE } }),
    )
  })

  /* Some imports store objects rather than bare ids; a miss here frees a rostered player. */
  it('reads object-shaped roster entries too', async () => {
    h.rosterFindMany.mockResolvedValue([
      { playerData: { players: [{ playerId: '12527' }, { player_id: '9488' }, { id: '9226' }] } },
    ])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toContain('Every one of the 3 players')
  })
})

describe('an empty result is not an empty answer', () => {
  /*
   * ⚠ MEASURED IN PRODUCTION: KBFL has 1 valued player available and World
   * Football League has 0. A 32-team league really has rostered every ranked
   * name, so this is the common case, not an edge case.
   */
  it('says the RANKED set is exhausted, not that the wire is bare', async () => {
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['9488', '9226', '12527'] } }])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/does NOT mean the waiver wire is empty/)
    expect(out).toContain('unranked players available')
  })

  /*
   * ⚠ NO ROSTERS MUST NOT SUBTRACT NOTHING. With an empty set every ranked
   * player comes back "available" — a complete, confident, wrong pickup board.
   */
  it('refuses when no rosters are stored', async () => {
    h.rosterFindMany.mockResolvedValue([])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/rosters have not synced/i)
    expect(out).not.toContain('Ashton Jeanty')
  })

  it('refuses when no values are published', async () => {
    h.valueFindMany.mockResolvedValue([])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/cannot rank/i)
  })

  /* Values are NFL-only; another sport would subtract NFL rosters from NFL values. */
  it('declines for a non-NFL league', async () => {
    h.leagueFind.mockResolvedValue({ name: 'Hoops', sport: 'NBA' })

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/only published for NFL/i)
    expect(h.valueFindMany).not.toHaveBeenCalled()
  })

  it('returns a sentence, never an empty string, with no league', async () => {
    const out = await buildAvailablePlayersContext('', USER)
    expect(out.length).toBeGreaterThan(20)
    expect(out).toMatch(/no league is selected/i)
  })
})

describe('the limits travel with the list', () => {
  /*
   * ⚠ THIS IS THE WHOLE POINT OF THE TOOL. `waiver_claims` holds 0 rows, so we
   * cannot see who is claimable. A bare ranked list reads as a pickup board and
   * the model will say "put a claim in" about availability we never checked.
   */
  it('separates unrostered from on-waivers', async () => {
    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/does NOT mean "on waivers"/)
    expect(out).toMatch(/do NOT state that anyone is claimable/i)
    expect(out).toMatch(/do NOT invent FAAB bids/i)
  })

  it('says the ranking is not the full pool', async () => {
    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/Never say a player is unavailable just because he is missing here/)
  })
})

describe('presentation', () => {
  /* The column mixes 'WR' with 'Wide Receiver' on adjacent rows. */
  it('normalises the two position spellings', async () => {
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: [] } }, { playerData: { players: ['1'] } }])
    h.valueFindMany.mockResolvedValue([
      value('9493', 'Puka Nacua', 'Wide Receiver', 8068),
      value('12527', 'Ashton Jeanty', 'RB', 7219),
    ])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toContain('Puka Nacua (WR)')
    expect(out).toContain('Ashton Jeanty (RB)')
    expect(out).not.toContain('Wide Receiver')
  })

  /*
   * ⚠ ONE PLAYER, SEVERAL ROWS. The unique key is [sport, leagueConcept,
   * playerId], so a player valued under both concepts would list twice.
   */
  it('shows a player once even with two league concepts', async () => {
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['9488'] } }])
    h.valueFindMany.mockResolvedValue([
      value('12527', 'Ashton Jeanty', 'RB', 7219),
      value('12527', 'Ashton Jeanty', 'RB', 6100),
    ])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out.match(/Ashton Jeanty/g)).toHaveLength(1)
    expect(out).toContain('value 7219')
  })

  it('caps the list and says how many more there are', async () => {
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['x'] } }])
    h.valueFindMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => value(`p${i}`, `Player ${i}`, 'RB', 1000 - i)),
    )

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toContain('+5 more ranked players available')
    expect(out).not.toContain('Player 15')
  })
})

describe('the values have a basis and the block names it', () => {
  /*
   * ⚠ ALL 165 PUBLISHED ROWS ARE `dynasty`. A dynasty value is what a player is
   * worth for YEARS. Handed to a redraft league as a pickup board it promotes
   * rookies over producers — Travis Hunter outranks a starting running back
   * because of seasons nobody has played yet.
   */
  it('names the concept the values come from', async () => {
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['9488'] } }])
    h.valueFindMany.mockResolvedValue([
      { ...value('12527', 'Ashton Jeanty', 'RB', 7219), leagueConcept: 'dynasty' },
    ])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toContain('These are dynasty values')
    expect(out).toMatch(/not a this-week start ranking/)
  })

  /* Read from the rows, so it stays true when redraft values ship. */
  it('reports both bases when both are published', async () => {
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['9488'] } }])
    h.valueFindMany.mockResolvedValue([
      { ...value('12527', 'Ashton Jeanty', 'RB', 7219), leagueConcept: 'dynasty' },
      { ...value('9493', 'Puka Nacua', 'WR', 7000), leagueConcept: 'redraft' },
    ])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/These are dynasty\/redraft values/)
  })
})

describe('a deep league falls back to the wider ranked set', () => {
  /*
   * ⚠ THE HOUSE SET RUNS OUT EXACTLY WHERE THE QUESTION MATTERS MOST. Measured
   * 2026-08-28: our 165 published values leave KBFL (32 teams) with ONE
   * available player and World Football League with NONE. "Our rankings are
   * exhausted" is true and useless. FantasyCalc's cached set is 474 deep and,
   * with picks excluded, leaves KBFL 14 and WFL 19.
   */
  beforeEach(() => {
    /* Every house-valued player rostered — the 32-team case. */
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['9488', '9226', '12527'] } }])
  })

  it('uses FantasyCalc when the house set is exhausted', async () => {
    h.fantasyCalc.mockResolvedValue([fc('4034', 'Nick Chubb', 'RB', 368), fc('9488', 'Rostered Guy', 'WR', 12)])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toContain('best FantasyCalc dynasty rank first')
    expect(out).toContain('Nick Chubb (RB, rank #368)')
    expect(out).not.toContain('Rostered Guy')
  })

  /*
   * ⚠ EXCLUDING PICKS IS NOT OPTIONAL. FantasyCalc ranks draft picks as
   * tradeable assets and they DOMINATE the top of the unrostered list — the
   * first four entries in all three leagues measured were "2026 Pick 1.01",
   * "2026 Pick 1.02", "2027 1st (Early)" and "2026 Pick 1.03". Offered as
   * waiver pickups those are nonsense, and confidently so.
   */
  it('never offers a draft pick as a pickup', async () => {
    h.fantasyCalc.mockResolvedValue([
      fc('DP_0_0', '2026 Pick 1.01', 'PICK', 1),
      fc('FP_2027_early_0', '2027 1st (Early)', 'PICK', 3),
      fc('4034', 'Nick Chubb', 'RB', 368),
    ])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).not.toContain('Pick 1.01')
    expect(out).not.toContain('2027 1st')
    expect(out).toContain('Nick Chubb')
    /* The pick must not be counted in the pool size either. */
    expect(out).toContain('1 of the 1 ranked players FantasyCalc covers')
  })

  it('ranks by overall rank, best first', async () => {
    h.fantasyCalc.mockResolvedValue([
      fc('a', 'Deep Guy', 'WR', 400),
      fc('b', 'Better Guy', 'RB', 120),
      fc('c', 'Middle Guy', 'TE', 250),
    ])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out.indexOf('Better Guy')).toBeLessThan(out.indexOf('Middle Guy'))
    expect(out.indexOf('Middle Guy')).toBeLessThan(out.indexOf('Deep Guy'))
  })

  /*
   * ⚠ TWO SCALES MUST NOT BE COMPARED. An AllFantasy market value and a
   * FantasyCalc rank are different measures; the block has to say so or a later
   * turn will rank one against the other.
   */
  it('names the source and warns against mixing scales', async () => {
    h.fantasyCalc.mockResolvedValue([fc('4034', 'Nick Chubb', 'RB', 368)])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/two different scales/i)
    expect(out).toContain('These are FantasyCalc dynasty values')
  })

  /* The caveats must survive the fallback — dropping them is worse than no fallback. */
  it('carries the same limits down the fallback path', async () => {
    h.fantasyCalc.mockResolvedValue([fc('4034', 'Nick Chubb', 'RB', 368)])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/does NOT mean "on waivers"/)
    expect(out).toMatch(/do NOT state that anyone is claimable/i)
  })

  it('keeps the exhausted message when FantasyCalc has nothing either', async () => {
    h.fantasyCalc.mockResolvedValue([])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/does NOT mean the waiver wire is empty/)
  })

  /* A vendor failure must not take the answer down with it. */
  it('survives a FantasyCalc failure', async () => {
    h.fantasyCalc.mockRejectedValue(new Error('upstream down'))

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/RANKED set is exhausted/)
  })
})

describe('the house set stays primary when it can answer', () => {
  /*
   * ⚠ THE FALLBACK IS FOR EXHAUSTION, NOT A REPLACEMENT. AllFantasy publishes
   * its own values and they are the house number; a shallow league gets them.
   */
  it('does not reach for FantasyCalc when the house set is deep enough', async () => {
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['x'] } }])
    h.valueFindMany.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => value(`p${i}`, `Player ${i}`, 'RB', 1000 - i)),
    )

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toContain('highest AllFantasy market value first')
    expect(h.fantasyCalc).not.toHaveBeenCalled()
  })
})

/*
 * ⚠ A FIXED DEFAULT PRODUCED A WRONG ANSWER IN PRODUCTION, not merely an
 * imprecise one. The first cut asked FantasyCalc for a superflex (2QB),
 * 12-team dynasty board for every league. Asked "who can I pick up in KBFL?",
 * Chimmy returned Haynes King, Cole Payton and Jameis Winston — three
 * quarterbacks in the top three — for a league whose roster positions start
 * ["QB","RB","WR","WR","TE","FLEX","FLEX","K",...]: ONE quarterback slot across
 * THIRTY-TWO teams. The caveat that shipped with it told the model to mention
 * the skew; the model did not, so the skew reached a user as a recommendation.
 *
 * These are the real production settings for the leagues measured.
 */
const KBFL = {
  name: 'KBFL',
  sport: 'NFL',
  isDynasty: true,
  scoring: 'PPR TEP',
  settings: {
    roster_positions: ['QB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DL', 'DL', 'LB', 'LB', 'DB', 'DB', 'IDP_FLEX', 'IDP_FLEX', 'BN'],
  },
  _count: { teams: 32 },
}
const ZOMBIE = {
  name: 'Beta 1 Zombie League',
  sport: 'NFL',
  isDynasty: false,
  scoring: 'PPR Superflex TEP',
  settings: { roster_positions: ['FLEX', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN'] },
  _count: { teams: 20 },
}

describe('the FantasyCalc board matches the league, not a default', () => {
  beforeEach(() => {
    /* Every house-valued player rostered, so the fallback runs. */
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['9488', '9226', '12527'] } }])
    h.fantasyCalc.mockResolvedValue([fc('4034', 'Nick Chubb', 'RB', 368)])
  })

  it('asks for a 1QB board for a 1QB league', async () => {
    h.leagueFind.mockResolvedValue(KBFL)

    await buildAvailablePlayersContext(LEAGUE, USER)
    expect(h.fantasyCalc).toHaveBeenCalledWith(expect.objectContaining({ numQbs: 1 }))
  })

  it('asks for a superflex board when SUPER_FLEX is a slot', async () => {
    h.leagueFind.mockResolvedValue(ZOMBIE)

    await buildAvailablePlayersContext(LEAGUE, USER)
    expect(h.fantasyCalc).toHaveBeenCalledWith(expect.objectContaining({ numQbs: 2 }))
  })

  /* Two QB slots is superflex even without the SUPER_FLEX spelling. */
  it('treats two listed QB slots as superflex', async () => {
    h.leagueFind.mockResolvedValue({ ...KBFL, settings: { roster_positions: ['QB', 'QB', 'RB', 'WR'] } })

    await buildAvailablePlayersContext(LEAGUE, USER)
    expect(h.fantasyCalc).toHaveBeenCalledWith(expect.objectContaining({ numQbs: 2 }))
  })

  /*
   * ⚠ FantasyCalc PUBLISHES A FIXED LADDER OF LEAGUE SIZES. KBFL has 32 teams
   * and no such board exists, so it clamps to the deepest rather than asking
   * for a key that cannot be served.
   */
  it('clamps an oversized league to the deepest published board', async () => {
    h.leagueFind.mockResolvedValue(KBFL)

    await buildAvailablePlayersContext(LEAGUE, USER)
    expect(h.fantasyCalc).toHaveBeenCalledWith(expect.objectContaining({ numTeams: 16 }))
  })

  it('rounds a normal league up to the next published size', async () => {
    h.leagueFind.mockResolvedValue({ ...ZOMBIE, _count: { teams: 11 } })

    await buildAvailablePlayersContext(LEAGUE, USER)
    expect(h.fantasyCalc).toHaveBeenCalledWith(expect.objectContaining({ numTeams: 12 }))
  })

  /* A redraft league must not be ranked on dynasty values. */
  it('carries isDynasty from the league row', async () => {
    h.leagueFind.mockResolvedValue(ZOMBIE)

    await buildAvailablePlayersContext(LEAGUE, USER)
    expect(h.fantasyCalc).toHaveBeenCalledWith(expect.objectContaining({ isDynasty: false }))
  })

  it.each([
    ['PPR TEP', 1],
    ['Half PPR', 0.5],
    ['Standard', 0],
  ])('reads ppr from scoring text %s', async (scoring, ppr) => {
    h.leagueFind.mockResolvedValue({ ...KBFL, scoring })

    await buildAvailablePlayersContext(LEAGUE, USER)
    expect(h.fantasyCalc).toHaveBeenCalledWith(expect.objectContaining({ ppr }))
  })

  it('names the board it actually used', async () => {
    h.leagueFind.mockResolvedValue(KBFL)

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/FantasyCalc.s 1QB, 16-team, full PPR dynasty board/)
    expect(out).toMatch(/matched to this league.s own roster settings/)
    expect(out).not.toMatch(/SUPERFLEX \(2QB\), 12-team dynasty baseline/)
  })
})

describe('a league with no roster positions keeps the honest caveat', () => {
  /*
   * ⚠ 22 OF 94 NFL LEAGUES CARRY NO `roster_positions`. There is genuinely no
   * basis to derive a board for those, so the default is used AND declared —
   * silently defaulting is what produced the KBFL answer.
   */
  beforeEach(() => {
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['9488', '9226', '12527'] } }])
    h.fantasyCalc.mockResolvedValue([fc('4034', 'Nick Chubb', 'RB', 368)])
  })

  it('falls back to the default and declares it', async () => {
    h.leagueFind.mockResolvedValue({ ...KBFL, settings: null })

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(h.fantasyCalc).toHaveBeenCalledWith({ isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 })
    expect(out).toMatch(/no roster positions on file/)
    expect(out).toMatch(/If it is a 1QB league/)
  })

  it('treats an empty positions array as no basis', async () => {
    h.leagueFind.mockResolvedValue({ ...KBFL, settings: { roster_positions: [] } })

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/no roster positions on file/)
  })
})

/*
 * ⚠ A CONCEPT MISMATCH IS A REASON TO SWITCH, NOT A REASON TO CAVEAT.
 *
 * Every one of our 165 published rows is `leagueConcept: 'dynasty'`, and Beta 1
 * Zombie League is `isDynasty: false` — a redraft league being handed long-term
 * asset values. The block already carried a sentence telling the model to
 * mention that. The KBFL answer proved a caveat the model may drop is not a
 * fix: it was told to flag a superflex skew and it did not.
 */
const REDRAFT_LEAGUE = {
  name: 'Beta 1 Zombie League',
  sport: 'NFL',
  isDynasty: false,
  scoring: 'PPR Superflex TEP',
  settings: { roster_positions: ['FLEX', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN'] },
  _count: { teams: 20 },
}
const DYNASTY_HOUSE_VALUES = [
  { ...value('12527', 'Ashton Jeanty', 'RB', 7219), leagueConcept: 'dynasty' },
  { ...value('9493', 'Puka Nacua', 'WR', 7000), leagueConcept: 'dynasty' },
  { ...value('9226', 'Devon Achane', 'RB', 6800), leagueConcept: 'dynasty' },
  { ...value('7564', 'Jamarr Chase', 'WR', 6700), leagueConcept: 'dynasty' },
  { ...value('9221', 'Jahmyr Gibbs', 'RB', 6600), leagueConcept: 'dynasty' },
  { ...value('9509', 'Bijan Robinson', 'RB', 6500), leagueConcept: 'dynasty' },
]

describe('a redraft league is not answered with dynasty values', () => {
  beforeEach(() => {
    h.leagueFind.mockResolvedValue(REDRAFT_LEAGUE)
    /* Only one player rostered, so the house set is DEEP — depth is not the reason to switch. */
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['12527'] } }])
    h.valueFindMany.mockResolvedValue(DYNASTY_HOUSE_VALUES)
    h.fantasyCalc.mockResolvedValue([fc('4034', 'Nick Chubb', 'RB', 40)])
  })

  it('switches to FantasyCalc even though the house set has plenty', async () => {
    const out = await buildAvailablePlayersContext(LEAGUE, USER)

    expect(out).toContain('best FantasyCalc dynasty rank first')
    expect(out).toContain('Nick Chubb')
    expect(out).not.toContain('Puka Nacua')
  })

  it('asks FantasyCalc for the REDRAFT board', async () => {
    await buildAvailablePlayersContext(LEAGUE, USER)
    expect(h.fantasyCalc).toHaveBeenCalledWith(expect.objectContaining({ isDynasty: false }))
  })

  it('says the mismatch is why it switched, not depth', async () => {
    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toMatch(/publishes dynasty values only, and this is a redraft league/)
    expect(out).not.toMatch(/so this list uses FantasyCalc.s deeper set/)
  })

  /*
   * ⚠ SWITCHING TO NOTHING IS WORSE THAN A MISMATCH. If the matching board has
   * no unrostered players, the house answer stands rather than vanishing.
   */
  it('keeps the house list when the matching board is empty', async () => {
    h.fantasyCalc.mockResolvedValue([])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toContain('highest AllFantasy market value first')
    expect(out).toContain('Puka Nacua')
  })
})

describe('a matching concept keeps the house values', () => {
  /* A dynasty league and dynasty house values agree — no reason to switch. */
  it('does not reach for FantasyCalc when the concepts line up', async () => {
    h.leagueFind.mockResolvedValue({ ...REDRAFT_LEAGUE, isDynasty: true })
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['12527'] } }])
    h.valueFindMany.mockResolvedValue(DYNASTY_HOUSE_VALUES)

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(out).toContain('highest AllFantasy market value first')
    expect(h.fantasyCalc).not.toHaveBeenCalled()
  })

  /*
   * ⚠ ROWS WITH NO CONCEPT MUST NOT LOOK LIKE A MISMATCH. `leagueConcept` is
   * nullable; treating an absent concept as "not dynasty" would send every
   * dynasty league to FantasyCalc for no reason.
   */
  it('treats an unlabelled house set as no mismatch', async () => {
    h.leagueFind.mockResolvedValue({ ...REDRAFT_LEAGUE, isDynasty: true })
    h.rosterFindMany.mockResolvedValue([{ playerData: { players: ['12527'] } }])
    h.valueFindMany.mockResolvedValue([
      value('9493', 'Puka Nacua', 'WR', 7000),
      value('9226', 'Devon Achane', 'RB', 6800),
      value('7564', 'Jamarr Chase', 'WR', 6700),
      value('9221', 'Jahmyr Gibbs', 'RB', 6600),
      value('9509', 'Bijan Robinson', 'RB', 6500),
    ])

    const out = await buildAvailablePlayersContext(LEAGUE, USER)
    expect(h.fantasyCalc).not.toHaveBeenCalled()
    expect(out).toContain('highest AllFantasy market value first')
  })
})
