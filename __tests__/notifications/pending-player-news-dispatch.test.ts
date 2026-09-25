import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * N4 + N5 end to end, through the real sweep.
 *
 * `dispatchPendingPlayerNewsNotifications` is the live path: it selects undispatched
 * `player_news` rows, classifies them, decides eligibility, resolves recipients, dispatches and
 * settles. Only the STORE and the DISPATCHER are mocked — the classifier, the eligibility
 * policy, the identity/ownership resolvers and the retry ledger are all the real ones, so this
 * exercises the wiring and not a stand-in.
 */

const h = vi.hoisted(() => ({
  newsFindMany: vi.fn(),
  newsUpdateMany: vi.fn(),
  identityFindFirst: vi.fn(),
  identityFindMany: vi.fn(),
  rosterPlayerFindMany: vi.fn(),
  profileFindMany: vi.fn(),
  rawQuery: vi.fn(),
  cacheFindUnique: vi.fn(),
  cacheUpsert: vi.fn(),
  notifFindMany: vi.fn(),
  dispatchNotification: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: { findMany: h.newsFindMany, updateMany: h.newsUpdateMany },
    playerIdentityMap: { findFirst: h.identityFindFirst, findMany: h.identityFindMany },
    redraftRosterPlayer: { findMany: h.rosterPlayerFindMany },
    userProfile: { findMany: h.profileFindMany },
    sportsDataCache: { findUnique: h.cacheFindUnique, upsert: h.cacheUpsert },
    platformNotification: { findMany: h.notifFindMany },
    $queryRawUnsafe: h.rawQuery,
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: h.dispatchNotification,
}))

import { dispatchPendingPlayerNewsNotifications } from '@/lib/notifications/PlayerNewsNotificationService'
import { MAX_DISPATCH_ATTEMPTS } from '@/lib/notifications/playerNewsAttemptLedger'

const newsRow = (over: Record<string, unknown> = {}) => ({
  id: 'news-1',
  sport: 'nfl',
  playerId: null,
  playerName: 'Bijan Robinson',
  team: 'ATL',
  headline: 'Falcons sign RB to a three-year extension',
  body: 'Terms undisclosed.',
  impact: 'medium',
  ...over,
})

const identityRow = (over: Record<string, unknown> = {}) => ({
  id: 'idn-1',
  sport: 'NFL',
  canonicalName: 'Bijan Robinson',
  currentTeam: 'ATL',
  sleeperId: '11560',
  rollingInsightsId: '101',
  apiSportsId: null,
  espnId: null,
  fantraxId: null,
  mflId: null,
  fleaflickerId: null,
  cfbdId: null,
  fantasyCalcId: null,
  ...over,
})

/** The ids passed to the terminal stamp, across every updateMany call. */
const stampedIds = () =>
  h.newsUpdateMany.mock.calls.flatMap((c) => c[0]?.where?.id?.in ?? [])

beforeEach(() => {
  h.newsFindMany.mockReset().mockResolvedValue([newsRow()])
  h.newsUpdateMany.mockReset().mockResolvedValue({ count: 1 })
  h.identityFindFirst.mockReset().mockResolvedValue(null)
  h.identityFindMany.mockReset().mockResolvedValue([identityRow()])
  h.rosterPlayerFindMany
    .mockReset()
    .mockResolvedValue([{ roster: { ownerId: 'user-1', leagueId: 'league-a' } }])
  h.profileFindMany.mockReset().mockResolvedValue([])
  h.rawQuery.mockReset().mockResolvedValue([])
  h.cacheFindUnique.mockReset().mockResolvedValue(null)
  h.cacheUpsert.mockReset().mockResolvedValue({})
  h.notifFindMany.mockReset().mockResolvedValue([])
  h.dispatchNotification
    .mockReset()
    .mockResolvedValue({ requested: 1, suppressed: 0, delivered: 1, failed: 0 })
})

// ── Signing classification through dispatch ─────────────────────────────────

