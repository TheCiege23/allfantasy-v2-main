import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * AF Pro depth (lib/chimmy/chimmyDepth.ts, owner's decision 2026-11-16): a plan that includes Chimmy
 * buys a DEEPER answer, not only more of them. These pin the plan → depth mapping, that the free
 * tier is exactly what everyone had before, that the Pro tools are refused by the EXECUTOR for a free
 * user (not merely left off the model's list), and that past-chat recall reads only the caller's rows.
 */

const h = vi.hoisted(() => ({ outlook: vi.fn(), tradeIdeas: vi.fn(), history: vi.fn() }))

vi.mock('@/lib/chimmy/playoffOutlookGrounding', () => ({ buildPlayoffOutlookContext: h.outlook }))
vi.mock('@/lib/chimmy/tradeFinderGrounding', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chimmy/tradeFinderGrounding')>('@/lib/chimmy/tradeFinderGrounding')
  return { ...actual, buildTradeFinderContext: h.tradeIdeas }
})
vi.mock('@/lib/ai-memory/chat-history-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai-memory/chat-history-store')>('@/lib/ai-memory/chat-history-store')
  return { ...actual, getRecentChatHistory: h.history }
})

import {
  CHIMMY_DEPTH,
  FREE_PLAN_TOOL_NOTE,
  PRO_ONLY_CHIMMY_TOOLS,
  chimmyDepthForPlan,
  chimmyDepthPromptLine,
  isProOnlyChimmyTool,
  toolSpecsForDepth,
} from '@/lib/chimmy/chimmyDepth'
import { proUpsellLine, readAnswerPolish, readProUpsell } from '@/lib/chimmy/answerPolish'
import { CHIMMY_TOOL_SPECS, executeChimmyTool, type ChimmyToolContext } from '@/lib/chimmy/tools/chimmyTools'
import { matchPastChats, searchWords } from '@/lib/chimmy/tools/recallPastChats'

beforeEach(() => {
  vi.clearAllMocks()
  h.outlook.mockResolvedValue('OUTLOOK')
  h.tradeIdeas.mockResolvedValue('IDEAS')
  h.history.mockResolvedValue([])
})

describe('plan → depth', () => {
  it('is Pro only on a positive read of a plan that includes Chimmy', () => {
    expect(chimmyDepthForPlan(null).tier).toBe('free')
    expect(chimmyDepthForPlan(undefined).tier).toBe('free')
    expect(chimmyDepthForPlan({ kind: 'free' }).tier).toBe('free')
    expect(chimmyDepthForPlan({ kind: 'plan' }).tier).toBe('pro')
  })

  it('leaves the free tier exactly where every user was before: 4 turns, 1200 tokens, 6 / 8 turns of memory', () => {
    expect(CHIMMY_DEPTH.free).toEqual({ tier: 'free', maxToolTurns: 4, maxAnswerTokens: 1200, loopConversationTurns: 6, fallbackConversationTurns: 8 })
  })

  it('gives AF Pro more research, a longer answer and the whole conversation the server accepts', () => {
    expect(CHIMMY_DEPTH.pro.maxToolTurns).toBeGreaterThan(CHIMMY_DEPTH.free.maxToolTurns)
    expect(CHIMMY_DEPTH.pro.maxAnswerTokens).toBeGreaterThan(CHIMMY_DEPTH.free.maxAnswerTokens)
    // 20 = MAX_CONVERSATION_TURNS in app/api/chat/chimmy/route.ts; more would be dropped by the schema.
    expect(CHIMMY_DEPTH.pro.loopConversationTurns).toBe(20)
    expect(CHIMMY_DEPTH.pro.fallbackConversationTurns).toBe(20)
  })

  it('tells the model which plan it is answering for', () => {
    expect(chimmyDepthPromptLine(CHIMMY_DEPTH.pro)).toMatch(/^PLAN: this user has AF Pro/)
    expect(chimmyDepthPromptLine(CHIMMY_DEPTH.free)).toMatch(/^PLAN: this user is on the free plan/)
  })
})

