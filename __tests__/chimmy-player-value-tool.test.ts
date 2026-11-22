/**
 * `get_player_value` — the tool that answers "what is X worth".
 *
 * 🛑 IT QUOTES THE PLAYER CARD'S NUMBER (re-score 2026-11-17): `PlayerValueSnapshot`, on the league's own chart
 * (`valueBookFor`), read by the card's own `loadPlayerMarketValue`. It used to read the `AllFantasyMarketPlayerValue`
 * house table, so chat and the card could disagree about the same player.
 *
 * The other properties pinned are almost all about REFUSAL. A value tool that returns a plausible number for a
 * player it did not find is worse than one that returns nothing, because the reader cannot tell the two apart.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  latest: vi.fn(),
  capture: vi.fn(),
  league: vi.fn(),
  house: vi.fn(),
}))

/*
 * `findMany` serves two reads: the newest capture's roster (`capturedAt` in the where) and one player's history
 * (`sleeperId` in the where) — the card's delta read. Routed by shape so each test states only what it means.
 */
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerValueSnapshot: {
      findFirst: h.latest,
      findMany: (args: { where: Record<string, unknown> }) => (args.where.sleeperId ? h.capture(args) : h.capture.roster(args)),
    },
    league: { findUnique: h.league },
    allFantasyMarketPlayerValue: { findMany: h.house },
  },
}))

import { buildPlayerValueContext } from '@/lib/chimmy/tools/playerValueTool'

const NOW = new Date('2026-11-17T12:00:00.000Z')
const WEEK_AGO = new Date('2026-11-10T12:00:00.000Z')
type RosterRow = { sleeperId: string; name: string; position: string | null }
let roster: RosterRow[] = []
const history = (over: Partial<{ value: number }> = {}) => [
  { value: over.value ?? 9250, overallRank: 2, positionRank: 1, capturedAt: NOW, source: 'FANTASYCALC' },
  { value: 9100, overallRank: 3, positionRank: 1, capturedAt: WEEK_AGO, source: 'FANTASYCALC' },
]

beforeEach(() => {
  vi.resetAllMocks()
  roster = [{ sleeperId: '7564', name: "Ja'Marr Chase", position: 'WR' }]
  h.latest.mockResolvedValue({ capturedAt: NOW })
  ;(h.capture as unknown as { roster: (a: unknown) => Promise<RosterRow[]> }).roster = async () => roster
  h.capture.mockImplementation(async () => history())
  h.league.mockResolvedValue(null)
  h.house.mockResolvedValue([])
})