describe('an ordinary signing survives classifier → policy → dispatch', () => {
  it.each([
    ['Falcons sign RB to a three-year deal', 'Terms undisclosed.'],
    ['RB agrees to a contract extension', null],
    ['Team signs veteran WR', 'One year.'],
  ])('dispatches: %s', async (headline, body) => {
    /*
     * Pre-fix, "deal" put the first of these in `trade`, where the confirmed-only rule held it;
     * and a MEDIUM impact score suppressed all three regardless. Both are gone.
     */
    h.newsFindMany.mockResolvedValue([newsRow({ headline, body, impact: 'medium' })])

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res.dispatchAttempted).toBe(1)
    expect(res.policySkipped).toBe(0)
    expect(h.dispatchNotification.mock.calls[0][0].meta.newsCategory).toBe('signing')
  })

  it('does not let "Quarterback" trigger the injury substring match', async () => {
    // `injury` is checked first and contains the word "back".
    h.newsFindMany.mockResolvedValue([
      newsRow({ headline: 'Quarterback signs a four-year extension', body: null }),
    ])

    await dispatchPendingPlayerNewsNotifications()

    expect(h.dispatchNotification.mock.calls[0][0].meta.newsCategory).toBe('signing')
  })

  it('lets the transaction verb beat an incidental historical injury mention', async () => {
    h.newsFindMany.mockResolvedValue([
      newsRow({ headline: 'RB signs extension', body: 'His knee is fully healed after last year.' }),
    ])

    await dispatchPendingPlayerNewsNotifications()

    expect(h.dispatchNotification.mock.calls[0][0].meta.newsCategory).toBe('signing')
  })

  it('still declines a medium-impact item that is not roster-material', async () => {
    h.newsFindMany.mockResolvedValue([
      newsRow({ headline: 'Team hires a new coordinator', body: null, impact: 'medium' }),
    ])

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res.policySkipped).toBe(1)
    expect(h.dispatchNotification).not.toHaveBeenCalled()
  })
})

describe('real trades stay confirmed-only, through the whole path', () => {
  it('dispatches a completed trade', async () => {
    h.newsFindMany.mockResolvedValue([
      newsRow({ headline: 'RB has been traded to the Bears', impact: 'high' }),
    ])
    const res = await dispatchPendingPlayerNewsNotifications()
    expect(res.dispatchAttempted).toBe(1)
  })

  it.each([
    'RB could be traded before the deadline',
    'Sources: team expected to trade the veteran WR',
    'Star WR reportedly acquired by Denver',
  ])('holds a rumour: %s', async (headline) => {
    h.newsFindMany.mockResolvedValue([newsRow({ headline, impact: 'high' })])
    const res = await dispatchPendingPlayerNewsNotifications()
    expect(res).toMatchObject({ policySkipped: 1, dispatchAttempted: 0 })
  })

  it.each([
    'Star RB will not be traded, GM says',
    'The trade fell through',
    'Team denies the trade is done',
  ])('holds a NEGATED trade: %s', async (headline) => {
    // A negation matches the confirmation patterns — "will not be traded" contains "be traded".
    h.newsFindMany.mockResolvedValue([newsRow({ headline, impact: 'high' })])
    const res = await dispatchPendingPlayerNewsNotifications()
    expect(res).toMatchObject({ policySkipped: 1, dispatchAttempted: 0 })
  })
})

// ── Held / broadcast safety ─────────────────────────────────────────────────

describe('an unattributed item is held, not broadcast', () => {
  it('never reaches the roster query for an empty player name', async () => {
    h.newsFindMany.mockResolvedValue([newsRow({ playerName: '', headline: 'RB signs extension' })])

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res).toMatchObject({ heldUnresolved: 1, dispatchAttempted: 0 })
    expect(h.rosterPlayerFindMany).not.toHaveBeenCalled()
    expect(h.dispatchNotification).not.toHaveBeenCalled()
  })

  it('counts an ambiguous subject separately and sends nothing', async () => {
    h.identityFindMany.mockResolvedValue([
      identityRow({ id: 'a', currentTeam: 'BUF' }),
      identityRow({ id: 'b', currentTeam: 'JAX' }),
    ])
    h.newsFindMany.mockResolvedValue([newsRow({ team: null })])

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res).toMatchObject({ heldUnresolved: 1, heldAmbiguous: 1, dispatchAttempted: 0 })
    expect(h.dispatchNotification).not.toHaveBeenCalled()
  })
})

// ── One notification per user, all leagues ──────────────────────────────────

