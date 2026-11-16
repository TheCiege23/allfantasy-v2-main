// @vitest-environment node
/**
 * The commissioner routes ask one rule (lib/league/commissionerAccess.ts, 2026-11-16). This keeps them asking it:
 * a route under /api/commissioner/leagues that reaches for one of the old checks fails here.
 *
 * The old checks each answered a different question — `assertCommissioner` / `isCommissioner` /
 * `isOwnerOrLeagueCommissioner` refused every co-commissioner; `getLeagueRole` and an unscoped
 * `requireCommissionerRole` let every co-commissioner through whatever they were granted. Either way the head
 * commissioner's grant meant nothing.
 *
 * READ_ONLY lists the uses that only decide what a screen shows, never whether a write happens; each is named so an
 * addition is a visible decision.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = path.resolve(__dirname, '..', '..')
const OLD = String.raw`assertCommissioner\(|isOwnerOrLeagueCommissioner\(|[^.A-Za-z]isCommissioner\(|getLeagueRole\(|requireCommissionerRole\([^,()]+, [^,()]+\)|requireCommissionerOnly\(`

const READ_ONLY = new Set([
  // GET: the dues tracker shows members their own row; the write (PUT) asks for money.
  'app/api/commissioner/leagues/[leagueId]/dues/route.ts',
  // GET: the manager list; DELETE and PATCH ask the rule (a commissioner's seat is head-only).
  'app/api/commissioner/leagues/[leagueId]/managers/route.ts',
  // GET: any member may read the lock; `canEdit` comes from the rule.
  'app/api/commissioner/leagues/[leagueId]/settings-lock/route.ts',
  // GET: any commissioner may read (unscoped requireCommissionerRole is the view).
  'app/api/commissioner/leagues/[leagueId]/league-finder/route.ts',
  'app/api/commissioner/leagues/[leagueId]/weekly-checklist/route.ts',
])

function grep(pattern: string, where: string) {
  return spawnSync('git', ['grep', '-nE', pattern, '--', where], { cwd: repo, encoding: 'utf8' })
}

describe('commissioner routes ask the one rule', () => {
  it('no write under /api/commissioner/leagues uses an old commissioner check', () => {
    const res = grep(OLD, 'app/api/commissioner/leagues')
    // git grep: 0 = matches, 1 = none; anything else is not a verdict.
    expect([0, 1]).toContain(res.status)
    const offenders = res.stdout
      .split('\n')
      .filter(Boolean)
      .filter((line) => !/^[^:]+:\d+:\s*(\/\/|\*|import)/.test(line))
      .map((line) => line.split(':')[0]!)
      .filter((file) => !READ_ONLY.has(file))
    expect([...new Set(offenders)]).toEqual([])
  }, 30_000)

  it('positive control: the same pattern finds the old checks where they still live', () => {
    const res = grep(OLD, 'app/api/commissioner/leagues/[leagueId]/dues/route.ts')
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('getLeagueRole(')
  }, 30_000)

  it('the routes do ask the rule', () => {
    const res = grep(String.raw`commissionerAccessResponse\(|canCommissionerAct\(|commissionerAccess\(`, 'app/api/commissioner/leagues')
    expect(res.status).toBe(0)
    expect(res.stdout.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(60)
  }, 30_000)
})
