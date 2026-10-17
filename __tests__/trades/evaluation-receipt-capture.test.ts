// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const save = vi.hoisted(() => vi.fn())
vi.mock('@/lib/decision-os/trade/evaluationReceiptStore', () => ({ saveTradeEvaluationReceipt: save }))
import { captureConsoleEvaluation } from '@/lib/decision-os/trade/captureConsoleEvaluation'
import { captureCompletedEmailEvaluation } from '@/lib/decision-os/trade/captureEmailEvaluation'
import { gradeTrade } from '@/lib/decision-os/trade/tradeGrade'
import type { TradeConsoleAnalyzeInput, TradeConsoleAnalyzeResult } from '@/lib/trade-value-console/types'
import type { LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'

const grade = gradeTrade({ giveValue: 1766, getValue: 1584, giveMarket: 1766, getMarket: 1584,
  unpriced: 0, giveCount: 1, getCount: 1, basis: 'Dynasty · Superflex', scoringApplied: false,
  needApplied: false, needGap: null, moves: [], lines: [
    { side: 'give', name: 'DK Metcalf', marketValue: 1766, leagueValue: 1766 },
    { side: 'get', name: '2027 2nd', marketValue: 1584, leagueValue: 1584 },
  ] })
beforeEach(() => { save.mockReset(); save.mockResolvedValue({ id: 'receipt', href: '/core/trades?evaluation=receipt' }) })

it('captures the computed console result without labeling analysis time as source freshness', async () => {
  const input = { userId: 'account', sportFilter: 'ALL', strategy: 'neutral', teamContext: 'my_team',
    analysisTab: 'raw', sideGive: [{ kind: 'player', name: 'DK Metcalf' }], sideGet: [{ kind: 'pick', year: 2027, round: 2 }] } as TradeConsoleAnalyzeInput
  const result = { grade, analysisMode: 'league', lastUpdated: '2026-09-27T12:00:00.000Z', dataGaps: ['Projections unavailable'],
    dataSources: ['fantasycalc'], players: { give: [{ pricedSource: 'fantasycalc', playerId: 'sleeper:9000', position: 'WR' }], get: [] },
    league: { id: 'league', name: 'Dynasty', sport: 'NFL', leagueType: 'dynasty', leagueSize: 12,
      scoring: 'PPR', isDynasty: true, settings: { scoring_settings: { rec: 1 }, providerSecret: 'private' } } } as unknown as TradeConsoleAnalyzeResult
  await captureConsoleEvaluation(input, result, { byeNotes: ['Bye coverage is thin'], formatNotes: [] })
  const captured = save.mock.calls[0][1]
  expect(captured).toMatchObject({ evaluatedAt: result.lastUpdated, sourceUpdatedAt: null,
    grade: { letter: 'D', partnerLetter: 'B', giveValue: 1766, getValue: 1584 },
    contextNotes: { byeNotes: ['Bye coverage is thin'] }, dataGaps: result.dataGaps,
    league: { scoringRules: { rec: 1 } } })
  expect(JSON.stringify(captured)).not.toContain('providerSecret')
})

it('orients an exact completed-email receipt to the second participant', async () => {
  const grader = { leagueType: { type: 'dynasty' }, chart: { leagueSize: 12, chartIsDynasty: true } } as LeagueTradeGrader
  const trade = { multiTeam: false, sides: [
    { ownerId: 'first', playersOut: [{ name: 'DK Metcalf' }], playersIn: [], picksOut: [], picksIn: [{ season: 2027, round: 2, label: '2027 2nd' }] },
    { ownerId: 'second' },
  ] } as unknown as GradedTrade
  await captureCompletedEmailEvaluation({ userId: 'account', leagueId: 'league', leagueName: 'Dynasty', grader, grade, trade, viewerOwnerId: 'second' })
  expect(save.mock.calls[0][1]).toMatchObject({ origin: 'completed_email',
    grade: { letter: 'B', partnerLetter: 'D', giveValue: 1584, getValue: 1766 },
    input: { sideGive: [{ kind: 'pick', year: 2027, round: 2 }], sideGet: [{ kind: 'player', name: 'DK Metcalf' }] } })
})

it('does not mislabel a league spectator as a participant', async () => {
  expect(await captureCompletedEmailEvaluation({ userId: 'account', leagueId: 'league', leagueName: 'Dynasty',
    grader: {} as LeagueTradeGrader, grade, trade: { sides: [{ ownerId: 'first' }, { ownerId: 'second' }] } as GradedTrade,
    viewerOwnerId: 'spectator' })).toBeNull()
  expect(save).not.toHaveBeenCalled()
})
