// @vitest-environment node
/**
 * Durable Sleeper read-model sync — PERSISTED integration coverage against an isolated test database.
 *
 * Proves the DB-dependent requirements end-to-end: durable source/sync identity (#1), reimport resolves
 * the same League.id with no duplicate (#2/#3), idempotent re-sync (#4), roster starters/bench update (#5),
 * removal reconciliation only from a complete authoritative response (#6), empty/error response never
 * erases valid data (#7/#11), claims + raw Sleeper manager ids survive (#8), checkpoint resume + immutable
 * skip (#9/#10), freshness advances only on completed runs (#11), overlap lock (#12), one league's failure
 * does not block another (#13), the shared read model + Chimmy roster context see updates (#18/#19), and
 * new-season linkage never overwrites a prior season (#20).
 *
 * SAFETY: runs ONLY against the isolated test DB (ep-muddy-leaf); HARD-REFUSES the production endpoint
 * (ep-curly-block). Provide the DB via `node --env-file=.env.test`. Never writes to production.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/prisma'
import { bootstrapLeagueFromNormalizedImport } from '@/lib/league-import/sleeper/SleeperLeagueCreationBootstrapService'
import { buildImportedLeagueSettings } from '@/lib/league-import/ImportedLeagueCommitService'
import { applySleeperScopeToLeague } from '@/lib/fantasy-os/sync/collector/applySleeperLeagueSync'
import { syncConnectedSleeperLeague } from '@/lib/fantasy-os/sync/collector/syncConnectedSleeperLeague'
import { runDueSleeperLeagues } from '@/lib/fantasy-os/sync/collector/runDueSleeperLeagues'
import { createPrismaSleeperSyncStore } from '@/lib/fantasy-os/sync/collector/prismaSyncStore'
import { createSleeperScopeFetcher } from '@/lib/fantasy-os/sync/collector/sleeperScopeFetcher'
import { createAutomationSyncLock } from '@/lib/fantasy-os/sync/collector/automationSyncLock'
import { buildRunKey } from '@/lib/fantasy-os/sync/collector/enumerate'
import type { SleeperSyncConnection } from '@/lib/fantasy-os/sync/collector/types'
import { runSync } from '@/lib/fantasy-os/sync/runner'
import { acquireAutomationLock, releaseAutomationLock } from '@/lib/automation/locks'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { makeSleeperNormalized } from './fixtures/sleeperNormalizedFixture'
import type { NormalizedImportResult } from '@/lib/league-import/types'

// ── Production refusal guard ────────────────────────────────────────────────────
function dbHost(): string {
  const raw = process.env.DATABASE_URL ?? ''
  try {
    return new URL(raw.replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    return ''
  }
}
const HOST = dbHost()
if (HOST.includes('ep-curly-block')) {
  throw new Error('[sleeper-sync integration] REFUSING to run against the PRODUCTION database (ep-curly-block).')
}
const RUN_DB = HOST.includes('ep-muddy-leaf') // the isolated, non-production test project

const NOW = new Date('2025-11-15T18:00:00Z') // in-season (30-min cadence)
const clock = { now: () => NOW }
const rng = { next: () => 0.5 }
const noSleep = async () => {}
const STAMP = Date.now().toString(36)

let USER_ID = ''
const createdLeagueIds: string[] = []
const createdRunKeys: string[] = []

function lid(n: string): string {
  return `itest-${STAMP}-${n}`
}
function conn(externalLeagueId: string, season = 2025): SleeperSyncConnection {
  const c = { runKey: buildRunKey('sleeper', externalLeagueId, season), provider: 'sleeper' as const, externalLeagueId, season, sport: 'NFL' }
  if (!createdRunKeys.includes(c.runKey)) createdRunKeys.push(c.runKey)
  return c
}

/** Seed a canonical imported Sleeper league (League row + claim-preserving team/roster bootstrap). */
async function seed(normalized: NormalizedImportResult): Promise<string> {
  const season = normalized.league.season ?? 2025
  const league = await prisma.league.create({
    data: {
      userId: USER_ID,
      platform: 'sleeper',
      platformLeagueId: normalized.source.source_league_id,
      season,
      sport: 'NFL',
      name: normalized.league.name,
      leagueSize: normalized.league.leagueSize,
      isDynasty: true,
      status: normalized.league.status ?? undefined,
      settings: buildImportedLeagueSettings(normalized) as object,
      importedAt: new Date(),
    },
  })
  createdLeagueIds.push(league.id)
  await bootstrapLeagueFromNormalizedImport(league.id, normalized)
  return league.id
}

