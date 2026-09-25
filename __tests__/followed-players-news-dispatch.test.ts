// @vitest-environment node
/**
 * Player news → followers (user decisions, 2026-09-14). The pending-news dispatcher already
 * told rostering managers; followers now hear about the same stories under their own
 * `followed_players` switch — minus anyone already told through a roster, so one story is
 * never two buzzes.
 *
 * The sweep is now eligibility → identity → recipients → delivery state → settle, and the
 * follower lookup sits AFTER identity resolves: one dispatch per follower, no league, under the
 * same content-hash dedupe prefix as the roster path. Only the STORE, the DISPATCHER and the
 * follow lookup are mocked — the classifier, eligibility policy, identity/ownership resolvers,
 * delivery state and retry ledger are the real ones, the same seams as
 * `__tests__/notifications/pending-player-news-dispatch.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  newsFind: vi.fn(),
  newsUpdate: vi.fn(),
  identityFindFirst: vi.fn(),
  identityFindMany: vi.fn(),
  rosterFind: vi.fn(),
  profileFind: vi.fn(),
  rawQuery: vi.fn(),
  cacheFindUnique: vi.fn(),
  cacheUpsert: vi.fn(),
  notifFind: vi.fn(),
  dispatch: vi.fn(),
  followers: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: { findMany: h.newsFind, updateMany: h.newsUpdate },
    playerIdentityMap: { findFirst: h.identityFindFirst, findMany: h.identityFindMany },
    redraftRosterPlayer: { findMany: h.rosterFind },
    userProfile: { findMany: h.profileFind },
    sportsDataCache: { findUnique: h.cacheFindUnique, upsert: h.cacheUpsert },
    platformNotification: { findMany: h.notifFind },
    $queryRawUnsafe: h.rawQuery,
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/follows/playerFollows', () => ({ listFollowerIdsForPlayer: h.followers }))

import { dispatchPendingPlayerNewsNotifications } from '@/lib/notifications/PlayerNewsNotificationService'
import { playerNewsContentHash } from '@/lib/notifications/playerNewsAttemptLedger'
import { playerNewsDedupePrefix } from '@/lib/notifications/playerNewsDeliveryState'

// "ruled out" is strong injury evidence to the real classifier, so this row is an injury.
const ROW = {
  id: 'news-1',
  sport: 'NFL',
  playerId: null,
  playerName: 'Jahmyr Gibbs',
  team: 'DET',
  headline: 'Gibbs (hamstring) ruled out Sunday',
  body: null,
  impact: 'medium',
}

/** One unambiguous identity with a Sleeper id, so the native roster store IS searched. */
const IDENTITY = {
  id: 'idn-gibbs',
  sport: 'NFL',
  canonicalName: 'Jahmyr Gibbs',
  currentTeam: 'DET',
  sleeperId: '9221',
  rollingInsightsId: null,
  apiSportsId: null,
  espnId: null,
  fantraxId: null,
  mflId: null,
  fleaflickerId: null,
  cfbdId: null,
  fantasyCalcId: null,
}

const roster = (ownerId: string, leagueId: string) => ({ roster: { ownerId, leagueId } })

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.newsFind.mockResolvedValue([ROW])
  h.newsUpdate.mockResolvedValue({ count: 1 })
  h.identityFindFirst.mockResolvedValue(null)
  h.identityFindMany.mockResolvedValue([IDENTITY])
  h.rosterFind.mockResolvedValue([])
  h.profileFind.mockResolvedValue([])
  h.rawQuery.mockResolvedValue([])
  h.cacheFindUnique.mockResolvedValue(null)
  h.cacheUpsert.mockResolvedValue({})
  h.notifFind.mockResolvedValue([])
  h.dispatch.mockResolvedValue({ requested: 1, suppressed: 0, delivered: 1, failed: 0 })
  h.followers.mockResolvedValue([])
})

const calls = () => h.dispatch.mock.calls.map((c) => c[0])
const followerCalls = () => calls().filter((p) => p.category === 'followed_players')
const rosterCalls = () => calls().filter((p) => p.category !== 'followed_players')
/** The ids passed to the terminal stamp, across every updateMany call. */
const stampedIds = () => h.newsUpdate.mock.calls.flatMap((c) => c[0]?.where?.id?.in ?? [])

