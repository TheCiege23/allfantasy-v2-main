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

import { MAX_ADVICE_READ, listAdviceForUser, recordAdvice, type AdviceInput } from '@/lib/chimmy-advice/adviceStore'

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
    expect(valuesOf(call)).toEqual(['u1', ['af-ice'], since, MAX_ADVICE_READ])
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
