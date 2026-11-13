import { describe, expect, it } from 'vitest'
import {
  buildAllTimeStandings,
  buildDraftGroups,
  buildGeneralGroups,
  buildNotificationGroups,
  buildRosterItems,
  buildTypeRuleGroups,
  buildWaiverGroups,
  groupScoringRules,
  isLeagueCategoryOn,
  pickTimerText,
  readWaiverSchedule,
  resolveHubKind,
  slotSwatch,
} from '@/lib/league-settings-hub/hubModel'

const row = (groups: Array<{ rows: Array<{ key: string; value: string | null }> }>, key: string) =>
  groups.flatMap((g) => g.rows).find((r) => r.key === key)

describe('resolveHubKind', () => {
  it('maps the stored league type', () => {
    expect(resolveHubKind({ leagueType: 'guillotine' })).toBe('guillotine')
    expect(resolveHubKind({ leagueType: 'salary_cap' })).toBe('salary_cap')
    expect(resolveHubKind({ leagueType: 'big_brother' })).toBe('big_brother')
  })
  it('falls back through the mode flags, then dynasty, then redraft', () => {
    expect(resolveHubKind({ bestBallMode: true })).toBe('best_ball')
    expect(resolveHubKind({ isDynasty: true })).toBe('dynasty')
    expect(resolveHubKind({})).toBe('redraft')
  })
})

describe('buildGeneralGroups', () => {
  const payload = {
    league: { teamCount: 12, sport: 'NFL', season: 2026, tradeDeadlineWeek: 11, tradeReviewHours: 24, draftPickTrading: false, preventBenchDrops: true, irSlots: 2, irAllowOut: true, irAllowDoubtful: true, playoffTeams: 6, playoffStartWeek: 15 },
    settingsSnapshot: { trade_review_mode: 'commissioner' },
  }
  it('reads real values and labels them like Sleeper', () => {
    const g = buildGeneralGroups(payload, 'redraft')
    expect(row(g, 'teams')?.value).toBe('12 Teams')
    expect(row(g, 'deadline')?.value).toBe('Week 11')
    expect(row(g, 'reviewTime')?.value).toBe('1 day')
    expect(row(g, 'review')?.value).toBe('Commissioner')
    expect(row(g, 'irAllow')?.value).toBe('Out, Doubtful')
    expect(row(g, 'playoffStart')?.value).toBe('Week 15')
  })
  it('renders a missing value as null, never as a default', () => {
    const g = buildGeneralGroups({ league: {} }, 'redraft')
    expect(row(g, 'deadline')?.value).toBeNull()
    expect(row(g, 'playoffTeams')?.value).toBeNull()
    expect(row(g, 'irSlots')?.value).toBeNull()
  })
  it('swaps playoffs for an endgame on elimination formats', () => {
    const g = buildGeneralGroups(payload, 'guillotine')
    expect(g.find((x) => x.key === 'playoffs')?.label).toBe('Endgame')
    expect(row(g, 'playoffTeams')).toBeUndefined()
    expect(row(g, 'endgame')?.value).toBe('Last team standing')
  })
  it('adds the format trade locks', () => {
    expect(row(buildGeneralGroups(payload, 'big_brother'), 'hoh')?.value).toBe('Never tradable')
    expect(row(buildGeneralGroups(payload, 'survivor'), 'idols')?.value).toBe('Only with their player')
    expect(row(buildGeneralGroups(payload, 'zombie'), 'zombieTrades')?.value).toBe('Blocked')
    expect(row(buildGeneralGroups(payload, 'redraft'), 'hoh')).toBeUndefined()
  })
  it('exposes inline toggles only for booleans the API returned', () => {
    const g = buildGeneralGroups(payload, 'redraft')
    expect(g.flatMap((x) => x.rows).find((r) => r.key === 'benchDrops')?.toggle).toEqual({ field: 'preventBenchDrops', on: true })
    const empty = buildGeneralGroups({ league: {} }, 'redraft')
    expect(empty.flatMap((x) => x.rows).find((r) => r.key === 'benchDrops')?.toggle).toBeUndefined()
  })
  it('replaces roster moves with auto lineups for best ball', () => {
    const g = buildGeneralGroups(payload, 'best_ball')
    expect(row(g, 'lineups')?.value).toBe('Auto-optimized every week')
  })
})