describe('🛑 the same number as the player card', () => {
  it('quotes value, ranks and the 7-day move, and says it is the card\'s number', async () => {
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    expect(out).toMatch(/9,250/)
    expect(out).toMatch(/#2 overall/)
    expect(out).toMatch(/#1 at his position/)
    expect(out).toMatch(/\+150 over 7 days/)
    expect(out).toMatch(/SAME number his player card shows/)
    expect(out).toMatch(/0-10000/)
  })

  it('prices on THIS league\'s chart: a redraft one-QB league reads the redraft one-QB book', async () => {
    h.league.mockResolvedValue({ sport: 'NFL', leagueType: 'redraft', settings: { roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX'] } })
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase", leagueId: 'lg1' })
    expect(h.latest.mock.calls[0]?.[0]?.where).toEqual({ source: 'FANTASYCALC', format: 'REDRAFT', qbFormat: 'ONE_QB' })
    expect(out).toMatch(/this league's chart \(redraft, one-QB\)/)
  })

  it('with no league, the card\'s cross-league chart — and it says so rather than calling it the league\'s', async () => {
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    expect(h.latest.mock.calls[0]?.[0]?.where).toEqual({ source: 'FANTASYCALC', format: 'DYNASTY', qbFormat: 'SUPERFLEX' })
    expect(out).toMatch(/cross-league chart/)
  })

  it('a non-NFL league does not lend its id to an NFL chart', async () => {
    h.league.mockResolvedValue({ sport: 'NBA', leagueType: 'redraft', settings: {} })
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase", leagueId: 'lg-nba' })
    expect(out).toMatch(/cross-league chart/)
  })

  it('the house trade-market value, when published, is a SECOND labelled measure — never the value', async () => {
    h.house.mockResolvedValue([{ playerName: "Ja'Marr Chase", marketValue: 8800, leagueConcept: 'dynasty', scoringFormat: 'ppr' }])
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    const chart = out.indexOf('9,250')
    const house = out.indexOf('8,800')
    expect(chart).toBeGreaterThan(-1)
    expect(house).toBeGreaterThan(chart)
    expect(out).toMatch(/DIFFERENT measure/)
  })
})

describe('finding the player', () => {
  /*
   * The whole reason this goes through `normalizePlayerName` rather than a SQL `ILIKE`: all of these are the same
   * player to the identity layer, and a user types whichever they type.
   */
  it('matches regardless of apostrophes, case and spacing', async () => {
    for (const typed of ["Ja'Marr Chase", 'JaMarr Chase', "ja'marr  chase", 'JA’MARR CHASE']) {
      const out = await buildPlayerValueContext({ playerName: typed })
      expect(out, `typed: ${typed}`).toMatch(/9,250/)
    }
  })

  it('matches a name written with periods and initials', async () => {
    roster = [{ sleeperId: '6794', name: 'A.J. Brown', position: 'WR' }]
    h.capture.mockImplementation(async () => history({ value: 7100 }))
    for (const typed of ['A.J. Brown', 'AJ Brown', 'a j brown']) {
      const out = await buildPlayerValueContext({ playerName: typed })
      expect(out, `typed: ${typed}`).toMatch(/7,100/)
    }
  })

  it('does NOT match across a generational suffix (a wrong player is worse than none)', async () => {
    roster = [{ sleeperId: '11632', name: 'Marvin Harrison Jr.', position: 'WR' }]
    expect(await buildPlayerValueContext({ playerName: 'Marvin Harrison Jr' })).toMatch(/9,250/)
    const miss = await buildPlayerValueContext({ playerName: 'Marvin Harrison' })
    expect(miss).toMatch(/NO MARKET VALUE IS ON FILE/)
    expect(miss).toMatch(/spelling/)
  })

  it('🛑 two priced players sharing a name: asks which, never picks one', async () => {
    roster = [
      { sleeperId: '1', name: 'Mike Williams', position: 'WR' },
      { sleeperId: '2', name: 'Mike Williams', position: 'TE' },
    ]
    const out = await buildPlayerValueContext({ playerName: 'Mike Williams' })
    expect(out).toMatch(/More than one player/)
    expect(out).toMatch(/Do NOT pick one/)
    expect(out).not.toMatch(/9,250/)
  })
})

describe('🛑 refusing without inviting a fabrication', () => {
  it('a miss forbids the "worthless" paraphrase and forbids inventing a number', async () => {
    const out = await buildPlayerValueContext({ playerName: 'Some Backup Tight End' })
    expect(out).toMatch(/NO MARKET VALUE IS ON FILE FOR "Some Backup Tight End"/)
    expect(out).toMatch(/NOT a finding that the player is worthless/)
    expect(out).toMatch(/must NOT substitute a number from general/i)
  })

  it('an unpriced position says WHY, and still refuses a number', async () => {
    roster = [{ sleeperId: '99', name: 'Kicker Guy', position: 'K' }]
    h.capture.mockImplementation(async () => [])
    const out = await buildPlayerValueContext({ playerName: 'Kicker Guy' })
    expect(out).toMatch(/no value for kickers or defenders/)
    expect(out).toMatch(/must NOT substitute/)
  })

  it('NO CAPTURE AT ALL is a different refusal from a missing player — and so is a failed read', async () => {
    for (const setup of [() => h.latest.mockResolvedValue(null), () => h.latest.mockRejectedValue(new Error('connection refused'))]) {
      setup()
      const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
      expect(out).toMatch(/NO MARKET VALUES ARE ON FILE AT ALL/)
      expect(out).toMatch(/NOT a finding about this player/)
      expect(out).not.toMatch(/worthless/)
    }
  })

  it('an empty name asks which player rather than looking up nothing', async () => {
    for (const empty of ['', '   ']) {
      expect(await buildPlayerValueContext({ playerName: empty })).toMatch(/No player name was given/)
    }
    expect(h.latest).not.toHaveBeenCalled()
  })
})

describe('what the number is not', () => {
  it('says it is trade value, not a weekly projection or a start/sit ranking, and forbids other sites\' scales', async () => {
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    expect(out).toMatch(/NOT a projection/)
    expect(out).toMatch(/start\/sit/)
    expect(out).toMatch(/never to KeepTradeCut/i)
  })
})
