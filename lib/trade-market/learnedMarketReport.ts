import {
  booksOf,
  LEARNED_NEED_ENV,
  LEARNED_PICKS_ENV,
  LEARNED_POSTURE_ENV,
  learnedNeedOn,
  learnedNeedPremium,
  learnedPickAdjustment,
  learnedPicksOn,
  learnedPostureAdjustment,
  learnedPostureOn,
  type LearnedTables,
} from './learnedInGrades'
import { NEED_MARKET_CACHE_KEY, PICK_MARKET_CACHE_KEY, POSTURE_MARKET_CACHE_KEY } from './formatMarkets'
import { nextDraftYear, type PickClassValue } from './pickMarketLearner'
import type { PosturePremium } from './postureMarketLearner'
import type { NeedPremium } from './needMarketLearner'

/**
 * THE LEARNED MARKET, ON ONE SCREEN (owner's call, 2026-11-22: /admin/trade-market).
 *
 * The switches `TRADE_LEARNED_PICKS` / `_NEED` / `_POSTURE` were turned on before anyone could SEE what the learners
 * publish. This reads the three stored tables and shows, per book: what was measured, how many trades it rests on,
 * whether it is published, and the exact line a grade would print — produced by the same functions the grades call
 * (`learnedInGrades.ts`), so this page cannot describe a grade that the grader would not give.
 *
 * Read-only. Nothing here changes a table or a grade.
 */

export const LEARNED_STALE_DAYS = 21

const BOOK_LABELS: Record<string, string> = {
  'DYNASTY:SUPERFLEX': 'Dynasty · Superflex',
  'DYNASTY:ONE_QB': 'Dynasty · 1QB',
  'REDRAFT:SUPERFLEX': 'Redraft · Superflex',
  'REDRAFT:ONE_QB': 'Redraft · 1QB',
}
export const bookLabel = (key: string) => BOOK_LABELS[key] ?? key

const ORDINAL = ['', '1st', '2nd', '3rd', '4th']
const HORIZON = ['Next draft', 'The draft after', 'Two or more out']

export type SwitchState = { env: string; on: boolean; what: string }
export type TableStatus = {
  name: string
  generatedAt: string | null
  ageDays: number | null
  /** Older than the grades will read: published rows are ignored until the daily run writes again. */
  stale: boolean
  missing: boolean
}
export type ReportRow = {
  label: string
  /** The measured move in percent (pick: learned vs curve), or null when nothing could be measured. */
  pct: number | null
  detail: string
  effectiveSample: number
  trades: number
  published: boolean
  note: string
  /** What a grade prints for this row when its switch is on; null when it would print nothing. */
  gradeSays: string | null
}
export type ReportBook = { book: string; label: string; rows: ReportRow[]; warnings: string[]; tradesUsed: number | null }
export type ReportSection = { key: 'picks' | 'posture' | 'need'; title: string; switch: SwitchState; status: TableStatus; books: ReportBook[] }
export type LearnedMarketReport = { generatedAt: string; sections: ReportSection[]; publishedRows: number; totalRows: number }

type StoredDoc = { generatedAt?: unknown; books?: unknown } | null
type RawDocs = { picks: unknown; posture: unknown; need: unknown }

function statusOf(name: string, raw: unknown, now: Date): TableStatus {
  const d = raw && typeof raw === 'object' ? (raw as StoredDoc) : null
  const at = d && typeof d.generatedAt === 'string' ? Date.parse(d.generatedAt) : NaN
  if (!d || !Number.isFinite(at)) return { name, generatedAt: null, ageDays: null, stale: false, missing: true }
  const ageDays = Math.round(((now.getTime() - at) / 86_400_000) * 10) / 10
  return { name, generatedAt: new Date(at).toISOString(), ageDays, stale: ageDays > LEARNED_STALE_DAYS, missing: false }
}

