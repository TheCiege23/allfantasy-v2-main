import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadLeagueGroundingForUser: vi.fn(),
}))

vi.mock('@/lib/chimmy/chimmy-league-snapshot', () => ({
  loadLeagueGroundingForUser: h.loadLeagueGroundingForUser,
}))

import { resolveDecisionContext } from '@/lib/decision-os/envelope/contextResolver'
import {
  classifyEnvelopeIntent,
  detectSport,
  requiresLeague,
  resolveContextScope,
  resolveTemporalScope,
} from '@/lib/decision-os/envelope/intent'
import { ENVELOPE_SPORTS } from '@/lib/decision-os/envelope/types'

/** A membership-verified snapshot, shaped like the real one. */
function snapshot(over: Record<string, unknown> = {}) {
  return {
    id: 'lg-1',
    name: 'Dynasty Warriors',
    sport: 'NFL',
    platform: 'sleeper',
    platformLeagueId: 'sl-1',
    season: 2026,
    leagueSize: 12,
    scoring: 'PPR',
    leagueVariant: null,
    isDynasty: true,
    status: 'active',
    timezone: 'America/New_York',
    lastSyncedAt: null,
    importBatchId: null,
    importedAt: null,
    leagueType: 'dynasty',
    settings: {},
    keeperCount: 3,
    keeperCostSystem: 'round_based',
    keeperRoundPenalty: 1,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.loadLeagueGroundingForUser.mockResolvedValue({ ok: true, snapshot: snapshot() })
})

describe('a global historical question needs no league', () => {
  it('classifies as a historical fact', () => {
    expect(classifyEnvelopeIntent('Who won the 1992 World Series?')).toBe('historical_fact')
  })

  it('resolves without a league and without refusing', async () => {
    const r = await resolveDecisionContext({
      message: 'Who won the 1992 World Series?',
      userId: 'u1',
      candidates: [],
    })
    expect(r.league).toBeNull()
    expect(r.refusals).toEqual([])
    expect(r.contextScope).toBe('global_sport')
    expect(r.temporalScope).toBe('historical')
  })

  it('does NOT read any league, so a global question costs no league query', async () => {
    await resolveDecisionContext({ message: 'Who won the 1992 World Series?', userId: 'u1', candidates: [] })
    expect(h.loadLeagueGroundingForUser).not.toHaveBeenCalled()
  })

  it('stays global even when a league IS selected', async () => {
    /*
     * A settled historical fact does not become a league question because the
     * user happens to have a league open.
     */
    const r = await resolveDecisionContext({
      message: 'Who won the 1992 World Series?',
      userId: 'u1',
      candidates: [{ id: 'lg-1', source: 'active_selection' }],
    })
    expect(r.contextScope).toBe('global_sport')
  })
})

describe('league-specific question with authorization', () => {
  it('resolves the league and reports where it came from', async () => {
    const r = await resolveDecisionContext({
      message: 'What are the keeper rules in my league?',
      userId: 'u1',
      candidates: [{ id: 'lg-1', source: 'explicit_request' }],
    })
    expect(r.intent).toBe('league_rule')
    expect(r.league?.id).toBe('lg-1')
    expect(r.resolvedFrom).toBe('explicit_request')
    expect(r.refusals).toEqual([])
  })

  it('carries the rules version the answer was computed against', async () => {
    const r = await resolveDecisionContext({
      message: 'What are the keeper rules in my league?',
      userId: 'u1',
      candidates: [{ id: 'lg-1', source: 'explicit_request' }],
    })
    expect(r.league?.rulesVersion).toBeTruthy()
  })
})

describe('precedence', () => {
  it('an explicit request beats an active selection', async () => {
    h.loadLeagueGroundingForUser.mockImplementation(async (_u: string, id: string) => ({
      ok: true,
      snapshot: snapshot({ id }),
    }))
    const r = await resolveDecisionContext({
      message: 'what are my league rules',
      userId: 'u1',
      candidates: [
        { id: 'lg-active', source: 'active_selection' },
        { id: 'lg-explicit', source: 'explicit_request' },
      ],
    })
    expect(r.league?.id).toBe('lg-explicit')
    expect(r.resolvedFrom).toBe('explicit_request')
  })

  it('an active selection beats conversation context', async () => {
    h.loadLeagueGroundingForUser.mockImplementation(async (_u: string, id: string) => ({
      ok: true,
      snapshot: snapshot({ id }),
    }))
    const r = await resolveDecisionContext({
      message: 'what are my league rules',
      userId: 'u1',
      candidates: [
        { id: 'lg-conv', source: 'conversation' },
        { id: 'lg-active', source: 'active_selection' },
      ],
    })
    expect(r.resolvedFrom).toBe('active_selection')
  })

  it('conversation context resolves only when it yields exactly one', async () => {
    h.loadLeagueGroundingForUser.mockImplementation(async (_u: string, id: string) => ({
      ok: true,
      snapshot: snapshot({ id }),
    }))
    const r = await resolveDecisionContext({
      message: 'what are my league rules',
      userId: 'u1',
      candidates: [{ id: 'lg-only', source: 'conversation' }],
    })
    expect(r.league?.id).toBe('lg-only')
  })
})

