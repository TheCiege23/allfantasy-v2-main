import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The founder's second scenario, pinned: a trade accepted in an imported
 * Sleeper league should be findable. The data was always there — the surfaces
 * were declining to look, and one said so in words that were false.
 */

const { cacheFindMany, valueFindMany } = vi.hoisted(() => ({
  cacheFindMany: vi.fn(),
  valueFindMany: vi.fn(),
}))

const { scanPendingSleeperTrades } = vi.hoisted(() => ({
  scanPendingSleeperTrades: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { findMany: cacheFindMany },
    playerValueSnapshot: { findMany: valueFindMany },
  },
}))

vi.mock('@/lib/provider-trades/scanPendingSleeperTrades', () => ({ scanPendingSleeperTrades }))

import { getRecentTrades } from '@/lib/core-app/recentTrades'

const NOW = new Date('2026-08-24T20:00:00Z')
const LEAGUES = [{ id: 'af-1', name: 'Bla bla bla', platformLeagueId: '99887766' }]

function payload(over: Record<string, unknown> = {}) {
  return {
    cacheKey: 'trade-grades:v2:99887766',
    data: {
      version: 2,
      trades: [
        {
          id: 'tr-1',
          createdIso: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
          sides: [
            {
              rosterId: 1,
              managerName: 'chxnk',
              teamName: null,
              playersIn: [{ playerId: '4988', name: 'Darren Waller', position: 'TE' }],
              picksIn: [],
            },
            {
              rosterId: 2,
              managerName: 'Hustead',
              teamName: null,
              playersIn: [],
              picksIn: [{ label: '2027 4th', season: '2027', round: 4 }],
            },
          ],
        },
      ],
      ...over,
    },
  }
}

beforeEach(() => {
  cacheFindMany.mockReset()
  valueFindMany.mockReset()
  cacheFindMany.mockResolvedValue([payload()])
  // By default nothing is priced, so no verdict is published.
  valueFindMany.mockResolvedValue([])
  scanPendingSleeperTrades.mockResolvedValue({
    trades: [], completedTrades: [], scanned: true, reason: null, unscannedKind: null, weeksUnanswered: 0,
  })
})