describe('buildWaiverGroups', () => {
  it('nests FAAB budget and min bid under FAAB only', () => {
    const faab = buildWaiverGroups({ league: { waiverType: 'faab', waiverBudget: 1000, waiverMinBid: 0 } }, 'redraft')
    expect(row(faab, 'type')?.value).toBe('FAAB Bidding')
    expect(row(faab, 'budget')?.value).toBe('$1,000')
    const rolling = buildWaiverGroups({ league: { waiverType: 'rolling' } }, 'redraft')
    expect(row(rolling, 'budget')).toBeUndefined()
  })
  it('shows the daily schedule only when custom daily waivers are on', () => {
    const on = buildWaiverGroups({ league: { waiverType: 'faab', customDailyWaivers: true, waiverSchedule: { mon: 'waivers_to_fa', tue: 'waivers' } } }, 'redraft')
    const sched = on.flatMap((g) => g.rows).find((r) => r.key === 'schedule')
    expect(sched?.schedule?.map((d) => d.day)).toEqual(['Monday', 'Tuesday'])
    const off = buildWaiverGroups({ league: { waiverType: 'faab', customDailyWaivers: false } }, 'redraft')
    expect(row(off, 'schedule')).toBeUndefined()
  })
})

describe('readWaiverSchedule', () => {
  it('orders Monday first and accepts array or record shapes', () => {
    expect(readWaiverSchedule([{ day: 0, mode: 'waivers' }, { day: 1, mode: 'fa' }]).map((d) => d.day)).toEqual(['Monday', 'Sunday'])
    expect(readWaiverSchedule({ wednesday: 'waivers' })).toEqual([{ day: 'Wednesday', mode: 'Waivers' }])
    expect(readWaiverSchedule('nonsense')).toEqual([])
  })
})

describe('buildTypeRuleGroups', () => {
  it('shows the taxi squad for carry-over formats only', () => {
    expect(buildTypeRuleGroups({ league: { taxiSlots: 4 } }, 'dynasty')[0].rows[0].value).toBe('4')
    expect(buildTypeRuleGroups({ league: { taxiSlots: 4 } }, 'redraft')).toEqual([])
  })
  it('reads keeper fields and concept setup answers', () => {
    const g = buildTypeRuleGroups({ league: { keeperCount: 3, keeperRoundPenalty: 1 }, settingsSnapshot: { conceptSetup: { tribeCount: 4, idolsEnabled: true, nested: { a: 1 } } } }, 'keeper')
    expect(row(g, 'count')?.value).toBe('3 per team')
    expect(row(g, 'penalty')?.value).toBe('1 round')
    expect(row(g, 'concept-tribeCount')?.value).toBe('4')
    expect(row(g, 'concept-idolsEnabled')?.value).toBe('Yes')
    expect(row(g, 'concept-nested')).toBeUndefined()
  })
})

describe('buildDraftGroups', () => {
  it('formats the pick timer and draft toggles', () => {
    const g = buildDraftGroups({ settings: { draftType: 'snake', rounds: 15, pickTimerPreset: '60s', cpuAutoPick: true, autostart: false } })
    expect(row(g, 'type')?.value).toBe('Snake')
    expect(row(g, 'timer')?.value).toBe('1 minute')
    expect(g.flatMap((x) => x.rows).find((r) => r.key === 'autostart')?.toggle).toEqual({ field: 'autostart', on: false })
  })
  it('pickTimerText handles hours, custom and missing', () => {
    expect(pickTimerText('8h', null)).toBe('8 hours')
    expect(pickTimerText('custom', 45)).toBe('45 sec')
    expect(pickTimerText(null, null)).toBeNull()
  })
})

