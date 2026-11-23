// @vitest-environment node
/**
 * `chimmy_advice.advice_day` (2026-11-23): daily-lineup bench calls are recorded per DAY — but only once
 * `20261123120000_chimmy_advice_day` is applied, which production does by hand AFTER the code deploys. These pin both
 * sides of that line: before the column exists the store runs today's statements and records no dated call; after, every
 * upsert targets the new key (the old index is gone, and its ON CONFLICT would fail with 42P10).
 */
import { readFileSync } from 'node:fs'
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

import {
  ADVICE_DAY_CONFLICT_TARGET,
  ADVICE_DAY_RECHECK_MS,
  hasAdviceDayColumn,
  recordAdvice,
  resetAdviceDayColumnCache,
  withdrawStaleMyTeamAdvice,
  type AdviceInput,
} from '@/lib/chimmy-advice/adviceStore'

/** The SQL text of a call, whether it was a tagged template or a composed `Prisma.sql` object. */
function sqlOf(call: unknown[]): string {
  const first = call[0] as { sql?: string } | TemplateStringsArray
  return 'sql' in first && typeof first.sql === 'string' ? first.sql : (first as TemplateStringsArray).join('?')
}
function valuesOf(call: unknown[]): unknown[] {
  const first = call[0] as { values?: unknown[]; sql?: string }
  return typeof first.sql === 'string' ? first.values ?? [] : call.slice(1)
}

const OLD_TARGET = 'ON CONFLICT ("user_id", "league_id", "season", "week", "advice_type", "rec_player_key", "alt_player_key")'
const NEW_TARGET = `ON CONFLICT ${ADVICE_DAY_CONFLICT_TARGET}`

const BENCH: AdviceInput = {
  userId: 'u1',
  leagueId: 'nba-daily',
  sport: 'NBA',
  season: 2026,
  week: 4,
  adviceType: 'start_sit',
  surface: 'my_team_bench',
  rec: { key: '100', name: 'Bench Guy' },
  alt: { key: '200', name: 'Starter Guy' },
  slot: 'G',
  confidencePct: null,
  projected: { rec: 41.5, alt: 36.2 },
}
const CHIMMY: AdviceInput = { ...BENCH, sport: 'NFL', week: 10, surface: 'start_vs_comparison', projected: null, confidencePct: 61 }
const ADD: AdviceInput = { ...CHIMMY, adviceType: 'add', surface: 'chimmy_chat_waiver', alt: null, slot: null }

const column = (present: boolean) => $queryRaw.mockResolvedValue([{ present }])
const PG_42P10 = Object.assign(new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification'), {
  code: 'P2010',
  meta: { code: '42P10' },
})

beforeEach(() => {
  $queryRaw.mockReset()
  $executeRaw.mockReset()
  $executeRaw.mockResolvedValue(1)
  resetAdviceDayColumnCache()
})

describe('🛑 before the day migration — today\'s behaviour exactly', () => {
  it('a weekly call of every shape runs the original statements: the old key, and no advice_day anywhere', async () => {
    column(false)
    for (const input of [BENCH, CHIMMY, ADD, { ...CHIMMY, projected: { rec: 10, alt: 8 } }]) {
      expect(await recordAdvice(input)).toBe('recorded')
    }
    expect($executeRaw).toHaveBeenCalledTimes(4)
    for (const call of $executeRaw.mock.calls) {
      // A tagged template, as before — not a composed statement.
      expect(Array.isArray(call[0])).toBe(true)
      expect(sqlOf(call)).toContain(OLD_TARGET)
      expect(sqlOf(call)).not.toContain('advice_day')
    }
  })

  it('a dated (daily-lineup) call writes NOTHING and says unavailable — never filed under its week', async () => {
    column(false)
    expect(await recordAdvice({ ...BENCH, day: '2026-11-20' })).toBe('unavailable')
    expect($executeRaw).not.toHaveBeenCalled()
  })

  it('a weekly withdraw is the original UPDATE; a dated one runs nothing', async () => {
    column(false)
    const args = { userId: 'u1', leagueId: 'nba-daily', season: 2026, week: 4, keep: [], openPlayerKeys: ['100', '200'] }
    await withdrawStaleMyTeamAdvice(args)
    expect(sqlOf($executeRaw.mock.calls[0])).not.toContain('advice_day')
    $executeRaw.mockClear()
    expect(await withdrawStaleMyTeamAdvice({ ...args, day: '2026-11-20' })).toBe('unavailable')
    expect($executeRaw).not.toHaveBeenCalled()
  })

  it('an unreadable column check is "absent" — the original statements, never a guess at the new key', async () => {
    $queryRaw.mockRejectedValue(new Error('db hiccup'))
    expect(await recordAdvice(CHIMMY)).toBe('recorded')
    expect(sqlOf($executeRaw.mock.calls[0])).toContain(OLD_TARGET)
  })

  it('a malformed day is invalid before anything is asked', async () => {
    expect(await recordAdvice({ ...BENCH, day: '2026-02-30' })).toBe('invalid')
    expect(await recordAdvice({ ...BENCH, day: 'Friday' })).toBe('invalid')
    expect($queryRaw).not.toHaveBeenCalled()
    expect($executeRaw).not.toHaveBeenCalled()
  })
})

