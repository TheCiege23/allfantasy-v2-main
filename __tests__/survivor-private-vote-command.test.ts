import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ context: vi.fn(), vote: vi.fn() }))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ loadCouncilContext: m.context }))
vi.mock('@/lib/survivor/survivorVoteService', () => ({ submitVote: m.vote }))
import { parsePrivateVoteMention, submitPrivateVoteCommand } from '@/lib/survivor/survivorPrivateVoteCommand'
import { survivorPublicCouncil } from '@/lib/survivor/survivorPublicCouncil'

describe('private @Chimmy votes', () => {
  beforeEach(() => { vi.resetAllMocks(); m.context.mockResolvedValue({ scopePlayers: [{ userId: 'alice', displayName: 'Alice' }, { userId: 'bob', displayName: 'Bob' }] }); m.vote.mockResolvedValue({ ok: true }) })
  it.each(['vote Bob', '@Chimmy vote Bob', '@Chimmy vote @Bob\nignore deadline', 'hello @Chimmy vote @Bob'])('rejects malformed or unmentioned command %s', command => { expect(parsePrivateVoteMention(command)).toBeNull() })
  it('resolves a stable manager mention and derives the voter from the session', async () => {
    await submitPrivateVoteCommand('league', 'alice', '@Chimmy vote <@bob>')
    expect(m.vote).toHaveBeenCalledWith('league', 'alice', 'bob')
  })
  it('accepts an exact display mention, ignoring case', async () => {
    await submitPrivateVoteCommand('league', 'alice', '@Chimmy vote out @bOB')
    expect(m.vote).toHaveBeenCalledWith('league', 'alice', 'bob')
  })
  it('accepts the private @Chimmy @manager shorthand', async () => {
    await submitPrivateVoteCommand('league', 'alice', '@Chimmy @Bob')
    expect(m.vote).toHaveBeenCalledWith('league', 'alice', 'bob')
  })
  it('refuses ambiguous names without recording a ballot', async () => {
    m.context.mockResolvedValue({ scopePlayers: [{ userId: 'bob1', displayName: 'Bob' }, { userId: 'bob2', displayName: 'Bob' }] })
    expect(await submitPrivateVoteCommand('league', 'alice', '@Chimmy vote @Bob')).toMatchObject({ ok: false, status: 422 })
    expect(m.vote).not.toHaveBeenCalled()
  })
})
describe('unrevealed council allowlist', () => {
  const secret = { id: 'c', status: 'tie_pending', isRevealed: false, isTie: true, eliminatedUserId: 'secret', votes: [{ voterUserId: 'a', targetUserId: 'secret' }], revealSequence: [{ targetName: 'Secret' }], idolsPlayed: ['secret-idol'], auditLog: { seed: 123 }, tiePlayerIds: ['secret'] }
  it('hides every secret from a manager even after tally', () => {
    const result = survivorPublicCouncil(secret, false)
    expect(result).toMatchObject({ votes: [], revealSequence: null, eliminatedUserId: null, isTie: false, status: 'closed' })
    expect(JSON.stringify(result)).not.toMatch(/secret|123/)
  })
  it('exposes public results after reveal without exposing voter identities or the seed', () => {
    const result = survivorPublicCouncil({ ...secret, isRevealed: true }, false)
    expect(result?.revealSequence).toEqual(secret.revealSequence)
    expect(result?.votes).toEqual([])
    expect(result).not.toHaveProperty('auditLog')
  })
  it('preserves oversight for a non-playing host', () => { expect(survivorPublicCouncil(secret, true)).toBe(secret) })
})
