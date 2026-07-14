import { describe, expect, it, vi } from 'vitest'
import { fetchJsonWithRetry } from '@/lib/shared-services/import/resilientFetch'

function jsonResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('fetchJsonWithRetry', () => {
  it('returns success on the first attempt when the request succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { hello: 'world' }))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    const result = await fetchJsonWithRetry<{ hello: string }>('https://example.com/x', {
      fetchImpl,
      sleepImpl,
    })

    expect(result).toEqual({ status: 'success', data: { hello: 'world' } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleepImpl).not.toHaveBeenCalled()
  })

  it('retries on a 5xx and succeeds on a later attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    const result = await fetchJsonWithRetry('https://example.com/x', { fetchImpl, sleepImpl })

    expect(result).toEqual({ status: 'success', data: { ok: true } })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepImpl).toHaveBeenCalledTimes(1)
  })

  it('retries on 429', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    const result = await fetchJsonWithRetry('https://example.com/x', { fetchImpl, sleepImpl })

    expect(result.status).toBe('success')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries on a thrown network error and eventually fails after exhausting attempts', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    const result = await fetchJsonWithRetry('https://example.com/x', {
      fetchImpl,
      sleepImpl,
      maxAttempts: 3,
    })

    expect(result).toEqual({ status: 'failed', reason: 'network down', attempts: 3 })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleepImpl).toHaveBeenCalledTimes(2)
  })

  it('treats a 404 as legitimate no_data, never retries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    const result = await fetchJsonWithRetry('https://example.com/x', { fetchImpl, sleepImpl })

    expect(result).toEqual({ status: 'no_data', reason: 'HTTP 404' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleepImpl).not.toHaveBeenCalled()
  })

  it('treats a 401/403 as no_data rather than retrying forever', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403))

    const result = await fetchJsonWithRetry('https://example.com/x', { fetchImpl })

    expect(result).toEqual({ status: 'no_data', reason: 'HTTP 403' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reports a timeout (AbortError) as a retryable failure', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    const fetchImpl = vi.fn().mockRejectedValue(abortError)
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    const result = await fetchJsonWithRetry('https://example.com/x', {
      fetchImpl,
      sleepImpl,
      maxAttempts: 2,
    })

    expect(result).toEqual({ status: 'failed', reason: 'request timed out', attempts: 2 })
  })

  it('exhausts exactly maxAttempts on persistent 5xx failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    const result = await fetchJsonWithRetry('https://example.com/x', {
      fetchImpl,
      sleepImpl,
      maxAttempts: 3,
    })

    expect(result).toEqual({ status: 'failed', reason: 'HTTP 500', attempts: 3 })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
