// @vitest-environment jsdom
/**
 * sendChimmyMessage is the single client transport for BOTH live Chimmy surfaces. These prove the shared
 * envelope survives the API→client boundary: a supported-version meta is preserved and attached to the
 * result, an UNSUPPORTED-version meta fails safe (dropped → text-only), and legacy meta (no version) still
 * parses. Uses the real service with a mocked fetch (token preflight disabled, as the live callers do).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendChimmyMessage } from '@/lib/chimmy-chat/ChimmyChatService'

function mockJsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => payload,
    body: null,
  } as unknown as Response
}

describe('sendChimmyMessage — envelope preservation + version gate', () => {
  const origFetch = global.fetch
  afterEach(() => {
    global.fetch = origFetch
    vi.restoreAllMocks()
  })

  it('preserves a supported-version meta and attaches it to the result', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockJsonResponse({
        response: 'Start Player A.',
        sessionId: 's1',
        meta: { schemaVersion: '1', confidencePct: 70, responseStructure: { shortAnswer: 'Start Player A.' } },
      }),
    ) as unknown as typeof fetch

    const result = await sendChimmyMessage({ message: 'start A?', confirmTokenSpend: false })
    expect(result.ok).toBe(true)
    expect(result.response).toContain('Start Player A')
    expect(result.meta?.schemaVersion).toBe('1')
    expect(result.meta?.confidencePct).toBe(70)
    expect(result.meta?.responseStructure?.shortAnswer).toBe('Start Player A.')
  })

  it('fails safe (drops meta → text-only) when the schema version is unsupported', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockJsonResponse({ response: 'Some answer.', meta: { schemaVersion: '999', confidencePct: 99 } }),
    ) as unknown as typeof fetch

    const result = await sendChimmyMessage({ message: 'x', confirmTokenSpend: false })
    expect(result.ok).toBe(true)
    expect(result.response).toContain('Some answer')
    expect(result.meta).toBeUndefined()
  })

  it('parses legacy meta without a version (best-effort back-compat)', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockJsonResponse({ response: 'Legacy answer.', meta: { confidencePct: 55 } }),
    ) as unknown as typeof fetch

    const result = await sendChimmyMessage({ message: 'x', confirmTokenSpend: false })
    expect(result.meta?.confidencePct).toBe(55)
    expect(result.meta?.schemaVersion).toBeUndefined()
  })

  it('malformed (array) meta fails safe to no meta', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockJsonResponse({ response: 'Answer.', meta: ['not', 'an', 'object'] }),
    ) as unknown as typeof fetch

    const result = await sendChimmyMessage({ message: 'x', confirmTokenSpend: false })
    expect(result.response).toContain('Answer')
    expect(result.meta).toBeUndefined()
  })
})
