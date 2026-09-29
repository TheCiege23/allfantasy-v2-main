'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import { headshotUrl, teamLogoUrl } from '@/lib/media-url'
import PlayerCardAnalytics from '@/components/player-card/PlayerCardAnalytics'

const POS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  QB: { bg: 'bg-red-500', text: 'text-white', border: 'border-red-500/40' },
  RB: { bg: 'bg-emerald-500', text: 'text-white', border: 'border-emerald-500/40' },
  WR: { bg: 'bg-blue-500', text: 'text-white', border: 'border-blue-500/40' },
  TE: { bg: 'bg-orange-500', text: 'text-white', border: 'border-orange-500/40' },
  K: { bg: 'bg-purple-500', text: 'text-white', border: 'border-purple-500/40' },
  PK: { bg: 'bg-purple-500', text: 'text-white', border: 'border-purple-500/40' },
  DEF: { bg: 'bg-yellow-600', text: 'text-white', border: 'border-yellow-600/40' },
  DL: { bg: 'bg-yellow-600', text: 'text-white', border: 'border-yellow-600/40' },
  LB: { bg: 'bg-yellow-600', text: 'text-white', border: 'border-yellow-600/40' },
  DB: { bg: 'bg-yellow-600', text: 'text-white', border: 'border-yellow-600/40' },
}

const NFL_TEAM_FULL: Record<string, string> = {
  ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills',
  CAR: 'Panthers', CHI: 'Bears', CIN: 'Bengals', CLE: 'Browns',
  DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers',
  HOU: 'Texans', IND: 'Colts', JAX: 'Jaguars', KC: 'Chiefs',
  LAC: 'Chargers', LAR: 'Rams', LV: 'Raiders', MIA: 'Dolphins',
  MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants',
  NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SEA: 'Seahawks',
  SF: '49ers', TB: 'Buccaneers', TEN: 'Titans', WAS: 'Commanders',
}

interface PlayerData {
  playerId: string
  playerName: string
  position: string
  team: string | null
  age: number | null
  experience: number | null
  injuryStatus: string | null
  injuryBodyPart: string | null
  height: string | null
  weight: string | null
  college: string | null
  number: number | null
  depthChartPosition: string | null
  depthChartOrder: number | null
  fantasyPositions: string[]
  searchRank: number | null
  ownership: {
    count: number
    total: number
    percentage: number
  }
  stock: {
    direction: 'up' | 'down' | 'stable'
    signal: string
    reason: string
    recentActivity?: {
      tradesIn: number
      tradesOut: number
    }
  }
  leagues: Array<{
    leagueId: string
    leagueName: string
    season: number
    leagueType: string | null
    rosterStatus: string
    ownerName: string | null
    isUserOwned: boolean
  }>
}

interface PlayerProfileCardProps {
  player: PlayerData
  onClose: () => void
  sport?: string | null
}

