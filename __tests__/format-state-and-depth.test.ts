import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { depthRoleNote } from '@/lib/trade-intel/depthChartRole'

const NOTES = readFileSync(resolve(process.cwd(), 'lib/trade-intel/tradeContextNotes.ts'), 'utf8')
const STATE = readFileSync(resolve(process.cwd(), 'lib/trade-intel/formatState.ts'), 'utf8')
const DEPTH = readFileSync(resolve(process.cwd(), 'lib/trade-intel/depthChartRole.ts'), 'utf8')

/**
 * Three gaps the format notes had been NAMING rather than filling: Survivor
 * tribe membership, Pirate protections, and depth-chart role. Two of the three
 * turned out to need no new data at all.
 */

describe('⚠ Survivor tribe data existed all along', () => {
  it('reads SurvivorTribe and SurvivorTribeMember rather than declaring them missing', () => {
    /*
     * The tribemate-versus-rival distinction is the single largest factor in a
     * pre-merge Survivor trade. It was absent from the verdict because nothing
     * read a schema that was already there.
     */
    expect(STATE).toContain('prisma.survivorTribe')
    expect(STATE).toContain('members: { select: { rosterId: true } }')
    expect(NOTES).toContain('resolveTribeRelation(')
  })

  it('⚠ switches the cooperative logic OFF after the merge', () => {
    /*
     * A merged tribe contains both managers, so a naive membership check would
     * report "tribemate" and advise a losing trade in the one phase where every
     * point handed over works against you.
     */
    expect(STATE).toContain('AFTER THE MERGE THERE ARE NO TRIBEMATES')
    expect(STATE).toContain("relation: 'post-merge'")
  })

  it('still says the factor is missing when it cannot place both managers', () => {
    expect(NOTES).toContain('could not place both managers in a tribe')
  })

  it('resolves the counterparty roster through LeagueTeam, not by guessing ids', () => {
    // externalId is the platform's roster id; Roster is keyed on the owner.
    expect(NOTES).toContain('opponentRosterRowId')
    expect(NOTES).toContain('externalId: args.opponentTeamExternalId')
  })
})

describe('⚠ Pirate protections use a JSON column, not a migration', () => {
  it('reads Roster.settings rather than adding a table', () => {
    /*
     * That column already houses commissioner flags, and adding a table for a
     * house rule two leagues use would mean a production migration — which this
     * repo has a documented history of getting wrong.
     */
    expect(STATE).toContain('prisma.roster')
    expect(STATE).toContain('select: { settings: true }')
    expect(STATE).not.toContain('prisma.$executeRaw')
  })

  it('⚠ an ABSENT protection list is not an empty one', () => {
    /*
     * A roster with no key has not declared protections; one with [] has
     * declared none. The first must not produce "everything you own is exposed",
     * which is alarming and false for a manager who has not used the feature.
     */
    expect(STATE).toContain('AN ABSENT LIST IS NOT AN EMPTY ONE')
    expect(STATE).toContain('not the same as protecting nobody')
  })

  it('accepts more than one spelling of the key', () => {
    expect(STATE).toContain('protectedPlayerIds')
    expect(STATE).toContain('protectedPlayers')
  })

  it('⚠ unpriced roster players stay null in the exposure maths', () => {
    // Counting a null as zero would report a defender-heavy roster as having
    // nothing worth stealing.
    expect(NOTES).toContain('Unpriced roster players stay null, never zero')
  })

  it('loads roster prices only in the branch that needs them', () => {
    expect(NOTES).toContain('every other format would pay for a query it never')
  })
})

describe('depthRoleNote: speaks only when the role bears on the deal', () => {
  it('⚠ says nothing about a confirmed starter, because the price assumes it', () => {
    expect(
      depthRoleNote({
        playerName: 'A Back',
        role: { position: 'RB', rank: 1, listed: 3, role: 'starter', basis: 'x' },
      }),
    ).toBeNull()
  })

  it('⚠ says nothing when we hold no chart at all — that is not evidence', () => {
    /*
     * An empty table is "not ingested", and a repo-wide search finds readers but
     * no writer for depth_charts. Reporting a role we never loaded would be a
     * negative claim built on absence.
     */
    expect(
      depthRoleNote({
        playerName: 'A Back',
        role: { position: 'RB', rank: null, listed: 0, role: 'unlisted', basis: 'x' },
      }),
    ).toBeNull()
  })

  it('speaks for a backup, who is the case a trade actually turns on', () => {
    const n = depthRoleNote({
      playerName: 'A Back',
      role: { position: 'RB', rank: 2, listed: 4, role: 'backup', basis: 'one injury away' },
    })
    expect(n).toContain('A Back:')
    expect(n).toContain('one injury away')
  })
})

describe('⚠ what the depth chart cannot tell you, said out loud', () => {
  it('names that the chart carries position but not DIRECTION', () => {
    /*
     * "He just won the job" and "he has held it for three years" are the same
     * row. For a trade that is usually the question, and this layer cannot
     * answer it.
     */
    expect(DEPTH).toContain('POSITION, NOT DIRECTION')
    expect(DEPTH).toContain('cannot tell you whether he just won the job')
  })

  it('⚠ UNLISTED IS NOT BURIED', () => {
    /*
     * A missing player may be a rookie the chart has not caught, or a name our
     * matcher spelled differently. A confident negative built on a lookup miss
     * is the expensive direction to be wrong in.
     */
    expect(DEPTH).toContain('UNLISTED IS NOT BURIED')
    expect(DEPTH).toContain('this is not evidence against him')
  })

  it('admits the table may simply be empty', () => {
    expect(DEPTH).toContain('readers but no writer')
  })

  it('tries both a normalised name and an id, because the content varies', () => {
    expect(DEPTH).toContain('NAME MATCHING IS THE WEAK JOINT')
    expect(DEPTH).toContain('sleeperId')
  })
})
