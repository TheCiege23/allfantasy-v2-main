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

/*
 * 🛑 "NO WEEK GIVEN" WAS WEEK 1 (2026-11-19). An imported Fantrax league states no current week in its settings, so the
 * league page's Matchups tab opened on week 1 in week 11 while My Team showed week 11. Anchored to code lines, never
 * to the comments that describe the bug.
 */
describe('🛑 the current week is the league’s, not a guessed 1', () => {
  const CONTAINER = read('components/matchup-center/MatchupTabContainer.tsx')

  it('the service asks the league’s schedule before falling back to 1', () => {
    expect(SERVICE).toMatch(/^\s*\(league\.platformLeagueId \? \(await resolveCurrentWeekForLeague\(league\.platformLeagueId\)/m)
    const chain = SERVICE.slice(SERVICE.indexOf('  const week =\n'), SERVICE.indexOf('  const week =\n') + 400)
    expect(chain.indexOf('weekFromSettings(league.settings)')).toBeLessThan(chain.indexOf('resolveCurrentWeekForLeague'))
    expect(chain.indexOf('resolveCurrentWeekForLeague')).toBeLessThan(chain.lastIndexOf('    1\n'))
  })

  it('a settings blob with no week reads as no week, not as week 1', () => {
    expect(SERVICE).toMatch(/^function weekFromSettings\(settings: unknown\): number \| null \{$/m)
    expect(SERVICE).not.toMatch(/^\s*return 1\s*$/m)
  })

  it('the tab requests the current week when it does not know one, instead of sending week 1', () => {
    expect(CONTAINER).not.toMatch(/^\s*const \[week, setWeek\] = useState\(\(\) => Math\.max\(1, league\.currentWeek \?\? 1\)\)/m)
    expect(CONTAINER).toMatch(/\$\{week != null \? `&week=\$\{week\}` : ''\}/)
  })

  it('an imported league with no rows here is pointed at the Matchup screen that reads its schedule', () => {
    expect(CONTAINER).toMatch(/^\s*\{isImportedPlatform\(league\.platform\) \? \(/m)
    expect(CONTAINER).toContain('href={`/core/matchup?league=${encodeURIComponent(league.id)}&week=${payload.week}`}')
  })
})