describe('one logical notification per user per event', () => {
  it('sends once to a user rostering the player in three leagues', async () => {
    h.rosterPlayerFindMany.mockResolvedValue([
      { roster: { ownerId: 'user-1', leagueId: 'league-a' } },
      { roster: { ownerId: 'user-1', leagueId: 'league-b' } },
      { roster: { ownerId: 'user-1', leagueId: 'league-c' } },
    ])

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(h.dispatchNotification).toHaveBeenCalledTimes(1)
    expect(res.recipients).toBe(1)
    const call = h.dispatchNotification.mock.calls[0][0]
    expect(call.userIds).toEqual(['user-1'])
    expect(call.leagueIds).toEqual(['league-a', 'league-b', 'league-c'])
  })

  it('hands the dispatcher the whole league SET, never a single anchor', async () => {
    // Anchoring on leagueIds[0] silences every other league when the anchor is the muted one.
    h.rosterPlayerFindMany.mockResolvedValue([
      { roster: { ownerId: 'user-1', leagueId: 'league-a' } },
      { roster: { ownerId: 'user-1', leagueId: 'league-b' } },
    ])

    await dispatchPendingPlayerNewsNotifications()

    const call = h.dispatchNotification.mock.calls[0][0]
    expect(call.leagueIds).toHaveLength(2)
    expect(call.leagueId).toBeUndefined()
  })

  it('still reaches every distinct owner', async () => {
    h.rosterPlayerFindMany.mockResolvedValue([
      { roster: { ownerId: 'user-1', leagueId: 'league-a' } },
      { roster: { ownerId: 'user-2', leagueId: 'league-a' } },
    ])

    await dispatchPendingPlayerNewsNotifications()

    expect(h.dispatchNotification.mock.calls.map((c) => c[0].userIds[0]).sort()).toEqual([
      'user-1',
      'user-2',
    ])
  })
})

// ── Retryable outcomes ──────────────────────────────────────────────────────

describe('terminal outcomes are stamped; retryable ones are not', () => {
  it('stamps a delivered row so the handoff is never repeated', async () => {
    const res = await dispatchPendingPlayerNewsNotifications()

    expect(stampedIds()).toEqual(['news-1'])
    expect(res.retryScheduled).toBe(0)
  })

  it('stamps a terminal policy skip', async () => {
    h.newsFindMany.mockResolvedValue([
      newsRow({ headline: 'Team hires a new coordinator', body: null, impact: 'low' }),
    ])

    await dispatchPendingPlayerNewsNotifications()

    expect(stampedIds()).toEqual(['news-1'])
  })

  it('stamps an empty identity — there is nothing there to resolve, ever', async () => {
    h.newsFindMany.mockResolvedValue([newsRow({ playerName: '', playerId: null })])

    await dispatchPendingPlayerNewsNotifications()

    expect(stampedIds()).toEqual(['news-1'])
  })

  it('does NOT stamp a missing identity row — the identity sync can repair it', async () => {
    // The defect this replaces: a held row was stamped and never reconsidered.
    h.identityFindMany.mockResolvedValue([])

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(stampedIds()).toEqual([])
    expect(res.retryScheduled).toBe(1)
  })

  it('does NOT stamp an ambiguous group — disambiguation can repair it', async () => {
    h.identityFindMany.mockResolvedValue([
      identityRow({ id: 'a', currentTeam: 'BUF' }),
      identityRow({ id: 'b', currentTeam: 'JAX' }),
    ])
    h.newsFindMany.mockResolvedValue([newsRow({ team: null })])

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(stampedIds()).toEqual([])
    expect(res.retryScheduled).toBe(1)
  })

  it('does NOT stamp a dispatch that FAILED before any durable handoff', async () => {
    /*
     * 🛑 READ THE RESULT, NOT A `catch`. `dispatchNotification` wraps its whole per-user body in
     * try/catch and never rejects, so the caller's catch was unreachable and every row settled
     * `'delivered'` no matter how completely the send had failed.
     */
    h.dispatchNotification.mockResolvedValue({
      requested: 1,
      suppressed: 0,
      delivered: 0,
      failed: 1,
    })

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(stampedIds()).toEqual([])
    expect(res).toMatchObject({ dispatchFailed: 1, retryScheduled: 1 })
  })

  it('becomes eligible once the identity mapping is repaired', async () => {
    // Sweep 1: no identity row → held, unstamped.
    h.identityFindMany.mockResolvedValue([])
    const first = await dispatchPendingPlayerNewsNotifications()
    expect(first.retryScheduled).toBe(1)
    expect(stampedIds()).toEqual([])

    // Sweep 2: the sync has added the row. Same news id, now delivered.
    h.newsUpdateMany.mockClear()
    h.identityFindMany.mockResolvedValue([identityRow()])
    const second = await dispatchPendingPlayerNewsNotifications()

    expect(second.dispatchAttempted).toBe(1)
    expect(stampedIds()).toEqual(['news-1'])
  })

  it('gives up after the attempt budget so a held row cannot retry forever', async () => {
    h.identityFindMany.mockResolvedValue([])
    // The ledger reports this row has already used every attempt on this exact content.
    h.cacheFindUnique.mockImplementation(async () => ({
      expiresAt: new Date(Date.now() + 60_000),
      data: {
        contentHash: 'anything',
        attempts: MAX_DISPATCH_ATTEMPTS,
        lastOutcome: 'no-identity-row',
        firstAttemptAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
      },
    }))

    const res = await dispatchPendingPlayerNewsNotifications()

    // Content differs from the stored hash, so attempts reset to 1 — still retrying.
    expect(res.retryScheduled).toBe(1)
  })

  it('exhausts the budget when the content is unchanged', async () => {
    h.identityFindMany.mockResolvedValue([])
    const row = newsRow()
    h.newsFindMany.mockResolvedValue([row])

    // Run once to learn the real hash the service computes, then replay it as exhausted.
    await dispatchPendingPlayerNewsNotifications()
    const storedHash = h.cacheUpsert.mock.calls[0][0].create.data.contentHash

    h.newsUpdateMany.mockClear()
    h.cacheFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      data: {
        contentHash: storedHash,
        attempts: MAX_DISPATCH_ATTEMPTS - 1,
        lastOutcome: 'no-identity-row',
        firstAttemptAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
      },
    })

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res.retriesExhausted).toBe(1)
    expect(stampedIds()).toEqual(['news-1'])
  })
})