describe('after the day migration — the new key, and the day written', () => {
  it('a daily call writes its day and upserts on the key that includes it (ledger-only: its own rows only)', async () => {
    column(true)
    expect(await recordAdvice({ ...BENCH, day: '2026-11-20' })).toBe('recorded')
    const call = $executeRaw.mock.calls[0]
    const sql = sqlOf(call)
    expect(sql).toContain('"advice_day"')
    expect(sql).toContain(NEW_TARGET)
    expect(sql).not.toContain(OLD_TARGET)
    expect(sql).toContain('WHERE "chimmy_advice"."surface" = ')
    expect(valuesOf(call)).toContain('2026-11-20')
    expect(valuesOf(call)).toEqual(expect.arrayContaining([41.5, 36.2]))
  })

  it('🛑 every weekly writer moves to the new key too, writing "" for the day', async () => {
    column(true)
    for (const input of [BENCH, CHIMMY, ADD]) expect(await recordAdvice(input)).toBe('recorded')
    for (const call of $executeRaw.mock.calls) {
      expect(sqlOf(call)).toContain(NEW_TARGET)
      expect(valuesOf(call)).toContain('')
    }
    // A plain Chimmy call keeps its original update list: it takes any row, it does not touch projections.
    const chimmy = sqlOf($executeRaw.mock.calls[1])
    expect(chimmy).not.toContain('rec_projected')
    expect(chimmy).not.toMatch(/WHERE "chimmy_advice"/)
  })

  it('🛑 two days of the same week are two rows: same week, different advice_day', async () => {
    column(true)
    await recordAdvice({ ...BENCH, day: '2026-11-20' })
    await recordAdvice({ ...BENCH, day: '2026-11-21' })
    const [a, b] = $executeRaw.mock.calls.map(valuesOf)
    // Identical in every key column but the day (index 0 is the fresh id).
    expect(a.slice(1, 14)).toEqual(b.slice(1, 14))
    expect(a).toContain('2026-11-20')
    expect(b).toContain('2026-11-21')
  })

  it('a dated withdraw touches only that day; a weekly one only weekly rows', async () => {
    column(true)
    const args = { userId: 'u1', leagueId: 'nba-daily', season: 2026, week: 4, keep: [], openPlayerKeys: ['100', '200'] }
    await withdrawStaleMyTeamAdvice({ ...args, day: '2026-11-20' })
    await withdrawStaleMyTeamAdvice(args)
    const [day, week] = $executeRaw.mock.calls
    expect(sqlOf(day)).toContain('"advice_day" = ?')
    expect(valuesOf(day)).toContain('2026-11-20')
    expect(sqlOf(week)).toContain('"advice_day" = ?')
    expect(valuesOf(week)).toContain('')
  })

  it('a process that cached "absent" and then meets the dropped index (42P10) re-checks and retries on the new key', async () => {
    $queryRaw.mockResolvedValueOnce([{ present: false }]).mockResolvedValueOnce([{ present: true }])
    $executeRaw.mockRejectedValueOnce(PG_42P10).mockResolvedValueOnce(1)
    expect(await recordAdvice(CHIMMY)).toBe('recorded')
    expect(sqlOf($executeRaw.mock.calls[0])).toContain(OLD_TARGET)
    expect(sqlOf($executeRaw.mock.calls[1])).toContain(NEW_TARGET)
  })

  it('the column is asked about once while present; "absent" is re-asked after the recheck window', async () => {
    column(true)
    await hasAdviceDayColumn(0)
    await hasAdviceDayColumn(10 * ADVICE_DAY_RECHECK_MS)
    expect($queryRaw).toHaveBeenCalledTimes(1)
    resetAdviceDayColumnCache()
    $queryRaw.mockReset()
    column(false)
    await hasAdviceDayColumn(0)
    await hasAdviceDayColumn(ADVICE_DAY_RECHECK_MS - 1)
    expect($queryRaw).toHaveBeenCalledTimes(1)
    await hasAdviceDayColumn(ADVICE_DAY_RECHECK_MS)
    expect($queryRaw).toHaveBeenCalledTimes(2)
  })
})

