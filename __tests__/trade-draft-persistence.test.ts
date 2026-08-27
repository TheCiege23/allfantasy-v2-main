/**
 * Drafts stop living in one browser.
 *
 * The Trade Center has saved drafts to `localStorage` since Phase 2, with the
 * banner saying so because that was the honest thing to ship without a
 * migration. It meant a deal built on a phone was not there on a laptop.
 *
 * `TradeDraft` is a real table now — and because the migration on this project
 * is applied by hand, every line below is about what happens when the account
 * copy is not reachable.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

const CENTER = read('components/core-app/screens/TradeCenter.tsx')
const ROUTE = read('app/api/league/trades-panel/route.ts')
const SCHEMA = read('prisma/schema.prisma')
const MIGRATION = read('prisma/migrations/20260826150000_trade_draft/migration.sql')

describe('⚠ one draft per manager per league', () => {
  it('is enforced by a unique constraint, not by convention', () => {
    // The constraint is what makes "save" idempotent instead of accumulating a
    // row per click.
    expect(SCHEMA).toContain('@@unique([userId, leagueId])')
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "TradeDraft_userId_leagueId_key"')
  })

  it('is replayable, because this project applies migrations by hand', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS "TradeDraft"')
  })

  it('says why the payload has no schema of its own', () => {
    /*
     * A draft is a scratchpad: nothing joins to it and nothing aggregates it.
     * Giving it a schema would mean a migration every time the builder learns a
     * new asset class — and idols, weapons and serums are already named in its
     * legend.
     */
    expect(MIGRATION).toContain('WHY `payload` IS UNSTRUCTURED')
  })
})

describe('⚠ a missing table is a null, not a 500', () => {
  it('swallows the read so the panel survives without the table', () => {
    // Letting the read throw would take the whole trades panel down over a
    // scratchpad.
    expect(ROUTE).toContain('A MISSING TABLE IS A NULL, NOT A 500')
    expect(ROUTE).toContain('.catch(() => null)')
  })

  it('returns the draft on every branch of the panel', () => {
    // Three branches — Sleeper, Yahoo, everything else. A branch that omitted it
    // would look to the client like "no draft" rather than "not asked".
    const responseKeys = ROUTE.split('\n').filter((l) => l.trim() === 'draft,')
    expect(responseKeys).toHaveLength(3)
  })

  it('reports a failed save as a failure, not as a save', () => {
    expect(ROUTE).toContain('Draft could not be saved to your account.')
    expect(ROUTE).toContain('status: 503')
  })
})

describe('⚠ saving an empty board clears, rather than storing nothing', () => {
  it('deletes the row instead of writing two empty arrays', () => {
    /*
     * A row holding two empty arrays restores as a deal with nothing in it,
     * which reads as "your draft was lost" rather than "there is no draft".
     */
    expect(ROUTE).toContain('if (give.length === 0 && get.length === 0)')
    expect(ROUTE).toContain('cleared: true')
  })

  it('caps what a scratchpad may become', () => {
    expect(ROUTE).toContain('give.slice(0, 24)')
  })
})

describe('⚠ no new API route for a scratchpad', () => {
  it('adds a method to the endpoint the screen already calls', () => {
    // The repo sits at the platform's route ceiling.
    expect(ROUTE).toContain('NO NEW API ROUTE')
    expect(ROUTE).toContain('export async function POST(req: NextRequest)')
  })

  it('gates the save the same way the read is gated', () => {
    // A draft belongs to a league the manager is actually in.
    expect(ROUTE).toContain('teams: { some: { claimedByUserId: userId } }')
  })
})

describe('⚠ the banner says which copy it got', () => {
  it('distinguishes the account, this device, and neither', () => {
    // "Saved" with no qualifier implies it will be on their phone later, and
    // half the time it would not be.
    expect(CENTER).toContain('Saved to your account')
    expect(CENTER).toContain('Saved on this device only')
    expect(CENTER).toContain('Nothing could store this draft')
  })

  it('names both places when a restore finds neither', () => {
    expect(CENTER).toContain('on your account or in this browser')
  })

  it('says where a restored draft came from', () => {
    expect(CENTER).toContain('restored from your account')
    expect(CENTER).toContain('restored from this browser')
  })
})

describe('⚠ the two copies, and which wins', () => {
  it('always writes both', () => {
    /*
     * Writing only to whichever succeeded would mean a manager who saved while
     * offline and then came back online silently loses the newer copy to a
     * stale server row.
     */
    expect(CENTER).toContain('BOTH ARE ALWAYS WRITTEN')
  })

  it('prefers the account on restore, and says why', () => {
    // The account copy is the one reachable from anywhere; preferring the
    // browser would strand a manager on one machine.
    expect(CENTER).toContain('THE ACCOUNT WINS WHEN BOTH EXIST')
  })

  it('still clears the verdict on restore', () => {
    // A restored deal has not been analysed.
    expect(CENTER).toContain('A restored deal is not an analysed one.')
  })
})
