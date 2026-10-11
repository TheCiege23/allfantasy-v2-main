'use client'

import { useEffect, useRef, useState } from 'react'
import type { MyTeamData } from '@/lib/core-app/myTeam'
import type { TeamHighlightsResult } from '@/lib/highlights/types'
import HighlightVideos from './player-card/HighlightVideos'
import './af-player-card.css'

export default function MyTeamHighlights({ data }: { data: MyTeamData }) {
  const starters = data.starters.available ? data.starters.data.flatMap(slot => slot.player ? [slot.player] : []) : []
  const bench = data.bench.available ? data.bench.data : []
  const reserve = [...(data.ir.available ? data.ir.data : []), ...(data.taxi.available ? data.taxi.data : [])]
  const nfl = (players: typeof bench) => [...new Set(players.filter(p => p.sport?.toUpperCase() === 'NFL').map(p => p.sleeperId).filter(Boolean))]
  const groups = { all: nfl([...starters, ...bench, ...reserve]), starters: nfl(starters), bench: nfl(bench) }
  if (!groups.all.length) return null
  return <TeamHighlights key={`${data.league.id}:${groups.all.slice().sort().join(',')}:${groups.starters.join(',')}`} groups={groups} />
}

function TeamHighlights({ groups }: { groups: Record<'all' | 'starters' | 'bench', string[]> }) {
  const [scope, setScope] = useState<'all' | 'starters' | 'bench'>('all')
  const [result, setResult] = useState<TeamHighlightsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function load() {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setLoading(true); setError(false)
    try {
      const response = await fetch('/api/core/my-team/highlights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerIds: groups.all.slice(0, 60) }), signal: request.signal })
      if (!response.ok) throw new Error('Unavailable')
      const next: TeamHighlightsResult = await response.json()
      if (!request.signal.aborted) setResult(next)
    } catch { if (!request.signal.aborted) setError(true) }
    finally { if (!request.signal.aborted) setLoading(false) }
  }
  const videos = result?.videos.filter(video => video.players.some(player => groups[scope].includes(player.sleeperId))) ?? []
  return <section className="af-frame af-mt-section af-team-highlights" aria-label="My Team Highlights">
    <header className="af-mt-section-head"><h2 className="af-label">My Team Highlights</h2><span className="af-mt-section-note">Official NFL · YouTube</span></header>
    <p className="af-pc-faint">Recent clips for your current roster. Team recaps may not feature every player.</p>
    <div className="af-team-highlights-controls">
      <label>Show <select aria-label="Highlights roster filter" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="all">Full roster</option><option value="starters">Starters</option><option value="bench">Bench</option></select></label>
      <button type="button" className="af-pc-highlights-load" disabled={loading} onClick={load}>{loading ? 'Finding highlights…' : result || error ? 'Refresh highlights' : 'Find team highlights'}</button>
    </div>
    <div role="status" aria-live="polite">{error ? <p>Highlights could not be loaded. Please try again later.</p> : result?.message ? <p>{result.message}</p> : result && !videos.length ? <p>No recent highlights for this roster filter.</p> : null}</div>
    <div className="af-team-highlights-grid">{videos.map(video => <div key={video.videoId}><p className="af-pc-faint">{video.players.filter(p => groups[scope].includes(p.sleeperId)).map(p => p.name).join(' · ')}</p><HighlightVideos videos={[video]} /></div>)}</div>
    <p className="af-pc-highlight-disclosure">Finding highlights loads YouTube thumbnails. Videos open on YouTube in a new tab. <a href="/privacy#youtube-highlights">Privacy</a>{' · '}<a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms</a></p>
  </section>
}
