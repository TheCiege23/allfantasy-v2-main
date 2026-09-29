"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { X, ChevronDown, ChevronUp } from 'lucide-react'
import { headshotUrl as buildHeadshot, teamLogoUrl as buildTeamLogo } from '@/lib/media-url'
import PlayerCardAnalytics from '@/components/player-card/PlayerCardAnalytics'
import { useUserTimezone } from '@/hooks/useUserTimezone'

const DEPTH_CHART_POSITION_MAP: Record<string, string> = {
  'RWR': 'WR',
  'LWR': 'WR',
  'SWR': 'WR',
  'SLOT_WR': 'WR',
  'SLOT': 'WR',
  'LCB': 'CB',
  'RCB': 'CB',
  'NICKEL': 'CB',
  'NB': 'CB',
  'LILB': 'LB',
  'RILB': 'LB',
  'LOLB': 'LB',
  'ROLB': 'LB',
  'SLB': 'LB',
  'WLB': 'LB',
  'MLB': 'LB',
  'RDE': 'DE',
  'LDE': 'DE',
  'RDT': 'DT',
  'LDT': 'DT',
  'NT': 'DT',
  'LT': 'OT',
  'RT': 'OT',
  'LG': 'OG',
  'RG': 'OG',
  'FS': 'S',
  'SS': 'S',
  'LEO': 'EDGE',
  'JACK': 'EDGE',
  'SAM': 'LB',
  'WILL': 'LB',
  'MIKE': 'LB',
  'FB': 'FB',
  'HB': 'RB',
}

function formatDepthChartPosition(raw: string): string {
  return DEPTH_CHART_POSITION_MAP[raw] || raw
}

interface PlayerDetailModalProps {
  isOpen: boolean
  onClose: () => void
  playerName: string
  playerId?: string
  position?: string
  team?: string
  sport?: string
}

interface GameLog {
  week: number
  opponent?: string
  pts_ppr?: number
  pts_half_ppr?: number
  pts_std?: number
  pass_att?: number
  pass_cmp?: number
  pass_yd?: number
  pass_td?: number
  pass_int?: number
  rush_att?: number
  rush_yd?: number
  rush_td?: number
  rec_tgt?: number
  rec?: number
  rec_yd?: number
  rec_td?: number
  fum_lost?: number
  gp?: number
}