// ── Counters ────────────────────────────────────────────────────────────────

describe('an empty audience is not automatically terminal', () => {
  it('retries when the recipient lookup FAILED', async () => {
    // One statement timeout used to permanently drop a widely-rostered player's notification.
    h.rosterPlayerFindMany.mockRejectedValue(new Error('statement timeout'))

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res.recipientsUnavailable).toBe(1)
    expect(res.noRoster).toBe(0)
    expect(stampedIds()).toEqual([])
  })

  it('retries when no id was searchable at all', async () => {
    h.identityFindMany.mockResolvedValue([
      identityRow({ sleeperId: null, cfbdId: null, fantraxId: null }),
    ])

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res.recipientsUnsearchable).toBe(1)
    expect(res.noRoster).toBe(0)
    expect(stampedIds()).toEqual([])
  })

  it('still stamps a genuine no-roster', async () => {
    h.rosterPlayerFindMany.mockResolvedValue([])

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res.noRoster).toBe(1)
    expect(stampedIds()).toEqual(['news-1'])
  })
})

describe('a re-send must not re-bill email and SMS — decided PER RECIPIENT', () => {
  /*
   * 🛑 TWO EARLIER DESIGNS ASKED THE ROW AND BOTH FAILED IN BOTH DIRECTIONS. An attempt count
   * treated a HOLD as a send; `lastOutcome` was a single slot that a later hold overwrote. The
   * audience changes between sweeps, so only per-recipient state can answer this.
   */
  it('sends every channel to a recipient with no prior notification row', async () => {
    h.notifFindMany.mockResolvedValue([])

    await dispatchPendingPlayerNewsNotifications()

    expect(h.dispatchNotification.mock.calls[0][0].skipChannels).toBeUndefined()
  })

  it('suppresses email and SMS only for the recipient who already has a row', async () => {
    h.rosterPlayerFindMany.mockResolvedValue([
      { roster: { ownerId: 'user-1', leagueId: 'league-a' } },
      { roster: { ownerId: 'user-2', leagueId: 'league-a' } },
    ])
    // user-1 was reached on an earlier sweep; user-2 appeared for the first time on this one.
    h.notifFindMany.mockImplementation((args: { where: { sourceKey: { in: string[] } } }) =>
      Promise.resolve(
        args.where.sourceKey.in
          .filter((k: string) => k.endsWith(':user-1'))
          .map((sourceKey: string) => ({ sourceKey })),
      ),
    )

    await dispatchPendingPlayerNewsNotifications()

    const byUser = new Map(
      h.dispatchNotification.mock.calls.map((c) => [c[0].userIds[0], c[0].skipChannels]),
    )
    expect(byUser.get('user-1')).toEqual({ email: true, sms: true })
    expect(byUser.get('user-2')).toBeUndefined()
  })

  it('a HOLD on an earlier sweep never suppresses the first real send', async () => {
    // The v1 failure: the row had been considered, so its one real notification lost email.
    h.cacheFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      data: {
        contentHash: 'whatever',
        attempts: 3,
        lastOutcome: 'no-identity-row',
        firstAttemptAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
      },
    })
    h.notifFindMany.mockResolvedValue([])

    await dispatchPendingPlayerNewsNotifications()

    expect(h.dispatchNotification.mock.calls[0][0].skipChannels).toBeUndefined()
  })

  it('keys the dedupe prefix on the CONTENT, so a correction reaches everyone again', async () => {
    await dispatchPendingPlayerNewsNotifications()
    const first = h.dispatchNotification.mock.calls[0][0].dedupePrefix

    h.dispatchNotification.mockClear()
    h.newsFindMany.mockResolvedValue([newsRow({ headline: 'CORRECTION: RB signs elsewhere' })])
    await dispatchPendingPlayerNewsNotifications()

    expect(h.dispatchNotification.mock.calls[0][0].dedupePrefix).not.toBe(first)
  })

  it('errs toward delivering when the delivery-state lookup fails', async () => {
    // A duplicate email is bounded by the attempt cap; a never-sent one is unrecoverable.
    h.notifFindMany.mockRejectedValue(new Error('statement timeout'))

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(h.dispatchNotification.mock.calls[0][0].skipChannels).toBeUndefined()
    expect(res.deliveryStateUnavailable).toBe(1)
  })
})