function loader(n: NormalizedImportResult): (id: string) => Promise<NormalizedImportResult> {
  return async () => n
}

beforeAll(async () => {
  if (!RUN_DB) return
  // Additive, idempotent migration — safe no-op if already applied.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "league_sync_state" (
    "id" TEXT NOT NULL, "runKey" VARCHAR(191) NOT NULL, "provider" VARCHAR(32) NOT NULL,
    "externalLeagueId" VARCHAR(128) NOT NULL, "season" INTEGER NOT NULL,
    "sport" VARCHAR(16) NOT NULL DEFAULT 'NFL', "seasonState" VARCHAR(24), "syncStatus" VARCHAR(24),
    "checkpoints" JSONB NOT NULL DEFAULT '{}', "completedScopes" JSONB NOT NULL DEFAULT '[]',
    "incompleteScopes" JSONB NOT NULL DEFAULT '[]', "lastRunAccounting" JSONB,
    "lastAttemptedSyncAt" TIMESTAMP(3), "lastSuccessfulSyncAt" TIMESTAMP(3), "sourceDataTimestamp" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT, "lastRunId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "league_sync_state_pkey" PRIMARY KEY ("id"))`)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "league_sync_state_runKey_key" ON "league_sync_state"("runKey")`)

  const user = await prisma.appUser.create({
    data: { email: `itest+${STAMP}@sleeper-sync.test`, username: `itest_${STAMP}` },
  })
  USER_ID = user.id
}, 60_000)

afterAll(async () => {
  if (!RUN_DB || !USER_ID) return
  await prisma.leagueSyncState.deleteMany({ where: { runKey: { in: createdRunKeys } } }).catch(() => {})
  await prisma.syncJobRun.deleteMany({ where: { jobScope: { in: createdRunKeys } } }).catch(() => {})
  for (const id of createdLeagueIds) await prisma.league.delete({ where: { id } }).catch(() => {})
  await prisma.appUser.delete({ where: { id: USER_ID } }).catch(() => {})
})

