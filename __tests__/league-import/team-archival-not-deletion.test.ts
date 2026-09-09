/**
 * Batch A.1 item 1 — a team absent from a complete response is ARCHIVED, never deleted.
 *
 * Reconciliation used to preserve a CLAIMED team (orphan-flag it) and hard-delete an UNCLAIMED
 * one along with its `Roster`. The asymmetry had no basis: absence from one response is evidence
 * about the roster feed, not about the value of the team's history — and the delete took
 * ownership, transactions, matchups, draft picks and every external identifier with it. It was
 * also the only way a `LeagueTeam` row could vanish under a foreign key, which is what blocked
 * the Milestone 19 deletion work.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isActiveTeam, selectActiveTeams, selectOrphanTeams } from '@/lib/league-import/activeTeams'

const APPLY_SRC = readFileSync(
  join(process.cwd(), 'lib', 'import-os', 'collector', 'applySleeperLeagueSync.ts'),
  'utf8',
)

describe('the reconciliation path contains no destructive call', () => {
  /*
   * A static assertion, deliberately. The behavioural cases below are pure, but the thing that
   * actually caused data loss was a single `prisma.*.delete` in this file — so the guard that
   * matters most is one that fails the moment a delete comes back, however it is reached.
   */
  it('never deletes a LeagueTeam or a Roster', () => {
    expect(APPLY_SRC).not.toMatch(/prisma\.leagueTeam\.delete/)
    expect(APPLY_SRC).not.toMatch(/prisma\.roster\.delete/)
    expect(APPLY_SRC).not.toMatch(/deleteMany/)
  })

  it('archives an absent team by setting isOrphan', () => {
    expect(APPLY_SRC).toMatch(/data:\s*\{\s*isOrphan:\s*true\s*\}/)
  })

  it('skips a team that is already archived, so reconciliation is idempotent', () => {
    /* Without this, every tick would rewrite the row and re-emit the note for no change. */
    expect(APPLY_SRC).toMatch(/if \(t\.isOrphan\) continue/)
  })

  it('treats claimed and unclaimed teams identically', () => {
    /*
     * The old branch read `if (t.claimedByUserId) { ...orphan... continue }` and fell through
     * to the delete. No claim-conditional may remain inside the reconciliation loop.
     */
    const loop = APPLY_SRC.slice(APPLY_SRC.indexOf('for (const t of staleTeams)'))
    expect(loop).not.toMatch(/claimedByUserId/)
  })

  it('archives only behind the authoritative gate', () => {
    /* An incomplete or partial response must never orphan an absent team. */
    expect(APPLY_SRC).toMatch(/const authoritative =/)
    expect(APPLY_SRC).toMatch(/currentRosters\?\.state === 'full'/)
    expect(APPLY_SRC).toMatch(/rosters\.every\(\(r\) => isAuthoritativeStatus\(r\.fetch_status\)\)/)
    /* And the loop is inside that gate. */
    const gateIdx = APPLY_SRC.indexOf('if (authoritative) {')
    const loopIdx = APPLY_SRC.indexOf('for (const t of staleTeams)')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(loopIdx).toBeGreaterThan(gateIdx)
  })
})

describe('a reappearing team is restored', () => {
  it('is un-archived by the bootstrap upsert, which always writes isOrphan', () => {
    /*
     * Restoration is not a separate code path — the bootstrap's `update` branch recomputes
     * `isOrphan` from the payload on every run, so a team present in the response is written
     * back with `isOrphan: false`. Pinned here because it is easy to "optimise" that field out
     * of the update clause and silently strand every archived team forever.
     */
    const bootstrap = readFileSync(
      join(
        process.cwd(),
        'lib',
        'league-import',
        'sleeper',
        'SleeperLeagueCreationBootstrapService.ts',
      ),
      'utf8',
    )
    const updateBlock = bootstrap.slice(bootstrap.indexOf('update: {'), bootstrap.indexOf('isCoCommissioner: Boolean(r.is_co_commissioner),\n      },\n    })'))
    expect(updateBlock).toMatch(/isOrphan,/)
  })
})

describe('active-team selection excludes current orphans', () => {
  const team = (id: string, isOrphan: boolean | null | undefined) => ({ id, isOrphan })

  it('treats only an explicit true as archived', () => {
    expect(isActiveTeam(team('a', false))).toBe(true)
    expect(isActiveTeam(team('b', true))).toBe(false)
  })

  it('treats NULL as ACTIVE, because the column is effectively three-state', () => {
    /*
     * 🛑 `isOrphan` is declared `Boolean @default(false)` but production carries NULLs for rows
     * predating the column. `rosterReads.ts` records that treating those as orphaned "would
     * report every league that predates the flag as entirely unclaimed... the loudest possible
     * way to be wrong about 288 leagues".
     */
    expect(isActiveTeam(team('c', null))).toBe(true)
    expect(isActiveTeam(team('d', undefined))).toBe(true)
  })

  it('partitions a mixed league correctly', () => {
    const teams = [team('a', false), team('b', true), team('c', null), team('d', true)]
    expect(selectActiveTeams(teams).map((t) => t.id)).toEqual(['a', 'c'])
    expect(selectOrphanTeams(teams).map((t) => t.id)).toEqual(['b', 'd'])
  })

  it('is stable when applied repeatedly', () => {
    const teams = [team('a', false), team('b', true)]
    expect(selectActiveTeams(selectActiveTeams(teams))).toEqual(selectActiveTeams(teams))
  })

  it('rejects a null team rather than counting it active', () => {
    expect(isActiveTeam(null)).toBe(false)
    expect(isActiveTeam(undefined)).toBe(false)
  })
})

describe('an archived team never shadows an active one in the Fantrax name map', () => {
  it('prefers the active team for a shared normalized name', () => {
    const src = readFileSync(
      join(process.cwd(), 'lib', 'import-os', 'collector', 'fantraxMatchupParity.ts'),
      'utf8',
    )
    /*
     * Before archival a vanished team was deleted and could never collide. Now it persists, and
     * `map.set` is last-writer-wins — so a stale row sharing a live team's name could capture
     * the label by query order and point this week's matchups at the wrong roster id.
     */
    expect(src).toMatch(/labelIsFromActiveTeam/)
    expect(src).toMatch(/if \(!active && labelIsFromActiveTeam\.has\(label\)\) continue/)
    /* Archived teams are still mapped — their historical matchups still need resolving. */
    expect(src).not.toMatch(/isOrphan:\s*false/)
  })
})
