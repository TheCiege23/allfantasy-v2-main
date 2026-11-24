import { beforeEach, expect, it, vi } from 'vitest'
import type { BoardPlayer, SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { createFootballCombinedPickQuote } from '@/lib/decision-os/trade/footballCampusTradeValue'
import { resolveAssets, type LeagueTradeChart } from '@/lib/trade-value-console/leagueTradePricing'
import { createFootballCampusDraftGrader } from '@/lib/decision-os/trade/footballCampusDraftGrade'
import { createSportPointsGrader } from '@/lib/decision-os/trade/sportPointsGrader'
import { validateNbaProspectRanks } from '@/lib/adp/nbaProspectRanks'
import { gradeInputsFromNativeItems } from '@/lib/decision-os/trade/tradeGradeInputs'
import { afItemAsset } from '@/lib/decision-os/trade/tradeRecord'
import { extractPickMentions } from '@/lib/chimmy/tradePickMentions'
import { parsePickLabel } from '@/lib/parsePickLabel'
import { combinedDraftPickValue } from '@/lib/decision-os/trade/combinedC2CDraftValue'
import { ANNUAL_C2C_DRAFT, annualC2CDraftSeason } from '@/lib/live-draft-engine/annualC2CDraft'
import { draftPickGradeAsset } from '@/lib/live-draft-engine/draftPickTradeGrade'
import { mirrorTradeGrade } from '@/lib/decision-os/trade/tradeGrade'

const mocks = vi.hoisted(() => ({ config: vi.fn(), liveDraft: vi.fn(), rosters: vi.fn(), footballBoard: vi.fn(), footballClasses: vi.fn(), devyRights: vi.fn(), devyPlayers: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: mocks.liveDraft }, roster: { findMany: mocks.rosters }, devyRights: { findMany: mocks.devyRights }, devyPlayer: { findMany: mocks.devyPlayers } } }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({ getC2CConfig: mocks.config }))
vi.mock('@/lib/decision-os/trade/ncaafRedraftContext', async (load) => ({
  ...await load<typeof import('@/lib/decision-os/trade/ncaafRedraftContext')>(),
  loadNcaafRedraftBase: mocks.footballBoard, loadNcaafClassYears: mocks.footballClasses,
}))

const asOf = '2026-11-01T00:00:00Z'
const now = new Date('2026-11-07T00:00:00Z')
const campusId = (i: number) => 'espn:ncaab:' + (100 + i)
const ranks = Array.from({ length: 12 }, (_, i) => ({ playerId: campusId(i), name: 'College ' + i, rank: i + 1 }))
const collegeBoard: BoardPlayer[] = ranks.map((p, i) => ({ id: 'college-' + i, name: p.name, position: 'G', aliases: [], rosterAlias: String(100 + i), perGame: 32 - i, sampleGames: 16 }))
const proBoard: BoardPlayer[] = ranks.map((_, i) => ({ id: 'nba-' + i, name: 'Pro ' + i, position: 'G', aliases: [], perGame: 46 - i, sampleGames: 30 }))
const poolContext = (sport: 'NBA' | 'NCAAB', board: BoardPlayer[], remaining: number): SportPointsContext => ({
  sport, board, teams: 8, scoringBasis: 'league',
  replacementByPosition: new Map([['G', { name: 'Replacement', perGame: 16 }]]),
  window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: remaining },
  dynasty: {
    nextDraftYear: 2027,
    ages: new Map(proBoard.map((p) => [p.id, 20])),
    classYears: new Map(collegeBoard.map((p) => [p.id, 1])),
    nbaProspectRanks: new Map(ranks.map((p) => [p.playerId, { ...p, draftYear: 2027, publishedAt: asOf }])),
  },
})
const campus = poolContext('NCAAB', collegeBoard, 20)
campus.rosterIndex = new Map(collegeBoard.map((p) => [p.rosterAlias!, p]))
const nba = poolContext('NBA', proBoard, 70)
const native = { id: 'native', platform: 'manual', settings: null, leagueType: 'c2c', leagueSize: 8, season: 2026 }
const c = (i: number): TradeAssetInput => ({ kind: 'player', rosterPlayerId: campusId(i) })
const p = (i: number): TradeAssetInput => ({ kind: 'player', playerId: 'nba-' + i })
const pick = (draftSide: 'campus' | 'canton' | 'combined'): TradeAssetInput => ({ kind: 'pick', draftSide, year: 2027, round: 1 })
const grade = () => createSportPointsGrader({ league: native, sport: 'NBA' }, {
  loadBase: async ({ sport }) => ({ ok: true, ctx: sport === 'NBA' ? nba : campus }),
})!

