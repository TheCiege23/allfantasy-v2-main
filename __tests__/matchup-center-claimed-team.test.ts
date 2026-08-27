/**
 * A league that had just imported correctly reported "League not found."
 *
 * The first ESPN league ever imported landed clean — 10 teams, 10 rosters, the
 * right season and scoring — and the Matchup Center answered as though the
 * league did not exist. Two defects stacked:
 *
 *   1. The viewer's roster was matched on `Roster.platformUserId ===` the
 *      AllFantasy user id. On an imported league that column holds the
 *      PLATFORM's id, so the lookup can never match.
 *   2. Three different 404s — no league, no roster of yours, no opponent roster
 *      — all rendered as the same sentence.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

const SERVICE = read('server/services/matchupCenterService.ts')
const HANDLER = read('app/api/leagues/[leagueId]/matchup-center/handler.ts')

describe('⚠ platformUserId is the platform’s id, not ours', () => {
  it('resolves the viewer through the identity chain, not one equality', () => {
    expect(SERVICE).toContain('IS THE PLATFORM')
    expect(SERVICE).toContain('platformUserId: { in: identityIds }')
    expect(SERVICE).not.toContain('platformUserId: params.viewerUserId')
  })

  it('tries the claimed team first, because a claim is about THIS league', () => {
    // A linked platform id is an inference from an id space shared across every
    // league; a claim is explicit about one.
    const claim = SERVICE.indexOf('claimedByUserId: params.viewerUserId')
    const linked = SERVICE.indexOf('sleeperUserId: true')
    expect(claim).toBeGreaterThan(-1)
    expect(linked).toBeGreaterThan(claim)
  })

  it('keeps the native case working', () => {
    // The AF id itself is still in the set — that is the case that already
    // worked and must not regress.
    expect(SERVICE).toContain('new Set<string>([params.viewerUserId])')
  })
})

describe('⚠ three 404s are three different problems', () => {
  it('marks the no-claimed-team case with its own code', () => {
    expect(SERVICE).toContain("code: 'NO_CLAIMED_TEAM'")
    expect(SERVICE).toContain('A DISTINCT CODE')
  })

  it('tells the manager what to do instead of denying the league exists', () => {
    /*
     * The league is right there. They can fix this in one click, and never will
     * if the screen says the league does not exist.
     */
    expect(HANDLER).toContain('have not claimed a team in this league yet')
    expect(HANDLER).toContain('THREE DIFFERENT 404s USED TO SAY THE SAME THING')
  })

  it('still keeps the engine’s internal strings server-side', () => {
    // "Forbidden" and "Roster not found" are for logs, not for a manager.
    expect(HANDLER).toContain('out.code === ')
    expect(HANDLER).not.toContain("out.error")
  })

  it('leaves a genuinely missing league saying so', () => {
    expect(HANDLER).toContain("'League not found.'")
  })
})
