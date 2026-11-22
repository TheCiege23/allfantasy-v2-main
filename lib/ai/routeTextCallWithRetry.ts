/**
 * `routeTextCall`, retried with backoff when the whole provider chain failed for a reason that
 * can clear on its own: a rate limit, an overload, a 5xx, a timeout or an empty reply.
 *
 * The router already falls through every configured provider once. What it did not do is wait
 * and try again, so a 30-second rate-limit window on one provider while the others had dead keys
 * became "Chimmy is unavailable" — the user then retried by hand and it worked. A dead key, no
 * credit, the spend kill switch or a content refusal is NOT retried: waiting will not fix those.
 *
 * Every failed attempt is logged with the reason only — provider, category and status — never
 * the prompt, the answer or anything about the user's league.
 */
import { routeTextCall, type RouterFailure, type RouterResult } from '@/lib/ai/providerRouter'

type RouteArgs = Parameters<typeof routeTextCall>[0]

export type RetryOptions = {
  /** Log prefix, e.g. `demo-chimmy`. */
  label: string
  /** Extra attempts after the first. Default 2. */
  retries?: number
  /** First backoff; doubles each retry, plus up to 30% jitter. Default 700 ms. */
  baseDelayMs?: number
  /** Do not START another attempt once this much time has passed. Default 25 s. */
  budgetMs?: number
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  random?: () => number
}

export type RetriedResult = { result: RouterResult; attempts: number; elapsedMs: number }

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** `openai:rate_limit(429), anthropic:timeout` — reasons only, safe to log. */
export function describeRouterFailure(failure: RouterFailure | undefined): string {
  if (!failure || failure.attempts.length === 0) return 'no provider attempted'
  return failure.attempts.map((a) => `${a.provider}:${a.category}${a.status != null ? `(${a.status})` : ''}`).join(', ')
}

export async function routeTextCallWithRetry(args: RouteArgs, opts: RetryOptions): Promise<RetriedResult> {
  const retries = Math.max(0, opts.retries ?? 2)
  const base = Math.max(0, opts.baseDelayMs ?? 700)
  const budget = opts.budgetMs ?? 25_000
  const sleep = opts.sleep ?? realSleep
  const now = opts.now ?? Date.now
  const random = opts.random ?? Math.random
  const startedAt = now()

  let attempt = 0
  for (;;) {
    attempt += 1
    const result = await routeTextCall(args)
    if (result.ok) return { result, attempts: attempt, elapsedMs: now() - startedAt }

    const elapsedMs = now() - startedAt
    const retryable = result.failure?.retryable ?? true
    const delay = Math.round(base * 2 ** (attempt - 1) * (1 + 0.3 * random()))
    const willRetry = retryable && attempt <= retries && elapsedMs + delay < budget
    console.warn(`[${opts.label}] model call failed`, {
      attempt,
      reason: describeRouterFailure(result.failure),
      retryable,
      willRetry,
      elapsedMs,
    })
    if (!willRetry) return { result, attempts: attempt, elapsedMs }
    await sleep(delay)
  }
}