beforeEach(() => {
  mocks.liveDraft.mockResolvedValue(null)
  mocks.rosters.mockResolvedValue([{ playerData: { lineup_sections: { devy: ranks.map((p) => p.playerId) } } }])
  mocks.config.mockResolvedValue({ standingsModel: 'unified', collegeScoringSystem: 'points', mergedRookieCollegeDraft: false, collegeDraftRounds: 3, rookieDraftRounds: 3 })
})

it('requires ranked evidence with unique qualified IDs in the active draft class', () => {
  const board = { source: 'Licensed board', publishedAt: asOf, draftYear: 2027, players: ranks }
  expect(validateNbaProspectRanks(board, 2027, now)?.board.players).toHaveLength(12)
  expect(validateNbaProspectRanks(board, 2027, new Date('2026-12-03'))).toBeNull()
  expect(validateNbaProspectRanks({ ...board, players: [ranks[0], ...ranks] }, 2027, now)).toBeNull()
  expect(validateNbaProspectRanks({ ...board, players: [{ ...ranks[0], playerId: '100' }, ...ranks.slice(1)] }, 2027, now)).toBeNull()
})

it('preserves an explicit draft division in typed, stored, and Chimmy picks', () => {
  expect(parsePickLabel('2027 Campus Early 1st')).toMatchObject({ draftSide: 'campus', year: 2027, round: 1, bucket: 'early' })
  expect(extractPickMentions('2027 Canton 2nd round pick').picks[0]).toMatchObject({ draftSide: 'canton', season: 2027, round: 2 })
  expect(parsePickLabel('2027 Combined 1st')).toMatchObject({ draftSide: 'combined', year: 2027, round: 1 })
  expect(extractPickMentions('2027 Combined 2nd round pick').picks[0]).toMatchObject({ draftSide: 'combined', season: 2027, round: 2 })
  const input = { itemType: 'draft_pick', itemReference: 'fdp:2027:1:owner', faabAmount: null, metadata: {} }
  expect(gradeInputsFromNativeItems([input]).assets[0]).toMatchObject({ draftSide: 'canton' })
  expect(afItemAsset(input)).toMatchObject({ draftSide: 'canton' })
})

it('grades an NBA mixed-player trade with exact college and pro evidence', async () => {
  const result = await grade().grade([c(0)], [p(0)])
  expect(result, JSON.stringify(result)).toMatchObject({ graded: true, lines: expect.arrayContaining([
    expect.objectContaining({ name: 'College 0', source: 'nba-c2c-campus-and-pro', valueAsOf: asOf }),
    expect.objectContaining({ name: 'Pro 0', source: 'nba-points-dynasty' }),
  ]) })
  expect(await grade().grade([c(55)], [p(0)])).toMatchObject({ graded: false })
})

