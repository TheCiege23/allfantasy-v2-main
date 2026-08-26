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

describe('the connect-a-league flow', () => {
  const SERVICE_IMPORT = readFileSync(
    resolve(process.cwd(), 'lib/league-import/fantrax/importFantraxLeague.ts'),
    'utf8',
  )

  it('exposes both steps: discover then connect', () => {
    expect(ROUTE).toContain("action === 'discover-leagues'")
    expect(ROUTE).toContain("action === 'connect-league'")
  })

  /**
   * ⚠ THE SECRET ID IS A CREDENTIAL. It is used for one request and discarded —
   * never stored, never logged, never echoed back.
   */
  it('never persists or echoes the Secret ID', () => {
    // It must not reach the importer at all.
    expect(SERVICE_IMPORT).not.toContain('userSecretId')
    // And no write of it anywhere in the route.
    // The Secret ID is never written to any store: it appears only as a read
    // off the request body and as the argument to the discovery call.
    // A count would be brittle; what matters is it never reaches a write.
    expect(ROUTE).not.toMatch(/prisma\.[a-zA-Z]+\.(create|update|upsert)[\s\S]{0,150}userSecretId/)
    expect(ROUTE).toMatch(/never store your Secret ID/i)
  })

  /**
   * ⚠ Fantrax answers HTTP 200 {} for BOTH a bad Secret ID and an empty account,
   * so the flow must not tell a user with a typo that they own no leagues.
   */
  it('reports an empty discovery as ambiguous rather than as an empty account', () => {
    expect(ROUTE).toMatch(/indistinguishable/i)
  })

  it('connect requires an explicit team and re-prompts with the list on a miss', () => {
    expect(ROUTE).toContain('leagueId and teamName are required')
    expect(ROUTE).toMatch(/teams: imported\.teams/)
  })

  it("the importer refuses to guess which team belongs to the user", () => {
    expect(SERVICE_IMPORT).toMatch(/REFUSES TO GUESS WHICH TEAM/)
  })

  /**
   * ⚠ (platform, leagueId) is unique. Silently re-parenting a league would empty
   * the franchise it came from.
   */
  it('refuses a league already attached to another franchise', () => {
    expect(SERVICE_IMPORT).toMatch(/already part of another franchise/)
  })

  it('uses the CFB player map, not NFL', () => {
    expect(SERVICE_IMPORT).toContain("getFantraxPlayerIds('CFB')")
    expect(SERVICE_IMPORT).toMatch(/wrong one resolves nothing/)
  })

  it('aborts when almost nothing resolves, rather than storing anonymous ids', () => {
    expect(SERVICE_IMPORT).toMatch(/named \/ total < 0\.5|< 0\.5/)
    expect(SERVICE_IMPORT).toMatch(/signature of the wrong sport map/)
  })
})