describe('ambiguity is asked about, never guessed', () => {
  beforeEach(() => {
    h.loadLeagueGroundingForUser.mockImplementation(async (_u: string, id: string) => ({
      ok: true,
      snapshot: snapshot({ id }),
    }))
  })

  it('two authorized leagues in the same tier refuses with ambiguous_league', async () => {
    const r = await resolveDecisionContext({
      message: 'what are my league rules',
      userId: 'u1',
      candidates: [
        { id: 'lg-a', source: 'active_selection' },
        { id: 'lg-b', source: 'active_selection' },
      ],
    })
    expect(r.refusals.map((x) => x.code)).toContain('ambiguous_league')
  })

  it('🛑 picks NONE of them — no league is attached', async () => {
    /*
     * The failure this prevents: advice about the wrong roster, in the same
     * confident voice as advice about the right one.
     */
    const r = await resolveDecisionContext({
      message: 'what are my league rules',
      userId: 'u1',
      candidates: [
        { id: 'lg-a', source: 'active_selection' },
        { id: 'lg-b', source: 'active_selection' },
      ],
    })
    expect(r.league).toBeNull()
  })

  it('asks the user rather than stating a rule', async () => {
    const r = await resolveDecisionContext({
      message: 'what are my league rules',
      userId: 'u1',
      candidates: [
        { id: 'lg-a', source: 'active_selection' },
        { id: 'lg-b', source: 'active_selection' },
      ],
    })
    expect(r.refusals[0].remedy).toMatch(/which league/i)
  })
})

describe('unauthorized league fails closed', () => {
  beforeEach(() => h.loadLeagueGroundingForUser.mockResolvedValue({ ok: false, reason: 'not_member' }))

  it('attaches no league', async () => {
    const r = await resolveDecisionContext({
      message: 'what are my league rules',
      userId: 'stranger',
      candidates: [{ id: 'lg-private', source: 'explicit_request' }],
    })
    expect(r.league).toBeNull()
    expect(r.snapshot).toBeNull()
  })

  it('refuses with not_authorized', async () => {
    const r = await resolveDecisionContext({
      message: 'what are my league rules',
      userId: 'stranger',
      candidates: [{ id: 'lg-private', source: 'explicit_request' }],
    })
    expect(r.refusals.map((x) => x.code)).toContain('not_authorized')
  })

  it('🛑 the refusal names no id and no reason detail', async () => {
    /*
     * "You are not a member of lg-private" confirms lg-private exists. The
     * distinction between not-a-member and no-such-league is known internally
     * and deliberately not repeated to the caller.
     */
    const r = await resolveDecisionContext({
      message: 'what are my league rules',
      userId: 'stranger',
      candidates: [{ id: 'lg-private', source: 'explicit_request' }],
    })
    const text = JSON.stringify(r.refusals)
    expect(text).not.toContain('lg-private')
    expect(text).not.toContain('not_member')
  })

  it('an anonymous caller never reaches a league read at all', async () => {
    const r = await resolveDecisionContext({
      message: 'what are my league rules',
      userId: null,
      candidates: [{ id: 'lg-private', source: 'explicit_request' }],
    })
    expect(h.loadLeagueGroundingForUser).not.toHaveBeenCalled()
    expect(r.league).toBeNull()
  })

  it('an unauthorized id is not used even when ONE other league IS authorized', async () => {
    h.loadLeagueGroundingForUser.mockImplementation(async (_u: string, id: string) =>
      id === 'lg-mine' ? { ok: true, snapshot: snapshot({ id }) } : { ok: false, reason: 'not_member' }
    )
    const r = await resolveDecisionContext({
      message: 'what are my league rules',
      userId: 'u1',
      candidates: [
        { id: 'lg-theirs', source: 'explicit_request' },
        { id: 'lg-mine', source: 'active_selection' },
      ],
    })
    // The explicit tier had no survivor, so the active tier wins — not the unauthorized id.
    expect(r.league?.id).toBe('lg-mine')
  })
})

