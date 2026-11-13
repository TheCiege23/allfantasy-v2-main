import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  roster: { findMany: vi.fn() },
  sportsGame: { findMany: vi.fn() },
  aFProjectionSnapshot: { findMany: vi.fn() },
  playerIdentityMap: { findMany: vi.fn() },
}))
const projections = vi.hoisted(() => ({ latestNcaafProjectionSeason: vi.fn(), lookupNcaafProjections: vi.fn() }))
const weeks = vi.hoisted(() => ({ resolveSportWeek: vi.fn() }))
const players = vi.hoisted(() => ({ resolveTradePlayers: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/core-app/ncaafProjections', () => projections)
vi.mock('@/lib/season-week/seasonWeekService', () => weeks)
vi.mock('@/lib/decision-os/trade/tradePlayers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/decision-os/trade/tradePlayers')>()),
  resolveTradePlayers: players.resolveTradePlayers,
}))

import { createNcaafLeagueGrader } from '@/lib/decision-os/trade/ncaafLeagueGrader'
import { loadNcaafRedraftBase, ncaafTradeScoringRules, rosteredIdsOf, type NcaafRedraftBaseResult } from '@/lib/decision-os/trade/ncaafRedraftContext'
import { resolveLeagueScoringRules } from '@/lib/redraft/leagueScoringRules'
import { NCAAF_PICKS_UNPRICED_REASON } from '@/lib/decision-os/trade/ncaafRedraftValue'
import type { LeagueTypeBasis } from '@/lib/league/leagueTypeGrading'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'

const RULES = { settings: { scoring_settings: { pass_yd: 0.04, pass_td: 4, rec: 1, rec_yd: 0.1, rec_td: 6 } } }
const qbLine = (passYd: number) => ({ perGameRates: { pass_yd: passYd, pass_td: 2 } })
const wrLine = (rec: number) => ({ perGameRates: { rec, rec_yd: rec * 12, rec_td: 0.5 } })

const redraft: LeagueTypeBasis = { type: 'redraft', label: 'Redraft', source: 'confirmed', platform: null }
const dynasty: LeagueTypeBasis = { type: 'dynasty', label: 'Dynasty', source: 'confirmed', platform: null }
const p = (name: string, rosterPlayerId?: string): TradeAssetInput => ({ kind: 'player', name, ...(rosterPlayerId ? { rosterPlayerId } : {}) })

