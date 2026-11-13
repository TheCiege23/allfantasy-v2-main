/**
 * MLB two-week Guilly periods (lib/guillotine/eliminationPeriods.ts) on the surfaces around the chop:
 * the "Who's next?" pick, Chop Watch and the danger tiers, the chop preview and alerts, the tiebreak
 * copy, the rules-change snapshot, and the week evaluator's previous-period read. Each one-week case
 * is asserted next to its two-week case, because a one-week league must read exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, any>
const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  roster: { findMany: vi.fn() },
  guillotineRosterState: { findMany: vi.fn() },
  guillotinePeriodScore: { findMany: vi.fn() },
}))
const config = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: config.get }))
vi.mock('@/lib/guillotine/rosterDisplayNames', () => ({
  resolveRosterDisplayNames: vi.fn(async (_l: string, ids: string[]) => new Map(ids.map((id) => [id, id.toUpperCase()]))),
}))

import { openPickWeek, pickLockWeek } from '@/lib/guillotine/nextChopPick'
import { chopWatchFromPreview } from '@/lib/guillotine/chopWatch'
import { buildChopPreview, type ChopPreviewInput, type ChopPreviewTeam } from '@/lib/guillotine/chopPreview'
import { DEFAULT_ADVANCED } from '@/lib/guillotine/chopSchedule'
import { chopResultAlert, chopZoneWarning } from '@/lib/guillotine/chopAlertCopy'
import { tiebreakLabel } from '@/lib/guillotine/guillotineRules'
import { tiebreakLabels } from '@/components/guillotine/guillotineHomeModel'
import { describeTiebreak } from '@/lib/guilly/hub'
import { guillotineRulesSnapshot } from '@/lib/league-rules-explainer/snapshot'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import { explainLeagueRules, explainRuleChange } from '@/lib/league-rules-explainer/explain'
import { leagueRulesCopyEn, leagueRulesCopyEs } from '@/lib/i18n/league-rules-copy'
import { renderChangeLine } from '@/lib/league-rules-explainer/render'
import { buildRulesExplainerView } from '@/lib/league-rules-explainer/view'
import { evaluateWeek } from '@/lib/guillotine/GuillotineWeekEvaluator'
import { getDangerTiers } from '@/lib/guillotine/GuillotineDangerEngine'

beforeEach(() => vi.clearAllMocks())

describe('"Who\'s next?" picks a period, not a week that cannot chop', () => {
  it('one-week leagues are unchanged: the week after the one being played', () => {
    expect([0, 1, 2, 3].map((calendarWeek) => openPickWeek({ calendarWeek, eliminationStartWeek: 1, eliminationEndWeek: 17 }))).toEqual([1, 2, 3, 4])
    expect(openPickWeek({ calendarWeek: 17, eliminationStartWeek: 1, eliminationEndWeek: 17 })).toBeNull()
    expect(pickLockWeek(4)).toBe(4)
  })

  it('two-week periods: the next period that has not started, keyed by its chop week, locking at its first week', () => {
    const open = (calendarWeek: number) => openPickWeek({ calendarWeek, eliminationStartWeek: 1, eliminationEndWeek: 26, periodWeeks: 2 })
    // Before the season: period 1-2. Playing week 1 or 2 (period 1-2 has begun): period 3-4.
    expect([0, 1, 2, 3].map(open)).toEqual([2, 4, 4, 6])
    expect(pickLockWeek(4, 2)).toBe(3)
    // The last period is 25-26; once it has begun there is nothing to pick.
    expect(open(24)).toBe(26)
    expect(open(25)).toBeNull()
  })
})

const team = (rosterId: string, periodPoints: number, over: Partial<ChopPreviewTeam> = {}): ChopPreviewTeam => ({
  rosterId, name: rosterId.toUpperCase(), periodPoints, seasonPointsCumul: periodPoints, faab: 100, playerCount: 9, ...over,
})
const input = (over: Partial<ChopPreviewInput> = {}): ChopPreviewInput => ({
  week: 4,
  weekState: 'live',
  eliminationStartWeek: 1,
  eliminationEndWeek: 26,
  teamsPerChop: 1,
  advanced: DEFAULT_ADVANCED,
  endgame: { format: 'last_team_standing', threshold: 1 },
  tiebreakerOrder: ['previous_period', 'random'],
  dangerMarginPoints: 10,
  faabOnChop: 'keep',
  rosterReleaseTiming: 'next_waiver_run',
  // b and c tie on the line; c scored less last period, so the previous-period step settles it.
  teams: [team('a', 120), team('b', 90, { previousPeriodPoints: 80 }), team('c', 90, { previousPeriodPoints: 60 })],
  previousWeek: [],
  draftSlotByRoster: new Map(),
  blockers: [],
  ...over,
})

describe('the chop preview and Chop Watch on a two-week period', () => {
  it('one-week copy is unchanged', () => {
    const p = buildChopPreview(input())
    expect(p.headline).toBe('If week 4 ended now, C would be chopped.')
    expect(p.tiebreak).toBe('Lower score last week is chopped')
    expect(p).not.toHaveProperty('periodWeeks')
  })

  it('names the period and the last-period tiebreak', () => {
    const p = buildChopPreview(input({ periodWeeks: 2 }))
    expect(p.headline).toBe('If weeks 3–4 ended now, C would be chopped.')
    expect(buildChopPreview(input({ periodWeeks: 2, weekState: 'final' })).headline).toBe('Weeks 3–4 are final: C will be chopped when the correction window closes.')
    expect(p.tiebreak).toBe('Lower score last period is chopped')
    expect(p.periodWeeks).toBe(2)
  })

  it('Chop Watch answers either week of the period with the period\'s chop line; a one-week preview only its own week', () => {
    const two = buildChopPreview(input({ periodWeeks: 2 }))
    expect(chopWatchFromPreview(two, 3)).toMatchObject({ week: 4, chopLine: 90 })
    expect(chopWatchFromPreview(two, 4)).toMatchObject({ week: 4 })
    expect(chopWatchFromPreview(two, 2)).toBeNull()
    const one = buildChopPreview(input())
    expect(chopWatchFromPreview(one, 3)).toBeNull()
    expect(chopWatchFromPreview(one, 4)).toMatchObject({ week: 4 })
  })
})

describe('chop alerts on a two-week period', () => {
  const base = { leagueName: 'L', week: 4, choppedNames: ['C'], rosterReleaseTiming: 'next_waiver_run' }
  it('one-week copy is unchanged', () => {
    expect(chopResultAlert({ ...base, youWereChopped: false }).title).toBe('You survived week 4 — L')
    expect(chopResultAlert({ ...base, youWereChopped: true }).body).toContain('lowest score in week 4 and is out')
    expect(chopZoneWarning({ leagueName: 'L', week: 4, status: 'chopped', margin: 0 }).body).toContain('If week 4 ended now')
  })
  it('names both weeks', () => {
    expect(chopResultAlert({ ...base, youWereChopped: false, periodWeeks: 2 }).title).toBe('You survived weeks 3–4 — L')
    expect(chopResultAlert({ ...base, youWereChopped: true, periodWeeks: 2 }).body).toContain('lowest score over weeks 3–4 and is out')
    expect(chopZoneWarning({ leagueName: 'L', week: 4, status: 'chopped', margin: 0, periodWeeks: 2 }).body).toContain('If weeks 3–4 ended now')
    expect(chopZoneWarning({ leagueName: 'L', week: 4, status: 'danger', margin: 3, periodWeeks: 2 }).body).toContain('close to the chop in weeks 3–4')
  })
})

describe('the tiebreak copy says "last period" in a two-week league', () => {
  it('every surface', () => {
    expect(tiebreakLabel('previous_period')).toBe('Lower score last week is chopped')
    expect(tiebreakLabel('previous_period', 2)).toBe('Lower score last period is chopped')
    expect(tiebreakLabel('bench_points', 2)).toBe('Fewer bench points is chopped')
    expect(tiebreakLabels(['previous_period'])).toEqual(['Last week’s points'])
    expect(tiebreakLabels(['previous_period'], 2)).toEqual(['Last period’s points'])
    expect(describeTiebreak(['previous_period'])).toBe('Ties at the blade line go to last week.')
    expect(describeTiebreak(['previous_period'], 2)).toBe('Ties at the blade line go to last period.')
  })

  it('the rules explainer, in English and Spanish', () => {
    const t = (copy: Record<string, string>) => (k: string) => copy[k] ?? k
    const lines = (chopPeriodWeeks: number) =>
      explainLeagueRules({ sport: 'MLB', format: 'guillotine', tiebreakers: ['previous_period'], chopImmunity: 'top_scorer', chopPeriodWeeks } as never)
        .flatMap((s) => s.lines)
        .map((l) => l.id)
    expect(lines(2)).toContain('guillotine-period')
    expect(lines(1)).not.toContain('guillotine-period')
    const keyOf = (chopPeriodWeeks: number, id: string) =>
      JSON.stringify(
        explainLeagueRules({ sport: 'MLB', format: 'guillotine', tiebreakers: ['previous_period'], chopImmunity: 'top_scorer', chopPeriodWeeks } as never)
          .flatMap((s) => s.lines)
          .find((l) => l.id === id),
      )
    expect(keyOf(2, 'guillotine-tiebreak')).toContain('tiebreak.previous_period_twoWeek')
    expect(keyOf(1, 'guillotine-tiebreak')).not.toContain('twoWeek')
    expect(keyOf(2, 'guillotine-immunity')).toContain('guillotine.immunityPeriod')
    expect(t(leagueRulesCopyEn)('leagueRules.tiebreak.previous_period_twoWeek')).toBe('lower score last period is chopped')
    expect(t(leagueRulesCopyEs)('leagueRules.tiebreak.previous_period_twoWeek')).toBe('se elimina al que puntuó menos el periodo pasado')
  })
})

describe('the rules-change announcement includes the period length and best ball', () => {
  const rules = { teamsPerChop: 1, tiebreakerOrder: ['previous_period'], bestBall: false, periodWeeks: 1 }
  it('a period or best ball change is a change', () => {
    expect(diffRuleSnapshots(guillotineRulesSnapshot(rules), guillotineRulesSnapshot({ ...rules, periodWeeks: 2 }))).toEqual([
      { key: 'chopPeriodWeeks', before: 1, after: 2 },
    ])
    expect(diffRuleSnapshots(guillotineRulesSnapshot(rules), guillotineRulesSnapshot({ ...rules, bestBall: true }))).toEqual([
      { key: 'bestBallLineups', before: false, after: true },
    ])
    expect(diffRuleSnapshots(guillotineRulesSnapshot(rules), guillotineRulesSnapshot(rules))).toEqual([])
  })

  it('and reads as a sentence in both languages', () => {
    const en = (k: string) => leagueRulesCopyEn[k] ?? k
    const es = (k: string) => leagueRulesCopyEs[k] ?? k
    const period = explainRuleChange({ key: 'chopPeriodWeeks', before: 1, after: 2 })!
    const bb = explainRuleChange({ key: 'bestBallLineups', before: false, after: true })!
    expect(renderChangeLine(period, en as never, 'en')).toBe('Elimination period: 1 week → 2 weeks')
    expect(renderChangeLine(bb, en as never, 'en')).toBe('Best ball lineups: Off → On')
    expect(renderChangeLine(period, es as never, 'es')).toBe('Periodo de eliminación: 1 semana → 2 semanas')
  })
})

describe('the "What changed" card words a tiebreak-order change "last period" in a two-week league', () => {
  const en = (k: string) => leagueRulesCopyEn[k] ?? k
  const es = (k: string) => leagueRulesCopyEs[k] ?? k
  const change = { key: 'tiebreakers', before: ['random', 'previous_period'], after: ['previous_period', 'random'] }

  it('two-week periods: "last period", in English and Spanish', () => {
    const line = explainRuleChange(change, { sport: 'MLB', chopPeriodWeeks: 2 })!
    expect(renderChangeLine(line, en as never, 'en')).toBe(
      'Chop tiebreakers: a random draw and lower score last period is chopped → lower score last period is chopped and a random draw',
    )
    const esText = renderChangeLine(line, es as never, 'es')
    expect(esText).toContain('se elimina al que puntuó menos el periodo pasado')
    expect(esText).not.toContain('semana pasada')
  })

  it('one-week periods, or no period known: "last week", as before', () => {
    for (const ctx of [{ sport: 'MLB', chopPeriodWeeks: 1 }, { sport: 'MLB' }]) {
      const text = renderChangeLine(explainRuleChange(change, ctx)!, en as never, 'en')
      expect(text).toContain('lower score last week is chopped')
      expect(text).not.toContain('last period')
    }
  })

  it('the rules view passes the league snapshot\'s period length to its change cards', () => {
    const view = buildRulesExplainerView({
      snapshot: { sport: 'MLB', format: 'guillotine', chopPeriodWeeks: 2, tiebreakers: ['previous_period'] } as never,
      events: [{ id: 'e1', createdAt: '2026-10-19T12:00:00.000Z', actorUserId: 'boss', changes: [change] }],
      seen: { rulesSeenAt: '2026-09-01T00:00:00.000Z', lastSeenSettingsEventId: null, lastSeenSettingsEventAt: null },
      viewerUserId: 'member',
      isCommissioner: false,
      broadcastsEnabled: true,
    })
    const card = view.pendingChanges[0]!.lines[0]!
    expect(renderChangeLine(card, en as never, 'en')).toContain('lower score last period is chopped')
  })
})

describe('the week evaluator\'s previous period (fallback read)', () => {
  beforeEach(() => {
    config.get.mockResolvedValue({ eliminationStartWeek: 1, correctionWindow: 'immediate' })
    db.roster.findMany.mockResolvedValue([{ id: 'R-a' }, { id: 'R-b' }])
    db.guillotineRosterState.findMany.mockResolvedValue([])
    db.guillotinePeriodScore.findMany.mockImplementation(async ({ where }: Row) =>
      [
        { rosterId: 'R-a', weekOrPeriod: 2, periodPoints: 70, seasonPointsCumul: 70 },
        { rosterId: 'R-b', weekOrPeriod: 2, periodPoints: 60, seasonPointsCumul: 60 },
        { rosterId: 'R-a', weekOrPeriod: 3, periodPoints: 33, seasonPointsCumul: 33 },
        { rosterId: 'R-b', weekOrPeriod: 3, periodPoints: 44, seasonPointsCumul: 44 },
        { rosterId: 'R-a', weekOrPeriod: 4, periodPoints: 50, seasonPointsCumul: 120 },
        { rosterId: 'R-b', weekOrPeriod: 4, periodPoints: 55, seasonPointsCumul: 115 },
      ].filter((r) => r.weekOrPeriod === where.weekOrPeriod),
    )
  })

  it('a two-week period reads the period before (keyed 2), not week 3', async () => {
    const r = await evaluateWeek({ leagueId: 'L1', weekOrPeriod: 4, periodWeeks: 2 })
    expect(r!.scores.map((s) => [s.rosterId, s.previousPeriodPoints])).toEqual([['R-a', 70], ['R-b', 60]])
  })

  it('a one-week league reads the week before, as before', async () => {
    const r = await evaluateWeek({ leagueId: 'L1', weekOrPeriod: 4 })
    expect(r!.scores.map((s) => [s.rosterId, s.previousPeriodPoints])).toEqual([['R-a', 33], ['R-b', 44]])
  })
})

describe('the danger engine\'s fallback reads the previous PERIOD', () => {
  beforeEach(() => {
    config.get.mockResolvedValue({ eliminationStartWeek: 1, dangerMarginPoints: 10 })
    db.guillotineRosterState.findMany.mockResolvedValue([])
    // Only the period keyed 2 has been chopped; weeks 3 and 4 have no rows yet.
    db.guillotinePeriodScore.findMany.mockImplementation(async ({ where }: Row) =>
      where.weekOrPeriod === 2
        ? [
            { rosterId: 'R-a', periodPoints: 70, seasonPointsCumul: 70 },
            { rosterId: 'R-b', periodPoints: 60, seasonPointsCumul: 60 },
          ]
        : [],
    )
  })

  it('in the second week of a period it ranks on the previous period, not on the empty first week', async () => {
    db.league.findUnique.mockResolvedValue({ settings: { guillotine_period_weeks: 2 } })
    const rows = await getDangerTiers({ leagueId: 'L1', weekOrPeriod: 4 })
    expect(rows.map((r) => [r.rosterId, r.projectedPoints, r.tier])).toEqual([['R-b', 60, 'chop_zone'], ['R-a', 70, 'danger']])
  })

  it('a one-week league reads the week before, as before', async () => {
    db.league.findUnique.mockResolvedValue({ settings: {} })
    expect(await getDangerTiers({ leagueId: 'L1', weekOrPeriod: 4 })).toEqual([])
    expect((await getDangerTiers({ leagueId: 'L1', weekOrPeriod: 3 })).map((r) => r.rosterId)).toEqual(['R-b', 'R-a'])
  })
})
