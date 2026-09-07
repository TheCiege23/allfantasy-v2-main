/**
 * The week roller's decision, and the engine scope that decides who it runs for.
 *
 * 🛑 THE TWO BUGS THESE PIN ARE BOTH SILENT-BY-CONSTRUCTION.
 *
 * `engineSeasonScope` replaces a bare `status: 'active'` that was skipping 242 of
 * 246 production seasons because the import materializer writes `'in_season'`.
 * Nothing could have gone red: a string that does not match is not an error. The
 * assertions below therefore check the SET the scope selects, not that it
 * returns an object.
 *
 * `planWeekRoll` supplies the caller `advance_week` never had. Its whole job is
 * to decide "is the real-world week over", so the cases that matter most are the
 * ones where it must say NO — a live slate, an unresolvable week, a season the
 * sport has not started.
 */
import { describe, expect, it } from 'vitest'

import {
  LEGACY_ACTIVE_STATUS_ALIASES,
  REDRAFT_SEASON_STATUS,
  engineSeasonScope,
  isRunningSeasonStatus,
  normalizeRedraftSeasonStatus,
} from '@/lib/redraft/seasonStatus'
import { planWeekRoll } from '@/lib/season-week/rollSeasonWeek'
import type { LeagueSeasonWeekResolution, SportWeekSlate } from '@/lib/season-week'

function slate(week: number, allFinal: boolean): SportWeekSlate {
  return {
    week,
    seasonType: 'regular',
    gameCount: 16,
    firstKickoffAt: new Date('2026-09-10T00:20:00Z'),
    lastKickoffAt: new Date('2026-09-15T00:15:00Z'),
    liveCount: 0,
    finalCount: allFinal ? 16 : 8,
    allFinal,
  }
}

function resolved(
  over: Partial<Extract<LeagueSeasonWeekResolution, { ok: true }>> = {},
): LeagueSeasonWeekResolution {
  return {
    ok: true,
    fantasyWeek: 1,
    sportWeek: 1,
    phase: 'regular',
    state: 'played',
    sportWeekComplete: true,
    slate: slate(1, true),
    source: 'schedule',
    ...over,
  }
}

const NFL_SEASON = { totalWeeks: 14, playoffStartWeek: 15 }

describe('redraft season status vocabulary', () => {
  it('treats the import spelling as running, which is the whole bug', () => {
    // Production, 2026-09-07: 242 seasons at 'in_season', 4 at 'active'.
    expect(isRunningSeasonStatus('in_season')).toBe(true)
    expect(isRunningSeasonStatus('active')).toBe(true)
    expect(normalizeRedraftSeasonStatus('in_season')).toBe(REDRAFT_SEASON_STATUS.ACTIVE)
    expect(LEGACY_ACTIVE_STATUS_ALIASES).toContain('in_season')
  })

  it('does not treat a finished or unknown season as running', () => {
    expect(isRunningSeasonStatus('complete')).toBe(false)
    expect(isRunningSeasonStatus('playoffs')).toBe(false)
    expect(isRunningSeasonStatus('setup')).toBe(false)
    // 🛑 Unknown must be null, never ACTIVE. Defaulting an unrecognised value to
    // "running" enrolls it into every engine on the strength of a typo.
    expect(normalizeRedraftSeasonStatus('whatever')).toBeNull()
    expect(normalizeRedraftSeasonStatus('')).toBeNull()
    expect(normalizeRedraftSeasonStatus(null)).toBeNull()
    expect(isRunningSeasonStatus('whatever')).toBe(false)
  })
})

describe('engineSeasonScope', () => {
  it('reads both spellings and excludes shadow leagues by name', () => {
    const where = engineSeasonScope()
    expect(where.status).toEqual({ in: ['active', 'in_season', 'drafting'] })
    // 🛑 THE EXCLUSION IS THE POINT. It used to happen by accident, because
    // 'in_season' did not match 'active'. Now it is stated, so reading both
    // spellings cannot silently enroll 242 imported leagues into live scoring.
    expect(where.league).toEqual({
      platform: { in: ['allfantasy', 'af', 'manual', 'native'] },
    })
  })

  it('lets shadow leagues in only when asked', () => {
    const where = engineSeasonScope({ includeShadowLeagues: true })
    expect(where.league).toBeUndefined()
    expect(where.status).toEqual({ in: ['active', 'in_season', 'drafting'] })
  })

  it('scopes by sport without losing the league filter', () => {
    const where = engineSeasonScope({ sports: ['NFL', 'nfl'] })
    expect(where.sport).toEqual({ in: ['NFL', 'nfl'] })
    expect(where.league).toBeDefined()
  })

  it('does not apply an empty sport list as a filter that matches nothing', () => {
    // `{ in: [] }` matches zero rows — an engine passing an empty list would go
    // silently idle rather than running unscoped.
    expect(engineSeasonScope({ sports: [] }).sport).toBeUndefined()
  })
})

