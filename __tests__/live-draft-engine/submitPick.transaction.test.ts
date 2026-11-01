vi.mock('@/lib/tournament/seasonDraftBoard', () => ({ seasonDraftSessionError: () => null }))
/**
 * Service-level coverage for PickSubmissionService.submitPick with mocked Prisma $transaction.
 * Verifies timer reset, consecutive picks, stale overall, duplicate slot/player, completion, traded ownership.
 *
 * Chat notifications fire via dynamic import postDraftPickChatEvent (mocked).
 * League lifecycle / salary cap / trend hooks are mocked or no-op.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DRAFT_PICK_DUPLICATE_PLAYER,
  DRAFT_PICK_NOT_ON_CLOCK,
  DRAFT_PICK_RACE_RETRY,
  DRAFT_PICK_STALE_OVERALL,
} from '@/lib/live-draft-engine/pickAuthorityCodes'

const completeDraftSessionMock = vi.fn(async () => true)
const postDraftPickChatEventMock = vi.fn(async () => {})
const recordTrendSignalMock = vi.fn(async () => {})
const resolveTrendPlayerIdsMock = vi.fn(async (lookups: unknown[]) => lookups.map(() => null as string | null))
const leagueLifecycleTransitionMock = vi.fn(async () => {})

const ctx = vi.hoisted(() => {
  type PickRow = {
    id: string
    sessionId: string
    overall: number
    round: number
    slot: number
    rosterId: string
    playerName: string
    position: string
    playerId?: string | null
    team?: string | null
    originalRosterId?: string | null
    tradedPickMeta?: unknown
    source?: string | null
    pickMetadata?: unknown
  }

  const store = {
    picks: [] as PickRow[],
    nba: false,
    rights: [] as Array<{ id: string; leagueId: string; rosterId: string; devyPlayerId: string; state: string }>,
    failRightsWrite: false,
    /** When set, `tx.draftSession.findUnique` returns these picks (simulates race / inner lock view). */
    transactionLockedPicksOverride: null as PickRow[] | null,
    session: {
      id: 'session-1',
      leagueId: 'league-1',
      status: 'in_progress',
      draftType: 'linear' as const,
      rounds: 4,
      teamCount: 2,
      thirdRoundReversal: false,
      timerSeconds: 90,
      timerEndAt: null as Date | null,
      slotOrder: [
        { slot: 1, rosterId: 'roster-a', displayName: 'Team A' },
        { slot: 2, rosterId: 'roster-b', displayName: 'Team B' },
      ],
      tradedPicks: [] as Array<{
        round: number
        originalRosterId: string
        previousOwnerName: string
        newRosterId: string
        newOwnerName: string
      }>,
      sportType: 'NFL',
      playerPool: 'all',
      draftModeLabel: null as string | null,
      dispersalPoolConfig: null,
      keeperConfig: null,
      keeperSelections: null,
      devyConfig: null,
      c2cConfig: null,
      version: 5,
    },
    season: false,
    transactionVersionOverride: null as number | null,
    rejectVersionClaim: false,
    pickIdSeq: 0,
  }

  function nextPickId() {
    store.pickIdSeq += 1
    return `pick-id-${store.pickIdSeq}`
  }

  async function txSessionUpdate(data: any) {
    if (data.timerEndAt !== undefined) store.session.timerEndAt = data.timerEndAt
    if (data.status !== undefined) store.session.status = data.status
    if (data.version?.increment) store.session.version += data.version.increment
  }
  function buildTx() {
    return {
      $queryRaw: vi.fn(async () => []),
      leagueAuditLog: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'archive-event', ...data })),
      },
      draftSession: {
        updateMany: vi.fn(async (args: any) => { if (store.rejectVersionClaim || args.where.version !== store.session.version || args.where.status !== store.session.status) return { count: 0 }; await txSessionUpdate(args.data); return { count: 1 } }),
        // leagueId reads are findFirst now (DraftSession.leagueId is not unique); answer them from findUnique
        findFirst(...a: unknown[]) { return (this as any).findUnique(...a) },
        findUnique: vi.fn(async () => ({
          ...store.session,
          version: store.transactionVersionOverride ?? store.session.version,
          picks: (store.transactionLockedPicksOverride ?? store.picks).map((p) => ({ ...p })),
        })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (data.timerEndAt !== undefined) store.session.timerEndAt = data.timerEndAt as Date | null
          if (data.status !== undefined) store.session.status = data.status as string
          if (
            data.version &&
            typeof data.version === 'object' &&
            data.version !== null &&
            'increment' in data.version
          ) {
            store.session.version += Number((data.version as { increment: number }).increment)
          }
          if (data.pausedRemainingSeconds !== undefined) {
            /* ignored for these tests */
          }
          return { ...store.session }
        }),
      },
      devyRights: {
        findFirst: vi.fn(async ({ where }: any) => store.rights.find(r => r.leagueId === where.leagueId && r.devyPlayerId === where.devyPlayerId) ?? null),
        create: vi.fn(async ({ data }: any) => { if (store.failRightsWrite) throw new Error('rights write failed'); const row = { ...data, id: 'right-1' }; store.rights.push(row); return row }),
      },
      draftPick: {
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = store.picks.find(p => p.id === where.id)
          if (!row) throw new Error('Pick missing')
          Object.assign(row, data)
          return row
        }),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          store.picks = store.picks.filter((p) => p.id !== where.id)
        }),
        create: vi.fn(async ({ data }: { data: Omit<PickRow, 'id'> & { sessionId: string } }) => {
          const row: PickRow = {
            id: nextPickId(),
            ...(data as PickRow),
          }
          store.picks.push(row)
          return row
        }),
      },
    }
  }

  const prisma = {
    draftSession: {
      // leagueId reads are findFirst now (DraftSession.leagueId is not unique); answer them from findUnique
      findFirst(...a: unknown[]) { return (this as any).findUnique(...a) },
      findUnique: vi.fn(async () => ({
        ...store.session,
        picks: store.picks.map((p) => ({ ...p })),
      })),
    },
    draftPick: {
      findMany: vi.fn(async () => store.picks.map((p) => ({ ...p }))),
    },
    league: {
      findUnique: vi.fn(async () => ({
        lifecycleState: 'drafting',
        sport: store.nba ? 'NBA' : 'NFL',
        leagueVariant: store.nba ? 'merged_devy_c2c' : null,
        userId: 'commissioner-1',
      })),
    },
    player: {
      findFirst: vi.fn(async () => null),
    },
    $transaction: vi.fn(async (fn: (tx: ReturnType<typeof buildTx>) => Promise<unknown>) => {
      const snapshot = structuredClone({ picks: store.picks, session: store.session, rights: store.rights })
      try { return await fn(buildTx()) } catch (e) { store.picks = snapshot.picks; store.session = snapshot.session; store.rights = snapshot.rights; throw e }
    }),
  }

  function resetStore() {
    store.season = false; store.transactionVersionOverride = null; store.rejectVersionClaim = false
    store.picks = []
    store.nba = false; store.rights = []; store.failRightsWrite = false; store.session.c2cConfig = null; store.session.devyConfig = null
    store.transactionLockedPicksOverride = null
    store.pickIdSeq = 0
    store.session.status = 'in_progress'
    store.session.timerSeconds = 90
    store.session.timerEndAt = null
    store.session.version = 5
    store.session.tradedPicks = []
    store.session.slotOrder = [
      { slot: 1, rosterId: 'roster-a', displayName: 'Team A' },
      { slot: 2, rosterId: 'roster-b', displayName: 'Team B' },
    ]
  }

  return { store, prisma, resetStore }
})

