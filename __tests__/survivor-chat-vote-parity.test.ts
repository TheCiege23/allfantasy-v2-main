// @vitest-environment node
/**
 * "@Chimmy vote X" / "vote X" in chat must record the same ballot the Tribal Council panel does.
 *
 * The panel posts `submit-vote` to the consolidated survivor route, which calls
 * survivorVoteService.submitVote: it writes voterUserId/targetUserId/targetName (what the panel's
 * "You voted: …" line reads), enforces the league's vote-change policy and late-vote rules, and
 * writes a private audit entry. The chat command used SurvivorVoteEngine.submitVote, which wrote a
 * roster-only row and let a locked vote be changed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  rosterFindMany: vi.fn(),
  leagueTeamFindMany: vi.fn(),
  appUserFindMany: vi.fn(),
  councilVoteSubmit: vi.fn(),
  legacyVoteSubmit: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: hm.rosterFindMany },
    leagueTeam: { findMany: hm.leagueTeamFindMany },
    appUser: { findMany: hm.appUserFindMany },
  },
}))
vi.mock('@/lib/live-draft-engine/auth', () => ({ getCurrentUserRosterIdForLeague: vi.fn(async () => 'roster-me') }))
vi.mock('@/lib/waiver-wire/roster-utils', () => ({ getRosterPlayerIds: vi.fn(() => []) }))
vi.mock('@/lib/zombie/rosterTeamMap', () => ({ getRosterTeamMap: vi.fn(async () => ({ rosterIdToTeamId: new Map() })) }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ isSurvivorLeague: vi.fn(async () => true) }))
vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({ resolveSurvivorCurrentWeek: vi.fn(async () => 3) }))
vi.mock('@/lib/survivor/SurvivorTribalCouncilService', () => ({ getCouncil: vi.fn(async () => ({ id: 'legacy-council' })) }))
vi.mock('@/lib/survivor/SurvivorVoteEngine', () => ({ submitVote: hm.legacyVoteSubmit }))
vi.mock('@/lib/survivor/survivorVoteService', () => ({ submitVote: hm.councilVoteSubmit }))
vi.mock('@/lib/survivor/SurvivorIdolRegistry', () => ({ applyIdolPower: vi.fn(), getActiveIdolsForRoster: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorChallengeEngine', () => ({
  submitChallengeAnswer: vi.fn(),
  getCurrentOpenChallengesForWeek: vi.fn(),
  getChallengeById: vi.fn(),
}))
vi.mock('@/lib/survivor/SurvivorFinaleEngine', () => ({ getFinaleState: vi.fn(), submitJuryVote: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorTribeService', () => ({ getTribeForRoster: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorMiniGameRegistry', () => ({ getMinigameDef: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({
  applySurvivorSitOutToMiniGames: vi.fn(),
  getEligibleSitOutCandidates: vi.fn(),
  nominateSurvivorSitOut: vi.fn(),
}))

async function run(command: string) {
  const { processSurvivorOfficialCommand } = await import('@/lib/survivor/SurvivorOfficialCommandService')
  return processSurvivorOfficialCommand({ leagueId: 'league-1', userId: 'user-me', command })
}

describe('Survivor chat vote uses the Tribal Council ballot service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.rosterFindMany.mockResolvedValue([
      { id: 'roster-me', platformUserId: 'user-me' },
      { id: 'roster-alpha', platformUserId: 'user-alpha' },
    ])
    hm.leagueTeamFindMany.mockResolvedValue([])
    hm.appUserFindMany.mockResolvedValue([
      { id: 'user-me', username: 'me', displayName: 'Me' },
      { id: 'user-alpha', username: 'alpha', displayName: 'Team Alpha' },
    ])
    // The legacy engine "succeeds" so a test that reaches it fails on an assertion, not a crash.
    hm.legacyVoteSubmit.mockResolvedValue({ ok: true })
    hm.councilVoteSubmit.mockResolvedValue({
      ok: true,
      councilId: 'council-1',
      locked: true,
      late: false,
      doesNotCount: false,
      targetUserId: 'user-alpha',
      targetName: 'Alpha',
      message: 'Vote received and locked.',
    })
  })

  it('records "@Chimmy vote X" for the named manager\'s account through survivorVoteService', async () => {
    const result = await run('@Chimmy vote Team Alpha')
    expect(hm.councilVoteSubmit).toHaveBeenCalledWith('league-1', 'user-me', 'user-alpha')
    expect(hm.legacyVoteSubmit).not.toHaveBeenCalled()
    expect(result).toMatchObject({ handled: true, ok: true, status: 200, intent: 'vote' })
    expect(result.message).toContain('Alpha')
    expect(result.message).toContain('Vote received and locked.')
  })

  it('passes a locked-vote refusal through with its own status instead of changing the ballot', async () => {
    hm.councilVoteSubmit.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'vote_locked',
      error: 'Your first valid vote is locked and cannot be changed.',
    })
    const result = await run('vote Team Alpha')
    expect(hm.legacyVoteSubmit).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      handled: true,
      ok: false,
      status: 409,
      error: 'Your first valid vote is locked and cannot be changed.',
    })
  })

  it('does not submit a ballot for a name that matches no manager', async () => {
    const result = await run('@chimmy vote Nobody Here')
    expect(hm.councilVoteSubmit).not.toHaveBeenCalled()
    expect(hm.legacyVoteSubmit).not.toHaveBeenCalled()
    expect(result).toMatchObject({ handled: true, ok: false, status: 400 })
    expect(result.error).toContain('Could not find manager')
  })
})