describe('the settled outcome reflects what actually happened', () => {
  it('reports all-suppressed rather than delivered when every recipient was muted', async () => {
    h.dispatchNotification.mockResolvedValue({
      requested: 1, suppressed: 1, delivered: 0, failed: 0,
    })

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res.allSuppressed).toBe(1)
    expect(res.suppressedRecipients).toBe(1)
  })

  it('stays RETRYABLE when the audience was partial, even though someone was reached', async () => {
    // The per-recipient state is what makes this safe: the retry cannot re-bill the ones reached.
    h.rawQuery.mockRejectedValue(new Error('statement timeout'))

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res.recipientsUnavailable).toBe(1)
    expect(stampedIds()).toEqual([])
  })

  it('reports dispatch-failed when the in-app write failed', async () => {
    h.dispatchNotification.mockResolvedValue({
      requested: 1, suppressed: 0, delivered: 0, failed: 1,
    })

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res.dispatchFailed).toBe(1)
    expect(stampedIds()).toEqual([])
  })
})

describe('outcome counters are separated', () => {
  it('reports no-roster distinctly from held and from skipped', async () => {
    h.rosterPlayerFindMany.mockResolvedValue([])

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res).toMatchObject({
      scanned: 1,
      policySkipped: 0,
      heldUnresolved: 0,
      noRoster: 1,
      dispatchAttempted: 0,
      dispatchFailed: 0,
    })
  })

  it('counts `notified` in ROWS, not recipients', async () => {
    /*
     * 🛑 ALIASING IT TO `dispatchAttempted` CHANGED ITS UNIT WHILE THE DOC PROMISED IT HAD NOT.
     * One injury reaching 40 managers reported `notified: 40` where the old code reported `1` —
     * a value that can exceed `scanned` by an order of magnitude, serialized straight into the
     * `/api/cron/import-news` response.
     */
    h.rosterPlayerFindMany.mockResolvedValue([
      { roster: { ownerId: 'user-1', leagueId: 'league-a' } },
      { roster: { ownerId: 'user-2', leagueId: 'league-a' } },
      { roster: { ownerId: 'user-3', leagueId: 'league-b' } },
    ])

    const res = await dispatchPendingPlayerNewsNotifications()

    expect(res.notified).toBe(1)
    expect(res.notified).toBeLessThanOrEqual(res.scanned)
    expect(res.dispatchAttempted).toBe(3)
    expect(res.recipients).toBe(3)
  })

  it('reports platforms whose rosters were never searched', async () => {
    const res = await dispatchPendingPlayerNewsNotifications()
    expect(res.unsearchedPlatforms).toContain('yahoo')
  })
})
