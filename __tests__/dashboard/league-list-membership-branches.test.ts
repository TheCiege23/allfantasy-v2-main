import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Structural guard: every membership OR in the dashboard league list must carry
 * ALL FOUR of the canonical branches from `lib/league-access.ts`.
 *
 * ⚠ WHY THIS LIST IS AN AUTHORIZATION SURFACE AND NOT JUST A MENU. The /core rail
 * is built from `getDashboardLeagueListForUser`, and `app/core/[[...screen]]/page.tsx`
 * gates `?league=` on the result — "a league query is also an authorization
 * boundary". A league missing from this query is therefore a league the user
 * cannot reach anywhere in /core, by a link or by hand.
 *
 * It shipped with three branches and omitted `Roster.platformUserId`, the branch
 * `lib/league-access.ts` calls the largest membership population (the
 * `source_manager_id` and name-match claim paths write ONLY `Roster`). Measured
 * read-only on `.env.test` 2026-09-16: 107 of 444 roster-backed memberships (24%),
 * across 105 users, were provable by that branch alone.
 *
 * ⚠ SOURCE-SCANNED, NOT BEHAVIOURAL, FOR THE SAME REASON
 * `league-membership-gate-convergence.test.ts` is: the query is issued through
 * `(prisma as any)`, so a missing or misspelled branch is invisible to the
 * typechecker AND to any in-memory prisma fake — a fake answers whatever it was
 * told to answer. The source is the only thing that states the predicate.
 */

const SOURCE = readFileSync(
  join(__dirname, '..', '..', 'lib', 'dashboard', 'get-dashboard-league-list.ts'),
  'utf8',
)

/** Each membership OR block, identified by the two branches that are never absent. */
function membershipOrBlocks(source: string): string[] {
  const blocks: string[] = []
  const re = /OR:\s*\[([\s\S]*?)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const body = m[1]
    if (body.includes('{ userId }') && body.includes('redraftMembers')) blocks.push(body)
  }
  return blocks
}

describe('dashboard league list — membership branches', () => {
  it('finds the membership OR sites at all (guards the matcher itself)', () => {
    // A matcher that silently finds nothing would make every assertion below vacuous.
    expect(membershipOrBlocks(SOURCE).length).toBeGreaterThanOrEqual(2)
  })

  it('every membership OR carries all four canonical branches', () => {
    for (const block of membershipOrBlocks(SOURCE)) {
      expect(block).toContain('{ userId }')
      expect(block).toContain('redraftMembers: { some: { userId } }')
      expect(block).toContain('teams: { some: { claimedByUserId: userId } }')
      // The one that was missing, and the reason this file exists.
      expect(block).toContain('rosters: { some: { platformUserId: userId } }')
    }
  })

  it('never gates on the nullable LeagueTeam.platformUserId', () => {
    // The trap `lib/league-access.ts` documents: that column is the PROVIDER's id,
    // populated for 1,044 rows of which 13 are real users.
    for (const block of membershipOrBlocks(SOURCE)) {
      expect(block).not.toContain('teams: { some: { platformUserId')
    }
  })
})
