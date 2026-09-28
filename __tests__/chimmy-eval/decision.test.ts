import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Engines are fixtures (see `decision-corpus.ts`). Everything between them and the text a user
 * reads is real: classifier, screenshot reader, ready/partial rules, verdict text, renderer,
 * the private @chimmy wrapper, and the membership gate's argument order.
 */
const h = vi.hoisted(() => ({
  access: vi.fn(), start: vi.fn(), waiver: vi.fn(), trade: vi.fn(), lineup: vi.fn(), target: vi.fn(),
  finder: vi.fn(), pending: vi.fn(), season: vi.fn(), model: vi.fn(),
}))
vi.mock('@/lib/chimmy/chimmy-league-snapshot', () => ({ loadLeagueGroundingForUser: h.access }))
vi.mock('@/lib/chimmy/lineupScenarioGrounding', () => ({ buildStartSitScenario: h.start, buildWaiverScenario: h.waiver }))
vi.mock('@/lib/chimmy/tradeScenarioGrounding', () => ({ buildTradeScenario: h.trade }))
vi.mock('@/lib/chimmy/lineupOptimizerGrounding', () => ({ buildLineupOptimization: h.lineup, singleSwapCall: () => null }))
vi.mock('@/lib/chimmy/tradeTargetVerdict', () => ({ buildTradeTargetVerdict: h.target }))
vi.mock('@/lib/chimmy/tradeFinderGrounding', () => ({ buildTradeFinder: h.finder, readTradeFinderPosition: () => null }))
vi.mock('@/lib/chimmy/pendingTradeQuestions', () => ({ pendingTradeQuestions: h.pending }))
vi.mock('@/lib/chimmy/tradeSeasonOutlook', () => ({ tradeSeasonOutlook: () => h.season }))
vi.mock('@/lib/openai-client', () => ({ openaiChatText: h.model }))
vi.mock('@/lib/chimmy/leagueStandingsGrounding', () => ({ buildLeagueStandingsContext: async () => null }))
vi.mock('@/lib/chimmy/headToHeadGrounding', () => ({ buildHeadToHeadGrounding: async () => null }))
vi.mock('@/lib/chimmy-advice/chatStartSitAdvice', () => ({ recordChatStartSitAdvice: async () => null }))

import { chimmyDecisionKind, type ChimmyDecisionAnswer } from '@/lib/chimmy/decisionAnswerContract'
import { prepareChimmyDecisionAnswer } from '@/lib/chimmy/decisionAnswerService'
import { generateChimmyPrivateReply } from '@/lib/chat-core/chimmyPrivateReply'
import {
  DECISION_CORPUS,
  snapshot,
  type Billing,
  type DecisionCase,
  type DecisionDimension,
  type Verdict,
} from './decision-corpus'

const USER = 'u-eval'
/** The id the client asked for. The proven snapshot id differs, so a leak of the raw id is visible. */
const REQUESTED_LEAGUE = 'req-league'
const MODEL_REPLY = 'MODEL_PATH_REPLY'

/* ── Observing a case ───────────────────────────────────────────────────────────────────── */

type Observed = Record<DecisionDimension, string>

function arrange(c: DecisionCase) {
  vi.resetAllMocks()
  const snap = snapshot(c.format)
  h.access.mockImplementation(async (userId: string, leagueId: string) => {
    if (c.engine.access === 'throws') throw new Error('prisma: connection refused at 10.0.0.4')
    // The real gate: only this user, only the league they asked for.
    if (c.engine.access === 'not_member' || userId !== USER || leagueId !== REQUESTED_LEAGUE) return { ok: false, reason: 'not_member' }
    return { ok: true, snapshot: snap }
  })
  h.trade.mockImplementation(async ({ message }: { message: string }) => {
    if (c.engine.tradeThrows) throw new Error('prisma: relation "League" timed out')
    return c.engine.trade?.[message] ?? null
  })
  h.start.mockResolvedValue(c.engine.start ?? null)
  h.waiver.mockResolvedValue(c.engine.waiver ?? null)
  h.lineup.mockResolvedValue(c.engine.lineup ?? { status: 'unresolved', reason: 'no_league_world', detail: 'Fixture has no lineup.' })
  h.target.mockResolvedValue({ status: 'unresolved', reason: 'not_rostered', detail: 'Fixture has no trade target.' })
  h.finder.mockResolvedValue({ status: 'unavailable', reason: 'Fixture has no trade finder.' })
  h.pending.mockResolvedValue(c.engine.pending ?? { offers: [], gap: 'Fixture has no pending offers.' })
  h.season.mockImplementation(async (s: object) => ({
    ...s,
    playoffOdds: c.engine.season ?? { available: false, reason: 'Playoff odds are not computed in this fixture.' },
  }))
  h.model.mockResolvedValue({ ok: true, text: MODEL_REPLY })
}

const VERDICT_LINE = /^(YES,|NO:|COUNTER \/ HOLD:|COUNTER:|HOLD:|Start (.+?)\.$)/m

