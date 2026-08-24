/**
 * Projection accuracy loop v0 — retro-score stored projections against stored actuals.
 *
 * WHY ONE RULER. `FantasyProjection` rows are stored at a PPR preset while
 * `PlayerGameStat.fantasyPoints` is pre-computed under STANDARD scoring (the ingest resolves
 * the 'standard' template when no league is given — see lib/schedule-stats). Comparing those
 * two columns would manufacture a phantom per-reception "error" on every pass-catcher, so
 * this module never reads `fantasyPoints` at all: BOTH sides are rescored from their stored
 * stat lines under the one canonical NFL PPR template.
 *
 * WHERE RESULTS LIVE. One JSON row per (season, week) in the existing SportsDataCache
 * key-value table — `projection_accuracy:{season}:{week}` — no schema change, same pattern
 * as grok-injury-digest. The row is a measurement record, not a cache of remote truth, so
 * the reader does not treat expiry as absence.
 *
 * HONESTY RULES.
 *  - AF engine rows carry no per-stat component line (the engine emits a scalar), so their
 *    `projectedPoints` — PPR by construction, the mirror refuses any other format — is used
 *    directly, and the method is counted per source rather than blurred.
 *  - IDP-eligible positions are EXCLUDED and counted: the canonical PPR template scores
 *    offense + DST only, so a defender's rescored "actual" would be near zero against an
 *    IDP-scored projection and the aggregate would be an artifact, not a finding.
 *  - AF rows whose basis is Sleeper's forward projection are a pass-through of the very
 *    number they would be compared against; the AF-vs-sleeper head-to-head uses ONLY
 *    independent-basis pairs, and the derived/independent split is reported alongside.
 *  - A week with nothing to score is stored with a labeled status, never silently skipped.
 *
 * NOT wired to any UI. Data collection first — no accuracy claims in user-facing copy.
 */

import { prisma } from '@/lib/prisma'
import { isIdpEligiblePosition } from '@/lib/af-projections/idpScoring'
import { getScoringTemplate } from '@/lib/multi-sport/ScoringTemplateResolver'
import { normalizeStatPayload } from '@/lib/schedule-stats/StatNormalizationService'
import {
  computeFantasyPointsWithBreakdown,
  type ScoringRuleLike,
} from '@/lib/scoring-defaults/FantasyPointCalculator'

export const PROJECTION_ACCURACY_CACHE_PREFIX = 'projection_accuracy:'

/** Measurement records outlive the season so history survives the offseason. */
const ACCURACY_TTL_MS = 400 * 24 * 60 * 60 * 1000

export function projectionAccuracyCacheKey(season: number, week: number): string {
  return `${PROJECTION_ACCURACY_CACHE_PREFIX}${season}:${week}`
}

export interface AccuracyAggregate {
  n: number
  /** Mean absolute error, points. */
  mae: number
  /** Mean signed error (projected − actual); positive = over-projection. */
  bias: number
}

export interface SourceAccuracy {
  overall: AccuracyAggregate | null
  byPosition: Record<string, AccuracyAggregate>
  /** How each row's projected value was obtained — stated, not blurred. */
  methods: { rescoredFromStatLine: number; projectedPointsColumn: number }
  /** Rows with no scoreable actual for the week (bye, DNP, or unscoreable line). */
  withoutActual: number
  /** AF only: error split by the snapshot's basis field. */
  byBasis?: Record<string, AccuracyAggregate>
  /** AF only: pairs whose basis was Sleeper's own forward projection (pass-through). */
  sleeperDerivedPairs?: number
  /** AF only: pairs with a genuinely independent basis. */
  independentPairs?: number
}

export interface ProjectionAccuracyRecord {
  version: 1
  season: number
  week: number
  computedAt: string
  status: 'scored' | 'no_projection_rows' | 'no_scoreable_actuals'
  /** Methodology statement — carried with the numbers so they cannot outrun it. */
  scoring: string
  /** Players whose actual stat line rescored under the canonical PPR template. */
  actualsScored: number
  /** Actual rows whose stat line had no overlap with the PPR template — excluded, counted. */
  actualsUnscoreable: number
  /** Pairs excluded because the position is IDP-eligible (template scores offense+DST only). */
  idpExcludedPairs: number
  sources: Record<string, SourceAccuracy>
  /**
   * AF vs the Sleeper feed over the SAME players, independent AF bases only — a pair whose
   * AF basis is Sleeper's forward projection would be the feed graded against itself.
   */
  afVsSleeper: { n: number; af: AccuracyAggregate; sleeper: AccuracyAggregate; note: string } | null
}

type Sums = { n: number; absSum: number; errSum: number }

