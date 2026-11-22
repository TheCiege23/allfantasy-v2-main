import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Decision OS hub, multi-model axis (owner's choice, 2026-11-21): a second, small model checks Chimmy's decision
 * answers against the facts Chimmy read; a contradiction sends the answer back to Chimmy once. Fails open always.
 */

vi.mock('server-only', () => ({}))
const sdk = vi.hoisted(() => ({ create: vi.fn(), ctor: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: sdk.create }
    constructor(opts: unknown) {
      sdk.ctor(opts)
    }
  },
}))
const spend = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/lib/ai/aiSpendGuard', () => ({ isAiSpendEnabled: () => spend.enabled }))

const {
  checkDecisionAnswer,
  shouldCheckDecisionAnswer,
  parseDecisionCheckVerdict,
  buildDecisionCheckPrompt,
  decisionCorrection,
  DECISION_CHECK_MAX_FACTS_CHARS,
  DECISION_CHECK_TIMEOUT_MS,
} = await import('@/lib/chimmy/decisionAnswerCheck')
const { callDecisionCheckModel } = await import('@/lib/chimmy/decisionAnswerCheckModel')

const FACTS = 'BENCH CHECK: start Rico Runner (14.2 proj) over Willy Wideout (9.1 proj).'
const base = { intent: 'start_sit', question: 'Who do I start?', answer: 'Start Willy Wideout — he projects 14.2.', facts: FACTS }
const deps = (over: Partial<Parameters<typeof checkDecisionAnswer>[1]> = {}) => ({
  check: vi.fn(async () => '{"ok":false,"contradictions":[{"claim":"Start Willy Wideout — he projects 14.2","fact":"start Rico Runner (14.2 proj) over Willy Wideout (9.1 proj)"}]}'),
  revise: vi.fn(async () => 'Start Rico Runner (14.2) over Willy Wideout (9.1).'),
  now: () => 0,
  ...over,
})

describe('which answers the second model reads', () => {
  it('decision turns only — trade, waiver, start/sit, draft — with an answer and facts; never chat; off switch', () => {
    for (const intent of ['trade', 'waiver', 'start_sit', 'draft']) expect(shouldCheckDecisionAnswer({ ...base, intent })).toBe(true)
    for (const intent of ['general', 'matchup', 'player_value', null]) expect(shouldCheckDecisionAnswer({ ...base, intent })).toBe(false)
    expect(shouldCheckDecisionAnswer({ ...base, facts: '  ' })).toBe(false)
    expect(shouldCheckDecisionAnswer({ ...base, answer: '' })).toBe(false)
    expect(shouldCheckDecisionAnswer({ ...base, env: 'off' })).toBe(false)
  })
})

describe('the verdict', () => {
  it('reads JSON, fenced or not; a "not ok" that names nothing is not a finding', () => {
    expect(parseDecisionCheckVerdict('{"ok":true}')).toEqual({ ok: true })
    expect(parseDecisionCheckVerdict('```json\n{"ok":false,"contradictions":[{"claim":"a","fact":"b"}]}\n```')).toEqual({
      ok: false,
      contradictions: [{ claim: 'a', fact: 'b' }],
    })
    expect(parseDecisionCheckVerdict('{"ok":false,"contradictions":[]}')).toBeNull()
    expect(parseDecisionCheckVerdict('{"ok":false,"contradictions":[{"claim":"a"}]}')).toBeNull()
    expect(parseDecisionCheckVerdict('looks fine to me')).toBeNull()
    expect(parseDecisionCheckVerdict(null)).toBeNull()
  })

  it('the prompt carries question, facts and answer, cuts long facts at the head, and tells it not to advise', () => {
    const p = buildDecisionCheckPrompt({ question: 'Q?', answer: 'A.', facts: 'x'.repeat(DECISION_CHECK_MAX_FACTS_CHARS + 50) })
    expect(p.system).toContain('You do not give advice')
    expect(p.system).toContain('A statement the facts do not mention is NOT a contradiction')
    expect(p.user).toMatch(/^QUESTION:\nQ\?\n\nFACTS:\n/)
    expect(p.user).toContain('[…facts cut here]')
    expect(p.user.endsWith('ANSWER:\nA.')).toBe(true)
  })
})

