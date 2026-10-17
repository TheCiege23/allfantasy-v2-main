import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db, loadCouncilContext } = vi.hoisted(() => ({
  db: {
    $queryRaw: vi.fn(),
    survivorGameState: { findUnique: vi.fn() },
    survivorVote: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    survivorAuditEntry: { findFirst: vi.fn(), create: vi.fn() },
    survivorTribalCouncil: { update: vi.fn() },
  },
  loadCouncilContext: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) } }))
vi.mock('@/lib/survivor/survivorCouncilService', async (orig) => ({ ...(await (orig as () => Promise<Record<string, unknown>>)()), loadCouncilContext }))

import { playShotInTheDark, shotInTheDarkAnnouncements } from '@/lib/survivor/survivorShotInTheDark'
import { tallyCouncil } from '@/lib/survivor/survivorVoteTallyService'
import { submitVote } from '@/lib/survivor/survivorVoteService'
import { parseSurvivorCommand } from '@/lib/survivor/SurvivorCommandParser'
import { computeCouncilEligibility } from '@/lib/survivor/survivorBallotEligibility'

const players = ['a', 'b', 'c', 'd'].map(id => ({ userId: id, rosterId: `r${id}`, displayName: id.toUpperCase() }))
function ctx(status: string, idolsPlayed: unknown[] = []) {
  return {
    council: { id: 'council-1', leagueId: 'league-1', week: 4, phase: 'pre_merge', status, attendingTribeId: 't', votingOpensAt: null, votingDeadline: null,
      voteDeadlineAt: new Date(Date.now() + 3_600_000), closedAt: null, isRevealed: false, doesNotCountVoteIds: [], idolsPlayed, tiePlayerIds: [] },
    settings: { lateVotesAllowed: false, selfVotesAllowed: false, voteChangePolicy: 'first_valid_locks', tieRule: 'revote_then_season_points' },
    scopePlayers: players,
    eligibility: computeCouncilEligibility({ scopePlayers: players, selfVotesAllowed: false, safeUserIds: [] }),
    rosterToUser: Object.fromEntries(players.map(p => [p.rosterId, p.userId])),
    userToRoster: Object.fromEntries(players.map(p => [p.userId, p.rosterId])),
  }
}
const ballot = (id: string, voter: string, target: string) => ({ id, voterRosterId: `r${voter}`, targetRosterId: `r${target}`, targetUserId: target, targetName: target.toUpperCase(), doesNotCount: false, isLateVote: false })

beforeEach(() => {
  vi.clearAllMocks()
  db.survivorGameState.findUnique.mockResolvedValue({ pausedSnapshot: null })
  db.survivorVote.findUnique.mockResolvedValue(null)
  db.survivorAuditEntry.findFirst.mockResolvedValue(null)
  loadCouncilContext.mockResolvedValue(ctx('voting_open'))
})

describe('playing Shot in the Dark', () => {
  it('records a sealed roll and gives up the vote without telling the player the result', async () => {
    const result = await playShotInTheDark('league-1', 'd', () => 0)
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining('learn the result when the votes are read') })
    const plays = db.survivorTribalCouncil.update.mock.calls[0][0].data.idolsPlayed
    expect(plays).toEqual([expect.objectContaining({ powerType: 'shot_in_the_dark', playerUserId: 'd', safe: true, protectedRosterId: 'rd' })])
    expect(db.survivorAuditEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: 'shot_in_the_dark_played', targetUserId: 'd', data: { safe: true }, isVisibleToCommissioner: false, isVisibleToPublic: false,
    }) }))
  })

  it('protects nobody on the five losing rolls', async () => {
    await playShotInTheDark('league-1', 'd', () => 3)
    expect(db.survivorTribalCouncil.update.mock.calls[0][0].data.idolsPlayed[0]).toMatchObject({ safe: false })
    expect(db.survivorTribalCouncil.update.mock.calls[0][0].data.idolsPlayed[0].protectedRosterId).toBeUndefined()
  })

  it('can be used once per season', async () => {
    db.survivorAuditEntry.findFirst.mockResolvedValue({ id: 'earlier' })
    expect(await playShotInTheDark('league-1', 'd', () => 0)).toMatchObject({ ok: false, code: 'already_used' })
    expect(db.survivorTribalCouncil.update).not.toHaveBeenCalled()
  })

  it('must be played instead of voting, not after', async () => {
    db.survivorVote.findUnique.mockResolvedValue({ id: 'my-ballot' })
    expect(await playShotInTheDark('league-1', 'd', () => 0)).toMatchObject({ ok: false, code: 'already_voted' })
  })

  it('is refused outside an open vote, for non-attendees, and while paused', async () => {
    loadCouncilContext.mockResolvedValueOnce(ctx('closed'))
    expect(await playShotInTheDark('league-1', 'd', () => 0)).toMatchObject({ ok: false, code: 'window_closed' })
    expect(await playShotInTheDark('league-1', 'outsider', () => 0)).toMatchObject({ ok: false, code: 'not_eligible_voter' })
    db.survivorGameState.findUnique.mockResolvedValue({ pausedSnapshot: {} })
    expect(await playShotInTheDark('league-1', 'd', () => 0)).toMatchObject({ ok: false, code: 'league_paused' })
  })

  it('blocks a ballot from the manager who played it', async () => {
    loadCouncilContext.mockResolvedValue(ctx('voting_open', [{ idolId: 'shot-in-the-dark:d', powerType: 'shot_in_the_dark', playerUserId: 'd', playerRosterId: 'rd', safe: false, playedAt: 'x' }]))
    expect(await submitVote('league-1', 'd', 'a')).toMatchObject({ ok: false, code: 'vote_given_up' })
  })

  it('is recognised as a private Chimmy command', () => {
    expect(parseSurvivorCommand('@Chimmy shot in the dark').intent).toBe('shot_in_the_dark')
    expect(parseSurvivorCommand('@chimmy play my Shot in the Dark!').intent).toBe('shot_in_the_dark')
  })
})

describe('the read after a Shot in the Dark', () => {
  const votes = [ballot('v1', 'a', 'd'), ballot('v2', 'b', 'd'), ballot('v3', 'c', 'a')]
  beforeEach(() => db.survivorVote.findMany.mockResolvedValue(votes))

  it('voids votes against a manager whose roll came up safe', async () => {
    loadCouncilContext.mockResolvedValue(ctx('closed', [{ idolId: 'shot-in-the-dark:d', powerType: 'shot_in_the_dark', playerUserId: 'd', playerRosterId: 'rd', protectedRosterId: 'rd', safe: true, playedAt: 'x' }]))
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok && res.tally.eliminatedUserId).toBe('a')
  })

  it('counts votes normally when the roll missed', async () => {
    loadCouncilContext.mockResolvedValue(ctx('closed', [{ idolId: 'shot-in-the-dark:d', powerType: 'shot_in_the_dark', playerUserId: 'd', playerRosterId: 'rd', safe: false, playedAt: 'x' }]))
    const res = await tallyCouncil('league-1', 'council-1')
    expect(res.ok && res.tally.eliminatedUserId).toBe('d')
  })

  it('announces each result at the Torch Ceremony', () => {
    const plays = [{ powerType: 'shot_in_the_dark', playerUserId: 'd', safe: true }, { powerType: 'vote_shield', playerUserId: 'a' }, { powerType: 'shot_in_the_dark', playerUserId: 'b', safe: false }]
    expect(shotInTheDarkAnnouncements(plays, id => id.toUpperCase())).toEqual([
      'D played their Shot in the Dark: SAFE. Votes against them do not count.',
      'B played their Shot in the Dark: not safe.',
    ])
  })
})
