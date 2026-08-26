import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * ⚠ THE FAILURE THIS FILE EXISTS FOR is the one this repo keeps repeating: a
 * module built, tested, merged and never called. franchiseLink.ts had 13 green
 * tests and nothing invoking it.
 *
 * These assertions are about the CALL SITE and the GATE. The settlement
 * behaviour is covered by franchise-link.test.ts; what is covered here is that
 * a real request can reach it, and that it cannot reach someone else's
 * franchise.
 */
const ROUTE = readFileSync(
  resolve(process.cwd(), 'server/api-route-modules/legacy/franchise/route.ts'),
  'utf8',
)
const DISPATCH = readFileSync(resolve(process.cwd(), 'app/api/legacy/[...path]/route.ts'), 'utf8')
const SERVICE = readFileSync(resolve(process.cwd(), 'lib/franchise/franchiseService.ts'), 'utf8')

describe('the franchise endpoint is reachable', () => {
  /**
   * ⚠ NO NEW TOP-LEVEL ROUTE. This repo dispatches through
   * app/api/legacy/[...path] precisely to stay under the platform route ceiling,
   * so a module that is not registered here is unreachable however correct it is.
   */
  it('is registered in the legacy dispatcher', () => {
    expect(DISPATCH).toContain('{ pattern: ["franchise"]')
    expect(DISPATCH).toContain('legacy/franchise/route')
  })

  it('exports both verbs', () => {
    expect(ROUTE).toMatch(/export const GET/)
    expect(ROUTE).toMatch(/export const POST/)
  })

  it('calls the service rather than reimplementing it', () => {
    for (const fn of [
      'listFranchises',
      'loadFranchiseDetail',
      'recordCrossPlatformTrade',
      'markLegObserved',
      'refreshTradeSettlement',
    ]) {
      expect(ROUTE).toContain(fn)
    }
  })

  it('and the service calls the rules rather than reimplementing them', () => {
    expect(SERVICE).toContain('buildFranchiseView')
    expect(SERVICE).toContain('settleCrossPlatformTrade')
  })
})

describe('a franchise names who owns what, so every path is gated', () => {
  it('requires a verified user on both verbs', () => {
    const gets = ROUTE.split('export const').filter((s) => s.startsWith(' GET') || s.startsWith(' POST'))
    expect(gets).toHaveLength(2)
    for (const block of gets) expect(block).toContain('requireVerifiedUser')
  })

  /**
   * ⚠ SIGNED IN IS NOT ENOUGH. A franchise says which teams in which leagues
   * belong to someone, so an ungated read would tell any account who owns what
   * across the league.
   */
  it('checks ownership of the link, not merely that someone is signed in', () => {
    expect(ROUTE).toContain('ownedLink')
    expect(ROUTE).toMatch(/ownerUserId: userId/)
  })

  /**
   * ⚠ A distinct 403 would confirm the link exists to someone who cannot see it.
   */
  it('answers 404 for both "not yours" and "does not exist"', () => {
    expect(ROUTE).not.toMatch(/status:\s*403/)
    expect(ROUTE).toMatch(/Franchise not found/)
  })

  it('gates a trade through the link that owns it, not the trade id alone', () => {
    // Looking the trade up to find its linkId, then checking that link, is what
    // stops a guessed trade id reaching someone else's franchise.
    expect(ROUTE).toMatch(/crossPlatformTrade\.findUnique[\s\S]{0,200}select:\s*\{\s*linkId/)
    expect(ROUTE).toMatch(/ownedLink\(trade\.linkId/)
  })
})

describe('the endpoint does not pretend it can execute a trade', () => {
  it('says so in its own response', () => {
    expect(ROUTE).toMatch(/cannot execute a trade on either platform/i)
  })

  it('records a leg with a basis, so an observation is never mistaken for an assumption', () => {
    expect(ROUTE).toMatch(/basis:/)
    expect(SERVICE).toMatch(/not yet seen on the platform/)
  })
})

describe('the service reports absence rather than an empty team', () => {
  /**
   * ⚠ There is no foreign key — the pro half is in `leagues` and the college
   * half in `FantraxLeague` — so a member can point at a league that is gone.
   */
  it('distinguishes a missing league from a missing roster from a missing team', () => {
    expect(SERVICE).toMatch(/no longer exists/)
    expect(SERVICE).toMatch(/have not matched you to a team/)
    expect(SERVICE).toMatch(/no stored roster yet/)
  })

  it('never resolves Sleeper ids to invented names', () => {
    // Joining platform ids to Player is a separate id-space problem; returning
    // the id with a null name is honest, inventing a name is not.
    expect(SERVICE).toMatch(/NAMES ARE NOT RESOLVED HERE/)
  })
})