describe('🛑 the key itself — migration, model and writer agree, and the day separates two calls the old key merged', () => {
  const cwd = process.cwd()
  const migration = readFileSync(`${cwd}/prisma/migrations/20261123120000_chimmy_advice_day/migration.sql`, 'utf8')
  const colsOf = (sql: string, index: string) => {
    const m = sql.match(new RegExp(`CREATE UNIQUE INDEX "${index}" ON "chimmy_advice"\\(([^)]*)\\)`))
    return m ? m[1].split(',').map((c) => c.trim().replace(/"/g, '')) : null
  }
  const newCols = colsOf(migration, 'chimmy_advice_user_league_week_day_type_rec_alt_key')

  it('the new index is the old key plus advice_day, and the writer\'s ON CONFLICT names exactly its columns', () => {
    expect(newCols).toEqual(['user_id', 'league_id', 'season', 'week', 'advice_day', 'advice_type', 'rec_player_key', 'alt_player_key'])
    const target = ADVICE_DAY_CONFLICT_TARGET.replace(/[()"]/g, '').split(',').map((c) => c.trim())
    expect(new Set(target)).toEqual(new Set(newCols))
  })

  it('two calls one day apart in the same week collide on the old key and not on the new one', () => {
    const row = (day: string) => ({
      user_id: 'u1', league_id: 'L', season: 2026, week: 4, advice_day: day, advice_type: 'start_sit', rec_player_key: '100', alt_player_key: '200',
    })
    const keyOf = (cols: string[], r: Record<string, unknown>) => cols.map((c) => String(r[c])).join('|')
    const OLD = ['user_id', 'league_id', 'season', 'week', 'advice_type', 'rec_player_key', 'alt_player_key']
    expect(keyOf(OLD, row('2026-11-20'))).toBe(keyOf(OLD, row('2026-11-21')))
    expect(keyOf(newCols!, row('2026-11-20'))).not.toBe(keyOf(newCols!, row('2026-11-21')))
  })

  it('migration order: column, then the new index, then the old one dropped; LF only; the model maps the new name', () => {
    const add = migration.indexOf('ADD COLUMN "advice_day" VARCHAR(10) NOT NULL DEFAULT \'\'')
    const create = migration.indexOf('CREATE UNIQUE INDEX "chimmy_advice_user_league_week_day_type_rec_alt_key"')
    const drop = migration.indexOf('DROP INDEX "chimmy_advice_user_league_week_type_rec_alt_key"')
    expect(add).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(add)
    expect(drop).toBeGreaterThan(create)
    expect(migration.includes('\r')).toBe(false)
    const schema = readFileSync(`${cwd}/prisma/schema.prisma`, 'utf8')
    const model = schema.slice(schema.indexOf('model ChimmyAdvice {'), schema.indexOf('}', schema.indexOf('model ChimmyAdvice {')))
    expect(model).toMatch(/adviceDay\s+String\s+@default\(""\) @map\("advice_day"\) @db\.VarChar\(10\)/)
    expect(model).toContain(
      '@@unique([userId, leagueId, season, week, adviceDay, adviceType, recPlayerKey, altPlayerKey], map: "chimmy_advice_user_league_week_day_type_rec_alt_key")',
    )
  })
})
