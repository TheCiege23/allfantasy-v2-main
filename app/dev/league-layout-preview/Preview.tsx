'use client'
import { useEffect, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { LeagueSectionsSettingsSection } from '@/app/settings/components/sections/LeagueSectionsSettingsSection'
import { HomeSectionsSettingsSection } from '@/app/settings/components/sections/HomeSectionsSettingsSection'
import { LeagueDisplayPreferences } from '@/components/league/LeagueDisplayPreferences'
import { NativeLeagueHome } from '@/components/league/native/NativeLeagueHome'
import { readHiddenLeagueSections } from '@/lib/league/leagueSections'
import '@/components/core-app/af-core.css'
import '@/components/league/native/native-league.css'
import '@/app/settings/nocturne-settings.css'

const league = { id: 'layout-preview', name: 'Sunday Night Dynasty', platform: 'manual', sport: 'NFL', season: 2026, teamCount: 12, format: 'redraft', scoring: 'PPR', status: 'pre_draft', settings: {} } as UserLeague
export default function Preview() {
  const [profile, setProfile] = useState<{ notificationPreferences: Record<string, unknown> } | null>(null)
  const [view, setView] = useState('settings')
  const refetch = () => { void fetch('/api/user/profile').then(r => r.json()).then(body => setProfile(body.profile)) }
  useEffect(refetch, [])
  if (!profile) return <p>Loading preview</p>
  return <div className={view === 'settings' || view === 'home' ? 'nocturne-settings' : 'af-core nl-workspace'} style={{ display: 'block', height: 'auto', minHeight: '100dvh', overflow: 'visible', padding: 16 }}>
    <nav className="mb-4 flex flex-wrap gap-3">{['settings', 'league', 'home'].map(id => <button key={id} className="min-h-[44px] rounded-lg border px-4" onClick={() => setView(id)}>{id}</button>)}</nav>
    {view === 'settings' ? <LeagueSectionsSettingsSection profile={profile as never} onRefetch={refetch} />
      : view === 'home' ? <HomeSectionsSettingsSection profile={profile as never} onRefetch={refetch} />
      : <LeagueDisplayPreferences hidden={readHiddenLeagueSections(profile.notificationPreferences)}><NativeLeagueHome league={league} teams={[]} userTeamId={null} isCommissioner={false} draftDateIso={null} snapshot={null} settingsOpen={false} onOpenSettings={() => setView('settings')} onSelectTab={setView} /></LeagueDisplayPreferences>}
  </div>
}
