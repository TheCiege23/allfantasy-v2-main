import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  openaiChatText: vi.fn(),
  loadLeagueGroundingForUser: vi.fn(),
  buildLeagueStandingsContext: vi.fn(),
  buildHeadToHeadGrounding: vi.fn(),
  prepareChimmyDecisionAnswer: vi.fn(),
  recordChatStartSitAdvice: vi.fn(),
  readPlan: vi.fn(),
  takePlan: vi.fn(),
  releasePlan: vi.fn(),
  runLoop: vi.fn(),
}))

/* Default: no plan includes Chimmy, so every existing case below takes the quick, grounded path. */
vi.mock('@/lib/chimmy/planAllowance', () => ({
  readChimmyPlanAllowance: h.readPlan,
  takeChimmyPlanAllowance: h.takePlan,
  releaseChimmyPlanAllowance: h.releasePlan,
}))
vi.mock('@/lib/chimmy/tools/chimmyToolLoop', () => ({ runChimmyToolLoop: h.runLoop }))

vi.mock('@/lib/openai-client', () => ({ openaiChatText: h.openaiChatText }))
vi.mock('@/lib/chimmy/decisionAnswerService', () => ({ prepareChimmyDecisionAnswer: h.prepareChimmyDecisionAnswer }))
vi.mock('@/lib/chimmy-advice/chatStartSitAdvice', () => ({ recordChatStartSitAdvice: h.recordChatStartSitAdvice }))
vi.mock('@/lib/chimmy/chimmy-league-snapshot', () => ({
  loadLeagueGroundingForUser: h.loadLeagueGroundingForUser,
}))
vi.mock('@/lib/chimmy/leagueStandingsGrounding', () => ({
  buildLeagueStandingsContext: h.buildLeagueStandingsContext,
}))
vi.mock('@/lib/chimmy/headToHeadGrounding', () => ({
  buildHeadToHeadGrounding: h.buildHeadToHeadGrounding,
}))
vi.mock('@/lib/chat-core/mentionPrivacyFilter', () => ({
  stripChimmyMentionPrefix: (s: string) => s.replace(/^@chimmy\s*/i, ''),
}))

import { generateChimmyPrivateReply } from '@/lib/chat-core/chimmyPrivateReply'

/** The system prompt the model was actually handed. */
function systemPrompt() {
  return h.openaiChatText.mock.calls[0][0].messages[0].content as string
}

beforeEach(() => {
  vi.clearAllMocks()
  h.prepareChimmyDecisionAnswer.mockResolvedValue(null)
  h.recordChatStartSitAdvice.mockResolvedValue(null)
  h.openaiChatText.mockResolvedValue({ ok: true, text: 'Start Kelce.' })
  h.loadLeagueGroundingForUser.mockResolvedValue({ ok: true, snapshot: { id: 'l1' } })
  h.buildLeagueStandingsContext.mockResolvedValue('STANDINGS: Casey 5-1')
  h.buildHeadToHeadGrounding.mockResolvedValue({ text: 'H2H: Casey 3-1 vs Jordan', managers: 2, source: 'sleeper' })
  h.readPlan.mockResolvedValue(null)
  h.takePlan.mockImplementation(async ({ state }: { state: unknown }) => state)
  h.releasePlan.mockResolvedValue(true)
  h.runLoop.mockResolvedValue({ text: 'From the tool loop.', toolsUsed: ['get_my_roster'], turns: 2 })
})

const PLAN = { planName: 'AF Pro', limit: 100, used: 3, remaining: 97, resetsAt: '2026-10-12T00:00:00.000Z' }

