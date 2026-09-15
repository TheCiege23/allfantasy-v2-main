/**
 * Server trace sampling: capture every real /core render, and ration everything else.
 *
 * WHY NOT A FLAT RATE. Until this module the server sampled 10% of everything. Measured over the
 * 7 days to 2026-09-15, that spent ~72% of all spans on crons (`draft-tick` alone: 194k extrapolated
 * spans; the Railway/deploy-verify poll of `/api/af-debug/sha`: 18k) while capturing only ~360 of the
 * ~3,640 /core renders, which is too few to budget per screen and per device. A flat rate cannot
 * fix that: raising it multiplies the cron noise, lowering it starves the pages.
 *
 * SO THE BUDGET IS PER ROUTE, IN TRACES PER HOUR. Each route key (see `routeKeyFor`) owns a token
 * bucket, and each category has a second bucket as a safety ceiling. A cron that fires every minute
 * gets the same handful of traces per hour as one that fires hourly, which is exactly what a
 * duration budget needs, and a burst of traffic cannot multiply the bill.
 *
 * ⚠ BUCKETS ARE PER PROCESS. Railway runs one replica each for web and worker, so the ceilings
 * below are per service. They reset on deploy, which only ever errs towards sampling more for a
 * moment, never towards going blind.
 */

import { classifyRequest, type RequestClassification } from './requestContext'

export type SamplingCategory = 'core' | 'page' | 'api' | 'job' | 'bot' | 'prefetch' | 'none'

export type CategoryBudget = {
  /** Traces per hour for one route key. */
  perRoutePerHour: number
  /** Traces per hour for the whole category — a ceiling, not a target. */
  perCategoryPerHour: number
}

export type SamplingBudgets = Record<Exclude<SamplingCategory, 'none'>, CategoryBudget>

/**
 * Production budgets, sized against the traffic measured on 2026-09-15: ~320 /core renders a day
 * (peaking well under 100 an hour), ~42 scheduled jobs, and ~12.5k spans a day in total today.
 *
 * - core: generous enough to be every real render. This is the surface the budgets are about.
 * - job: one trace per job every two hours is ~12 a day per job, plenty for a weekly p95, and it
 *   stops the minute-cadence ticks from being most of the bill.
 * - prefetch: Next prefetches links in the viewport. They are not user-visible renders and would
 *   pollute every render budget, so they are never traced.
 */
export const PRODUCTION_BUDGETS: SamplingBudgets = {
  core: { perRoutePerHour: 120, perCategoryPerHour: 300 },
  page: { perRoutePerHour: 4, perCategoryPerHour: 40 },
  api: { perRoutePerHour: 1, perCategoryPerHour: 30 },
  job: { perRoutePerHour: 0.5, perCategoryPerHour: 30 },
  bot: { perRoutePerHour: 1, perCategoryPerHour: 2 },
  prefetch: { perRoutePerHour: 0, perCategoryPerHour: 0 },
}

/** Root spans with no request attached (background work, scripts): a small flat rate. */
const UNATTRIBUTED_RATE = 0.05

/** Bound the bucket map so a crawler presenting endless paths cannot grow it without limit. */
const DEFAULT_MAX_ROUTE_KEYS = 2_000

export type TracesSamplerInput = {
  name?: string
  attributes?: Record<string, unknown>
  normalizedRequest?: { url?: string; method?: string; headers?: Record<string, string | string[] | undefined> }
  parentSampled?: boolean
}

type Bucket = { tokens: number; updatedAt: number }

export type TracesSamplerOptions = {
  /** `NODE_ENV === 'production'`. Anything else samples every request that is worth tracing. */
  production: boolean
  /** Incident switch: trace everything except health checks, assets and prefetches. */
  sampleAll?: boolean
  budgets?: SamplingBudgets
  now?: () => number
  maxRouteKeys?: number
}