it('uses different Campus and Canton pick boards for separate standings', async () => {
  mocks.config.mockResolvedValue({ standingsModel: 'separate', collegeScoringSystem: 'points', mergedRookieCollegeDraft: false, collegeDraftRounds: 3, rookieDraftRounds: 3 })
  expect(await grade().grade([c(0)], [pick('campus')])).toMatchObject({ graded: true, basis: expect.stringContaining('current freshmen') })
  expect(await grade().grade([p(0)], [pick('canton')])).toMatchObject({ graded: true, basis: expect.stringContaining('Dynasty value') })
  const split = await grade().grade([c(0)], [pick('canton')])
  expect(split).toMatchObject({ graded: false, reason: expect.stringContaining('separate'), divisionImpacts: [
    { division: 'Campus', giveValue: expect.any(Number), getValue: 0 },
    { division: 'Canton', giveValue: 0, getValue: expect.any(Number) },
  ] })
  expect(mirrorTradeGrade(split)).toMatchObject({ divisionImpacts: [
    { division: 'Campus', giveValue: 0, getValue: expect.any(Number) },
    { division: 'Canton', giveValue: expect.any(Number), getValue: 0 },
  ] })
  expect(await grade().grade([p(0)], [{ kind: 'pick', year: 2027, round: 1 }])).toMatchObject({ graded: false, reason: expect.stringContaining('Specify Campus or Canton') })
})

it('prices a combined NBA pick from both draft pools in a shared standings league', async () => {
  const config = { standingsModel: 'unified', collegeScoringSystem: 'points', mergedRookieCollegeDraft: true, rookieDraftType: 'snake', collegeDraftRounds: 3, rookieDraftRounds: 3 }
  mocks.config.mockResolvedValue(config)
  expect(await grade().grade([pick('combined')], [p(0)])).toMatchObject({
    graded: true, basis: expect.stringContaining('Combined picks use the ranked union'),
    lines: expect.arrayContaining([expect.objectContaining({ source: 'nba-c2c-combined-pick' })]),
  })
  mocks.config.mockResolvedValue({ ...config, standingsModel: 'separate' })
  expect(await grade().grade([pick('combined')], [p(0)])).toMatchObject({ graded: false })
})

it('prices NBA picks in the stored annual draft year using its seated slots', async () => {
  const draft = { draftModeLabel: ANNUAL_C2C_DRAFT, c2cConfig: { annualSeason: 2027 }, rounds: 5, teamCount: 4 }
  mocks.liveDraft.mockResolvedValue(draft)
  mocks.config.mockResolvedValue({ standingsModel: 'unified', collegeScoringSystem: 'points', mergedRookieCollegeDraft: true, rookieDraftType: 'linear', collegeDraftRounds: 3, rookieDraftRounds: 2 })
  const loadBase = vi.fn(async ({ sport }: { sport: string }) => {
    const ctx = sport === 'NBA' ? nba : campus
    return { ok: true as const, ctx: { ...ctx, window: { ...ctx.window, season: 2027 } } }
  })
  const grader = createSportPointsGrader({ league: { ...native, season: 2027, status: 'in_season' }, sport: 'NBA' }, { loadBase })!
  const quote = (slot: number) => draftPickGradeAsset({ season: annualC2CDraftSeason(draft)!, round: 1, slot, overall: slot, teamCount: 4, combined: true })
  const result = await grader.grade([quote(1)], [quote(4)])
  expect(result, JSON.stringify(result)).toMatchObject({
    graded: true,
    lines: [expect.objectContaining({ source: 'nba-c2c-combined-pick' }), expect.objectContaining({ source: 'nba-c2c-combined-pick' })],
  })
  expect(loadBase).toHaveBeenCalledWith(expect.objectContaining({ sport: 'NBA', league: expect.objectContaining({ season: 2027, status: 'pre_draft' }) }))
})

it('quotes an exact combined slot from both pools and discounts future seasons', () => {
  const args = { pick: { kind: 'pick' as const, year: 2027, round: 1, overall: 2 }, campus: [110, 75], canton: [100, 60], teams: 4, nextDraftYear: 2027, rounds: 3 }
  expect(combinedDraftPickValue(args)).toBe(100)
  expect(combinedDraftPickValue({ ...args, pick: { ...args.pick, year: 2028 } })).toBe(85)
  expect(combinedDraftPickValue({ ...args, pick: { ...args.pick, overall: 5 } })).toBeNull()
  expect(combinedDraftPickValue({ ...args, campus: [] })).toBeNull()
})

