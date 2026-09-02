/**
 * `get_player_value` — the tool that answers "what is X worth".
 *
 * The properties worth pinning are almost all about REFUSAL. A value tool that returns a plausible
 * number for a player it did not find is worse than one that returns nothing, because the reader
 * cannot tell the two apart — which is the failure `NO_LEAGUE` in `chimmyTools.ts` was written
 * after observing in production.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ valueFindMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { allFantasyMarketPlayerValue: { findMany: h.valueFindMany } },
}))

import { buildPlayerValueContext } from '@/lib/chimmy/tools/playerValueTool'

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  playerId: '9488',
  playerName: 'Ja\'Marr Chase',
  position: 'WR',
  team: 'CIN',
  marketValue: 9250,
  leagueConcept: 'dynasty',
  scoringFormat: 'ppr',
  confidence: 82,
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  h.valueFindMany.mockResolvedValue([row()])
})

describe('finding the player', () => {
  it('returns the value, the position and the scale', async () => {
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    expect(out).toMatch(/9,250/)
    expect(out).toMatch(/WR/)
    expect(out).toMatch(/CIN/)
    expect(out).toMatch(/0-10000/)
  })

  it('names the concept rather than presenting a bare number', async () => {
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    expect(out).toMatch(/dynasty/)
  })

  /*
   * The whole reason this goes through `normalizePlayerName` rather than a SQL `ILIKE`.
   * `canonicalName` strips apostrophes and periods and collapses adjacent single letters, so all
   * of these are the same player to the identity layer — and a user types whichever they type.
   */
  it('matches regardless of apostrophes, case and spacing', async () => {
    for (const typed of ["Ja'Marr Chase", 'JaMarr Chase', "ja'marr  chase", 'JA’MARR CHASE']) {
      const out = await buildPlayerValueContext({ playerName: typed })
      expect(out, `typed: ${typed}`).toMatch(/9,250/)
    }
  })

  it('matches a name written with periods and initials', async () => {
    h.valueFindMany.mockResolvedValue([row({ playerName: 'A.J. Brown', marketValue: 7100 })])
    for (const typed of ['A.J. Brown', 'AJ Brown', 'a j brown']) {
      const out = await buildPlayerValueContext({ playerName: typed })
      expect(out, `typed: ${typed}`).toMatch(/7,100/)
    }
  })

  /*
   * 🛑 A KNOWN AND DELIBERATE LIMITATION, PINNED SO IT CANNOT DRIFT SILENTLY.
   *
   * `canonicalName` KEEPS generational suffixes on purpose — it is what stops Marvin Harrison Jr.
   * collapsing into his father. The cost is that a user typing the bare surname gets a miss rather
   * than a guess. That is the right trade for an identity layer (a wrong player is worse than no
   * player) but it IS a real miss, and the refusal text has to be good enough to survive it —
   * which is why it suggests checking the spelling.
   */
  it('does NOT match across a generational suffix', async () => {
    h.valueFindMany.mockResolvedValue([row({ playerName: 'Marvin Harrison Jr.' })])
    const hit = await buildPlayerValueContext({ playerName: 'Marvin Harrison Jr' })
    expect(hit).toMatch(/9,250/)

    const miss = await buildPlayerValueContext({ playerName: 'Marvin Harrison' })
    expect(miss).toMatch(/NO PUBLISHED ALLFANTASY VALUE ROW MATCHED/)
    expect(miss).toMatch(/spelling/)
  })
})

