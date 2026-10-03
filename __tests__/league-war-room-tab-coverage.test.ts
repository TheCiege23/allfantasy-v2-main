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
