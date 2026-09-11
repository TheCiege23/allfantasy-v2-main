/**
 * Scout applies the manager-psychology gate.
 *
 * ── 🛑 WHY THIS EXISTS SEPARATELY FROM `opponent-gate.test.ts` ──────────────
 *
 * That file asserts the FEATURE CHECK discriminates — Pro yes, Commissioner no,
 * lapsed no. This file asserts a CONSUMER actually calls it. Those are different
 * failures, and the second is the one that has actually happened here: the first
 * version of `lib/core-app/scout.ts` read `lib/decision-os/psychology-os`
 * directly, which is a clean cached feed that performs no entitlement check at
 * all, and handed every opponent's labels, scores and trajectory to every caller.
 *
 * A perfect gate that a new surface routes around is not a gate. `ProfileAccess`
 * exists because all five psych API routes were once completely unauthenticated;
 * reading the OS feed reopens that from a new direction, and NOTHING else catches
 * it — the repo's tsconfig excludes every test and spec pattern, so no test file
 * here is ever typechecked, and a paywall bypass raises no error anywhere.
 *
 * ⚠ EVERY ASSERTION BELOW IS WRITTEN TO BE ABLE TO FAIL. The load-bearing ones
 * check for the ABSENCE of labels/scores/trajectory on a locked card — delete the
 * gate in `scout.ts` and they go red immediately, which is the property an
 * assertion needs before it counts as coverage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  teamFindMany: vi.fn(),
  matchupFindMany: vi.fn(),
  matchupFindFirst: vi.fn(),
  resolveAccess: vi.fn(),
  loadProfiles: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    leagueTeam: { findMany: h.teamFindMany },
    weeklyMatchup: { findMany: h.matchupFindMany, findFirst: h.matchupFindFirst },
  },
}))

vi.mock('@/lib/psychological-profiles/ProfileAccess', () => ({
  resolveProfileAccessForUser: h.resolveAccess,
}))

vi.mock('@/lib/decision-os/psychology-os', () => ({
  createPsychologyOsLoaders: () => ({ loadProfiles: h.loadProfiles, drainOutcomes: () => ({}) }),
}))

/*
 * The opponent lookup is not what this file tests, and a real `currentWeek` would
 * reach for a database the vitest db-guard has pinned to 127.0.0.1:1. Mocked to
 * null so every case below exercises the gate and nothing else.
 */
vi.mock('@/lib/core-app/currentWeek', () => ({
  resolveCurrentWeekForLeague: vi.fn(async () => null),
  resolveCurrentWeek: vi.fn(async () => null),
}))

import { getScoutData } from '@/lib/core-app/scout'

const ME = 'user-1'

/** A profile with enough on it that a leak would be unmistakable. */
const fact = (managerId: string) => ({
  managerId,
  sport: 'NFL',
  labels: ['Win-now', 'Aggressive trader'],
  scores: {
    aggressionScore: 81,
    activityScore: 64,
    tradeFrequencyScore: 77,
    waiverFocusScore: 40,
    riskToleranceScore: 70,
  },
  evidenceCount: 44,
  unmeasuredDimensions: [],
  anySufficient: true,
  updatedAt: '2026-09-01T00:00:00.000Z',
  trajectory: { hasTrajectory: true, summary: 'Rebuilder in 2023, win-now since 2024.', seasonsRecorded: 3 },
})

const team = (externalId: string, over: Record<string, unknown> = {}) => ({
  id: `row-${externalId}`,
  externalId,
  ownerName: `Owner ${externalId}`,
  teamName: `Team ${externalId}`,
  avatarUrl: null,
  wins: 1,
  losses: 0,
  ties: 0,
  claimedByUserId: null,
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  h.leagueFindUnique.mockResolvedValue({
    id: 'lg1',
    name: 'The Gauntlet',
    sport: 'NFL',
    platformLeagueId: 'plat1',
  })
  h.teamFindMany.mockResolvedValue([
    team('mine', { claimedByUserId: ME }),
    team('rival'),
  ])
  h.matchupFindMany.mockResolvedValue([])
  h.loadProfiles.mockResolvedValue([fact('mine'), fact('rival')])
})