describe('the Pro tool list', () => {
  const names = CHIMMY_TOOL_SPECS.map((s) => s.function.name) as string[]

  it('names only tools that exist, so the gate cannot silently miss one', () => {
    for (const n of PRO_ONLY_CHIMMY_TOOLS) expect(names).toContain(n)
  })

  /*
   * Kept in the free list on purpose, MARKED: the upgrade button rests on the executor refusing a
   * call, and a tool the model was never offered can never be refused.
   */
  it('is offered to a free user marked AF Pro only, and to a Pro user exactly as written', () => {
    const free = toolSpecsForDepth(CHIMMY_TOOL_SPECS, CHIMMY_DEPTH.free)
    const pro = toolSpecsForDepth(CHIMMY_TOOL_SPECS, CHIMMY_DEPTH.pro)
    expect(free.map((s) => s.function.name)).toEqual(names)
    expect(pro).toEqual([...CHIMMY_TOOL_SPECS])
    for (const s of free) {
      const original = CHIMMY_TOOL_SPECS.find((o) => o.function.name === s.function.name)!
      if (isProOnlyChimmyTool(s.function.name)) {
        expect(s.function.description).toBe(FREE_PLAN_TOOL_NOTE + original.function.description)
      } else {
        expect(s).toBe(original)
      }
    }
  })
})

describe('the upgrade button and the past-chats chip (wire)', () => {
  it('reads only known Pro tools, once each', () => {
    expect(readProUpsell(['get_playoff_outlook', 'get_playoff_outlook', 'get_league_standings', 7, 'find_trade_ideas'])).toEqual(['get_playoff_outlook', 'find_trade_ideas'])
    expect(readProUpsell('get_playoff_outlook')).toEqual([])
    expect(readProUpsell(undefined)).toEqual([])
  })

  it('says what AF Pro adds in one line', () => {
    expect(proUpsellLine(['get_playoff_outlook'])).toBe('AF Pro adds the playoff simulator.')
    expect(proUpsellLine(['get_playoff_outlook', 'find_trade_ideas', 'get_faab_bid_plan'])).toBe('AF Pro adds the playoff simulator, trade ideas and FAAB bid plans.')
  })

  it('rides on an answer\'s meta through the drawer\'s one reader', () => {
    expect(readAnswerPolish({ proUpsell: ['find_trade_ideas'], recalledPastChats: true })).toMatchObject({ proUpsell: ['find_trade_ideas'], recalledPastChats: true })
    expect(readAnswerPolish({ recalledPastChats: 'yes' })).toMatchObject({ proUpsell: [], recalledPastChats: false })
    expect(readAnswerPolish(null)).toMatchObject({ proUpsell: [], recalledPastChats: false })
  })
})

describe('🛑 the executor refuses Pro tools for a free user — whatever the model asked for', () => {
  it.each([...PRO_ONLY_CHIMMY_TOOLS])('%s runs nothing on the free plan, and records the refusal for the button', async (name) => {
    for (const depth of [undefined, 'free' as const]) {
      const ctx: ChimmyToolContext = { leagueId: 'L1', userId: 'u1', depth }
      const out = await executeChimmyTool(name, { query: 'Bijan' }, ctx)
      expect(out).toMatch(/^NOT RUN: .* is an AF Pro feature/)
      // The app says it once, under the answer; the model is told not to repeat it.
      expect(out).toMatch(/Do NOT mention AF Pro/)
      // The upgrade button rests on THIS, never on the model's wording.
      expect(ctx.proToolsRefused).toEqual([name])
    }
    expect(h.outlook).not.toHaveBeenCalled()
    expect(h.tradeIdeas).not.toHaveBeenCalled()
    expect(h.history).not.toHaveBeenCalled()
  })

  it('runs them for AF Pro, and records no refusal', async () => {
    const ctx: ChimmyToolContext = { leagueId: 'L1', userId: 'u1', depth: 'pro' }
    expect(await executeChimmyTool('get_playoff_outlook', {}, ctx)).toBe('OUTLOOK')
    expect(h.outlook).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1' })
    expect(ctx.proToolsRefused).toBeUndefined()
  })

  it('does not touch the free tools', async () => {
    expect(isProOnlyChimmyTool('get_league_standings')).toBe(false)
    expect(isProOnlyChimmyTool('get_my_matchup')).toBe(false)
  })
})