describe('🛑 @chimmy in a chat runs the SAME assistant as the panel for a plan holder', () => {
  it('a member with allowance left gets the tool loop, the shared prompt, and the proven league', async () => {
    h.readPlan.mockResolvedValue(PLAN)
    const { CHIMMY_TOOL_LOOP_SYSTEM_PROMPT } = await import('@/lib/chimmy/tools/toolLoopSystemPrompt')
    const out = await generateChimmyPrivateReply('@chimmy how is my team looking?', { leagueId: 'l1', userId: 'u1' })
    expect(out).toBe('From the tool loop.')
    const args = h.runLoop.mock.calls[0][0]
    expect(args.systemPrompt).toBe(CHIMMY_TOOL_LOOP_SYSTEM_PROMPT)
    expect(args.context.leagueId).toBe('l1')
    expect(args.context.userId).toBe('u1')
    // A chat bubble cannot show a confirm card: no collector, so the propose tools refuse in words.
    expect(args.context.actionCards).toBeUndefined()
    expect(args.styleLine).toMatch(/seen only by the person who asked/)
    expect(args.budgetMs).toBeLessThan(75_000)
    expect(h.takePlan).toHaveBeenCalledTimes(1)
    expect(h.openaiChatText).not.toHaveBeenCalled()
  })

  it('🛑 a league the asker is NOT a member of is never handed to the tools', async () => {
    h.readPlan.mockResolvedValue(PLAN)
    h.loadLeagueGroundingForUser.mockResolvedValue({ ok: false, reason: 'not_member' })
    await generateChimmyPrivateReply('@chimmy who leads this league?', { leagueId: 'someone-elses', userId: 'u1' })
    expect(h.runLoop.mock.calls[0][0].context.leagueId).toBeNull()
  })

  it('no answer from the loop: the included answer goes BACK, and the quick answer is given', async () => {
    h.readPlan.mockResolvedValue(PLAN)
    h.runLoop.mockResolvedValue(null)
    const out = await generateChimmyPrivateReply('@chimmy hi', { leagueId: 'l1', userId: 'u1' })
    expect(h.releasePlan).toHaveBeenCalledTimes(1)
    expect(out).toBe('Start Kelce.')
  })

  it('allowance used up (or no plan): no tool loop, the quick grounded answer as before', async () => {
    h.readPlan.mockResolvedValue({ ...PLAN, used: 100, remaining: 0 })
    await generateChimmyPrivateReply('@chimmy hi', { leagueId: 'l1', userId: 'u1' })
    expect(h.runLoop).not.toHaveBeenCalled()
    expect(h.takePlan).not.toHaveBeenCalled()
    expect(h.openaiChatText).toHaveBeenCalledTimes(1)
  })
})

describe('🛑 the quick answer is no longer an uncapped model call', () => {
  it('allows FALLBACK_REPLIES_PER_HOUR an hour per person, then says so instead of calling the model', async () => {
    const { FALLBACK_REPLIES_PER_HOUR } = await import('@/lib/chat-core/chimmyPrivateReply')
    const user = `rate-${Math.random().toString(36).slice(2)}`
    for (let i = 0; i < FALLBACK_REPLIES_PER_HOUR; i++) await generateChimmyPrivateReply('@chimmy hi', { userId: user })
    const calls = h.openaiChatText.mock.calls.length
    const out = await generateChimmyPrivateReply('@chimmy hi', { userId: user })
    expect(out).toMatch(/asked @chimmy a lot this hour/)
    expect(h.openaiChatText.mock.calls.length).toBe(calls)
  })
})