function seedLeague() {
  projections.latestNcaafProjectionSeason.mockResolvedValue({ season: '2026' })
  weeks.resolveSportWeek.mockResolvedValue({ ok: true, state: 'upcoming', sportWeek: 6, nextSportWeek: 7 })
  db.sportsGame.findMany.mockResolvedValue([
    { week: 1, seasonType: 'regular' },
    { week: 15, seasonType: 'regular' },
    { week: 16, seasonType: 'post' },
  ])
  db.roster.findMany.mockResolvedValue([
    { playerData: { players: ['101', '102'], starters: ['101'] } },
    { playerData: { players: ['201'], reserve: [{ id: '202' }] } },
  ])
  players.resolveTradePlayers.mockResolvedValue(
    new Map([
      ['101', { ok: true, name: 'Arch Manning', position: 'QB' }],
      ['102', { ok: true, name: 'Jeremiah Smith', position: 'WR' }],
      ['201', { ok: true, name: 'Cade Klubnik', position: 'QB' }],
      ['202', { ok: false, why: 'unresolved' }],
    ]),
  )
  projections.lookupNcaafProjections.mockResolvedValue(
    new Map([
      ['101', { playerId: '101', projectedPoints: 20, position: 'QB', componentStats: qbLine(300).perGameRates }],
      ['102', { playerId: '102', projectedPoints: 18, position: 'WR', componentStats: wrLine(7).perGameRates }],
      ['201', { playerId: '201', projectedPoints: 19, position: 'QB', componentStats: qbLine(250).perGameRates }],
    ]),
  )
  // Snapshot QBs, best first. c-202 is rostered here (reserve) under a Rolling Insights id and must not count as free.
  db.aFProjectionSnapshot.findMany.mockImplementation(async (args: { where: { position: { equals: string } } }) =>
    args.where.position.equals === 'QB'
      ? [
          { playerId: 'c-101', playerName: 'Arch Manning', adjustmentFactors: qbLine(300) },
          { playerId: 'c-202', playerName: 'Rostered Backup', adjustmentFactors: qbLine(280) },
          { playerId: 'c-900', playerName: 'Unlinked QB', adjustmentFactors: qbLine(270) },
          { playerId: 'c-300', playerName: 'Free QB', adjustmentFactors: qbLine(200) },
        ]
      : [
          { playerId: 'c-102', playerName: 'Jeremiah Smith', adjustmentFactors: wrLine(7) },
          { playerId: 'c-400', playerName: 'Free WR', adjustmentFactors: wrLine(4) },
        ],
  )
  db.playerIdentityMap.findMany.mockResolvedValue([
    { cfbdId: 'c-101', rollingInsightsId: '101', espnId: null },
    { cfbdId: 'c-202', rollingInsightsId: '202', espnId: null },
    { cfbdId: 'c-300', rollingInsightsId: '300', espnId: null },
    { cfbdId: 'c-102', rollingInsightsId: '102', espnId: null },
    { cfbdId: 'c-400', rollingInsightsId: '400', espnId: null },
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  seedLeague()
})

describe('loadNcaafRedraftBase — rosters, projections, the free-agent line and the schedule', () => {
  it('reads every rostered id, including lineup sections', () => {
    expect(rosteredIdsOf({ players: ['1'], starters: ['2', ''], reserve: [{ id: '3' }], taxi: [{ player_id: '4' }] }).sort()).toEqual(['1', '2', '3', '4'])
  })

  it('counts the weeks left from the schedule’s regular season, and prices players under the league’s rules', async () => {
    const out = await loadNcaafRedraftBase({ id: 'L1', platform: null, settings: RULES.settings })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.base.window).toEqual({ season: 2026, fromWeek: 6, toWeek: 15, weeks: 10 })
    // 300 × 0.04 + 2 × 4 = 20 per game.
    expect(out.base.perGameByRosterId.get('101')).toEqual({ perGame: 20, position: 'QB' })
    // An id that names nobody is left out of the name list, and so cannot be traded by name.
    expect(out.base.rostered.map((r) => r.rosterPlayerId).sort()).toEqual(['101', '102', '201'])
    expect(players.resolveTradePlayers).toHaveBeenCalledWith(expect.arrayContaining(['101', '102', '201', '202']), { space: 'rolling_insights', sport: 'NCAAF' })
  })

  it('the best free agent skips anyone rostered here under ANY id, and anyone no league here can add', async () => {
    const out = await loadNcaafRedraftBase({ id: 'L1', platform: null, settings: RULES.settings })
    if (!out.ok) throw new Error(out.reason)
    const r = await out.base.replacementFor(['qb'])
    // Not Arch Manning (rostered), not the rostered backup (reserve, RI id), not the unlinked QB.
    expect(r.get('QB')).toEqual({ name: 'Free QB', perGame: 16 })
  })

  it('reads each position once however many deals ask', async () => {
    const out = await loadNcaafRedraftBase({ id: 'L1', platform: null, settings: RULES.settings })
    if (!out.ok) throw new Error(out.reason)
    await out.base.replacementFor(['QB', 'WR'])
    await out.base.replacementFor(['QB'])
    expect(db.aFProjectionSnapshot.findMany).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['no scoring rules', () => undefined, { platform: 'fantrax', settings: { roster_size: 24 } }, /scoring/i],
    ['no projections on file', () => projections.latestNcaafProjectionSeason.mockResolvedValue(null), RULES, /No college projections/],
    ['no week on the schedule', () => weeks.resolveSportWeek.mockResolvedValue({ ok: false, reason: 'NO_SCHEDULE_ROWS' }), RULES, /no week on file/],
    ['unreadable rosters', () => db.roster.findMany.mockRejectedValue(new Error('down')), RULES, /rosters could not be read/],
  ])('refuses with a reason when there is %s', async (_what, arrange, league, reason) => {
    arrange()
    const out = await loadNcaafRedraftBase({ id: 'L1', platform: (league as { platform?: string }).platform ?? null, settings: league.settings })
    expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(reason) })
  })
})

