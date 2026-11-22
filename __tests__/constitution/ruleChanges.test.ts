import { describe, expect, it } from 'vitest'

import {
  amendmentPollQuestion,
  describeChangePreview,
  effectiveLabel,
  pruneAmendments,
  ruleLogEntry,
  voteReminderDue,
  voteReminderText,
  type Amendment,
} from '@/lib/constitution/constitutionBuilder'

const NOW = new Date('2026-11-07T12:00:00Z')
const a = (over: Partial<Amendment> = {}): Amendment => ({
  id: 'a1', title: 'Later deadline', text: '', change: { key: 'tradeDeadlineWeek', value: 13 }, effective: 'next_season', effectiveSeason: 2027,
  threshold: 67, pollMessageId: 'm1', closesAt: new Date(NOW.getTime() + 6 * 3_600_000).toISOString(), status: 'voting',
  yes: null, no: null, proposedBy: 'u1', proposedAt: NOW.toISOString(), resolvedAt: null, appliedAt: null, applyError: null, ...over,
})

describe('what a vote shows', () => {
  it('previews the change against what the league has now', () => {
    expect(describeChangePreview({ key: 'tradeDeadlineWeek', value: 13 }, 11)).toBe('Trade deadline week: 11 → 13')
    expect(describeChangePreview({ key: 'medianGame', value: true }, false)).toBe('Median game: off → on')
    expect(describeChangePreview({ key: 'tradeDeadlineWeek', value: 13 }, undefined)).toBe('Trade deadline week → 13')
  })

  it('names the season a next-season change takes effect in', () => {
    expect(effectiveLabel(a())).toBe('Takes effect in the 2027 season')
    expect(effectiveLabel(a({ effective: 'now' }))).toBe('Takes effect when it passes')
    expect(effectiveLabel(a({ effectiveSeason: undefined }))).toBe('Takes effect next season')
    expect(amendmentPollQuestion(a({ previousValue: 11 }))).toContain('(Trade deadline week: 11 → 13) — takes effect in the 2027 season')
  })
})

describe('the vote reminder', () => {
  it('is due once, inside the last day of an open vote', () => {
    expect(voteReminderDue(a(), NOW)).toBe(true)
    expect(voteReminderDue(a({ reminderSentAt: NOW.toISOString() }), NOW)).toBe(false)
    expect(voteReminderDue(a({ closesAt: new Date(NOW.getTime() + 30 * 3_600_000).toISOString() }), NOW)).toBe(false)
    expect(voteReminderDue(a({ closesAt: new Date(NOW.getTime() - 1000).toISOString() }), NOW)).toBe(false)
    expect(voteReminderDue(a({ status: 'pending_approval' }), NOW)).toBe(false)
    expect(voteReminderText(a(), NOW)).toContain('closes in 6 hours')
  })
})

describe('the permanent log', () => {
  it('reads each audit row as one sentence, finding older titles by id', () => {
    const titles = new Map([['a9', 'Old rule']])
    expect(ruleLogEntry({ actionType: 'amendment_passed', createdAt: NOW.toISOString(), afterState: { id: 'a9', yes: 8, no: 2 } }, titles)?.text).toBe('Passed: "Old rule" — 8 yes, 2 no.')
    expect(ruleLogEntry({ actionType: 'amendment_declined', createdAt: NOW.toISOString(), afterState: { title: 'Ban QBs', reason: 'Not a rule' } }, titles)?.text).toBe('Declined by the commissioner: "Ban QBs" — Not a rule.')
    expect(ruleLogEntry({ actionType: 'constitution_published', createdAt: NOW.toISOString(), afterState: { version: 3 } }, titles)?.text).toBe('Constitution published — version 3.')
    expect(ruleLogEntry({ actionType: 'something_else', createdAt: NOW.toISOString(), afterState: {} }, titles)).toBeNull()
  })

  it('a waiting proposal is never pruned away', () => {
    const many = Array.from({ length: 120 }, (_, i) => a({ id: `d${i}`, status: 'failed', resolvedAt: new Date(NOW.getTime() - i * 1000).toISOString() }))
    const kept = pruneAmendments([a({ id: 'wait', status: 'pending_approval' }), ...many])
    expect(kept.some((x) => x.id === 'wait')).toBe(true)
    expect(kept).toHaveLength(100)
  })
})

describe('the permanent log — punctuation', () => {
  it('a reason that already ends a sentence is not given a second full stop', () => {
    expect(ruleLogEntry({ actionType: 'amendment_declined', createdAt: NOW.toISOString(), afterState: { title: 'X', reason: 'No.' } }, new Map())?.text).toBe('Declined by the commissioner: "X" — No.')
  })
})
