/**
 * Decision OS Phase 5.2 — DB-backed integration for the import-signals port.
 *
 * Runs ONLY against a real Postgres database (the Neon `import-test-sandbox`
 * branch), never in normal unit runs. Opt-in:
 *
 *   IMPORT_INTEGRATION_DB=1 DATABASE_URL=... DIRECT_URL=... npm run test:import:db
 *
 * Uses clearly-fake `__decision_os_5_2__`-prefixed IDs so the test only ever
 * touches its own rows on the shared prod-cloned branch, cleans up in a
 * `finally` block + `afterAll`, and never mutates real data.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'

const dbEnabled = process.env.IMPORT_INTEGRATION_DB === '1' && !!process.env.DATABASE_URL?.trim()

// Replace the app singleton (which returns a build-phase stub in test context)
// with a real PrismaClient. The port under test imports from `@/lib/prisma`.
const testPrisma = new PrismaClient()
vi.mock('@/lib/prisma', () => ({ prisma: testPrisma }))

describe.skipIf(!dbEnabled)('Decision OS Phase 5.2 — import signals port', () => {
  const testTag = `__decision_os_5_2_${Date.now()}`
  const testLeagueId = `${testTag}_league`
  const testUserId = `${testTag}_user`
  const idemKey = `${testTag}_idem`

  beforeAll(async () => {
    // Ensure connectivity works before running seed tests.
    await testPrisma.$queryRawUnsafe('SELECT 1')
  })

  afterAll(async () => {
    // Best-effort cleanup — safe even if a test never got that far.
    try {
      await testPrisma.importWarning.deleteMany({ where: { leagueId: testLeagueId } })
    } catch { /* noop */ }
    try {
      await testPrisma.importRun.deleteMany({ where: { idempotencyKey: idemKey } })
    } catch { /* noop */ }
    try {
      await testPrisma.league.deleteMany({ where: { id: testLeagueId } })
    } catch { /* noop */ }
    try {
      await testPrisma.appUser.deleteMany({ where: { id: testUserId } })
    } catch { /* noop */ }
    await testPrisma.$disconnect()
  })

  it('loadLeagueImportSignals returns empty shape when no ImportRun exists', async () => {
    const { loadLeagueImportSignals } = await import('@/lib/decision-os/behavioral/port')
    const signals = await loadLeagueImportSignals(`${testTag}_no_run`)
    expect(signals.lastImportedAt).toBeNull()
    expect(signals.latestRunIncomplete).toBe(false)
    expect(signals.warningCountsBySeverity).toEqual({ error: 0, warn: 0, info: 0 })
    expect(signals.provider).toBe('sleeper')
  })

  it('reads a completed ImportRun + warning counts, feeds them into dataQuality', async () => {
    // Seed AppUser → League → ImportRun → ImportWarnings, all with clearly-fake IDs.
    const now = new Date()
    let seededRunId: string | null = null
    try {
      await testPrisma.appUser.create({
        data: {
          id: testUserId,
          email: `${testUserId}@example.test`,
          username: testUserId,
        },
      })
      await testPrisma.league.create({
        data: {
          id: testLeagueId,
          userId: testUserId,
          platform: 'sleeper',
          platformLeagueId: `${testTag}_sleeper`,
          name: 'Decision OS 5.2 test',
          leagueSize: 12,
          rosterSize: 15,
          season: 2025,
        },
      })

      const run = await testPrisma.importRun.create({
        data: {
          userId: testUserId,
          leagueId: testLeagueId,
          provider: 'sleeper',
          sourceLeagueId: `S_${Date.now()}`,
          season: 2025,
          status: 'completed',
          idempotencyKey: idemKey,
          startedAt: new Date(now.getTime() - 60_000),
          completedAt: now,
        },
      })
      seededRunId = run.id

      await testPrisma.importWarning.createMany({
        data: [
          {
            runId: run.id,
            leagueId: testLeagueId,
            code: 'source_fetch_incomplete',
            message: 'matchups week 3: sleeper returned 500 after 3 attempts',
            severity: 'warn',
            metadata: {},
          },
          {
            runId: run.id,
            leagueId: testLeagueId,
            code: 'source_fetch_incomplete',
            message: 'matchups week 5: sleeper returned 500 after 3 attempts',
            severity: 'warn',
            metadata: {},
          },
          {
            runId: run.id,
            leagueId: testLeagueId,
            code: 'legacy_evidence_wiring_failed',
            message: 'rank recompute deferred',
            severity: 'error',
            metadata: {},
          },
        ],
      })

      const { loadLeagueImportSignals } = await import('@/lib/decision-os/behavioral/port')
      const signals = await loadLeagueImportSignals(testLeagueId)
      expect(signals.lastImportedAt).toBeInstanceOf(Date)
      expect(signals.latestRunIncomplete).toBe(false)
      expect(signals.warningCountsBySeverity.warn).toBe(2)
      expect(signals.warningCountsBySeverity.error).toBe(1)

      // Feed the raw signals through the pure derivation — end-to-end proof.
      const { deriveImportDataQuality } = await import('@/lib/decision-os/behavioral/import-signals')
      const q = deriveImportDataQuality({
        lastImportedAt: signals.lastImportedAt,
        warningCountsBySeverity: signals.warningCountsBySeverity,
        latestRunIncomplete: signals.latestRunIncomplete,
      })
      expect(q).toBeDefined()
      expect(q!.unresolvedWarnings).toBe(3) // 2 warn + 1 error
      expect(q!.importIncomplete).toBe(true) // error present
      expect(q!.hasRecentImport).toBe(true)
    } finally {
      // In-test cleanup runs alongside the afterAll safety net.
      await testPrisma.importWarning.deleteMany({ where: { leagueId: testLeagueId } }).catch(() => undefined)
      if (seededRunId) {
        await testPrisma.importRun.deleteMany({ where: { id: seededRunId } }).catch(() => undefined)
      }
      await testPrisma.league.deleteMany({ where: { id: testLeagueId } }).catch(() => undefined)
      await testPrisma.appUser.deleteMany({ where: { id: testUserId } }).catch(() => undefined)
    }
  })
})
