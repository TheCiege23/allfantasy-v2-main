import { describe, expect, it } from 'vitest'
import { gateRevealPayload, isCouncilReadComplete, normalizeRevealPacing, REVEAL_STEP_MS, revealVisibleCount } from '@/lib/survivor/survivorRevealGate'
import { survivorPublicCouncil } from '@/lib/survivor/survivorPublicCouncil'

const start = new Date('2026-10-20T20:00:00.000Z')
const at = (ms: number) => new Date(start.getTime() + ms)
const sequence = [
  { order: 0, targetUserId: 'user-alpha', targetName: 'Alpha', status: 'counts', isExtraVote: false, voterUserId: 'voter-1', voterName: 'Secret Voter' },
  { order: 1, targetUserId: 'user-bravo', targetName: 'Bravo', status: 'blocked_by_idol', isExtraVote: false },
  { order: 2, targetUserId: 'user-charlie', targetName: 'Charlie', status: 'counts', isExtraVote: true },
  { order: 3, targetUserId: 'user-alpha', targetName: 'Alpha', status: 'counts', isExtraVote: false },
]
const council = {
  id: 'c1', leagueId: 'l1', week: 6, phase: 'pre_merge', status: 'revealed', isRevealed: true, revealStartsAt: start, revealStep: 0,
  revealSequence: sequence, eliminatedName: 'Alpha', eliminatedUserId: 'user-alpha', eliminatedRosterId: 'roster-alpha', isTie: false, tiePhase: null,
  votes: [{ voterUserId: 'voter-1', targetUserId: 'user-alpha' }], idolsPlayed: [{ idolId: 'idol-secret', powerType: 'vote_shield', playerUserId: 'user-bravo' }],
}

describe('reveal pacing from League.survivorRevealMode', () => {
  it.each([
    ['dramatic_sequential', 'one_at_a_time'], [null, 'one_at_a_time'], ['dramatic', 'one_at_a_time'],
    ['simultaneous', 'all_at_once'], ['commissioner', 'commissioner'],
  ])('%s → %s', (raw, pacing) => expect(normalizeRevealPacing(raw)).toBe(pacing))
})

describe('server-side step gating', () => {
  it('sends nothing before the council is published', () => {
    const gate = gateRevealPayload({ ...council, isRevealed: false, revealMode: 'dramatic_sequential', now: at(60_000) })
    expect(gate).toMatchObject({ started: false, steps: [], totalSteps: null, eliminatedName: null, isTie: false })
    expect(JSON.stringify(gate)).not.toMatch(/Alpha|Bravo|Charlie/)
  })

  it('sends nothing before revealStartsAt, even when published', () => {
    const gate = gateRevealPayload({ ...council, revealMode: 'simultaneous', now: at(-1) })
    expect(gate.started).toBe(false)
    expect(JSON.stringify(gate)).not.toMatch(/Alpha|Bravo|Charlie/)
  })

  it('one at a time releases one ballot per 2.5s and nothing beyond the current step', () => {
    const first = gateRevealPayload({ ...council, revealMode: 'dramatic_sequential', now: at(0) })
    expect(first.steps.map(s => s.targetName)).toEqual(['Alpha'])
    expect(first).toMatchObject({ totalSteps: 4, visibleSteps: 1, complete: false, eliminatedName: null, nextStepAt: at(REVEAL_STEP_MS).toISOString() })
    expect(JSON.stringify(first)).not.toMatch(/Bravo|Charlie/)

    const second = gateRevealPayload({ ...council, revealMode: 'dramatic_sequential', now: at(REVEAL_STEP_MS + 10) })
    expect(second.steps.map(s => s.targetName)).toEqual(['Alpha', 'Bravo'])
    expect(JSON.stringify(second)).not.toMatch(/Charlie/)

    const third = gateRevealPayload({ ...council, revealMode: 'dramatic_sequential', now: at(REVEAL_STEP_MS * 3 - 1) })
    expect(third.visibleSteps).toBe(3)
    expect(third.eliminatedName).toBeNull()
  })

  it('withholds the verdict until the last ballot is out, then sends it', () => {
    const done = gateRevealPayload({ ...council, revealMode: 'dramatic_sequential', now: at(REVEAL_STEP_MS * 3) })
    expect(done).toMatchObject({ visibleSteps: 4, complete: true, eliminatedName: 'Alpha', nextStepAt: null })
  })

  it('withholds a tie result mid-read', () => {
    const gate = gateRevealPayload({ ...council, isTie: true, tiePhase: 'revote_required', eliminatedName: null, revealMode: 'dramatic_sequential', now: at(0) })
    expect(gate).toMatchObject({ isTie: false, tiePhase: null })
  })

  it('commissioner pacing releases only what reveal_next has released', () => {
    expect(gateRevealPayload({ ...council, revealMode: 'commissioner', now: at(600_000) }).steps).toEqual([])
    const two = gateRevealPayload({ ...council, revealStep: 2, revealMode: 'commissioner', now: at(600_000) })
    expect(two.steps.map(s => s.targetName)).toEqual(['Alpha', 'Bravo'])
    expect(two.nextStepAt).toBeNull()
  })

  it('reveal_next can run ahead of the 2.5s clock, never behind it', () => {
    expect(revealVisibleCount({ isRevealed: true, revealStartsAt: start, revealStep: 3, total: 4, pacing: 'one_at_a_time', now: at(0) })).toBe(3)
    expect(revealVisibleCount({ isRevealed: true, revealStartsAt: start, revealStep: 0, total: 4, pacing: 'one_at_a_time', now: at(REVEAL_STEP_MS) })).toBe(2)
  })

  it('all at once releases the full tally at revealStartsAt', () => {
    const gate = gateRevealPayload({ ...council, revealMode: 'simultaneous', now: at(0) })
    expect(gate).toMatchObject({ mode: 'all_at_once', visibleSteps: 4, complete: true, eliminatedName: 'Alpha' })
  })

  it('steps carry the name voted for and the status only — never a voter or a user id', () => {
    const gate = gateRevealPayload({ ...council, revealMode: 'simultaneous', now: at(0) })
    expect(gate.steps[0]).toEqual({ order: 1, targetName: 'Alpha', status: 'counts', isExtraVote: false })
    expect(JSON.stringify(gate)).not.toMatch(/voter|user-alpha|Secret Voter/i)
  })
})