function newSums(): Sums {
  return { n: 0, absSum: 0, errSum: 0 }
}
function addErr(s: Sums, err: number): void {
  s.n += 1
  s.absSum += Math.abs(err)
  s.errSum += err
}
function finish(s: Sums): AccuracyAggregate {
  return {
    n: s.n,
    mae: Math.round((s.absSum / s.n) * 100) / 100,
    bias: Math.round((s.errSum / s.n) * 100) / 100,
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Numeric stat entries only, with the feed's own aggregate columns (pts_*, adp_*, gp) dropped. */
function numericStatLine(v: unknown): Record<string, number> | null {
  const rec = asRecord(v)
  if (!rec) return null
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(rec)) {
    if (key.startsWith('pts_') || key.startsWith('adp_') || key === 'gp') continue
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return Object.keys(out).length ? out : null
}

/**
 * Score a stat line under the canonical PPR rules. `normalizeStatPayload` maps raw provider
 * keys (pass_yd, rec, …) to the template's canonical keys and passes already-canonical keys
 * through unchanged, so projection stat lines and ingest-normalized actuals share one ruler.
 * Returns null when NO rule matched — an empty overlap is "cannot score", which is a
 * different claim from a true zero.
 */
function scoreUnderPpr(statLine: Record<string, number>, rules: ScoringRuleLike[]): number | null {
  const { total, breakdown } = computeFantasyPointsWithBreakdown(
    normalizeStatPayload('NFL', statLine),
    rules,
  )
  return Object.keys(breakdown).length > 0 ? Math.round(total * 100) / 100 : null
}

async function storeRecord(record: ProjectionAccuracyRecord): Promise<void> {
  const cacheKey = projectionAccuracyCacheKey(record.season, record.week)
  const expiresAt = new Date(Date.now() + ACCURACY_TTL_MS)
  const data = JSON.parse(JSON.stringify(record)) as object
  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    update: { data, expiresAt },
    create: { cacheKey, data, expiresAt },
  })
}

/** Compute one week's accuracy record and persist it. Always stores a labeled status. */
export async function computeProjectionAccuracyForWeek(
  season: number,
  week: number,
): Promise<ProjectionAccuracyRecord> {
  const [projRows, statRows, template] = await Promise.all([
    prisma.fantasyProjection.findMany({
      where: { sport: 'NFL', season: String(season), week, scoringPresetId: 'ppr' },
      select: { playerId: true, projectedPoints: true, source: true, stats: true },
    }),
    prisma.playerGameStat.findMany({
      where: { sportType: 'NFL', season, weekOrRound: week },
      select: { playerId: true, normalizedStatMap: true },
    }),
    getScoringTemplate('NFL', 'ppr'),
  ])
  const rules = template.rules

  const record: ProjectionAccuracyRecord = {
    version: 1,
    season,
    week,
    computedAt: new Date().toISOString(),
    status: 'scored',
    scoring:
      'Both sides rescored from stored stat lines under the canonical NFL PPR template ' +
      '(lib/scoring-defaults); PlayerGameStat.fantasyPoints (standard-scored) is never read. ' +
      'IDP-eligible positions excluded: the template scores offense + DST only.',
    actualsScored: 0,
    actualsUnscoreable: 0,
    idpExcludedPairs: 0,
    sources: {},
    afVsSleeper: null,
  }

  if (projRows.length === 0) {
    // Projections are captured before kickoff or never — nothing can appear later, so a
    // labeled tombstone stops this week being re-checked forever.
    record.status = 'no_projection_rows'
    await storeRecord(record)
    return record
  }

  const actualByPlayer = new Map<string, number>()
  for (const row of statRows) {
    const line = numericStatLine(row.normalizedStatMap)
    const pts = line ? scoreUnderPpr(line, rules) : null
    if (pts == null) {
      record.actualsUnscoreable += 1
      continue
    }
    actualByPlayer.set(row.playerId, pts)
  }
  record.actualsScored = actualByPlayer.size
  if (actualByPlayer.size === 0) {
    record.status = 'no_scoreable_actuals'
    await storeRecord(record)
    return record
  }

  type Pair = { projected: number; actual: number; basis: string | null }
  type Bucket = {
    overall: Sums
    byPosition: Map<string, Sums>
    byBasis: Map<string, Sums>
    methods: { rescoredFromStatLine: number; projectedPointsColumn: number }
    withoutActual: number
    sleeperDerived: number
    independent: number
  }
  const buckets = new Map<string, Bucket>()
  const pairsBySourcePlayer = new Map<string, Map<string, Pair>>()

  for (const row of projRows) {
    const meta = asRecord(row.stats)
    const position =
      typeof meta?.position === 'string' && meta.position ? meta.position.toUpperCase() : 'UNK'
    let bucket = buckets.get(row.source)
    if (!bucket) {
      bucket = {
        overall: newSums(),
        byPosition: new Map(),
        byBasis: new Map(),
        methods: { rescoredFromStatLine: 0, projectedPointsColumn: 0 },
        withoutActual: 0,
        sleeperDerived: 0,
        independent: 0,
      }
      buckets.set(row.source, bucket)
    }

    const actual = actualByPlayer.get(row.playerId)
    if (actual == null) {
      bucket.withoutActual += 1
      continue
    }
    if (isIdpEligiblePosition(position)) {
      record.idpExcludedPairs += 1
      continue
    }

    const basis = typeof meta?.basis === 'string' ? meta.basis : null
    // AF rows are a scalar (no component line); provider rows carry the nested stat line the
    // import cron preserves, which rescoring puts on the same ruler as the actuals.
    const line = row.source === 'allfantasy' ? null : numericStatLine(asRecord(meta?.stats))
    const rescored = line ? scoreUnderPpr(line, rules) : null
    const projected = rescored ?? row.projectedPoints
    if (rescored != null) bucket.methods.rescoredFromStatLine += 1
    else bucket.methods.projectedPointsColumn += 1

    const err = projected - actual
    addErr(bucket.overall, err)
    const posSums = bucket.byPosition.get(position) ?? newSums()
    addErr(posSums, err)
    bucket.byPosition.set(position, posSums)

    if (row.source === 'allfantasy') {
      const b = basis ?? 'unknown'
      const basisSums = bucket.byBasis.get(b) ?? newSums()
      addErr(basisSums, err)
      bucket.byBasis.set(b, basisSums)
      if (b.startsWith('sleeper_weekly')) bucket.sleeperDerived += 1
      else bucket.independent += 1
    }

    const perPlayer = pairsBySourcePlayer.get(row.source) ?? new Map<string, Pair>()
    perPlayer.set(row.playerId, { projected, actual, basis })
    pairsBySourcePlayer.set(row.source, perPlayer)
  }

  for (const [source, bucket] of buckets) {
    const entry: SourceAccuracy = {
      overall: bucket.overall.n > 0 ? finish(bucket.overall) : null,
      byPosition: Object.fromEntries([...bucket.byPosition].map(([pos, s]) => [pos, finish(s)])),
      methods: bucket.methods,
      withoutActual: bucket.withoutActual,
    }
    if (source === 'allfantasy') {
      entry.byBasis = Object.fromEntries([...bucket.byBasis].map(([b, s]) => [b, finish(s)]))
      entry.sleeperDerivedPairs = bucket.sleeperDerived
      entry.independentPairs = bucket.independent
    }
    record.sources[source] = entry
  }

  const afPairs = pairsBySourcePlayer.get('allfantasy')
  const sleeperPairs = pairsBySourcePlayer.get('sleeper')
  if (afPairs && sleeperPairs) {
    const afSums = newSums()
    const slSums = newSums()
    for (const [playerId, af] of afPairs) {
      if (af.basis == null || af.basis.startsWith('sleeper_weekly')) continue
      const sl = sleeperPairs.get(playerId)
      if (!sl) continue
      addErr(afSums, af.projected - af.actual)
      addErr(slSums, sl.projected - sl.actual)
    }
    if (afSums.n > 0) {
      record.afVsSleeper = {
        n: afSums.n,
        af: finish(afSums),
        sleeper: finish(slSums),
        note:
          'Same players, same week, same PPR ruler. AF rows with a sleeper_weekly basis are ' +
          'excluded — those are the feed passed through, not an independent forecast.',
      }
    }
  }

  await storeRecord(record)
  return record
}

