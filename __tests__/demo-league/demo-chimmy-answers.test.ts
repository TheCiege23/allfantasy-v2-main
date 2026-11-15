// @vitest-environment node
/**
 * DEMO CHIMMY — "explain why on the first answer" and "don't say unavailable when a retry works".
 *
 * Tester report, 2026-11-15: "Who's the best team in the league and why?" got only a team name; the
 * breakdown (the standings leader was not the top scorer) came only after a follow-up. Separately,
 * "Chimmy is unavailable" appeared and answers were cut off.
 *
 * No real model is called here. These pin what the model is GIVEN (the facts and the rules) and
 * what the route does with what comes BACK (retries, cut-offs, the error copy). The live check that
 * a real model's first reply carries reasoning is `demo-chimmy-live-eval.test.ts`, opt-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVALUATIVE_QUESTIONS, demoChimmyFixtureView, firstReplyHasReasoning } from './fixtures/demoChimmyLeague'

type RouterArgs = { messages: Array<{ role: string; content: string }>; maxTokens?: number; skipCache?: boolean; timeoutMs?: number }
const routeTextCall = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ai/providerRouter', () => ({ routeTextCall }))
// The brief's lineup-value line reads the market chart; the tests inject values instead.
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: vi.fn(async () => []) }))

const view = demoChimmyFixtureView()
vi.mock('@/lib/demo-league/service', () => ({
  getDemoContext: vi.fn(async () => ({ view, neutralRedactor: { scrubString: (s: string) => s } })),
  demoJsonBody: (_ctx: unknown, body: unknown) => ({ ok: true, text: JSON.stringify(body) }),
}))

const ok = (text: string, extra: Record<string, unknown> = {}) => ({ ok: true, text, model: 'm', provider: 'deepseek', tokensUsed: 1, ...extra })
const fail = (retryable: boolean) => ({ ok: false, failure: { attempts: [{ provider: 'deepseek', category: retryable ? 'rate_limit' : 'auth', status: retryable ? 429 : 401 }], retryable } })

/** What the tester got (before) and what the new rules ask for (after), for the reply checker's controls. */
const BEFORE_ANSWER = 'Gridiron Gremlins.'
const AFTER_ANSWER = [
  "Gridiron Gremlins have the best record at 5-1, but Turbo Tacos are the best team on the field.",
  '- Turbo Tacos lead the league in scoring with 791 points for; the Gremlins are only 4th (679).',
  '- Turbo Tacos have faced the most points against, which explains their 3-3 record.',
  '- The Gremlins have the luckiest schedule: their all-play record is far worse than 5-1.',
  'Surprise: the standings leader is not the top scorer.',
].join('\n')

let ipCounter = 0
function post(body: unknown) {
  ipCounter += 1
  return new Request('http://localhost/api/demo/chimmy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${ipCounter}` },
    body: JSON.stringify(body),
  })
}

const logged: string[] = []
beforeEach(() => {
  routeTextCall.mockReset()
  logged.length = 0
  for (const m of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    })
  }
})
afterEach(() => vi.restoreAllMocks())

