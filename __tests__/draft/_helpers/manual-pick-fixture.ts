/**
 * Test fixture helper for Phase 2 — manual pick submission tests.
 *
 * Seeds an in-progress NFL redraft snake draft directly via Prisma so
 * `PickSubmissionService.submitPick` has a real session + slot order + roster
 * config to operate on. Each call returns:
 *   - `leagueId` to feed into submitPick
 *   - the slot-1 rosterId so the test can submit picks "as the on-clock manager"
 *   - the seeded SportsPlayer pool (a few real NFL players) so duplicate-pick
 *     and roster-fit edge cases use real data
 *   - a `cleanup()` function that deletes everything seeded, in FK-safe order
 *
 * Each fixture instance uses a unique platformLeagueId so tests can run in
 * parallel without colliding on the (userId, platform, platformLeagueId, season)
 * unique constraint.
 *
 * Marker: every seeded League has `platform='af-test-pick-submission'` and a
 * name prefixed with 'AF Phase 2 Pick' so a stray cleanup script can sweep
 * orphan fixtures left by failed runs.
 */
import { PrismaClient, type Prisma } from '@prisma/client'

export const TEST_PLATFORM = 'af-test-pick-submission'
const TEST_LEAGUE_NAME_PREFIX = 'AF Phase 2 Pick'

export interface ManualPickFixture {
  leagueId: string
  sessionId: string
  slot1RosterId: string
  slot2RosterId: string
  slot3RosterId: string
  slot4RosterId: string
  /** A handful of real NFL player rows to draft. */
  sampleRoster: { name: string; position: string; team: string }[]
  cleanup: () => Promise<void>
}

export interface SeedManualPickFixtureOptions {
  prisma: PrismaClient
  /** Override the on-the-clock state — defaults to fresh in-progress, no picks yet. */
  preseedPicks?: Array<{
    overall: number
    round: number
    slot: number
    rosterId: string
    playerName: string
    position: string
    team?: string | null
  }>
  /** When provided, seed `League.starters` with this. Pass `null` to leave it null
   *  and exercise the incomplete-roster path explicitly. Defaults to a complete NFL set. */
  starters?: string[] | null
  /** Sport/season — defaults to NFL/2026. Other sports work via the same helper. */
  sport?: string
  season?: number
}

const DEFAULT_NFL_STARTERS = [
  'QB',
  'RB',
  'RB',
  'WR',
  'WR',
  'TE',
  'FLEX',
  'K',
  'DST',
] as const

