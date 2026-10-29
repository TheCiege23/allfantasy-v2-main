'use client'
import '@/components/core-app/af-core.css'
import { WarRoomPopup } from '@/components/app/draft-room/WarRoomPopup'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { NativeLeagueHome } from '@/components/league/native/NativeLeagueHome'
import { DraftRoomShell, type MobileDraftTab } from '@/components/app/draft-room/DraftRoomShell'
import { DraftTopBar } from '@/components/app/draft-room/DraftTopBar'
import { SupportModal } from '@/components/core-app/support/SupportModal'
import { SupportCrestWidget } from '@/components/support/SupportCrestWidget'
import { LeagueTabs } from '@/components/core-app/LeagueTabs'
import { ImportedLeagueQuickActions } from '@/components/league/ImportedLeagueQuickActions'
import GlobalTopNav from '@/components/shared/GlobalTopNav'
const league = { id: 'mobile-preview', name: 'Sunday Night Dynasty', platform: 'allfantasy', sport: 'NFL', season: 2026, teamCount: 12, format: 'redraft', scoring: 'PPR', status: 'pre_draft', settings: {} } as UserLeague
const tabs = ['native_home','roster','matchups','waivers','trades','draft','standings','league_chat','settings'].map(id => ({id,label:id}))
export default function Preview() {
  const [tab,setTab] = useState('native_home')
  const [draftTab,setDraftTab] = useState<MobileDraftTab>('board')
  const [supportOpen, setSupportOpen] = useState(false)
  const search = useSearchParams()
  if (search?.get('screen') === 'navigation') return <GlobalTopNav isAuthenticated userLabel="Layout preview" />
  if (search?.get('screen') === 'support') return <div data-testid="mobile-support-preview">
    <div className="af-core p-4">
      <button className="af-btn" onClick={() => setSupportOpen(true)}>Preview core support</button>
      <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} defaultEmail="preview@example.com" />
      <LeagueTabs leagueId="mobile-preview" leagueName={league.name} activeKey="moves" compact platform="sleeper" />
      <ImportedLeagueQuickActions leagueId="mobile-preview" leagueName={league.name} platform="Sleeper" canRemove />
      <div style={{ height: 1800 }}>This week</div>
    </div>
    <SupportCrestWidget defaultEmail="preview@example.com" />
  </div>
  if (search?.get('screen') === 'draft') return <><DraftRoomShell
    topBar={<DraftTopBar leagueName={league.name} sport="NFL" draftType="snake" teamCount={12} rounds={15} currentManagerOnClock="Midnight Routes" pickLabel="1.01" overallPickNumber={1} timerStatus="paused" timerRemainingSeconds={60} isCommissioner draftStatus="paused" backHref="/dev/league-mobile-preview" onResume={() => {}} onToggleAutoPick={() => {}} onOpenDraftRoomSettings={() => {}} onResync={() => {}} />}
    managerStrip={null} mobileTab={draftTab} onMobileTabChange={setDraftTab}
    draftBoard={<div style={{width:1200,display:'grid',gridTemplateColumns:'repeat(12, 1fr)',gap:8}}>{Array.from({length:60},(_,i)=><div key={i} className="h-20 rounded-xl border border-cyan-400/20 bg-cyan-950/20 p-3 text-xs">{Math.floor(i/12)+1}.{i%12+1}<p className="mt-2 text-white/50">Waiting</p></div>)}</div>}
    playerPanel={<div><input aria-label="Search players" placeholder="Search players" className="w-full rounded-lg bg-slate-900 p-3" />{['Justin Jefferson','Ja’Marr Chase','Bijan Robinson'].map(name=><div key={name} className="flex justify-between border-b border-white/10 p-3"><span>{name}</span><button className="rounded-lg bg-cyan-900 px-3">Queue</button></div>)}</div>}
    queuePanel={<p>Your queued players appear here.</p>}
    chatPanel={<div><p>League chat</p><textarea aria-label="Message" placeholder="Message your league" className="mt-4 w-full rounded-lg bg-slate-900 p-3" /></div>}
    rosterPanel={<p>Your team</p>} keeperPanel={<p>Keepers</p>} intelPanel={<p>Before your next pick</p>} /><WarRoomPopup><p className="p-4">Your draft team and guidance</p></WarRoomPopup></>
  return <NativeLeagueWorkspace native league={league} leagues={[league]} tabs={tabs} activeTab={tab} isCommissioner onSelectTab={setTab} onOpenSettings={()=>setTab('settings')} leftPanel={null} rightPanel={null}>
    {tab === 'native_home' ? <NativeLeagueHome league={league} teams={[]} userTeamId={null} isCommissioner={false} draftDateIso="2026-10-26T00:00:00Z" snapshot={null} settingsOpen={false} onOpenSettings={()=>setTab('settings')} onSelectTab={setTab} /> : <section className="nl-card"><h2>{tabs.find(item=>item.id===tab)?.label}</h2><p>The selected league section stays in this workspace.</p></section>}
  </NativeLeagueWorkspace>
}
