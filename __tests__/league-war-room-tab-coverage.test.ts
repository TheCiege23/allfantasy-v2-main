import { describe, expect, it } from 'vitest'
import { getLeagueTabsForViewer } from '@/app/league/[leagueId]/LeagueTabs'

describe('league War Room navigation', () => {
  it.each(['NFL', 'NBA', 'NHL', 'MLB'])('%s exposes War Room to managers and commissioners', (sport) => {
    for (const isCommissioner of [false, true]) {
      const tabs = getLeagueTabsForViewer(sport, isCommissioner)
      expect(tabs.filter((tab) => tab.id === 'war_room')).toHaveLength(1)
    }
  })
})

describe('league Draft tab', () => {
  it('NBA leagues have exactly one Draft tab, for managers and commissioners', () => {
    for (const isCommissioner of [false, true]) {
      const tabs = getLeagueTabsForViewer('NBA', isCommissioner)
      expect(tabs.filter((tab) => tab.id === 'draft')).toHaveLength(1)
    }
  })

  it('keeps every other NBA tab', () => {
    const ids = getLeagueTabsForViewer('NBA', false).map((tab) => tab.id)
    for (const id of ['roster', 'redraft', 'team', 'matchups', 'players', 'waivers', 'trades', 'war_room']) {
      expect(ids).toContain(id)
    }
  })
})
