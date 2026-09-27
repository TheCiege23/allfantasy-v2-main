/**
 * 🛑 EVERY SURFACE THAT GRADES A DEAL BEFORE IT HAPPENS REACHES THE ONE GRADER (2026-09-24).
 *
 * Ten producers on seven scales is how a 1.5x deal read A in the Trade Center, B in /core Trades and
 * C on its pending-offer card. The fix is structural — one pricing path, one scale — so the guard is
 * structural too: each surface must call into `lib/decision-os/trade/leagueTradeGrader.ts`, and none may
 * keep a private letter of its own. A new surface that grades a deal belongs in this list.
 *
 * ⚠ Comments are stripped before matching, so a sentence ABOUT an old producer (and there are many
 * — they explain why it went) cannot satisfy or break a check.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const code = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const SURFACES: ReadonlyArray<{ file: string; entry: RegExp; what: string }> = [
  { file: 'lib/trade-value-console/runTradeConsoleAnalysis.ts', entry: /gradePricedSides\(/, what: 'the Trade Center verdict' },
  { file: 'app/api/league/trades-panel/route.ts', entry: /gradeDeal\(/, what: 'pending offers on the league page and the inbox' },
  { file: 'lib/core-app/trades.ts', entry: /gradeDeal\(/, what: 'the /core Trades pending list' },
  { file: 'lib/chimmy/tradeScenarioGrounding.ts', entry: /gradeDeal\(/, what: 'Chimmy, on a trade between rostered players' },
  { file: 'lib/chimmy-trade/describedTradeEvaluator.ts', entry: /gradeDeal\(/, what: 'Chimmy, on a trade described in prose' },
  /* Completed trades and receipts (2026-09-25). */
  { file: 'lib/league-trade-engine/serverTradeDecision.ts', entry: /gradeDeal\(/, what: 'the proposal-time receipt' },
  { file: 'lib/league-trade-engine/tradeLearningCapture.ts', entry: /gradeDeal\(/, what: 'native history "Now"' },
  { file: 'lib/trade-intel/tradeExpectationLoader.ts', entry: /oneGradeForCompletedTrade\(/, what: 'the letter before points arrive (email, history, dashboard)' },
  { file: 'lib/core-app/recentTrades.ts', entry: /oneGradeForCompletedTrade\(/, what: 'the dashboard trade band verdict' },
  { file: 'lib/core-app/trades.ts', entry: /gradeArchivedTrade\(/, what: 'the /core Trades grade list' },
  { file: 'lib/core-app/tradesBoard.ts', entry: /gradeArchivedTrade\(/, what: 'the cross-league trades board' },
  /* The one trade engine, Phase 1 (2026-09-26): these call `evaluateTrade()` and show its receipt's letter. */
  { file: 'lib/league-trade-engine/serverTradeDecision.ts', entry: /evaluateTrade\(\s*\{\s*surface:/, what: 'the proposal-time receipt, through the engine' },
  { file: 'app/api/trade-evaluator/route.ts', entry: /evaluateTrade\(\s*\{\s*surface:/, what: '/trade-evaluator' },
  { file: 'server/api-route-modules/legacy/trade/analyze/route.ts', entry: /evaluateTrade\(\s*\{\s*surface:/, what: 'the legacy trade analyzer' },
  /* Phase 2 (2026-09-27): an existing trade by reference — loadTrade() → the one engine. */
  { file: 'lib/decision-os/trade/evaluateStoredTrade.ts', entry: /evaluate:\s*evaluateTrade,/, what: 'evaluateStoredTrade, whose default grader is the one engine' },
  { file: 'app/api/trades/evaluate/route.ts', entry: /evaluateStoredTrade\(/, what: 'POST /api/trades/evaluate' },
]

/* The private letters these surfaces used to print. Shapes, not words: a call, not a mention. */
const PRIVATE_LETTERS: ReadonlyArray<{ name: string; shape: RegExp }> = [
  { name: 'the canonical fairness grader', shape: /\bgradeTrade\(\s*side[AB]/ },
  { name: 'the share-of-value letter', shape: /evaluatePendingOffer\(/ },
  { name: 'a letter drawn from a bare percentDiff', shape: /projectedLetterFor\(/ },
  { name: "the canonical evaluation's letter", shape: /grade:\s*evaluation\.grade/ },
  { name: 'the rank-space share grade', shape: /\bgradeTrade\(\s*\{\s*label:/ },
  { name: 'the legacy canonical verdict', shape: /buildLegacyCanonicalGrade\(/ },
  { name: 'a value edge on the mean of both sides', shape: /letterForValueEdge\(/ },
  { name: 'the flat-200 FantasyCalc balance', shape: /calculateTradeBalance\(/ },
  { name: "the canonical memo's fairness letter", shape: /canonicalFairnessGrade\(/ },
]

describe.each(SURFACES)('$what', ({ file, entry }) => {
  const src = code(file)

  it('reaches the one grader', () => {
    expect(entry.test(src)).toBe(true)
  })

  it.each(PRIVATE_LETTERS)('prints no private letter: $name', ({ shape }) => {
    expect(shape.test(src)).toBe(false)
  })
})

describe('the Trade Center prices with the shared chart and pricer, not a copy', () => {
  const src = code('lib/trade-value-console/runTradeConsoleAnalysis.ts')

  it('uses the shared chart and pricer', () => {
    expect(src).toMatch(/resolveLeagueTradeChart\(/)
    expect(src).toMatch(/resolveAssets\(/)
    expect(src).toMatch(/from '\.\/leagueTradePricing'/)
  })

  it('does not grade or price need on its own any more', () => {
    expect(src).not.toMatch(/gradeOnLeagueValue\(/)
    expect(src).not.toMatch(/loadViewerNeedFactors\(/)
    expect(src).not.toMatch(/getFantasyCalcValuesDbFirst\(/)
  })

  it('returns the grade object the screen reads its letters from', () => {
    expect(src).toMatch(/^ {4}grade,$/m)
  })
})

describe('the league page grades nothing itself', () => {
  const src = code('app/league/[leagueId]/tabs/TradesTab.tsx')

  it('no longer calls the analyzer per card (an LLM call each)', () => {
    expect(src).not.toMatch(/fetch\('\/api\/trade-value\/analyze'/)
  })

  it('draws the card from the grade the row carries', () => {
    expect(src).toMatch(/pendingVerdictFromGrade\(/)
    expect(src).toMatch(/t\.leagueGrade/)
  })
})

describe('positive controls — the guards can fail', () => {
  it('the private-letter shapes match the code they were written against', () => {
    expect(PRIVATE_LETTERS[0]!.shape.test('const { grade } = gradeTrade(sideA, sideB)')).toBe(true)
    expect(PRIVATE_LETTERS[1]!.shape.test('evaluation: evaluatePendingOffer({')).toBe(true)
    expect(PRIVATE_LETTERS[2]!.shape.test('giveGrade: projectedLetterFor({ percentDiff: pd, hasSignal })')).toBe(true)
    expect(PRIVATE_LETTERS[3]!.shape.test('      grade: evaluation.grade,')).toBe(true)
    expect(PRIVATE_LETTERS[4]!.shape.test("const g = gradeTrade(\n      { label: 'received', assets: recvGradeable },")).toBe(true)
    expect(PRIVATE_LETTERS[5]!.shape.test('const graded = buildLegacyCanonicalGrade({')).toBe(true)
    expect(PRIVATE_LETTERS[6]!.shape.test("const letter = insideNoise ? 'C' : letterForValueEdge(valueEdge)")).toBe(true)
    expect(PRIVATE_LETTERS[7]!.shape.test('tradeBalance = calculateTradeBalance(\n        newsAdjustedCalcMap,')).toBe(true)
    expect(PRIVATE_LETTERS[8]!.shape.test('= canonicalFairnessGrade(sideA, sideB, input.profiles)')).toBe(true)
  })

  it('the engine-entry shape matches a real call and not the dynasty-tiers helper of the same name', () => {
    const entry = /evaluateTrade\(\s*\{\s*surface:/
    expect(entry.test("await evaluateTrade(\n      {\n        surface: 'legacy-trade-analyze',")).toBe(true)
    expect(entry.test('const tierEvaluation = evaluateTrade(\n        tierAssetsA,')).toBe(false)
  })

  it('the comment stripper leaves code and removes prose', () => {
    expect(code('lib/decision-os/trade/tradeGrade.ts')).toMatch(/export function gradeTrade\(/)
    expect(code('lib/decision-os/trade/tradeGrade.ts')).not.toMatch(/THE trade grade/)
  })

  it('the analyzer fetch shape matches the call it replaced', () => {
    expect(/fetch\('\/api\/trade-value\/analyze'/.test("const r = await fetch('/api/trade-value/analyze', {")).toBe(true)
  })
})

/*
 * 🛑 NO FLAT DEFAULT VALUE FOR A PLAYER NOBODY COULD FIND (2026-09-26). `calculateTradeBalance`
 * priced every FantasyCalc miss at 200 and graded the deal anyway, and the legacy prompt told the
 * model to do the same. The one engine withholds the grade instead; these files must not bring the
 * default back.
 */
const FLAT_DEFAULT = /(\?\?|\|\|)\s*200\b|UNKNOWN_PLAYER_VALUE|value ~200|depth ~200/

describe('no flat default value for an unknown player', () => {
  it.each([
    'lib/fantasycalc.ts',
    'server/api-route-modules/legacy/trade/analyze/route.ts',
    'app/api/trade-evaluator/route.ts',
    'lib/decision-os/trade/evaluateTrade.ts',
    'lib/decision-os/trade/receiptViews.ts',
  ])('%s', (file) => {
    expect(code(file)).not.toMatch(FLAT_DEFAULT)
  })

  it('positive control: the shape matches the code it replaced', () => {
    expect(FLAT_DEFAULT.test('value: lookup?.value || UNKNOWN_PLAYER_VALUE,')).toBe(true)
    expect(FLAT_DEFAULT.test('const v = fcPlayer?.value || 200')).toBe(true)
    expect(FLAT_DEFAULT.test('treat them as low-value depth players (value ~200).')).toBe(true)
    expect(FLAT_DEFAULT.test('return NextResponse.json(body, { status: 200 })')).toBe(false)
  })
})

/*
 * /trade-evaluator, live mode (2026-09-27): every number beside the letter is the receipt's. The
 * composite fairness, confidence, acceptance drivers and the IDP fairness range are priced differently
 * and could contradict the letter, so the live branch must blank them.
 */
describe('the /trade-evaluator page shows only the receipt beside its letter', () => {
  const src = code('app/trade-evaluator/page.tsx')
  const live = src.slice(src.indexOf('if (!historical) {'), src.indexOf('const historicalPercentDiff'))

  it('the live branch exists and reads the receipt panel', () => {
    expect(src.indexOf('if (!historical) {')).toBeGreaterThan(0)
    expect(src.indexOf('const historicalPercentDiff')).toBeGreaterThan(src.indexOf('if (!historical) {'))
    expect(live).toMatch(/liveGradePanel\(payload\.tradeGrade\)/)
    expect(live).toMatch(/verdict:\s*verdictFromGradeLabel\(/)
  })

  it.each([
    ['composite fairness', /fairnessScore:\s*null,/],
    ['composite confidence', /confidencePct:\s*null,/],
    ['acceptance drivers', /drivers:\s*\[\],/],
    ['the IDP fairness range', /idpCeilingCaveat:\s*null,/],
  ])('blanks %s', (_what, shape) => {
    expect(live).toMatch(shape)
  })

  it('never derives the live verdict from acceptance odds', () => {
    expect(live).not.toMatch(/verdictFromPayload\(/)
    expect(live).not.toMatch(/acceptProbability/)
  })
})
