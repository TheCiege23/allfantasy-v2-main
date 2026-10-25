/**
 * The older playoff-overrides PUT (`/api/commissioner/leagues/[leagueId]/playoffs`) saves through the
 * canonical settings patch (lib/league/commissionerPlayoffsPatch.ts → execute-league-settings-patch.ts).
 *
 * It used to write `League.settings` alone, while the bracket resolver and the playoff runtime read the
 * `League.playoffTeams` / `playoffStartWeek` / `playoffWeeksPerRound` / `playoffLowerBracket` columns
 * first — so a commissioner's change was stored and then read straight past. These run the real route,
 * the real patch, the real derived sync and the real config resolver against one in-memory league row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftPlayoffRound: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn().mockResolvedValue({ hasAccess: false })
  }),
}))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn() }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralPatchRefusal: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ refreshLeagueWaiverNextRunAt: vi.fn() }))

import { PUT } from '@/app/api/commissioner/leagues/[leagueId]/playoffs/route'
import { assertSettingsEditAllowed } from '@/server/services/commissionerService'

type Row = Record<string, any>
let row: Row
let inPlayoffs: boolean

function put(body: Record<string, unknown>) {
  const req = { json: async () => body } as never
  return PUT(req, { params: Promise.resolve({ leagueId: 'L' }) })
}

/** What the panel sends: its whole form, as the GET handed it over, with `changes` applied. */
async function panelSave(changes: Record<string, unknown>) {
  return put({
    playoffTeamCount: 4,
    playoffWeeks: 2,
    playoffStartWeek: 16,
    firstRoundByes: 0,
    seedingRules: 'standard_standings',
    tiebreakerRules: [],
    standingsTiebreakers: [],
    byeRules: null,
    reseedBehavior: 'fixed_bracket',
    matchupLength: 1,
    totalRounds: 2,
    consolationBracketEnabled: true,
    thirdPlaceGameEnabled: false,
    toiletBowlEnabled: false,
    championshipLength: 1,
    consolationPlaysFor: 'none',
    ...changes,
  })
}

const structure = () => (row.settings.playoff_structure ?? {}) as Row

beforeEach(() => {
  vi.clearAllMocks()
  inPlayoffs = false
  row = {
    id: 'L', platform: 'manual', sport: 'NFL', leagueVariant: null, leagueSize: 12, timezone: 'UTC',
    teams: [], leagueSettings: null, waiverSchedule: null, waiverProcessTime: '02:00',
    playoffTeams: 4, playoffStartWeek: 16, playoffWeeksPerRound: 1, playoffSeedingRule: 'standard_standings',
    playoffLowerBracket: 'consolation', bestBallMode: false, bbContestId: null,
    settings: { inviteCode: 'KEEP-ME', playoff_structure: { playoff_team_count: 4, playoff_start_week: 16 } },
  }
  m.prisma.league.findFirst.mockImplementation(async () => structuredClone(row))
  m.prisma.league.findUnique.mockImplementation(async () => structuredClone(row))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Row }) => {
    row = { ...row, ...structuredClone(data) }
    return {}
  })
  m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue(null)
  m.prisma.redraftSeason.findFirst.mockImplementation(async (args: { where: { status?: string } }) =>
    args.where.status ? (inPlayoffs ? { id: 's1' } : null) : { id: 's1', totalWeeks: 17, playoffStartWeek: 15 },
  )
  m.prisma.redraftPlayoffRound.findFirst.mockResolvedValue(null)
})

