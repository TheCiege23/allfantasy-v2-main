import { prisma } from '@/lib/prisma'
import { getCbbdDraftPicks, type CbbdDraftPick } from '@/lib/cbbd/cbbdFetch'
import { describeCfbdFailure } from '@/lib/cfbd-fetch'
import { cfbdBackgroundAllowed } from '@/lib/cfbd-quota'

/**
 * The NBA draft, EVERY year, as CBBD reports it — the drafted half of the basketball devy measurement
 * (`contracts/cbbd/GAPS.md` B-02 item 2, B-03). INGESTION: the only module besides
 * lib/devy/cbbdDraftPicksStore.ts that imports the CBBD adapter.
 *
 * WHY A SECOND KEY, NOT `cbbd:draft-picks:v1:<year>`. That row is the C2C / Devy pipeline's: picks linked to
 * our players by ESPN id, which costs one roster call per drafted player's school (~25 a draft). The
 * measurement needs none of that — it joins a pick to a RECRUIT, not to our player — so this row stores the
 * picks exactly as CBBD sends them, keyed on CBBD's own `athleteId`, for ONE call a year. Writing old years
 * into the pipeline's key would also put a row there with no linked picks, which that reader would take for
 * "nobody drafted". Two keys, two questions.
 *
 * STORED under `cbbd:draft-history:v1:<year>` as `StoredCbbdDraftHistory`, never expiring in practice: a
 * held draft does not change. Fields are the ones `contracts/cbbd/fixtures/draft-picks-2025.json` carries;
 * nothing here is guessed.
 *
 * WRITERS. `backfillCbbdDraftHistory` (scripts/backfill-cbbd-draft-history.ts) for past years, and the
 * scheduled `refreshCbbdDraftPicks`, which writes its own year's row from the call it already makes — so
 * history keeps growing after the backfill with no extra calls. Neither ever deletes a row.
 *
 * COST. One call per year not already final. The quota is CFBD football's (same key, same month), so the
 * backfill stops the moment the shared background reserve is reached (`cfbdBackgroundAllowed`), paces its
 * calls, and refuses a range wider than `MAX_BACKFILL_YEARS`.
 *
 * 🛑 THE KEY IS NEVER IN A RESULT OR A LOG. It travels only as the Bearer header inside `cfbdGet`; every
 * failure is reported through `describeCfbdFailure`, which names the path and nothing else.
 */

export const CBBD_DRAFT_HISTORY_KEY_PREFIX = 'cbbd:draft-history:v1:'
/** The earliest year the backfill accepts. CBBD's coverage before it is unmeasured. */
export const EARLIEST_BACKFILL_YEAR = 2000
/** The default first year: ten-plus classes, enough for an outcome window of five drafts per class. */
export const DEFAULT_BACKFILL_FROM = 2010
/** The widest range one run may cover — a typo'd range is a quota event, not a long run. */
export const MAX_BACKFILL_YEARS = 30
/** Pause between calls. The quota is shared with every CFBD football job, so this is never 0 by default. */
export const DEFAULT_BACKFILL_DELAY_MS = 2_000
/** A held draft does not change, so its row is kept indefinitely. */
export const DRAFT_HISTORY_EXPIRES_AT = new Date(Date.UTC(2100, 0, 1))

export type StoredCbbdHistoryPick = {
  /** CBBD athlete id: the same id as the draft-year roster's `players[].id` (B-01). Null for international picks and a few college ones. */
  athleteId: number | null
  name: string
  position: string | null
  overall: number
  round: number
  pick: number
  /** Pre-draft rank among this draft's prospects. Drafted players only. */
  overallRank: number | null
  positionRank: number | null
  /** True when the pick came from a college (`sourceTeamCollegeId` set). */
  college: boolean
  sourceTeamCollegeId: number | null
  sourceTeamLocation: string | null
  sourceTeamLeagueAffiliation: string | null
  draftTeam: string
}

export type StoredCbbdDraftHistory = {
  year: number
  fetchedAt: string
  /** True once fetched after the year's draft window closed: nothing will refetch it. */
  final: boolean
  picks: StoredCbbdHistoryPick[]
  counts: { picks: number; college: number; collegeWithAthleteId: number }
}

/** The end of a year's NBA draft window (July 10, UTC) — the same date `cbbdDraftPicksStore` uses. */
export function draftWindowEnd(year: number): Date {
  return new Date(Date.UTC(year, 6, 11))
}