vi.mock('@/lib/tournament/seasonDraftRuntime', () => ({ loadSeasonDraftContext: async () => ctx.store.season ? {} : null, validateSeasonDraftPlayer: async () => null }))
vi.mock('@/lib/tournament/seasonDraftRefresh', () => ({ prepareSeasonDraftPool: async () => null }))
vi.mock('@/lib/prisma', () => ({
  prisma: ctx.prisma,
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: vi.fn(async () => ({
    tradedPickOwnerNameRedEnabled: false,
    tradedPickColorModeEnabled: false,
  })),
}))

vi.mock('@/lib/league/league-draft-template-payload', () => ({
  getLeagueDraftTemplatePayload: vi.fn(async () => null),
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/live-draft-engine/DraftSessionService')>()
  return {
    ...mod,
    completeDraftSession: (...args: unknown[]) => completeDraftSessionMock(...args),
  }
})

vi.mock('@/lib/player-trend/signal-integration', () => ({
  recordTrendSignalByPlayerId: (...args: unknown[]) => recordTrendSignalMock(...args),
  // The name fallback (no playerId) binds through this; mirrors the old player.findFirst -> null.
  resolveTrendPlayerIds: (...args: unknown[]) => resolveTrendPlayerIdsMock(...args),
}))

vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({
  getSalaryCapConfig: vi.fn(async () => null),
}))

