import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ANSWERS,
  amendmentPollQuestion,
  buildConstitution,
  parseAnswers,
  parseSections,
  parseSettingChange,
  readyToApply,
  resolveAmendment,
  tally,
  type Amendment,
  type LeagueFacts,
} from '@/lib/constitution/constitutionBuilder'

const facts: LeagueFacts = {
  name: 'Dynasty Bros', sport: 'NFL', season: 2026, platform: 'native', leagueType: 'keeper', isDynasty: false,
  leagueSize: 12, rosterSize: 16, scoring: 'half_ppr', waiverType: 'faab', waiverBudget: 200, waiverMinBid: 0,
  tradeReviewHours: 24, tradeDeadlineWeek: 11, draftPickTrading: true, playoffTeams: 6, playoffStartWeek: 15,
  medianGame: true, irSlots: 2, taxiSlots: 0, keeperCount: 2, keeperMaxYears: 3, keeperRoundPenalty: 1,
  keeperMissedDeadlineRule: 'auto_no_keepers', tradeReviewMode: null, dues: { amount: 50, currency: 'USD' },
}
const text = (f: LeagueFacts, a = DEFAULT_ANSWERS) => buildConstitution(f, a).map((s) => `${s.title}\n${s.body}`).join('\n')

describe('buildConstitution', () => {
  it('writes the rules from the league’s own settings', () => {
    const t = text(facts)
    expect(t).toContain('12-team NFL keeper league')
    expect(t).toContain('Half-PPR')
    expect(t).toContain('$200 for the season')
    expect(t).toContain('trade deadline is the end of Week 11')
    expect(t).toContain('Future draft picks may be traded')
    expect(t).toContain('6 teams make the playoffs, starting in Week 15')
    expect(t).toContain('keep up to 2 players, each for at most 3 seasons')
    expect(t).toContain('a pick 1 round earlier')
    expect(t).toContain('Dues are $50 per team')
    expect(t).toContain('beating it counts as a win')
  })

  it('leaves out what the league does not have', () => {
    const t = text({ ...facts, leagueType: 'redraft', dues: null, tradeDeadlineWeek: null, draftPickTrading: false, medianGame: false })
    expect(t).not.toContain('Keepers')
    expect(t).not.toContain('Dues')
    expect(t).toContain('There is no trade deadline')
    expect(t).toContain('Draft picks may not be traded')
  })

  it('uses the commissioner’s answers', () => {
    const t = text(facts, { ...DEFAULT_ANSWERS, amendmentThreshold: 75, voteDays: 5, inactivityWeeks: 3, collusion: 'league_vote', houseRules: 'Last place wears the jersey.' })
    expect(t).toContain('5 days')
    expect(t).toContain('75%')
    expect(t).toContain('3 weeks without setting a lineup')
    expect(t).toContain('goes to a league vote')
    expect(t).toContain('House rules\nLast place wears the jersey.')
  })

  it('answers fall back to defaults when invalid', () => {
    expect(parseAnswers({ amendmentThreshold: 99, voteDays: 'x', collusion: 'duel' })).toEqual(DEFAULT_ANSWERS)
  })
})

describe('sections from the editor', () => {
  it('trims, drops empty ones and refuses an empty document', () => {
    expect(parseSections([{ title: ' A ', body: ' b ' }, { title: '', body: '' }])).toEqual([{ id: 's1', title: 'A', body: 'b' }])
    expect(parseSections([])).toBeNull()
    expect(parseSections([{ title: '', body: '' }])).toBeNull()
  })
})

describe('setting changes', () => {
  it('only listed settings, in range', () => {
    expect(parseSettingChange(null)).toBeNull()
    expect(parseSettingChange({ key: 'playoffTeams', value: '8' })).toEqual({ key: 'playoffTeams', value: 8 })
    expect(parseSettingChange({ key: 'playoffTeams', value: 40 })).toBe('invalid')
    expect(parseSettingChange({ key: 'leagueSize', value: 14 })).toBe('invalid')
    expect(parseSettingChange({ key: 'medianGame', value: 'yes' })).toBe('invalid')
    expect(parseSettingChange({ key: 'medianGame', value: true })).toEqual({ key: 'medianGame', value: true })
  })
})

describe('votes', () => {
  it('thresholds mean what they say', () => {
    expect(tally(2, 2, 50)).toBe('failed') // a tie is not a majority
    expect(tally(3, 2, 50)).toBe('passed')
    expect(tally(2, 1, 67)).toBe('passed') // two thirds
    expect(tally(5, 3, 67)).toBe('failed')
    expect(tally(3, 2, 60)).toBe('passed')
    expect(tally(2, 1, 75)).toBe('failed')
    expect(tally(3, 1, 75)).toBe('passed')
    expect(tally(0, 0, 50)).toBe('failed')
  })

  const base: Amendment = {
    id: 'A', title: 'Six playoff teams', text: '', change: { key: 'playoffTeams', value: 6 }, effective: 'next_season', threshold: 67,
    pollMessageId: 'm', closesAt: '2026-10-22T00:00:00Z', status: 'voting', yes: null, no: null, proposedBy: 'c',
    proposedAt: '2026-10-19T00:00:00Z', resolvedAt: null, appliedAt: null, applyError: null,
  }

  it('resolves only once the poll is closed', () => {
    const now = new Date('2026-10-22T01:00:00Z')
    expect(resolveAmendment(base, { yes: 9, no: 1, closed: false }, now)).toBe(base)
    expect(resolveAmendment(base, { yes: 8, no: 4, closed: true }, now)).toMatchObject({ status: 'passed', yes: 8, no: 4 })
    expect(resolveAmendment(base, { yes: 7, no: 5, closed: true }, now)).toMatchObject({ status: 'failed' })
  })

  it('next-season amendments wait for the rollover; text-only ones never apply', () => {
    const passed = { ...base, status: 'passed' as const }
    const now = { ...passed, id: 'B', effective: 'now' as const }
    const textOnly = { ...passed, id: 'C', change: null }
    expect(readyToApply([passed, now, textOnly], 'now').map((a) => a.id)).toEqual(['B'])
    expect(readyToApply([passed, now, textOnly], 'season_rollover').map((a) => a.id)).toEqual(['A', 'B'])
  })

  it('the poll question says what changes and when', () => {
    expect(amendmentPollQuestion(base)).toBe('📜 Amendment: Six playoff teams (Playoff teams → 6) — takes effect next season. Passes with 67% yes.')
  })
})
