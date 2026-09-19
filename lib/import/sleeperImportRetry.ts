const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

function statusFromError(error: unknown): number | null {
  const direct = Number((error as { status?: unknown } | null)?.status)
  if (Number.isInteger(direct) && direct >= 100 && direct <= 599) return direct
  const message = error instanceof Error ? error.message : String(error)
  const match = message.match(/(?:HTTP|failed)\s*\(?([45]\d{2})\)?/i)
  if (match) return Number(match[1])
  const cause = (error as { cause?: unknown } | null)?.cause
  return cause != null && cause !== error ? statusFromError(cause) : null
}

function retryAfterMsFromError(error: unknown): number | null {
  const raw = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs
  const value = raw == null ? Number.NaN : Number(raw)
  if (Number.isFinite(value) && value >= 0) return value
  const cause = (error as { cause?: unknown } | null)?.cause
  return cause != null && cause !== error ? retryAfterMsFromError(cause) : null
}

export function isRetryableSleeperImportError(error: unknown): boolean {
  const status = statusFromError(error)
  if (status != null) return RETRYABLE_STATUSES.has(status)
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (/timeout|timed out|network|fetch|socket|econnreset|unavailable/.test(message)) return true
  const cause = (error as { cause?: unknown } | null)?.cause
  return cause != null && cause !== error ? isRetryableSleeperImportError(cause) : false
}

export function getSleeperImportFailureResponse(error: unknown): {
  status: 429 | 503
  retryAfterSec: number
  code: 'SLEEPER_RATE_LIMITED' | 'SLEEPER_UNAVAILABLE'
  message: string
} {
  const providerStatus = statusFromError(error)
  const retryAfterMs = retryAfterMsFromError(error)
  const rateLimited = providerStatus === 429
  return {
    status: rateLimited ? 429 : 503,
    retryAfterSec: Math.max(1, Math.ceil((retryAfterMs ?? (rateLimited ? 60_000 : 5_000)) / 1000)),
    code: rateLimited ? 'SLEEPER_RATE_LIMITED' : 'SLEEPER_UNAVAILABLE',
    message: rateLimited
      ? 'Sleeper is rate-limiting imports right now. Your league data is safe; retry shortly.'
      : 'Sleeper is temporarily unavailable. No season was marked empty; retry shortly.',
  }
}

export async function runSleeperImportRequest<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number
    baseDelayMs?: number
    maxDelayMs?: number
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 300)
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 8_000)
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts || !isRetryableSleeperImportError(error)) throw error
      const providerDelay = retryAfterMsFromError(error)
      const exponentialDelay = baseDelayMs * 2 ** (attempt - 1)
      await sleep(Math.min(maxDelayMs, providerDelay ?? exponentialDelay))
    }
  }

  throw lastError
}
