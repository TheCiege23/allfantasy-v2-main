// @vitest-environment node
/**
 * RATCHET: no NEW `SportsPlayer` read may match ids against `externalId` without scoping by `source`.
 *
 * `externalId` is several id spaces in one column (externalIdNamespace.ts): Sleeper's rows store
 * `sleeper:<id>`, while Rolling Insights, CFBD, API-Football and backfill rows store their OWN bare
 * numbers — which collide with Sleeper ids for different people (Sleeper 9228 is Bryce Young; RI 9228
 * is Michael Tarquin, an offensive tackle). Measured 2026-09-29: of the top 900 week-4 projections the
 * waiver board considers, 422 had such an impostor. An unscoped `externalId IN (ids)` read therefore
 * names the wrong player whenever it is handed a Sleeper id.
 *
 * The files below still carry such a read and have NOT been audited for which id space reaches them.
 * The list is a burn-down, not a blessing: migrate a file (`sleeperIdWhere`, `ourIdOrSleeperIdWhere`,
 * or `providerIdWhere` with its `source`) and delete its line. A file NOT on the list that grows such a
 * read fails here.
 *
 * The detector is a heuristic over source text — an `externalId: { in:` inside a `sportsPlayer` call
 * with no `source:` beside it — and is checked against planted snippets below, so it is known to fire.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const UNAUDITED = new Set<string>([
  'app/api/leagues/[leagueId]/dynasty-projections/handler.ts', // roster ids — platform-dependent space
  'lib/ai-payload/resolveAiTeamContext.ts',
  'lib/ai/leagueSportsGroundingPacket.ts', // migrated in #1601
  'lib/ai/waivers/waiverRecommendationService.ts', // "whichever id space the source platform used"
  'lib/core-app/depthChartBackups.ts',
  'lib/core-app/waiversBoard.ts', // migrated in #1601
  'lib/core-app/warRoomBoard.ts', // DraftPick.playerId: ours, the provider's, or Sleeper's
  'lib/injury-impact-dashboard/runInjuryImpactDashboard.ts',
  'lib/integrity/TankingDetectionEngine.ts',
  'lib/lineup-actions/nativeLineupScan.ts',
  'lib/lineup-actions/sleeperLineupScan.ts',
  'lib/nfl-data-foundation/nflDataFoundationService.ts',
  'lib/player-data/getPlayerDataForSurface.ts', // has a name-agreement guard (the 211-photo fix)
  'lib/player-identity/findSportsPlayerByLeagueId.ts',
  'lib/provider-trades/scanPendingYahooTrades.ts',
  'lib/roster/resolvePlayerNames.ts',
  'lib/scoring/best-ball-engine.ts',
  'lib/shared-services/league-hub/replacementOptions.ts',
  'lib/sport-teams/PlayerTeamMapper.ts',
])

/** Line numbers of unscoped `externalId: { in:` reads inside a `sportsPlayer` call in this source. */
function unscopedExternalIdReads(src: string): number[] {
  if (!src.includes('sportsPlayer')) return []
  const lines: number[] = []
  const re = /externalId:\s*\{\s*in:/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 500), m.index)
    const call = before.lastIndexOf('sportsPlayer')
    const other = Math.max(
      before.lastIndexOf('leagueTeam'),
      before.lastIndexOf('sportsGame'),
      before.lastIndexOf('roster.'),
      before.lastIndexOf('playerIdentityMap'),
    )
    if (call < 0 || other > call) continue
    const around = src.slice(Math.max(0, m.index - 300), m.index + 300)
    if (/source:\s*['"A-Za-z]/.test(around)) continue
    lines.push(src.slice(0, m.index).split('\n').length)
  }
  return lines
}

describe('externalId lookup guard — the detector', () => {
  it('fires on an unscoped SportsPlayer externalId read (positive control)', () => {
    const planted = `const rows = await prisma.sportsPlayer.findMany({ where: { sport: 'NFL', externalId: { in: ids } } })`
    expect(unscopedExternalIdReads(planted)).toHaveLength(1)
  })

  it('stays quiet when the read is scoped by source, or is not a SportsPlayer read', () => {
    expect(unscopedExternalIdReads(`prisma.sportsPlayer.findMany({ where: { source: 'rolling_insights', externalId: { in: ids } } })`)).toEqual([])
    expect(unscopedExternalIdReads(`prisma.leagueTeam.findMany({ where: { externalId: { in: rosterIds } } }) // sportsPlayer`)).toEqual([])
    expect(unscopedExternalIdReads(`prisma.sportsPlayer.findMany({ where: sleeperIdWhere(ids, 'NFL') })`)).toEqual([])
  })
})

describe('externalId lookup guard — the repo', () => {
  it('no file outside the burn-down list reads SportsPlayer.externalId unscoped', () => {
    const files = execSync('git ls-files lib app components', { encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__'))
    const offenders: string[] = []
    for (const f of files) {
      if (UNAUDITED.has(f)) continue
      const lines = unscopedExternalIdReads(readFileSync(f, 'utf8'))
      for (const line of lines) offenders.push(`${f}:${line}`)
    }
    expect(offenders).toEqual([])
  })
})
