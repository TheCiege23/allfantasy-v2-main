// @vitest-environment node
/**
 * `lib/chimmy-advice/adviceStore` — the one reader/writer of `chimmy_advice` (retention item 6,
 * 2026-09-14). The migration is parked, so a missing table is "unavailable", never "no advice";
 * only what was said is stored; asking twice records once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const $queryRaw = vi.fn()
const $executeRaw = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => $queryRaw(...a),
    $executeRaw: (...a: unknown[]) => $executeRaw(...a),
  },
}))

import { MAX_ADVICE_READ, listAdviceForUser, listAdviceUsers, recordAdvice, withdrawStaleMyTeamAdvice, type AdviceInput } from '@/lib/chimmy-advice/adviceStore'

const MISSING_TABLE = Object.assign(new Error('relation "chimmy_advice" does not exist'), {
  code: 'P2010',
  meta: { code: '42P01' },
})

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?')
const valuesOf = (call: unknown[]) => call.slice(1)

const ADVICE: AdviceInput = {
  userId: 'u1',
  leagueId: 'af-ice',
  sport: 'nfl',
  season: 2026,
  week: 5,
  adviceType: 'start_sit',
  surface: 'start_vs_comparison',
  rec: { key: '9221', name: ' Jahmyr Gibbs ' },
  alt: { key: '9226', name: 'Sam LaPorta' },
  slot: 'FLEX',
  confidencePct: 64.4,
}

beforeEach(() => {
  $queryRaw.mockReset()
  $executeRaw.mockReset()
})

describe('recordAdvice', () => {
  it('🛑 upserts on (user, league, season, week, type, rec, alt) — asking twice records once', async () => {
    $executeRaw.mockResolvedValue(1)
    expect(await recordAdvice(ADVICE)).toBe('recorded')
    const call = $executeRaw.mock.calls[0]
    expect(sqlOf(call)).toContain(
      'ON CONFLICT ("user_id", "league_id", "season", "week", "advice_type", "rec_player_key", "alt_player_key") DO UPDATE',
    )
    const v = valuesOf(call)
    expect(v.slice(1)).toEqual(['u1', 'af-ice', 'NFL', 2026, 5, 'start_sit', 'start_vs_comparison', '9221', 'Jahmyr Gibbs', '9226', 'Sam LaPorta', 'FLEX', 64])
  })

  it('🛑 only what was said: no outcome column is ever written', async () => {
    $executeRaw.mockResolvedValue(1)
    await recordAdvice(ADVICE)
    expect(sqlOf($executeRaw.mock.calls[0])).not.toMatch(/points|followed|outcome|result/i)
  })

  it('an add has no alternative and stores "" so the unique index still dedupes it', async () => {
    $executeRaw.mockResolvedValue(1)
    expect(await recordAdvice({ ...ADVICE, adviceType: 'add', surface: 'chimmy_chat_waiver', alt: null, slot: null, confidencePct: null })).toBe('recorded')
    const v = valuesOf($executeRaw.mock.calls[0])
    expect(v.slice(10)).toEqual(['', null, null, null])
  })

  it('confidence is clamped to 0..100 and rounded', async () => {
    $executeRaw.mockResolvedValue(1)
    await recordAdvice({ ...ADVICE, confidencePct: 140 })
    await recordAdvice({ ...ADVICE, confidencePct: -3 })
    expect(valuesOf($executeRaw.mock.calls[0]).at(-1)).toBe(100)
    expect(valuesOf($executeRaw.mock.calls[1]).at(-1)).toBe(0)
  })

  it('🛑 refuses advice it could never resolve, without touching the database', async () => {
    const bad: AdviceInput[] = [
      { ...ADVICE, userId: '' },
      { ...ADVICE, leagueId: '' },
      { ...ADVICE, rec: { key: ' ', name: 'x' } },
      { ...ADVICE, rec: { key: '9221', name: ' ' } },
      { ...ADVICE, alt: null },
      { ...ADVICE, alt: { key: '9221', name: 'Jahmyr Gibbs' } },
      { ...ADVICE, week: 0 },
      { ...ADVICE, week: 26 },
      { ...ADVICE, week: 5.5 },
      { ...ADVICE, season: 1999 },
      { ...ADVICE, adviceType: 'trade' as never },
      { ...ADVICE, surface: 'somewhere' as never },
    ]
    for (const b of bad) expect(await recordAdvice(b)).toBe('invalid')
    expect($executeRaw).not.toHaveBeenCalled()
  })

  it('🛑 a missing table is unavailable; any other error propagates', async () => {
    $executeRaw.mockRejectedValue(MISSING_TABLE)
    expect(await recordAdvice(ADVICE)).toBe('unavailable')
    $executeRaw.mockRejectedValue(Object.assign(new Error('connection reset'), { code: 'P1017' }))
    await expect(recordAdvice(ADVICE)).rejects.toThrow('connection reset')
  })
})

describe('listAdviceForUser', () => {
  const since = new Date('2026-09-01T00:00:00Z')
  const row = {
    league_id: 'af-ice',
    sport: 'NFL',
    season: 2026,
    week: 5,
    advice_type: 'start_sit',
    surface: 'start_vs_comparison',
    rec_player_key: '9221',
    rec_name: 'Jahmyr Gibbs',
    alt_player_key: '9226',
    alt_name: 'Sam LaPorta',
    slot: 'FLEX',
    confidence_pct: 64,
    given_at: new Date('2026-10-03T12:00:00Z'),
  }

  it('reads YOUR advice in the given leagues since a date, newest first, mapped', async () => {
    $queryRaw.mockResolvedValue([row, { ...row, advice_type: 'add', alt_player_key: '', alt_name: null, rec_player_key: '1' }])
    const out = await listAdviceForUser({ userId: 'u1', leagueIds: ['af-ice'], since })
    expect(out).toEqual([
      {
        leagueId: 'af-ice',
        sport: 'NFL',
        season: 2026,
        week: 5,
        adviceType: 'start_sit',
        surface: 'start_vs_comparison',
        rec: { key: '9221', name: 'Jahmyr Gibbs' },
        alt: { key: '9226', name: 'Sam LaPorta' },
        slot: 'FLEX',
        confidencePct: 64,
        givenAt: row.given_at,
      },
      expect.objectContaining({ adviceType: 'add', alt: null }),
    ])
    const call = $queryRaw.mock.calls[0]
    expect(sqlOf(call)).toMatch(/ORDER BY "given_at" DESC/)
    expect(valuesOf(call)).toEqual(['u1', ['af-ice'], since, ['my_team_bench', 'waiver_panel', 'waiver_engine'], MAX_ADVICE_READ])
  })

  it('rows of an unknown type or surface are dropped, not guessed', async () => {
    $queryRaw.mockResolvedValue([row, { ...row, advice_type: 'trade' }, { ...row, surface: 'elsewhere' }])
    expect(await listAdviceForUser({ userId: 'u1', leagueIds: ['af-ice'], since })).toHaveLength(1)
  })

  it('the limit is bounded', async () => {
    $queryRaw.mockResolvedValue([])
    await listAdviceForUser({ userId: 'u1', leagueIds: ['af-ice'], since, limit: 10_000 })
    await listAdviceForUser({ userId: 'u1', leagueIds: ['af-ice'], since, limit: 0 })
    expect(valuesOf($queryRaw.mock.calls[0]).at(-1)).toBe(MAX_ADVICE_READ)
    expect(valuesOf($queryRaw.mock.calls[1]).at(-1)).toBe(1)
  })

  it('no user or no leagues reads nothing', async () => {
    expect(await listAdviceForUser({ userId: '', leagueIds: ['af-ice'], since })).toEqual([])
    expect(await listAdviceForUser({ userId: 'u1', leagueIds: [], since })).toEqual([])
    expect($queryRaw).not.toHaveBeenCalled()
  })

  it('🛑 a missing table is UNAVAILABLE (null), not "no advice"; other errors propagate', async () => {
    $queryRaw.mockRejectedValue(MISSING_TABLE)
    expect(await listAdviceForUser({ userId: 'u1', leagueIds: ['af-ice'], since })).toBeNull()
    $queryRaw.mockRejectedValue(Object.assign(new Error('connection reset'), { code: 'P1017' }))
    await expect(listAdviceForUser({ userId: 'u1', leagueIds: ['af-ice'], since })).rejects.toThrow('connection reset')
  })
})

/*
 * The advice ledger, start/sit (2026-11-14): My Team's bench check is recorded beside Chimmy's advice,
 * with each player's projection — and must never take over, or crowd out, Chimmy's own rows.
 */