describe('public council projection', () => {
  it('releases ballots by step and keeps the elimination sealed mid-read', () => {
    const mid = survivorPublicCouncil(council, false, { revealMode: 'dramatic_sequential', now: at(REVEAL_STEP_MS) })!
    expect(mid.revealSequence?.map(s => s.targetName)).toEqual(['Alpha', 'Bravo'])
    expect(mid).toMatchObject({ status: 'revealing', eliminatedName: null, eliminatedUserId: null, eliminatedRosterId: null, isTie: false, revealComplete: false, revealTotalSteps: 4 })
    expect(JSON.stringify(mid)).not.toMatch(/Charlie|voter|idol-secret|user-alpha/i)
  })

  it('is fully sealed before revealStartsAt', () => {
    const early = survivorPublicCouncil({ ...council, revealStartsAt: at(60_000) }, false, { revealMode: 'simultaneous', now: at(0) })!
    expect(early).toMatchObject({ isRevealed: false, revealSequence: null, status: 'closed', eliminatedName: null })
    expect(JSON.stringify(early)).not.toMatch(/Alpha|Bravo|Charlie/)
  })

  it('shows the result once every step is out', () => {
    const done = survivorPublicCouncil(council, false, { revealMode: 'dramatic_sequential', now: at(REVEAL_STEP_MS * 10) })!
    expect(done).toMatchObject({ status: 'revealed', eliminatedName: 'Alpha', eliminatedRosterId: 'roster-alpha', revealComplete: true })
    expect(done.revealSequence).toHaveLength(4)
  })
})

describe('isCouncilReadComplete (history, recap, Chimmy, elimination)', () => {
  it('is false before publication, before revealStartsAt and mid-read; true after the last step', () => {
    expect(isCouncilReadComplete({ ...council, isRevealed: false }, 'simultaneous', at(60_000))).toBe(false)
    expect(isCouncilReadComplete(council, 'simultaneous', at(-1))).toBe(false)
    expect(isCouncilReadComplete(council, 'dramatic_sequential', at(REVEAL_STEP_MS * 3 - 1))).toBe(false)
    expect(isCouncilReadComplete(council, 'dramatic_sequential', at(REVEAL_STEP_MS * 3))).toBe(true)
    expect(isCouncilReadComplete(council, 'commissioner', at(86_400_000))).toBe(false)
    expect(isCouncilReadComplete({ ...council, revealStep: 4 }, 'commissioner', at(0))).toBe(true)
    expect(isCouncilReadComplete(council, 'simultaneous', at(0))).toBe(true)
  })
})
