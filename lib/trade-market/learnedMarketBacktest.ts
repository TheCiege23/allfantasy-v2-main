import { computeNeedMarket, type NeedObservation } from './needMarketLearner'
import { computePickMarket, priorPickValue, type PickClassKey, type PickObservation } from './pickMarketLearner'
import { computePostureMarket, type PostureObservation } from './postureMarketLearner'

/**
 * DO THE LEARNED NUMBERS HOLD UP ON TRADES THEY NEVER SAW? (owner's call, 2026-11-22.)
 *
 * The three learners (picks, contend/rebuild, need) are fit on every completed trade, so their own numbers describe
 * those trades by construction — an in-sample check proves nothing. This splits the trades by DATE: fit on everything
 * before the cutoff, then ask, for every trade after it, which grade predicts what that trade actually cost:
 *
 *   PLAIN    the grade as it is with the switch off (picks on the standard curve; no posture or need premium —
 *            the chart says a fair trade is 1 : 1).
 *   LEARNED  the grade with the switch on, using ONLY what was published from the earlier trades — exactly the
 *            rule the grades follow (`learnedInGrades.ts`): an unpublished row changes nothing.
 *
 * Error per trade, smaller is better:
 *   picks           |what the picks had to make up − what the grade says they are worth| ÷ the trade's size
 *   posture / need  |log(what the buyer actually paid ÷ chart) − log(what the grade expects them to pay)|
 *
 * ⚠ WHAT THIS DOES NOT ANSWER. "Does the price match" is not "did the trade work out". A contender who pays up for a
 *   veteran is meant to lose dynasty value and win games; value-later is the wrong outcome for that, and wins need
 *   weekly results this does not read. This is the check that the numbers are REAL — that they predict the market
 *   out of time — which is what a grade printing "teams like you paid +8%" is claiming.
 */

export type DatedObservation<O> = { obs: O; tradeDate: Date }

export type ErrorSummary = {
  trades: number
  /** Median per-trade error. */
  medianError: number | null
  meanError: number | null
}

export type RowResult = {
  row: string
  /** The number published from the earlier trades; null when nothing was published (learned = plain there). */
  trainPct: number | null
  trainTrades: number
  /** The same number measured on the later trades alone (null when there are too few to measure). */
  testPct: number | null
  testTrades: number
  plain: ErrorSummary
  learned: ErrorSummary
  /** Did the later trades lean the same way the published number said? Null when either side has no number. */
  sameDirection: boolean | null
}

export type LearnerBacktest = {
  learner: 'picks' | 'posture' | 'need'
  book: string
  cutoff: string
  trainTrades: number
  testTrades: number
  overall: { plain: ErrorSummary; learned: ErrorSummary; improvementPct: number | null }
  rows: RowResult[]
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

export function summarizeErrors(errors: readonly number[]): ErrorSummary {
  const e = errors.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b)
  if (e.length === 0) return { trades: 0, medianError: null, meanError: null }
  const mid = e.length % 2 ? e[(e.length - 1) / 2]! : (e[e.length / 2 - 1]! + e[e.length / 2]!) / 2
  return { trades: e.length, medianError: r3(mid), meanError: r3(e.reduce((s, x) => s + x, 0) / e.length) }
}

/** How much smaller the learned mean error is than the plain one, in percent (positive = learned is better). */
export function improvementPct(plain: ErrorSummary, learned: ErrorSummary): number | null {
  if (plain.meanError == null || learned.meanError == null || !(plain.meanError > 0)) return null
  return Math.round(((plain.meanError - learned.meanError) / plain.meanError) * 1000) / 10
}

/** Split by trade date: strictly before the cutoff trains, on or after it tests. PURE. */
export function splitAt<O>(all: ReadonlyArray<DatedObservation<O>>, cutoff: Date): { train: O[]; test: O[] } {
  const train: O[] = []
  const test: O[] = []
  for (const d of all) (d.tradeDate.getTime() < cutoff.getTime() ? train : test).push(d.obs)
  return { train, test }
}

/** The date by which `share` of the trades had happened — the default cutoff (the newest quarter tests). PURE. */
export function cutoffAtShare(dates: readonly Date[], share = 0.75): Date | null {
  const s = dates.map((d) => d.getTime()).filter(Number.isFinite).sort((a, b) => a - b)
  if (s.length < 2) return null
  return new Date(s[Math.min(s.length - 1, Math.max(1, Math.floor(s.length * share)))]!)
}

const sameDir = (a: number | null, b: number | null) => (a == null || b == null || a === 0 || b === 0 ? null : Math.sign(a) === Math.sign(b))

// ─── Picks ───────────────────────────────────────────────────────────────────────────────────────