describe('followers of a player in the news', () => {
  it('🛑 a follower who rosters him nowhere is told, under followed_players, with no league', async () => {
    h.followers.mockResolvedValue(['fan-1'])
    const out = await dispatchPendingPlayerNewsNotifications({ lookbackHours: 6 })

    expect(h.followers).toHaveBeenCalledWith('NFL', 'Jahmyr Gibbs')
    expect(followerCalls()).toHaveLength(1)
    expect(followerCalls()[0]).toMatchObject({
      userIds: ['fan-1'],
      category: 'followed_players',
      type: 'player_injury_update',
      leagueId: null,
      severity: 'high',
      // The rewrite's content-hash prefix — no longer the bare `player-news:<id>`.
      dedupePrefix: playerNewsDedupePrefix('news-1', playerNewsContentHash(ROW.headline, ROW.body)),
      meta: expect.objectContaining({ followed: true, playerIdentityId: 'idn-gibbs' }),
    })
    // A follow belongs to no league, so no league set rides along for a mute check to act on.
    expect(followerCalls()[0]).not.toHaveProperty('leagueIds')
    expect(rosterCalls()).toHaveLength(0)
    expect(out).toMatchObject({ notified: 1, recipients: 1, followerRecipients: 1, noRoster: 0 })
  })

  it('🛑 a manager who rosters AND follows him gets the roster alert only — never two', async () => {
    h.rosterFind.mockResolvedValue([roster('mgr-1', 'lg-1'), roster('mgr-2', 'lg-1')])
    h.followers.mockResolvedValue(['mgr-1', 'fan-1'])
    const out = await dispatchPendingPlayerNewsNotifications()

    // One dispatch per user now, so "never two" is: mgr-1 appears in exactly ONE call, and it is
    // the roster one — the roster path wins because it carries the league.
    const mgr1 = calls().filter((p) => p.userIds.includes('mgr-1'))
    expect(mgr1).toHaveLength(1)
    expect(mgr1[0]).toMatchObject({ category: 'injury_alerts', leagueIds: ['lg-1'] })

    expect(rosterCalls().flatMap((p) => p.userIds).sort()).toEqual(['mgr-1', 'mgr-2'])
    expect(followerCalls()).toHaveLength(1)
    expect(followerCalls()[0].userIds).toEqual(['fan-1'])
    expect(out).toMatchObject({ recipients: 3, followerRecipients: 1, dispatchAttempted: 3, notified: 1 })
  })

  it('🛑 follows unavailable (null) sends to followers nobody and is not an error', async () => {
    h.rosterFind.mockResolvedValue([roster('mgr-1', 'lg-1')])
    h.followers.mockResolvedValue(null)
    const out = await dispatchPendingPlayerNewsNotifications()

    expect(followerCalls()).toHaveLength(0)
    expect(out).toMatchObject({ notified: 1, recipients: 1, followerRecipients: 0, dispatchFailed: 0 })
    // Not an error: the roster delivery settles terminally like any other.
    expect(stampedIds()).toEqual(['news-1'])
  })

  it('a follower lookup that throws is treated like no followers, and roster managers are still told', async () => {
    h.rosterFind.mockResolvedValue([roster('mgr-1', 'lg-1')])
    h.followers.mockRejectedValue(new Error('db down'))
    const out = await dispatchPendingPlayerNewsNotifications()

    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][0]).toMatchObject({ category: 'injury_alerts', userIds: ['mgr-1'] })
    expect(out).toMatchObject({ followerRecipients: 0, dispatchFailed: 0 })
  })

  it('low-impact news that is not an injury reaches neither roster nor followers', async () => {
    // No keyword in any category → `player_news`, which is not material; at low impact the
    // eligibility policy skips it before identity — and so before the follower lookup.
    h.newsFind.mockResolvedValue([{ ...ROW, impact: 'low', headline: 'Gibbs speaks to reporters after practice' }])
    h.rosterFind.mockResolvedValue([roster('mgr-1', 'lg-1')])
    h.followers.mockResolvedValue(['fan-1'])
    const out = await dispatchPendingPlayerNewsNotifications()

    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.followers).not.toHaveBeenCalled()
    expect(out).toMatchObject({ notified: 0, policySkipped: 1 })
  })

  it('high-impact non-injury news goes to followers as player news, not an injury', async () => {
    /*
     * The old fixture here was "Gibbs traded to Dallas". Under the confirmed-only trade rule that
     * is an UNCONFIRMED trade and is policy-skipped whatever its impact, so it no longer reaches
     * this path at all. A retirement is `player_news` — not a material roster category — so it is
     * the high impact alone that makes it eligible: the exact counterpart of the case above.
     */
    h.newsFind.mockResolvedValue([{ ...ROW, impact: 'high', headline: 'Gibbs announces his retirement' }])
    h.followers.mockResolvedValue(['fan-1'])
    await dispatchPendingPlayerNewsNotifications()

    expect(followerCalls()).toHaveLength(1)
    expect(followerCalls()[0]).toMatchObject({
      category: 'followed_players',
      type: 'player_news_update',
      severity: 'medium',
      meta: expect.objectContaining({ newsCategory: 'player_news', eligibilityReason: 'high-impact' }),
    })
  })

  it('no roster and no follower counts as noRoster, and the row is still stamped', async () => {
    /*
     * GENUINE no-roster: the identity resolved, its Sleeper id WAS searched, the query succeeded
     * and came back empty, and the follower lookup found nobody. That settles `no-roster`, which
     * is TERMINAL — a manager who adds him tomorrow does not need yesterday's headline — so the
     * row IS stamped and not scheduled for retry.
     *
     * ⚠ This is deliberately the only empty-audience case that stamps. A failed roster query
     * (`recipients-unavailable`) or an identity with no searchable id (`no-searchable-identity`)
     * stays retryable; the zero counters below are what pin this run to the terminal branch.
     */
    const out = await dispatchPendingPlayerNewsNotifications()

    expect(h.followers).toHaveBeenCalledWith('NFL', 'Jahmyr Gibbs')
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(out).toMatchObject({
      notified: 0,
      noRoster: 1,
      scanned: 1,
      recipientsUnavailable: 0,
      recipientsUnsearchable: 0,
      retryScheduled: 0,
    })
    expect(h.newsUpdate).toHaveBeenCalledWith({ where: { id: { in: ['news-1'] } }, data: expect.any(Object) })
  })
})