export default function PlayerProfileCard({ player, onClose, sport = 'NFL' }: PlayerProfileCardProps) {
  const [imgError, setImgError] = useState(false)
  const [logoError, setLogoError] = useState(false)
  const [activeSection, setActiveSection] = useState<'overview' | 'leagues'>('overview')

  const pos = (player.position || '').toUpperCase()
  const posStyle = POS_COLORS[pos] || { bg: 'bg-gray-500', text: 'text-white', border: 'border-gray-500/40' }
  const headshot = headshotUrl(player.playerId)
  const logo = player.team ? teamLogoUrl(player.team) : ''
  const name = player.playerName || 'Unknown Player'
  const ownership = player.ownership || { count: 0, total: 0, percentage: 0 }

  const statusBadge = player.injuryStatus && player.injuryStatus !== 'Active' ? player.injuryStatus : null

  return (
    <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
      <div className="relative">
        <div className={`h-1.5 ${posStyle.bg}`} />

        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white/60 hover:text-white transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        <div className="p-4 sm:p-5">
          <div className="flex gap-4">
            <div className="relative flex-shrink-0">
              <div className={`w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden border-2 ${posStyle.border} bg-black/30`}>
                {headshot && !imgError ? (
                  <Image
                    src={headshot}
                    alt={name}
                    width={96}
                    height={96}
                    className="w-full h-full object-cover"
                    onError={() => setImgError(true)}
                    unoptimized
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/20 text-3xl">
                    {name.charAt(0)}
                  </div>
                )}
              </div>

              {logo && !logoError && (
                <div className="absolute -bottom-1 -right-1 w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-black/80 border border-white/10 p-1 flex items-center justify-center">
                  <Image
                    src={logo}
                    alt={player.team || ''}
                    width={28}
                    height={28}
                    className="object-contain"
                    onError={() => setLogoError(true)}
                    unoptimized
                  />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xl sm:text-2xl font-bold text-white truncate">{name}</h3>
                {statusBadge && (
                  <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                    statusBadge === 'IR' || statusBadge === 'Out'
                      ? 'bg-red-500/30 text-red-300'
                      : statusBadge === 'Doubtful' || statusBadge === 'Questionable'
                      ? 'bg-yellow-500/30 text-yellow-300'
                      : 'bg-orange-500/30 text-orange-300'
                  }`}>
                    {statusBadge}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 mt-1">
                <span className={`${posStyle.bg} ${posStyle.text} text-xs font-bold px-2 py-0.5 rounded`}>
                  {pos}
                </span>
                <span className="text-white/60 text-sm">
                  {player.team ? `${player.team} #${player.number ?? '—'}` : 'Free Agent'}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
                {player.age != null && (
                  <div>
                    <span className="text-[11px] uppercase text-white/40 block leading-tight">Age</span>
                    <span className="text-sm font-bold text-white">{player.age}</span>
                  </div>
                )}
                {player.height && (
                  <div>
                    <span className="text-[11px] uppercase text-white/40 block leading-tight">Height</span>
                    <span className="text-sm font-bold text-white">{player.height}</span>
                  </div>
                )}
                {player.weight && (
                  <div>
                    <span className="text-[11px] uppercase text-white/40 block leading-tight">Weight</span>
                    <span className="text-sm font-bold text-white">{player.weight} lbs</span>
                  </div>
                )}
                {player.experience != null && (
                  <div>
                    <span className="text-[11px] uppercase text-white/40 block leading-tight">Exp</span>
                    <span className="text-sm font-bold text-white">{player.experience}</span>
                  </div>
                )}
                {player.college && (
                  <div>
                    <span className="text-[11px] uppercase text-white/40 block leading-tight">College</span>
                    <span className="text-sm font-bold text-white">{player.college}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {player.depthChartOrder != null && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[11px] uppercase text-white/40">Depth Chart</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                player.depthChartOrder === 1
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : player.depthChartOrder === 2
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'bg-white/10 text-white/60 border border-white/10'
              }`}>
                {player.depthChartPosition || pos} #{player.depthChartOrder}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="flex">
          <button
            onClick={() => setActiveSection('overview')}
            className={`flex-1 py-2.5 text-xs font-semibold text-center transition ${
              activeSection === 'overview'
                ? 'text-cyan-400 border-b-2 border-cyan-400'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveSection('leagues')}
            className={`flex-1 py-2.5 text-xs font-semibold text-center transition ${
              activeSection === 'leagues'
                ? 'text-cyan-400 border-b-2 border-cyan-400'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            Your Leagues ({player.leagues.length})
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {activeSection === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-black/30 rounded-xl p-3 text-center border border-white/5">
                <div className="text-lg font-bold text-cyan-400">
                  {ownership.percentage}%
                </div>
                <div className="text-[11px] text-white/40 uppercase mt-0.5">Ownership</div>
              </div>
              <div className="bg-black/30 rounded-xl p-3 text-center border border-white/5">
                <div className="text-lg font-bold text-white">
                  {ownership.count}/{ownership.total}
                </div>
                <div className="text-[11px] text-white/40 uppercase mt-0.5">Leagues</div>
              </div>
              <div className="bg-black/30 rounded-xl p-3 text-center border border-white/5">
                <div className={`text-lg font-bold ${
                  player.searchRank != null && player.searchRank <= 50
                    ? 'text-emerald-400'
                    : player.searchRank != null && player.searchRank <= 150
                    ? 'text-cyan-400'
                    : 'text-white/60'
                }`}>
                  {player.searchRank != null ? `#${player.searchRank}` : '—'}
                </div>
                <div className="text-[11px] text-white/40 uppercase mt-0.5">Rank</div>
              </div>
            </div>

            {player.stock && (
              <div className={`p-3 rounded-xl ${
                player.stock.signal === 'strong_sell' || player.stock.signal === 'sell'
                  ? 'bg-gradient-to-r from-red-500/15 to-orange-500/15 border border-red-500/20'
                  : player.stock.signal === 'strong_buy' || player.stock.signal === 'buy'
                  ? 'bg-gradient-to-r from-green-500/15 to-emerald-500/15 border border-green-500/20'
                  : 'bg-white/5 border border-white/10'
              }`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-base">
                    {player.stock.direction === 'up' ? '📈' : player.stock.direction === 'down' ? '📉' : '➖'}
                  </span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    player.stock.signal === 'strong_sell' ? 'bg-red-500/30 text-red-300' :
                    player.stock.signal === 'sell' ? 'bg-orange-500/30 text-orange-300' :
                    player.stock.signal === 'strong_buy' ? 'bg-green-500/30 text-green-300' :
                    player.stock.signal === 'buy' ? 'bg-emerald-500/30 text-emerald-300' :
                    'bg-white/10 text-white/60'
                  }`}>
                    {player.stock.signal === 'strong_sell' ? 'STRONG SELL' :
                     player.stock.signal === 'sell' ? 'SELL' :
                     player.stock.signal === 'strong_buy' ? 'STRONG BUY' :
                     player.stock.signal === 'buy' ? 'BUY' : 'HOLD'}
                  </span>
                </div>
                <p className="text-xs text-white/60">{player.stock.reason}</p>
                {player.stock.recentActivity && (player.stock.recentActivity.tradesIn > 0 || player.stock.recentActivity.tradesOut > 0) && (
                  <div className="flex gap-3 mt-2 text-[11px]">
                    {player.stock.recentActivity.tradesIn > 0 && (
                      <span className="text-green-400">+{player.stock.recentActivity.tradesIn} acquired (30d)</span>
                    )}
                    {player.stock.recentActivity.tradesOut > 0 && (
                      <span className="text-red-400">-{player.stock.recentActivity.tradesOut} traded (30d)</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {player.injuryStatus && player.injuryStatus !== 'Active' && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <span className="text-base">🏥</span>
                <div>
                  <span className="text-xs font-semibold text-red-300">{player.injuryStatus}</span>
                  {player.injuryBodyPart && (
                    <span className="text-xs text-white/40 ml-1.5">({player.injuryBodyPart})</span>
                  )}
                </div>
              </div>
            )}

            <PlayerCardAnalytics
              playerId={player.playerId}
              playerName={player.playerName}
              position={player.position}
              team={player.team}
              sport={sport}
              eager={false}
            />
          </div>
        )}

        {activeSection === 'leagues' && (
          <div className="space-y-2">
            {player.leagues.length === 0 ? (
              <p className="text-sm text-white/40 text-center py-4">You don't own this player in any leagues.</p>
            ) : (
              player.leagues.map((league, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{league.leagueName}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-white/40">{league.season}</span>
                      {league.leagueType && (
                        <span className="text-[11px] px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded">{league.leagueType}</span>
                      )}
                    </div>
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-1 rounded ${
                    league.rosterStatus === 'starter'
                      ? 'bg-green-500/20 text-green-300'
                      : league.rosterStatus === 'taxi'
                      ? 'bg-amber-500/20 text-amber-300'
                      : league.rosterStatus === 'ir'
                      ? 'bg-red-500/20 text-red-300'
                      : 'bg-white/10 text-white/50'
                  }`}>
                    {league.rosterStatus === 'starter' ? 'STARTER' :
                     league.rosterStatus === 'taxi' ? 'TAXI' :
                     league.rosterStatus === 'ir' ? 'IR' :
                     league.rosterStatus === 'bench' ? 'BENCH' : '—'}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
