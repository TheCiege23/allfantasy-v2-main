import { describe, expect, it } from 'vitest'

import { liveFirstSeen } from '@/lib/chimmy-alerts/liveStatusFold'
import { designationKey, designationOnset } from '@/lib/core-app/designationOnset'
import { isOutDesignation } from '@/lib/core-app/injuryStatus'
import { clockEt, inactiveSentence, pregameInactive } from '@/lib/core-app/pregameInactive'

/*
 * Pregame inactives. No feed publishes the inactive list as such: the NFL folds
 * it into "Out", and what tells it from a Friday ruling is WHEN the word
 * landed. Kickoff: Sunday 2026-10-25 1:00pm ET (17:00Z).
 */

const KICK = '2026-10-25T17:00:00.000Z'

describe('isOutDesignation', () => {
  it('is the game-day word only — not the season-scale rulings isRuledOut also covers', () => {
    expect(isOutDesignation('Out')).toBe(true)
    expect(isOutDesignation('OUT')).toBe(true)
    expect(isOutDesignation('Out - Ankle')).toBe(true)
    expect(isOutDesignation('IR')).toBe(false)
    expect(isOutDesignation('PUP')).toBe(false)
    expect(isOutDesignation('Suspension')).toBe(false)
    expect(isOutDesignation('Doubtful')).toBe(false)
    expect(isOutDesignation('Questionable')).toBe(false)
    expect(isOutDesignation(null)).toBe(false)
  })
})

describe('pregameInactive', () => {
  it('reads an Out that landed inside the last two hours before kickoff as the inactive list, with the announce clock', () => {
    const p = pregameInactive('Out', '2026-10-25T15:32:00.000Z', KICK)
    expect(p).toEqual({ announcedAt: '2026-10-25T15:32:00.000Z', minutesBeforeKickoff: 88, clock: '11:32a ET' })
    expect(inactiveSentence(p!)).toBe('Declared inactive at 11:32a ET, 88 min before kickoff')
    expect(pregameInactive('Out', KICK, KICK)).toMatchObject({ minutesBeforeKickoff: 0 })
    expect(inactiveSentence(pregameInactive('Out', KICK, KICK)!)).toBe('Declared inactive at 1:00p ET, at kickoff')
  })

  it('is not an inactive when the Out is older than the window, after kickoff, or carries no time of day', () => {
    expect(pregameInactive('Out', '2026-10-23T20:31:00.000Z', KICK)).toBeNull() // Friday's ruling
    expect(pregameInactive('Out', '2026-10-25T14:59:00.000Z', KICK)).toBeNull() // 121 min: outside the window
    expect(pregameInactive('Out', '2026-10-25T17:05:00.000Z', KICK)).toBeNull() // after kickoff
    expect(pregameInactive('Out', '2026-10-25T00:00:00.000Z', KICK)).toBeNull() // date-only: nowhere to place it
    expect(pregameInactive('Out', null, KICK)).toBeNull()
    expect(pregameInactive('Out', '2026-10-25T15:32:00.000Z', null)).toBeNull()
  })

  it('never calls a forecast or a season-scale ruling inactive, whatever the clock', () => {
    expect(pregameInactive('Doubtful', '2026-10-25T15:32:00.000Z', KICK)).toBeNull()
    expect(pregameInactive('Questionable', '2026-10-25T15:32:00.000Z', KICK)).toBeNull()
    expect(pregameInactive('IR', '2026-10-25T15:32:00.000Z', KICK)).toBeNull()
  })

  it('prints the announce clock in Eastern so the server and the browser agree', () => {
    expect(clockEt('2026-10-25T15:32:00.000Z')).toBe('11:32a ET')
    expect(clockEt('2026-10-26T00:20:00.000Z')).toBe('8:20p ET')
    expect(clockEt('not a date')).toBe('')
  })
})

describe('designationOnset', () => {
  const fri = new Date('2026-10-23T20:31:00.000Z')
  const sunFold = new Date('2026-10-25T09:00:00.000Z') // the fold's first sight at window-open, 5:00a ET
  const sunScratch = new Date('2026-10-25T15:32:00.000Z')
  const fetchedNow = new Date('2026-10-25T15:35:00.000Z')
  const fetchedEarlier = new Date('2026-10-25T15:20:00.000Z')

  it('takes the freshest row’s word and the EARLIEST report of that word across sources', () => {
    // ESPN said Out on Friday; the live fold, always freshest, first saw it Sunday morning.
    const onset = designationOnset([
      { status: 'Out', description: null, date: sunFold, fetchedAt: fetchedNow },
      { status: 'Out', description: 'Ankle', date: fri, fetchedAt: fetchedEarlier },
    ])
    expect(onset).toEqual({ status: 'Out', description: 'Ankle', reportedAt: fri })
  })

  it('dates a scratch to the live fold when no other feed has caught up — the pregame inactive case', () => {
    const onset = designationOnset([
      { status: 'Out', description: null, date: sunScratch, fetchedAt: fetchedNow },
      { status: 'Questionable', description: 'Ankle', date: fri, fetchedAt: fetchedEarlier },
    ])
    expect(onset).toEqual({ status: 'Out', description: null, reportedAt: sunScratch })
    expect(pregameInactive(onset!.status, onset!.reportedAt!.toISOString(), KICK)).toMatchObject({ minutesBeforeKickoff: 88 })
  })

  it('ignores a same-word row from an earlier episode, keeps a dated row over an undated one, and folds spellings', () => {
    const june = new Date('2026-06-12T21:21:00.000Z')
    const onset = designationOnset([
      { status: 'OUT', description: null, date: null, fetchedAt: fetchedNow },
      { status: 'Out.', description: 'Knee', date: sunScratch, fetchedAt: fetchedEarlier },
      { status: 'Out', description: 'Hamstring', date: june, fetchedAt: new Date('2026-06-12T22:00:00.000Z') },
    ])
    expect(onset).toEqual({ status: 'OUT', description: 'Knee', reportedAt: sunScratch })
    expect(designationKey('Out.')).toBe('out')
    expect(designationKey('I.L.')).toBe('il')
    expect(designationOnset([])).toBeNull()
    expect(designationOnset([{ status: 'Out', description: null, date: null, fetchedAt: fetchedNow }])).toEqual({ status: 'Out', description: null, reportedAt: null })
  })
})

describe('liveFirstSeen', () => {
  const first = new Date('2026-10-25T15:32:00.000Z')
  const now = new Date('2026-10-25T15:37:00.000Z')

  it('keeps the instant the word was first seen across re-folds, and resets it when the word changes', () => {
    expect(liveFirstSeen(undefined, 'Out', now)).toEqual(now)
    expect(liveFirstSeen({ status: 'Out', date: first }, 'Out', now)).toEqual(first)
    expect(liveFirstSeen({ status: 'out', date: first }, 'OUT', now)).toEqual(first)
    expect(liveFirstSeen({ status: 'Doubtful', date: first }, 'Out', now)).toEqual(now)
    expect(liveFirstSeen({ status: 'Out', date: null }, 'Out', now)).toEqual(now)
  })
})