describe('the league brief hands the model the facts behind "who is best and why"', () => {
  it('computes PF/PA ranks, all-play record, schedule luck and recent form', async () => {
    const { computeDemoTeamFacts } = await import('@/lib/demo-league/chimmy')
    const facts = computeDemoTeamFacts(view)
    const gremlins = facts.find((f) => f.slot === 1)!
    const tacos = facts.find((f) => f.slot === 3)!
    expect(gremlins).toMatchObject({ rank: 1, wins: 5, losses: 1, pfRank: 4 })
    expect(tacos).toMatchObject({ pfRank: 1, pointsFor: 791 })
    // 6 weeks x 5 opponents = 30 all-play games each.
    expect(gremlins.allPlayWins + gremlins.allPlayLosses + gremlins.allPlayTies).toBe(30)
    expect(gremlins.luck!).toBeGreaterThan(1) // 5-1 on a 4th-best offence: a lucky schedule
    expect(tacos.luck!).toBeLessThan(0)
    expect(facts.find((f) => f.slot === 4)!.trend).toBe('up') // 120, 133, 141 against a 123.5 season
  })

  it('states the surprise outright: the standings leader is NOT the top scorer', async () => {
    const { buildDemoLeagueBrief } = await import('@/lib/demo-league/chimmy')
    const brief = buildDemoLeagueBrief(view)
    expect(brief).toContain('SURPRISE: the standings leader is NOT the top-scoring team — Gridiron Gremlins is #4 in points for.')
    expect(brief).toContain('Most points scored: Turbo Tacos (791 PF)')
    expect(brief).toMatch(/Best all-play record .*: Turbo Tacos/)
    expect(brief).toMatch(/Luckiest schedule: Gridiron Gremlins/)
    expect(brief).toMatch(/Hottest last 3 weeks: Turbo Tacos \(avg 132\.3\)/)
    // 125, 130, 119 against a 114.2 season (+10.5) beats Blitz Brigade's 131.3 against 123.5 (+7.8).
    expect(brief).toContain('Biggest climb: Waiver Wizards (last 3 avg 124.7 vs 114.2 for the season).')
    expect(brief).toMatch(/1\. Gridiron Gremlins \(manager Alex Rivers\) — 5-1, PF 679 \(#4\), PA \d+ \(#\d\), avg 113\.2\/wk/)
  })

  it('adds starting-lineup strength when market values are available, and leaves it out when not', async () => {
    const { buildDemoLeagueBrief } = await import('@/lib/demo-league/chimmy')
    const values = new Map([[1, 30000], [2, 25000], [3, 41000], [4, 38000], [5, 20000], [6, 15000]])
    expect(buildDemoLeagueBrief(view, values)).toContain('Strongest starting lineup by market value: Turbo Tacos.')
    expect(buildDemoLeagueBrief(view, null)).not.toContain('market value')
  })

  it('a league with no completed weeks says nothing about form or luck rather than inventing it', async () => {
    const { buildDemoLeagueBrief } = await import('@/lib/demo-league/chimmy')
    const brief = buildDemoLeagueBrief({ ...view, weeklyScores: [] })
    expect(brief).not.toMatch(/all-play|schedule luck|Hottest/)
    expect(brief).toContain('SURPRISE') // still derivable from PF alone
  })
})

describe('the answer rules: lead with the answer, then the reasoning, in the FIRST reply', () => {
  it('the system prompt requires reasoning for evaluative questions and forbids a bare name', async () => {
    const { DEMO_CHIMMY_SYSTEM } = await import('@/lib/demo-league/chimmy')
    expect(DEMO_CHIMMY_SYSTEM).toContain('Lead with the answer in ONE sentence.')
    expect(DEMO_CHIMMY_SYSTEM).toContain('ALWAYS include the reasoning in this same first reply. Never answer with only a name.')
    expect(DEMO_CHIMMY_SYSTEM).toContain('2 to 4 short bullets')
    expect(DEMO_CHIMMY_SYSTEM).toMatch(/standings leader is not the top scorer/)
    expect(DEMO_CHIMMY_SYSTEM).toMatch(/no filler/)
  })

  it.each(EVALUATIVE_QUESTIONS)('"%s" — the model gets the rules, the key facts and room to explain', async (question) => {
    routeTextCall.mockResolvedValue(ok(AFTER_ANSWER))
    const { askDemoChimmy } = await import('@/lib/demo-league/chimmy')
    const out = await askDemoChimmy(view, question, { starterValues: null })
    expect(out).toEqual({ ok: true, answer: AFTER_ANSWER, truncated: false })
    const args = routeTextCall.mock.calls[0]![0] as RouterArgs
    const system = args.messages[0]!.content
    const user = args.messages[1]!.content
    expect(system).toContain('Never answer with only a name')
    expect(system).toContain('KEY FACTS')
    expect(system).toContain('SURPRISE: the standings leader is NOT the top-scoring team')
    expect(user).toBe(`CURRENT QUESTION: ${question}`)
    // 400 tokens on a reasoning-capable cheap model is what produced terse and cut-off answers.
    expect(args.maxTokens).toBeGreaterThanOrEqual(900)
    expect(args.skipCache).toBe(true)
  })

  it('the reply checker is a real check: the tester\'s bare-name reply fails it, a reasoned reply passes', () => {
    expect(firstReplyHasReasoning(BEFORE_ANSWER, view).ok).toBe(false)
    expect(firstReplyHasReasoning('Gridiron Gremlins are the best team because they have been great all year and keep winning games week after week, which is what matters in the end for this league.', view).ok).toBe(false)
    expect(firstReplyHasReasoning(AFTER_ANSWER, view)).toMatchObject({ ok: true })
  })
})

describe('follow-ups and "continue"', () => {
  it('a follow-up carries the earlier exchange, so "why?" has something to refer to', async () => {
    const { buildDemoChimmyUserMessage } = await import('@/lib/demo-league/chimmy')
    const msg = buildDemoChimmyUserMessage('why?', { history: [{ q: 'Who is the best team?', a: 'Gridiron Gremlins.' }] })
    expect(msg).toContain('EARLIER IN THIS CONVERSATION')
    expect(msg).toContain('Q: Who is the best team?\nA: Gridiron Gremlins.')
    expect(msg.endsWith('CURRENT QUESTION: why?')).toBe(true)
  })

  it('continuing a cut-off answer sends what was already said and asks for the rest only', async () => {
    const { buildDemoChimmyUserMessage } = await import('@/lib/demo-league/chimmy')
    const msg = buildDemoChimmyUserMessage('Who is the best team?', { continueFrom: 'Turbo Tacos lead in scoring with' })
    expect(msg).toContain('"""Turbo Tacos lead in scoring with"""')
    expect(msg).toContain('Do not repeat anything already written')
  })
})

describe('reliability: retry, then a friendly error with a retry flag — never a silent cut-off', () => {
  it('a transient failure is retried with backoff and the visitor never sees it', async () => {
    routeTextCall.mockResolvedValueOnce(fail(true)).mockResolvedValueOnce(fail(true)).mockResolvedValueOnce(ok(AFTER_ANSWER))
    const { POST } = await import('@/app/api/demo/chimmy/route')
    const res = await POST(post({ message: "Who's the best team in the league and why?" }))
    expect(res.status).toBe(200)
    expect(JSON.parse(await res.text())).toMatchObject({ answer: AFTER_ANSWER, truncated: false })
    expect(routeTextCall).toHaveBeenCalledTimes(3)
  }, 15_000)

  it('a dead key is not retried, and the visitor gets a friendly message with a retry flag', async () => {
    routeTextCall.mockResolvedValue(fail(false))
    const { POST } = await import('@/app/api/demo/chimmy/route')
    const res = await POST(post({ message: 'Who is the best team?' }))
    expect(res.status).toBe(503)
    const body = JSON.parse(await res.text())
    expect(routeTextCall).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({ code: 'chimmy_unavailable', retryable: false })
    expect(body.error).not.toMatch(/Chimmy is unavailable/)
    expect(body.error).toMatch(/another try/)
  })

  it('every failure is logged with its reason, and never with the question or league data', async () => {
    routeTextCall.mockResolvedValue(fail(false))
    const { POST } = await import('@/app/api/demo/chimmy/route')
    await POST(post({ message: 'Is Gridiron Gremlins actually good or just lucky?' }))
    const all = logged.join('\n')
    expect(all).toContain('deepseek:auth(401)')
    expect(all).not.toContain('Gridiron')
    expect(all).not.toContain('lucky')
    expect(all).not.toContain('Turbo Tacos')
  })

  it('a reply cut off at the token limit is flagged so the page can offer "tap to continue"', async () => {
    routeTextCall.mockResolvedValue(ok('Turbo Tacos are the best team: they lead the league with 791 points for and', { truncated: true }))
    const { POST } = await import('@/app/api/demo/chimmy/route')
    const res = await POST(post({ message: 'Who is the best team?' }))
    expect(res.status).toBe(200)
    expect(JSON.parse(await res.text())).toMatchObject({ truncated: true })
    expect(logged.join('\n')).toContain('answer cut off at the token limit')
  })

  it('history and continueFrom from the browser are passed through (bounded) to the model', async () => {
    routeTextCall.mockResolvedValue(ok('the rest of the answer.'))
    const { POST } = await import('@/app/api/demo/chimmy/route')
    await POST(post({
      message: 'Who is the best team?',
      history: [{ q: 'hi', a: 'hello' }, { q: 1, a: 'not a turn' }, null],
      continueFrom: 'Turbo Tacos lead with',
    }))
    const user = (routeTextCall.mock.calls[0]![0] as RouterArgs).messages[1]!.content
    expect(user).toContain('Q: hi\nA: hello')
    expect(user).not.toContain('not a turn')
    expect(user).toContain('"""Turbo Tacos lead with"""')
  })
})

describe('routeTextCallWithRetry', () => {
  it('backs off exponentially and stops at the retry limit', async () => {
    routeTextCall.mockResolvedValue(fail(true))
    const { routeTextCallWithRetry } = await import('@/lib/ai/routeTextCallWithRetry')
    const sleeps: number[] = []
    const out = await routeTextCallWithRetry({ messages: [] }, { label: 't', retries: 2, baseDelayMs: 100, sleep: async (ms) => { sleeps.push(ms) }, random: () => 0 })
    expect(out.attempts).toBe(3)
    expect(sleeps).toEqual([100, 200])
  })

  it('does not start another attempt past its time budget', async () => {
    routeTextCall.mockResolvedValue(fail(true))
    const { routeTextCallWithRetry } = await import('@/lib/ai/routeTextCallWithRetry')
    let t = 0
    // Each now() advances 600 ms, so the first failure lands at 600 ms elapsed — past a 500 ms budget.
    const out = await routeTextCallWithRetry({ messages: [] }, { label: 't', retries: 5, baseDelayMs: 100, budgetMs: 500, now: () => (t += 600), sleep: async () => {}, random: () => 0 })
    expect(out.attempts).toBe(1)
    expect(routeTextCall).toHaveBeenCalledTimes(1)
  })
})