export function categoryFor(classification: RequestClassification): SamplingCategory {
  if (classification.surface === 'health' || classification.surface === 'asset') return 'none'
  if (classification.nav === 'prefetch') return 'prefetch'
  // Before `bot`: the cron dispatchers send a non-browser user-agent and would otherwise land there.
  if (classification.surface === 'job') return 'job'
  if (classification.device === 'bot') return 'bot'
  if (classification.surface === 'api') return 'api'
  if (classification.surface === 'core') return 'core'
  return 'page'
}

/**
 * The URL to classify when the SDK did not attach a normalized request. Next's route-handler spans
 * are named like `GET /app/api/cron/draft-tick`, so the `/app` prefix is stripped before `/api/`.
 */
function fallbackUrl(input: TracesSamplerInput): string | null {
  const attributes = input.attributes ?? {}
  for (const key of ['url.path', 'http.target', 'http.route', 'next.route']) {
    const value = attributes[key]
    if (typeof value === 'string' && value.startsWith('/')) return value
  }
  const name = typeof input.name === 'string' ? input.name.replace(/^[A-Z]+\s+/, '') : ''
  if (!name.startsWith('/')) return null
  return name.startsWith('/app/api/') ? name.slice('/app'.length) : name
}

function take(buckets: Map<string, Bucket>, key: string, ratePerHour: number, now: number): boolean {
  if (!(ratePerHour > 0)) return false
  const capacity = Math.max(1, ratePerHour)
  const refillPerMs = ratePerHour / 3_600_000
  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now }
  const elapsed = Math.max(0, now - bucket.updatedAt)
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs)
  bucket.updatedAt = now
  buckets.set(key, bucket)
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

/** The token-bucket check without consuming anything, so a category refusal never burns a route token. */
function peek(buckets: Map<string, Bucket>, key: string, ratePerHour: number, now: number): boolean {
  if (!(ratePerHour > 0)) return false
  const capacity = Math.max(1, ratePerHour)
  const bucket = buckets.get(key)
  if (!bucket) return true
  const tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.updatedAt) * (ratePerHour / 3_600_000))
  return tokens >= 1
}

export function createTracesSampler(options: TracesSamplerOptions): (input: TracesSamplerInput) => number {
  const budgets = options.budgets ?? PRODUCTION_BUDGETS
  const now = options.now ?? Date.now
  const maxRouteKeys = options.maxRouteKeys ?? DEFAULT_MAX_ROUTE_KEYS
  const routeBuckets = new Map<string, Bucket>()
  const categoryBuckets = new Map<string, Bucket>()

  return function tracesSampler(input: TracesSamplerInput): number {
    try {
      const request = input.normalizedRequest
      const url = typeof request?.url === 'string' && request.url ? request.url : fallbackUrl(input)
      if (!url) return options.production && !options.sampleAll ? UNATTRIBUTED_RATE : 1

      const classification = classifyRequest({ url, method: request?.method, headers: request?.headers })
      const category = categoryFor(classification)

      // Never traced, in any environment or mode: health polls, static assets, router prefetches.
      if (category === 'none' || category === 'prefetch') return 0
      if (!options.production || options.sampleAll) return 1

      const budget = budgets[category]
      const at = now()
      if (routeBuckets.size > maxRouteKeys) routeBuckets.clear()

      // ⚠ A SAMPLED PARENT STILL SPENDS FROM THE BUDGET. Every client navigation sends
      // `sentry-trace`, so inheriting unconditionally would hand the browser's sampling rate — and
      // any polling loop running under a live span — control of the server bill. When the budget is
      // spent the server declines, and that trace simply has no server half.
      const routeKey = classification.routeKey
      if (!peek(categoryBuckets, category, budget.perCategoryPerHour, at)) return 0
      if (!take(routeBuckets, routeKey, budget.perRoutePerHour, at)) return 0
      take(categoryBuckets, category, budget.perCategoryPerHour, at)
      return 1
    } catch {
      // A sampler must never throw into the SDK. Declining is the cheap failure.
      return 0
    }
  }
}
