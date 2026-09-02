import { prisma } from "@/lib/prisma"

/**
 * Growth over time for the Command Center: signups, entries, pools, active
 * users and paid conversions, bucketed by day / week / month.
 *
 * ⚠ NO RAW SQL, DELIBERATELY. Bucketing with `date_trunc` in Postgres would be
 * the obvious implementation and is the wrong call in this repo. The six tables
 * involved disagree about naming — `app_users`.`createdAt`,
 * `world_cup_bracket_entries`.`created_at`, `BracketPayment` with no `@@map` at
 * all — so hand-written SQL has three chances per query to be silently wrong,
 * and this checkout's only reachable database is PRODUCTION (CLAUDE.md), so
 * there is no environment in which such a query could be run once before
 * shipping. Untested SQL against a schema this inconsistent is exactly the
 * failure mode this repo keeps writing down. Prisma's typed API resolves every
 * name from the schema instead, and the bucketing below is pure and unit-tested
 * with no database at all.
 *
 * ⚠ ONE FETCH, THREE GRANULARITIES. The rows are read once over the longest
 * window (12 months) and bucketed three ways in memory, so the day/week/month
 * switcher costs no extra query and no reload. Only timestamps are selected —
 * never whole rows.
 *
 * ⚠ VOLUME NOTE, HONESTLY STATED. `AnalyticsEvent` is the one table here that
 * can grow without bound, and it has no index on `createdAt` alone (only
 * `[event, createdAt]` and `[path, createdAt]`). At this app's current size —
 * ~1.2k users — a 12-month scan selecting two columns is cheap. If that table
 * reaches the millions, `activeUsers` is the metric to move to a materialised
 * rollup first; the other four are bounded by user and entry counts.
 */

export type GrowthGranularity = "day" | "week" | "month"

export type GrowthMetricKey = "signups" | "entries" | "pools" | "activeUsers" | "paidConversions"

export type GrowthBucket = {
  /** Stable key for the bucket, e.g. "2026-09-01" or "2026-09". */
  key: string
  /** Human label for an axis, already in the reporting timezone. */
  label: string
  value: number
  /**
   * ⚠ THE PERIOD IS STILL RUNNING. The last bucket is always the one `now`
   * falls inside, so it holds a part-period: at 9am Monday the "week" column
   * has a few hours in it and the chart appears to fall off a cliff. That is
   * an artifact of when you looked, not a trend, and it is the single most
   * misread thing on any dashboard chart. The renderer must mark it — see
   * `markCurrentBucket`.
   */
  partial?: boolean
}

export type GrowthMetric = {
  key: GrowthMetricKey
  label: string
  /** What the number counts, in one line — shown under the metric name. */
  hint: string
  /**
   * ⚠ SAME CONTRACT AS `AdminMetric.tracked`. A metric that cannot be measured
   * renders as NOT TRACKED, never as a series of zeros. A flat line at zero and
   * an uninstrumented metric look identical on a chart, which is the chart
   * version of the $0.00 bug 29a exists to fix.
   */
  tracked: boolean
  /** Why it is untracked. Only meaningful when `tracked` is false. */
  reason?: string
  total: number
  buckets: GrowthBucket[]
}

export type GrowthSeriesForGranularity = {
  granularity: GrowthGranularity
  windowLabel: string
  metrics: GrowthMetric[]
}

export type AdminGrowthSeries = {
  generatedAt: string
  timezone: string
  /** Keyed by granularity so the client can switch without refetching. */
  byGranularity: Record<GrowthGranularity, GrowthSeriesForGranularity>
}

/**
 * Buckets are labelled in the operator's timezone, not UTC. "Signups today" has
 * to mean the day the person reading it is having — a UTC boundary moves every
 * US evening into tomorrow, which is wrong by about five hours every night.
 */
export const REPORTING_TZ = "America/New_York"

const BUCKET_COUNT: Record<GrowthGranularity, number> = { day: 30, week: 12, month: 12 }