export function backtestPicks(book: string, all: ReadonlyArray<DatedObservation<PickObservation>>, cutoff: Date): LearnerBacktest {
  const { train, test } = splitAt(all, cutoff)
  const fit = computePickMarket(train, cutoff)
  const used = new Map(fit.classes.filter((c) => c.published).map((c) => [c.key, c.learned]))
  const later = computePickMarket(test, cutoff)
  const valueOf = (k: PickClassKey, learned: boolean) => (learned ? used.get(k) ?? priorPickValue(k) : priorPickValue(k))
  const errorOf = (o: PickObservation, learned: boolean) => {
    const pred = (Object.entries(o.net) as Array<[PickClassKey, number]>).reduce((s, [k, n]) => s + n * valueOf(k, learned), 0)
    return Math.abs(o.y - pred) / o.size
  }
  const rows: RowResult[] = fit.classes.map((c) => {
    const touching = test.filter((o) => (o.net[c.key] ?? 0) !== 0)
    const testRow = later.classes.find((x) => x.key === c.key)
    const trainPct = c.published && c.prior > 0 ? Math.round((c.learned / c.prior - 1) * 1000) / 10 : null
    const testPct = testRow?.published && testRow.prior > 0 ? Math.round((testRow.learned / testRow.prior - 1) * 1000) / 10 : null
    return {
      row: c.key,
      trainPct,
      trainTrades: c.trades,
      testPct,
      testTrades: touching.length,
      plain: summarizeErrors(touching.map((o) => errorOf(o, false))),
      learned: summarizeErrors(touching.map((o) => errorOf(o, true))),
      sameDirection: sameDir(trainPct, testPct),
    }
  })
  const plain = summarizeErrors(test.map((o) => errorOf(o, false)))
  const learned = summarizeErrors(test.map((o) => errorOf(o, true)))
  return { learner: 'picks', book, cutoff: cutoff.toISOString(), trainTrades: train.length, testTrades: test.length, overall: { plain, learned, improvementPct: improvementPct(plain, learned) }, rows }
}

// ─── Posture and need: a premium over the chart ──────────────────────────────────────────────────

function premiumBacktest<O extends { ratio: number }>(args: {
  learner: 'posture' | 'need'
  book: string
  cutoff: Date
  train: O[]
  test: O[]
  /** The rows the grades apply, each with the premium published from the earlier trades and measured on the later ones. */
  rows: Array<{ row: string; matches: (o: O) => boolean; trainPct: number | null; trainTrades: number; testPct: number | null }>
}): LearnerBacktest {
  const usable = (o: O) => Number.isFinite(o.ratio) && o.ratio > 0
  const premiumFor = (o: O) => args.rows.find((r) => r.matches(o))?.trainPct ?? null
  const err = (o: O, pct: number | null) => Math.abs(Math.log(o.ratio) - Math.log(1 + (pct ?? 0) / 100))
  const test = args.test.filter(usable)
  const rows: RowResult[] = args.rows.map((r) => {
    const t = test.filter(r.matches)
    return {
      row: r.row,
      trainPct: r.trainPct,
      trainTrades: r.trainTrades,
      testPct: r.testPct,
      testTrades: t.length,
      plain: summarizeErrors(t.map((o) => err(o, null))),
      learned: summarizeErrors(t.map((o) => err(o, r.trainPct))),
      sameDirection: sameDir(r.trainPct, r.testPct),
    }
  })
  // Overall: only the trades a learned row could move — the rest are graded identically either way.
  const moved = test.filter((o) => args.rows.some((r) => r.matches(o)))
  const plain = summarizeErrors(moved.map((o) => err(o, null)))
  const learned = summarizeErrors(moved.map((o) => err(o, premiumFor(o))))
  return {
    learner: args.learner, book: args.book, cutoff: args.cutoff.toISOString(), trainTrades: args.train.length, testTrades: test.length,
    overall: { plain, learned, improvementPct: improvementPct(plain, learned) }, rows,
  }
}

export function backtestPosture(book: string, all: ReadonlyArray<DatedObservation<PostureObservation>>, cutoff: Date): LearnerBacktest {
  const { train, test } = splitAt(all, cutoff)
  const fit = computePostureMarket(train, cutoff)
  const later = computePostureMarket(test, cutoff)
  return premiumBacktest({
    learner: 'posture', book, cutoff, train, test,
    rows: fit.premiums.map((p) => ({
      row: `${p.buyer}:${p.bought}`,
      matches: (o: PostureObservation) => o.buyer === p.buyer && o.bought === p.bought,
      trainPct: p.published ? p.premiumPct : null,
      trainTrades: p.trades,
      testPct: later.premiums.find((x) => x.buyer === p.buyer && x.bought === p.bought && x.published)?.premiumPct ?? null,
    })),
  })
}

/** Need: only the "short" level is applied by the grades, so only it is tested. */
export function backtestNeed(book: string, all: ReadonlyArray<DatedObservation<NeedObservation>>, cutoff: Date): LearnerBacktest {
  const { train, test } = splitAt(all, cutoff)
  const fit = computeNeedMarket(train, cutoff)
  const later = computeNeedMarket(test, cutoff)
  return premiumBacktest({
    learner: 'need', book, cutoff, train, test,
    rows: fit.premiums
      .filter((p) => p.need === 'short')
      .map((p) => ({
        row: `${p.position}:short`,
        matches: (o: NeedObservation) => o.position === p.position && o.need === 'short',
        trainPct: p.published ? p.premiumPct : null,
        trainTrades: p.trades,
        testPct: later.premiums.find((x) => x.position === p.position && x.need === 'short' && x.published)?.premiumPct ?? null,
      })),
  })
}

/** One plain-English line per learner and book. PURE. */
export function describeBacktest(b: LearnerBacktest): string {
  const { plain, learned, improvementPct: imp } = b.overall
  const published = b.rows.filter((r) => r.trainPct != null)
  const held = published.filter((r) => r.sameDirection === true).length
  const flipped = published.filter((r) => r.sameDirection === false).length
  const verdict =
    imp == null ? 'not enough later trades to tell'
      : imp > 0 ? `learned grade ${imp}% closer to what later trades cost`
        : imp < 0 ? `learned grade ${-imp}% FURTHER from what later trades cost — do not trust it yet`
          : 'no difference'
  return `${b.learner} · ${b.book}: trained on ${b.trainTrades} trades before ${b.cutoff.slice(0, 10)}, tested on ${b.testTrades} after — ${verdict} (mean error ${plain.meanError ?? '—'} → ${learned.meanError ?? '—'}); ${published.length} published row(s), ${held} held direction, ${flipped} flipped.`
}
