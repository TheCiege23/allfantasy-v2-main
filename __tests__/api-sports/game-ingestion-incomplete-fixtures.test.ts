import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * D1 — production API-Sports ingestion was rejecting game records.
 *
 * Worker logs at ~2026-09-10T12:50:10Z carried `PrismaClientValidationError` from
 * `sportsGame.upsert` — `Argument homeTeam must not be null` — for NFL and NCAAF payloads, and
 * at 12:50:26Z Railway reported its 500-logs/second limit with 8,501 messages dropped.
 *
 * These tests reproduce the defect against the real writer with a mocked store: the first one
 * FAILS on the pre-fix code (a nameless fixture takes the upsert path and its rejection also
 * takes the valid fixture's counter with it into an unbounded log), and the rest pin the
 * intended behaviour.
 */

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { upsert: h.upsert, update: h.update, findUnique: h.findUnique },
  },
}))

import { writeApiSportsGames, resolveApiSportsGameTeams, type APISportsGame } from '@/lib/api-sports'

const fixture = (over: Partial<APISportsGame> = {}, id = 1): APISportsGame =>
  ({
    game: {
      id,
      stage: 'Regular Season',
      week: 'Week 2',
      date: { date: '2026-09-14', time: '17:00', timestamp: 1789398000 },
      venue: { name: 'Lumen Field', city: 'Seattle' },
      status: { short: 'NS', long: 'Not Started' },
    },
    league: { id: 1, name: 'NFL', season: '2026' },
    teams: {
      home: { id: 10, name: 'Seattle Seahawks', logo: null },
      away: { id: 11, name: 'San Francisco 49ers', logo: null },
    },
    scores: { home: { total: null }, away: { total: null } },
    ...over,
  }) as APISportsGame

/** The shape the vendor actually ships for an unresolved postseason slot. */
const nameless = (id = 2): APISportsGame =>
  fixture(
    {
      /*
       * ⚠ THE VENDOR SHIPS BOTH SHAPES ON AN UNRESOLVED FIXTURE — a null id and a placeholder
       * `0`. Both must be treated as "no id": `0 != null` is TRUE, so a `!= null` guard wrote
       * the string "0" into `homeTeamId`, which reads as a real team to every consumer.
       */
      teams: {
        home: { id: null, name: null as unknown as string, logo: null },
        away: { id: 0, name: null as unknown as string, logo: null },
      },
    },
    id,
  )

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  h.upsert.mockReset().mockResolvedValue({})
  h.update.mockReset().mockResolvedValue({})
  h.findUnique.mockReset().mockResolvedValue(null)
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe('resolveApiSportsGameTeams', () => {
  it('reports a nameless side as unresolved rather than inventing a name', () => {
    // "TBD" would be indistinguishable from a real team to every reader downstream.
    const r = resolveApiSportsGameTeams(nameless())
    expect(r.homeTeam).toBeNull()
    expect(r.awayTeam).toBeNull()
    expect(r.complete).toBe(false)
  })

  it('still resolves a complete fixture through the abbreviation table', () => {
    const r = resolveApiSportsGameTeams(fixture())
    expect(r.complete).toBe(true)
    expect(r.homeTeam).toBeTruthy()
    expect(r.awayTeam).toBeTruthy()
  })
})

describe('a malformed fixture must not block valid records', () => {
  it('writes the valid fixture and defers the nameless one', async () => {
    // The reproduction. Pre-fix, the nameless fixture reached `upsert` and Prisma rejected it.
    const res = await writeApiSportsGames([fixture({}, 1), nameless(2), fixture({}, 3)], 'NFL')

    expect(res.fetched).toBe(3)
    expect(res.written).toBe(2)
    expect(res.deferred).toBe(1)
    expect(res.failed).toBe(0)
    expect(res.deferredSampleIds).toEqual(['2'])
  })

  it('never sends a null team name to the store', async () => {
    await writeApiSportsGames([nameless(7)], 'NCAAF')

    expect(h.upsert).not.toHaveBeenCalled()
    for (const call of h.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('homeTeam')
      expect(call[0].data).not.toHaveProperty('awayTeam')
    }
  })

  it('counts fetched, written, deferred and failed separately', async () => {
    h.upsert.mockRejectedValueOnce(new Error('unique constraint'))

    const res = await writeApiSportsGames([fixture({}, 1), fixture({}, 2), nameless(3)], 'NFL')

    expect(res).toMatchObject({ fetched: 3, written: 1, deferred: 1, failed: 1 })
  })
})

