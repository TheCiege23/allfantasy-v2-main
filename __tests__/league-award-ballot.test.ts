// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { awardBallotInput, awardTallies, recordAwardChoice, type AwardBallot } from '@/lib/league-chat/awardBallot'
import { createAwardSheetToken, readAwardSheetToken } from '@/lib/league-chat/awardSheetToken'

const opens = Date.parse('2026-11-21T22:00:00Z')
const closeAt = '2026-11-22T03:00:00.000Z'
const sample: AwardBallot = {
  name: 'Coach of the Year', season: 2026, closeAt,
  options: [{ id: 'a', label: 'Coach A' }, { id: 'b', label: 'Coach B' }], votes: [],
}

describe('league award votes', () => {
  it('keeps one vote per eligible user and makes retries idempotent', () => {
    let ballot = sample
    for (let i = 0; i < 500; i++) {
      const pick = recordAwardChoice(ballot, `manager-${i}`, i < 300 ? 'a' : 'b', opens)
      if (!pick.ok) throw new Error(pick.error)
      ballot = pick.ballot
    }
    const move = recordAwardChoice(ballot, 'manager-0', 'b', opens)
    if (!move.ok) throw new Error(move.error)
    const retry = recordAwardChoice(move.ballot, 'manager-0', 'b', opens)
    if (!retry.ok) throw new Error(retry.error)
    const exported = awardTallies(retry.ballot, Date.parse(closeAt))
    expect(exported).toMatchObject({ totalVotes: 500, winner: 'Coach A', closed: true,
      options: [{ id: 'a', count: 299 }, { id: 'b', count: 201 }] })
    expect(JSON.stringify(exported)).not.toContain('manager-')
  })

  it('leaves ties unresolved, refuses late and invalid choices, and requires distinct nominees', () => {
    const tie = { ...sample, votes: [{ userId: 'one', optionId: 'a' }, { userId: 'two', optionId: 'b' }] }
    expect(awardTallies(tie, opens)).toMatchObject({ outcome: 'Voting open', winner: null })
    expect(awardTallies(tie, Date.parse(closeAt))).toMatchObject({ outcome: 'Tie', winner: null })
    expect(recordAwardChoice(sample, 'one', 'outside', opens)).toMatchObject({ ok: false, status: 400 })
    expect(recordAwardChoice(sample, 'one', 'a', Date.parse(closeAt))).toMatchObject({ ok: false, status: 409 })
    expect(awardBallotInput.safeParse({ name: sample.name, closeAt, choices: ['A', 'a'],
      requestId: 'fde939eb-34df-4fd1-9bd2-e3827f029405' }).success).toBe(false)
  })

  it('uses league-scoped, signed and expiring sheet connections', () => {
    const old = process.env.AWARD_SHEET_EXPORT_SECRET
    process.env.AWARD_SHEET_EXPORT_SECRET = 'only-a-test-secret'
    try {
      const token = createAwardSheetToken('one', 'commissioner', opens)!
      expect(readAwardSheetToken(token, 'one', opens)).toBe('commissioner')
      expect(readAwardSheetToken(token, 'two', opens)).toBeNull()
      expect(readAwardSheetToken(token + '.changed', 'one', opens)).toBeNull()
      expect(readAwardSheetToken(token, 'one', opens + 367 * 86_400_000)).toBeNull()
    } finally {
      if (old === undefined) delete process.env.AWARD_SHEET_EXPORT_SECRET
      else process.env.AWARD_SHEET_EXPORT_SECRET = old
    }
  })
})
