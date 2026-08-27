/**
 * One unclaimed team emptied the entire value ledger for a league.
 *
 * `buildTradeContextNotes` resolved the viewer through
 * `LeagueTeam.claimedByUserId` and returned EMPTY on a miss — and EMPTY is not
 * "no leverage", it is no byes, no roster need, no league scale, no pick
 * outlook and no format rules. Claiming a team is a deliberate action a manager
 * may never have taken, so a linked-but-unclaimed league produced a blank page
 * of context with nothing on screen explaining it.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

const NOTES = read('lib/trade-intel/tradeContextNotes.ts')
const ROUTE = read('app/api/trade-value/analyze/route.ts')

describe('the viewer is resolved the way the rest of the league surfaces resolve them', () => {
  it('falls back to the linked Sleeper account when no team was claimed', () => {
    expect(NOTES).toContain('sleeperUserId: true')
    expect(NOTES).toContain('where: { leagueId, platformUserId: linked }')
  })

  it('tries the claim FIRST, because it is a statement about this league', () => {
    // A linked platform id is an inference from an id space shared across every
    // league; a claim is explicit about this one.
    const claim = NOTES.indexOf('claimedByUserId: userId')
    const linked = NOTES.indexOf("select: { sleeperUserId: true }")
    expect(claim).toBeGreaterThan(-1)
    expect(linked).toBeGreaterThan(-1)
    expect(claim).toBeLessThan(linked)
  })

  it('⚠ says what a missing claim actually costs, in the comment the next reader meets', () => {
    expect(NOTES).toContain('A CLAIMED TEAM IS NOT GUARANTEED')
  })
})

describe('⚠ a ledger that could not run is not a ledger that found nothing', () => {
  it('carries a reason back when the viewer could not be identified', () => {
    expect(NOTES).toContain('claim your team, or link the account you play on')
  })

  it('distinguishes an unsynced roster from an unidentified manager', () => {
    // Different problems: one is an action for them, the other is one for us.
    expect(NOTES).toContain('has not been synced yet')
  })

  it('surfaces it under what we could not see, rather than as a silent blank', () => {
    expect(ROUTE).toContain("dataGaps: [...(out.dataGaps ?? []), contextGap]")
  })

  it('⚠ does not invent a gap on the no-league or thrown-read paths', () => {
    /*
     * Neither is a fixable fact about the viewer. Naming a gap there would tell
     * a manager to go claim a team when that was never the problem.
     */
    expect(ROUTE).toContain('NO `contextGap` HERE, DELIBERATELY')
    expect(ROUTE).toContain('const EMPTY_CONTEXT: TradeContextNotes = {')
    const emptyBlock = ROUTE.slice(
      ROUTE.indexOf('const EMPTY_CONTEXT'),
      ROUTE.indexOf('const EMPTY_CONTEXT') + 400,
    )
    expect(emptyBlock).not.toContain('contextGap:')
  })

  it('keeps the gap out of the response body it was only used to build', () => {
    // `{ ...out, ...context }` would have spread it into the payload as noise.
    expect(ROUTE).toContain('const { contextGap, ...notes } = context')
    expect(ROUTE).toContain('{ ...analysis, ...notes }')
  })
})
