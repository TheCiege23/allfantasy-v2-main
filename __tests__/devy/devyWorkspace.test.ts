/**
 * Devy in the league workspace (2026-11-07). The Devy home (pipeline, promotions, devy draft center, commissioner
 * devy tools) was only imported by components/app/tabs/OverviewTab, which nothing imports; LeagueShell's Devy hero and
 * Devy link row render only outside the native workspace. An AllFantasy-hosted Devy league showed nothing Devy.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DEVY_TAB, isDevyWorkspaceLeague } from '@/lib/devy/workspaceTab'
import { buildNativeLeagueNavigation } from '@/lib/league/nativeLeagueNavigation'

describe('which leagues get the Devy tab', () => {
  it.each([
    [{ leagueVariant: 'devy_dynasty', leagueType: 'dynasty' }, true],
    [{ leagueVariant: 'DEVY', leagueType: null }, true],
    [{ leagueVariant: null, leagueType: 'devy' }, true],
    [{ leagueVariant: 'c2c', leagueType: 'c2c' }, false],
    [{ leagueVariant: 'merged_devy_c2c', leagueType: 'dynasty' }, false],
    [{ leagueVariant: null, leagueType: 'dynasty' }, false],
    [{ leagueVariant: null, leagueType: 'redraft' }, false],
  ])('%j → %s', (league, expected) => {
    expect(isDevyWorkspaceLeague(league)).toBe(expected)
  })
})

describe('LeagueShell wires the Devy home', () => {
  const shell = readFileSync('app/league/[leagueId]/LeagueShell.tsx', 'utf8')
  it('adds the tab with the dynasty tabs, for Devy leagues only', () => {
    expect(shell).toMatch(/\.\.\.\(isDevyWorkspaceLeague\(league\) \? \[\{ \.\.\.DEVY_TAB \}\] : \[\]\)/)
  })
  it('renders DevyHome for it', () => {
    expect(shell).toMatch(/case 'devy':\s*return \(\s*<div[^>]*>\s*<DevyHome leagueId=\{leagueId\} isCommissioner=\{isCommissioner\} \/>/)
  })
  it('is no longer only reachable through the unused OverviewTab', () => {
    expect(shell).toMatch(/import \{ DevyHome \} from '@\/components\/devy\/DevyHome'/)
  })
})

describe('sidebar', () => {
  const dynastyTabs = [
    { id: 'native_home', label: 'League home' },
    { id: 'dynasty', label: 'Dynasty' },
    { id: 'dynasty_taxi', label: 'Taxi' },
    { id: 'dynasty_picks', label: 'Picks' },
  ]
  it('the Devy pipeline sits in the Dynasty group with its own icon', () => {
    const groups = buildNativeLeagueNavigation([...dynastyTabs, { ...DEVY_TAB }], true)
    const dynasty = groups.find(g => g.id === 'dynasty')
    expect(dynasty?.items.map(i => [i.id, i.label, i.icon])).toContainEqual(['devy', 'Devy pipeline', 'devy'])
    expect(groups.find(g => g.id === 'more')?.items.some(i => i.id === 'devy') ?? false).toBe(false)
  })
  it('a dynasty league without Devy has no such entry', () => {
    const groups = buildNativeLeagueNavigation(dynastyTabs, true)
    expect(groups.flatMap(g => g.items).some(i => i.id === 'devy')).toBe(false)
  })
  it('the workspace has an icon for it', () => {
    expect(readFileSync('components/league/native/NativeLeagueWorkspace.tsx', 'utf8')).toMatch(/devy: GraduationCap/)
  })
})