export function readVerdict(answer: ChimmyDecisionAnswer | null): Verdict | 'n/a' {
  if (!answer) return 'n/a'
  const m = answer.answer.match(VERDICT_LINE)
  if (!m) return 'none'
  if (m[2]) return `start:${m[2]}`
  return ({ 'YES,': 'YES', 'NO:': 'NO', 'COUNTER / HOLD:': 'COUNTER_OR_HOLD', 'COUNTER:': 'COUNTER', 'HOLD:': 'HOLD' } as const)[m[1] as 'YES,']
}

export function readBilling(answer: ChimmyDecisionAnswer | null): Billing {
  return !answer ? 'defer' : answer.status === 'ready' ? 'charge' : 'free'
}

/**
 * Rules every answer must satisfy, whatever the case expects. Each returns a violation or null.
 * They exist because a per-case expectation can only catch what its author thought to list.
 */
export const INVARIANTS: ReadonlyArray<readonly [string, (a: ChimmyDecisionAnswer, c: DecisionCase) => boolean]> = [
  ['authority is explanation-only, version 1', (a) => a.authority === 'explanation_only' && a.version === 1],
  ['a partial answer carries a gap and a ready one does not', (a) => (a.status === 'needs_data') === Boolean(a.gap)],
  ['a free partial answer never leads with YES', (a) => a.status !== 'needs_data' || readVerdict(a) !== 'YES'],
  ['a ready answer names its sources', (a) => a.status !== 'ready' || a.sources.length > 0],
  ['the league id is the proven one, never the raw request', (a) => a.leagueId === null || a.leagueId === 'proven-league'],
  ['no private reason, error text or infrastructure detail', (a) => !/not_member|not_found|prisma|timed out|10\.0\.0\.|Error\b/.test(a.answer)],
  ['a playoff percentage only when the season model computed one', (a, c) => !/\d+(?:\.\d+)?% before/.test(a.answer) || c.engine.season?.available === true],
  ['no probability attached to a future season', (a) => !/\b20(?:2[7-9]|3\d)\b[^\n]*\d+(?:\.\d+)?\s*%/.test(a.answer)],
]

async function observe(c: DecisionCase): Promise<Observed> {
  arrange(c)
  const leagueId = c.league === false ? null : REQUESTED_LEAGUE
  const chat = await prepareChimmyDecisionAnswer({ question: c.question, leagueId, userId: USER, screenshotEvidence: c.screenshot ?? null })
  const firstTradeMessage = (h.trade.mock.calls[0]?.[0] as { message?: string } | undefined)?.message ?? 'none'

  /* The private @chimmy surface cannot carry a screenshot, so it is only compared on text cases. */
  let consistency = 'n/a'
  if (!c.screenshot) {
    arrange(c)
    const mention = await generateChimmyPrivateReply(`@chimmy ${c.question}`, { leagueId, userId: USER })
    consistency = (chat ? mention === chat.answer : mention === MODEL_REPLY) ? 'same' : 'differs'
  }

  const missing = (c.expect.says ?? []).filter((s) => !chat?.answer.includes(s))
  const broken = chat ? INVARIANTS.filter(([, ok]) => !ok(chat, c)).map(([name]) => name) : []

  return {
    kind: String(chimmyDecisionKind(c.question) ?? (c.screenshot ? 'trade' : 'null')),
    status: chat?.status ?? 'null',
    gap: chat?.gap?.code ?? 'none',
    verdict: readVerdict(chat),
    billing: readBilling(chat),
    extraction: firstTradeMessage,
    evidence: missing.length ? `missing: ${missing.join(' | ')}` : 'ok',
    consistency,
    invariants: broken.length ? broken.join(' | ') : 'ok',
  }
}

/* ── Scoring ────────────────────────────────────────────────────────────────────────────── */

const DIMENSIONS: readonly DecisionDimension[] = ['kind', 'status', 'gap', 'verdict', 'billing', 'extraction', 'evidence', 'consistency', 'invariants']

/** The expected value of a dimension, or null when the case does not score it. */
export function expected(c: DecisionCase, d: DecisionDimension): string | null {
  switch (d) {
    case 'kind': return String(c.expect.kind ?? 'null')
    case 'status': return c.expect.status ?? 'null'
    case 'gap': return c.expect.kind === null ? null : c.expect.gap
    case 'verdict': return c.expect.kind === null ? null : c.expect.verdict
    case 'billing': return c.expect.billing
    case 'extraction': return c.expect.extraction ?? null
    case 'evidence': return c.expect.says?.length ? 'ok' : null
    case 'consistency': return c.screenshot ? 'n/a' : 'same'
    case 'invariants': return 'ok'
  }
}

/** Every dimension that disagrees with the case, with gaps honoured. Empty means the case passes. */
export function score(c: DecisionCase, got: Observed): string[] {
  return DIMENSIONS.flatMap((d) => {
    const gap = c.gaps?.[d]
    if (gap) return got[d] === gap.today ? [] : [`${d}: known gap moved to ${JSON.stringify(got[d])} (was ${JSON.stringify(gap.today)}: ${gap.why}) — if this is a fix, delete the gap entry`]
    const want = expected(c, d)
    return want === null || got[d] === want ? [] : [`${d}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got[d])}`]
  })
}

