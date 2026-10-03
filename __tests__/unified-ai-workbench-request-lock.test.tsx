/**
 * Regression for the e2e `ai-reliability-click-audit` mobile step (ledger #1771).
 *
 * `runRequest` guards against duplicate submits with an in-flight ref plus a
 * 120 ms lock measured from the request START. The guard used to be released by
 * a timer scheduled in `finally`, AFTER `setLoading(false)` had already
 * re-enabled the Run and Retry buttons. A fast response therefore left a window
 * (up to 120 ms) in which the buttons looked live and every click was silently
 * dropped: no request, no loading state, no error.
 *
 * The invariant: once a request has completed, the next click starts a request,
 * however little wall-clock time has passed. `Date` is frozen so "no time has
 * passed" is exact rather than a race against jsdom's render speed; nothing in
 * the component depends on the clock advancing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import UnifiedAIWorkbench from '@/components/ai-hub/UnifiedAIWorkbench'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function runPayload(n: number) {
  return {
    evidence: [`Evidence ${n}`],
    aiExplanation: `Output ${n}.`,
    actionPlan: null,
    confidence: 60,
    confidenceLabel: 'medium',
    providerResults: [{ provider: 'openai', raw: `Output ${n}.` }],
    usedDeterministicFallback: false,
    reliability: { usedDeterministicFallback: false, confidence: 60, providerStatus: [{ provider: 'openai', status: 'ok' }] },
    factGuardWarnings: [],
  }
}

describe('UnifiedAIWorkbench — a click after a completed request is not dropped', () => {
  const runCalls: string[] = []

  beforeEach(() => {
    runCalls.length = 0
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/ai/providers/status')) {
          return jsonResponse({ openai: true, deepseek: true, grok: true, openclaw: true, openclawGrowth: true })
        }
        if (url.includes('/api/ai/run')) {
          runCalls.push(url)
          return jsonResponse(runPayload(runCalls.length))
        }
        return jsonResponse({})
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts a second request when Run is clicked as soon as the first result has rendered', async () => {
    render(<UnifiedAIWorkbench />)
    fireEvent.change(screen.getByTestId('unified-ai-prompt-input'), { target: { value: 'probe' } })
    const run = screen.getByTestId('unified-ai-run-button') as HTMLButtonElement

    await act(async () => {
      fireEvent.click(run)
    })
    await screen.findByTestId('unified-ai-result-panel')
    expect(runCalls).toHaveLength(1)
    // Positive control for the invariant: the button is presented as clickable.
    expect(run.disabled).toBe(false)

    await act(async () => {
      fireEvent.click(run)
    })
    await waitFor(() => expect(runCalls).toHaveLength(2), { timeout: 1_000 })
    // The answer renders in more than one node (verdict card and explanation).
    expect((await screen.findAllByText('Output 2.')).length).toBeGreaterThan(0)
  })
})