describe('ncaafTradeScoringRules — which rules a college league is priced under', () => {
  it('an imported league is priced by its saved rulebook, as it is', () => {
    expect(ncaafTradeScoringRules({ platform: 'fantrax', settings: RULES.settings })).toEqual(RULES.settings.scoring_settings)
  })

  it('a league created here is priced by its sport config, not the summary creation writes', () => {
    // What the create flow stores in `scoring_settings`, read off a real created league: screen names, no stat.
    const created = { roster_size: 24, sportConfig: {}, scoring_settings: { ppr: 0.5, passingTouchdown: 4, receivingTouchdown: 6, rushingTouchdown: 6, fieldGoalMade: 3, teamDefenseTouchdown: 6 } }
    const rules = ncaafTradeScoringRules({ platform: 'manual', settings: created })
    expect(rules).not.toBeNull()
    // The weights the league's matchups are scored by, read through the same resolution.
    const resolved = resolveLeagueScoringRules({ sport: 'NCAAF', settings: { roster_size: 24, sportConfig: {} } })!
    const passYds = resolved.categories.find((c) => c.key === 'pass_yds')!
    // Under the projection scorer's name for it: the engine's `pass_yds` is `pass_yd` there.
    expect(rules!.pass_yd).toBe(resolved.overrides.pass_yds ?? passYds.defaultPoints)
    expect(rules!.pass_yd).toBeGreaterThan(0)
    expect(rules).not.toHaveProperty('pass_yds')
    // Role two-point counts present, so the aggregate is not paid a second time.
    expect(rules).not.toHaveProperty('two_pt')
    // Never the settings blob: a roster size is not a stat weight.
    expect(rules).not.toHaveProperty('roster_size')
    expect(rules).not.toHaveProperty('passingTouchdown')
  })

  it('a commissioner’s points override the sport’s default', () => {
    const rules = ncaafTradeScoringRules({ platform: 'allfantasy', settings: { sportConfig: { categoryPoints: { pass_td: 6 } } } })
    expect(rules!.pass_td).toBe(6)
  })

  it('an imported league with no rulebook refuses, even when its settings hold numbers', () => {
    // The old reader took this blob to BE the rulebook: it "had rules" and priced nobody.
    expect(ncaafTradeScoringRules({ platform: 'fantrax', settings: { roster_size: 24 } })).toBeNull()
  })

  it('prices yards on the CFBD spellings production projections carry, not only touchdowns', async () => {
    projections.lookupNcaafProjections.mockResolvedValue(new Map([
      ['101', { playerId: '101', projectedPoints: 20, position: 'QB', componentStats: { 'passing.YDS': 300, 'passing.TD': 2 } }],
    ]))
    const out = await loadNcaafRedraftBase({ id: 'L1', platform: 'manual', settings: { sportConfig: {}, scoring_settings: { ppr: 0.5, passingTouchdown: 4 } } })
    if (!out.ok) throw new Error(out.reason)
    // 300 × 0.04 + 2 × 4 = 20. Touchdowns alone would be 8.
    expect(out.base.perGameByRosterId.get('101')).toEqual({ perGame: 20, position: 'QB' })
  })

  it('prices a created league’s players instead of leaving them all unpriced', async () => {
    const settings = { roster_size: 24, sportConfig: {}, scoring_settings: { ppr: 0.5, passingTouchdown: 4, fieldGoalMade: 3 } }
    const out = await loadNcaafRedraftBase({ id: 'L1', platform: 'manual', settings })
    if (!out.ok) throw new Error(out.reason)
    const qb = out.base.perGameByRosterId.get('101')
    expect(qb?.perGame).toBeGreaterThan(0)
    expect(out.base.perGameByRosterId.size).toBe(3)
  })
})