describe('the seven sports classify', () => {
  const cases: Array<[string, string]> = [
    ['NFL', 'Who leads the NFL in rushing?'],
    ['NBA', 'Who leads the NBA in assists?'],
    ['NHL', 'Who won the Stanley Cup?'],
    ['MLB', 'Who won the World Series?'],
    ['NCAAF', 'Best college football team?'],
    ['NCAAB', 'March Madness bracket favorites?'],
    ['SOCCER', 'Who leads the Premier League?'],
  ]

  it.each(cases)('%s', (sport, message) => {
    expect(detectSport(message)).toBe(sport)
  })

  it('covers exactly the seven the contract names', () => {
    expect([...ENVELOPE_SPORTS].sort()).toEqual(
      ['MLB', 'NBA', 'NCAAB', 'NCAAF', 'NFL', 'NHL', 'SOCCER'].sort()
    )
  })

  it('⚠ bare "football" stays null rather than guessing', () => {
    /*
     * It means NFL to one user and soccer to another. A guess here is a
     * confidently wrong sport, so ambiguity is preserved.
     */
    expect(detectSport('who is the best football player')).toBeNull()
  })
})

describe('the thirteen intents are distinguishable', () => {
  const cases: Array<[string, string]> = [
    ['historical_fact', 'Who won the 1992 World Series?'],
    ['live_fact', 'What is the score right now?'],
    ['upcoming_schedule', 'When is the next game?'],
    ['player_info', 'What is his injury status?'],
    ['league_rule', 'What are the keeper rules?'],
    ['player_valuation', 'What is he worth?'],
    ['trade_evaluation', 'Should I accept this trade?'],
    ['waiver_add_drop', 'Who should I add off waivers?'],
    ['draft_decision', 'Who should I draft at 1.05?'],
    ['roster_strategy', 'Is my team contending or rebuilding?'],
    ['commissioner', 'Can the commissioner veto that?'],
    ['unsupported_non_sports', 'Should I bet on this game?'],
    ['action_request', 'Submit the waiver claim for me'],
  ]

  it.each(cases)('%s', (intent, message) => {
    expect(classifyEnvelopeIntent(message)).toBe(intent)
  })

  it('every one of the thirteen is reachable — no dead branch', () => {
    const reached = new Set(cases.map(([intent]) => intent))
    expect(reached.size).toBe(13)
  })
})

describe('temporal scope separates fact from projection', () => {
  it('a valuation is projected, never current', () => {
    /*
     * Labelling a model's view of the future `current` invites it to be worded
     * as a fact, which is what the scope exists to prevent.
     */
    expect(resolveTemporalScope('what is he worth', 'player_valuation')).toBe('projected')
    expect(resolveTemporalScope('should i trade him', 'trade_evaluation')).toBe('projected')
  })

  it('a historical fact is historical and a live one is live', () => {
    expect(resolveTemporalScope('who won in 1992', 'historical_fact')).toBe('historical')
    expect(resolveTemporalScope('score right now', 'live_fact')).toBe('live')
  })
})

describe('which intents need a league', () => {
  it('rules, commissioner, trade, waiver, roster and actions do', () => {
    for (const i of ['league_rule', 'commissioner', 'trade_evaluation', 'waiver_add_drop', 'roster_strategy', 'action_request'] as const) {
      expect(requiresLeague(i), i).toBe(true)
    }
  })

  it('global facts do not', () => {
    for (const i of ['historical_fact', 'live_fact', 'upcoming_schedule', 'player_info', 'player_valuation'] as const) {
      expect(requiresLeague(i), i).toBe(false)
    }
  })

  it('a league-needing intent with no league refuses rather than answering vaguely', async () => {
    const r = await resolveDecisionContext({
      message: 'what are my league rules',
      userId: 'u1',
      candidates: [],
    })
    expect(r.refusals.map((x) => x.code)).toContain('no_league_selected')
  })

  it('and resolveContextScope degrades roster to global without a league', () => {
    expect(resolveContextScope('roster_strategy', false)).toBe('global_sport')
    expect(resolveContextScope('roster_strategy', true)).toBe('roster')
  })
})
