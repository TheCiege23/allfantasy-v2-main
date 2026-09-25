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
  })

  it('the comment stripper leaves code and removes prose', () => {
    expect(code('lib/decision-os/trade/tradeGrade.ts')).toMatch(/export function gradeTrade\(/)
    expect(code('lib/decision-os/trade/tradeGrade.ts')).not.toMatch(/THE trade grade/)
  })

  it('the analyzer fetch shape matches the call it replaced', () => {
    expect(/fetch\('\/api\/trade-value\/analyze'/.test("const r = await fetch('/api/trade-value/analyze', {")).toBe(true)
  })
})
