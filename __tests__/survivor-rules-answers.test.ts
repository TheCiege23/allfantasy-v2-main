// @vitest-environment node
/**
 * Chimmy's rules answers come from the league's own settings and plan. The old answers read legacy
 * League columns nothing writes and quoted fixed numbers ("9 idols", "10 players remaining").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { answerSurvivorRules, isSurvivorChimmyAsk, survivorRulesTopic } from '@/lib/survivor/survivorRulesAnswers'
import { SURVIVOR_DEFAULT_FOUNDATION_SETTINGS } from '@/lib/survivor/survivorSettings'
import { buildSurvivorFullSeasonPlan, type SurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'

const settings = { ...SURVIVOR_DEFAULT_FOUNDATION_SETTINGS }
const plan = { version: 1, sport: 'NFL', season: 2026, castSize: 16, finalistCount: 3, startWeek: 1, endWeek: 17, openingWeek: 1, finaleWeek: 17,
  eliminationWeeks: [2, 3, 4, 5, 6, 7, 7, 8, 9, 10, 11, 12, 13], noEliminationWeeks: [1], regularSeasonLastDay: '2027-01-03' } as unknown as SurvivorFullSeasonPlan

describe('survivorRulesTopic', () => {
  it.each([
    ['How does voting work?', 'voting'],
    ['@Chimmy what happens in a tie', 'ties'],
    ['when is the merge?', 'merge'],
    ['How do idols work?', 'idols'],
    ['how does exile island work', 'exile'],
    ['how does the jury work?', 'jury'],
    ['When is the vote deadline?', 'voting'],
    ['what day is the torch ceremony?', 'schedule'],
    ['what are the rules?', 'overview'],
    ['How does Survivor work here?', 'overview'],
  ])('%s -> %s', (message, topic) => expect(survivorRulesTopic(message)).toBe(topic))

  it('ignores statements and chatter', () => {
    expect(survivorRulesTopic('nice game last night')).toBeNull()
    expect(survivorRulesTopic('@Chimmy vote @Ben')).toBeNull()
  })

  it('routes personal game questions and rules questions to the Survivor host, nothing else', () => {
    expect(isSurvivorChimmyAsk('@Chimmy do I have an idol? what are my powers')).toBe(true)
    expect(isSurvivorChimmyAsk('@Chimmy how does voting work?')).toBe(true)
    for (const fantasy of ['@Chimmy should I start Bijan or Achane', '@Chimmy when does Bijan play?', '@Chimmy who won the game?', '@Chimmy will CMC come back this week?',
      '@Chimmy how many AF tokens do I have?', '@Chimmy is there an advantage to starting Lamb?', '@Chimmy who is the winner of this trade?']) {
      expect(isSurvivorChimmyAsk(fantasy)).toBe(false)
    }
  })
})

describe('answerSurvivorRules', () => {
  it('voting follows the league switches', () => {
    const open = answerSurvivorRules('voting', { sport: 'NFL', settings: { ...settings, selfVotesAllowed: true, voteChangePolicy: 'first_valid_locks', tribalCouncilDay: 'Wednesday', tribalCouncilTime: '21:30' }, plan })
    expect(open).toContain('Wednesday at 9:30 PM ET')
    expect(open).toContain('Voting for yourself is allowed')
    expect(open).toContain('Your first valid vote locks in')
    const strict = answerSurvivorRules('voting', { sport: 'NFL', settings: { ...settings, nonVoterAutoCast: false }, plan })
    expect(strict).toContain('you have no vote that council')
  })

  it('ties name the configured rule', () => {
    expect(answerSurvivorRules('ties', { sport: 'NBA', settings: { ...settings, tieRule: 'rocks_immediately' }, plan: null })).toContain('straight to rocks')
    expect(answerSurvivorRules('ties', { sport: 'NBA', settings: { ...settings, tieRule: 'season_points_only' }, plan: null })).toContain('fewest season points')
  })

  it('idols use the league count, expiry and Shot in the Dark odds, or say they are off', () => {
    const on = answerSurvivorRules('idols', { sport: 'NFL', settings: { ...settings, idolCount: 5, idolExpiryMode: 'week', idolExpiryWeek: 11, shotInTheDarkOdds: 4 }, plan })
    expect(on).toContain('5 idols')
    expect(on).toContain('expire after week 11')
    expect(on).toContain('1 in 4')
    expect(answerSurvivorRules('idols', { sport: 'NFL', settings: { ...settings, idolsEnabled: false }, plan })).toContain('turned off')
  })

  it('merge reads the trigger and the live cast', () => {
    expect(answerSurvivorRules('merge', { sport: 'NHL', settings: { ...settings, mergeTriggerType: 'active_player_count', mergeActivePlayerCount: 9 }, plan, activeCount: 12 })).toContain('9 managers are left (12 are in the game now)')
    expect(answerSurvivorRules('merge', { sport: 'NHL', settings: { ...settings, mergeTriggerType: 'week', mergeWeek: 8 }, plan })).toContain('week 8')
  })

  it('exile explains the return, or that voted-out managers are simply out', () => {
    const on = answerSurvivorRules('exile', { sport: 'NFL', settings: { ...settings, exileIslandEnabled: true, eliminationOutcome: 'exile_island', exileReturnWeek: 9, exileReturnTokens: 3 }, plan })
    expect(on).toContain('end of week 9')
    expect(on).toContain('at least 3')
    expect(answerSurvivorRules('exile', { sport: 'NFL', settings: { ...settings, eliminationOutcome: 'removed_to_waivers' }, plan })).toContain('off in this league')
  })

  it('schedule names the finale, the bye weeks and double-elimination weeks from the plan', () => {
    const text = answerSurvivorRules('schedule', { sport: 'NFL', settings, plan })
    expect(text).toContain('finale in week 17')
    expect(text).toContain('Nobody goes home in week 1')
    expect(text).toContain('Week 7 sends two managers home')
  })

  it('jury names the finalist count from the plan', () => {
    expect(answerSurvivorRules('jury', { sport: 'NFL', settings, plan })).toContain('week 17 with 3 finalists')
  })
})

const h = vi.hoisted(() => ({
  db: {
    survivorPlayer: { findFirst: vi.fn(), count: vi.fn() },
    league: { findUnique: vi.fn() },
    survivorHostMessage: { create: vi.fn() },
    roster: { findFirst: vi.fn() },
    survivorIdol: { findMany: vi.fn() },
  },
  applyIdol: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/survivor/SurvivorIdolRegistry', () => ({ applyIdolPower: h.applyIdol }))
vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({ resolveSurvivorCurrentWeek: vi.fn(async () => 5) }))
vi.mock('@/lib/survivor/SurvivorTribalCouncilService', () => ({ getCouncil: vi.fn(async () => ({ id: 'c1', closedAt: null, voteDeadlineAt: new Date(Date.now() + 3600_000) })) }))
vi.mock('@/lib/survivor/leagueChatPoster', () => ({ postIdolPlayAnnouncement: vi.fn(async () => undefined) }))

import { handleChimmyPrivateMessage } from '@/lib/survivor/chimmyHandler'

const realPlan = buildSurvivorFullSeasonPlan({ sport: 'NFL', season: 2026, castSize: 16, now: new Date('2026-08-20T12:00:00Z'), draftAt: new Date('2026-09-01T12:00:00Z') })

describe('handleChimmyPrivateMessage — rules questions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.db.survivorPlayer.findFirst.mockResolvedValue({ userId: 'u1', displayName: 'Ava', playerState: 'active' })
    h.db.survivorPlayer.count.mockResolvedValue(11)
    h.db.league.findUnique.mockResolvedValue({ survivorPhase: 'pre_merge', sport: 'NFL', settings: { survivor_full_season_plan: realPlan } })
    h.db.roster.findFirst.mockResolvedValue({ id: 'r1' })
    h.db.survivorIdol.findMany.mockResolvedValue([{ id: 'i1', powerType: 'protect_self', powerLabel: 'Immunity Idol' }])
    h.applyIdol.mockResolvedValue({ ok: true })
  })

  it('answers "how do I play my idol?" and does not play it', async () => {
    const reply = await handleChimmyPrivateMessage('L1', 'u1', 'How do I play my idol?')
    expect(reply).toContain('**Idols**')
    expect(h.applyIdol).not.toHaveBeenCalled()
  })

  it('still plays the idol on a plain request', async () => {
    await handleChimmyPrivateMessage('L1', 'u1', 'I want to use my idol')
    expect(h.applyIdol).toHaveBeenCalledTimes(1)
  })

  it('answers from the league plan, including for a manager who is out', async () => {
    h.db.survivorPlayer.findFirst.mockResolvedValue({ userId: 'u1', displayName: 'Ava', playerState: 'eliminated' })
    expect(await handleChimmyPrivateMessage('L1', 'u1', 'When is the finale?')).toContain(`week ${realPlan.finaleWeek} with ${realPlan.finalistCount} finalists`)
  })

  it('a question about playing asks, never plays; the inventory question still lists the holder’s own idols', async () => {
    expect(await handleChimmyPrivateMessage('L1', 'u1', 'can I play my idol now?')).toContain('use my idol')
    expect(h.applyIdol).not.toHaveBeenCalled()
    expect(await handleChimmyPrivateMessage('L1', 'u1', 'do i have an idol?')).toContain('Immunity Idol')
  })
})