/** Pull one manager out of a successful result. */
async function scoutFor(access: unknown) {
  h.resolveAccess.mockResolvedValue(access)
  const data = await getScoutData('lg1', ME)
  if (!data) throw new Error('expected scout data')
  return data
}

const granted = (over: Record<string, unknown> = {}) => ({
  ok: true,
  userId: ME,
  ownManagerIds: new Set(['mine', 'row-mine']),
  canSeeOpponents: false,
  ...over,
})

describe('Scout refuses a non-member outright', () => {
  it('names no manager at all when membership is denied', async () => {
    const data = await scoutFor({ ok: false, status: 403, reason: 'not a member' })

    expect(data.managers.available).toBe(false)
    expect(data.coverage.profiledCount).toBe(0)

    /*
     * The strongest assertion in the file: the whole payload must not contain a
     * profiled manager's name or label anywhere. `leagueId` arrives from the URL,
     * so a loader that trusts the page to have gated it leaks a character read on
     * a named person in a league the caller is not in.
     */
    const serialized = JSON.stringify(data)
    expect(serialized).not.toContain('rival')
    expect(serialized).not.toContain('Aggressive trader')
  })

  it('does not even read the profiles', async () => {
    await scoutFor({ ok: false, status: 401, reason: 'signed out' })
    expect(h.loadProfiles).not.toHaveBeenCalled()
  })
})

describe('Scout locks every characterisation, entitlement or not', () => {
  /**
   * 🛑 THIS BLOCK USED TO ASSERT "gives you your own profile free". Milestone 32 removed the
   * `isSelf || access.canSeeOpponents` branch from `lib/core-app/scout.ts` entirely — its own
   * comment says "no caller reaches the characterisation here, the manager themselves included",
   * because an entitlement "decides who PAYS, not what a raw dossier is".
   *
   * ⚠ SO A SELF-READ IS NOW LOCKED TOO, AND THAT IS THE CHANGE RATHER THAN A REGRESSION. Restoring
   * `available: true` for `isYou` would re-open the exact exposure the milestone closes, on the one
   * path people most readily assume is safe.
   */
  it('locks your OWN profile too — self is not a carve-out', async () => {
    const data = await scoutFor(granted())
    const mine = (data.managers.available ? data.managers.data : []).find((m) => m.isYou)

    expect(mine?.profile.available).toBe(false)
    if (mine && !mine.profile.available) expect(mine.profile.locked).toBe(true)

    /*
     * ⚠ ON THE SERIALIZED PAYLOAD, for the same reason the opponent case does it: a refactor that
     * reintroduced the characterisation under another key would pass a property check and still
     * ship the leak. Your own labels and scores must not cross either.
     */
    const serialized = JSON.stringify(mine)
    expect(serialized).not.toContain('Win-now')
    expect(serialized).not.toContain('81')
  })

  it('locks the opponent without revealing anything that characterises them', async () => {
    const data = await scoutFor(granted())
    const rival = (data.managers.available ? data.managers.data : []).find((m) => !m.isYou)

    expect(rival?.profile.available).toBe(false)
    if (rival && !rival.profile.available) {
      expect(rival.profile.locked).toBe(true)

      /*
       * Coverage survives the lock and characterisation does not — the same split
       * `redactForLock` makes. "44 observations" says nothing about the person.
       */
      if (rival.profile.locked) expect(rival.profile.evidenceCount).toBe(44)
    }

    /*
     * ⚠ ASSERTED ON THE SERIALIZED PAYLOAD, NOT ON THE SHAPE. A future refactor
     * that adds the labels back under a different key would satisfy a
     * property-by-property check and still ship the leak.
     */
    const serialized = JSON.stringify(rival)
    expect(serialized).not.toContain('Aggressive trader')
    expect(serialized).not.toContain('Win-now')
    expect(serialized).not.toContain('Rebuilder in 2023')
    expect(serialized).not.toContain('81')
  })

  it('counts a locked profile as PROFILED, not as a coverage gap', async () => {
    const data = await scoutFor(granted())

    /*
     * Coverage is unchanged in meaning and changed in number: both managers are still PROFILED —
     * a lock is not a gap, or a paywall would make a working profiler look broken — but both are
     * now locked rather than one, because self is no longer a carve-out.
     */
    expect(data.coverage.profiledCount).toBe(2)
    expect(data.coverage.teamCount).toBe(2)
    expect(data.coverage.lockedCount).toBe(2)
  })
})

