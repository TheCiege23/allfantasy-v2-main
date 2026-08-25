/**
 * One CFBD fetch, with the difference between "no rows" and "we could not ask"
 * kept intact.
 *
 * ⚠ THE BUG THIS EXISTS FOR IS LIVE. Verified 2026-08-25: the CFBD key returns
 *
 *     HTTP 429  x-calllimit-remaining: 0  {"message":"Monthly call quota exceeded."}
 *
 * and `getCFBDraftPicks` converts exactly that into `[]`. The devy classifier
 * then reads an empty draft-pick index as evidence that NOBODY WAS DRAFTED, and
 * writes that conclusion to every player. A quota wall and a genuinely empty
 * draft class are indistinguishable to every caller downstream.
 *
 * ⚠ AND IT IS NOT MERELY A BAD LOG LINE. `lib/devy-classification.ts` sets
 * `graduatedToNFL = false` in its fall-through branches, so a run made during a
 * quota outage flips real NFL graduates back to college — an inference drawn
 * entirely from data that failed to load. It is masked today only because the
 * table holds forward-looking cohorts and nobody is `true` yet. Backfilling
 * historical draft classes removes that accident.
 *
 * So this returns a discriminated result. A caller must SAY what it does when
 * the answer is "we could not ask", and it can no longer do so by accident.
 */

export type CfbdFailureKind =
  /** Monthly allowance is gone. Retrying now will not help; the month must turn. */
  | 'quota'
  /** Throttled but not exhausted — a backoff may clear it. */
  | 'rate_limit'
  /** Key missing, wrong, or not entitled to this endpoint. */
  | 'unauthorized'
  /** Any other non-2xx. */
  | 'http'
  /** Never reached the server. */
  | 'network'

export type CfbdFailure = {
  kind: CfbdFailureKind
  /** Null when the request never got a response. */
  status: number | null
  /** Safe to log — the key travels in a header and is never echoed here. */
  message: string
  /** The path asked for, without the base or any credential. */
  path: string
}

export type CfbdResult<T> = { ok: true; data: T } | { ok: false; failure: CfbdFailure }

export const CFBD_BASE_URL = 'https://api.collegefootballdata.com'

/**
 * ⚠ CFBD USES 429 FOR TWO DIFFERENT THINGS and only the body separates them.
 * Monthly exhaustion is terminal for the month; ordinary throttling is not.
 * Treating them the same means either giving up for weeks on a transient blip,
 * or retrying a wall thousands of times.
 */
function classify(status: number, body: string, path: string): CfbdFailure {
  const lower = body.toLowerCase()
  if (status === 429) {
    return {
      kind: lower.includes('quota') ? 'quota' : 'rate_limit',
      status,
      message: lower.includes('quota')
        ? 'CFBD monthly call quota exceeded — no further calls will succeed until the quota resets'
        : 'CFBD rate limit hit',
      path,
    }
  }
  if (status === 401 || status === 403) {
    return { kind: 'unauthorized', status, message: `CFBD rejected the key (${status})`, path }
  }
  return { kind: 'http', status, message: `CFBD responded ${status}`, path }
}

/**
 * GET a CFBD path.
 *
 * `path` starts with a slash and carries its own query string. The key is sent
 * as `Authorization: Bearer` — the scheme the CFBD getting-started page
 * documents — so it never appears in a URL that might be logged.
 */
export async function cfbdGet<T = unknown>(path: string, apiKey: string): Promise<CfbdResult<T>> {
  if (!apiKey) {
    return {
      ok: false,
      failure: { kind: 'unauthorized', status: null, message: 'no CFBD API key configured', path },
    }
  }

  let res: Response
  try {
    res = await fetch(`${CFBD_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
  } catch (err) {
    return {
      ok: false,
      failure: {
        kind: 'network',
        status: null,
        message: `CFBD request failed: ${err instanceof Error ? err.message : String(err)}`,
        path,
      },
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, failure: classify(res.status, body, path) }
  }

  try {
    return { ok: true, data: (await res.json()) as T }
  } catch (err) {
    return {
      ok: false,
      failure: {
        kind: 'http',
        status: res.status,
        message: `CFBD returned unparseable JSON: ${err instanceof Error ? err.message : String(err)}`,
        path,
      },
    }
  }
}

/** True when retrying later could plausibly work. A quota wall could not. */
export function isRetryable(failure: CfbdFailure): boolean {
  return failure.kind === 'rate_limit' || failure.kind === 'network'
}

export function describeCfbdFailure(failure: CfbdFailure): string {
  return `${failure.message} (${failure.path})`
}
