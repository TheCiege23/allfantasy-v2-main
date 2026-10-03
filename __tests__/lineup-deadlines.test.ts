// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { lineupDeadlines } from '@/lib/core-app/lineupDeadlines'

const now = Date.parse('2026-09-27T12:00:00Z')
const thursday = new Date('2026-09-25T00:15:00Z')
const sunday = new Date('2026-09-27T17:00:00Z')
const monday = new Date('2026-09-29T00:15:00Z')

describe('individual lineup deadlines', () => {
  it('keeps a Sunday problem actionable after a healthy Thursday starter kicks off', () => {
    expect(lineupDeadlines([{ kickoff: thursday, issues: 0 }, { kickoff: sunday, issues: 1 }], 0, now))
      .toEqual({ started: 1, unknownKickoffs: 0, actionableSeverity: 1, lockAt: sunday.getTime(), locked: false })
  })
  it('does not rank a past flagged starter as a remaining action', () => {
    expect(lineupDeadlines([{ kickoff: thursday, issues: 1 }, { kickoff: sunday, issues: 0 }], 0, now))
      .toMatchObject({ actionableSeverity: 0, lockAt: sunday.getTime(), locked: false })
  })
  it('counts down to the flagged player instead of an unrelated healthy player', () => {
    expect(lineupDeadlines([{ kickoff: sunday, issues: 0 }, { kickoff: monday, issues: 1 }], 0, now).lockAt)
      .toBe(monday.getTime())
  })
  it('leaves unknown schedules and empty slots reviewable, without inventing a deadline', () => {
    expect(lineupDeadlines([{ kickoff: thursday, issues: 0 }, { kickoff: null, issues: 1 }], 1, now))
      .toEqual({ started: 1, unknownKickoffs: 1, actionableSeverity: 2, lockAt: null, locked: false })
  })
  it('only establishes a complete lock when every starter is past kickoff', () => {
    expect(lineupDeadlines([{ kickoff: thursday, issues: 1 }], 0, now).locked).toBe(true)
    expect(lineupDeadlines([], 0, now).locked).toBe(false)
    expect(lineupDeadlines([{ kickoff: thursday, issues: 1 }], 1, now).locked).toBe(false)
  })
})

/*
 * A starter on bye has no kickoff because his club is not playing — a known fact. Counting him
 * in `unknownKickoffs` made the board say "1 without a kickoff" and "schedule incomplete".
 */
describe('a starter on bye is not a missing schedule', () => {
  it('keeps him actionable but never counts him as an unknown kickoff', () => {
    const d = lineupDeadlines([{ kickoff: sunday, issues: 0 }, { kickoff: null, issues: 1, bye: true }], 0, now - 3_600_000)
    expect(d.unknownKickoffs).toBe(0)
    expect(d.actionableSeverity).toBe(1)
    expect(d.lockAt).toBe(sunday.getTime())
  })

  it('control: the same row without the bye flag is still an unknown kickoff', () => {
    expect(lineupDeadlines([{ kickoff: null, issues: 1 }], 0, now).unknownKickoffs).toBe(1)
  })

  it('a bye never establishes a whole-lineup lock', () => {
    expect(lineupDeadlines([{ kickoff: thursday, issues: 0 }, { kickoff: null, issues: 1, bye: true }], 0, now).locked).toBe(false)
  })
})