/**
 * Read one week's stored accuracy record for a future surface. Expiry is deliberately NOT
 * treated as absence — this is a measurement record, not a cache of remote truth.
 */
export async function readProjectionAccuracy(
  season: number,
  week: number,
): Promise<ProjectionAccuracyRecord | null> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: projectionAccuracyCacheKey(season, week) } })
    .catch(() => null)
  const data = asRecord(row?.data)
  return data && data.version === 1 ? (data as unknown as ProjectionAccuracyRecord) : null
}

export interface AccuracyBackfillReport {
  attempted: Array<{ week: number; status: ProjectionAccuracyRecord['status']; afPairs: number | null }>
  skippedExisting: number
  budgetExhausted: boolean
}

/**
 * Score every proven-complete week that has no stored record yet, oldest first. Bounded by
 * maxWeeks and a wall-clock budget so the host cron's own ingest work is never starved.
 * Only weeks the ledger already proved complete are eligible — a partial ingest must never
 * be scored as if it were the week's truth.
 */
export async function scoreProjectionAccuracyForCompletedWeeks(
  season: number,
  completedWeeks: number[],
  opts?: { maxWeeks?: number; budgetMs?: number },
): Promise<AccuracyBackfillReport> {
  const startedAt = Date.now()
  const maxWeeks = opts?.maxWeeks ?? 2
  const budgetMs = opts?.budgetMs ?? 60_000
  const report: AccuracyBackfillReport = { attempted: [], skippedExisting: 0, budgetExhausted: false }

  for (const week of [...completedWeeks].sort((a, b) => a - b)) {
    if (report.attempted.length >= maxWeeks) break
    if (Date.now() - startedAt > budgetMs) {
      report.budgetExhausted = true
      break
    }
    const existing = await readProjectionAccuracy(season, week)
    if (existing) {
      report.skippedExisting += 1
      continue
    }
    const record = await computeProjectionAccuracyForWeek(season, week)
    report.attempted.push({
      week,
      status: record.status,
      afPairs: record.sources.allfantasy?.overall?.n ?? null,
    })
  }
  return report
}