describe('Scout does NOT open up for an entitled member', () => {
  /**
   * 🛑 THE INVERSION THAT MATTERS MOST IN THIS FILE. This test was called "returns the opponent in
   * full" and asserted that `canSeeOpponents` unlocked the characterisation. Under Milestone 32 an
   * entitlement no longer buys a raw dossier — `scout.ts` dropped the branch entirely.
   *
   * ⚠ AN ENTITLED CALLER IS THE STRONGEST CASE TO PIN, because it is the one a well-meaning change
   * would "restore" first: the paying user appears to be owed the data. Asserting the lock HOLDS
   * under entitlement is what stops the exposure being reopened as a bug fix.
   */
  it('keeps the opponent locked even WITH canSeeOpponents — an entitlement is not an exception', async () => {
    const data = await scoutFor(granted({ canSeeOpponents: true }))
    const rival = (data.managers.available ? data.managers.data : []).find((m) => !m.isYou)

    expect(rival?.profile.available).toBe(false)
    if (rival && !rival.profile.available) expect(rival.profile.locked).toBe(true)

    const serialized = JSON.stringify(rival)
    expect(serialized).not.toContain('Aggressive trader')
    expect(serialized).not.toContain('Rebuilder in 2023')

    expect(data.coverage.lockedCount).toBe(2)
  })
})

describe('Scout separates "not profiled" from "locked"', () => {
  it('reports an unprofiled manager as our gap, unlocked', async () => {
    // The rival has no profile at all; the caller is unentitled either way.
    h.loadProfiles.mockResolvedValue([fact('mine')])
    const data = await scoutFor(granted())
    const rival = (data.managers.available ? data.managers.data : []).find((m) => !m.isYou)

    expect(rival?.profile.available).toBe(false)
    if (rival && !rival.profile.available) {
      /*
       * NOT locked. Our missing data reported as a paywall would sell a capability
       * we cannot currently deliver; a paywall reported as missing data makes a
       * working profiler look broken. They are different sentences on the screen.
       */
      expect(rival.profile.locked).toBe(false)
      expect(rival.profile.reason).toMatch(/no profile yet/i)
    }
    /*
     * ⚠ `lockedCount` is 1, not 0 — YOUR OWN profile is the locked one now. The distinction this
     * test exists to protect is untouched: the rival is an honest coverage GAP (unlocked, "no
     * profile yet"), while a lock is a refusal. Both still count as profiled/unprofiled correctly;
     * only self's lock is new.
     */
    expect(data.coverage.profiledCount).toBe(1)
    expect(data.coverage.lockedCount).toBe(1)
  })

  it('says the league is uncovered when the feed holds nothing', async () => {
    h.loadProfiles.mockResolvedValue(null)
    const data = await scoutFor(granted())
    const any = (data.managers.available ? data.managers.data : [])[0]

    expect(any?.profile.available).toBe(false)
    if (any && !any.profile.available) {
      expect(any.profile.reason).toMatch(/runs on a schedule/i)
    }
    expect(data.coverage.profiledCount).toBe(0)
    expect(data.coverage.lastRefreshedAt).toBeNull()
  })
})