describe('checking an answer', () => {
  it('a contradiction goes back to Chimmy once, with what was contradicted, and the revision is what the user sees', async () => {
    const d = deps()
    const r = await checkDecisionAnswer(base, d)
    expect(r.outcome).toBe('revised')
    expect(r.text).toBe('Start Rico Runner (14.2) over Willy Wideout (9.1).')
    expect(d.check).toHaveBeenCalledWith(expect.objectContaining({ user: expect.stringContaining(FACTS) }), DECISION_CHECK_TIMEOUT_MS)
    expect(d.revise).toHaveBeenCalledTimes(1)
    expect(d.revise.mock.calls[0]![0]).toBe(decisionCorrection(r.contradictions))
    expect(d.revise.mock.calls[0]![0]).toContain('You said: "Start Willy Wideout — he projects 14.2"')
  })

  it('a clean answer is returned untouched and nothing is revised', async () => {
    const d = deps({ check: vi.fn(async () => '{"ok":true}') })
    expect(await checkDecisionAnswer(base, d)).toMatchObject({ outcome: 'clean', text: base.answer })
    expect(d.revise).not.toHaveBeenCalled()
  })

  it('🛑 fails open: an unreadable verdict, a thrown check, or a failed revision returns the answer as written', async () => {
    for (const check of [vi.fn(async () => 'nonsense'), vi.fn(async () => null), vi.fn(async () => { throw new Error('down') })]) {
      const d = deps({ check })
      expect(await checkDecisionAnswer(base, d)).toMatchObject({ outcome: 'unavailable', text: base.answer })
      expect(d.revise).not.toHaveBeenCalled()
    }
    for (const revise of [vi.fn(async () => null), vi.fn(async () => '  '), vi.fn(async () => { throw new Error('x') })]) {
      expect(await checkDecisionAnswer(base, deps({ revise }))).toMatchObject({ outcome: 'kept', text: base.answer })
    }
  })

  it('a chat turn, or the off switch, never calls the second model', async () => {
    const d = deps()
    expect((await checkDecisionAnswer({ ...base, intent: 'general' }, d)).outcome).toBe('skipped')
    expect((await checkDecisionAnswer({ ...base, env: 'OFF' }, d)).outcome).toBe('off')
    expect(d.check).not.toHaveBeenCalled()
  })
})

describe('the second model', () => {
  beforeEach(() => {
    sdk.create.mockReset()
    sdk.ctor.mockReset()
    spend.enabled = true
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
  })

  it('is the cheap profile, no retries, temperature 0, bounded by the timeout', async () => {
    sdk.create.mockResolvedValue({ content: [{ type: 'text', text: '{"ok":true}' }] })
    expect(await callDecisionCheckModel({ system: 'S', user: 'U' }, 4000)).toBe('{"ok":true}')
    expect(sdk.ctor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, timeout: 4000 }))
    expect(sdk.create).toHaveBeenCalledWith(expect.objectContaining({ model: expect.stringMatching(/haiku/), temperature: 0, system: 'S' }))
  })

  it('returns null — the check fails open — with AI spend off, no key, or an error', async () => {
    spend.enabled = false
    expect(await callDecisionCheckModel({ system: 'S', user: 'U' }, 4000)).toBeNull()
    spend.enabled = true
    delete process.env.ANTHROPIC_API_KEY
    expect(await callDecisionCheckModel({ system: 'S', user: 'U' }, 4000)).toBeNull()
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
    sdk.create.mockRejectedValue(new Error('timeout'))
    expect(await callDecisionCheckModel({ system: 'S', user: 'U' }, 4000)).toBeNull()
    expect(sdk.ctor).toHaveBeenCalledTimes(1)
  })
})

describe('the chat route', () => {
  it('checks the tool-loop answer BEFORE the trade-letter check, so the deterministic check holds the final answer', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/api/chat/chimmy/route.ts', 'utf8')
    // Anchored to code lines, not the comments that describe them.
    const check = src.search(/^\s*const checked = await checkDecisionAnswer\(/m)
    const letters = src.search(/^\s*const held = await enforceTradeLetters\(/m)
    expect(check).toBeGreaterThan(0)
    expect(letters).toBeGreaterThan(check)
    expect(src).toMatch(/^\s*intent: chimmyOrchestrationClassification\.intent,$/m)
  })
})