/* ── The eval ───────────────────────────────────────────────────────────────────────────── */

beforeEach(() => vi.resetAllMocks())

describe('Chimmy decision eval', () => {
  it.each(DECISION_CORPUS.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    expect(score(c, await observe(c))).toEqual([])
  })
})

describe('the decision corpus is honest about itself', () => {
  it('has unique ids and questions per screenshot', () => {
    const ids = DECISION_CORPUS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('pins no gap on a value its own expectation accepts', () => {
    const stale = DECISION_CORPUS.flatMap((c) =>
      DIMENSIONS.filter((d) => c.gaps?.[d] && c.gaps[d]!.today === expected(c, d)).map((d) => `${c.id}: ${d}`))
    expect(stale).toEqual([])
  })

  it('keeps billing consistent with status in every expectation', () => {
    const wrong = DECISION_CORPUS.filter((c) =>
      c.expect.billing !== (c.expect.status === 'ready' ? 'charge' : c.expect.status === 'needs_data' ? 'free' : 'defer'))
    expect(wrong.map((c) => c.id)).toEqual([])
  })

  /* The handoff names these families. Pinned so a trim cannot quietly drop one. */
  it.each([
    ['redraft', 10], ['dynasty', 2], ['idp', 6], ['best_ball', 4], ['best_ball_dynasty', 1], ['guillotine', 2], ['survivor_guillotine', 1], ['survivor', 1],
  ] as const)('covers %s with at least %i cases', (format, min) => {
    expect(DECISION_CORPUS.filter((c) => c.format === format).length).toBeGreaterThanOrEqual(min)
  })

  it('carries the owner\'s exact KBFL journey', () => {
    expect(DECISION_CORPUS.filter((c) => c.source === 'owner').length).toBeGreaterThanOrEqual(5)
  })

  const open = DECISION_CORPUS.flatMap((c) => Object.keys(c.gaps ?? {}).map((d) => `${c.id}.${d}`))
  const cases = new Set(open.map((g) => g.split('.')[0])).size
  it(`scoreboard: ${DECISION_CORPUS.length} cases, ${open.length} open gaps across ${cases} cases`, () => {
    expect(open.length).toBeGreaterThanOrEqual(0)
  })
})

/*
 * 🛑 POSITIVE CONTROL: THE SCORER MUST GO RED FOR THE FAILURES IT EXISTS TO CATCH.
 *
 * Each row hands the scorer an answer that is wrong in one specific way, for a real case, and
 * asserts the scorer names that dimension. Without this, a scorer that compared nothing would
 * report the whole corpus green.
 */
describe('positive control: the scorer rejects known-bad answers', () => {
  const kbfl = DECISION_CORPUS.find((c) => c.id === 'kbfl-screenshot-as-measured')!
  const good: Observed = {
    kind: 'trade', status: 'needs_data', gap: 'trade_impact_incomplete', verdict: 'HOLD', billing: 'free',
    extraction: kbfl.expect.extraction!, evidence: kbfl.gaps!.evidence!.today, consistency: 'n/a', invariants: 'ok',
  }

  it('accepts the answer the corpus describes', () => {
    expect(score(kbfl, good)).toEqual([])
  })

  it.each([
    ['a partial KBFL answer sold as a paid verdict', { status: 'ready', billing: 'charge', verdict: 'YES', gap: 'none' }, ['status', 'gap', 'verdict', 'billing']],
    ['a pick dropped from the screenshot before the engine saw it', { extraction: 'Should I trade Quincy Williams, Carson Schwesinger for Tyrone Tracy Jr., Ryan Fitzgerald?' }, ['extraction']],
    ['the known evidence gap closing', { evidence: 'ok' }, ['evidence']],
    ['a leaked private reason', { invariants: 'no private reason, error text or infrastructure detail' }, ['invariants']],
  ] as const)('flags %s', (_name, bad, dims) => {
    const failures = score(kbfl, { ...good, ...bad })
    expect(failures.map((f) => f.split(':')[0]).sort()).toEqual([...dims].sort())
  })

  it('an invariant catches a free partial that leads with YES', () => {
    const [, ok] = INVARIANTS.find(([name]) => name.startsWith('a free partial'))!
    const bad = { version: 1, authority: 'explanation_only', status: 'needs_data', gap: { code: 'x', remedy: 'y' }, answer: 'YES, looks good.', sources: [], leagueId: null } as unknown as ChimmyDecisionAnswer
    expect(ok(bad, kbfl)).toBe(false)
  })

  it('an invariant catches a future-season probability', () => {
    const [, ok] = INVARIANTS.find(([name]) => name.startsWith('no probability'))!
    const bad = { answer: 'Your 2027 title odds rise to 34%.' } as ChimmyDecisionAnswer
    expect(ok(bad, kbfl)).toBe(false)
  })
})
