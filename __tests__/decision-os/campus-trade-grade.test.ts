import type { BoardPlayer, SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { createFootballCampusDraftGrader } from '@/lib/decision-os/trade/footballCampusDraftGrade'
import { createSportPointsGrader } from '@/lib/decision-os/trade/sportPointsGrader'
import { validateNbaProspectRanks } from '@/lib/adp/nbaProspectRanks'
import { gradeInputsFromNativeItems } from '@/lib/decision-os/trade/tradeGradeInputs'
import { afItemAsset } from '@/lib/decision-os/trade/tradeRecord'
import { extractPickMentions } from '@/lib/chimmy/tradePickMentions'
import { parsePickLabel } from '@/lib/parsePickLabel'

const mocks = vi.hoisted(() => ({ config: vi.fn(), rosters: vi.fn(), footballBoard: vi.fn(), footballClasses: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { roster: { findMany: mocks.rosters } } }))
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
const pick = (draftSide: 'campus' | 'canton'): TradeAssetInput => ({ kind: 'pick', draftSide, year: 2027, round: 1 })
const grade = () => createSportPointsGrader({ league: native, sport: 'NBA' }, {
  loadBase: async ({ sport }) => ({ ok: true, ctx: sport === 'NBA' ? nba : campus }),
})!

beforeEach(() => {
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
  expect(await grade().grade([c(0)], [pick('canton')])).toMatchObject({ graded: false, reason: expect.stringContaining('separate') })
  expect(await grade().grade([p(0)], [{ kind: 'pick', year: 2027, round: 1 }])).toMatchObject({ graded: false, reason: expect.stringContaining('Specify Campus or Canton') })
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

it('prices a verified pre-draft prospect by exact ESPN college ID', async () => {
  const ranked = createSportPointsGrader({ sport: 'NBA', league: { ...native, leagueType: 'dynasty' } }, {
    loadBase: async () => ({ ok: true, ctx: nba }),
  })!
  expect(await ranked.grade([{ kind: 'player', playerId: campusId(0), name: 'College 0' }], [p(0)]))
    .toMatchObject({ graded: true, basis: expect.stringContaining('verified pre-draft NBA rank') })
  expect(await ranked.grade([{ kind: 'player', playerId: campusId(99), name: 'Pro 0' }], [p(0)]))
    .toMatchObject({ graded: false, reason: expect.stringContaining('verified NBA prospect rank') })
})