vi.mock('@/lib/salary-cap/RookieContractService', () => ({
  assignRookieContract: vi.fn(async () => {}),
}))

vi.mock('@/lib/draft-room/postDraftPickChatEvent', () => ({
  postDraftPickChatEvent: (...args: unknown[]) => postDraftPickChatEventMock(...args),
}))

const resolveServerRookieStatusMock = vi.hoisted(() => vi.fn(async (): Promise<boolean | null> => null))
vi.mock('@/lib/live-draft-engine/serverRookieStatus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/live-draft-engine/serverRookieStatus')>()),
  resolveServerRookieStatus: resolveServerRookieStatusMock,
}))
vi.mock('@/server/services/leagueLifecycleService', () => ({
  transitionLeagueState: (...args: unknown[]) => leagueLifecycleTransitionMock(...args),
  getLeagueLifecycleState: () => 'drafting',
}))

const verifyNbaPickMock = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/lib/devy/verifyNcaabDraftPick', () => ({ verifyNcaabCollegeDraftPick: verifyNbaPickMock }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', async (load) => ({ ...(await load<typeof import('@/lib/merged-devy-c2c/C2CLeagueConfig')>()), isC2CLeague: vi.fn(async () => ctx.store.nba) }))
vi.mock('@/lib/devy/DevyLeagueConfig', async (load) => ({ ...(await load<typeof import('@/lib/devy/DevyLeagueConfig')>()), isDevyLeague: vi.fn(async () => false) }))

const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')

