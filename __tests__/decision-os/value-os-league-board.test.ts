import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Value OS, 2026-11-21 (ranked build item 4): a league's value board read through the domain-OS kernel, held three
 * minutes, stored through a codec that keeps Maps, Dates and non-finite numbers — and the ONE board the trade grade
 * and every value surface read.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { encodeFacts, decodeFacts } = await import('@/lib/decision-os/domain-os/factCodec')
const { loadCachedLeagueBoardBase, leagueValueBoardSource, leagueBoardFingerprint, VALUE_BOARD_CACHE_ENV } = await import('@/lib/decision-os/value-os/leagueBoard')
const { createSportPointsGrader } = await import('@/lib/decision-os/trade/sportPointsGrader')

/** A store that keeps facts the way Postgres JSON does: through JSON.stringify / JSON.parse. */
function jsonStore() {
  const rows = new Map<string, { json: string; at: number }>()
  const key = (a: { domain: string; kind: string; level: string; scopeKey: string }) => `${a.domain}|${a.kind}|${a.level}|${a.scopeKey}`
  let now = 0
  return {
    rows,
    tick: (ms: number) => (now += ms),
    store: {
      read: vi.fn(async (a: { domain: string; kind: string; level: string; scopeKey: string; ttlMs: number }) => {
        const r = rows.get(key(a))
        if (!r || now - r.at > a.ttlMs) return null
        return { facts: JSON.parse(r.json), level: a.level, confidence: null, sampleSize: null, capturedAt: new Date(r.at), ageMs: now - r.at } as never
      }),
      write: vi.fn(async (a: { domain: string; kind: string; level: string; scopeKey: string; facts: unknown }) => {
        rows.set(key(a), { json: JSON.stringify(a.facts), at: now })
        return true
      }),
    },
  }
}

const player = (id: string, perGame: number) => ({ id, name: `P ${id}`, position: 'C', perGame, sampleGames: 30, aliases: [`sl-${id}`] })

/** A board with every shape plain JSON loses: Maps (nested too), a Date, NaN and Infinity. */
function ctx() {
  const a = player('a', 41.5)
  const b = player('b', Number.NaN)
  return {
    sport: 'NBA' as const,
    board: [a, b, { ...player('c', Number.POSITIVE_INFINITY), seasonBlend: null }],
    rosterIndex: new Map([['roster-1', a], ['roster-2', b]]),
    replacementByPosition: new Map([['C', { name: 'Best FA', perGame: 20.1 }]]),
    window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 60, scheduleKnown: true, asOf: new Date('2026-11-21T12:00:00.000Z') },
    scoringBasis: 'league' as const,
    teams: 12,
    valueKind: 'points' as const,
    dynasty: { ages: new Map([['a', 24]]), nextDraftYear: 2027, prospectAdp: new Map([['x', { name: 'Prospect', rank: 3 }]]) },
  }
}

const league = { id: 'L1', platform: 'sleeper', settings: {}, leagueType: 'redraft', leagueSize: 12, season: 2026, status: 'in_season' }

describe('factCodec', () => {
  it('🛑 a board survives a JSON round trip exactly — Maps, a Date, NaN and Infinity', () => {
    const original = ctx()
    const back = decodeFacts<ReturnType<typeof ctx>>(JSON.parse(JSON.stringify(encodeFacts(original))))
    expect(back).toEqual(original)
    expect(back.rosterIndex).toBeInstanceOf(Map)
    expect(back.rosterIndex.get('roster-1')?.perGame).toBe(41.5)
    expect(back.replacementByPosition.get('C')).toEqual({ name: 'Best FA', perGame: 20.1 })
    expect(back.dynasty.ages.get('a')).toBe(24)
    expect(back.dynasty.prospectAdp.get('x')?.rank).toBe(3)
    expect(back.window.asOf).toBeInstanceOf(Date)
    expect(back.window.asOf.getTime()).toBe(original.window.asOf.getTime())
    expect(Number.isNaN(back.board[1].perGame)).toBe(true)
    expect(back.board[2].perGame).toBe(Number.POSITIVE_INFINITY)
  })

  it('plain JSON would have lost them — the control that makes the test above mean something', () => {
    const lossy = JSON.parse(JSON.stringify(ctx()))
    expect(lossy.rosterIndex).toEqual({})
    expect(lossy.board[1].perGame).toBeNull()
    expect(typeof lossy.window.asOf).toBe('string')
  })

  it('refuses what it cannot encode faithfully, rather than storing something else', () => {
    expect(() => encodeFacts({ s: new Set([1]) })).toThrow(/no faithful JSON encoding/)
    expect(() => encodeFacts({ f: () => 1 })).toThrow(/no faithful JSON encoding/)
  })
})

