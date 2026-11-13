import { describe, expect, it } from 'vitest'
import { buildGeneralGroups, buildNotificationGroups, buildRosterItems, groupScoringRules, slotSwatch } from '@/lib/league-settings-hub/hubModel'
import { resolveHubSport, sportCopy, sportDisplayName, statLabel } from '@/lib/league-settings-hub/sportProfile'

const rules = (pairs: Array<[string, number]>) => pairs.map(([statKey, pointsValue]) => ({ statKey, pointsValue, enabled: true }))
const tabs = (cats: ReturnType<typeof groupScoringRules>) => Object.fromEntries(cats.map((c) => [c.label, c.rows.map((r) => r.label)]))

describe('resolveHubSport / sportDisplayName', () => {
  it('normalises the spellings leagues are stored with', () => {
    expect(resolveHubSport('nba')).toBe('NBA')
    expect(resolveHubSport('NCAAFB')).toBe('NCAAF')
    expect(resolveHubSport('ncaabb')).toBe('NCAAB')
    expect(resolveHubSport('soccer')).toBe('SOCCER')
    expect(resolveHubSport('curling')).toBeNull()
    expect(resolveHubSport(null)).toBeNull()
  })

  it('names college and soccer leagues in words and leaves unknown values as stored', () => {
    expect(sportDisplayName('NCAAB')).toBe('College Basketball')
    expect(sportDisplayName('SOCCER')).toBe('Soccer')
    expect(sportDisplayName('NFL')).toBe('NFL')
    expect(sportDisplayName('Curling')).toBe('Curling')
    const rows = buildGeneralGroups({ league: { sport: 'NCAAF' } }, 'redraft').flatMap((g) => g.rows)
    expect(rows.find((r) => r.key === 'sport')?.value).toBe('College Football')
  })
})

describe('groupScoringRules by sport', () => {
  it('basketball: its own tabs, and bonuses never leak into Scoring or Rebounds', () => {
    const t = tabs(groupScoringRules(rules([
      ['points_scored', 1], ['three_point_made', 0.5], ['rebound', 1.2], ['assist', 1.5], ['turnover', -1],
      ['steal', 3], ['block', 3], ['double_double', 1.5], ['forty_plus_points_bonus', 2], ['twenty_plus_rebounds_bonus', 2],
    ]), 'NBA'))
    expect(Object.keys(t)).toEqual(['Scoring', 'Rebounds', 'Playmaking', 'Defense', 'Bonuses'])
    expect(t.Defense).toEqual(['Steal', 'Block'])
    expect(t.Bonuses).toHaveLength(3)
    expect(t.Rebounds).toEqual(['Rebound'])
  })

  it('basketball: a Sleeper "blk" is a block, never a blocked kick', () => {
    expect(statLabel('NBA', 'blk')).toBe('Blocks')
    const t = tabs(groupScoringRules(rules([['pts', 1], ['blk', 3], ['to', -1]]), 'NBA'))
    expect(t).toEqual({ Scoring: ['Points'], Playmaking: ['Turnovers'], Defense: ['Blocks'] })
  })

  it('baseball splits hitting from pitching even where the names collide', () => {
    const t = tabs(groupScoringRules(rules([['home_runs', 4], ['strikeouts', -1], ['pitch_strikeouts', 1], ['innings_pitched', 3], ['cycle_bonus', 5]]), 'MLB'))
    expect(Object.keys(t)).toEqual(['Hitting', 'Pitching', 'Bonuses'])
    expect(t.Hitting).toEqual(['Home Runs', 'Strikeouts (K)'])
    expect(t.Pitching).toEqual(['Strikeouts (K)', 'Innings Pitched'])
  })

  it('hockey and soccer use skater/goalie and attacking/defending/goalkeeping tabs', () => {
    expect(Object.keys(tabs(groupScoringRules(rules([['goals', 3], ['saves', 0.2], ['shutouts', 2]]), 'NHL')))).toEqual(['Skaters', 'Goalies'])
    const soccer = tabs(groupScoringRules(rules([['goal', 5], ['clean_sheet', 4], ['gk_save', 1], ['yellow_card', -1], ['minutes_played', 1]]), 'SOCCER'))
    expect(Object.keys(soccer)).toEqual(['Attacking', 'Defending', 'Goalkeeping', 'Discipline', 'General'])
    expect(soccer.Attacking).toEqual(['Goal'])
  })

  it('shows "per yard" only for football', () => {
    expect(groupScoringRules(rules([['passing_yards', 0.04]]), 'NFL')[0].rows[0].value).toBe('0.04 / yd')
    expect(groupScoringRules(rules([['passing_yards', 0.04]]), 'NCAAF')[0].rows[0].label).toBe('Passing Yards')
    expect(groupScoringRules(rules([['minutes_played', 0.5]]), 'NBA')[0].rows[0].value).toBe('0.5')
  })

  it('an unknown sport keeps the football grouping', () => {
    expect(groupScoringRules(rules([['passing_td', 4]]), null)[0].label).toBe('Passing')
  })
})

describe('roster slots by sport', () => {
  it('never paints an NBA small forward or a soccer FLEX with football flex stripes', () => {
    expect(slotSwatch('SF', { key: 'SF', color: '#14b8a6' }, 'NBA')).toBe('#14b8a6')
    expect(slotSwatch('FLEX', { key: 'FLEX', color: '#e879f9' }, 'SOCCER')).toBe('#e879f9')
    expect(slotSwatch('SF', undefined, 'NFL')).toMatch(/^linear-gradient/)
  })

  it('falls back to the sport’s own slot names when the engine sends no definition', () => {
    const unified = { rosterConfig: { sections: [{ key: 'pro', label: 'Roster', slots: { C: 1, '1B': 1, IL: 2 } }] } }
    expect(buildRosterItems(unified, [], 'MLB').map((r) => r.name)).toEqual(['Catcher', 'First Base', 'Injured List'])
    expect(buildRosterItems(unified, [], 'NHL')[0].name).toBe('Center')
    const sf = { rosterConfig: { sections: [{ key: 'pro', label: 'Roster', slots: { SF: 1 } }] } }
    expect(buildRosterItems(sf, [], 'NFL')[0].name).toBe('Superflex')
    expect(buildRosterItems(sf, [], 'NBA')[0].name).toBe('Small Forward')
  })
})

describe('sport copy', () => {
  it('uses each sport’s injured list, matchup wording, correction timing and lock moment', () => {
    expect(sportCopy('MLB').injured.tag).toBe('IL')
    expect(sportCopy('NHL').injured.tag).toBe('IR')
    expect(sportCopy('MLB').matchup[0].d).toContain('pitching staff')
    expect(sportCopy('NBA').matchupTitle).toBe('Opponent matchup')
    expect(sportCopy('NFL').matchupTitle).toBe('Defense matchup')
    expect(sportCopy('NBA').correctionTiming).not.toMatch(/Thursday/)
    expect(sportCopy(null).correctionTiming).toMatch(/Thursday/)
    const reminder = (s: string) => buildNotificationGroups('redraft', false, s).flatMap((g) => g.rows).find((r) => r.id === 'lineup_reminders')?.description
    expect(reminder('NBA')).toMatch(/tip-off/)
    expect(reminder('MLB')).toMatch(/first pitch/)
    expect(reminder('NFL')).toMatch(/kickoff/)
  })
})