describe('createNcaafLeagueGrader', () => {
  it('grades a college redraft deal on points over replacement', async () => {
    const grader = createNcaafLeagueGrader({ id: 'L1', platform: null, settings: RULES.settings, leagueType: redraft })
    const view = await grader.grade([p('Arch Manning')], [p('Jeremiah Smith', '102')])
    expect(view).toMatchObject({ graded: true })
    if (!view?.graded) return
    // QB (20 − 16) × 10 = 40.  WR per game 7 + 8.4 + 3 = 18.4 vs free WR 4 + 4.8 + 3 = 11.8 → 6.6 × 10 = 66.
    expect(view.giveValue).toBe(40)
    expect(view.getValue).toBe(66)
    expect(view.letter).toBe('A')
  })

  it('loads the league once for every deal it grades', async () => {
    const grader = createNcaafLeagueGrader({ id: 'L1', platform: null, settings: RULES.settings, leagueType: redraft })
    await grader.grade([p('Arch Manning')], [p('Jeremiah Smith')])
    await grader.grade([p('Jeremiah Smith')], [p('Arch Manning')])
    expect(db.roster.findMany).toHaveBeenCalledTimes(1)
  })

  it('another college league type is left to the chart path — unless the deal carries a pick', async () => {
    const loadBase = vi.fn()
    const grader = createNcaafLeagueGrader({ id: 'L1', platform: null, settings: RULES.settings, leagueType: { ...dynasty, type: 'keeper' } }, { loadBase })
    expect(await grader.grade([p('Arch Manning')], [p('Jeremiah Smith')])).toBeNull()
    expect(await grader.grade([p('Arch Manning')], [{ kind: 'pick', year: 2027, round: 1 }])).toEqual({ graded: false, reason: NCAAF_PICKS_UNPRICED_REASON, basis: null })
    expect(loadBase).not.toHaveBeenCalled()
  })

  it('prices college dynasty players and picks using verified class years', async () => {
    const grader = createNcaafLeagueGrader({
      id: 'L1', platform: null, settings: RULES.settings, leagueType: dynasty,
      leagueSize: 4, season: 2026, status: 'in_season',
    }, { loadBase: loadNcaafRedraftBase, loadClassYears: async () => new Map([['101', 1], ['102', 4]]) })
    const trade = await grader.grade([p('Arch Manning')], [p('Jeremiah Smith', '102')])
    expect(trade).toMatchObject({ graded: true, getValue: 66, basis: expect.stringContaining('recorded class year') })
    if (trade?.graded) expect(trade.giveValue).toBeGreaterThan(trade.getValue)
    const pick = await grader.grade([p('Arch Manning')], [{ kind: 'pick', year: 2027, round: 1, overall: 1 }])
    expect(pick).toMatchObject({ graded: true, basis: expect.stringContaining('rostered freshmen') })
  })

  it('a league that cannot be read is withheld with its reason, never graded on the chart', async () => {
    const loadBase = vi.fn(async (): Promise<NcaafRedraftBaseResult> => ({ ok: false, reason: 'No college projections are on file.' }))
    const grader = createNcaafLeagueGrader({ id: 'L1', platform: null, settings: RULES.settings, leagueType: redraft }, { loadBase })
    expect(await grader.grade([p('Arch Manning')], [p('Jeremiah Smith')])).toEqual({ graded: false, reason: 'No college projections are on file.', basis: null })
  })
})