describe('PickSubmissionService.submitPick (mocked Prisma transaction)', () => {
  beforeEach(() => {
    ctx.resetStore()
    vi.clearAllMocks()
    completeDraftSessionMock.mockResolvedValue(true)
  })

  it.each(['user', 'auto', 'commissioner'] as const)('creates verified college ownership atomically for %s picks', async (source) => {
    ctx.store.nba = true
    const result = await submitPick({ leagueId: 'league-1', playerName: 'College Guard', position: 'G', playerId: 'espn:ncaab:1', rosterId: 'roster-a', source, expectedOverall: 1 })
    expect(result.success).toBe(true)
    expect(ctx.store.picks[0]).toMatchObject({ playerId: 'espn:ncaab:1', assetType: 'c2c_college', pickMetadata: { draftCollegeRightsId: 'right-1' } })
    expect(ctx.store.rights).toMatchObject([{ leagueId: 'league-1', rosterId: 'roster-a', devyPlayerId: 'espn:ncaab:1', state: 'COLLEGE_ACTIVE' }])
  })
  it('rejects unverified college IDs and rolls back when rights cannot be created', async () => {
    ctx.store.nba = true
    verifyNbaPickMock.mockResolvedValueOnce(false)
    const pick = { leagueId: 'league-1', playerName: 'College Guard', position: 'G', playerId: 'espn:ncaab:1', rosterId: 'roster-a', expectedOverall: 1 }
    expect((await submitPick(pick)).success).toBe(false)
    expect(ctx.store.picks).toHaveLength(0)
    ctx.store.failRightsWrite = true
    await expect(submitPick(pick)).rejects.toThrow('rights write failed')
    expect(ctx.store.picks).toHaveLength(0)
    expect(ctx.store.rights).toHaveLength(0)
  })
  it('does not allow college picks outside configured college rounds', async () => {
    ctx.store.nba = true
    ;(ctx.store.session as any).c2cConfig = { enabled: true, collegeRounds: [2] }
    const result = await submitPick({ leagueId: 'league-1', playerName: 'College Guard', position: 'G', playerId: 'espn:ncaab:1', rosterId: 'roster-a', expectedOverall: 1 })
    expect(result.success).toBe(false)
    expect(ctx.store.picks).toHaveLength(0)
  })

  it('successful pick creates DraftPick and resets timerEndAt + increments version', async () => {
    const r = await submitPick({
      leagueId: 'league-1',
      playerName: 'Josh Allen',
      position: 'QB',
      team: 'BUF',
      playerId: 'player-1',
      rosterId: 'roster-a',
      madeByUserId: 'user-a',
      source: 'user',
      expectedOverall: 1,
    })
    expect(r.success).toBe(true)
    expect(ctx.store.picks).toHaveLength(1)
    expect(ctx.store.picks[0]).toMatchObject({
      overall: 1,
      rosterId: 'roster-a',
      playerName: 'Josh Allen',
      position: 'QB',
      playerId: 'player-1',
      sessionId: 'session-1',
      source: 'user',
    })
    expect(ctx.store.session.timerEndAt).toBeInstanceOf(Date)
    expect(ctx.store.session.timerEndAt!.getTime()).toBeGreaterThan(Date.now())
    expect(ctx.store.session.version).toBe(6)
    expect(completeDraftSessionMock).not.toHaveBeenCalled()
  })

  /**
   * The pool resolves each card's face; the insert used to drop it and the board rebuilt one from
   * the id — an NFL Sleeper URL for every sport. A real URL is kept; the pool's "AF" data: URI
   * placeholder is not a photo and is not stored.
   */
  /*
   * 🛑 With no playerId the trend signal used to bind by `player.findFirst` on the NAME — whichever
   * Justin Jefferson Postgres returned. It now binds through resolveTrendPlayerIds WITH the pick's
   * position and team, and records only the player that comes back.
   */
  it('a name-only pick binds its trend signal by name + position + team', async () => {
    resolveTrendPlayerIdsMock.mockResolvedValueOnce(['nfl-justin-jefferson-28fd81ce'])
    await submitPick({
      leagueId: 'league-1',
      playerName: 'Justin Jefferson',
      position: 'WR',
      team: 'MIN',
      playerId: null,
      rosterId: 'roster-a',
      source: 'user',
      expectedOverall: 1,
    })
    expect(resolveTrendPlayerIdsMock).toHaveBeenCalledWith(
      [{ name: 'Justin Jefferson', position: 'WR', team: 'MIN' }],
      expect.anything(),
    )
    expect(recordTrendSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'nfl-justin-jefferson-28fd81ce', signalType: 'draft_pick' }),
    )
  })

  it('stores the photo the picked card showed, but never a data: placeholder', async () => {
    await submitPick({
      leagueId: 'league-1',
      playerName: 'Josh Allen',
      position: 'QB',
      team: 'BUF',
      playerId: 'player-1',
      rosterId: 'roster-a',
      source: 'user',
      expectedOverall: 1,
      playerImageUrl: 'https://r2.thesportsdb.com/images/media/player/cutout/josh.png',
    } as Parameters<typeof submitPick>[0])
    expect((ctx.store.picks[0] as Record<string, unknown>).playerImageUrl).toBe(
      'https://r2.thesportsdb.com/images/media/player/cutout/josh.png',
    )

    ctx.resetStore()
    await submitPick({
      leagueId: 'league-1',
      playerName: 'Josh Allen',
      position: 'QB',
      team: 'BUF',
      playerId: 'player-1',
      rosterId: 'roster-a',
      source: 'user',
      expectedOverall: 1,
      playerImageUrl: 'data:image/svg+xml;utf8,<svg/>',
    } as Parameters<typeof submitPick>[0])
    expect((ctx.store.picks[0] as Record<string, unknown>).playerImageUrl).toBeNull()
  })

  it('consecutive picks: roster A then roster B; timer resets each time; different players', async () => {
    const t0 = new Date('2026-03-01T18:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(t0)

    const first = await submitPick({
      leagueId: 'league-1',
      playerName: 'Player One',
      position: 'QB',
      playerId: 'p1',
      rosterId: 'roster-a',
      expectedOverall: 1,
    })
    expect(first.success).toBe(true)
    const afterFirst = ctx.store.session.timerEndAt!.getTime()

    vi.setSystemTime(new Date(t0.getTime() + 5_000))
    const second = await submitPick({
      leagueId: 'league-1',
      playerName: 'Player Two',
      position: 'RB',
      playerId: 'p2',
      rosterId: 'roster-b',
      expectedOverall: 2,
    })
    expect(second.success).toBe(true)
    expect(ctx.store.picks).toHaveLength(2)
    expect(ctx.store.picks[0]!.rosterId).toBe('roster-a')
    expect(ctx.store.picks[1]!.rosterId).toBe('roster-b')
    expect(ctx.store.picks[0]!.playerId).toBe('p1')
    expect(ctx.store.picks[1]!.playerId).toBe('p2')
    expect(ctx.store.session.timerEndAt!.getTime()).toBeGreaterThanOrEqual(afterFirst)
    vi.useRealTimers()
  })

  it('rejects stale expectedOverall before transaction', async () => {
    ctx.store.picks.push({
      id: 'seed-1',
      sessionId: 'session-1',
      overall: 1,
      round: 1,
      slot: 1,
      rosterId: 'roster-a',
      playerName: 'Already Gone',
      position: 'QB',
      playerId: 'seed',
    })
    const r = await submitPick({
      leagueId: 'league-1',
      playerName: 'Late',
      position: 'WR',
      rosterId: 'roster-b',
      expectedOverall: 1,
    })
    expect(r.success).toBe(false)
    expect(r.code).toBe(DRAFT_PICK_STALE_OVERALL)
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled()
    expect(ctx.store.picks).toHaveLength(1)
  })

  it('rejects duplicate fill of same overall (race) with RACE_RETRY', async () => {
    // Outer read: board still open at overall 1. Inner tx: another writer filled slot 1 first
    // (picksCountAtSubmit mismatch → "Draft state changed").
    ctx.store.transactionLockedPicksOverride = [
      {
        id: 'existing',
        sessionId: 'session-1',
        overall: 1,
        round: 1,
        slot: 1,
        rosterId: 'roster-a',
        playerName: 'Taken',
        position: 'QB',
        playerId: 'x',
      },
    ]
    const r = await submitPick({
      leagueId: 'league-1',
      playerName: 'Someone Else',
      position: 'RB',
      rosterId: 'roster-a',
      expectedOverall: 1,
    })
    expect(r.success).toBe(false)
    expect(r.code).toBe(DRAFT_PICK_RACE_RETRY)
    expect(ctx.store.picks).toHaveLength(0)
  })

  it('rejects duplicate player via PickValidation', async () => {
    ctx.store.picks.push({
      id: 'pfill',
      sessionId: 'session-1',
      overall: 1,
      round: 1,
      slot: 1,
      rosterId: 'roster-a',
      playerName: 'Josh Allen',
      position: 'QB',
      playerId: 'same',
    })
    const r = await submitPick({
      leagueId: 'league-1',
      playerName: 'Josh Allen',
      position: 'QB',
      rosterId: 'roster-b',
      expectedOverall: 2,
    })
    expect(r.success).toBe(false)
    expect(r.code).toBe(DRAFT_PICK_DUPLICATE_PLAYER)
    expect(ctx.store.picks).toHaveLength(1)
  })

  it('final pick invokes completeDraftSession', async () => {
    ctx.store.session.rounds = 1
    ctx.store.session.teamCount = 1
    ctx.store.session.slotOrder = [{ slot: 1, rosterId: 'solo', displayName: 'Solo' }]
    const r = await submitPick({
      leagueId: 'league-1',
      playerName: 'Only Pick',
      position: 'QB',
      rosterId: 'solo',
      playerId: 'solo-p',
      expectedOverall: 1,
    })
    expect(r.success).toBe(true)
    expect(completeDraftSessionMock).toHaveBeenCalledWith('league-1')
  })

  it('timer deadline is server-authoritative: timerEndAt ≈ now + timerSeconds', async () => {
    ctx.store.session.timerSeconds = 120
    const frozen = new Date('2026-07-04T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(frozen)
    await submitPick({
      leagueId: 'league-1',
      playerName: 'Frozen',
      position: 'TE',
      rosterId: 'roster-a',
      playerId: 'fz',
      expectedOverall: 1,
    })
    expect(ctx.store.session.timerEndAt!.getTime()).toBe(frozen.getTime() + 120_000)
    vi.useRealTimers()
  })

  it('absent-manager rule: the next team gets the short clock after two auto-picks in a row', async () => {
    const { getDraftUISettingsForLeague } = await import('@/lib/draft-defaults/DraftUISettingsResolver')
    const row = (overall: number, rosterId: string, source: string) => ({
      id: `seed-${overall}`, sessionId: 'session-1', overall, round: Math.ceil(overall / 2), slot: rosterId === 'roster-a' ? 1 : 2,
      rosterId, playerName: `Seed ${overall}`, position: 'RB', source,
    })
    const frozen = new Date('2026-07-04T12:00:00.000Z')
    const pickFour = async (rule: { enabled: boolean; missedPicks: number; seconds: number }) => {
      ctx.resetStore()
      Object.assign(ctx.store.session, { rounds: 4, teamCount: 2, draftType: 'linear', thirdRoundReversal: false })
      ctx.store.picks = [row(1, 'roster-a', 'auto'), row(2, 'roster-b', 'user'), row(3, 'roster-a', 'auto')]
      vi.mocked(getDraftUISettingsForLeague).mockResolvedValueOnce({ tradedPickOwnerNameRedEnabled: false, tradedPickColorModeEnabled: false, absentManagerRule: rule } as never)
      const r = await submitPick({ leagueId: 'league-1', playerName: 'Fourth', position: 'WR', rosterId: 'roster-b', playerId: 'p4', expectedOverall: 4 })
      expect(r).toMatchObject({ success: true })
      return ctx.store.session.timerEndAt!.getTime() - frozen.getTime()
    }
    vi.useFakeTimers()
    vi.setSystemTime(frozen)
    try {
      // Linear, 2 teams: pick 5 is roster-a, whose last two picks were both auto-picked.
      expect(await pickFour({ enabled: true, missedPicks: 2, seconds: 15 })).toBe(15_000)
      expect(await pickFour({ enabled: true, missedPicks: 3, seconds: 15 })).toBe(90_000)
      expect(await pickFour({ enabled: false, missedPicks: 2, seconds: 15 })).toBe(90_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('traded pick: on-clock owner is new roster; wrong roster rejected', async () => {
    ctx.store.session.tradedPicks = [
      {
        round: 1,
        originalRosterId: 'roster-a',
        previousOwnerName: 'Team A',
        newRosterId: 'roster-b',
        newOwnerName: 'Team B',
      },
    ]
    const wrong = await submitPick({
      leagueId: 'league-1',
      playerName: 'No',
      position: 'WR',
      rosterId: 'roster-a',
      playerId: 'n1',
      expectedOverall: 1,
    })
    expect(wrong.success).toBe(false)
    expect(wrong.code).toBe(DRAFT_PICK_NOT_ON_CLOCK)

    const ok = await submitPick({
      leagueId: 'league-1',
      playerName: 'Yes',
      position: 'WR',
      rosterId: 'roster-b',
      playerId: 'y1',
      expectedOverall: 1,
    })
    expect(ok.success).toBe(true)
    expect(ctx.store.picks[0]!.rosterId).toBe('roster-b')
    expect(ctx.store.picks[0]!.originalRosterId).toBe('roster-a')
    expect(ctx.store.picks[0]!.tradedPickMeta).toMatchObject({
      originalRosterId: 'roster-a',
      newOwnerName: 'Team B',
    })
  })
})


describe('rookies-only drafts: the server decides, for manager picks and autopicks', () => {
  beforeEach(() => {
    ctx.resetStore()
    vi.clearAllMocks()
    ctx.store.session.playerPool = 'rookies_only'
    resolveServerRookieStatusMock.mockResolvedValue(false)
  })

  const vetPick = (source: 'user' | 'auto' | 'commissioner') => ({
    leagueId: 'league-1',
    playerName: 'Veteran Star',
    position: 'QB',
    playerId: 'vet-1',
    rosterId: 'roster-a',
    source,
    expectedOverall: 1,
  })

  it('refuses a manager pick of a veteran, with no client rookie hint', async () => {
    const r = await submitPick(vetPick('user'))
    expect(r.success).toBe(false)
    expect(ctx.store.picks).toHaveLength(0)
    expect(resolveServerRookieStatusMock).toHaveBeenCalledWith({ leagueId: 'league-1', playerId: 'vet-1', playerName: 'Veteran Star' })
  })

  it('refuses an autopick of a veteran too', async () => {
    const r = await submitPick(vetPick('auto'))
    expect(r.success).toBe(false)
    expect(ctx.store.picks).toHaveLength(0)
  })

  it('a commissioner pick keeps its override and never asks', async () => {
    const r = await submitPick(vetPick('commissioner'))
    expect(r.success).toBe(true)
    expect(resolveServerRookieStatusMock).not.toHaveBeenCalled()
  })

  it('an unknown verdict keeps the previous behaviour', async () => {
    resolveServerRookieStatusMock.mockResolvedValue(null)
    const r = await submitPick(vetPick('auto'))
    expect(r.success).toBe(true)
  })
})

describe('tournament pick versus control version fencing', () => {
  beforeEach(() => { ctx.resetStore(); vi.clearAllMocks(); ctx.store.season = true })
  const input = { leagueId: 'league-1', playerName: 'Josh Allen', position: 'QB', playerId: 'p1', rosterId: 'roster-a', expectedOverall: 1 }
  it('rejects a changed session version before inserting a pick', async () => {
    ctx.store.transactionVersionOverride = 6
    expect(await submitPick(input)).toMatchObject({ success: false, code: DRAFT_PICK_RACE_RETRY })
    expect(ctx.store.picks).toHaveLength(0)
  })
  it('rolls back pick insertion if a control wins the session version claim', async () => {
    ctx.store.rejectVersionClaim = true
    expect(await submitPick(input)).toMatchObject({ success: false, code: DRAFT_PICK_RACE_RETRY })
    expect(ctx.store.picks).toHaveLength(0)
    expect(ctx.store.session.version).toBe(5)
  })
  it('commits a valid tournament pick with one version increment', async () => {
    expect((await submitPick(input)).success).toBe(true)
    expect(ctx.store.picks).toHaveLength(1)
    expect(ctx.store.session.version).toBe(6)
  })
})