describe('the league board through the kernel', () => {
  let s: ReturnType<typeof jsonStore>
  let build: ReturnType<typeof vi.fn>
  beforeEach(() => {
    s = jsonStore()
    build = vi.fn(async () => ({ ok: true as const, ctx: ctx() }))
  })

  it('builds once, then serves the stored board — the same board, decoded', async () => {
    const first = await loadCachedLeagueBoardBase({ sport: 'NBA', league }, { store: s.store as never, build: build as never, env: {} })
    const second = await loadCachedLeagueBoardBase({ sport: 'NBA', league }, { store: s.store as never, build: build as never, env: {} })
    expect(build).toHaveBeenCalledTimes(1)
    expect(first).toMatchObject({ ok: true, servedFrom: 'live' })
    expect(second).toMatchObject({ ok: true, servedFrom: 'store' })
    expect(second.ok && second.ctx).toEqual(ctx())
    expect(second.ok && second.ctx.rosterIndex).toBeInstanceOf(Map)
  })

  it('three minutes, league-scoped: a stale entry is rebuilt, another league is its own entry', async () => {
    expect(leagueValueBoardSource.ttlMs).toBe(3 * 60 * 1000)
    expect(leagueValueBoardSource.level).toBe('league')
    const d = { store: s.store as never, build: build as never, env: {} }
    await loadCachedLeagueBoardBase({ sport: 'NBA', league }, d)
    s.tick(3 * 60 * 1000 + 1)
    await loadCachedLeagueBoardBase({ sport: 'NBA', league }, d)
    await loadCachedLeagueBoardBase({ sport: 'NBA', league: { ...league, id: 'L2' } }, d)
    expect(build).toHaveBeenCalledTimes(3)
  })

  it('🛑 a refusal is never cached, and reaches the caller with its own reason and gap', async () => {
    const refused = { ok: false as const, reason: 'No NBA scoring is configured, so this deal cannot be graded.', valuationGap: { kind: 'x' } as never }
    build.mockResolvedValueOnce(refused).mockResolvedValueOnce({ ok: true, ctx: ctx() })
    const d = { store: s.store as never, build: build as never, env: {} }
    expect(await loadCachedLeagueBoardBase({ sport: 'NBA', league }, d)).toEqual(refused)
    expect(s.store.write).not.toHaveBeenCalled()
    expect(await loadCachedLeagueBoardBase({ sport: 'NBA', league }, d)).toMatchObject({ ok: true })
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('does not share a projection-only board with the Campus-to-Canton trade grader', async () => {
    const campus = { ...league, platform: 'fantrax', leagueType: 'c2c' }
    const refused = { ok: false as const, reason: 'Campus-to-Canton trade grade unavailable' }
    build.mockImplementation(async ({ projectionOnly }) => projectionOnly ? { ok: true, ctx: ctx() } : refused)
    const d = { store: s.store as never, build: build as never, env: {} }
    const inputs = { sport: 'NBA' as const, league: campus }
    expect(await loadCachedLeagueBoardBase({ ...inputs, projectionOnly: true }, d)).toMatchObject({ ok: true, servedFrom: 'live' })
    expect(await loadCachedLeagueBoardBase(inputs, d)).toEqual(refused)
    expect(await loadCachedLeagueBoardBase({ ...inputs, projectionOnly: true }, d)).toMatchObject({ ok: true, servedFrom: 'store' })
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('a throw is "could not be loaded", never cached', async () => {
    build.mockRejectedValueOnce(new Error('db'))
    const r = await loadCachedLeagueBoardBase({ sport: 'NBA', league }, { store: s.store as never, build: build as never, env: {} })
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('could not be loaded') })
    expect(s.store.write).not.toHaveBeenCalled()
  })

  it('a board that cannot be encoded is still served — live, and not stored', async () => {
    build.mockResolvedValue({ ok: true, ctx: { ...ctx(), odd: new Set(['x']) } })
    const r = await loadCachedLeagueBoardBase({ sport: 'NBA', league }, { store: s.store as never, build: build as never, env: {} })
    expect(r).toMatchObject({ ok: true, servedFrom: 'live' })
    expect(s.store.write).not.toHaveBeenCalled()
  })

  it('concurrent readers share one read, each with its own copy', async () => {
    const d = { store: s.store as never, build: build as never, env: {} }
    const [a, b] = await Promise.all([
      loadCachedLeagueBoardBase({ sport: 'NBA', league }, d),
      loadCachedLeagueBoardBase({ sport: 'NBA', league }, d),
    ])
    expect(build).toHaveBeenCalledTimes(1)
    expect(a.ok && b.ok && a.ctx).not.toBe(b.ok && b.ctx)
    expect(a.ok && a.ctx).toEqual(b.ok && b.ctx)
  })

  it(`the off switch (${VALUE_BOARD_CACHE_ENV}=off) builds live and touches no store`, async () => {
    const d = { store: s.store as never, build: build as never, env: { [VALUE_BOARD_CACHE_ENV]: 'off' } }
    await loadCachedLeagueBoardBase({ sport: 'NBA', league }, d)
    await loadCachedLeagueBoardBase({ sport: 'NBA', league }, d)
    expect(build).toHaveBeenCalledTimes(2)
    expect(s.store.read).not.toHaveBeenCalled()
    expect(s.store.write).not.toHaveBeenCalled()
  })
})

describe('🛑 keyed on what the builder reads, not the league id alone', () => {
  it('a different league row is a different board — never one overwriting the other', async () => {
    const s = jsonStore()
    const build = vi.fn(async () => ({ ok: true as const, ctx: ctx() }))
    const d = { store: s.store as never, build: build as never, env: {} }
    await loadCachedLeagueBoardBase({ sport: 'NBA', league }, d)
    // The trade grader's normalized league type, and the roster grade's row with no platform.
    await loadCachedLeagueBoardBase({ sport: 'NBA', league: { ...league, leagueType: 'dynasty' } }, d)
    await loadCachedLeagueBoardBase({ sport: 'NBA', league: { ...league, platform: undefined } }, d)
    expect(build).toHaveBeenCalledTimes(3)
    expect(s.rows.size).toBe(3)
    // …and the identical row is served from the store.
    await loadCachedLeagueBoardBase({ sport: 'NBA', league: { ...league } }, d)
    expect(build).toHaveBeenCalledTimes(3)
  })

  it('the same settings in another key order fingerprint alike', () => {
    const a = leagueBoardFingerprint({ ...league, settings: { scoring: { pts: 1, reb: 1.2 }, teams: 12 } })
    const b = leagueBoardFingerprint({ ...league, settings: { teams: 12, scoring: { reb: 1.2, pts: 1 } } })
    const c = leagueBoardFingerprint({ ...league, settings: { teams: 12, scoring: { reb: 1.5, pts: 1 } } })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('every reader goes through the cache; only an explicit clock builds for itself', async () => {
    const { readFileSync } = await import('node:fs')
    const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')
    expect(read('lib/core-app/rosterGrade.ts')).toMatch(/loadCachedLeagueBoardBase\(\{ sport: 'NBA', league \}\)/)
    const g = read('lib/decision-os/trade/guillotineContext.ts')
    expect(g).toMatch(/\? await loadSportPointsBase\(\{ sport, league: boardLeague, now \}\)\s*: await loadCachedLeagueBoardBase\(\{ sport, league: boardLeague \}\)/)
  })
})

describe('🛑 one board for the trade grade and the value surfaces', () => {
  it('the in-league grader reads the cached league board, not a second build', async () => {
    const loadBase = vi.fn(async () => ({ ok: false as const, reason: 'second build' }))
    const loadLeagueBase = vi.fn(async () => ({ ok: false as const, reason: 'from the league board' }))
    const grader = createSportPointsGrader({ sport: 'NBA', league }, { loadBase, loadLeagueBase })
    const r = await grader!.grade([], [])
    expect(loadLeagueBase).toHaveBeenCalledWith({ sport: 'NBA', league })
    expect(loadBase).not.toHaveBeenCalled()
    expect(r).toMatchObject({ graded: false, reason: 'from the league board' })
  })

  it('the open analyzer (no league, a chosen format) still builds its own board', async () => {
    const loadBase = vi.fn(async () => ({ ok: false as const, reason: 'open analyzer' }))
    const loadLeagueBase = vi.fn()
    const grader = createSportPointsGrader({ sport: 'NBA', league: null, format: 'points' as never }, { loadBase, loadLeagueBase })
    await grader!.grade([], [])
    expect(loadBase).toHaveBeenCalledWith({ sport: 'NBA', league: null, format: 'points' })
    expect(loadLeagueBase).not.toHaveBeenCalled()
  })

  it('the value board loader reads through the cache by default', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(`${process.cwd()}/lib/sport-values/leagueValueBoard.ts`, 'utf8')
    expect(src).toMatch(/base: \(sport, league, options\) => loadCachedLeagueBoardBase\(\{ sport, league, \.\.\.options \}\)/)
    const grader = readFileSync(`${process.cwd()}/lib/decision-os/trade/sportPointsGrader.ts`, 'utf8')
    expect(grader).toMatch(/loadLeagueBase: \(a\) => loadCachedLeagueBoardBase\(a\)/)
  })
})
