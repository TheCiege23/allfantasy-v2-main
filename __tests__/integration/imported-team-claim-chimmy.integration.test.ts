// @vitest-environment node
/**
 * C3 integration test — EXECUTED against a real Postgres test database.
 *
 * Proves, against controlled PERSISTED data (not mocks/traces):
 *   - the canonical Sleeper import claims the linked importer's LeagueTeam
 *     (`claimedByUserId = importing AppUser.id`) while preserving the raw source
 *     manager id on `platformUserId`;
 *   - an unlinked manager's team stays unclaimed;
 *   - a Roster exists for the resolved importer;
 *   - `resolveLeagueIdentity` returns the importer's team;
 *   - `RosterContextProvider` grounds on the real imported starters/bench (the
 *     raw-vs-resolved tolerance fix), not empty arrays;
 *   - a different user cannot receive that roster;
 *   - idempotent reimport preserves the claim.
 *
 * Gated + guarded. Run with the safe test DB only:
 *   CHIMMY_CLAIM_INTEGRATION=1 node --env-file=<repo>/.env.test \
 *     node_modules/vitest/vitest.mjs run __tests__/integration/imported-team-claim-chimmy.integration.test.ts
 * It REFUSES to run if DATABASE_URL points at the production host.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DB_URL = process.env.DATABASE_URL ?? ''
const HOST = (() => {
  try {
    return new URL(DB_URL).host
  } catch {
    return ''
  }
})()
// Allowlist the isolated test endpoint by host marker and refuse ANYTHING else
// (including production) even when the gate flag is set. Override for other
// isolated test DBs via CHIMMY_CLAIM_TEST_HOST_MARKER — never point this at a
// production endpoint.
const TEST_HOST_MARKER = process.env.CHIMMY_CLAIM_TEST_HOST_MARKER ?? 'muddy-leaf'
const IS_ISOLATED_TEST_HOST = HOST.length > 0 && HOST.includes(TEST_HOST_MARKER)
const ENABLED =
  process.env.CHIMMY_CLAIM_INTEGRATION === '1' && Boolean(DB_URL) && IS_ISOLATED_TEST_HOST

if (process.env.CHIMMY_CLAIM_INTEGRATION === '1' && DB_URL && !IS_ISOLATED_TEST_HOST) {
  throw new Error(
    'Refusing to run C3 integration test: DATABASE_URL host is not an approved isolated test endpoint.',
  )
}

describe.skipIf(!ENABLED)('C3 — imported team claim + Chimmy grounding (real test DB)', () => {
  const RID = `c3it${Date.now()}x${Math.floor(Math.random() * 1e6)}`
  const importerId = `${RID}_importer`
  const importerSm = `${RID}importersm` // raw sleeper manager id
  const otherSm = `${RID}othersm`
  const strangerId = `${RID}_stranger`
  const leagueId = `${RID}_league`
  const srcLeagueId = `${RID}_src`
  const team1 = `${RID}_t1`
  const team2 = `${RID}_t2`

  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any
  let bootstrap: (leagueId: string, normalized: any) => Promise<unknown>
  let resolveLeagueIdentity: (req: any) => Promise<any>
  let RosterProvider: new () => { load: (req: any) => Promise<any> }

  const fixture = {
    source: {
      source_provider: 'sleeper',
      source_league_id: srcLeagueId,
      source_season_id: '2026',
      import_batch_id: null,
      imported_at: new Date().toISOString(),
    },
    league: { name: 'C3 Test League', sport: 'nfl', season: 2026, scoring: 'ppr' },
    rosters: [
      {
        source_team_id: team1,
        source_manager_id: importerSm,
        owner_name: 'Importer',
        team_name: 'Importer Team',
        avatar_url: null,
        is_commissioner: true,
        wins: 5,
        losses: 2,
        ties: 0,
        points_for: 1200,
        player_ids: ['p1', 'p2', 'p3', 'p4'],
        starter_ids: ['p1', 'p2'],
        reserve_ids: ['p3'],
        taxi_ids: [],
      },
      {
        source_team_id: team2,
        source_manager_id: otherSm,
        owner_name: 'Other',
        team_name: 'Other Team',
        avatar_url: null,
        wins: 3,
        losses: 4,
        ties: 0,
        points_for: 1100,
        player_ids: ['p5', 'p6'],
        starter_ids: ['p5'],
        reserve_ids: [],
        taxi_ids: [],
      },
    ],
    schedule: [],
    standings: [],
  }

  beforeAll(async () => {
    prisma = (await import('@/lib/prisma')).prisma
    bootstrap = (
      await import('@/lib/league-import/sleeper/SleeperLeagueCreationBootstrapService')
    ).bootstrapLeagueFromNormalizedImport as typeof bootstrap
    resolveLeagueIdentity = (
      await import('@/lib/chimmy-context/providers/_helpers/leagueIdentity')
    ).resolveLeagueIdentity as typeof resolveLeagueIdentity
    RosterProvider = (
      await import('@/lib/chimmy-context/providers/RosterContextProvider')
    ).RosterContextProvider as unknown as typeof RosterProvider

    // Importer AppUser linked via the `sleeper_<managerId>` username so the
    // import's resolveImportedManagerUserIds maps their source manager -> AppUser.
    await prisma.appUser.create({
      data: { id: importerId, email: `${importerId}@example.test`, username: `sleeper_${importerSm}` },
    })
    await prisma.league.create({
      data: {
        id: leagueId,
        userId: importerId,
        platform: 'sleeper',
        platformLeagueId: srcLeagueId,
        name: 'C3 Test League',
        sport: 'NFL',
        season: 2026,
      },
    })

    await bootstrap(leagueId, fixture)
  }, 90_000)

  afterAll(async () => {
    // League delete cascades LeagueTeam + Roster; then remove the AppUser.
    try {
      await prisma?.league?.deleteMany({ where: { id: leagueId } })
    } catch {
      /* best-effort cleanup */
    }
    try {
      await prisma?.appUser?.deleteMany({ where: { id: importerId } })
    } catch {
      /* best-effort cleanup */
    }
    try {
      await prisma?.$disconnect()
    } catch {
      /* ignore */
    }
  }, 30_000)

  it('claims the linked importer team and preserves the raw source manager id', async () => {
    const t1 = await prisma.leagueTeam.findUnique({
      where: { leagueId_externalId: { leagueId, externalId: team1 } },
      select: { claimedByUserId: true, platformUserId: true },
    })
    expect(t1?.claimedByUserId).toBe(importerId)
    expect(t1?.platformUserId).toBe(importerSm)
  })

  it('leaves the unlinked manager team unclaimed', async () => {
    const t2 = await prisma.leagueTeam.findUnique({
      where: { leagueId_externalId: { leagueId, externalId: team2 } },
      select: { claimedByUserId: true, platformUserId: true },
    })
    expect(t2?.claimedByUserId ?? null).toBeNull()
    expect(t2?.platformUserId).toBe(otherSm)
  })

  it('creates a Roster for the resolved importer id', async () => {
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: importerId },
      select: { id: true },
    })
    expect(roster).not.toBeNull()
  })

  it('resolveLeagueIdentity returns the importer team for the importer', async () => {
    const identity = await resolveLeagueIdentity({
      userId: importerId,
      leagueId,
      perRequestMemo: new Map(),
    })
    expect(identity).not.toBeNull()
    // team.platformUserId holds the RAW source manager id.
    expect(identity?.platformUserId).toBe(importerSm)
  })

  it('RosterContextProvider grounds on the real imported starters/bench (not empty)', async () => {
    const result = await new RosterProvider().load({
      userId: importerId,
      leagueId,
      perRequestMemo: new Map(),
    })
    expect(result.ok).toBe(true)
    expect(result.data).not.toBeNull()
    expect(result.data.starters.length).toBeGreaterThan(0)
    expect(result.data.starters.length + result.data.bench.length).toBeGreaterThan(0)
  })

  it('a different user cannot receive the importer roster', async () => {
    const identity = await resolveLeagueIdentity({
      userId: strangerId,
      leagueId,
      perRequestMemo: new Map(),
    })
    expect(identity?.platformUserId ?? null).toBeNull()
    const result = await new RosterProvider().load({
      userId: strangerId,
      leagueId,
      perRequestMemo: new Map(),
    })
    const total =
      (result.data?.starters?.length ?? 0) + (result.data?.bench?.length ?? 0)
    expect(total).toBe(0)
  })

  it('idempotent reimport preserves the claim', async () => {
    await bootstrap(leagueId, fixture)
    const t1 = await prisma.leagueTeam.findUnique({
      where: { leagueId_externalId: { leagueId, externalId: team1 } },
      select: { claimedByUserId: true, platformUserId: true },
    })
    expect(t1?.claimedByUserId).toBe(importerId)
    expect(t1?.platformUserId).toBe(importerSm)
  })
})