describe('PUT /api/commissioner/leagues/[leagueId]/playoffs — writes the columns the bracket reads', () => {
  it('a new team count reaches League.playoffTeams and every JSON copy, and the response shows it', async () => {
    const res = await panelSave({ playoffTeamCount: 6, playoffStartWeek: 15 })
    expect(res.status).toBe(200)
    expect(row.playoffTeams).toBe(6)
    expect(row.playoffStartWeek).toBe(15)
    expect(structure().playoff_team_count).toBe(6)
    expect(structure().playoff_start_week).toBe(15)
    expect(structure().first_round_byes).toBe(2)
    expect(row.settings.playoffSettings.playoffTeams).toBe(6)
    const config = await res.json()
    expect(config.playoff_team_count).toBe(6)
    expect(config.playoff_start_week).toBe(15)
    expect(row.settings.inviteCode).toBe('KEEP-ME')
  })

  it('weeks per round and the lower bracket go to their columns too', async () => {
    const res = await panelSave({ matchupLength: 2, playoffStartWeek: 14, consolationBracketEnabled: false, toiletBowlEnabled: true })
    expect(res.status).toBe(200)
    expect(row.playoffWeeksPerRound).toBe(2)
    expect(row.playoffLowerBracket).toBe('toilet')
    expect(structure().matchup_length).toBe(2)
    expect(structure().toilet_bowl_enabled).toBe(true)
    expect(structure().consolation_bracket_enabled).toBe(false)
    const config = await res.json()
    expect(config.matchup_length).toBe(2)
    expect(config.toilet_bowl_enabled).toBe(true)
  })

  it('neither box ticked is no lower bracket; both ticked is refused (the column holds one)', async () => {
    expect((await panelSave({ consolationBracketEnabled: false })).status).toBe(200)
    expect(row.playoffLowerBracket).toBe('none')
    const res = await panelSave({ consolationBracketEnabled: true, toiletBowlEnabled: true })
    expect(res.status).toBe(400)
    expect(row.playoffLowerBracket).toBe('none')
  })

  it('fields with no column still land in playoff_structure', async () => {
    const res = await panelSave({ reseedBehavior: 'reseed_after_round', thirdPlaceGameEnabled: true, consolationPlaysFor: 'pick', standingsTiebreakers: ['points_for'] })
    expect(res.status).toBe(200)
    expect(structure().reseed_behavior).toBe('reseed_after_round')
    expect(structure().third_place_game_enabled).toBe(true)
    expect(structure().consolation_plays_for).toBe('pick')
    // Saving it is what opts an existing league's draft order in (lib/playoff-runtime/consolationPlaysFor.ts).
    expect(structure().consolation_plays_for_sets_draft_order).toBe(true)
    expect(row.settings.standings_tiebreakers).toEqual(['points_for'])
    expect((await res.json()).reseed_behavior).toBe('reseed_after_round')
  })

  it('a save that does not send "plays for" leaves an existing league out of the draft-order rule', async () => {
    const res = await put({ playoffTeamCount: 4, playoffStartWeek: 16, reseedBehavior: 'reseed_after_round' })
    expect(res.status).toBe(200)
    expect(structure().reseed_behavior).toBe('reseed_after_round')
    expect(structure().consolation_plays_for).toBeUndefined()
    expect(structure().consolation_plays_for_sets_draft_order).toBeUndefined()
  })

  it('an unknown "plays for" value is refused and writes nothing', async () => {
    const res = await put({ consolationPlaysFor: 'final_standings' })
    expect(res.status).toBe(400)
    expect(structure().consolation_plays_for).toBeUndefined()
  })

  it('runs the settings patch as the playoffs section, so its lifecycle gate applies', async () => {
    await panelSave({ playoffTeamCount: 6, playoffStartWeek: 15 })
    expect(assertSettingsEditAllowed).toHaveBeenCalledWith('L', 'u', 'playoffs', expect.anything())
  })
})

describe('the canonical refusals now apply here, and a refused save writes nothing', () => {
  it('a field that pushes the final past the season is refused', async () => {
    // Eight teams from week 16: three rounds, final in week 18 of a 17-week season.
    m.prisma.redraftSeason.findFirst.mockImplementation(async (args: { where: { status?: string } }) =>
      args.where.status ? null : { id: 's1', totalWeeks: 17, playoffStartWeek: 16 },
    )
    const res = await panelSave({ playoffTeamCount: 8 })
    expect(res.status).toBe(400)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
    expect(row.playoffTeams).toBe(4)
  })

  it('more playoff teams than the league has is refused', async () => {
    row.leagueSize = 4
    const res = await panelSave({ playoffTeamCount: 6, playoffStartWeek: 15 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/league size/)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('a final that would end after the season (week 18 of 17) is refused', async () => {
    m.prisma.redraftSeason.findFirst.mockImplementation(async (args: { where: { status?: string } }) =>
      args.where.status ? null : { id: 's1', totalWeeks: 17, playoffStartWeek: 16 },
    )
    const res = await put({ championshipLength: 2 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/week 18/)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('a championship-length change during the playoffs is refused', async () => {
    inPlayoffs = true
    const res = await put({ championshipLength: 2 })
    expect(res.status).toBe(409)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('saves a length that fits, and the panel\'s 0 ("unset") still saves as one week', async () => {
    expect((await put({ championshipLength: 1 })).status).toBe(200)
    expect((await put({ championshipLength: 0 })).status).toBe(200)
    expect(structure().championship_length).toBe(1)
  })

  it('a team count changed to 0 or 1 is refused; an unchanged form is not', async () => {
    expect((await panelSave({ playoffTeamCount: 1 })).status).toBe(400)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
    expect((await panelSave({})).status).toBe(200)
    expect(row.playoffTeams).toBe(4)
  })
})