export default function PlayerDetailModal({
  isOpen,
  onClose,
  playerName,
  playerId,
  position,
  team,
  sport,
}: PlayerDetailModalProps) {
  const { formatInTimezone } = useUserTimezone()
  const [loading, setLoading] = useState(true)
  const [bio, setBio] = useState<any>(null)
  const [news, setNews] = useState<any[]>([])
  const [error, setError] = useState('')
  const [gameLogs, setGameLogs] = useState<GameLog[]>([])
  const [gameLogsLoading, setGameLogsLoading] = useState(false)
  const [gameLogsExpanded, setGameLogsExpanded] = useState(false)
  const [gameLogsSeason, setGameLogsSeason] = useState('2025')
  const [gameLogsError, setGameLogsError] = useState('')

  const fetchProfile = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/legacy/player-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_name: playerName, player_id: playerId }),
      })
      const data = await res.json()
      if (data.ok) {
        setBio(data.bio)
        setNews(data.news || [])
      } else {
        setError(data.error || 'Failed to load player')
      }
    } catch {
      setError('Failed to load player profile')
    } finally {
      setLoading(false)
    }
  }, [playerName, playerId])

  const fetchGameLogs = useCallback(async (season: string) => {
    if (!playerId) return
    setGameLogsLoading(true)
    setGameLogsError('')
    try {
      const res = await fetch('/api/legacy/player-game-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId, season }),
      })
      const data = await res.json()
      if (data.ok) {
        setGameLogs(data.gameLogs || [])
      } else {
        setGameLogs([])
        setGameLogsError(data.error || 'Failed to load game logs')
      }
    } catch {
      setGameLogs([])
      setGameLogsError('Failed to load game logs')
    } finally {
      setGameLogsLoading(false)
    }
  }, [playerId])

  useEffect(() => {
    if (isOpen && playerName) {
      fetchProfile()
      setGameLogs([])
      setGameLogsExpanded(false)
    }
  }, [isOpen, playerName, fetchProfile])

  useEffect(() => {
    if (isOpen && playerId && bio && gameLogsExpanded) {
      fetchGameLogs(gameLogsSeason)
    }
  }, [isOpen, playerId, bio, gameLogsSeason, gameLogsExpanded, fetchGameLogs])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (!isOpen) return null

  const headshotUrl = buildHeadshot(bio?.sleeperId || playerId) || null
  
  const teamLogoUrl = buildTeamLogo(bio?.team || team) || null

  const posColor = (pos: string) => {
    switch(pos) {
      case 'QB': return 'bg-red-500 text-white'
      case 'RB': return 'bg-emerald-500 text-white'
      case 'WR': return 'bg-blue-500 text-white'
      case 'TE': return 'bg-amber-500 text-white'
      case 'K': return 'bg-purple-500 text-white'
      case 'DEF': return 'bg-orange-500 text-white'
      default: return 'bg-gray-500 text-white'
    }
  }

  const injuryColor = (status: string | null) => {
    if (!status) return null
    switch(status.toLowerCase()) {
      case 'questionable': return 'bg-yellow-500 text-black'
      case 'doubtful': return 'bg-orange-500 text-white'
      case 'out': return 'bg-red-500 text-white'
      case 'ir': return 'bg-red-700 text-white'
      case 'pup': return 'bg-red-600 text-white'
      case 'sus': return 'bg-gray-600 text-white'
      default: return 'bg-yellow-500 text-black'
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div 
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-gradient-to-b from-[#1a1a2e] to-[#0d0d1a] border border-white/10 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition">
          <X className="w-4 h-4 text-white" />
        </button>

        {loading ? (
          <div className="p-12 text-center">
            <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white/60 text-sm">Loading player profile...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : bio ? (
          <>
            <div className="relative p-6 pb-4">
              <div className="flex items-start gap-4">
                <div className="relative flex-shrink-0">
                  {headshotUrl ? (
                    <img 
                      src={headshotUrl} 
                      alt={bio.name} 
                      className="w-24 h-24 rounded-xl object-cover bg-white/10 border border-white/10"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; e.currentTarget.nextElementSibling && ((e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex') }}
                    />
                  ) : null}
                  <div className={`w-24 h-24 rounded-xl bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center text-3xl font-bold text-white ${headshotUrl ? 'hidden' : ''}`}>
                    {bio.name?.charAt(0) || '?'}
                  </div>
                  {teamLogoUrl && (
                    <img 
                      src={teamLogoUrl} 
                      alt={bio.team || ''} 
                      className="absolute -bottom-2 -right-2 w-10 h-10 object-contain"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-white">{bio.name}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${posColor(bio.position)}`}>
                      {bio.position}
                    </span>
                    {bio.team && (
                      <span className="text-sm text-white/60">{bio.team} #{bio.number || '—'}</span>
                    )}
                    {bio.injuryStatus && (
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${injuryColor(bio.injuryStatus)}`}>
                        {bio.injuryStatus}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-4 mt-3 flex-wrap">
                    {bio.age && (
                      <div>
                        <div className="text-[11px] text-white/40 uppercase">Age</div>
                        <div className="text-sm font-bold text-white">{bio.age}</div>
                      </div>
                    )}
                    {bio.height && (
                      <div>
                        <div className="text-[11px] text-white/40 uppercase">Height</div>
                        <div className="text-sm font-bold text-white">{bio.height}</div>
                      </div>
                    )}
                    {bio.weight && (
                      <div>
                        <div className="text-[11px] text-white/40 uppercase">Weight</div>
                        <div className="text-sm font-bold text-white">{bio.weight} lbs</div>
                      </div>
                    )}
                    {bio.yearsExp != null && (
                      <div>
                        <div className="text-[11px] text-white/40 uppercase">Exp</div>
                        <div className="text-sm font-bold text-white">{bio.yearsExp}</div>
                      </div>
                    )}
                    {bio.college && (
                      <div>
                        <div className="text-[11px] text-white/40 uppercase">College</div>
                        <div className="text-sm font-bold text-white">{bio.college}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {bio.injuryNotes && (
                <div className="mt-3 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                  <div className="text-xs text-yellow-300">
                    <span className="font-semibold">Injury: </span>
                    {bio.injuryBodyPart && <span className="text-yellow-200">{bio.injuryBodyPart} — </span>}
                    {bio.injuryNotes}
                  </div>
                </div>
              )}

              {bio.depthChartPosition && (
                <div className="mt-3 p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-xs text-white/60">
                    <span className="font-semibold text-white/80">Depth Chart: </span>
                    {formatDepthChartPosition(bio.depthChartPosition)} — #{bio.depthChartOrder || '?'}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 pb-6">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-base">📰</span> Latest News
              </h3>
              {news.length > 0 ? (
                <div className="space-y-3">
                  {news.map((article: any, idx: number) => (
                    <div key={article.id || idx} className="p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/[0.07] transition">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-semibold text-white/90 leading-snug">{article.title}</h4>
                        {article.publishedAt && (
                          <span className="text-[11px] text-white/40 whitespace-nowrap flex-shrink-0">
                            {formatInTimezone(article.publishedAt, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                      {article.description && (
                        <p className="mt-1.5 text-xs text-white/60 leading-relaxed line-clamp-3">{article.description}</p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        {article.source && (
                          <span className="text-[11px] text-cyan-300/70">via {article.source}</span>
                        )}
                        {article.url && (
                          <a href={article.url} target="_blank" rel="noreferrer" className="text-[11px] text-cyan-400 hover:text-cyan-300 underline">
                            Read more
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
                  <p className="text-xs text-white/40">No recent news found for {bio.name}</p>
                </div>
              )}
            </div>

            <div className="px-6 pb-4">
              <PlayerCardAnalytics
                playerId={playerId}
                playerName={bio.name ?? playerName}
                position={bio.position ?? position}
                team={bio.team ?? team}
                sport={sport}
                eager={true}
              />
            </div>

            {playerId && (
              <div className="px-6 pb-6">
                <button
                  onClick={() => setGameLogsExpanded(!gameLogsExpanded)}
                  className="w-full flex items-center justify-between text-sm font-bold text-white mb-3"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-base">📊</span> Game Logs
                  </span>
                  {gameLogsExpanded ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                </button>

                {gameLogsExpanded && (
                  <div>
                    <div className="flex gap-1.5 mb-3">
                      {['2025', '2024', '2023', '2022'].map(yr => (
                        <button
                          key={yr}
                          onClick={() => setGameLogsSeason(yr)}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                            gameLogsSeason === yr
                              ? 'bg-cyan-500 text-white'
                              : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70'
                          }`}
                        >
                          {yr}
                        </button>
                      ))}
                    </div>

                    {gameLogsLoading ? (
                      <div className="py-6 text-center">
                        <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        <p className="text-xs text-white/40">Loading game logs...</p>
                      </div>
                    ) : gameLogs.length > 0 ? (
                      <div className="overflow-x-auto -mx-2">
                        <table className="w-full text-xs min-w-[500px]">
                          <thead>
                            <tr className="border-b border-white/10">
                              <th className="text-left py-2 px-2 text-white/40 font-medium">WK</th>
                              <th className="text-left py-2 px-2 text-white/40 font-medium">OPP</th>
                              <th className="text-right py-2 px-2 text-white/40 font-medium">FPTS</th>
                              {(bio?.position === 'QB') && (
                                <>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">CMP</th>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">ATT</th>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">YD</th>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">TD</th>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">INT</th>
                                </>
                              )}
                              {(bio?.position === 'RB') && (
                                <>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">CAR</th>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">YD</th>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">TD</th>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">REC</th>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">REC YD</th>
                                </>
                              )}
                              {(bio?.position === 'WR' || bio?.position === 'TE') && (
                                <>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">TGT</th>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">REC</th>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">YD</th>
                                  <th className="text-right py-2 px-2 text-white/40 font-medium">TD</th>
                                </>
                              )}
                              <th className="text-right py-2 px-2 text-white/40 font-medium">{bio?.position === 'QB' ? 'R YD' : 'CAR'}</th>
                              {(bio?.position !== 'QB') && (
                                <th className="text-right py-2 px-2 text-white/40 font-medium">R YD</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {gameLogs.map(log => {
                              const fpts = log.pts_ppr ?? log.pts_half_ppr ?? log.pts_std
                              const hasStats = fpts !== undefined && fpts > 0
                              const fptsColor = fpts !== undefined
                                ? fpts >= 20 ? 'text-green-400 font-bold'
                                  : fpts >= 10 ? 'text-cyan-300'
                                    : fpts > 0 ? 'text-white/70'
                                      : 'text-white/30'
                                : 'text-white/30'

                              return (
                                <tr key={log.week} className={`border-b border-white/5 ${hasStats ? 'hover:bg-white/5' : 'opacity-50'}`}>
                                  <td className="py-1.5 px-2 text-white/60">{log.week}</td>
                                  <td className="py-1.5 px-2 text-white/70 font-medium">{log.opponent || '—'}</td>
                                  <td className={`py-1.5 px-2 text-right ${fptsColor}`}>
                                    {fpts !== undefined ? fpts.toFixed(1) : '—'}
                                  </td>
                                  {bio?.position === 'QB' && (
                                    <>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.pass_cmp ?? '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.pass_att ?? '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.pass_yd ?? '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.pass_td ?? '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.pass_int ?? '—'}</td>
                                    </>
                                  )}
                                  {bio?.position === 'RB' && (
                                    <>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.rush_att ?? '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.rush_yd ?? '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.rush_td ?? '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.rec ?? '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.rec_yd ?? '—'}</td>
                                    </>
                                  )}
                                  {(bio?.position === 'WR' || bio?.position === 'TE') && (
                                    <>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.rec_tgt ?? '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.rec ?? '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.rec_yd ?? '—'}</td>
                                      <td className="py-1.5 px-2 text-right text-white/60">{log.rec_td ?? '—'}</td>
                                    </>
                                  )}
                                  <td className="py-1.5 px-2 text-right text-white/60">
                                    {bio?.position === 'QB'
                                      ? (log.rush_yd !== undefined ? `${log.rush_yd}` : '—')
                                      : (log.rush_att ?? '—')}
                                  </td>
                                  {bio?.position !== 'QB' && (
                                    <td className="py-1.5 px-2 text-right text-white/60">{log.rush_yd ?? '—'}</td>
                                  )}
                                </tr>
                              )
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-white/15">
                              <td className="py-2 px-2 text-white/80 font-bold" colSpan={2}>TOTAL</td>
                              <td className="py-2 px-2 text-right text-cyan-300 font-bold">
                                {gameLogs.reduce((sum, l) => sum + (l.pts_ppr ?? l.pts_half_ppr ?? l.pts_std ?? 0), 0).toFixed(1)}
                              </td>
                              {bio?.position === 'QB' && (
                                <>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.pass_cmp ?? 0), 0)}</td>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.pass_att ?? 0), 0)}</td>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.pass_yd ?? 0), 0)}</td>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.pass_td ?? 0), 0)}</td>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.pass_int ?? 0), 0)}</td>
                                </>
                              )}
                              {bio?.position === 'RB' && (
                                <>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.rush_att ?? 0), 0)}</td>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.rush_yd ?? 0), 0)}</td>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.rush_td ?? 0), 0)}</td>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.rec ?? 0), 0)}</td>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.rec_yd ?? 0), 0)}</td>
                                </>
                              )}
                              {(bio?.position === 'WR' || bio?.position === 'TE') && (
                                <>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.rec_tgt ?? 0), 0)}</td>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.rec ?? 0), 0)}</td>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.rec_yd ?? 0), 0)}</td>
                                  <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.rec_td ?? 0), 0)}</td>
                                </>
                              )}
                              <td className="py-2 px-2 text-right text-white/60 font-medium">
                                {bio?.position === 'QB'
                                  ? gameLogs.reduce((s, l) => s + (l.rush_yd ?? 0), 0)
                                  : gameLogs.reduce((s, l) => s + (l.rush_att ?? 0), 0)}
                              </td>
                              {bio?.position !== 'QB' && (
                                <td className="py-2 px-2 text-right text-white/60 font-medium">{gameLogs.reduce((s, l) => s + (l.rush_yd ?? 0), 0)}</td>
                              )}
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ) : gameLogsError ? (
                      <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-center">
                        <p className="text-xs text-red-300">{gameLogsError}</p>
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
                        <p className="text-xs text-white/40">No game logs found for {gameLogsSeason} season</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