/** The newest draft whose window has closed: the newest the backfill may write. */
export function lastFinalDraftYear(now: Date): number {
  const y = now.getUTCFullYear()
  return now.getTime() >= draftWindowEnd(y).getTime() ? y : y - 1
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/**
 * Pure: one CBBD `/draft/picks?year=Y` response -> the stored row, or why it must not be stored. Refuses an
 * empty response (it would read as "nobody was drafted"), any pick from another year, and any pick with no
 * overall number — a malformed row stored once is a wrong measurement forever.
 */
export function toDraftHistoryRow(
  year: number,
  response: unknown,
  now: Date,
): { ok: true; row: StoredCbbdDraftHistory } | { ok: false; reason: string } {
  if (!Array.isArray(response)) return { ok: false, reason: 'response is not an array' }
  if (response.length === 0) return { ok: false, reason: 'no picks published' }
  const picks: StoredCbbdHistoryPick[] = []
  for (const raw of response as Array<Partial<CbbdDraftPick>>) {
    const overall = num(raw?.overall)
    if (num(raw?.year) !== year) return { ok: false, reason: `a pick reports year ${String(raw?.year)}, not ${year}` }
    if (overall == null || overall < 1) return { ok: false, reason: `a pick has no overall number (${String(raw?.name ?? 'unnamed')})` }
    const collegeId = num(raw.sourceTeamCollegeId)
    picks.push({
      athleteId: num(raw.athleteId),
      name: String(raw.name ?? ''),
      position: str(raw.position),
      overall,
      round: num(raw.round) ?? 0,
      pick: num(raw.pick) ?? 0,
      overallRank: num(raw.overallRank),
      positionRank: num(raw.positionRank),
      college: collegeId != null,
      sourceTeamCollegeId: collegeId,
      sourceTeamLocation: str(raw.sourceTeamLocation),
      sourceTeamLeagueAffiliation: str(raw.sourceTeamLeagueAffiliation),
      draftTeam: String(raw.draftTeam ?? ''),
    })
  }
  picks.sort((a, b) => a.overall - b.overall)
  const college = picks.filter((p) => p.college)
  return {
    ok: true,
    row: {
      year,
      fetchedAt: now.toISOString(),
      final: now.getTime() >= draftWindowEnd(year).getTime(),
      picks,
      counts: { picks: picks.length, college: college.length, collegeWithAthleteId: college.filter((p) => p.athleteId != null).length },
    },
  }
}

/** A stored row read back, or null when absent or not this shape. */
export function parseDraftHistoryRow(data: unknown): StoredCbbdDraftHistory | null {
  const d = data as Partial<StoredCbbdDraftHistory> | null
  if (!d || typeof d.year !== 'number' || typeof d.fetchedAt !== 'string' || !Array.isArray(d.picks)) return null
  return d as StoredCbbdDraftHistory
}

/** True when the stored row was fetched after its draft window closed, so refetching it buys nothing. */
export function isFinalRow(row: StoredCbbdDraftHistory | null): boolean {
  if (!row) return false
  const at = Date.parse(row.fetchedAt)
  return Number.isFinite(at) && at >= draftWindowEnd(row.year).getTime()
}

type CacheDb = {
  sportsDataCache: {
    findUnique(args: { where: { cacheKey: string }; select: { data: true } }): Promise<{ data: unknown } | null>
    upsert(args: { where: { cacheKey: string }; create: { cacheKey: string; data: never; expiresAt: Date }; update: { data: never; expiresAt: Date } }): Promise<unknown>
  }
}

/** Write one year's row. Upsert of that year's key only — no other row is touched, so history is never lost. */
export async function writeDraftHistoryRow(row: StoredCbbdDraftHistory, db: CacheDb = prisma as unknown as CacheDb): Promise<void> {
  const cacheKey = `${CBBD_DRAFT_HISTORY_KEY_PREFIX}${row.year}`
  await db.sportsDataCache.upsert({
    where: { cacheKey },
    create: { cacheKey, data: row as never, expiresAt: DRAFT_HISTORY_EXPIRES_AT },
    update: { data: row as never, expiresAt: DRAFT_HISTORY_EXPIRES_AT },
  })
}

export type BackfillYearResult =
  | { year: number; status: 'stored'; picks: number; college: number; collegeWithAthleteId: number }
  | { year: number; status: 'skipped'; reason: string }
  | { year: number; status: 'error'; reason: string }

export type BackfillResult = {
  from: number
  to: number
  calls: number
  years: BackfillYearResult[]
  /** Set when the run stopped before the end of its range; the rows already written stand. */
  stoppedEarly: string | null
}

export type BackfillDeps = {
  db?: CacheDb
  fetchPicks?: typeof getCbbdDraftPicks
  /** Background quota gate. Defaults to the shared CFBD reserve check. */
  quotaAllowed?: () => Promise<{ allowed: boolean; reason: string | null }>
  sleep?: (ms: number) => Promise<void>
}

/** Validate a requested range against today. Returns the reason it is refused, or null. */
export function backfillRangeError(from: number, to: number, now: Date, maxYears = MAX_BACKFILL_YEARS): string | null {
  const last = lastFinalDraftYear(now)
  if (!Number.isInteger(from) || !Number.isInteger(to)) return 'years must be whole numbers'
  if (from < EARLIEST_BACKFILL_YEAR) return `from must be ${EARLIEST_BACKFILL_YEAR} or later`
  if (to > last) return `to must be ${last} or earlier: a draft whose window has not closed belongs to the scheduled writer`
  if (from > to) return 'from is after to'
  if (to - from + 1 > maxYears) return `${to - from + 1} years is more than the ${maxYears} one run may cover`
  return null
}

/**
 * Store every NBA draft in [from, to] that is not already stored final. Idempotent: a second run over the same
 * range makes no call. Bounded: refuses a range outside `backfillRangeError`, and stops — keeping what it wrote
 * — on the first failed call or when the shared quota reserve is reached. Paced: `delayMs` between calls.
 */
export async function backfillCbbdDraftHistory(opts: {
  from?: number
  to?: number
  now?: Date
  delayMs?: number
  maxYears?: number
  dryRun?: boolean
  deps?: BackfillDeps
} = {}): Promise<BackfillResult> {
  const now = opts.now ?? new Date()
  const from = opts.from ?? DEFAULT_BACKFILL_FROM
  const to = opts.to ?? lastFinalDraftYear(now)
  const delayMs = Math.max(0, opts.delayMs ?? DEFAULT_BACKFILL_DELAY_MS)
  const db = opts.deps?.db ?? (prisma as unknown as CacheDb)
  const fetchPicks = opts.deps?.fetchPicks ?? getCbbdDraftPicks
  const quotaAllowed = opts.deps?.quotaAllowed ?? (() => cfbdBackgroundAllowed(now))
  const sleep = opts.deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const refused = backfillRangeError(from, to, now, opts.maxYears ?? MAX_BACKFILL_YEARS)
  if (refused) throw new Error(`draft history backfill refused: ${refused}`)

  const years: BackfillYearResult[] = []
  let calls = 0
  for (let year = from; year <= to; year++) {
    const key = `${CBBD_DRAFT_HISTORY_KEY_PREFIX}${year}`
    const existing = parseDraftHistoryRow((await db.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { data: true } }))?.data)
    if (isFinalRow(existing)) {
      years.push({ year, status: 'skipped', reason: 'already stored' })
      continue
    }
    if (opts.dryRun) {
      years.push({ year, status: 'skipped', reason: 'dry run: would fetch' })
      continue
    }
    const gate = await quotaAllowed()
    if (!gate.allowed) return { from, to, calls, years, stoppedEarly: gate.reason ?? 'CFBD quota reserve' }
    if (calls > 0 && delayMs > 0) await sleep(delayMs)
    calls++
    const res = await fetchPicks(year)
    if (!res.ok) {
      years.push({ year, status: 'error', reason: describeCfbdFailure(res.failure) })
      return { from, to, calls, years, stoppedEarly: `${year}: ${res.failure.kind}` }
    }
    const built = toDraftHistoryRow(year, res.data, now)
    if (!built.ok) {
      years.push({ year, status: 'skipped', reason: built.reason })
      continue
    }
    await writeDraftHistoryRow(built.row, db)
    years.push({ year, status: 'stored', picks: built.row.counts.picks, college: built.row.counts.college, collegeWithAthleteId: built.row.counts.collegeWithAthleteId })
  }
  return { from, to, calls, years, stoppedEarly: null }
}

/** Every stored year in [from, to], for the measurement script. Missing years are simply absent from the map. */
export async function readDraftHistory(years: readonly number[], db: { sportsDataCache: { findMany(args: { where: { cacheKey: { in: string[] } }; select: { data: true } }): Promise<Array<{ data: unknown }>> } } = prisma as never): Promise<Map<number, StoredCbbdDraftHistory>> {
  const rows = await db.sportsDataCache.findMany({ where: { cacheKey: { in: years.map((y) => `${CBBD_DRAFT_HISTORY_KEY_PREFIX}${y}`) } }, select: { data: true } })
  const out = new Map<number, StoredCbbdDraftHistory>()
  for (const r of rows) {
    const row = parseDraftHistoryRow(r.data)
    if (row) out.set(row.year, row)
  }
  return out
}
