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
  it('never deletes a LeagueTeam or a Roster, through ANY client alias', () => {
    /*
     * ⚠ THE OLD VERSION WAS BOUND TO ONE ALIAS. It matched `prisma.leagueTeam.delete` and a bare
     * `deleteMany`, but a delete reached through an interactive-transaction client (`tx.`), a
     * destructured delegate, or `$executeRaw` carrying a DELETE would have sailed past — and this
     * file DOES use a transaction client elsewhere. Match the delegate regardless of receiver.
     */
    expect(APPLY_SRC).not.toMatch(/\.\s*leagueTeam\s*\.\s*delete(Many)?\s*\(/)
    expect(APPLY_SRC).not.toMatch(/\.\s*roster\s*\.\s*delete(Many)?\s*\(/)
    expect(APPLY_SRC).not.toMatch(/deleteMany/)
    expect(APPLY_SRC).not.toMatch(/\$executeRaw[\s\S]{0,200}DELETE/i)
  })

  it('archives an absent team by setting isOrphan, in code rather than in a comment', () => {
    /*
     * ⚠ A WHOLE-FILE PRESENCE CHECK IS SATISFIED BY A COMMENT. This file carries an 18-line block
     * comment immediately above the write, so matching the pattern anywhere proved nothing about
     * where — or whether — the update actually happens. Strip comments, then require the write to
     * sit inside the reconciliation loop.
     */
    const codeOnly = APPLY_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const loopStart = codeOnly.indexOf('for (const t of staleTeams)')
    expect(loopStart, 'reconciliation loop not found in stripped source').toBeGreaterThan(-1)
    const loopBody = codeOnly.slice(loopStart)
    expect(loopBody).toMatch(/leagueTeam\.update\(\{[\s\S]{0,200}data:\s*\{\s*isOrphan:\s*true\s*\}/)
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
    /*
     * ⚠ ASSERT THE ANCHOR WAS FOUND BEFORE SLICING. `indexOf` returns -1 when the loop is renamed
     * or removed, and `slice(-1)` yields the file's FINAL CHARACTER — so the negative assertion
     * below passed trivially and the "claimed and unclaimed alike" contract went unchecked.
     */
    const loopStart = APPLY_SRC.indexOf('for (const t of staleTeams)')
    expect(loopStart, 'reconciliation loop anchor not found — the assertion would be vacuous').toBeGreaterThan(-1)
    const loop = APPLY_SRC.slice(loopStart)
    expect(loop.length).toBeGreaterThan(200)
    expect(loop).not.toMatch(/claimedByUserId/)
  })

  it('archives only behind the authoritative gate', () => {
    /* An incomplete or partial response must never orphan an absent team. */
    expect(APPLY_SRC).toMatch(/const authoritative =/)
    expect(APPLY_SRC).toMatch(/currentRosters\?\.state === 'full'/)
    expect(APPLY_SRC).toMatch(/rosters\.every\(\(r\) => isAuthoritativeStatus\(r\.fetch_status\)\)/)
    /*
     * 🛑 CONTAINMENT, NOT TEXTUAL ORDER. The previous version asserted `loopIdx > gateIdx`, which
     * only says the loop appears LATER IN THE FILE than the gate — moving the archival loop OUT
     * of the `if (authoritative)` block, so it archives on every response including a partial one,
     * still satisfies that. It is the difference between "after" and "inside", and only the
     * second is the safety property.
     *
     * Brace-walk the gate block and assert the loop is genuinely within its extent.
     */
    const gateIdx = APPLY_SRC.indexOf('if (authoritative) {')
    const loopIdx = APPLY_SRC.indexOf('for (const t of staleTeams)')
    expect(gateIdx, 'authoritative gate not found — the assertion would be vacuous').toBeGreaterThan(-1)
    expect(loopIdx, 'reconciliation loop not found — the assertion would be vacuous').toBeGreaterThan(-1)

    const openBrace = APPLY_SRC.indexOf('{', gateIdx)
    let depth = 0
    let gateEnd = -1
    for (let i = openBrace; i < APPLY_SRC.length; i++) {
      const ch = APPLY_SRC[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          gateEnd = i
          break
        }
      }
    }
    expect(gateEnd, 'could not brace-match the authoritative gate').toBeGreaterThan(openBrace)
    expect(loopIdx).toBeGreaterThan(openBrace)
    expect(loopIdx, 'the archival loop is NOT inside the authoritative gate').toBeLessThan(gateEnd)
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
    /*
     * 🛑 THIS ASSERTION COULD NOT FAIL, AND THE CAUSE WAS CRLF. Measured on this checkout: the
     * file has 414 CR and 414 LF, and the end anchor was spelled with bare `\n`, so `indexOf`
     * returned -1 — `slice(start, -1)` then yielded 9185 of the file's 15609 characters, which
     * of course contain `isOrphan,`. The test passed regardless of what the update clause said.
     *
     * Both anchors are now newline-agnostic AND asserted to have been FOUND before the slice is
     * trusted. An anchor that stops matching must turn the test red, never make it vacuous.
     */
    const src = bootstrap.replace(/\r\n/g, '\n')
    const startIdx = src.indexOf('update: {')
    const endIdx = src.indexOf('isCoCommissioner: Boolean(r.is_co_commissioner),\n      },\n    })')
    expect(startIdx, 'update-clause start anchor not found — the assertion would be vacuous').toBeGreaterThan(-1)
    expect(endIdx, 'update-clause end anchor not found — the assertion would be vacuous').toBeGreaterThan(startIdx)

    const updateBlock = src.slice(startIdx, endIdx)
    /* A real bound, not most of the file. */
    expect(updateBlock.length).toBeLessThan(3000)
    expect(updateBlock).toMatch(/isOrphan,/)
  })
})

describe('active-team selection excludes current orphans', () => {
  const team = (id: string, isOrphan: boolean | null | undefined) => ({ id, isOrphan })

  it('treats only an explicit true as archived', () => {
    expect(isActiveTeam(team('a', false))).toBe(true)
    expect(isActiveTeam(team('b', true))).toBe(false)
  })

  it('treats NULL and UNDEFINED as ACTIVE — absent evidence never hides a live team', () => {
    /*
     * ⚠ NOT because the column is nullable. It is not: the init migration creates
     * `"isOrphan" BOOLEAN NOT NULL DEFAULT false` and no migration ever alters it. An earlier
     * version of this test cited "288 leagues carry NULLs", which was an attribution error —
     * 288 is this repo's count of COMMISSIONED LEAGUES, not of NULL rows.
     *
     * The case is real for a different reason: `TeamOrphanState` accepts
     * `boolean | null | undefined` because callers produce those — a Prisma `select` omitting
     * the column yields `undefined`, a `$queryRaw` row is hand-typed, a mapper may build a
     * partial object. Absent evidence of archival must mean ACTIVE, so a missing field shows a
     * live team rather than hiding one.
     */
    expect(isActiveTeam(team('c', null))).toBe(true)
    expect(isActiveTeam(team('d', undefined))).toBe(true)
    /* And a row that simply never selected the column. */
    expect(isActiveTeam({} as { isOrphan?: boolean | null })).toBe(true)
  })

  it('pins the committed DDL, so a future nullability change cannot pass unnoticed', () => {
    const initMigration = readFileSync(
      join(process.cwd(), 'prisma', 'migrations', '20260407024117_init', 'migration.sql'),
      'utf8',
    )
    expect(initMigration).toMatch(/"isOrphan" BOOLEAN NOT NULL DEFAULT false/)
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
