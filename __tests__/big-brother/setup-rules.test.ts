// @vitest-environment node
/**
 * Big Brother setup choices reach the game (lib/big-brother/bigBrotherSetupRules.ts), the config save changes only
 * what it is given (upsertBigBrotherConfig), and existing leagues get their choices once, over built-in defaults only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  bigBrotherLeagueConfig: { findUnique: vi.fn(), upsert: vi.fn() },
  bigBrotherCycle: { count: vi.fn() },
  leagueAuditLog: { create: vi.fn() },
  $executeRaw: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { BIG_BROTHER_CONFIG_DEFAULTS, upsertBigBrotherConfig } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { bigBrotherConfigFromSetup, setupRulesForExistingLeague } from '@/lib/big-brother/bigBrotherSetupRules'
import { applyBigBrotherSetupRules } from '@/lib/big-brother/bigBrotherSetupRulesApply'

const setup = {
  big_brother_finale_format: 'final_3',
  big_brother_jury_mode: 'after_eliminations',
  big_brother_challenge_mode: 'deterministic_score',
  big_brother_tie_break: 'hoh_vote',
  big_brother_consecutive_hoh: true,
}
const defaults = BIG_BROTHER_CONFIG_DEFAULTS as unknown as Record<string, unknown>

describe('what the setup choices ask the game for', () => {
  it('maps each choice onto the field the engine reads', () => {
    expect(bigBrotherConfigFromSetup(setup)).toEqual({
      finaleFormat: 'final_3',
      juryStartMode: 'after_eliminations',
      challengeMode: 'deterministic_score',
      evictionTieBreakMode: 'hoh_vote',
      consecutiveHohAllowed: true,
    })
  })

  it('ignores values the game does not know, and a league with no choices asks for nothing', () => {
    expect(bigBrotherConfigFromSetup({ big_brother_tie_break: 'coin_flip', big_brother_finale_format: 'final_9' })).toEqual({})
    expect(bigBrotherConfigFromSetup(null)).toEqual({})
  })

  it('jury start: a count the old setup never asked for gets a safe default, and a week is never guessed', () => {
    expect(bigBrotherConfigFromSetup({ big_brother_jury_mode: 'when_remaining' })).toEqual({ juryStartMode: 'when_remaining', juryStartWhenRemaining: 9 })
    expect(bigBrotherConfigFromSetup({ big_brother_jury_mode: 'when_remaining', big_brother_finale_format: 'final_3' })).toMatchObject({ juryStartWhenRemaining: 10 })
    expect(bigBrotherConfigFromSetup({ big_brother_jury_mode: 'when_remaining', big_brother_jury_value: 8 })).toMatchObject({ juryStartWhenRemaining: 8 })
    // "From week 0" would start a jury at the first eviction, so no week means the default jury rule stands.
    expect(bigBrotherConfigFromSetup({ big_brother_jury_mode: 'fixed_week' })).toEqual({})
    expect(bigBrotherConfigFromSetup({ big_brother_jury_mode: 'fixed_week', big_brother_jury_value: 6 })).toEqual({ juryStartMode: 'fixed_week', juryStartWeek: 6 })
    expect(bigBrotherConfigFromSetup({ big_brother_jury_mode: 'after_eliminations', big_brother_jury_value: 5 })).toEqual({ juryStartMode: 'after_eliminations', juryStartAfterEliminations: 5 })
  })
})

describe('an existing league', () => {
  it('gets its choices only where the game is still on the built-in default', () => {
    const config = { ...defaults, challengeMode: 'ai_theme' } // someone set this since
    expect(setupRulesForExistingLeague(setup, config, defaults, { evictionsSoFar: 0 })).toEqual({
      finaleFormat: 'final_3',
      evictionTieBreakMode: 'hoh_vote',
      consecutiveHohAllowed: true,
    })
  })

  it('mid-season, only the rules for what comes next: never the finale or the jury after an eviction', () => {
    const changes = setupRulesForExistingLeague({ ...setup, big_brother_jury_mode: 'when_remaining' }, { ...defaults }, defaults, { evictionsSoFar: 2 })
    expect(changes).toEqual({ challengeMode: 'deterministic_score', evictionTieBreakMode: 'hoh_vote', consecutiveHohAllowed: true })
  })

  it('moves the jury rule as one unit, and not at all when any part of it was set', () => {
    const wants = { big_brother_jury_mode: 'when_remaining', big_brother_jury_value: 8 }
    expect(setupRulesForExistingLeague(wants, { ...defaults }, defaults, { evictionsSoFar: 0 })).toEqual({ juryStartMode: 'when_remaining', juryStartWhenRemaining: 8 })
    expect(setupRulesForExistingLeague(wants, { ...defaults, juryStartAfterEliminations: 5 }, defaults, { evictionsSoFar: 0 })).toEqual({})
  })
})

describe('saving the config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.league.findUnique.mockResolvedValue({ id: 'L1', sport: 'NFL', leagueVariant: 'big_brother' })
    db.bigBrotherLeagueConfig.findUnique.mockResolvedValue({ id: 'c1', leagueId: 'L1', ...defaults })
    db.bigBrotherLeagueConfig.upsert.mockResolvedValue({})
  })

  it('pausing the week changes the pause and nothing else', async () => {
    await upsertBigBrotherConfig('L1', { weekProgressionPaused: true })
    const call = db.bigBrotherLeagueConfig.upsert.mock.calls[0]![0]
    expect(call.update).toEqual({ weekProgressionPaused: true })
    // A new league still starts from the built-in rules.
    expect(call.create).toMatchObject({ leagueId: 'L1', finaleFormat: 'final_2', evictionTieBreakMode: 'season_points', weekProgressionPaused: true })
  })
})

describe('applying the setup choices once', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.bigBrotherLeagueConfig.findUnique.mockResolvedValue({ id: 'c1', leagueId: 'L1', ...defaults })
    db.bigBrotherLeagueConfig.upsert.mockResolvedValue({})
    db.bigBrotherCycle.count.mockResolvedValue(0)
    db.$executeRaw.mockResolvedValue(1)
  })

  it('applies them, logs it for the league, and stamps the league so it never runs twice', async () => {
    db.league.findUnique.mockResolvedValue({ id: 'L1', sport: 'NFL', leagueVariant: 'big_brother', settings: setup })
    const changes = await applyBigBrotherSetupRules('L1')
    expect(changes).toMatchObject({ evictionTieBreakMode: 'hoh_vote', challengeMode: 'deterministic_score' })
    expect(db.bigBrotherLeagueConfig.upsert.mock.calls[0]![0].update).toEqual(changes)
    expect(db.leagueAuditLog.create.mock.calls[0]![0].data).toMatchObject({ actionType: 'settings_patch', metadata: { section: 'conceptRules', format: 'big_brother' } })
    expect(JSON.stringify(db.$executeRaw.mock.calls[0])).toContain('big_brother_setup_rules_applied_at')
  })

  it('a stamped league is left alone', async () => {
    db.league.findUnique.mockResolvedValue({ settings: { ...setup, big_brother_setup_rules_applied_at: '2026-11-15T00:00:00Z' } })
    expect(await applyBigBrotherSetupRules('L1')).toEqual({})
    expect(db.bigBrotherLeagueConfig.upsert).not.toHaveBeenCalled()
    expect(db.$executeRaw).not.toHaveBeenCalled()
  })

  it('a failure leaves the league for the next tick, unstamped', async () => {
    db.league.findUnique.mockResolvedValue({ id: 'L1', sport: 'NFL', leagueVariant: 'big_brother', settings: setup })
    db.bigBrotherLeagueConfig.upsert.mockRejectedValue(new Error('db down'))
    expect(await applyBigBrotherSetupRules('L1')).toEqual({})
    expect(db.$executeRaw).not.toHaveBeenCalled()
  })
})