describe('recall_past_chats', () => {
  const day = (d: string) => new Date(`${d}T12:00:00Z`)

  it('reads only the signed-in user\'s own history and quotes it with dates', async () => {
    h.history.mockResolvedValue([
      { role: 'assistant', content: 'Hold Bijan Robinson; his schedule turns soft after week 10.', createdAt: day('2026-11-02') },
      { role: 'user', content: 'should I trade Bijan for two WRs?', createdAt: day('2026-11-01') },
      { role: 'user', content: 'who do I start at flex?', createdAt: day('2026-10-20') },
    ])
    const ctx: ChimmyToolContext = { leagueId: null, userId: 'u1', depth: 'pro' }
    const out = await executeChimmyTool('recall_past_chats', { query: 'what did you tell me about Bijan?' }, ctx)
    expect(ctx.recalledPastChats).toBe(true)
    expect(h.history).toHaveBeenCalledTimes(1)
    expect(h.history).toHaveBeenCalledWith({ userId: 'u1', limit: 400 })
    expect(out).toMatch(/^PAST CHATS/)
    expect(out).toContain('- 2026-11-02 · Chimmy said: Hold Bijan Robinson')
    expect(out).toContain('- 2026-11-01 · User asked: should I trade Bijan')
    expect(out).not.toContain('flex')
  })

  it('reads nothing without a verified user', async () => {
    const out = await executeChimmyTool('recall_past_chats', { query: 'Bijan' }, { leagueId: null, userId: null, depth: 'pro' })
    expect(out).toMatch(/No signed-in user/)
    expect(h.history).not.toHaveBeenCalled()
  })

  it('says plainly when nothing matches, rather than inventing a conversation', async () => {
    h.history.mockResolvedValue([{ role: 'user', content: 'who do I start at flex?', createdAt: day('2026-10-20') }])
    const ctx: ChimmyToolContext = { leagueId: null, userId: 'u1', depth: 'pro' }
    const out = await executeChimmyTool('recall_past_chats', { query: 'Bijan' }, ctx)
    // No chip on an answer that found nothing to recall.
    expect(ctx.recalledPastChats).toBeUndefined()
    expect(out).toMatch(/nothing in this user's last 1 Chimmy messages mentions "bijan"/)
    expect(out).toMatch(/do not invent one/)
  })

  it('does not read history for a query with no searchable words', async () => {
    const out = await executeChimmyTool('recall_past_chats', { query: 'what did you tell me?' }, { leagueId: null, userId: 'u1', depth: 'pro' })
    expect(out).toMatch(/No search words/)
    expect(h.history).not.toHaveBeenCalled()
  })

  it('ranks by how many words match, then newest, and drops stop words', () => {
    expect(searchWords('What did you tell me about the Bijan trade?')).toEqual(['bijan', 'trade'])
    const rows = [
      { role: 'user', content: 'Bijan is hurt', createdAt: day('2026-11-05') },
      { role: 'user', content: 'Bijan trade idea', createdAt: day('2026-11-01') },
      { role: 'user', content: 'Bijan again', createdAt: day('2026-11-06') },
    ]
    expect(matchPastChats(rows, 'Bijan trade', 5).map((r) => r.content)).toEqual(['Bijan trade idea', 'Bijan again', 'Bijan is hurt'])
    expect(matchPastChats(rows, 'Bijan trade', 1)).toHaveLength(1)
  })
})