describe.skipIf(!RUN_DB)('durable Sleeper sync — persisted integration', () => {
  it('#1 first sync persists durable source + sync identity and advances freshness', async () => {
    const n = makeSleeperNormalized({ leagueId: lid('a') })
    const leagueId = await seed(n)
    const c = conn(lid('a'))

    const res = await syncConnectedSleeperLeague(c, NOW, { force: true, fetchNormalized: loader(n), clock, rng, sleep: noSleep })
    expect(res.status).toBe('completed')

    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, platformLeagueId: true, season: true, lastSyncedAt: true, syncStatus: true } })
    expect(league?.platform).toBe('sleeper')
    expect(league?.platformLeagueId).toBe(lid('a'))
    expect(league?.lastSyncedAt).toBeTruthy() // freshness stamped

    const state = await prisma.leagueSyncState.findUnique({ where: { runKey: c.runKey } })
    expect(state?.provider).toBe('sleeper')
    expect(state?.externalLeagueId).toBe(lid('a'))
    expect(state?.season).toBe(2025)
    expect(state?.lastSuccessfulSyncAt).toBeTruthy()
    expect(state?.syncStatus).toBe('completed')
  })

  it('#2/#3 a repeated sync resolves the SAME League.id and never creates a duplicate', async () => {
    const n = makeSleeperNormalized({ leagueId: lid('b') })
    const leagueId = await seed(n)
    const c = conn(lid('b'))
    await syncConnectedSleeperLeague(c, NOW, { force: true, fetchNormalized: loader(n), clock, rng, sleep: noSleep })
    await syncConnectedSleeperLeague(c, NOW, { force: true, fetchNormalized: loader(n), clock, rng, sleep: noSleep })

    const rows = await prisma.league.findMany({ where: { platform: 'sleeper', platformLeagueId: lid('b'), season: 2025 }, select: { id: true } })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(leagueId)
  })

  it('#4 an identical re-sync is idempotent (reports unchanged, no duplicate rosters/teams)', async () => {
    const n = makeSleeperNormalized({ leagueId: lid('c') })
    const leagueId = await seed(n)
    const c = conn(lid('c'))
    await applySleeperScopeToLeague({ leagueId, scope: 'teams_rosters', normalized: n })
    const teamsBefore = await prisma.leagueTeam.count({ where: { leagueId } })
    const rostersBefore = await prisma.roster.count({ where: { leagueId } })

    const again = await applySleeperScopeToLeague({ leagueId, scope: 'teams_rosters', normalized: n })
    expect(again.unchanged).toBeGreaterThan(0)
    expect(again.imported).toBe(0)
    expect(await prisma.leagueTeam.count({ where: { leagueId } })).toBe(teamsBefore)
    expect(await prisma.roster.count({ where: { leagueId } })).toBe(rostersBefore)
  })

  it('#5/#18/#19 a changed roster updates starters/bench in the read model + Chimmy context', async () => {
    const n0 = makeSleeperNormalized({ leagueId: lid('d'), rosters: [
      { teamId: '1', managerId: 'u1', players: ['p1', 'p2', 'p3'], starters: ['p1'] },
      { teamId: '2', managerId: 'u2', players: ['p5', 'p6'], starters: ['p5'] },
    ] })
    const leagueId = await seed(n0)

    const n1 = makeSleeperNormalized({ leagueId: lid('d'), rosters: [
      { teamId: '1', managerId: 'u1', players: ['p1', 'p2', 'p3'], starters: ['p3'] }, // starter p1 → p3
      { teamId: '2', managerId: 'u2', players: ['p5', 'p6'], starters: ['p5'] },
    ] })
    const r = await applySleeperScopeToLeague({ leagueId, scope: 'teams_rosters', normalized: n1 })
    expect(r.imported).toBeGreaterThan(0)

    // #18 shared read model (the row every dashboard/analytical consumer reads)
    const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: 'u1' }, select: { playerData: true } })
    const pd = roster?.playerData as Record<string, unknown>
    expect(pd.starters).toEqual(['p3'])

    // #19 Chimmy roster context
    const sections = getNormalizedLineupSections(pd)
    expect(sections.starters.map((s) => s.id)).toEqual(['p3'])
    expect(sections.bench.map((s) => s.id).sort()).toEqual(['p1', 'p2'])
  })

  it('#6 removal reconciles a vanished team ONLY from a complete authoritative response', async () => {
    const three = [
      { teamId: '1', managerId: 'u1', players: ['p1'], starters: ['p1'] },
      { teamId: '2', managerId: 'u2', players: ['p2'], starters: ['p2'] },
      { teamId: '3', managerId: 'u3', players: ['p3'], starters: ['p3'] },
    ]
    const leagueId = await seed(makeSleeperNormalized({ leagueId: lid('e'), rosters: three }))
    expect(await prisma.leagueTeam.count({ where: { leagueId } })).toBe(3)

    // team 3 vanished, coverage PARTIAL → must NOT be removed (not authoritative)
    const partial = makeSleeperNormalized({ leagueId: lid('e'), rostersCoverage: 'partial', rosters: three.slice(0, 2) })
    const rp = await applySleeperScopeToLeague({ leagueId, scope: 'teams_rosters', normalized: partial })
    expect(rp.removed).toBe(0)
    expect(await prisma.leagueTeam.count({ where: { leagueId } })).toBe(3)

    // team 3 vanished, coverage FULL → reconciled away (unclaimed)
    const full = makeSleeperNormalized({ leagueId: lid('e'), rostersCoverage: 'full', rosters: three.slice(0, 2) })
    const rf = await applySleeperScopeToLeague({ leagueId, scope: 'teams_rosters', normalized: full })
    expect(rf.removed).toBe(1)
    expect(await prisma.leagueTeam.count({ where: { leagueId } })).toBe(2)
    expect(await prisma.leagueTeam.findFirst({ where: { leagueId, externalId: '3' } })).toBeNull()
  })

  it('#7 an empty roster response never erases valid stored data', async () => {
    const n = makeSleeperNormalized({ leagueId: lid('f') })
    const leagueId = await seed(n)
    const before = await prisma.roster.count({ where: { leagueId } })
    expect(before).toBeGreaterThan(0)

    const empty = makeSleeperNormalized({ leagueId: lid('f'), rosters: [] })
    const r = await applySleeperScopeToLeague({ leagueId, scope: 'teams_rosters', normalized: empty })
    expect(r.removed).toBe(0)
    expect(r.notes.join(' ')).toMatch(/empty/i)
    expect(await prisma.roster.count({ where: { leagueId } })).toBe(before)
  })

  it('#8 team claims and raw Sleeper manager ids survive synchronization', async () => {
    const n = makeSleeperNormalized({ leagueId: lid('g') })
    const leagueId = await seed(n)
    // Simulate a user having claimed team 1 (claimedByUserId set; platformUserId is the raw Sleeper id).
    await prisma.leagueTeam.updateMany({ where: { leagueId, externalId: '1' }, data: { claimedByUserId: USER_ID } })

    // Re-sync with changed stats — the claim + raw ids must be preserved.
    const changed = makeSleeperNormalized({ leagueId: lid('g'), rosters: [
      { teamId: '1', managerId: 'u1', wins: 9, players: ['p1', 'p2'], starters: ['p1'] },
      { teamId: '2', managerId: 'u2', players: ['p5'], starters: ['p5'] },
    ] })
    await applySleeperScopeToLeague({ leagueId, scope: 'teams_rosters', normalized: changed })

    const team = await prisma.leagueTeam.findFirst({ where: { leagueId, externalId: '1' }, select: { claimedByUserId: true, platformUserId: true, wins: true } })
    expect(team?.claimedByUserId).toBe(USER_ID) // claim preserved
    expect(team?.platformUserId).toBe('u1') // raw Sleeper manager id preserved
    expect(team?.wins).toBe(9) // data still refreshed
  })

  it('#9/#10/#11 partial run: immutable scope checkpoints, resumes without restart, freshness not advanced until completed', async () => {
    const n = makeSleeperNormalized({ leagueId: lid('h') })
    const leagueId = await seed(n)
    const c = conn(lid('h'))
    const store = createPrismaSleeperSyncStore({ connection: c, loadNormalized: loader(n) as any, reconcileRemovals: true })
    const baseFetcher = createSleeperScopeFetcher({ loadNormalized: async () => n })
    const lock = createAutomationSyncLock()
    let failTeams = true
    const fetchScope = async (scope: string, cp: string | null, now: Date) => {
      if (scope === 'teams_rosters' && failTeams) throw new Error('transient provider error')
      return baseFetcher(scope, cp, now)
    }

    // Run 1 — 'historical' (immutable) completes + checkpoints; 'teams_rosters' fails → partial, no freshness.
    const r1 = await runSync({
      runKey: c.runKey, seasonState: 'regular_season',
      scopes: ['historical', 'teams_rosters'], immutableScopes: ['historical'],
      lock, store, clock, rng, sleep: noSleep, fetchScope, maxRetries: 1,
    })
    expect(r1.status).toBe('partial')
    let state = await prisma.leagueSyncState.findUnique({ where: { runKey: c.runKey } })
    expect(state?.lastSuccessfulSyncAt).toBeNull() // #11 partial does NOT advance freshness
    const cps = state?.checkpoints as Record<string, unknown>
    expect(cps.historical).toBeTruthy() // immutable scope checkpointed

    // Run 2 — 'historical' is immutable + checkpointed → SKIPPED (cacheHit, not refetched); teams now succeeds.
    failTeams = false
    const calls: string[] = []
    const trackingFetch = async (scope: string, cp: string | null, now: Date) => { calls.push(scope); return fetchScope(scope, cp, now) }
    const r2 = await runSync({
      runKey: c.runKey, seasonState: 'regular_season',
      scopes: ['historical', 'teams_rosters'], immutableScopes: ['historical'],
      lock, store, clock, rng, sleep: noSleep, fetchScope: trackingFetch, maxRetries: 1,
    })
    expect(r2.status).toBe('completed')
    expect(calls).not.toContain('historical') // #9/#10 resumed without restarting the completed immutable scope
    expect(r2.accounting.cacheHits).toBeGreaterThanOrEqual(1)
    state = await prisma.leagueSyncState.findUnique({ where: { runKey: c.runKey } })
    expect(state?.lastSuccessfulSyncAt).toBeTruthy() // freshness advances only now
  })

  it('#11 a hard-failed run leaves valid data + freshness untouched', async () => {
    const n = makeSleeperNormalized({ leagueId: lid('i') })
    const leagueId = await seed(n)
    const c = conn(lid('i'))
    const rostersBefore = await prisma.roster.findMany({ where: { leagueId }, select: { playerData: true } })

    const res = await syncConnectedSleeperLeague(c, NOW, {
      force: true,
      fetchNormalized: async () => { throw new Error('provider down') },
      clock, rng, sleep: noSleep, maxRetries: 1,
    })
    expect(res.status).toBe('failed')
    expect(res.advancedFreshness).toBe(false)
    const state = await prisma.leagueSyncState.findUnique({ where: { runKey: c.runKey } })
    expect(state?.lastSuccessfulSyncAt).toBeNull()
    const rostersAfter = await prisma.roster.findMany({ where: { leagueId }, select: { playerData: true } })
    expect(rostersAfter).toHaveLength(rostersBefore.length) // nothing erased
  })

  it('#12 overlapping executions are locked out (never process the same league concurrently)', async () => {
    const n = makeSleeperNormalized({ leagueId: lid('j') })
    await seed(n)
    const c = conn(lid('j'))
    const held = await acquireAutomationLock(c.runKey, { owner: 'other-executor', ttlMs: 60_000 })
    expect(held.ok).toBe(true)
    try {
      const res = await syncConnectedSleeperLeague(c, NOW, { force: true, fetchNormalized: loader(n), clock, rng, sleep: noSleep })
      expect(res.status).toBe('locked')
      expect(res.executed).toBe(false)
    } finally {
      await releaseAutomationLock(c.runKey, 'other-executor')
    }
  })

  it('#13 one league failure does not block another (per-league isolation)', async () => {
    const nGood = makeSleeperNormalized({ leagueId: lid('k1') })
    await seed(nGood)
    await seed(makeSleeperNormalized({ leagueId: lid('k2') }))
    const cGood = conn(lid('k1'))
    const cBad = conn(lid('k2'))

    const summary = await runDueSleeperLeagues({
      now: NOW,
      connections: [cBad, cGood], // bad first — must not block the good one
      fetchNormalized: async (id) => {
        if (id === lid('k2')) throw new Error('provider error for k2')
        return nGood
      },
    })
    // The bad league does not complete (its scopes fail), but it NEVER blocks the good one.
    expect(summary.completed).toBe(1)
    const goodResult = summary.results.find((r) => r.runKey === cGood.runKey)
    const badResult = summary.results.find((r) => r.runKey === cBad.runKey)
    expect(goodResult?.status).toBe('completed')
    expect(badResult?.status).not.toBe('completed')
    expect(Boolean(badResult?.error) || badResult?.status === 'failed').toBe(true)
  })

  it('#20 new-season linkage does not overwrite the prior season', async () => {
    const prior = makeSleeperNormalized({ leagueId: lid('m'), season: 2024, name: 'Prior Season' })
    const priorLeagueId = await seed(prior)
    const priorRostersBefore = await prisma.roster.count({ where: { leagueId: priorLeagueId } })

    const renewed = makeSleeperNormalized({ leagueId: lid('n'), season: 2025, name: 'Renewed Season', previousLeagueId: lid('m') })
    const renewedLeagueId = await seed(renewed)
    await syncConnectedSleeperLeague(conn(lid('n'), 2025), NOW, { force: true, fetchNormalized: loader(renewed), clock, rng, sleep: noSleep })

    const priorLeague = await prisma.league.findUnique({ where: { id: priorLeagueId }, select: { name: true, season: true } })
    expect(priorLeague?.name).toBe('Prior Season') // untouched
    expect(priorLeague?.season).toBe(2024)
    expect(await prisma.roster.count({ where: { leagueId: priorLeagueId } })).toBe(priorRostersBefore)
    expect(priorLeagueId).not.toBe(renewedLeagueId) // distinct rows per season
  })
})