function booksIn<T>(raw: unknown, field: string): Array<{ book: string; rows: T[]; rest: Record<string, unknown> }> {
  const d = raw && typeof raw === 'object' ? (raw as StoredDoc) : null
  if (!d || !Array.isArray(d.books)) return []
  return (d.books as Array<Record<string, unknown>>)
    .filter((b) => typeof b.book === 'string' && Array.isArray(b[field]))
    .map((b) => ({ book: b.book as string, rows: b[field] as T[], rest: b }))
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** The whole report from the three stored documents. PURE. */
export function summarizeLearnedMarket(raw: RawDocs, env: NodeJS.ProcessEnv, now: Date): LearnedMarketReport {
  // Exactly what the grader would read: published rows of a fresh table only.
  const tables: LearnedTables = {
    picks: booksOf(raw.picks, 'classes', now),
    posture: booksOf(raw.posture, 'premiums', now),
    need: booksOf(raw.need, 'premiums', now),
  }
  const draft = nextDraftYear(now)

  const picks: ReportBook[] = booksIn<PickClassValue>(raw.picks, 'classes').map(({ book, rows, rest }) => {
    const warnings: string[] = []
    if (rest.roundsOrdered === false) warnings.push('A later round came out worth more than an earlier one in the same draft — read those rows before trusting them.')
    if (rest.horizonsOrdered === false) warnings.push('A farther draft came out worth more than a nearer one for the same round.')
    return {
      book,
      label: bookLabel(book),
      tradesUsed: typeof rest.tradesUsed === 'number' ? rest.tradesUsed : null,
      warnings,
      rows: rows.map((c) => ({
        label: `${ORDINAL[c.round] ?? `Round ${c.round}`} · ${HORIZON[c.horizon] ?? `+${c.horizon}`}`,
        pct: c.prior > 0 && Number.isFinite(c.learned) ? round1((c.learned / c.prior - 1) * 100) : null,
        detail: `curve ${Math.round(c.prior)} → learned ${Math.round(c.learned)}`,
        effectiveSample: round1(c.effectiveSample),
        trades: c.trades,
        published: c.published,
        note: c.note,
        gradeSays: learnedPickAdjustment(tables, book, `${draft + c.horizon} ${ORDINAL[c.round]}`, 12, now)?.reason ?? null,
      })),
    }
  })

  const posture: ReportBook[] = booksIn<PosturePremium>(raw.posture, 'premiums').map(({ book, rows, rest }) => ({
    book,
    label: bookLabel(book),
    tradesUsed: typeof rest.observations === 'number' ? rest.observations : null,
    warnings: [],
    rows: rows.map((p) => ({
      label: `${p.buyer === 'contend' ? 'Contenders (.600+)' : 'Rebuilders (.400−)'} buying ${p.bought === 'veteran' ? 'veterans (27+)' : p.bought === 'youth' ? 'youth (24−)' : 'picks'}`,
      pct: p.premiumPct,
      detail: `against middle teams (sample ${round1(p.baselineEffectiveSample)})`,
      effectiveSample: round1(p.effectiveSample),
      trades: p.trades,
      published: p.published,
      note: p.note,
      gradeSays: learnedPostureAdjustment(tables, book, p.buyer, p.bought)?.reason ?? null,
    })),
  }))

  const need: ReportBook[] = booksIn<NeedPremium>(raw.need, 'premiums').map(({ book, rows, rest }) => ({
    book,
    label: bookLabel(book),
    tradesUsed: typeof rest.observations === 'number' ? rest.observations : null,
    warnings: [],
    rows: rows.map((p) => {
      // The grades use only "short" today; the other levels are measured and shown, never applied.
      const used = p.need === 'short' ? learnedNeedPremium(tables, book, p.position, 'short') : null
      return {
        label: `${p.position} · ${p.need === 'short' ? 'short (an open slot)' : p.need === 'short_this_week' ? 'short this week (injury or bye)' : 'deep'}`,
        pct: p.premiumPct,
        detail: `against normal-depth teams (sample ${round1(p.baselineEffectiveSample)})`,
        effectiveSample: round1(p.effectiveSample),
        trades: p.trades,
        published: p.published,
        note: p.note,
        gradeSays: used
          ? `teams short at ${p.position} paid ${used.pct > 0 ? '+' : ''}${used.pct}% over normal-depth teams across ${used.trades} completed trades`
          : null,
      }
    }),
  }))

  const sections: ReportSection[] = [
    {
      key: 'picks',
      title: 'Draft pick values',
      switch: { env: LEARNED_PICKS_ENV, on: learnedPicksOn(env), what: 'prices pick lines in the league-value grade' },
      status: statusOf('pick values', raw.picks, now),
      books: picks,
    },
    {
      key: 'posture',
      title: 'Contend vs rebuild premiums',
      switch: { env: LEARNED_POSTURE_ENV, on: learnedPostureOn(env), what: 'moves what the viewer takes on in the "for your team" grade' },
      status: statusOf('posture premiums', raw.posture, now),
      books: posture,
    },
    {
      key: 'need',
      title: 'Position need premiums',
      switch: { env: LEARNED_NEED_ENV, on: learnedNeedOn(env), what: 'replaces the hand-set 6% for an open slot in the "for your team" grade' },
      status: statusOf('need premiums', raw.need, now),
      books: need,
    },
  ]
  const all = sections.flatMap((s) => s.books.flatMap((b) => b.rows))
  return { generatedAt: now.toISOString(), sections, publishedRows: all.filter((r) => r.published).length, totalRows: all.length }
}

type CacheReader = { sportsDataCache: { findUnique: (args: { where: { cacheKey: string } }) => PromiseLike<unknown> } }

/** Reads the three stored tables (no memo — this page should show what is stored now) and summarizes them. */
export async function loadLearnedMarketReport(prisma: CacheReader, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<LearnedMarketReport> {
  const read = async (key: string) => {
    const row = (await prisma.sportsDataCache.findUnique({ where: { cacheKey: key } })) as { data?: unknown } | null
    return row?.data ?? null
  }
  const [picks, posture, need] = await Promise.all([read(PICK_MARKET_CACHE_KEY), read(POSTURE_MARKET_CACHE_KEY), read(NEED_MARKET_CACHE_KEY)])
  return summarizeLearnedMarket({ picks, posture, need }, env, now)
}