const SLOTS = [
  { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
  { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
  { slot: 3, rosterId: 'roster-3', displayName: 'Gamma' },
  { slot: 4, rosterId: 'roster-4', displayName: 'Delta' },
] as const

/**
 * Sample SportsPlayer rows used by the test as known-valid pickable players.
 * They're real names so the resolver doesn't reject them, but the test does NOT
 * depend on them being in the resolved pool — submitPick validates against
 * `session.picks` for duplicates, not against the pool.
 */
const SAMPLE_ROSTER = [
  { name: 'Phase2 Sample QB One', position: 'QB', team: 'KC' },
  { name: 'Phase2 Sample RB One', position: 'RB', team: 'PHI' },
  { name: 'Phase2 Sample WR One', position: 'WR', team: 'CIN' },
  { name: 'Phase2 Sample TE One', position: 'TE', team: 'SF' },
] as const

let fixtureCounter = 0

export async function seedManualPickFixture(
  options: SeedManualPickFixtureOptions,
): Promise<ManualPickFixture> {
  const { prisma } = options
  const sport = options.sport ?? 'NFL'
  const season = options.season ?? 2026
  const starters =
    options.starters === undefined
      ? [...DEFAULT_NFL_STARTERS]
      : options.starters
  const preseedPicks = options.preseedPicks ?? []

  fixtureCounter += 1
  const uniqueId = `${Date.now()}-${fixtureCounter}-${Math.random().toString(36).slice(2, 8)}`
  const userId = `phase2-pick-user-${uniqueId}`
  const leagueName = `${TEST_LEAGUE_NAME_PREFIX} #${uniqueId}`
  const platformLeagueId = `${TEST_PLATFORM}-${uniqueId}`

  // 1. Synthetic AppUser so League.userId FK holds.
  await prisma.appUser.create({
    data: {
      id: userId,
      email: `${userId}@allfantasy.test`,
      username: userId,
      displayName: 'Phase 2 Test User',
    },
  })

  // 2. League. Starters either populated (default) or null/empty (for the
  //    ROSTER_CONFIGURATION_INCOMPLETE acceptance criterion).
  const league = await prisma.league.create({
    data: {
      userId,
      platform: TEST_PLATFORM,
      platformLeagueId,
      name: leagueName,
      sport: sport as Prisma.LeagueCreateInput['sport'],
      season,
      scoring: 'ppr',
      leagueSize: SLOTS.length,
      isDynasty: false,
      leagueVariant: 'redraft',
      ...(starters && starters.length > 0
        ? { starters: starters as unknown as Prisma.InputJsonValue }
        : {}),
    },
  })

  // 3. DraftSession in-progress with a snake draftType.
  const now = new Date()
  const timerEndAt = new Date(now.getTime() + 90_000)
  const session = await prisma.draftSession.create({
    data: {
      leagueId: league.id,
      status: 'in_progress',
      draftType: 'snake',
      rounds: 4,
      teamCount: SLOTS.length,
      timerSeconds: 90,
      timerEndAt,
      slotOrder: SLOTS as unknown as Prisma.InputJsonValue,
      sessionKind: 'live',
      sportType: sport,
      startedAt: now,
      currentRoundNum: 1,
      nextOverallPick: preseedPicks.length + 1,
    },
  })

  // 4. Optional preseeded picks for tests that need a non-empty board.
  if (preseedPicks.length > 0) {
    await prisma.draftPick.createMany({
      data: preseedPicks.map((p) => ({
        sessionId: session.id,
        overall: p.overall,
        round: p.round,
        slot: p.slot,
        rosterId: p.rosterId,
        playerName: p.playerName,
        position: p.position,
        team: p.team ?? null,
        playerId: `preseed:${p.playerName}`,
        assetType: 'player',
        source: 'auto',
        sportType: sport,
        pickedAt: new Date(now.getTime() - 60_000 * (preseedPicks.length - p.overall)),
      })),
    })
  }

  return {
    leagueId: league.id,
    sessionId: session.id,
    slot1RosterId: SLOTS[0].rosterId,
    slot2RosterId: SLOTS[1].rosterId,
    slot3RosterId: SLOTS[2].rosterId,
    slot4RosterId: SLOTS[3].rosterId,
    sampleRoster: [...SAMPLE_ROSTER],
    async cleanup() {
      // FK order: DraftPick → DraftSession → League → AppUser
      await prisma.draftPick.deleteMany({ where: { sessionId: session.id } })
      await prisma.draftSession.deleteMany({ where: { leagueId: league.id } })
      await prisma.league.deleteMany({ where: { id: league.id } })
      await prisma.appUser.deleteMany({ where: { id: userId } })
    },
  }
}

/**
 * Sweep helper — call from a script if cleanup() ever fails to remove a fixture
 * (e.g. test process killed mid-run). Deletes every league with our test
 * platform marker plus their downstream rows.
 */
export async function sweepManualPickFixtureLeftovers(prisma: PrismaClient): Promise<void> {
  const leagues = await prisma.league.findMany({
    where: { platform: TEST_PLATFORM },
    select: { id: true, userId: true },
  })
  if (leagues.length === 0) return
  const leagueIds = leagues.map((l) => l.id)
  const userIds = [...new Set(leagues.map((l) => l.userId))]
  const sessions = await prisma.draftSession.findMany({
    where: { leagueId: { in: leagueIds } },
    select: { id: true },
  })
  const sessionIds = sessions.map((s) => s.id)
  if (sessionIds.length > 0) {
    await prisma.draftPick.deleteMany({ where: { sessionId: { in: sessionIds } } })
    await prisma.draftSession.deleteMany({ where: { id: { in: sessionIds } } })
  }
  await prisma.league.deleteMany({ where: { id: { in: leagueIds } } })
  await prisma.appUser.deleteMany({ where: { id: { in: userIds } } })
}