const WINDOW_LABEL: Record<GrowthGranularity, string> = {
  day: "Last 30 days",
  week: "Last 12 weeks",
  month: "Last 12 months",
}

/**
 * The civil (wall-clock) date in `tz`, as {y, m, d}. `en-CA` formats as
 * YYYY-MM-DD, which is the one locale that gives sortable output for free.
 * Going through Intl is what makes this DST-correct: no offset arithmetic.
 */
export function civilDateIn(date: Date, tz: string = REPORTING_TZ): { y: number; m: number; d: number } {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
  const [y, m, d] = iso.split("-").map(Number)
  return { y, m, d }
}

/**
 * The bucket a timestamp belongs to. Week buckets start on Monday.
 *
 * Weekday maths runs on a UTC date built from the CIVIL parts — never on the
 * original instant. Once the wall-clock date is known, the day of week is a
 * pure calendar fact, and doing it in UTC keeps a DST transition from shifting
 * a Sunday into the previous week.
 */
export function bucketKeyFor(date: Date, granularity: GrowthGranularity, tz: string = REPORTING_TZ): string {
  const { y, m, d } = civilDateIn(date, tz)
  const pad = (n: number) => String(n).padStart(2, "0")

  if (granularity === "month") return `${y}-${pad(m)}`
  if (granularity === "day") return `${y}-${pad(m)}-${pad(d)}`

  const civil = new Date(Date.UTC(y, m - 1, d))
  // getUTCDay: 0 = Sunday. Shift so Monday starts the week.
  const shift = (civil.getUTCDay() + 6) % 7
  civil.setUTCDate(civil.getUTCDate() - shift)
  return `${civil.getUTCFullYear()}-${pad(civil.getUTCMonth() + 1)}-${pad(civil.getUTCDate())}`
}

function labelFor(key: string, granularity: GrowthGranularity): string {
  if (granularity === "month") {
    const [y, m] = key.split("-").map(Number)
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
      timeZone: "UTC",
      month: "short",
      year: "2-digit",
    })
  }
  const [y, m, d] = key.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  })
}

/**
 * The ordered, gap-free list of bucket keys ending at `now`. Built forward from
 * the earliest bucket so that a period with no activity renders as a zero
 * column rather than vanishing — a missing bucket silently rescales the axis
 * and makes a quiet week look like a busy one.
 */
export function buildBucketKeys(
  granularity: GrowthGranularity,
  now: Date,
  tz: string = REPORTING_TZ,
): string[] {
  const count = BUCKET_COUNT[granularity]
  const { y, m, d } = civilDateIn(now, tz)
  const keys: string[] = []

  for (let i = count - 1; i >= 0; i--) {
    let cursor: Date
    if (granularity === "month") {
      cursor = new Date(Date.UTC(y, m - 1 - i, 1))
    } else if (granularity === "week") {
      cursor = new Date(Date.UTC(y, m - 1, d - i * 7))
    } else {
      cursor = new Date(Date.UTC(y, m - 1, d - i))
    }
    // The cursor is already a civil date in UTC, so bucket it as UTC rather
    // than re-interpreting it through the reporting timezone (which would
    // shift it back a day for any negative-offset zone).
    keys.push(bucketKeyFor(cursor, granularity, "UTC"))
  }
  return keys
}