describe('getRecentTrades', () => {
  it('finds the trade both managers accepted, naming who got what', async () => {
    const out = await getRecentTrades(LEAGUES, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].leagueName).toBe('Bla bla bla')
    const [chxnk, hustead] = out[0].sides
    expect(chxnk.received.map((a) => a.name)).toEqual(['Darren Waller'])
    expect(hustead.received.map((a) => a.name)).toEqual(['2027 4th'])
  })

  it('names a pick as a pick, never as the player it later became', async () => {
    const out = await getRecentTrades(LEAGUES, NOW)
    const pickAsset = out[0].sides[1].received[0]
    expect(pickAsset.kind).toBe('pick')
    expect(pickAsset.name).toBe('2027 4th')
  })

  it("never borrows the sweep's retrospective letter", async () => {
    // That grade is scored on realised points: days after a trade it measures
    // almost nothing, and a 2027 pick contributes zero. The verdict published
    // instead is a different question, asked of the day the deal was struck.
    const out = await getRecentTrades(LEAGUES, NOW)
    expect(JSON.stringify(out)).not.toMatch(/initialGrade|currentGrade/)
  })

  describe('the prospective verdict', () => {
    it('prices a future pick properly instead of at zero, and reaches a verdict', async () => {
      // Waller priced near a 4th-rounder's discounted value => a fair-ish deal
      // that the retrospective grader would have scored as a shutout, because
      // the 2027 draft has not happened.
      valueFindMany.mockResolvedValue([
        { sleeperId: '4988', name: 'Darren Waller', value: 272 },
      ])
      const out = await getRecentTrades(LEAGUES, NOW)
      expect(out[0].verdict).not.toBeNull()
      expect(typeof out[0].verdict?.verdict).toBe('string')
      expect(out[0].verdict?.confidence).toBeGreaterThanOrEqual(0)
    })

    it('publishes NOTHING when a traded player has no price on file', async () => {
      // A partially priced trade systematically favours whoever received the
      // asset we could not price. Absent is the honest answer.
      valueFindMany.mockResolvedValue([])
      const out = await getRecentTrades(LEAGUES, NOW)
      expect(out[0].verdict).toBeNull()
    })

    it('refuses to grade a three-team trade as if two teams traded', async () => {
      cacheFindMany.mockResolvedValue([
        payload({
          trades: [
            {
              id: 'three',
              createdIso: NOW.toISOString(),
              multiTeam: true,
              sides: [
                { rosterId: 1, managerName: 'a', teamName: null, playersIn: [{ playerId: '1', name: 'A' }], picksIn: [] },
                { rosterId: 2, managerName: 'b', teamName: null, playersIn: [{ playerId: '2', name: 'B' }], picksIn: [] },
                { rosterId: 3, managerName: 'c', teamName: null, playersIn: [{ playerId: '3', name: 'C' }], picksIn: [] },
              ],
            },
          ],
        }),
      ])
      valueFindMany.mockResolvedValue([
        { sleeperId: '1', name: 'A', value: 1000 },
        { sleeperId: '2', name: 'B', value: 1000 },
        { sleeperId: '3', name: 'C', value: 1000 },
      ])
      const out = await getRecentTrades(LEAGUES, NOW)
      expect(out[0].sides).toHaveLength(3)
      expect(out[0].verdict).toBeNull()
    })

    it('prices only the trades that will actually render', async () => {
      valueFindMany.mockResolvedValue([])
      await getRecentTrades(LEAGUES, NOW, 1)
      // One read, scoped to the visible trade's players.
      expect(valueFindMany).toHaveBeenCalledTimes(1)
      expect(valueFindMany.mock.calls[0][0].where.sleeperId.in).toEqual(['4988'])
    })

    it('survives a price read failure by withholding the verdict, not the trade', async () => {
      valueFindMany.mockImplementationOnce(async () => {
        throw new Error('db down')
      })
      const out = await getRecentTrades(LEAGUES, NOW)
      expect(out).toHaveLength(1)
      expect(out[0].verdict).toBeNull()
    })
  })

  it('drops a trade older than the recent window', async () => {
    cacheFindMany.mockResolvedValue([
      payload({
        trades: [
          {
            id: 'old',
            createdIso: new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
            sides: [
              { rosterId: 1, managerName: 'a', teamName: null, playersIn: [{ name: 'X' }], picksIn: [] },
              { rosterId: 2, managerName: 'b', teamName: null, playersIn: [{ name: 'Y' }], picksIn: [] },
            ],
          },
        ],
      }),
    ])
    expect(await getRecentTrades(LEAGUES, NOW)).toEqual([])
  })

  it('flags a side whose assets could not be named rather than drawing an empty column', async () => {
    cacheFindMany.mockResolvedValue([
      payload({
        trades: [
          {
            id: 'partial',
            createdIso: NOW.toISOString(),
            sides: [
              { rosterId: 1, managerName: 'a', teamName: null, playersIn: [{ name: 'X' }], picksIn: [] },
              { rosterId: 2, managerName: 'b', teamName: null, playersIn: [], picksIn: [] },
            ],
          },
        ],
      }),
    ])
    const out = await getRecentTrades(LEAGUES, NOW)
    expect(out[0].partial).toBe(true)
  })

  it('never queries when the account has no platform league ids', async () => {
    expect(await getRecentTrades([{ id: 'a', name: 'n', platformLeagueId: null }], NOW)).toEqual([])
    expect(cacheFindMany).not.toHaveBeenCalled()
  })

  it('ignores a cache row of the wrong version rather than trusting its shape', async () => {
    cacheFindMany.mockResolvedValue([payload({ version: 1 })])
    expect(await getRecentTrades(LEAGUES, NOW)).toEqual([])
  })

  it('degrades to nothing when the cache read fails', async () => {
    cacheFindMany.mockImplementationOnce(async () => {
      throw new Error('db down')
    })
    expect(await getRecentTrades(LEAGUES, NOW)).toEqual([])
  })

  it('merges a just-completed Sleeper trade from the bounded live window', async () => {
    scanPendingSleeperTrades.mockResolvedValue({
      trades: [],
      completedTrades: [{
        transactionId: 'fresh-1', proposedBy: 'Trade Partner', proposedByViewer: false,
        proposedAt: NOW.toISOString(),
        assetsGiven: [{ playerId: '1', playerName: 'Sent Player', position: 'WR', team: 'NYJ' }],
        assetsReceived: [{ playerId: '2', playerName: 'New Player', position: 'RB', team: 'BUF' }],
        readOnly: true, provider: 'sleeper', lifecycleStatus: 'complete',
        viewerRosterExternalId: '1', counterpartyRosterExternalId: '2',
      }],
      scanned: true, reason: null, unscannedKind: null, weeksUnanswered: 0,
    })
    const out = await getRecentTrades(
      [{ ...LEAGUES[0], platform: 'sleeper' }], NOW, 3,
      { ownerSleeperId: 'owner-1', currentWeek: 2 },
    )
    expect(out[0]).toMatchObject({ id: 'fresh-1', leagueName: 'Bla bla bla' })
    expect(scanPendingSleeperTrades).toHaveBeenCalledWith(expect.objectContaining({ weeks: [1, 2, 3] }))
  })

  /*
   * The Trades urgency badge. The scan already sees offers waiting on you; the
   * callback hands them over so nothing reads the provider twice.
   */
  describe('pending offers for the Trades badge', () => {
    const offer = (id: string, over: Record<string, unknown> = {}) => ({
      transactionId: id, proposedBy: 'Partner', proposedByViewer: false, proposedAt: NOW.toISOString(),
      assetsGiven: [], assetsReceived: [], readOnly: true, provider: 'sleeper', lifecycleStatus: 'pending',
      ...over,
    })
    const TWO = [
      { id: 'af-1', name: 'One', platformLeagueId: '111', platform: 'sleeper' },
      { id: 'af-2', name: 'Two', platformLeagueId: '222', platform: 'sleeper' },
    ]

    it('reports offers waiting on YOU, per league, for every scan that answered', async () => {
      scanPendingSleeperTrades.mockImplementation(async ({ platformLeagueId }: { platformLeagueId: string }) =>
        platformLeagueId === '111'
          ? {
              trades: [offer('in-1'), offer('in-2'), offer('sent', { proposedByViewer: true })],
              completedTrades: [], scanned: true, reason: null, unscannedKind: null, weeksUnanswered: 0,
            }
          : { trades: [], completedTrades: [], scanned: false, reason: 'no roster', unscannedKind: 'identity', weeksUnanswered: 0 },
      )
      const onPendingOffers = vi.fn()
      await getRecentTrades(TWO, NOW, 3, { ownerSleeperId: 'owner-1', currentWeek: 2, onPendingOffers })
      /* af-2's scan did not answer, so it is absent — never reported as zero. */
      expect(onPendingOffers).toHaveBeenCalledWith([{ leagueId: 'af-1', waiting: 2 }])
    })

    it('a failing callback never costs the trades', async () => {
      const out = await getRecentTrades(
        [{ ...LEAGUES[0], platform: 'sleeper' }], NOW, 3,
        { ownerSleeperId: 'owner-1', currentWeek: 2, onPendingOffers: () => { throw new Error('boom') } },
      )
      expect(out.length).toBeGreaterThan(0)
    })

    /*
     * 🛑 THIS READ RESOLVES WHILE BLIND, AND THE CALLER CANNOT SEE IT FROM THE RESULT. Every
     * source degrades to empty rather than throwing, so `[]` means "nothing traded" OR "we could
     * not look" — and /core closes the "since your last visit" trade boundary on that difference.
     * One case per way it can happen, plus the case where it must stay QUIET.
     */
    describe('reporting what it could not see', () => {
      const answered = {
        trades: [], completedTrades: [], scanned: true, reason: null, unscannedKind: null, weeksUnanswered: 0,
      }
      /*
       * The scan mock is file-scoped; without this the cap case counts a previous test's calls.
       * ⚠ Block body, not a concise one: vitest treats a FUNCTION returned from `beforeEach` as a
       * teardown callback, and `mockClear()` returns the mock — so the arrow form had vitest
       * calling the scan with no arguments after each test.
       */
      beforeEach(() => {
        scanPendingSleeperTrades.mockClear()
      })

      it('says nothing when the cache read and every scan answered in full', async () => {
        scanPendingSleeperTrades.mockResolvedValue(answered)
        const onIncomplete = vi.fn()
        await getRecentTrades(TWO, NOW, 3, { ownerSleeperId: 'owner-1', currentWeek: 2, onIncomplete })
        expect(onIncomplete).not.toHaveBeenCalled()
      })

      /*
       * The PRIMARY source, and the one a rejection check misses entirely: this fallback keeps the
       * card up, which is right, but `[]` from it is not evidence that nothing traded. It is also
       * the only one of these that fires for an account with no Sleeper identity at all.
       */
      it('reports a grade cache it could not read — even with no live scan to run', async () => {
        cacheFindMany.mockRejectedValueOnce(new Error('pool timeout'))
        const onIncomplete = vi.fn()
        const out = await getRecentTrades(
          [{ id: 'af-1', name: 'One', platformLeagueId: '111', platform: 'espn' }], NOW, 3,
          { ownerSleeperId: null, currentWeek: 2, onIncomplete },
        )
        expect(out).toEqual([])
        expect(onIncomplete).toHaveBeenCalledWith('grade-cache-unreadable')
      })

      /*
       * ⚠ THE FIXTURE MUST CARRY A KIND, and the reason it must is worth stating: this asserted
       * `onIncomplete` WAS called, and with no `unscannedKind` it passed only because
       * `undefined !== 'identity'`. So it pinned the ABSENCE of a field the type now requires,
       * four tests above another that asserts the opposite for the same `reason` string. Tests
       * are not typechecked here, so nothing else would have caught it.
       */
      it('reports a league whose scan never answered', async () => {
        scanPendingSleeperTrades.mockImplementation(async ({ platformLeagueId }: { platformLeagueId: string }) =>
          platformLeagueId === '111'
            ? answered
            : { ...answered, scanned: false, reason: 'Sleeper did not answer', unscannedKind: 'provider' },
        )
        const onIncomplete = vi.fn()
        await getRecentTrades(TWO, NOW, 3, { ownerSleeperId: 'owner-1', currentWeek: 2, onIncomplete })
        expect(onIncomplete).toHaveBeenCalledWith('league-scan-unanswered')
        // One league failed, so exactly one report: the contract is once per OCCURRENCE, and
        // `toHaveBeenCalledWith` alone would pass however many times it fired.
        expect(onIncomplete).toHaveBeenCalledTimes(1)
      })

      /* The other half of "once per occurrence": both leagues blind means both are reported. */
      it('reports each blind league separately', async () => {
        scanPendingSleeperTrades.mockResolvedValue({
          ...answered, scanned: false, reason: 'Sleeper could not be reached', unscannedKind: 'provider',
        })
        const onIncomplete = vi.fn()
        await getRecentTrades(TWO, NOW, 3, { ownerSleeperId: 'owner-1', currentWeek: 2, onIncomplete })
        expect(onIncomplete.mock.calls).toEqual([['league-scan-unanswered'], ['league-scan-unanswered']])
      })

      /*
       * 🛑 AND A SCAN THAT CANNOT EVER SUCCEED IS NOT A FAILURE TO REPORT. `scanned: false` also
       * means "no roster in this league is owned by your linked account" — permanent, same answer
       * on every render for the life of the league. Reporting it holds /core's trade window open
       * FOREVER: the boundary never advances, the same trades are re-reported on every visit, and
       * nothing can clear it, because the only thing that would is a complete scan that cannot
       * happen. It is the rule this file already applies to the `maxLeagues` cap, reached from a
       * direction the first version of this callback did not consider.
       */
      it('stays quiet about a league the account owns no roster in', async () => {
        scanPendingSleeperTrades.mockResolvedValue({
          ...answered,
          scanned: false,
          reason: 'no roster in this Sleeper league is owned by your linked account',
          unscannedKind: 'identity',
        })
        const onIncomplete = vi.fn()
        await getRecentTrades(TWO, NOW, 3, { ownerSleeperId: 'owner-1', currentWeek: 2, onIncomplete })
        expect(onIncomplete).not.toHaveBeenCalled()
      })

      /* A mix: the permanent one is silent, the transient one is reported. */
      it('separates a permanent identity result from a provider failure in the same pass', async () => {
        scanPendingSleeperTrades.mockImplementation(async ({ platformLeagueId }: { platformLeagueId: string }) =>
          platformLeagueId === '111'
            ? { ...answered, scanned: false, reason: 'no roster', unscannedKind: 'identity' }
            : { ...answered, scanned: false, reason: 'Sleeper could not be reached', unscannedKind: 'provider' },
        )
        const onIncomplete = vi.fn()
        await getRecentTrades(TWO, NOW, 3, { ownerSleeperId: 'owner-1', currentWeek: 2, onIncomplete })
        expect(onIncomplete.mock.calls).toEqual([['league-scan-unanswered']])
      })

      /* A scan the loader's own `.catch` turned into null knows nothing — treat it as the provider. */
      it('reports a scan that threw, which has no kind of its own', async () => {
        scanPendingSleeperTrades.mockRejectedValue(new Error('socket hang up'))
        const onIncomplete = vi.fn()
        await getRecentTrades([TWO[0]!], NOW, 3, { ownerSleeperId: 'owner-1', currentWeek: 2, onIncomplete })
        expect(onIncomplete.mock.calls).toEqual([['league-scan-unanswered']])
      })

      /*
       * `scanned: true` with weeks missing. PendingTradeScan's own docblock says a partial scan
       * still counts as scanned and that "nothing waiting" is weaker than it looks — a trade
       * accepted in the week Sleeper refused is simply absent from a result that looks clean.
       */
      it('reports a scan that answered for only some of its weeks', async () => {
        scanPendingSleeperTrades.mockResolvedValue({ ...answered, weeksUnanswered: 1 })
        const onIncomplete = vi.fn()
        await getRecentTrades(TWO, NOW, 3, { ownerSleeperId: 'owner-1', currentWeek: 2, onIncomplete })
        expect(onIncomplete).toHaveBeenCalledWith('league-scan-partial-weeks')
      })

      /*
       * ⚠ AND IT STAYS QUIET FOR THE TWO BOUNDS THAT ARE PERMANENT — for DIFFERENT reasons, which
       * an earlier version of this comment got wrong by giving the cap's reason for both. The cap
       * is not a blind spot at all: the grade cache is read for every league with a platform id,
       * before the slice. A non-Sleeper league is the opposite — it has no trade source here
       * whatsoever, because that cache is keyed by Sleeper league id and only a Sleeper service
       * writes it. What they share is permanence: reporting either as a transient failure would
       * hold the trade boundary open forever for anyone with nine leagues or one ESPN league.
       */
      it('stays quiet about the maxLeagues cap and non-Sleeper leagues', async () => {
        scanPendingSleeperTrades.mockResolvedValue(answered)
        const onIncomplete = vi.fn()
        const many = Array.from({ length: 5 }, (_, i) => ({
          id: `af-${i}`, name: `L${i}`, platformLeagueId: `${i}`, platform: i < 3 ? 'sleeper' : 'espn',
        }))
        await getRecentTrades(many, NOW, 3, { ownerSleeperId: 'owner-1', currentWeek: 2, maxLeagues: 2, onIncomplete })
        expect(scanPendingSleeperTrades).toHaveBeenCalledTimes(2)
        expect(onIncomplete).not.toHaveBeenCalled()
      })

      it('a throwing listener never costs the trades', async () => {
        cacheFindMany.mockRejectedValueOnce(new Error('pool timeout'))
        scanPendingSleeperTrades.mockResolvedValue(answered)
        await expect(
          getRecentTrades(TWO, NOW, 3, {
            ownerSleeperId: 'owner-1', currentWeek: 2, onIncomplete: () => { throw new Error('boom') },
          }),
        ).resolves.toEqual([])
      })
    })
  })
})
