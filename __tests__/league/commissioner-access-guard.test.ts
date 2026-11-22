// @vitest-environment node
/**
 * Every commissioner action asks one rule (lib/league/commissionerAccess.ts, round 1 2026-11-16 for
 * /api/commissioner/leagues, round 2 for the rest of the API). This keeps it that way: a route that reaches for one of
 * the old checks fails here.
 *
 * The old checks each answered a different question — `assertCommissioner` / `isCommissioner` /
 * `requireCommissionerOnly` refused every co-commissioner; `isElevatedCommissioner` and a `getLeagueRole` comparison
 * let every co-commissioner through whatever they were granted. Either way the head commissioner's grant meant
 * nothing.
 *
 * ALLOWED lists the uses that stay on purpose, each with its reason, so an addition is a visible decision.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = path.resolve(__dirname, '..', '..')
const WHERE = ['app/api', 'server/api-route-modules']
const OLD = [
  String.raw`(^|[^.\w])(assertCommissioner|requireCommissionerOnly|isElevatedCommissioner)\(`,
  String.raw`(^|[^.\w])isCommissioner\([^,()]+, [^,()]+\)`,
  String.raw`!== .commissioner. && \w+ !== .co_commissioner.`,
  String.raw`=== .commissioner. \|\| \w+ === .co_commissioner.`,
  String.raw`!isCommissionerRole\(`,
].join('|')

const ALLOWED = new Set([
  // Head-only by design: managing co-commissioners and wiping the draft.
  'app/api/league/settings/co-commissioners/route.ts',
  'app/api/league/settings/reset-draft/route.ts',
  // GET: the dues tracker shows members their own row; the write asks for money.
  'app/api/commissioner/leagues/[leagueId]/dues/route.ts',
  // GET: the manager list; DELETE and PATCH ask the rule (a commissioner's seat is head-only).
  'app/api/commissioner/leagues/[leagueId]/managers/route.ts',
  // Display only: `canEdit` for the settings screen, whose panels then ask the rule per area (commissionerScopes).
  'app/api/league/settings/route.ts',
  // Display only: the rules explainer labels the viewer; it changes nothing.
  'app/api/leagues/[leagueId]/rules-explainer/handler.ts',
])

function grep(pattern: string, where: string[]) {
  return spawnSync('git', ['grep', '-nE', pattern, '--', ...where], { cwd: repo, encoding: 'utf8' })
}

describe('commissioner actions ask the one rule', () => {
  it('no API route uses an old commissioner check outside the named exceptions', () => {
    const res = grep(OLD, WHERE)
    // git grep: 0 = matches, 1 = none; anything else is not a verdict.
    expect([0, 1]).toContain(res.status)
    const offenders = res.stdout
      .split('\n')
      .filter(Boolean)
      .filter((line) => !/^[^:]+:\d+:\s*(\/\/|\*|import)/.test(line))
      .map((line) => line.split(':')[0]!)
      .filter((file) => !ALLOWED.has(file))
    expect([...new Set(offenders)]).toEqual([])
  }, 30_000)

  it('positive control: the same pattern finds the old checks where they still live on purpose', () => {
    const res = grep(OLD, ['app/api/league/settings/reset-draft/route.ts'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('requireCommissionerOnly(')
  }, 30_000)

  it('the routes do ask the rule', () => {
    const res = grep(String.raw`commissionerAccessResponse\(|canCommissionerAct\(|commissionerAccess\(|assertCommissionerAccess\(|assertLeagueCommissioner\(`, WHERE)
    expect(res.status).toBe(0)
    expect(res.stdout.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(200)
  }, 30_000)

  it('every assertLeagueCommissioner call names its area', () => {
    const res = grep(String.raw`assertLeagueCommissioner\([^)]*\)`, WHERE)
    const unnamed = res.stdout
      .split('\n')
      .filter(Boolean)
      .filter((line) => !/assertLeagueCommissioner\([^)]*'(view|head|scoring|rosters|trades|money|chat|league)'\)/.test(line))
    expect(unnamed).toEqual([])
  }, 30_000)
})
