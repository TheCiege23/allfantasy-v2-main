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
import { existsSync, readFileSync } from 'node:fs'
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
  /* 2026-09-28: the War Room's trade analyzer, redraft and dynasty (see lib/decision-os/trade/warRoomTradeGrade.ts). */
  { file: 'lib/decision-os/trade/warRoomTradeGrade.ts', entry: /gradeDeal\(/, what: 'War Room trade grading' },
  { file: 'app/api/leagues/[leagueId]/redraft-war-room/[action]/route.ts', entry: /gradeWarRoomTrade\(/, what: 'the redraft War Room trade analyzer' },
  { file: 'app/api/leagues/[leagueId]/dynasty-war-room/[action]/route.ts', entry: /gradeWarRoomTrade\(/, what: 'the dynasty War Room trade analyzer' },
  /* 2026-09-29: the other three War Rooms, the same way. */
  { file: 'app/api/leagues/[leagueId]/keeper-war-room/[action]/route.ts', entry: /gradeWarRoomTrade\(/, what: 'the keeper War Room trade analyzer' },
  { file: 'app/api/leagues/[leagueId]/guillotine-war-room/[action]/route.ts', entry: /gradeWarRoomTrade\(/, what: 'the guillotine War Room trade analyzer' },
  { file: 'app/api/leagues/[leagueId]/best-ball-war-room/[action]/route.ts', entry: /gradeWarRoomTrade\(/, what: 'the best-ball War Room trade analyzer' },
  /* 2026-09-29: the league settings "AI trade" panel, which prints this route's response as-is. */
  { file: 'app/api/ai/trade-analysis/route.ts', entry: /evaluateTrade\(\s*\{\s*surface:/, what: 'the league settings AI trade panel' },
  /* 2026-09-27: the Trade Center's "Best trade partners" suggestions (see lib/trade-intel/partnerSuggestionGrades.ts). */
  { file: 'app/api/leagues/[leagueId]/trades/rosters/route.ts', entry: /gradeDeal\(/, what: 'the Trade Center partner suggestions' },
  /* 2026-09-28: the trade block's suggested offers (see lib/trade-block/tradeBlockOffers.ts). */
  { file: 'app/api/redraft/trades/trade-block/route.ts', entry: /gradeDeal\(/, what: 'the trade block' },
  { file: 'lib/core-app/trades.ts', entry: /gradeDeal\(/, what: 'the /core Trades pending list' },
  /* 2026-09-28: the live draft's pick-trade builder, rookie drafts (see lib/live-draft-engine/draftPickTradeGrade.ts). */
  { file: 'app/api/leagues/[leagueId]/draft/trade-builder/analyze/route.ts', entry: /gradeDeal\(/, what: 'the live draft pick-trade builder' },
  /* 2026-09-28: "Propose a Trade" — the deal as composed, before it is sent (packages: the rosters route above). */
  { file: 'app/api/leagues/[leagueId]/trades/grade-preview/route.ts', entry: /gradeDeal\(/, what: 'the trade proposal composer' },
  { file: 'lib/chimmy/tradeScenarioGrounding.ts', entry: /evaluateTrade\(\s*\{\s*surface:/, what: 'Chimmy, on a trade between rostered players (the evaluate_trade tool and the push path) — through the one engine, with a receipt' },
  { file: 'lib/chimmy-trade/describedTradeEvaluator.ts', entry: /evaluateTrade\(\s*\{\s*surface:/, what: 'Chimmy, on a trade described in prose — through the one engine, with a receipt' },
  /* Completed trades and receipts (2026-09-25). */
  { file: 'lib/league-trade-engine/serverTradeDecision.ts', entry: /gradeDeal\(/, what: 'the proposal-time receipt' },
  { file: 'lib/league-trade-engine/tradeLearningCapture.ts', entry: /gradeDeal\(/, what: 'native history "Now"' },
  { file: 'lib/trade-intel/tradeExpectationLoader.ts', entry: /oneGradeForCompletedTrade\(/, what: 'the letter before points arrive (email, history, dashboard)' },
  { file: 'lib/core-app/recentTrades.ts', entry: /oneGradeForCompletedTrade\(/, what: 'the dashboard trade band verdict' },
  /*
   * 2026-09-27: the /core Trades grade list's glue moved into `archivedTradeGrade.ts`, shared with the
   * player card, so ONE function grades an archived trade for both. Each surface is pinned to that
   * function, and the function to the one grader (`gradeArchivedTradeWithInputs` is the same grade,
   * returning its inputs too so a surface can record a receipt).
   */
  { file: 'lib/core-app/archivedTradeGrade.ts', entry: /gradeArchivedTrade(?:WithInputs)?\(/, what: 'archived-trade grading (the /core Trades list and the player card)' },
  { file: 'lib/core-app/trades.ts', entry: /gradeArchivedTradeRows\(/, what: 'the /core Trades grade list' },
  { file: 'lib/core-app/playerCard.ts', entry: /gradeArchivedTradeRows\(/, what: 'the player card’s trades' },
  { file: 'lib/core-app/tradesBoard.ts', entry: /gradeArchivedTrade\(/, what: 'the cross-league trades board' },
  /* The one trade engine, Phase 1 (2026-09-26): these call `evaluateTrade()` and show its receipt's letter. */
  { file: 'lib/league-trade-engine/serverTradeDecision.ts', entry: /evaluateTrade\(\s*\{\s*surface:/, what: 'the proposal-time receipt, through the engine' },
  { file: 'app/api/trade-evaluator/route.ts', entry: /evaluateTrade\(\s*\{\s*surface:/, what: '/trade-evaluator' },
  { file: 'server/api-route-modules/legacy/trade/analyze/route.ts', entry: /evaluateTrade\(\s*\{\s*surface:/, what: 'the legacy trade analyzer' },
  /* Phase 2 (2026-09-27): an existing trade by reference — loadTrade() → the one engine. */
  { file: 'lib/decision-os/trade/evaluateStoredTrade.ts', entry: /evaluate:\s*evaluateTrade,/, what: 'evaluateStoredTrade, whose default grader is the one engine' },
  { file: 'app/api/trades/evaluate/route.ts', entry: /evaluateStoredTrade\(/, what: 'POST /api/trades/evaluate' },
  /* 2026-09-27: the dynasty trade analyzer's letter, in the league the viewer chose. */
  { file: 'app/api/dynasty-trade-analyzer/route.ts', entry: /evaluateTrade\(\s*\{\s*surface:/, what: 'the dynasty trade analyzer' },
  /* 2026-09-27: /trade-finder's candidates (see lib/trade-finder/candidateGrades.ts). */
  { file: 'app/api/trade-finder/route.ts', entry: /gradeDeal\(/, what: 'the /trade-finder page’s suggested trades' },
  /* 2026-09-29: the /core Player Finder's "trade for him" card — it printed a second engine's verdict until then. */
  { file: 'lib/core-app/playerTradeVisual.ts', entry: /gradeDeal\(/, what: 'the /core Player Finder “trade for him” card' },
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
 * /trade-evaluator (2026-09-27): every number beside the letter is the receipt's, in live AND
 * historical mode. Historical (`asOfDate`) mode used to keep its own letters — `computeDualModeGrades`
 * and `gradeFromPercentDiff` — and since Trade OS it shows the same one grade with a labelled note.
 */
describe('the /trade-evaluator page shows only the receipt beside its letter', () => {
  const src = code('app/trade-evaluator/page.tsx')
  const map = src.slice(src.indexOf('function mapApiResponse('), src.indexOf('function ResultBadge('))

  it('maps every response through the receipt panel, with one return', () => {
    expect(src.indexOf('function mapApiResponse(')).toBeGreaterThan(0)
    expect(src.indexOf('function ResultBadge(')).toBeGreaterThan(src.indexOf('function mapApiResponse('))
    expect(map).toMatch(/liveGradePanel\(payload\.tradeGrade\)/)
    expect(map).toMatch(/verdict:\s*verdictFromGradeLabel\(/)
    expect(map.match(/\breturn \{/g)?.length).toBe(1)
  })

  it.each([
    ['composite fairness', /fairnessScore:\s*null,/],
    ['composite confidence', /confidencePct:\s*null,/],
    ['acceptance drivers', /drivers:\s*\[\],/],
    ['the IDP fairness range', /idpCeilingCaveat:\s*null,/],
  ])('blanks %s', (_what, shape) => {
    expect(map).toMatch(shape)
  })

  it('never derives a verdict from acceptance odds, and keeps no historical letter scale', () => {
    expect(map).not.toMatch(/verdictFromPayload\(/)
    expect(map).not.toMatch(/acceptProbability/)
    expect(src).not.toMatch(/function gradeFromPercentDiff\(/)
    expect(src).not.toMatch(/dualModeGrades\?\.atTheTime\?\.grade/)
  })

  it('the route sends the as-of-date comparison without its letters', () => {
    const route = code('app/api/trade-evaluator/route.ts')
    expect(route).not.toMatch(/\.\.\.\(dualModeGrades && \{ dualModeGrades \}\)/)
    expect(route).toMatch(/atTheTime:\s*\{\s*percentDiff:/)
  })
})

/*
 * 🛑 TRADE OS (design build-order step 5, 2026-09-27): every trade screen shows the one grade — and
 * records it as a receipt — and none keeps a letter of its own. These are the screens that still had one.
 */
describe('Trade OS — no screen keeps a private letter', () => {
  it('the Trade Center has no browser-side fallback letter', () => {
    expect(PRIVATE_LETTERS[2]!.shape.test(code('components/core-app/screens/TradeCenter.tsx'))).toBe(false)
  })

  it('the AI Tools trade modal prints the one grade, not the canonical memo second opinion', () => {
    const src = code('components/ai-tools/modals/TradeValueModal.tsx')
    expect(src).not.toMatch(/describeTradeCanonicalOpinion\(/)
    expect(src).not.toMatch(/\bdecisionOs\b/)
    expect(src).toMatch(/proposalGrade\.letter/)
  })

  // `\??` on every hop: an optional-chained read (`valueSnapshot?.grade`) is the same letter.
  const SNAPSHOT_LETTER = /valueSnapshot\??\.grade\b|valuePreview\??\.grade\??\.grade|\bsnapshot\??\.grade\b/

  it.each([
    'app/league/[leagueId]/tabs/redraft/TradeCenter.tsx',
    'app/league/[leagueId]/tabs/redraft/TradeCenterModal.tsx',
    'app/league/[leagueId]/tabs/redraft/CommissionerReviewPanel.tsx',
  ])('%s shows no proposal-snapshot letter', (file) => {
    expect(SNAPSHOT_LETTER.test(code(file))).toBe(false)
  })

  it('the old redraft commissioner review — its snapshot scale, its route and its engine — is gone for good', () => {
    // Replaced by the code-computed trade review (Phase 6); deleted with Chimmy's unreachable path to it (step 7).
    for (const f of [
      'app/api/redraft/trades/[proposalId]/commissioner-review/route.ts',
      'lib/trade-review/redraftCommissionerTradeReview.ts',
    ]) {
      expect(existsSync(resolve(process.cwd(), f)), f).toBe(false)
    }
  })

  it("the inbox's provider rows take nothing from the canonical evaluation but coverage and lineup", () => {
    expect(code('app/api/league/trades-panel/route.ts')).not.toMatch(
      /evaluations\.get\([^)]*\)\?\.(grade|valueGiven|valueReceived|action|recommendation)\b/,
    )
  })

  it('the share card states a result, never a letter', () => {
    const src = code('app/api/share/trade-card/route.tsx')
    expect(src).not.toMatch(/realizedGradeDisplay\(/)
    expect(src).not.toMatch(/currentGrade|initialGrade/)
    expect(src).toMatch(/resultMark\(/)
  })

  it('positive controls: each shape matches the code it replaced', () => {
    expect(SNAPSHOT_LETTER.test('{p.valueSnapshot.grade}')).toBe(true)
    expect(SNAPSHOT_LETTER.test('{valuePreview.grade.grade}')).toBe(true)
    expect(SNAPSHOT_LETTER.test('{p.valueSnapshot?.grade}')).toBe(true)
    expect(SNAPSHOT_LETTER.test('snapshot?.grade ?? null')).toBe(true)
    expect(/evaluations\.get\([^)]*\)\?\.(grade|valueGiven|valueReceived|action|recommendation)\b/.test(
      'proposalGrade: evaluations.get(trade.transactionId)?.grade ?? null,',
    )).toBe(true)
    expect(/realizedGradeDisplay\(/.test('const display = realizedGradeDisplay({')).toBe(true)
  })
})

/*
 * 2026-09-29: surfaces that printed a VERDICT of their own beside (or instead of) the letter — not a
 * letter, so PRIVATE_LETTERS cannot see them. Each shape is the call or read the screen used to print.
 */
describe('no screen prints a second engine’s verdict beside the one grade', () => {
  it.each([
    'app/league/[leagueId]/tabs/keeper/KeeperWarRoomPanel.tsx',
    'app/league/[leagueId]/tabs/guillotine/GuillotineWarRoomPanel.tsx',
    'app/league/[leagueId]/tabs/best-ball/BestBallWarRoomPanel.tsx',
  ])('%s shows the grade line and never the War Room engine’s accept/reject/neutral', (file) => {
    const src = code(file)
    expect(src).toMatch(/<WarRoomTradeGradeLine grade=\{tradeGrade\}/)
    expect(src).not.toMatch(/tradeAnalysis\.verdict|tradeAnalysis\.valueDelta/)
  })

  it('the AI trade panel’s route returns no Win / Loss / Fair verdict or fairness score', () => {
    const src = code('app/api/ai/trade-analysis/route.ts')
    expect(src).not.toMatch(/runTradeAnalysis\(/)
    expect(src).not.toMatch(/\bverdict:|fairnessScore|fairnessConfidence/)
    expect(src).toMatch(/tradeGrade = receiptGradeFields\(receipt\)/)
  })

  it('the dynasty trade analyzer names no winner but the letter’s', () => {
    const src = code('components/DynastyTradeForm.tsx')
    expect(src).not.toMatch(/detVerdict\.winnerLabel|sections\.valueVerdict\.edge\b|\ba\.winner\b|\ba\.dynastyVerdict\b/)
    expect(src).toMatch(/winnerFromLeagueGrade\(tradeGrade,/)
  })

  it('positive controls: each shape matches the code it replaced', () => {
    expect(/tradeAnalysis\.verdict|tradeAnalysis\.valueDelta/.test("Verdict: {tradeAnalysis.verdict.replace(/_/g, ' ')}")).toBe(true)
    expect(/runTradeAnalysis\(/.test('engine = await runTradeAnalysis({')).toBe(true)
    expect(/\bverdict:|fairnessScore|fairnessConfidence/.test('      verdict: deterministicVerdict,')).toBe(true)
    expect(/detVerdict\.winnerLabel|sections\.valueVerdict\.edge\b|\ba\.winner\b|\ba\.dynastyVerdict\b/.test("winner: a.winner || 'Even',")).toBe(true)
  })
})

describe('Trade OS — every screen records its grade as a receipt', () => {
  it.each([
    ['app/api/trade-value/analyze/route.ts', /receiptIdForGrade\(\{\s*surface:\s*'trade-center'/],
    ['app/api/league/trades-panel/route.ts', /receiptIdForGrade\(\{\s*surface:\s*'trades-panel'/],
    ['lib/core-app/trades.ts', /receiptIdForGrade\(\{\s*surface:\s*'core-trades'/],
    ['lib/core-app/recentTrades.ts', /receiptIdForGrade\(\{\s*surface:\s*'dashboard-trades'/],
    ['lib/trade-intel/tradeNotifyService.ts', /receiptIdForGrade\(\{\s*surface:\s*'trade-email'/],
    ['app/api/redraft/trade-proposals/route.ts', /receiptIdForGrade\(\{\s*surface:\s*'redraft-trade-list'/],
    ['app/api/redraft/trade-value-preview/route.ts', /evaluateTrade\(\{\s*surface:\s*'redraft-trade-preview'/],
    ['lib/decision-os/trade/tradeReviewContext.ts', /surface: args\.surface \?\? 'commissioner-review'/],
  ])('%s', (file, shape) => {
    expect(code(file)).toMatch(shape)
  })
})

/*
 * 🛑 COMMISSIONER REVIEW MODE (design build-order step 6, 2026-09-27): the review advises and the
 * commissioner decides. These shapes keep it that way — the review path never writes a trade's status,
 * the flags stay pure code, and every commissioner decision logs the review it was made with.
 */
describe('Commissioner review mode — advice, never an action', () => {
  /* A write to a trade's status, or a call into a decision path. Shapes, not words. */
  const DECIDES = /commissionerAfTradeDecision\(|finalizeAfLeagueTradeProcessing\(|vetoRedraftTradeProposal\(|(?:afLeagueTrade|redraftTradeProposal)\.update\(/

  it.each([
    'app/api/leagues/[leagueId]/trades/[tradeId]/review/route.ts',
    'lib/decision-os/trade/tradeReviewContext.ts',
    'lib/decision-os/trade/tradeReview.ts',
    'components/trade-review/TradeReviewPanel.tsx',
  ])('%s decides nothing', (file) => {
    expect(DECIDES.test(code(file))).toBe(false)
  })

  it('the flags are pure code — the review module imports nothing', () => {
    expect(code('lib/decision-os/trade/tradeReview.ts')).not.toMatch(/^import /m)
  })

  it('the redraft panel shows the one review, not the old snapshot review', () => {
    const src = code('app/league/[leagueId]/tabs/redraft/CommissionerReviewPanel.tsx')
    expect(src).toMatch(/<TradeReviewPanel /)
    expect(src).not.toMatch(/fetchCommissionerTradeReview\(/)
  })

  it.each([
    ['the native decision route', 'app/api/leagues/[leagueId]/trades/[tradeId]/commissioner/route.ts', /reviewId:\s*reviewIdFrom\(body\.reviewId\)/],
    ['a native reject', 'lib/league-trade-engine/tradeService.ts', /reason: 'commissioner_reject',\s*metadata: auditMetadata,/],
    ['a native approve', 'lib/league-trade-engine/tradeService.ts', /finalizeAfLeagueTradeProcessing\(\{ tradeId: trade\.id, actorUserId: input\.userId, auditMetadata \}\)/],
    ['a redraft approve', 'app/api/redraft/trade-votes/route.ts', /noteCommissionerReview\(proposal\.id, \{ commissionerDecision: 'approve', reviewId: reviewIdFrom\(body\.reviewId\) \}\)/],
    ['a redraft veto (votes route)', 'app/api/redraft/trade-votes/route.ts', /upsertDecision\(proposal\.id, 'vetoed', userId, body\.reason, \{ commissionerDecision: 'veto', reviewId: reviewIdFrom\(body\.reviewId\) \}\)/],
    ['a redraft veto (veto route)', 'app/api/redraft/trades/veto/route.ts', /snapshot: \{ reviewId \}/],
  ])('%s logs the review it was made with', (_what, file, shape) => {
    expect(code(file)).toMatch(shape)
  })

  it('positive control: the decision shape matches the calls it exists to catch', () => {
    expect(DECIDES.test('await commissionerAfTradeDecision({ tradeId, leagueId, userId, decision })')).toBe(true)
    expect(DECIDES.test('await prisma.redraftTradeProposal.update({ where: { id } })')).toBe(true)
    expect(DECIDES.test('const r = await reviewStoredTrade({ leagueId, ref, userId })')).toBe(false)
  })
})

describe('Chimmy — explains the one grade, never makes one (design step 7)', () => {
  it.each([
    ['lib/chimmy/tradeScenarioGrounding.ts', /evaluateTrade\(\s*\{\s*surface: 'chimmy'/, 'the evaluate_trade tool and the push path'],
    ['lib/chimmy-trade/describedTradeEvaluator.ts', /evaluateTrade\(\{ surface: 'chimmy-described'/, 'a trade described in prose'],
    ['lib/chimmy-trade/pendingTradeDecisionGrounding.ts', /surface: 'chimmy-pending'/, 'pending incoming trades'],
    ['lib/chimmy/tradeTargetVerdict.ts', /evaluateTrade\(\{ surface: 'chimmy-target'/, '"should I trade for X?"'],
  ])('%s grades through the one engine, with a receipt', (file, entry) => {
    expect(code(file)).toMatch(entry)
  })

  it('pending trades never print the proposal-time snapshot letter', () => {
    const src = code('lib/chimmy-trade/pendingTradeDecisionGrounding.ts')
    expect(src).not.toMatch(/valueSnapshot/)
    expect(src).not.toMatch(/toTradeCard|runTradeShadowForProposal/)
  })

  it('"should I trade for X?" is not decided by a second engine or the finder’s band', () => {
    const src = code('lib/chimmy/tradeTargetDecision.ts')
    expect(src).not.toMatch(/FAIRNESS_PHRASE|acceptance|verdict === 'reject'/)
  })

  it('the answer contract carries no letter of its own', () => {
    const src = code('lib/chimmy-chat/response-contract.ts')
    expect(src).not.toMatch(/scoreToGrade|grade:\s*z\.string/)
  })

  it('the old commissioner review and the snapshot letter are gone from Chimmy’s trade tools', () => {
    const src = code('lib/chimmy-trade/tradeIntelligenceTools.ts')
    expect(src).not.toMatch(/buildCommissionerTradeReview|export async function explainTrade/)
  })

  it('the tool loop’s answer is held to the letters the engine gave', () => {
    const route = code('app/api/chat/chimmy/route.ts')
    expect(route).toMatch(/tradeGrades: \[\] as ChimmyTradeGrade\[\]/)
    expect(route).toMatch(/enforceTradeLetters\(\{\s*answer: loop\.text,\s*grades: toolContext\.tradeGrades,/)
  })
})

describe('College redraft — points over replacement, never the private scale (design step 8)', () => {
  it('the league grader asks the college grader first, before any chart pricing', () => {
    const src = code('lib/decision-os/trade/leagueTradeGrader.ts')
    expect(src).toMatch(/sport === 'NCAAF'\s*\?\s*createNcaafLeagueGrader\(/)
    const college = src.indexOf('await college.grade(give, get)')
    const chart = src.indexOf('resolveAssets(give, opts)')
    expect(college).toBeGreaterThan(-1)
    expect(chart).toBeGreaterThan(college)
  })

  it('the Trade Center console takes the same college grade, for the deal and for its counters', () => {
    const src = code('lib/trade-value-console/runTradeConsoleAnalysis.ts')
    expect(src).toMatch(/effectiveSport === 'NCAAF'[\s\S]{0,80}createNcaafLeagueGrader\(/)
    expect(src).toMatch(/applyCollegeGrade\(leagueGrade, collegeView\)/)
    expect(src).toMatch(/collegeGrader \? await collegeGrader\.grade\(counterGive, counterGet\)/)
  })

  it('the college value reads no chart and no private scale', () => {
    for (const file of ['lib/decision-os/trade/ncaafRedraftValue.ts', 'lib/decision-os/trade/ncaafRedraftContext.ts', 'lib/decision-os/trade/ncaafLeagueGrader.ts']) {
      expect(code(file)).not.toMatch(/resolveAssets|dynastyValue|fantasycalc|FantasyCalc|scoringFit|sportsPlayerRecord/i)
    }
  })

  it('positive control: the chart pricer the guard forbids is what the chart path calls', () => {
    expect(code('lib/decision-os/trade/leagueTradeGrader.ts')).toMatch(/resolveAssets\(/)
  })
})

describe('League asset rules — picks refused where unpriced, held devy prospects priced (design step 9)', () => {
  it('the league grader refuses picks before pricing and prices devy before grading', () => {
    const src = code('lib/decision-os/trade/leagueTradeGrader.ts')
    const refuse = src.indexOf('assets.pickRefusal([...give, ...get])')
    const price = src.indexOf('resolveAssets(give, opts)')
    expect(refuse).toBeGreaterThan(-1)
    expect(price).toBeGreaterThan(refuse)
    expect(src).toMatch(/assets\.priceDevy\(\{ inputs: give, lines: g\.lines, priced: g\.priced \}\)/)
    expect(src).toMatch(/giveLines: gd\.lines,\s*getLines: td\.lines,/)
  })

  it('the Trade Center console applies the same rules to the deal and to its counters', () => {
    const src = code('lib/trade-value-console/runTradeConsoleAnalysis.ts')
    expect(src).toMatch(/withheld: assetPolicy\?\.pickRefusal\(\[\.\.\.give, \.\.\.get\]\) \?\? null/)
    expect(src).toMatch(/assetPolicy\.priceDevy\(\{ inputs: give, lines: giveLines, priced: givePriced \}\)/)
    expect(src).toMatch(/assetPolicy\?\.pickRefusal\(\[\.\.\.counterGive, \.\.\.counterGet\]\)/)
    expect(src).toMatch(/assetPolicy\.priceDevy\(\{ inputs: counterGive, lines: g\.lines, priced: g\.priced \}\)/)
  })

  it('the devy price is the measured option value, not the commissioner bridge or the private scale', () => {
    const src = code('lib/decision-os/trade/leagueAssetRules.ts')
    expect(src).toMatch(/devyOptionValue\(/)
    expect(src).not.toMatch(/devyMarketBridge|resolveDevyBridge|dynastyValue|c2cSideWeight/)
  })
})

describe('Nightly trade agent — suggests only what the one grade reads C for both sides (design step 9)', () => {
  it('grades every package with the one grader, from each side with that side’s own roster', () => {
    const src = code('lib/decision-os/trade/tradeAgent.ts')
    expect(src).toMatch(/createLeagueTradeGrader/)
    expect(src).toMatch(/grader\.grade\(\{ give: toInputs\(give\), get: toInputs\(get\), viewerSide: true, needRoster: \{ playerData: myRoster\.playerData \} \}\)/)
    expect(src).toMatch(/grader\.grade\(\{ give: toInputs\(get\), get: toInputs\(give\), viewerSide: true, needRoster: \{ playerData: partnerRoster\.playerData \} \}\)/)
    expect(src).toMatch(/qualifyDeal\(viewer, theirs\)/)
  })

  it('saves nothing the finder computed: its band only skips packages, and every saved number is the grade’s', () => {
    const src = code('lib/decision-os/trade/tradeAgent.ts')
    expect(src).not.toMatch(/myTotalValue|partnerTotalValue|valueDelta|matchScore/)
    expect(src).not.toMatch(/createAfLeagueTrade|proposeTrade|sendTemplatedEmail|sendPushToUser/)
  })

  it('rides the hourly housekeeping cron rather than taking a 61st cron slot', () => {
    expect(code('app/api/cron/reap-sync-runs/route.ts')).toMatch(/runTradeAgentPass\(\{/)
    expect(existsSync(resolve(process.cwd(), 'app/api/cron/trade-agent/route.ts'))).toBe(false)
  })
})

describe('the /core Player Finder trade card — one verdict, the one grade (2026-09-29)', () => {
  it('never asks the second trade engine', () => {
    const src = code('lib/core-app/playerTradeVisual.ts')
    expect(src).not.toMatch(/from '@\/lib\/engine\/trade'/)
    expect(src).not.toMatch(/runTradeAnalysis\(/)
  })

  it('prints neither the finder’s band nor the old engine’s verdict, odds or starter points', () => {
    const src = code('components/core-app/player-finder/TradeVisual.tsx')
    expect(src).not.toMatch(/\{\s*(?:rec|p)\.fairness\s*\}/)
    expect(src).not.toMatch(/Engine:|\.verdict\b|\.acceptance\b|starterDeltaPts/)
    expect(src).toMatch(/grade\.data\.letter/)
  })
})

/*
 * 🛑 THE AF LEGACY PAGE'S TRADE TOOLS (2026-09-29) — sold as the AF Legacy plan, and each printed a
 * verdict of its own beside (or instead of) the letter the full analyzer on the same page gives. Every
 * one now reaches the one grader through `lib/legacy/legacyOneGrade.ts`; see
 * `lib/legacy/legacyPackageGrade.ts` for the list of what each used to print.
 *
 * Kept as its own list at the END of the file so it merges beside other surfaces' entries untouched.
 */
const LEGACY_SURFACES: ReadonlyArray<{ file: string; entry: RegExp; what: string }> = [
  { file: 'lib/legacy/legacyOneGrade.ts', entry: /gradeDeal\(/, what: 'the AF Legacy door to the one grader' },
  { file: 'server/api-route-modules/legacy/trade/quick-evaluate/route.ts', entry: /createLegacyPackageGrader\(/, what: 'the AF Legacy Trade Hub live preview (quick evaluate)' },
  // The league trade finder (league-analyze) is not listed: it was REMOVED on 2026-09-30 (a GPT-4o
  // call per league select that nothing rendered) — see __tests__/legacy/league-analyze-removed.test.ts.
  { file: 'server/api-route-modules/legacy/trade/proposal-generator/route.ts', entry: /createLegacyPackageGrader\(/, what: 'the AF Legacy proposal generator' },
  { file: 'server/api-route-modules/legacy/trade/goal-proposals/route.ts', entry: /createLegacyPackageGrader\(/, what: 'the AF Legacy goal proposals' },
  { file: 'server/api-route-modules/legacy/trade/analyze/route.ts', entry: /await gradeLegacyCounters\(/, what: 'the AF Legacy analyzer’s counter suggestions' },
  { file: 'app/api/engine/trade/simulate-counter/route.ts', entry: /evaluateTrade\(\s*\{\s*surface:/, what: 'the AF Legacy counter “Apply & Simulate”' },
]

describe.each(LEGACY_SURFACES)('AF Legacy — $what', ({ file, entry }) => {
  const src = code(file)

  it('reaches the one grader', () => {
    expect(entry.test(src)).toBe(true)
  })

  it.each(PRIVATE_LETTERS)('prints no private letter: $name', ({ shape }) => {
    expect(shape.test(src)).toBe(false)
  })
})

describe('AF Legacy — the page prints the one grade, never a verdict, fairness or acceptance number of its own', () => {
  const PREVIEW_PRIVATE = /tradeHubLivePreview\.(?:acceptProbability|verdict|lean|fairnessDelta|marketDeltaPct|confidence|scores|sweeteners|acceptDrivers|riskFlags|lineupDelta)\b/

  it('quick evaluate never asks the driver model or the acceptance model', () => {
    const src = code('server/api-route-modules/legacy/trade/quick-evaluate/route.ts')
    expect(src).not.toMatch(/computeTradeDrivers\(|computeAcceptProbability\(/)
  })

  it('the Trade Hub live preview reads the grade, and nothing the driver model printed', () => {
    const page = code('app/af-legacy/page.tsx')
    expect(page).toMatch(/<LegacyOneGrade grade=\{tradeHubLivePreview\.grade\} \/>/)
    expect(PREVIEW_PRIVATE.test(page)).toBe(false)
  })

  it('positive controls: each shape matches the code it replaced', () => {
    expect(/computeTradeDrivers\(|computeAcceptProbability\(/.test('const drivers = computeTradeDrivers(\n      giveAssets, receiveAssets,')).toBe(true)
    expect(PREVIEW_PRIVATE.test('{tradeHubLivePreview.acceptProbability}%')).toBe(true)
    expect(PREVIEW_PRIVATE.test("tradeHubLivePreview.verdict === 'FAIR' ? 'text-emerald-400' :")).toBe(true)
    expect(PREVIEW_PRIVATE.test('{tradeHubLivePreview.sweeteners.map((s: any, i: number) => (')).toBe(true)
    expect(PREVIEW_PRIVATE.test('<LegacyOneGrade grade={tradeHubLivePreview.grade} />')).toBe(false)
  })

  it('the league trade finder, which printed the LLM’s own letter, no longer exists to print one', () => {
    expect(existsSync(resolve(process.cwd(), 'server/api-route-modules/legacy/trade/league-analyze/route.ts'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'app/api/ai/trade/league-analyze/route.ts'))).toBe(false)
  })

  const PROPOSAL_PRIVATE = /proposal\.(?:fairnessScore|acceptanceModel|fairnessNote|myTotal|theirTotal|acceptProb|acceptLabel|giveTotal|receiveTotal|counterPath|sweeteners|topDrivers)\b|<AcceptanceMeter\b/

  it('the proposal generator scores nothing itself: no fairness /100, no acceptance model, no verdict labels', () => {
    const src = code('server/api-route-modules/legacy/trade/proposal-generator/route.ts')
    expect(src).not.toMatch(/computeTradeAcceptance\(|fairnessScore|bestAcceptanceIndex/)
    expect(src).not.toMatch(/'Slight Edge'|'Fair & Balanced'|'Overpay'/)
    expect(src).toMatch(/grade: grades\[i\]!/)
  })

  it('the page’s proposal cards print the grade and none of the generator’s own numbers', () => {
    const page = code('app/af-legacy/page.tsx')
    expect(page).toMatch(/<LegacyOneGrade grade=\{proposal\.grade\} \/>/)
    expect(page).not.toMatch(/optimizeForAcceptance|Best Acceptance Chance/)
  })

  it('positive controls: the proposal shapes match the code they replaced', () => {
    expect(/computeTradeAcceptance\(|fairnessScore|bestAcceptanceIndex/.test('const acceptance = computeTradeAcceptance(acceptanceInput);')).toBe(true)
    expect(PROPOSAL_PRIVATE.test('<span className="text-white font-semibold">{proposal.fairnessScore}</span>')).toBe(true)
    expect(PROPOSAL_PRIVATE.test('<AcceptanceMeter data={proposal.acceptanceModel as AcceptanceModelData} compact />')).toBe(true)
    expect(PROPOSAL_PRIVATE.test('{proposal.acceptProb}%')).toBe(true)
    expect(PROPOSAL_PRIVATE.test('<LegacyOneGrade grade={proposal.grade} />')).toBe(false)
  })

  it('goal proposals send the grade and none of the goal engine’s judging fields', () => {
    const src = code('server/api-route-modules/legacy/trade/goal-proposals/route.ts')
    expect(src).not.toMatch(/\.\.\.result\b/)
    expect(src).toMatch(/await gradeOf\(gradeInputsFromEngineAssets\(p\.give\), gradeInputsFromEngineAssets\(p\.receive\)\)/)
    expect(code('lib/trade-engine/goal-proposal-engine.ts')).not.toMatch(/Fair deal for both|values line up well|keeps things fair/)
  })

  it('neither proposal list on the page prints a generator’s own fairness, acceptance, drivers or totals', () => {
    expect(PROPOSAL_PRIVATE.test(code('app/af-legacy/page.tsx'))).toBe(false)
    expect(code('app/af-legacy/page.tsx').match(/<LegacyOneGrade grade=\{proposal\.grade\} \/>/g)?.length).toBe(2)
  })

  it('positive controls: the goal shapes match the code they replaced', () => {
    expect(/\.\.\.result\b/.test('      success: true,\n      ...result,')).toBe(true)
    expect(PROPOSAL_PRIVATE.test('{proposal.topDrivers.slice(0, 3).map((d: any, dIdx: number) => (')).toBe(true)
    expect(PROPOSAL_PRIVATE.test('Total: {proposal.giveTotal?.toLocaleString()}')).toBe(true)
    expect(/Fair deal for both|values line up well|keeps things fair/.test('in return. Fair deal for both of us.`,')).toBe(true)
  })

  const COUNTER_PRIVATE = /\b(?:c|simResult)\.(?:acceptProb|fairnessScore|fairness|acceptance|verdict)\b|Est\. Accept|animatedAccept/

  it('counters: the analyzer sends graded counters, never the second engine’s whole analysis', () => {
    const src = code('server/api-route-modules/legacy/trade/analyze/route.ts')
    expect(src).not.toMatch(/\{\s*engineAnalysis,\s*engineRequest/)
    expect(src).toMatch(/engineAnalysis: engineClientView/)
    expect(code('app/api/engine/trade/simulate-counter/route.ts')).not.toMatch(/runTradeAnalysis\(/)
    expect(COUNTER_PRIVATE.test(code('components/TradeCounterSuggestions.tsx'))).toBe(false)
  })

  it('positive controls: the counter shapes match the code they replaced', () => {
    expect(/\{\s*engineAnalysis,\s*engineRequest/.test('...(engineAnalysis ? { engineAnalysis, engineRequest: engineReqSaved } : {}),')).toBe(true)
    expect(COUNTER_PRIVATE.test('<>Est. Accept: {(c.acceptProb * 100).toFixed(0)}%</>')).toBe(true)
    expect(COUNTER_PRIVATE.test('<span className="ml-2">Fairness: {c.fairnessScore}</span>')).toBe(true)
    expect(COUNTER_PRIVATE.test('{simResult.verdict.toUpperCase()}')).toBe(true)
  })

  /*
   * The market path is authoritative and `lib/dynasty-tiers` is not (owner's ruling). The analyzer fed a
   * tier-system evaluation into its prompt as "MANDATORY … do NOT override the tier system verdict".
   */
  const TIER_VERDICT = /dynastyTierEvaluation\(|formatEvaluationForAI\(|TIER EVALUATION|tierEvaluation\b/

  it('the legacy analyzer hands the model no dynasty-tiers verdict — only the receipt', () => {
    const src = code('server/api-route-modules/legacy/trade/analyze/route.ts')
    expect(TIER_VERDICT.test(src)).toBe(false)
    expect(src).toMatch(/const canonicalGradeDirective = receiptPromptBlock\(evaluationReceipt\)/)
  })

  it('positive control: the tier shape matches the code it replaced', () => {
    expect(TIER_VERDICT.test('      tierEvaluationStr = formatEvaluationForAI(tierEvaluation)')).toBe(true)
    expect(TIER_VERDICT.test("tierEvaluation ? 'TIER EVALUATION (MANDATORY): The deterministic tier system'")).toBe(true)
    expect(TIER_VERDICT.test('import { detectSFFromRosterPositions } from \'@/lib/dynasty-tiers\'')).toBe(false)
  })
})
