import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ record: vi.fn() }))
vi.mock('@/lib/chimmy-context/telemetry/recordRun', () => ({ recordChimmyContextRun: h.record }))

import {
  newQuestionTelemetry,
  questionEntry,
  questionOutcome,
  recordChimmyQuestion,
} from '@/lib/chimmy-context/telemetry/chatQuestion'

/**
 * One row per question to /api/chat/chimmy: where it was asked, what tools answered it, and whether
 * it was answered at all. The outcome is read off the response the user actually got.
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  h.record.mockReset()
  h.record.mockResolvedValue(undefined)
})

describe('where it was asked', () => {
  it('names the /core screen for the drawer, else the caller’s source', () => {
    expect(questionEntry({ coreSurface: 'waivers', source: 'ignored' })).toBe('drawer:waivers')
    expect(questionEntry({ source: 'messages_ai' })).toBe('messages_ai')
    expect(questionEntry({ source: '  ', coreSurface: ' ' })).toBe('unknown')
    expect(questionEntry({})).toBe('unknown')
    expect(questionEntry({ source: 'x'.repeat(100) })).toHaveLength(48)
  })
})

describe('whether it was answered', () => {
  it('reads the outcome off the status and, where it matters, the body', () => {
    expect(questionOutcome(200, { upgradeRequired: false })).toBe('answered')
    expect(questionOutcome(200, null)).toBe('answered')
    expect(questionOutcome(200, { upgradeRequired: true })).toBe('upgrade_required')
    expect(questionOutcome(402, null)).toBe('out_of_answers')
    // The price preflight: shown a price is not a refusal; cannot pay at all is.
    expect(questionOutcome(409, { preview: { canSpend: true } })).toBe('price_shown')
    expect(questionOutcome(409, { preview: { canSpend: false } })).toBe('out_of_answers')
    expect(questionOutcome(409, null)).toBe('price_shown')
    expect(questionOutcome(412, null)).toBe('needs_league')
    expect(questionOutcome(429, null)).toBe('rate_limited')
    expect(questionOutcome(400, null)).toBe('bad_request')
    expect(questionOutcome(403, null)).toBe('forbidden')
    expect(questionOutcome(503, null)).toBe('error')
    expect(questionOutcome(404, null)).toBe('http_404')
  })
})

describe('the row', () => {
  it('records an answered question with its screen, league, tools and no error', async () => {
    const q = { ...newQuestionTelemetry(), userId: 'u1', leagueId: 'L1', entry: 'drawer:waivers', tools: ['get_waivers', 'compare_players'] }
    await recordChimmyQuestion(q, json(200, { response: 'Start him.' }), 1234)
    expect(h.record).toHaveBeenCalledTimes(1)
    expect(h.record.mock.calls[0]![0]).toEqual({
      userId: 'u1',
      surface: 'chimmy_chat',
      leagueId: 'L1',
      intent: 'drawer:waivers',
      durationMs: 1234,
      providers: [
        { name: 'get_waivers', ok: true, cached: false, durationMs: 0 },
        { name: 'compare_players', ok: true, cached: false, durationMs: 0 },
      ],
      errorMessage: null,
    })
  })

  it('🛑 never writes the question or the answer', async () => {
    const q = { ...newQuestionTelemetry(), userId: 'u1', entry: 'messages_ai' }
    await recordChimmyQuestion(q, json(200, { response: 'SECRET ANSWER TEXT' }), 5)
    expect(JSON.stringify(h.record.mock.calls[0]![0])).not.toContain('SECRET ANSWER TEXT')
  })

  it('records a refusal by its outcome, and leaves the response readable for the user', async () => {
    const q = { ...newQuestionTelemetry(), userId: 'u1', entry: 'messages_ai' }
    const res = json(409, { code: 'token_confirmation_required', preview: { canSpend: false } })
    await recordChimmyQuestion(q, res, 5)
    expect(h.record.mock.calls[0]![0]).toMatchObject({ errorMessage: 'out_of_answers', intent: 'messages_ai' })
    // Read from a clone, so the body the user is sent is still there.
    await expect(res.json()).resolves.toMatchObject({ code: 'token_confirmation_required' })
  })

  it('writes nothing for a request with no signed-in user', async () => {
    await recordChimmyQuestion(newQuestionTelemetry(), json(401, { error: 'Unauthorized' }), 5)
    expect(h.record).not.toHaveBeenCalled()
  })

  it('does not read a body it does not need', async () => {
    const res = json(500, { error: 'boom' })
    const clone = vi.spyOn(res, 'clone')
    await recordChimmyQuestion({ ...newQuestionTelemetry(), userId: 'u1' }, res, 5)
    expect(clone).not.toHaveBeenCalled()
    expect(h.record.mock.calls[0]![0]).toMatchObject({ errorMessage: 'error', intent: 'unknown' })
  })

  it('never throws — a lost row, never a lost answer', async () => {
    h.record.mockRejectedValue(new Error('db down'))
    await expect(recordChimmyQuestion({ ...newQuestionTelemetry(), userId: 'u1' }, json(200, {}), 5)).resolves.toBeUndefined()
  })
})