describe('roster', () => {
  it('builds items from the unified roster config with slot colors', () => {
    const items = buildRosterItems(
      { rosterConfig: { sections: [{ key: 'pro', label: 'Pro', slots: { QB: 1, FLEX: 1, BN: 6 } }] } },
      [{ key: 'QB', label: 'Quarterback', shortLabel: 'QB', color: '#ff0000' }],
    )
    expect(items.map((i) => [i.name, i.count])).toEqual([['Quarterback', 1], ['Flex', 1], ['Bench', 6]])
    expect(items[0].color).toBe('#ff0000')
    expect(items[1].color.startsWith('linear-gradient')).toBe(true)
  })
  it('stripes a flex swatch with one band per eligible position', () => {
    expect(slotSwatch('SUPER_FLEX').match(/%/g)).toHaveLength(8)
  })
})

describe('groupScoringRules', () => {
  it('groups by category, hides zero and disabled rules, explains yardage', () => {
    const cats = groupScoringRules([
      { statKey: 'pass_yd', pointsValue: 0.04, enabled: true },
      { statKey: 'pass_td', pointsValue: 4, enabled: true },
      { statKey: 'rush_td', pointsValue: 6, enabled: true },
      { statKey: 'rec', pointsValue: 1, enabled: true },
      { statKey: 'fgm_50p', pointsValue: 5, enabled: true },
      { statKey: 'pass_2pt', pointsValue: 0, enabled: true },
      { statKey: 'rush_yd', pointsValue: 0.1, enabled: false },
    ])
    expect(cats.map((c) => c.key)).toEqual(['passing', 'rushing', 'receiving', 'kicking'])
    expect(cats[0].rows.find((r) => r.key === 'pass_yd')?.perUnit).toBe('1 point every 25 yards')
    expect(cats[0].rows.some((r) => r.key === 'pass_2pt')).toBe(false)
    expect(cats[1].rows.some((r) => r.key === 'rush_yd')).toBe(false)
  })
})

describe('notifications', () => {
  it('drops lineup alerts for auto-lineup formats and adds format updates', () => {
    const bb = buildNotificationGroups('best_ball', false).flatMap((g) => g.rows.map((r) => r.id))
    expect(bb).not.toContain('lineup_reminders')
    const g = buildNotificationGroups('guillotine', false).flatMap((x) => x.rows.map((r) => r.id))
    expect(g).toContain('bracket_updates')
    expect(g).not.toContain('commissioner_alerts')
    expect(buildNotificationGroups('redraft', true).flatMap((x) => x.rows.map((r) => r.id))).toContain('commissioner_alerts')
  })
  it('resolves the effective switch from global, league and category mutes', () => {
    expect(isLeagueCategoryOn(null, 'L', 'trade_proposals')).toBe(true)
    expect(isLeagueCategoryOn({ categories: { trade_proposals: { enabled: false } } }, 'L', 'trade_proposals')).toBe(false)
    expect(isLeagueCategoryOn({ leagues: { L: { enabled: false } } }, 'L', 'trade_proposals')).toBe(false)
    expect(isLeagueCategoryOn({ leagues: { L: { mutedCategories: ['trade_proposals'] } } }, 'L', 'trade_proposals')).toBe(false)
    expect(isLeagueCategoryOn({ leagues: { OTHER: { enabled: false } } }, 'L', 'trade_proposals')).toBe(true)
  })
})

describe('buildAllTimeStandings', () => {
  it('formats record, percent and points', () => {
    const [a] = buildAllTimeStandings([{ managerName: 'A', totalWins: 46, totalLosses: 24, totalTies: 0, winPct: 0.6571, totalPoints: 6412.3, seasonsPlayed: 5, championships: 1 }])
    expect(a).toMatchObject({ rank: 1, record: '46-24', winPct: '66%', pointsFor: '6,412.30' })
  })
})