describe('planWeekRoll — holds', () => {
  it('holds when the resolver declined, rather than assuming week 1 is over', () => {
    const plan = planWeekRoll({
      resolution: { ok: false, reason: 'NO_WEEK_SIGNAL' },
      currentWeek: 1,
      ...NFL_SEASON,
    })
    expect(plan).toEqual({ action: 'hold', reason: 'WEEK_UNRESOLVED', detail: 'NO_WEEK_SIGNAL' })
  })

  it('holds through preseason', () => {
    const plan = planWeekRoll({
      resolution: resolved({ phase: 'preseason', state: 'upcoming', sportWeekComplete: false, slate: null }),
      currentWeek: 1,
      ...NFL_SEASON,
    })
    expect(plan).toEqual({ action: 'hold', reason: 'PRESEASON' })
  })

  it('holds while the league’s own week is still being played', () => {
    const plan = planWeekRoll({
      resolution: resolved({ state: 'live', sportWeekComplete: false, slate: slate(1, false) }),
      currentWeek: 1,
      ...NFL_SEASON,
    })
    expect(plan).toEqual({ action: 'hold', reason: 'SLATE_IN_PROGRESS', detail: 'live' })
  })

  it('holds on a week the feed has not finished reporting', () => {
    // `between` — kickoff passed, something unfinal. Advancing here rolls the
    // league over a game that was never scored.
    const plan = planWeekRoll({
      resolution: resolved({ state: 'between', sportWeekComplete: false, slate: slate(1, false) }),
      currentWeek: 1,
      ...NFL_SEASON,
    })
    expect(plan.action).toBe('hold')
  })

  it('hands a finished regular season to the playoff machine', () => {
    const plan = planWeekRoll({
      resolution: resolved({ sportWeek: 16, fantasyWeek: 16, phase: 'playoffs' }),
      currentWeek: 15,
      ...NFL_SEASON,
    })
    expect(plan).toEqual({ action: 'hold', reason: 'REGULAR_SEASON_ENDED' })
  })
})

describe('planWeekRoll — advances', () => {
  it('advances once the league’s week is played', () => {
    const plan = planWeekRoll({
      resolution: resolved({ sportWeek: 1, sportWeekComplete: true, state: 'played' }),
      currentWeek: 1,
      ...NFL_SEASON,
    })
    expect(plan).toEqual({ action: 'advance', fromWeek: 1, toWeek: 2 })
  })

  it('catches a league up when the sport has already moved past it', () => {
    // A season that missed a roll: the sport is on week 5, the league on 3.
    // Week 3 is over whatever its own slate rows now say.
    const plan = planWeekRoll({
      resolution: resolved({ sportWeek: 5, fantasyWeek: 5, sportWeekComplete: false, state: 'live' }),
      currentWeek: 3,
      ...NFL_SEASON,
    })
    expect(plan).toEqual({ action: 'advance', fromWeek: 3, toWeek: 4 })
  })

  it('advances through the final regular week so the season can end', () => {
    // 🛑 THIS IS WHAT REACHES THE POSTSEASON. `advance_week` flips the season to
    // `regular_season_complete` from the last week and auto-generates the
    // bracket; holding one week early would strand every league before playoffs.
    const plan = planWeekRoll({
      resolution: resolved({ sportWeek: 14, fantasyWeek: 14, sportWeekComplete: true }),
      currentWeek: 14,
      ...NFL_SEASON,
    })
    expect(plan).toEqual({ action: 'advance', fromWeek: 14, toWeek: 14 })
  })

  it('handles a league anchored to a later sport week', () => {
    // ⚠ THIS DOES NOT DISCRIMINATE BETWEEN THE TWO FORMULATIONS, AND SAYING SO IS
    // THE POINT. It was written asserting that a sport-week comparison beats a
    // fantasy-week one for a late-starting league. It does not: the two are the
    // same expression rearranged, and the mutation swapping them left this test
    // green. What it does pin is the anchor arithmetic itself — that league week
    // 1 at anchor 3 means sport week 3, and holds there while that week is live.
    const hold = planWeekRoll({
      resolution: resolved({ sportWeek: 3, fantasyWeek: 1, sportWeekComplete: false, state: 'live' }),
      currentWeek: 1,
      anchorSportWeek: 3,
      ...NFL_SEASON,
    })
    expect(hold).toEqual({ action: 'hold', reason: 'SLATE_IN_PROGRESS', detail: 'live' })

    const advance = planWeekRoll({
      resolution: resolved({ sportWeek: 4, fantasyWeek: 2, sportWeekComplete: false, state: 'live' }),
      currentWeek: 1,
      anchorSportWeek: 3,
      ...NFL_SEASON,
    })
    expect(advance).toEqual({ action: 'advance', fromWeek: 1, toWeek: 2 })
  })

  it('is self-limiting: the week it just set holds on the next pass', () => {
    const first = planWeekRoll({
      resolution: resolved({ sportWeek: 1, sportWeekComplete: true }),
      currentWeek: 1,
      ...NFL_SEASON,
    })
    expect(first.action).toBe('advance')
    // Same schedule state, league now at week 2 — must not advance again.
    const second = planWeekRoll({
      resolution: resolved({ sportWeek: 1, sportWeekComplete: true }),
      currentWeek: 2,
      ...NFL_SEASON,
    })
    expect(second.action).toBe('hold')
  })
})
