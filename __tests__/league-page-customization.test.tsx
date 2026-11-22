import { useEffect } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveHiddenHomeSections, isCategoryHiddenByHomeSection, DEFAULT_HIDDEN_HOME_SECTIONS } from '@/lib/core-app/homeSections'
import { resolveLeagueHomeHrefFromListRow } from '@/lib/dashboard/league-list-destination'
import { leagueEntryHref } from '@/lib/league/leagueEntryHref'
import { readHiddenLeagueSections } from '@/lib/league/leagueSections'
import { mergeNotificationPreferences } from '@/lib/notification-settings/mergeNotificationPreferences'
import { LeagueDisplayPreferences, LeagueSection } from '@/components/league/LeagueDisplayPreferences'
import { LeagueSectionsSettingsSection } from '@/app/settings/components/sections/LeagueSectionsSettingsSection'

vi.mock('@/components/i18n/LanguageProviderClient', async (load) => {
  const actual = await load<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})
afterEach(() => vi.unstubAllGlobals())

describe('shared core layout', () => {
  it('defaults to the reference layout without silencing draft, score or weekly alerts', () => {
    expect([...resolveHiddenHomeSections(null)]).toEqual(DEFAULT_HIDDEN_HOME_SECTIONS)
    for (const category of ['draft_alerts', 'matchup_results', 'lineup_reminders', 'live_game_alerts'] as const) {
      expect(isCategoryHiddenByHomeSection({}, category)).toBe(false)
    }
  })
  it('preserves existing choices, including show everything, and keeps display overrides independent', () => {
    expect([...resolveHiddenHomeSections({ hiddenHomeSections: [] })]).toEqual([])
    expect([...resolveHiddenHomeSections({ hiddenHomeSections: ['career'] })]).toEqual(['career'])
    const prefs = { hiddenHomeSections: ['drafts'], homeLayoutHiddenSections: ['career'] }
    expect([...resolveHiddenHomeSections(prefs)]).toEqual(['career'])
    expect(isCategoryHiddenByHomeSection(prefs, 'draft_alerts')).toBe(true)
  })
})

describe('league entry', () => {
  it.each(['manual', 'af', 'native', 'AllFantasy', null])('opens %s in AF League Home', platform => {
    expect(leagueEntryHref({ id: 'a & b', platform })).toBe('/league/a%20%26%20b')
  })
  it.each(['sleeper', 'espn', 'yahoo', 'future-provider'])('keeps %s on the imported dashboard', platform => {
    expect(leagueEntryHref({ id: 'one', platform })).toBe('/core?league=one')
  })
  it('preserves canonical imported ids and tournament hub destinations', () => {
    expect(resolveLeagueHomeHrefFromListRow({ id: 'provider-row', navigationLeagueId: 'af-id', platform: 'sleeper' })).toBe('/core?league=af-id')
    expect(resolveLeagueHomeHrefFromListRow({ id: 'hub', platform: 'allfantasy', leagueVariant: 'tournament_hub', settings: { tournamentId: 'cup' } })).toBe('/tournament/cup')
  })
  it('uses the converted copy’s current ownership, even when source history remains', () => {
    const converted = { id: 'af-copy', platform: 'manual', settings: { importedFrom: 'sleeper' } }
    expect(leagueEntryHref(converted)).toBe('/league/af-copy')
  })
})

describe('league display settings', () => {
  it('round-trips a visual choice without changing home preferences or alerts', () => {
    const saved = { categories: { draft_alerts: { enabled: true } }, hiddenHomeSections: ['rivals'] }
    const next = mergeNotificationPreferences(saved, { hiddenLeagueSections: ['chat', 'unknown', 'chat'] })
    expect(readHiddenLeagueSections(next)).toEqual(['chat'])
    expect(next.categories).toEqual(saved.categories)
    expect(next.hiddenHomeSections).toEqual(['rivals'])
    expect(readHiddenLeagueSections({ hiddenLeagueSections: 'chat' })).toEqual([])
  })
  it('does not mount hidden card effects and restores them when shown', () => {
    const mount = vi.fn()
    function Card() { useEffect(mount, []); return <p>Activity</p> }
    const { rerender } = render(<LeagueDisplayPreferences hidden={['activity']}><LeagueSection id="activity"><Card /></LeagueSection></LeagueDisplayPreferences>)
    expect(mount).not.toHaveBeenCalled()
    expect(screen.queryByText('Activity')).toBeNull()
    rerender(<LeagueDisplayPreferences hidden={[]}><LeagueSection id="activity"><Card /></LeagueSection></LeagueDisplayPreferences>)
    expect(mount).toHaveBeenCalledTimes(1)
  })
  it('saves rapid taps in order and restores choices from a fresh profile', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetcher)
    const refetch = vi.fn()
    const { rerender } = render(<LeagueSectionsSettingsSection profile={{ notificationPreferences: {} } as never} onRefetch={refetch} />)
    fireEvent.click(screen.getByRole('switch', { name: /Chat & Chimmy/ }))
    fireEvent.click(screen.getByRole('switch', { name: /Standings/ }))
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
    expect(fetcher).toHaveBeenCalledTimes(2)
    const patch = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(patch).toEqual({ notificationPreferences: { hiddenLeagueSections: ['standings', 'chat'] } })
    rerender(<LeagueSectionsSettingsSection profile={patch as never} onRefetch={refetch} />)
    expect(screen.getByRole('switch', { name: /Chat & Chimmy/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Show everything' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(JSON.parse(fetcher.mock.calls[2][1].body).notificationPreferences.hiddenLeagueSections).toEqual([])
  })
  it('rolls back a failed write and explains that it was not saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<LeagueSectionsSettingsSection profile={{ notificationPreferences: {} } as never} onRefetch={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch', { name: /League activity/ }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent("Couldn't save"))
    expect(screen.getByRole('switch', { name: /League activity/ })).toBeChecked()
  })
})
