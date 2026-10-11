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
 * The list below held the files that still carried such a read unaudited; it was a burn-down, and it
 * is now empty. A file that grows such a read fails here: scope it (`sleeperIdWhere`,
 * `ourIdOrSleeperIdWhere`, `providerIdWhere` with its `source`, `findSportsPlayersForLeague`) or, if it
 * is unscoped on purpose and shown safe, mark it as described next.
 *
 * The detector is a heuristic over source text — an `externalId: { in:` inside a `sportsPlayer` call
 * with no `source:` beside it — and is checked against planted snippets below, so it is known to fire.
 *
 * ⚠ AN AUDITED READ CARRIES `externalid-audited: <why>` ON ITS OWN LINE OR THE LINE ABOVE. That is for
 * a read that is unscoped ON PURPOSE and has been shown safe, not for one nobody has looked at — the
 * reason is required, and it is line-scoped so the rest of the file stays watched. The three in use
 * (2026-09-30): ids already filtered to self-describing tokens (`resolveAiTeamContext`), a round-trip
 * check that must see every row under an externalId because the resolver it mirrors does
 * (`sleeperPlayerRefs`, shared by the depth chart and the trending-adds list), and a match that is rejected unless the names agree (`getPlayerDataForSurface`).
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * EMPTY SINCE 2026-09-30 — the burn-down is finished. The last entry, the legacy waiver recommender
 * (lib/ai/waivers/waiverRecommendationService.ts), was retired rather than migrated: the live route had
 * already moved to lib/decision-os/waiver/pool.ts and its only remaining caller was a shadow comparison.
 * Every unscoped read in the repo is now either scoped or carries an `externalid-audited:` reason, so
 * the list should stay empty; adding to it is a regression that needs saying so in the commit.
 */
const UNAUDITED = new Set<string>([
  /*
   * RE-OPENED 2026-10-11, AND NOT BY A NEW READ. The non-Sleeper branch of `availabilityLoader`
   * (`externalId IN (rosterIds)` for ESPN/Yahoo/MFL/… leagues) was always unscoped; the Sleeper
   * branch's `source: 'sleeper'` a few lines above it hid it from this detector, the same blind spot
   * that hid the alert sweep's live fold. Nobody has shown which id space those roster ids are in —
   * ESPN 12483 is Matthew Stafford and RI 12483 is not — so it is listed, not marked audited.
   */
  'lib/decision-os/value-v2/redraftWindowServerAdapter.ts',
])

const AUDITED_MARKER = /externalid-audited:\s*\S.{9,}/

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
    /*
     * ⚠ THE `source:` MUST BE IN THIS CALL. A flat ±300-character window let a NEIGHBOURING call's
     * `source:` vouch for this one: the alert sweep's live Sleeper fold sat right under a
     * `sportsInjury.deleteMany({ where: { source: LIVE_STATUS_SOURCE } })`, so its bare
     * `externalId IN (sleeperIds)` read passed here while it filed Sleeper 8394's Out (Percy Butler)
     * under Rolling Insights 8394 (Rome Odunze) — 50 of 50 live rows misnamed (2026-10-11). The
     * window now starts at this `sportsPlayer` and stops at the next `prisma.` / `await`.
     */
    const ahead = src.slice(m.index, m.index + 300)
    const stop = ahead.search(/\bprisma\.|\bawait\b/)
    const around = before.slice(call) + (stop >= 0 ? ahead.slice(0, stop) : ahead)
    if (/source:\s*['"A-Za-z]/.test(around)) continue
    const lineNo = src.slice(0, m.index).split('\n').length
    const srcLines = src.split('\n')
    if (AUDITED_MARKER.test(srcLines[lineNo - 1] ?? '') || AUDITED_MARKER.test(srcLines[lineNo - 2] ?? '')) continue
    lines.push(lineNo)
  }
  return lines
}

describe('externalId lookup guard — the detector', () => {
  it('fires on an unscoped SportsPlayer externalId read (positive control)', () => {
    const planted = `const rows = await prisma.sportsPlayer.findMany({ where: { sport: 'NFL', externalId: { in: ids } } })`
    expect(unscopedExternalIdReads(planted)).toHaveLength(1)
  })

  it('an audit marker silences only its own read, and only with a reason', () => {
    const marked = [
      `prisma.sportsPlayer.findMany({`,
      `  // externalid-audited: ids are filtered to self-describing tokens above`,
      `  where: { sport: 'NFL', externalId: { in: namespaced } },`,
      `})`,
    ].join('\n')
    expect(unscopedExternalIdReads(marked)).toEqual([])
    // No reason: still a finding.
    expect(unscopedExternalIdReads(marked.replace(/audited:.*$/m, 'audited:'))).toHaveLength(1)
    // A marker two lines away covers nothing — a second read in the same call still fires.
    const far = [
      `prisma.sportsPlayer.findMany({`,
      `  // externalid-audited: ids are filtered to self-describing tokens above`,
      `  where: { sport: 'NFL', OR: [`,
      `    { externalId: { in: ids } },`,
      `  ] },`,
      `})`,
    ].join('\n')
    expect(unscopedExternalIdReads(far)).toHaveLength(1)
  })

  it('🛑 a NEIGHBOURING call\'s `source:` does not scope this read (the 2026-10-11 live-fold shape)', () => {
    const neighbour = [
      `await prisma.sportsInjury.deleteMany({ where: { sport: 'NFL', source: LIVE_STATUS_SOURCE } })`,
      `const meta = await prisma.sportsPlayer.findMany({`,
      `  where: { sport: 'NFL', externalId: { in: urgent.map((u) => u.externalId) } },`,
      `})`,
      `await prisma.sportsInjury.findMany({ where: { source: LIVE_STATUS_SOURCE } })`,
    ].join('\n')
    expect(unscopedExternalIdReads(neighbour)).toEqual([3])
    // The same read scoped inside its own call is still quiet.
    expect(unscopedExternalIdReads(neighbour.replace(`sport: 'NFL', externalId`, `sport: 'NFL', source: 'sleeper', externalId`))).toEqual([])
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

  it('every file still on the burn-down list still has a read to burn down', () => {
    // A migrated file left on the list would be exempt from this guard for good.
    const stale = [...UNAUDITED].filter((f) => unscopedExternalIdReads(readFileSync(f, 'utf8')).length === 0)
    expect(stale).toEqual([])
  })
})
