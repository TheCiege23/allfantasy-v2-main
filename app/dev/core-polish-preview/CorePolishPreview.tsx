'use client'
import { useState } from 'react'
import AfCoreShell from '@/components/core-app/AfCoreShell'
import { Dash3ALeagues } from '@/components/core-app/screens/Dashboard3A'
import LeagueTabs from '@/components/core-app/LeagueTabs'
import LiveScores from '@/components/core-app/screens/LiveScores'
import type { LivePageData } from '@/lib/live/liveScoresPage'

const leagues = [
  { id: 'preview-one', name: 'Preview · Sunday Dynasty', platform: 'manual', mark: 'SD', sport: 'NFL', imageUrl: '/league-type-dynasty.png' },
  { id: 'preview-two', name: 'Preview · Hardwood League', platform: 'manual', mark: 'HL', sport: 'NBA' },
  { id: 'preview-three', name: 'Preview · Friends & Football', platform: 'manual', mark: 'FF', sport: 'NFL' },
]
const game = {
  gameId: 'preview', sport: 'NFL', week: 7, status: 'live', statusDetail: '3rd quarter', clockLabel: 'Q3 · 08:42',
  isLive: true, completed: false, startTime: '2026-10-20T20:00:00.000Z',
  home: { abbrev: 'HOME', name: 'Preview Home', logo: '', score: 21, record: '4–2', linescores: [], hits: null, errors: null, leaders: [], shooting: null },
  away: { abbrev: 'AWAY', name: 'Preview Away', logo: '', score: 17, record: '3–3', linescores: [], hits: null, errors: null, leaders: [], shooting: null },
  winProbability: null, topPerformer: null, leaders: [], situation: null, venue: null, broadcast: null,
  espnDetail: true, leadersArePregame: false, tieIns: [], leaguesAffected: 0,
}
const data = {
  sport: 'NFL', scope: 'all', counts: [{sport:'NFL',label:'NFL',slateCount:1},{sport:'NBA',label:'NBA',slateCount:0}],
  games: [game], impact: { totalPoints: 0, livePlayers: 0, liveGames: 1, biggestMover: null, plays: [], upNext: [] },
  lockAlerts: [], fetchedAt: new Date().toISOString(), hasRosterData: false, loadFailed: false,
} as LivePageData

export default function CorePolishPreview() {
  const [view, setView] = useState<'home' | 'live'>('home')
  return <AfCoreShell active={view} leagues={leagues} syncAge={{label:'just now',stale:false}} syncEligibleCount={0}
    scope={{value:null,label:'All leagues',favoriteIds:[],leagues}} comms={{leagues:[],chimmyTokenCost:null,dockable:false,supportEmail:null}}
    railMatchups={{'preview-one':{yourTeam:'Preview team',yourAvatarUrl:null,yourScore:112.4,opponentTeam:'Preview opponent',opponentAvatarUrl:null,opponentScore:104.2,scored:true,week:7}}}>
    <p style={{color:'var(--muted)',fontSize:13}}>Development preview · synthetic data</p>
    <div style={{display:'flex',gap:8,marginBottom:16}}>
      <button className="af-btn" onClick={()=>setView('home')}>Dashboard preview</button>
      <button className="af-btn" onClick={()=>setView('live')}>Scoreboard preview</button>
    </div>
    {view==='home' ? <>
      <h1 style={{fontSize:28,letterSpacing:'-.04em',margin:'8px 0 18px'}}>Your leagues</h1>
      <Dash3ALeagues totalLeagues={3} leagues={leagues.map(l=>({...l, formatLabel:'12 teams · Dynasty', href:'#', score:l.id==='preview-one'?{you:112.4,opponent:104.2,opponentName:'Preview opponent'}:null}))} />
      <div style={{marginTop:24}}><LeagueTabs leagueId="preview-one" leagueName="Preview league" activeKey="home" compact /></div>
    </> : <LiveScores data={data} />}
  </AfCoreShell>
}
