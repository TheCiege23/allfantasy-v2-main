/**
 * Sleeper → league_player_weekly_scores.
 *
 * The cases here are the ones that corrupt data silently rather than throw, so
 * none of them would surface in a smoke test:
 *
 *   - Sleeper returns an all-zero placeholder row for every unplayed week
 *   - "0" is its empty-starter-slot marker, not a player id
 *   - a missing point value coerces to 0, which asserts something false
 *
 * Each is claimed by a comment in the writer; each is asserted here so the claim
 * cannot quietly stop being true.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'

const getLeagueMatchups = vi.fn()
const findMany = vi.fn()
const createMany = vi.fn()
const executeRaw = vi.fn()
const legacyUpsert = vi.fn()
const legacyFindFirst = vi.fn()

vi.mock('@/lib/sleeper-client', () => ({
  getLeagueMatchups: (...a: unknown[]) => getLeagueMatchups(...a),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leaguePlayerWeeklyScore: {
      findMany: (...a: unknown[]) => findMany(...a),
      createMany: (...a: unknown[]) => createMany(...a),
      upsert: (...a: unknown[]) => legacyUpsert(...a),
      findFirst: (...a: unknown[]) => legacyFindFirst(...a),
    },
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
  },
}))

import { ingestSleeperPlayerScoresForWeek } from '@/lib/sleeper/sync/ingestSleeperPlayerScores'

type SentRow = { playerId: string; rosterId: number | null; points: number; isStarter: boolean; isFinalized?: boolean; source?: string }

/** Rows inserted through `createMany` (new rows). */
const inserted = (): SentRow[] => createMany.mock.calls.flatMap((call) => (call[0] as { data: SentRow[] }).data)
/** Rows sent to the guarded UPDATE (changed rows). */
const updated = (): SentRow[] =>
  executeRaw.mock.calls.flatMap((call) => {
    const payload = (call.slice(1) as unknown[]).find((v) => typeof v === 'string' && v.startsWith('['))
    return payload ? (JSON.parse(payload as string) as SentRow[]) : []
  })
/** Every row written, inserted or updated. */
const sent = (): SentRow[] => [...inserted(), ...updated()]
/** Any write at all. */
const anyWrite = () => createMany.mock.calls.length + executeRaw.mock.calls.length

/** The SQL text of the guarded UPDATE (tagged-template strings joined). */
const sqlText = () => (executeRaw.mock.calls[0]?.[0] as string[] | undefined)?.join('$') ?? ''

/** Ids written, in call order. */
const written = () => sent().map((r) => r.playerId)

const created = (playerId: string) => sent().find((r) => r.playerId === playerId)

/** A stored row as `findMany` returns it. */
const stored = (playerId: string, over: Partial<{ rosterId: number | null; points: number; isStarter: boolean; source: string }> = {}) => ({
  playerId, rosterId: 7, points: 0, isStarter: false, source: 'sleeper', ...over,
})