describe('positive control — the store really does reject a null team name', () => {
  /*
   * ⚠ A GREEN CHECK THAT HAS NEVER GONE RED IS NOT EVIDENCE. The tests above pass because the
   * writer no longer hands a nameless fixture to `upsert`; on their own they cannot tell that
   * apart from a store that would have accepted it anyway. This mock enforces the real Prisma
   * constraint — `homeTeam` is a required `String` on `SportsGame` — so the run is measuring
   * the guard rather than the mock's tolerance.
   */
  const strictUpsert = (args: { create?: Record<string, unknown> }) => {
    const c = args.create ?? {}
    if (c.homeTeam == null) {
      return Promise.reject(new Error('Argument `homeTeam` must not be null.'))
    }
    if (c.awayTeam == null) {
      return Promise.reject(new Error('Argument `awayTeam` must not be null.'))
    }
    return Promise.resolve({})
  }

  it('rejects the nameless fixture when it IS handed to the store', async () => {
    h.upsert.mockImplementation(strictUpsert)

    // Prove the constraint bites: call the store the way the pre-fix writer did.
    await expect(
      h.upsert({ create: { homeTeam: null, awayTeam: null } }),
    ).rejects.toThrow(/homeTeam/)
  })

  it('and the writer never reaches that rejection', async () => {
    h.upsert.mockImplementation(strictUpsert)

    const res = await writeApiSportsGames([nameless(1), fixture({}, 2)], 'NFL')

    expect(res).toMatchObject({ fetched: 2, written: 1, deferred: 1, failed: 0 })
  })
})

describe('incomplete fixtures are retained where the schema supports it', () => {
  it('refreshes an existing row without nulling its known team names', async () => {
    // The recovery path: we already hold both names, so scores and status still move.
    h.findUnique.mockResolvedValue({ id: 'row-1' })

    const res = await writeApiSportsGames([nameless(9)], 'NFL')

    expect(res.written).toBe(1)
    expect(res.deferred).toBe(0)
    expect(h.update).toHaveBeenCalledTimes(1)
    const data = h.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty('homeTeam')
    expect(data).not.toHaveProperty('awayTeam')
    expect(data).toHaveProperty('status')
  })

  it('preserves the stored team IDS as well as the names', async () => {
    /*
     * 🛑 THE RECOVERY UPDATE NULLED THE PROVIDER IDS WHILE CAREFULLY KEEPING THE NAMES.
     *
     * `mutableFields` omitted `homeTeam`/`awayTeam` so a stored name survived, then recomputed
     * `homeTeamId`/`awayTeamId` from the SAME nullable payload. A row written complete on Monday
     * (`homeTeam='KC'`, `homeTeamId='16'`) came back Tuesday with `teams.home = { id: null,
     * name: null }` and ended up with a name and no id — and `app/api/sports/route.ts` returns
     * whole SportsGame rows with no `select`, so the nulled id shipped to clients while
     * `written++` reported a healthy write.
     */
    h.findUnique.mockResolvedValue({ id: 'row-1' })

    await writeApiSportsGames([nameless(9)], 'NFL')

    const data = h.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty('homeTeamId')
    expect(data).not.toHaveProperty('awayTeamId')
    expect(data).not.toHaveProperty('homeTeam')
    expect(data).not.toHaveProperty('awayTeam')
  })

  it('still writes team ids when the provider supplies them', async () => {
    await writeApiSportsGames([fixture()], 'NFL')

    const call = h.upsert.mock.calls[0][0]
    expect(call.create.homeTeamId).toBe('10')
    expect(call.update.awayTeamId).toBe('11')
  })

  it('lets a later complete fixture be ingested normally', async () => {
    // First pass: nothing stored, nothing to update — deferred, no write.
    const first = await writeApiSportsGames([nameless(42)], 'NFL')
    expect(first).toMatchObject({ written: 0, deferred: 1, failed: 0 })

    // Second pass: the provider has named both sides. The same externalId now writes.
    const second = await writeApiSportsGames([fixture({}, 42)], 'NFL')
    expect(second).toMatchObject({ written: 1, deferred: 0, failed: 0 })
    expect(h.upsert).toHaveBeenCalledTimes(1)
    const call = h.upsert.mock.calls[0][0]
    expect(call.where.sport_externalId_source.externalId).toBe('42')
    expect(call.create.homeTeam).toBeTruthy()
    expect(call.update.awayTeam).toBeTruthy()
  })
})

describe('log volume is bounded', () => {
  it('logs at most five write failures then reports the suppressed remainder', async () => {
    // 8,501 dropped Railway messages came from one full error object per rejected fixture.
    h.upsert.mockRejectedValue(new Error('boom'))
    const games = Array.from({ length: 20 }, (_, i) => fixture({}, i + 1))

    const res = await writeApiSportsGames(games, 'NFL')

    expect(res.failed).toBe(20)
    // Five per-fixture lines plus one summary line — not twenty.
    expect(errorSpy).toHaveBeenCalledTimes(6)
    expect(String(errorSpy.mock.calls.at(-1)?.[0])).toContain('suppressed 15')
  })

  it('logs the error message, never the whole error object', async () => {
    h.upsert.mockRejectedValue(new Error('Argument homeTeam must not be null'))

    await writeApiSportsGames([fixture()], 'NFL')

    expect(errorSpy.mock.calls[0][1]).toBe('Argument homeTeam must not be null')
  })
})
