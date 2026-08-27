import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * ⚠ THE JOIN THAT LOOKS RIGHT AND IS WRONG BY DESIGN.
 *
 * `lib/fantasy-os/sync/collector/applySleeperLeagueSync.ts` states the contract
 * in its own header, and `lib/sleeper-sync.ts` implements it as
 * `managerUserIds.get(ownerId) ?? ownerId`:
 *
 *   LeagueTeam.platformUserId          → RAW Sleeper manager id, always
 *   Roster.platformUserId              → AllFantasy AppUser id when the manager
 *                                        is LINKED, raw Sleeper id when not
 *   Roster.playerData.source_manager_id → raw Sleeper id, ALWAYS
 *
 * So `WHERE roster.platformUserId = leagueTeam.platformUserId` finds every
 * UNLINKED manager and silently misses every LINKED one.
 *
 * ⚠ IT ONLY BREAKS FOR *OTHER* MANAGERS, WHICH IS WHY IT SURVIVED. A lookup for
 * the signed-in user works by luck — their AF id is exactly what the roster is
 * keyed on. Every site found in the sweep was an OPPONENT lookup.
 *
 * ⚠ AND IT GETS WORSE AS MORE MANAGERS LINK ACCOUNTS, so a passing spot-check
 * today is not evidence. Measured on a real league: 11 of 12 rosters joined and
 * the twelfth looked like one broken row rather than a broken join.
 */

const ROOT = resolve(process.cwd())
const SCAN_DIRS = ['lib', 'app', 'server']

/** Files allowed to key a roster on a team's platformUserId, with the reason. */
const ALLOWED = new Set<string>([
  // The sync itself owns the contract and indexes rosters by canonical source
  // team id; its deleteMany fallback is deliberate and commented in place.
  'lib/fantasy-os/sync/collector/applySleeperLeagueSync.ts',
])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.next') || name === 'dist') continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/**
 * A roster query whose `platformUserId` comes from a team-shaped variable.
 * Deliberately narrow: assignments that merely copy the field into a DTO are not
 * the defect, only queries are.
 */
const NAIVE_JOIN =
  /roster\.(?:findFirst|findMany|findUnique|deleteMany|updateMany)\s*\(\s*\{\s*where:\s*\{[^{}]*platformUserId:\s*(?:team|lt|leagueTeam|t|oppTeam|opponentTeam|targetTeam)[A-Za-z]*\??\.platformUserId/

describe('nothing joins Roster to LeagueTeam on platformUserId', () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))

  it('the scan actually found source files', () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(500)
  })

  it('finds no naive roster/team join outside the sync that owns the contract', () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
      if (ALLOWED.has(rel)) continue
      let src: string
      try {
        src = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      if (NAIVE_JOIN.test(src)) offenders.push(rel)
    }

    expect(
      offenders,
      `These key a Roster lookup on LeagueTeam.platformUserId, which misses every manager with a linked AllFantasy account. Use findRosterForTeam from lib/leagues/rosterForTeam.ts, which joins on playerData.source_manager_id and falls back to platformUserId:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('the shared helper prefers the durable key and keeps a fallback', () => {
    const helper = readFileSync(resolve(ROOT, 'lib/leagues/rosterForTeam.ts'), 'utf8')
    expect(helper).toContain('source_manager_id')
    expect(helper).toMatch(/OR "platformUserId" =/)
  })

  /** The pattern must be able to fire, or the sweep proves nothing. */
  it('the detector matches a known-bad snippet', () => {
    const bad = `
      const roster = await prisma.roster.findFirst({
        where: { leagueId, platformUserId: team.platformUserId },
        select: { id: true },
      })`
    expect(NAIVE_JOIN.test(bad)).toBe(true)
  })

  it('and does not fire on merely copying the field into an object', () => {
    const fine = `const dto = { teamId: t.id, platformUserId: t.platformUserId ?? null }`
    expect(NAIVE_JOIN.test(fine)).toBe(false)
  })

  /**
   * ⚠ The first version of this detector scanned 300 characters after the query
   * and flagged a CORRECT lookup because an unrelated DTO ten lines later
   * mentioned the field. A guard that cries wolf gets muted, so it is scoped to
   * the `where` clause itself.
   */
  it('does not fire when the query is correct and a DTO nearby mentions the field', () => {
    const correct = `
      const roster = await prisma.roster.findFirst({
        where: { leagueId, platformUserId: args.userId },
        select: { playerData: true },
      })
      return { teamId: leagueTeam.id, platformUserId: leagueTeam.platformUserId ?? args.userId }`
    expect(NAIVE_JOIN.test(correct)).toBe(false)
  })
})