describe('ingestSleeperPlayerScoresForWeek', () => {
  beforeEach(() => {
    getLeagueMatchups.mockReset()
    findMany.mockReset().mockResolvedValue([])
    createMany.mockReset().mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }))
    executeRaw.mockReset().mockImplementation(async (_strings: unknown, ...values: unknown[]) => {
      const payload = values.find((v) => typeof v === 'string' && v.startsWith('['))
      return payload ? (JSON.parse(payload as string) as unknown[]).length : 0
    })
  })

  it('writes each scored player once, with the platform points verbatim', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1,
        roster_id: 7,
        points: 96.2,
        starters: ['p1', 'p2'],
        starters_points: [20.5, 12.4],
        players: ['p1', 'p2', 'p3'],
        players_points: { p1: 20.5, p2: 12.4, p3: 3.1 },
      },
    ])

    const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)

    expect(r.scoresUpserted).toBe(3)
    expect(written().sort()).toEqual(['p1', 'p2', 'p3'])
    // Points are stored exactly as Sleeper reported them — never recomputed.
    expect(created('p1')?.points).toBe(20.5)
    expect(created('p3')?.points).toBe(3.1)
    expect(created('p1')?.rosterId).toBe(7)
  })

  it('stores negative-only scoring rather than treating it as an unplayed week', async () => {
    getLeagueMatchups.mockResolvedValue([{ roster_id: 7, points: -2, starters: ['p1'], starters_points: [-2], players_points: { p1: -2 } }])
    const result = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(result.scoresUpserted).toBe(1)
    expect(created('p1')?.points).toBe(-2)
  })

  it('applies an all-zero correction when this roster-week has recorded scoring', async () => {
    findMany.mockResolvedValue([stored('p1', { points: 6.5, isStarter: true })])
    getLeagueMatchups.mockResolvedValue([{ roster_id: 7, points: 0, starters: ['p1'], starters_points: [0], players_points: { p1: 0 } }])
    await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(created('p1')?.points).toBe(0)
    // One read of the stored week answers "was this roster-week scored" — no per-roster query.
    expect(findMany).toHaveBeenCalledOnce()
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L1', seasonYear: 2026, week: 12 } }))
  })

  it('does not treat another source\'s row as evidence the roster-week was scored', async () => {
    findMany.mockResolvedValue([stored('p1', { points: 6.5, source: 'espn' })])
    getLeagueMatchups.mockResolvedValue([{ roster_id: 7, points: 0, starters: ['p1'], starters_points: [0], players_points: { p1: 0 } }])
    const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(r.rostersSkippedUnscored).toBe(1)
    expect(anyWrite()).toBe(0)
  })

  it('rejects arrays as score maps and never coerces booleans or blank values to points', async () => {
    getLeagueMatchups.mockResolvedValue([
      { roster_id: 7, points: 2, starters: [], players_points: [2] },
      { roster_id: 8, points: 2, starters: [], players_points: { p1: 2, p2: true, p3: [], p4: '   ' } },
    ])
    const result = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(written()).toEqual(['p1'])
    expect(result.rostersMalformed).toBe(1)
  })

  it('marks only the players in `starters` as starters', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 30,
        starters: ['p1'], starters_points: [20.5],
        players: ['p1', 'p3'], players_points: { p1: 20.5, p3: 9.5 },
      },
    ])
    await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(created('p1')?.isStarter).toBe(true)
    expect(created('p3')?.isStarter).toBe(false)
  })

  /**
   * Sleeper returns a row for every week/roster whether or not it has been
   * played. Writing those zeroes would be indistinguishable from "he played and
   * scored nothing".
   */
  it('writes nothing for an unplayed week', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 0,
        starters: ['p1', 'p2'], starters_points: [0, 0],
        players: ['p1', 'p2'], players_points: { p1: 0, p2: 0 },
      },
    ])
    const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 14)
    expect(anyWrite()).toBe(0)
    expect(r.rostersSkippedUnscored).toBe(1)
    expect(r.scoresUpserted).toBe(0)
  })

  /** A real zero inside a played week IS a fact and must be kept. */
  it('keeps a genuine zero when the week was played', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 20.5,
        starters: ['p1', 'p2'], starters_points: [20.5, 0],
        players: ['p1', 'p2'], players_points: { p1: 20.5, p2: 0 },
      },
    ])
    await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(written().sort()).toEqual(['p1', 'p2'])
    expect(created('p2')?.points).toBe(0)
  })

  /** "0" is Sleeper's empty-slot marker. A phantom player who scores is worse than a gap. */
  it('never writes a row for the "0" empty-slot marker', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 20.5,
        starters: ['p1', '0'], starters_points: [20.5, 0],
        players: ['p1', '0'], players_points: { p1: 20.5, '0': 0 },
      },
    ])
    await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(written()).toEqual(['p1'])
  })

  /** Number(null) is 0, and a 0 would assert he scored nothing. Skip, don't coerce. */
  it('skips a non-finite value rather than coercing it to zero', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 20.5,
        starters: ['p1'], starters_points: [20.5],
        players: ['p1', 'p2'],
        players_points: { p1: 20.5, p2: null as unknown as number },
      },
    ])
    await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(written()).toEqual(['p1'])
  })

  /** Nothing observed at ingestion can justify calling a score final — corrections run ~12h. */
  it('never writes isFinalized true', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 20.5,
        starters: ['p1'], starters_points: [20.5],
        players: ['p1'], players_points: { p1: 20.5 },
      },
    ])
    await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    // A new row is provisional.
    expect(inserted()[0]).toMatchObject({ playerId: 'p1', isFinalized: false, source: 'sleeper' })

    // A changed row is made provisional by the UPDATE, and nothing ever writes true.
    findMany.mockResolvedValue([stored('p1', { points: 1, isStarter: true })])
    await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(sqlText()).toMatch(/"isFinalized" = false/)
    expect(sqlText()).not.toMatch(/"isFinalized"\s*=\s*true/)
  })

  it('reports a provider failure instead of throwing past the caller', async () => {
    getLeagueMatchups.mockRejectedValue(new Error('sleeper 503'))
    const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(r.error).toContain('sleeper 503')
    expect(r.scoresUpserted).toBe(0)
    expect(anyWrite()).toBe(0)
  })

  /** A shape change should be visible in the result, not produce a silent empty week. */
  it('counts a malformed players_points rather than swallowing it', async () => {
    getLeagueMatchups.mockResolvedValue([
      {
        matchup_id: 1, roster_id: 7, points: 20.5,
        starters: ['p1'], starters_points: [20.5],
        players: ['p1'], players_points: undefined as unknown as Record<string, number>,
      },
    ])
    const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
    expect(r.rostersMalformed).toBe(1)
    expect(anyWrite()).toBe(0)
  })
  describe('change-aware writes', () => {
    const week = [
      {
        matchup_id: 1, roster_id: 7, points: 32.9,
        starters: ['p1', 'p2'], starters_points: [20.5, 12.4],
        players: ['p1', 'p2', 'p3'], players_points: { p1: 20.5, p2: 12.4, p3: 3.1 },
      },
    ]
    const storedWeek = [
      stored('p1', { points: 20.5, isStarter: true }),
      stored('p2', { points: 12.4, isStarter: true }),
      stored('p3', { points: 3.1, isStarter: false }),
    ]

    it('writes nothing when an identical week is synced again', async () => {
      getLeagueMatchups.mockResolvedValue(week)
      findMany.mockResolvedValue(storedWeek)
      const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(anyWrite()).toBe(0)
      expect(r).toMatchObject({ scoresUpserted: 0, scoresUnchanged: 3, error: null })
    })

    it('two consecutive identical syncs write once, then never again', async () => {
      getLeagueMatchups.mockResolvedValue(week)
      findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(storedWeek)
      const first = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      const second = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(first.scoresUpserted).toBe(3)
      expect(second).toMatchObject({ scoresUpserted: 0, scoresUnchanged: 3 })
      expect(createMany).toHaveBeenCalledOnce()
      expect(executeRaw).not.toHaveBeenCalled()
    })

    it('sends only the player whose score actually changed, in one statement', async () => {
      getLeagueMatchups.mockResolvedValue([{ ...week[0], players_points: { p1: 22.5, p2: 12.4, p3: 3.1 }, starters_points: [22.5, 12.4] }])
      findMany.mockResolvedValue(storedWeek)
      const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(executeRaw).toHaveBeenCalledOnce()
      expect(createMany).not.toHaveBeenCalled()
      expect(written()).toEqual(['p1'])
      expect(created('p1')?.points).toBe(22.5)
      expect(r).toMatchObject({ scoresUpserted: 1, scoresUnchanged: 2 })
    })

    it('treats a starter/bench move or a roster move as a change', async () => {
      getLeagueMatchups.mockResolvedValue([
        { ...week[0], starters: ['p1', 'p3'], starters_points: [20.5, 3.1] },
      ])
      findMany.mockResolvedValue(storedWeek)
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(written().sort()).toEqual(['p2', 'p3'])

      executeRaw.mockClear()
      createMany.mockClear()
      getLeagueMatchups.mockResolvedValue([{ ...week[0], roster_id: 8 }])
      findMany.mockResolvedValue(storedWeek)
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(written().sort()).toEqual(['p1', 'p2', 'p3'])
      expect(created('p1')?.rosterId).toBe(8)
    })

    it('leaves a finalized score sealed when the provider still reports it identically', async () => {
      getLeagueMatchups.mockResolvedValue(week)
      // `isFinalized` is not even read: an identical row is simply not written, so nothing can unseal it.
      findMany.mockResolvedValue(storedWeek.map((row) => ({ ...row, isFinalized: true })))
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(anyWrite()).toBe(0)
    })

    it('guards the write itself, so a row brought up to date concurrently is not unsealed', async () => {
      getLeagueMatchups.mockResolvedValue([{ ...week[0], players_points: { p1: 22.5, p2: 12.4, p3: 3.1 } }])
      findMany.mockResolvedValue(storedWeek)
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(sqlText()).toMatch(/IS DISTINCT FROM/)
      // The observation-time fence: never overwrite a row holding a newer observation.
      expect(sqlText()).toMatch(/s\."updatedAt" <= \(\$::timestamptz AT TIME ZONE 'UTC'\)/)
      expect(sqlText()).toMatch(/"updatedAt" = \(\$::timestamptz AT TIME ZONE 'UTC'\)/)
    })

    it('stamps new rows with the time the observation was taken, before the provider call', async () => {
      let fetchedAt = 0
      getLeagueMatchups.mockImplementation(async () => { fetchedAt = Date.now(); return week })
      const before = Date.now()
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      const stamp = (createMany.mock.calls[0][0] as { data: Array<{ updatedAt: Date }> }).data[0].updatedAt
      expect(stamp).toBeInstanceOf(Date)
      expect(stamp.getTime()).toBeGreaterThanOrEqual(before)
      expect(stamp.getTime()).toBeLessThanOrEqual(fetchedAt)
    })

    it('a short createMany count re-sends EVERY attempted insert, without guessing which conflicted', async () => {
      getLeagueMatchups.mockResolvedValue(week)
      createMany.mockResolvedValue({ count: 1 })
      executeRaw.mockResolvedValue(2)
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(updated().map((x) => x.playerId).sort()).toEqual(['p1', 'p2', 'p3'])
    })

    it('inserts new rows through Prisma, so they keep the model\'s own id default', async () => {
      getLeagueMatchups.mockResolvedValue(week)
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(createMany).toHaveBeenCalledOnce()
      const args = createMany.mock.calls[0][0] as { data: Array<Record<string, unknown>>; skipDuplicates: boolean }
      expect(args.skipDuplicates).toBe(true)
      expect(args.data.every((row) => !('id' in row))).toBe(true)
      expect(args.data[0]).toMatchObject({ leagueId: 'L1', seasonYear: 2026, week: 12 })
    })

    it('a row another writer inserted after the read is settled by the guarded update, not lost', async () => {
      getLeagueMatchups.mockResolvedValue(week)
      createMany.mockResolvedValue({ count: 2 })
      executeRaw.mockResolvedValue(1)
      const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(updated().map((x) => x.playerId).sort()).toEqual(['p1', 'p2', 'p3'])
      expect(r.scoresUpserted).toBe(3)
    })

    it('sends a player listed under two rosters once, last roster wins', async () => {
      getLeagueMatchups.mockResolvedValue([
        { roster_id: 7, points: 10, starters: ['p1'], starters_points: [10], players_points: { p1: 10 } },
        { roster_id: 8, points: 11, starters: ['p1'], starters_points: [11], players_points: { p1: 11 } },
      ])
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(written()).toEqual(['p1'])
      expect(created('p1')).toMatchObject({ rosterId: 8, points: 11 })
    })

    it('reports a database failure instead of throwing past the caller', async () => {
      getLeagueMatchups.mockResolvedValue(week)
      createMany.mockRejectedValue(new Error('connection reset'))
      const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(r.error).toContain('connection reset')
      expect(r.scoresUpserted).toBe(0)
    })
  })
  describe('kill switch: AF_CHANGE_AWARE_WRITES_OFF', () => {
    const week = [{
      matchup_id: 1, roster_id: 7, points: 32.9,
      starters: ['p1'], starters_points: [20.5],
      players: ['p1', 'p2'], players_points: { p1: 20.5, p2: 12.4 },
    }]
    beforeEach(() => {
      legacyUpsert.mockReset().mockResolvedValue({})
      legacyFindFirst.mockReset().mockResolvedValue(null)
    })
    afterEach(() => { delete process.env.AF_CHANGE_AWARE_WRITES_OFF })

    for (const value of ['weekly-scores', 'all', 'rosters, weekly-scores']) {
      it(`"${value}" restores the old one-upsert-per-row writer`, async () => {
        process.env.AF_CHANGE_AWARE_WRITES_OFF = value
        getLeagueMatchups.mockResolvedValue(week)
        findMany.mockResolvedValue([stored('p1', { points: 20.5, isStarter: true }), stored('p2', { points: 12.4 })])
        const r = await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
        // Every row written again, unchanged or not, exactly as before.
        expect(legacyUpsert).toHaveBeenCalledTimes(2)
        expect(legacyUpsert.mock.calls[0][0]).toMatchObject({ update: { isFinalized: false, points: 20.5 } })
        expect(findMany).not.toHaveBeenCalled()
        expect(anyWrite()).toBe(0)
        expect(r.scoresUpserted).toBe(2)
      })
    }

    it('another writer\'s name leaves this one on', async () => {
      process.env.AF_CHANGE_AWARE_WRITES_OFF = 'matchups'
      getLeagueMatchups.mockResolvedValue(week)
      await ingestSleeperPlayerScoresForWeek('L1', 2026, 12)
      expect(legacyUpsert).not.toHaveBeenCalled()
      expect(createMany).toHaveBeenCalledOnce()
    })
  })
})