it('uses the separate football Campus draft curve only for assets on the Campus board', async () => {
  mocks.config.mockResolvedValue({ standingsModel: 'separate', collegeScoringSystem: 'ppr', mergedRookieCollegeDraft: false, collegeDraftRounds: 3 })
  mocks.footballBoard.mockResolvedValue({ ok: true, base: {
    rostered: [{ rosterPlayerId: 'cfb-1', name: 'College WR', position: 'WR' }],
    perGameByRosterId: new Map([['cfb-1', { perGame: 16, position: 'WR' }]]),
    window: { season: 2026, weeks: 7 },
    replacementFor: async () => new Map([['WR', { name: 'Replacement', perGame: 6 }]]),
  } })
  mocks.footballClasses.mockResolvedValue(new Map([['cfb-1', 1]]))
  const football = createFootballCampusDraftGrader({ ...native, type: 'c2c', status: 'in_season' })!
  expect(await football([{ kind: 'player', rosterPlayerId: 'cfb-1' }], [pick('campus')]))
    .toMatchObject({ graded: true, basis: expect.stringContaining('Campus division') })
  expect(await football([p(0)], [pick('campus')]))
    .toMatchObject({ graded: false, reason: expect.stringContaining('Campus roster ID') })
  expect(await football([pick('canton')], [pick('campus')])).toMatchObject({ graded: false })
})


function nflChart() {
  return {
    leagueSize: 12, chartIsDynasty: true, tePremium: false, isSuperFlex: true, pprNfl: 1, waiverBudget: 0,
    marketCtx: { scoring: { settings: {} } },
    nflCtx: { isDynasty: true, isSuperFlex: true, numTeams: 12, ppr: 1, asOfDate: asOf },
    fcPlayers: [
      { player: { name: '2027 1st', position: 'PICK' }, value: 1200 },
      ...Array.from({ length: 12 }, (_, i) => ({ player: { sleeperId: 's-' + i, position: 'WR' }, value: 2400 - i * 100 })),
    ],
  } as unknown as LeagueTradeChart
}

function footballBoard(count: number) {
  const rostered = Array.from({ length: count }, (_, i) => ({ rosterPlayerId: 'cfb-' + i, name: 'Campus WR ' + i, position: 'WR' }))
  mocks.footballBoard.mockResolvedValue({ ok: true, base: {
    rostered,
    perGameByRosterId: new Map(rostered.map((p, i) => [p.rosterPlayerId, { perGame: 24 - i, position: 'WR' }])),
    window: { season: 2026, weeks: 7 },
    replacementFor: async () => new Map([['WR', { name: 'Replacement', perGame: 6 }]]),
  } })
  mocks.footballClasses.mockResolvedValue(new Map(rostered.map((p) => [p.rosterPlayerId, 1])))
  return rostered
}

it('prices a numbered NFL combined pick through the saved chart and verified freshmen', async () => {
  mocks.config.mockResolvedValue({ standingsModel: 'unified', collegeScoringSystem: 'ppr', mergedRookieCollegeDraft: true, rookieDraftType: 'snake', collegeDraftRounds: 3, rookieDraftRounds: 3 })
  const rostered = footballBoard(12)
  mocks.devyRights.mockResolvedValue(rostered.map((p) => ({ devyPlayerId: p.rosterPlayerId })))
  mocks.devyPlayers.mockResolvedValue(rostered.map((p) => ({ id: p.rosterPlayerId, name: p.name, position: p.position, recruitingStars: 5, recruitingComposite: 0.99, draftEligibleYear: 2029 })))
  const chart = nflChart()
  const combinedPickQuote = createFootballCombinedPickQuote(native)(chart)
  const first = { kind: 'pick' as const, draftSide: 'combined' as const, year: 2027, round: 1, overall: 1 }
  const amount = await combinedPickQuote(first)
  expect(amount).toBeGreaterThanOrEqual(1200)
  expect(await combinedPickQuote({ ...first, year: 2028 })).toBeCloseTo(amount! * 0.85)
  const inputs: Parameters<typeof resolveAssets>[1] = { effectiveSport: 'NFL', nflCtx: chart.nflCtx, waiverBudget: chart.waiverBudget, dataGaps: [], fcPlayers: chart.fcPlayers }
  expect((await resolveAssets([first], { ...inputs, combinedPickQuote })).priced[0]).toMatchObject({ type: 'pick', value: amount, name: 'Combined 2027 1st' })
  expect((await resolveAssets([first], inputs)).priced[0]).toMatchObject({ unpriced: true })
})