describe('🛑 refusing without inviting a fabrication', () => {
  it('a miss forbids the "player is worthless" paraphrase and forbids inventing a number', async () => {
    const out = await buildPlayerValueContext({ playerName: 'Some Backup Tight End' })
    expect(out).toMatch(/NO PUBLISHED ALLFANTASY VALUE ROW MATCHED/)
    expect(out).toMatch(/NOT a finding that the player is worthless/)
    expect(out).toMatch(/must NOT substitute a number from general/i)
    // It must name what was asked, so the model cannot answer about a different player.
    expect(out).toMatch(/Some Backup Tight End/)
  })

  it('an EMPTY TABLE is a different refusal from a missing player', async () => {
    /*
     * These must not collapse into one sentence. "We have no values at all" and "we have values
     * and none is his" are different facts, and only the second says anything about the player.
     */
    h.valueFindMany.mockResolvedValue([])
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    expect(out).toMatch(/NO PUBLISHED ALLFANTASY VALUES ARE ON FILE AT ALL/)
    expect(out).toMatch(/NOT a finding about this player/)
    expect(out).not.toMatch(/worthless/)
  })

  it('a database failure reads as "could not look", never as a miss', async () => {
    // The query is `.catch(() => [])`, so a throw lands on the empty-table path — which says
    // nothing was looked up, rather than that the player was not found.
    h.valueFindMany.mockRejectedValue(new Error('connection refused'))
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    expect(out).toMatch(/NOTHING COULD BE LOOKED UP|ARE ON FILE AT ALL/i)
    expect(out).not.toMatch(/NO PUBLISHED ALLFANTASY VALUE ROW MATCHED/)
  })

  it('an empty name asks which player rather than looking up nothing', async () => {
    for (const empty of ['', '   ']) {
      const out = await buildPlayerValueContext({ playerName: empty })
      expect(out).toMatch(/No player name was given/)
    }
    // And it must not have hit the database to find that out.
    expect(h.valueFindMany).not.toHaveBeenCalled()
  })
})

describe('🛑 one player, several concepts', () => {
  it('reports every concept and forbids averaging them', async () => {
    h.valueFindMany.mockResolvedValue([
      row({ leagueConcept: 'dynasty', marketValue: 9250 }),
      row({ leagueConcept: 'redraft', marketValue: 6100 }),
    ])
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    expect(out).toMatch(/dynasty/)
    expect(out).toMatch(/redraft/)
    expect(out).toMatch(/9,250/)
    expect(out).toMatch(/6,100/)
    expect(out).toMatch(/not alternatives to average/i)
  })

  /*
   * ⚠ THE CONCEPT IS READ OFF THE ROWS, NEVER ASSERTED — because the repo disagrees with itself
   * about which one is populated. Two comments in `availablePlayersTool.ts` say "Only `redraft` is
   * populated today" and "EVERY PUBLISHED ROW IS `dynasty` TODAY". This tool is correct under
   * either, and this test is what proves that rather than trusting the claim.
   */
  it('is correct whichever concept happens to be populated', async () => {
    for (const concept of ['redraft', 'dynasty', 'guillotine']) {
      h.valueFindMany.mockResolvedValue([row({ leagueConcept: concept })])
      const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
      expect(out, concept).toMatch(new RegExp(concept))
      expect(out, concept).toMatch(/Only the .* value is published/)
    }
  })

  it('a single concept must not be presented as covering other formats', async () => {
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    expect(out).toMatch(/Do NOT present it as a value for any other format/)
  })
})

describe('what the number is not', () => {
  it('says it is trade value, not a weekly projection or a start/sit ranking', async () => {
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    expect(out).toMatch(/NOT a projection/)
    expect(out).toMatch(/start\/sit/)
  })

  it('forbids comparison against other sites\' scales', async () => {
    const out = await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    expect(out).toMatch(/never to KeepTradeCut/i)
  })

  it('🛑 queries only PUBLISHED NFL rows', async () => {
    /*
     * Unpublished rows are working state, and the table holds NFL assets — running this for
     * another sport would return NFL values under a question about somebody else's league.
     */
    await buildPlayerValueContext({ playerName: "Ja'Marr Chase" })
    const where = h.valueFindMany.mock.calls[0]?.[0]?.where
    expect(where).toEqual({ published: true, sport: 'NFL' })
  })
})
