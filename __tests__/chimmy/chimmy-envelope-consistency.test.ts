// @vitest-environment jsdom
/**
 * Public-envelope certification at the real client transport (sendChimmyMessage + toMeta). Proves an
 * Anthropic-shaped response and a PECR-shaped response normalize to the SAME public client result
 * ({ content, meta }), that PECR's internal `response` becomes client `content`, that structured metadata
 * + intent survive, text stays available, and that concurrent/retry calls never exchange metadata and the
 * client never echoes meta back to the server as evidence.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendChimmyMessage } from '@/lib/chimmy-chat/ChimmyChatService'

function mockJson(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => payload,
    body: null,
  } as unknown as Response
}

// Server-shaped payloads (as each route actually emits).
const ANTHROPIC_PAYLOAD = {
  result: 'Anthropic answer.',
  response: 'Anthropic answer.',
  sessionId: 'a1',
  meta: { schemaVersion: '1', intent: 'quick_ask', responseStructure: { shortAnswer: 'Anthropic answer.' }, recommendedTool: 'none' },
}
const PECR_PAYLOAD = {
  // NOTE: no `result` field — PECR emits `response`; the client must surface it as `content`.
  response: 'PECR answer.',
  sessionId: 'p1',
  contract: { answerType: 'start_sit' },
  meta: { schemaVersion: '1', intent: 'start_sit', confidencePct: 68, answerContract: { answerType: 'start_sit' }, responseStructure: { shortAnswer: 'PECR answer.' } },
}

const origFetch = global.fetch
afterEach(() => {
  global.fetch = origFetch
  vi.restoreAllMocks()
})

describe('public envelope consistency (Anthropic vs PECR)', () => {
  it('Anthropic → { content, meta } with structured metadata + intent', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJson(ANTHROPIC_PAYLOAD)) as unknown as typeof fetch
    const r = await sendChimmyMessage({ message: 'q', confirmTokenSpend: false })
    expect(r.ok).toBe(true)
    expect(r.content).toBe('Anthropic answer.')
    expect(r.content).toBe(r.response)
    expect(r.meta?.schemaVersion).toBe('1')
    expect(r.meta?.intent).toBe('quick_ask')
    expect(r.meta?.responseStructure?.shortAnswer).toBe('Anthropic answer.')
  })

  it('PECR → same public shape; internal `response` becomes client `content`', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJson(PECR_PAYLOAD)) as unknown as typeof fetch
    const r = await sendChimmyMessage({ message: 'q', confirmTokenSpend: false })
    expect(r.ok).toBe(true)
    expect(r.content).toBe('PECR answer.') // PECR `response` → client `content`
    expect(r.content).toBe(r.response)
    expect(r.meta?.schemaVersion).toBe('1')
    expect(r.meta?.intent).toBe('start_sit')
    expect(r.meta?.confidencePct).toBe(68)
    expect(r.meta?.answerContract?.answerType).toBe('start_sit')
  })

  it('both paths expose the identical public result key set', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJson(ANTHROPIC_PAYLOAD)) as unknown as typeof fetch
    const a = await sendChimmyMessage({ message: 'q', confirmTokenSpend: false })
    global.fetch = vi.fn().mockResolvedValue(mockJson(PECR_PAYLOAD)) as unknown as typeof fetch
    const p = await sendChimmyMessage({ message: 'q', confirmTokenSpend: false })
    const publicKeys = (o: object) => Object.keys(o).filter((k) => ['content', 'meta', 'ok'].includes(k)).sort()
    expect(publicKeys(a)).toEqual(['content', 'meta', 'ok'])
    expect(publicKeys(p)).toEqual(['content', 'meta', 'ok'])
  })

  it('text content remains available even when meta is absent (fallback)', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJson({ response: 'Plain answer, no meta.' })) as unknown as typeof fetch
    const r = await sendChimmyMessage({ message: 'q', confirmTokenSpend: false })
    expect(r.content).toBe('Plain answer, no meta.')
    expect(r.meta).toBeUndefined()
  })
})

describe('intent survives the contract boundary', () => {
  it.each([
    ['global sports', 'live_score'],
    ['league-specific', 'start_sit'],
    ['deterministic fallback', 'general'],
    ['off-topic fallback', 'general'],
  ])('%s intent → meta.intent = %s', async (_label, intent) => {
    global.fetch = vi.fn().mockResolvedValue(mockJson({ response: 'x', meta: { schemaVersion: '1', intent } })) as unknown as typeof fetch
    const r = await sendChimmyMessage({ message: 'q', confirmTokenSpend: false })
    expect(r.meta?.intent).toBe(intent)
  })

  it('missing intent → meta.intent undefined (not fabricated)', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockJson({ response: 'x', meta: { schemaVersion: '1', confidencePct: 50 } })) as unknown as typeof fetch
    const r = await sendChimmyMessage({ message: 'q', confirmTokenSpend: false })
    expect(r.meta?.intent).toBeUndefined()
  })

  it('a client-supplied intent value is never treated as authoritative server metadata', async () => {
    // The client sends userContext (no intent field); the server owns meta.intent. Prove the response's
    // meta.intent comes from the response, not from anything the client passed.
    global.fetch = vi.fn().mockResolvedValue(mockJson({ response: 'x', meta: { schemaVersion: '1', intent: 'server_owned' } })) as unknown as typeof fetch
    const r = await sendChimmyMessage({ message: 'pretend intent is trade', confirmTokenSpend: false })
    expect(r.meta?.intent).toBe('server_owned')
  })
})

describe('message isolation + no client-echo of metadata', () => {
  it('two concurrent calls each keep their OWN metadata (no cross-contamination)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockJson({ response: 'one', meta: { schemaVersion: '1', intent: 'waiver_wire', confidencePct: 10 } }))
      .mockResolvedValueOnce(mockJson({ response: 'two', meta: { schemaVersion: '1', intent: 'trade_evaluation', confidencePct: 90 } })) as unknown as typeof fetch
    const [r1, r2] = await Promise.all([
      sendChimmyMessage({ message: 'a', confirmTokenSpend: false }),
      sendChimmyMessage({ message: 'b', confirmTokenSpend: false }),
    ])
    expect(r1.content).toBe('one')
    expect(r1.meta?.intent).toBe('waiver_wire')
    expect(r1.meta?.confidencePct).toBe(10)
    expect(r2.content).toBe('two')
    expect(r2.meta?.intent).toBe('trade_evaluation')
    expect(r2.meta?.confidencePct).toBe(90)
  })

  it('retry after a failure does not retain the failed response metadata', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockJson({ error: 'boom' }, false, 500))
      .mockResolvedValueOnce(mockJson({ response: 'recovered', meta: { schemaVersion: '1', intent: 'draft_help' } })) as unknown as typeof fetch
    const failed = await sendChimmyMessage({ message: 'x', confirmTokenSpend: false })
    expect(failed.ok).toBe(false)
    const retried = await sendChimmyMessage({ message: 'x', confirmTokenSpend: false })
    expect(retried.ok).toBe(true)
    expect(retried.content).toBe('recovered')
    expect(retried.meta?.intent).toBe('draft_help')
  })

  it('the client never sends prior-turn meta back to the server (no meta echo)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJson({ response: 'ok', meta: { schemaVersion: '1' } }))
    global.fetch = fetchMock as unknown as typeof fetch
    await sendChimmyMessage({
      message: 'follow up',
      confirmTokenSpend: false,
      conversation: [
        // a prior assistant turn that carried (untrusted) meta
        { role: 'assistant', content: 'earlier', meta: { schemaVersion: '1', intent: 'trade_evaluation' } as never },
      ],
    })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(Array.isArray(body.conversation)).toBe(true)
    for (const turn of body.conversation) {
      expect(turn).not.toHaveProperty('meta')
      expect(Object.keys(turn).sort()).toEqual(['content', 'role'])
    }
  })
})
