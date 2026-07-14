import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NFL_REDRAFT_CORE_TAB_IDS } from '@/app/league/[leagueId]/LeagueTabs'

const shell = fs.readFileSync(path.join(process.cwd(), 'app/league/[leagueId]/LeagueShell.tsx'), 'utf8')
const adapter = fs.readFileSync(path.join(process.cwd(), 'app/league/[leagueId]/tabs/redraft/CanonicalRedraftScheduleTab.tsx'), 'utf8')

describe('canonical NFL redraft schedule navigation', () => {
  it('contains exactly one core Schedule destination after Matchups', () => {
    expect(NFL_REDRAFT_CORE_TAB_IDS.filter((id) => id === 'schedule')).toHaveLength(1)
    expect(NFL_REDRAFT_CORE_TAB_IDS.indexOf('schedule')).toBe(NFL_REDRAFT_CORE_TAB_IDS.indexOf('matchups') + 1)
  })

  it('uses the shared desktop/mobile tablist and canonical URL model', () => {
    expect(shell).toContain('data-testid="league-command-center-tabs"')
    expect(shell).toContain('data-testid={`league-tab-${tab.id}`}')
    expect(shell).toContain("next.set('view', activeTab)")
    expect(shell).toContain("schedule: 'schedule'")
  })

  it('renders the existing ScheduleView with league-scoped season and schedule requests', () => {
    expect(adapter).toContain("import { ScheduleView } from './ScheduleView'")
    expect(adapter).toContain('fetchRedraftSeason(leagueId)')
    expect(adapter).toContain('fetchRedraftSchedule(leagueId, season.id)')
    expect(adapter).toContain('<ScheduleView schedule={schedule} />')
  })

  it('keeps truthful loading, pre-draft, empty, and error boundaries', () => {
    expect(adapter).toContain('redraft-schedule-loading')
    expect(adapter).toContain('redraft-schedule-preseason')
    expect(adapter).toContain('redraft-schedule-error')
    expect(shell).toContain('<CanonicalRedraftScheduleTab leagueId={leagueId} />')
  })
})