/** Count timestamps into the given bucket keys. Anything outside is dropped. */
export function bucketize(
  dates: Date[],
  granularity: GrowthGranularity,
  keys: string[],
  tz: string = REPORTING_TZ,
): GrowthBucket[] {
  const counts = new Map<string, number>(keys.map((k) => [k, 0]))
  for (const date of dates) {
    const key = bucketKeyFor(date, granularity, tz)
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return keys.map((key) => ({ key, label: labelFor(key, granularity), value: counts.get(key) ?? 0 }))
}

/**
 * Distinct users per bucket. Not a plain count: the same person visiting nine
 * times in a day is one active user, and counting events instead would make
 * "active users" a traffic metric wearing a people label.
 */
export function bucketizeDistinct(
  rows: Array<{ createdAt: Date; userId: string | null }>,
  granularity: GrowthGranularity,
  keys: string[],
  tz: string = REPORTING_TZ,
): GrowthBucket[] {
  const sets = new Map<string, Set<string>>(keys.map((k) => [k, new Set<string>()]))
  for (const row of rows) {
    if (!row.userId) continue
    const key = bucketKeyFor(row.createdAt, granularity, tz)
    sets.get(key)?.add(row.userId)
  }
  return keys.map((key) => ({ key, label: labelFor(key, granularity), value: sets.get(key)?.size ?? 0 }))
}

/**
 * Distinct users across the WHOLE window — not the sum of the per-bucket
 * counts.
 *
 * 🛑 SUMMING A DISTINCT METRIC IS A REAL BUG AND IT LOOKS FINE. Someone active
 * in nine of twelve months contributes nine to a summed total, so "active
 * users" can comfortably exceed the number of humans who have ever registered.
 * The bucket VALUES are per-bucket distinct (correct for a chart column); the
 * TOTAL has to be recomputed over the union, which is what this does. Counts
 * only rows that land inside `keys`, so the total always describes the same
 * span the chart draws.
 */
export function distinctWithin(
  rows: Array<{ createdAt: Date; userId: string | null }>,
  granularity: GrowthGranularity,
  keys: string[],
  tz: string = REPORTING_TZ,
): number {
  const inWindow = new Set(keys)
  const users = new Set<string>()
  for (const row of rows) {
    if (!row.userId) continue
    if (inWindow.has(bucketKeyFor(row.createdAt, granularity, tz))) users.add(row.userId)
  }
  return users.size
}

/**
 * Flag the in-progress bucket — the one `now` falls inside.
 *
 * Identified by key rather than by comparing instants: `bucketKeyFor` is
 * already the timezone- and DST-correct answer to "which period is this time
 * in", and reusing it means there is exactly one place in this file that knows
 * how a period boundary works. Computing the period's end instant separately
 * would be a second implementation of the same rule, which is how the two drift
 * apart across a DST weekend.
 *
 * By construction `buildBucketKeys` ends at the current period, so in practice
 * this marks the last column. Matching on key rather than on position keeps it
 * honest if that ever stops being true.
 */
export function markCurrentBucket(
  buckets: GrowthBucket[],
  granularity: GrowthGranularity,
  now: Date,
  tz: string = REPORTING_TZ,
): GrowthBucket[] {
  const currentKey = bucketKeyFor(now, granularity, tz)
  return buckets.map((b) => (b.key === currentKey ? { ...b, partial: true } : b))
}

/*
 * Upper bound on rows pulled for the distinct-active-users calculation. Big
 * enough that this app's real volume is unaffected, small enough that a table
 * which has grown without anyone noticing cannot stall the admin console.
 */
const ACTIVE_USER_ROW_CAP = 200_000

const COMPLETED_PAYMENT_STATUSES = ["completed", "paid", "succeeded"]

export async function getAdminGrowthSeries(now: Date = new Date()): Promise<AdminGrowthSeries> {
  // 12 months + a little slack, so the oldest month bucket is fully covered.
  const since = new Date(now.getTime() - 400 * 86_400_000)
  const ts = { createdAt: true } as const

  const [signups, entries, pools, subs, payments, events] = await Promise.all([
    prisma.appUser.findMany({ where: { createdAt: { gte: since } }, select: ts }),
    prisma.worldCupBracketEntry.findMany({ where: { createdAt: { gte: since } }, select: ts }),
    prisma.worldCupBracketChallenge.findMany({ where: { createdAt: { gte: since } }, select: ts }),
    prisma.userSubscription.findMany({ where: { createdAt: { gte: since } }, select: ts }),
    prisma.bracketPayment.findMany({
      where: { createdAt: { gte: since }, status: { in: COMPLETED_PAYMENT_STATUSES } },
      select: ts,
    }),
    /*
     * 🛑 THIS QUERY TOOK /admin DOWN ON 2026-09-02 AND THE COMMENT ABOVE
     * PREDICTED IT. The header says AnalyticsEvent "is the one table here that
     * can grow without bound" and has no index on `createdAt` alone — and it
     * was then written as an unbounded findMany over 400 days anyway. Postgres
     * cannot serve `createdAt >= x` from `[event, createdAt]` or
     * `[path, createdAt]` (wrong leading column), and `userId IS NOT NULL` is
     * not selective, so it degrades to a sequential scan that ships every
     * matching row over the wire. Writing the risk down is not the same as
     * bounding it.
     *
     * `take` makes the cost predictable. Newest-first so the recent buckets —
     * the ones anyone actually reads — are always complete.
     *
     * ⚠ THE CAP BIASES THE OLDEST BUCKETS, AND THAT IS A REAL TRADE, NOT A
     * FREE WIN. Past the cap the earliest months undercount distinct users.
     * That is preferable to a console that will not load, but it is a stopgap:
     * the correct fix is a GROUP BY with COUNT(DISTINCT "userId") in the
     * database, returning ~30 rows instead of a million, or a maintained
     * rollup. Both need to be measured against a real database before shipping,
     * which is exactly what this checkout cannot do.
     */
    prisma.analyticsEvent.findMany({
      where: { createdAt: { gte: since }, userId: { not: null } },
      select: { createdAt: true, userId: true },
      orderBy: { createdAt: "desc" },
      take: ACTIVE_USER_ROW_CAP,
    }),
  ])

  const at = (rows: Array<{ createdAt: Date }>) => rows.map((r) => r.createdAt)
  // A subscription started and a bracket paid for are both "someone converted".
  const conversions = [...at(subs), ...at(payments)]

  const build = (granularity: GrowthGranularity): GrowthSeriesForGranularity => {
    const keys = buildBucketKeys(granularity, now)
    const mk = (
      key: GrowthMetricKey,
      label: string,
      hint: string,
      buckets: GrowthBucket[],
      opts: { total?: number; tracked?: boolean; reason?: string } = {},
    ): GrowthMetric => ({
      key,
      label,
      hint,
      tracked: opts.tracked ?? true,
      reason: opts.reason,
      // Summing buckets is right for counts and WRONG for distinct metrics —
      // hence the override. See distinctWithin.
      total: opts.total ?? buckets.reduce((sum, b) => sum + b.value, 0),
      /*
       * Marked HERE rather than at each call site, so a metric added later
       * cannot quietly ship an unmarked part-period column. The total still
       * includes it: the partial bucket holds real events, it is just a short
       * period, and excluding it would understate the window.
       */
      buckets: markCurrentBucket(buckets, granularity, now),
    })

    return {
      granularity,
      windowLabel: WINDOW_LABEL[granularity],
      metrics: [
        mk("signups", "New signups", "Accounts created", bucketize(at(signups), granularity, keys)),
        mk("entries", "Bracket entries", "Entries submitted", bucketize(at(entries), granularity, keys)),
        mk("pools", "Pools created", "New bracket pools", bucketize(at(pools), granularity, keys)),
        mk(
          "activeUsers",
          "Active users",
          "Distinct signed-in users with recorded activity",
          bucketizeDistinct(events, granularity, keys),
          { total: distinctWithin(events, granularity, keys) },
        ),
        /*
         * ⚠ THIS ONE CAN BE HONESTLY EMPTY. Completed payments currently read
         * zero across the whole app and revenue is explicitly NOT TRACKED, so
         * a flat line here is a true measurement, not a broken meter — the
         * subscription half is instrumented and really is being counted. It
         * stays `tracked: true` for that reason; if the subscription table were
         * uninstrumented too, this would have to flip to NOT TRACKED rather
         * than draw a convincing line along the axis.
         */
        mk(
          "paidConversions",
          "Paid conversions",
          "New subscriptions plus completed bracket payments",
          bucketize(conversions, granularity, keys),
        ),
      ],
    }
  }

  return {
    generatedAt: now.toISOString(),
    timezone: REPORTING_TZ,
    byGranularity: { day: build("day"), week: build("week"), month: build("month") },
  }
}
