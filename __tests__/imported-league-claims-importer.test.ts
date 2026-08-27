/**
 * No non-Sleeper import had ever claimed a team, and the league went invisible.
 *
 * `resolveImportedManagerUserIds` only maps SLEEPER manager ids to AllFantasy
 * accounts — there is no equivalent linkage for an ESPN member id, a Yahoo guid
 * or a Fantrax team. So every ESPN, Yahoo, Fantrax, MFL and Fleaflicker league
 * landed with `claimedByUserId` null on every row.
 *
 * Three surfaces are gated on that claim, which is why one missing column made
 * the same league look broken three different ways:
 *
 *   /core/portfolio      where: { claimedByUserId: userId }  -> absent entirely
 *   Matchup Center       404 -> "League not found"
 *   Trade Center         no counterparty layer, no inbox
 *
 * Measured on the first ESPN league ever imported: 10 teams, 10 rosters, 0
 * claimed.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

const BOOTSTRAP = read('lib/league-import/sleeper/SleeperLeagueCreationBootstrapService.ts')
const WRAPPER = read('lib/league-import/LeagueCreationBootstrapService.ts')
const COMMIT = read('lib/league-import/ImportedLeagueCommitService.ts')
const PERSIST = read('lib/league-import/importPersistenceService.ts')
const ROUTE = read('app/api/leagues/import/commit/route.ts')
const GATE = read('lib/league-import/commissionerGate.ts')
const PORTFOLIO = read('lib/core-app/portfolio.ts')

describe('⚠ the value existed all along and was dropped', () => {
  it('the gate already resolves the importer’s team', () => {
    // It has to — that is how it decides whether this caller may import at all.
    expect(GATE).toContain('sourceManagerId: viewerTeam?.managerId ?? viewerTeamId')
  })

  it('the route now hands it to the persist path', () => {
    expect(ROUTE).toContain('importerSourceManagerId: gate.sourceManagerId ?? null')
  })

  it('survives every hop to the bootstrap', () => {
    expect(PERSIST).toContain('importerSourceManagerId: input.importerSourceManagerId ?? null')
    expect(COMMIT).toContain('sourceManagerId: options.importerSourceManagerId ?? null')
    expect(WRAPPER).toContain('bootstrapLeagueFromNormalizedImport(leagueId, normalized, importer)')
  })
})

describe('⚠ one team, and only the importer’s own', () => {
  it('claims the importer and nobody else', () => {
    /*
     * Every other manager is a stranger to us — no linkage from their platform
     * id to an AllFantasy account exists, and inventing one would hand someone
     * else's team to whoever imported the league.
     */
    expect(BOOTSTRAP).toContain('ONE TEAM, AND ONLY THE IMPORTER')
    expect(BOOTSTRAP).toContain('managerUserIds.set(importerManagerId, importer.userId)')
  })

  it('never overwrites what the resolver already worked out', () => {
    // On Sleeper the resolver is authoritative and knows more than this hint.
    expect(BOOTSTRAP).toContain('!managerUserIds.has(importerManagerId)')
  })

  it('ignores a blank manager id rather than claiming on an empty key', () => {
    expect(BOOTSTRAP).toContain("importer?.sourceManagerId?.trim()")
  })
})

describe('⚠ every hop stays optional, so existing callers are untouched', () => {
  it('the bootstrap parameter is optional', () => {
    // app/api/import-espn, app/api/mfl/import and LeagueImportToExistingService
    // all call these without the hint and must behave exactly as before.
    expect(BOOTSTRAP).toContain('importer?: { userId: string; sourceManagerId?: string | null } | null,')
    expect(WRAPPER).toContain('importer?: { userId: string; sourceManagerId?: string | null } | null,')
  })

  it('the options field is optional', () => {
    expect(COMMIT).toContain('importerSourceManagerId?: string | null')
    expect(PERSIST).toContain('importerSourceManagerId?: string | null')
  })
})

describe('⚠ why this mattered', () => {
  it('the portfolio really does gate on a claim', () => {
    expect(PORTFOLIO).toContain('claimedByUserId: userId')
  })
})