describe('advice ledger: projections and My Team calls', () => {
  const MY_TEAM: AdviceInput = {
    ...ADVICE,
    surface: 'my_team_bench',
    slot: 'WR',
    confidencePct: null,
    projected: { rec: 14.236, alt: 9.1 },
  }
  const UNDEFINED_COLUMN = Object.assign(new Error('column "rec_projected" does not exist'), { code: 'P2010', meta: { code: '42703' } })

  it('🛑 a My Team call updates only its OWN row — never relabels a Chimmy call on the same pair', async () => {
    $executeRaw.mockResolvedValue(1)
    expect(await recordAdvice(MY_TEAM)).toBe('recorded')
    const sql = sqlOf($executeRaw.mock.calls[0])
    expect(sql).toContain('"rec_projected", "alt_projected"')
    // It relabels a row only when the row is its own or the weekly engine run's unshown one — never Chimmy's.
    expect(sql).toMatch(/WHERE "chimmy_advice"\."surface" = \? OR "chimmy_advice"\."surface" = \?\s*$/)
    const v = valuesOf($executeRaw.mock.calls[0])
    expect(v.slice(-2)).toEqual(['my_team_bench', 'waiver_engine'])
    expect(v).toContain('my_team_bench')
    expect(v).toContain(14.24)
    expect(v).toContain(9.1)
  })

  it('a Chimmy call with projections stores them and still takes the row as its own', async () => {
    $executeRaw.mockResolvedValue(1)
    await recordAdvice({ ...ADVICE, projected: { rec: 12, alt: 10 } })
    const sql = sqlOf($executeRaw.mock.calls[0])
    expect(sql).toContain('"surface"        = EXCLUDED."surface"')
    expect(sql).toContain('"rec_projected"  = EXCLUDED."rec_projected"')
  })

  it('before the ledger migration, a Chimmy call falls back to the original insert, unchanged', async () => {
    $executeRaw.mockRejectedValueOnce(UNDEFINED_COLUMN).mockResolvedValueOnce(1)
    expect(await recordAdvice({ ...ADVICE, projected: { rec: 12, alt: 10 } })).toBe('recorded')
    const legacy = $executeRaw.mock.calls[1]
    expect(sqlOf(legacy)).not.toContain('rec_projected')
    expect(valuesOf(legacy).slice(1)).toEqual(['u1', 'af-ice', 'NFL', 2026, 5, 'start_sit', 'start_vs_comparison', '9221', 'Jahmyr Gibbs', '9226', 'Sam LaPorta', 'FLEX', 64])
  })

  it('🛑 before the migration, a My Team call inserts once and NEVER touches an existing row', async () => {
    $executeRaw.mockRejectedValueOnce(UNDEFINED_COLUMN).mockResolvedValueOnce(1)
    expect(await recordAdvice(MY_TEAM)).toBe('recorded')
    const fallback = sqlOf($executeRaw.mock.calls[1])
    expect(fallback).toContain('DO NOTHING')
    expect(fallback).not.toContain('DO UPDATE')
  })

  it('a call without projections takes exactly the original path (one statement)', async () => {
    $executeRaw.mockResolvedValue(1)
    await recordAdvice(ADVICE)
    expect($executeRaw).toHaveBeenCalledOnce()
    expect(sqlOf($executeRaw.mock.calls[0])).not.toContain('rec_projected')
  })

  it('🛑 every existing read skips the ledger-only surfaces, so they cannot crowd Chimmy out of the 200-row window', async () => {
    $queryRaw.mockResolvedValue([])
    await listAdviceForUser({ userId: 'u1', leagueIds: ['af-ice'], since: new Date(0) })
    await listAdviceUsers({ since: new Date(0), limit: 5 })
    for (const call of $queryRaw.mock.calls) {
      expect(sqlOf(call)).toContain('NOT ("surface" = ANY(?::text[]))')
      expect(valuesOf(call)).toContainEqual(['my_team_bench', 'waiver_panel', 'waiver_engine'])
    }
  })

  it('🛑 a waiver-panel add, like My Team, updates only its own row', async () => {
    $executeRaw.mockResolvedValue(1)
    await recordAdvice({ ...ADVICE, adviceType: 'add', surface: 'waiver_panel', alt: { key: '4034', name: 'Drop Guy' }, slot: null })
    const call = $executeRaw.mock.calls[0]
    expect(sqlOf(call)).toMatch(/WHERE "chimmy_advice"\."surface" = \? OR "chimmy_advice"\."surface" = \?/)
    expect(valuesOf(call).slice(-2)).toEqual(['waiver_panel', 'waiver_engine'])
  })

  it('🛑 a pick somebody was SHOWN takes over the weekly engine run’s unshown row; the engine only ever updates its own', async () => {
    $executeRaw.mockResolvedValue(1)
    await recordAdvice({ ...ADVICE, adviceType: 'add', surface: 'waiver_panel', alt: null, slot: null })
    const shown = $executeRaw.mock.calls[0]
    // The takeover relabels the row as the surface that showed it.
    expect(sqlOf(shown)).toMatch(/"surface"\s+= EXCLUDED\."surface"/)
    expect(valuesOf(shown).slice(-2)).toEqual(['waiver_panel', 'waiver_engine'])

    $executeRaw.mockClear()
    await recordAdvice({ ...ADVICE, adviceType: 'add', surface: 'waiver_engine', alt: null, slot: null, confidencePct: 84 })
    const engine = $executeRaw.mock.calls[0]
    // Both sides of its OR are its own surface: it can never take a shown row.
    expect(valuesOf(engine).slice(-2)).toEqual(['waiver_engine', 'waiver_engine'])
    expect(valuesOf(engine)).toContain(84)
  })

  it('withdraws only My Team calls this render no longer makes, and only for players not yet kicked off', async () => {
    $executeRaw.mockResolvedValue(2)
    const n = await withdrawStaleMyTeamAdvice({
      userId: 'u1', leagueId: 'af-ice', season: 2026, week: 5,
      keep: [{ rec: '9221', alt: '9226' }],
      openPlayerKeys: ['9221', '9226', '4034'],
    })
    expect(n).toBe(2)
    const call = $executeRaw.mock.calls[0]
    const sql = sqlOf(call)
    expect(sql).toContain('SET "withdrawn_at" = CURRENT_TIMESTAMP')
    expect(sql).toContain('"withdrawn_at" IS NULL')
    expect(sql).toContain('"rec_player_key" = ANY(')
    expect(sql).toContain('"alt_player_key" = ANY(')
    expect(valuesOf(call)).toContainEqual(['9221>9226'])
    expect(valuesOf(call)).toContain('my_team_bench')
  })

  it('withdraws nothing — and asks nothing — when no player is still to play', async () => {
    expect(await withdrawStaleMyTeamAdvice({ userId: 'u1', leagueId: 'af-ice', season: 2026, week: 5, keep: [], openPlayerKeys: [] })).toBe(0)
    expect($executeRaw).not.toHaveBeenCalled()
  })

  it('a missing ledger column on withdraw is "unavailable", not an error', async () => {
    $executeRaw.mockRejectedValue(UNDEFINED_COLUMN)
    expect(await withdrawStaleMyTeamAdvice({ userId: 'u1', leagueId: 'af-ice', season: 2026, week: 5, keep: [], openPlayerKeys: ['1'] })).toBe('unavailable')
  })
})
