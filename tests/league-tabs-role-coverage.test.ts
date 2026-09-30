import { describe, expect, it } from 'vitest'
import { getLeagueTabsForViewer } from '@/app/league/[leagueId]/LeagueTabs'
import { SUPPORTED_SPORTS } from '@/lib/create-league-v2/state'

describe('league tabs across creatable sports', () => {
  it.each(SUPPORTED_SPORTS)('shows chat for %s and gates Commissioner by role', (sport) => {
    const memberTabs = getLeagueTabsForViewer(sport, false).map(({ id }) => id)
    const commissionerTabs = getLeagueTabsForViewer(sport, true).map(({ id }) => id)

    expect(memberTabs).toContain('league_chat')
    expect(memberTabs).not.toContain('commissioner')
    expect(commissionerTabs).toContain('league_chat')
    expect(commissionerTabs).toContain('commissioner')
    expect(new Set(commissionerTabs).size).toBe(commissionerTabs.length)
  })
})