describe('generateChimmyPrivateReply grounding', () => {
  it.each(['ready', 'needs_data'])('returns the shared %s decision without a model rewriting it', async status => {
    h.prepareChimmyDecisionAnswer.mockResolvedValue({ status, answer: 'Engine answer or actionable gap.' })
    expect(await generateChimmyPrivateReply('@chimmy should I trade Chase for Jefferson?', { leagueId: 'l1', userId: 'u1' })).toBe('Engine answer or actionable gap.')
    expect(h.prepareChimmyDecisionAnswer).toHaveBeenCalledWith({ question: 'should I trade Chase for Jefferson?', leagueId: 'l1', userId: 'u1' })
    expect(h.openaiChatText).not.toHaveBeenCalled()
    expect(h.buildLeagueStandingsContext).not.toHaveBeenCalled()
  })
  it('reports the same decision evidence for storage on a private reply', async () => {
    const decision = { status: 'needs_data', answer: 'Select a league.', leagueId: null }
    h.prepareChimmyDecisionAnswer.mockResolvedValue(decision)
    const onDecision = vi.fn()
    await generateChimmyPrivateReply('@chimmy who should I start?', { userId: 'u1', onDecision })
    expect(onDecision).toHaveBeenCalledWith(decision)
    expect(h.openaiChatText).not.toHaveBeenCalled()
  })
  it('records a delivered engine start call for the same signed-in user', async () => {
    const calls = [{ leagueId: 'l1', rec: { key: 'a', name: 'Chase' } }]
    h.prepareChimmyDecisionAnswer.mockResolvedValue({ status: 'ready', answer: 'Start Chase.', startCalls: calls })
    await generateChimmyPrivateReply('@chimmy who should I start?', { leagueId: 'l1', userId: 'u1' })
    expect(h.recordChatStartSitAdvice).toHaveBeenCalledWith({ userId: 'u1', calls, answer: 'Start Chase.' })
  })
  /*
   * The leagueId argument was named `_leagueId` and never read, so this ran
   * against a model told "never invent league stats" and given no league.
   */
  it('hands the model the league facts it is answering about', async () => {
    await generateChimmyPrivateReply('@chimmy who do I start?', { leagueId: 'l1', userId: 'u1' })

    expect(systemPrompt()).toContain('STANDINGS: Casey 5-1')
    expect(systemPrompt()).toContain('H2H: Casey 3-1 vs Jordan')
  })

  /*
   * A model that does not know it is missing the data is the one that fills the
   * gap in confidently.
   */
  it('says there is no league when there is no league', async () => {
    await generateChimmyPrivateReply('@chimmy hi', {})

    expect(systemPrompt()).toMatch(/not attached to a league/i)
    expect(h.buildLeagueStandingsContext).not.toHaveBeenCalled()
  })

  /* Grounding a league somebody is not in would leak another league's data. */
  it('refuses to ground a league the asker is not a member of', async () => {
    h.loadLeagueGroundingForUser.mockResolvedValue({ ok: false, reason: 'not_member' })

    await generateChimmyPrivateReply('@chimmy standings?', { leagueId: 'l1', userId: 'u1' })

    expect(systemPrompt()).toContain('not_member')
    expect(systemPrompt()).toMatch(/could not read them/i)
    expect(h.buildLeagueStandingsContext).not.toHaveBeenCalled()
  })

  /*
   * The loader is `(userId, leagueId)`. This file's default mock admits ANY arguments, so a swapped
   * call passed every test here while the real membership check refused every member (2026-08-26 to
   * 2026-09-28). This mock admits only the real member, the way `resolveLeagueMembership` does.
   */
  it('checks membership as (userId, leagueId), the loader\'s real argument order', async () => {
    h.loadLeagueGroundingForUser.mockImplementation(async (userId: string, leagueId: string) =>
      userId === 'u1' && leagueId === 'l1' ? { ok: true, snapshot: { id: 'l1' } } : { ok: false, reason: 'not_member' })

    await generateChimmyPrivateReply('@chimmy standings?', { leagueId: 'l1', userId: 'u1' })

    expect(h.loadLeagueGroundingForUser).toHaveBeenCalledWith('u1', 'l1')
    expect(systemPrompt()).toContain('STANDINGS: Casey 5-1')
  })

  it('treats a thrown access check as no access', async () => {
    h.loadLeagueGroundingForUser.mockRejectedValue(new Error('db down'))

    await generateChimmyPrivateReply('@chimmy standings?', { leagueId: 'l1', userId: 'u1' })

    expect(systemPrompt()).toMatch(/could not be loaded/i)
    expect(h.buildLeagueStandingsContext).not.toHaveBeenCalled()
  })

  it('still answers when only some grounding is available', async () => {
    h.buildHeadToHeadGrounding.mockResolvedValue(null)

    await generateChimmyPrivateReply('@chimmy who do I start?', { leagueId: 'l1', userId: 'u1' })

    expect(systemPrompt()).toContain('STANDINGS: Casey 5-1')
  })

  it('says a real league has nothing stored rather than staying silent', async () => {
    h.buildLeagueStandingsContext.mockResolvedValue(null)
    h.buildHeadToHeadGrounding.mockResolvedValue(null)

    await generateChimmyPrivateReply('@chimmy who do I start?', { leagueId: 'l1', userId: 'u1' })

    expect(systemPrompt()).toMatch(/no standings or matchup history/i)
    expect(systemPrompt()).toMatch(/Do not invent/i)
  })

  it('survives a grounding builder throwing', async () => {
    h.buildLeagueStandingsContext.mockRejectedValue(new Error('boom'))

    const out = await generateChimmyPrivateReply('@chimmy hi', { leagueId: 'l1', userId: 'u1' })

    expect(out).toBe('Start Kelce.')
  })

  it('asks for a question when given only the mention', async () => {
    const out = await generateChimmyPrivateReply('@chimmy', { leagueId: 'l1', userId: 'u1' })

    expect(out).toMatch(/what would you like help with/i)
    expect(h.openaiChatText).not.toHaveBeenCalled()
  })

  it('degrades to a plain message when the model is unreachable', async () => {
    h.openaiChatText.mockResolvedValue({ ok: false, text: '' })

    const out = await generateChimmyPrivateReply('@chimmy hi', { leagueId: 'l1', userId: 'u1' })

    expect(out).toMatch(/trouble reaching the AI/i)
  })
})