it('prices NFL live annual slots in the board year even when the market projects the following draft', async () => {
  const draft = { draftModeLabel: ANNUAL_C2C_DRAFT, c2cConfig: { annualSeason: 2027 }, rounds: 5, teamCount: 8 }
  mocks.liveDraft.mockResolvedValue(draft)
  mocks.config.mockResolvedValue({ standingsModel: 'unified', collegeScoringSystem: 'ppr', mergedRookieCollegeDraft: true, rookieDraftType: 'snake', collegeDraftRounds: 3, rookieDraftRounds: 2 })
  const rostered = footballBoard(12)
  mocks.devyRights.mockResolvedValue(rostered.map(p => ({ devyPlayerId: p.rosterPlayerId })))
  mocks.devyPlayers.mockResolvedValue(rostered.map(p => ({ id: p.rosterPlayerId, name: p.name, position: p.position, recruitingStars: 5, recruitingComposite: 0.99, draftEligibleYear: 2029 })))
  const chart = { ...nflChart(), pickSlots: { draftYear: 2028, oddsByTeam: new Map(), weeksLeft: 0 } }
  const combinedPickQuote = createFootballCombinedPickQuote(native)(chart)
  const first = draftPickGradeAsset({ season: annualC2CDraftSeason(draft)!, round: 1, slot: 1, overall: 1, teamCount: 8, combined: true })
  expect(await combinedPickQuote(first)).toBeGreaterThanOrEqual(1200)
  expect(await combinedPickQuote({ ...first, year: 2026 })).toBeNull()
})

it('keeps football Campus and Canton separate when both sides have measured prices', async () => {
  mocks.config.mockResolvedValue({ standingsModel: 'separate', collegeScoringSystem: 'ppr', mergedRookieCollegeDraft: false, rookieDraftType: 'snake', collegeDraftRounds: 3, rookieDraftRounds: 3 })
  footballBoard(1)
  mocks.rosters.mockResolvedValue([{ playerData: { lineup_sections: { devy: ['cfb-0'] } } }])
  const football = createFootballCampusDraftGrader({ ...native, type: 'c2c', status: 'in_season' })!
  const result = await football([{ kind: 'player', rosterPlayerId: 'cfb-0' }], [pick('canton')], false, nflChart())
  expect(result).toMatchObject({ graded: false, divisionImpacts: [
    { division: 'Campus', giveValue: expect.any(Number), getValue: 0 },
    { division: 'Canton', giveValue: 0, getValue: 1200 },
  ] })
})

it('prices a verified pre-draft prospect by exact ESPN college ID', async () => {
  const ranked = createSportPointsGrader({ sport: 'NBA', league: { ...native, leagueType: 'dynasty' } }, {
    loadBase: async () => ({ ok: true, ctx: nba }),
  })!
  expect(await ranked.grade([{ kind: 'player', playerId: campusId(0), name: 'College 0' }], [p(0)]))
    .toMatchObject({ graded: true, basis: expect.stringContaining('verified pre-draft NBA rank') })
  expect(await ranked.grade([{ kind: 'player', playerId: campusId(99), name: 'Pro 0' }], [p(0)]))
    .toMatchObject({ graded: false, reason: expect.stringContaining('verified NBA prospect rank') })
})
