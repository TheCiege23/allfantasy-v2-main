'use client'

import { useCallback, useMemo, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ArrowRightLeft,
  BarChart3,
  Search,
  TrendingUp,
  UserPlus,
} from 'lucide-react'
import { LeagueTradePanel } from '@/components/league-trade'
import PlayerHeadshot from '@/components/league/PlayerHeadshot'
import { ActiveTradeCard, TradeBlockCarousel } from '@/components/league/TradeCard'
import { DEVY_NO_TREND_LABEL } from '@/lib/devy/devyTrend'
import type {
  LeaguePlayersData,
  LeaguePlayersSubtab,
  LeagueTradesData,
  ResolvedLeaguePlayer,
} from '@/components/league/types'

const SUBTABS: Array<{
  id: LeaguePlayersSubtab
  label: string
  icon: ComponentType<{ className?: string }>
}> = [
  { id: 'search', label: 'Search', icon: Search },
  { id: 'trend', label: 'Trend', icon: TrendingUp },
  { id: 'available', label: 'Available', icon: UserPlus },
  { id: 'leaders', label: 'Leaders', icon: BarChart3 },
  { id: 'trade', label: 'Trade', icon: ArrowRightLeft },
]

const POSITION_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB']

function filterByPosition(players: ResolvedLeaguePlayer[], position: string) {
  if (position === 'ALL') return players
  return players.filter((player) => player.position.toUpperCase().includes(position))
}

function gradeWeight(grade: string | null | undefined) {
  const normalized = String(grade ?? '').toUpperCase()
  if (normalized === 'A') return 5
  if (normalized === 'B') return 4
  if (normalized === 'C') return 3
  if (normalized === 'D') return 2
  if (normalized === 'F') return 1
  return 0
}

function sortPlayers(players: ResolvedLeaguePlayer[], sortBy: 'adp' | 'draft_grade' | 'draft_year' | 'points') {
  return [...players].sort((left, right) => {
    if (sortBy === 'draft_grade') return gradeWeight(right.draftGrade) - gradeWeight(left.draftGrade)
    if (sortBy === 'draft_year') return (left.draftYear ?? 9999) - (right.draftYear ?? 9999)
    if (sortBy === 'points') return (right.score ?? 0) - (left.score ?? 0)
    return (left.adp ?? Number.MAX_SAFE_INTEGER) - (right.adp ?? Number.MAX_SAFE_INTEGER)
  })
}

function PlayerListCard({
  player,
  showStats = false,
  showTrend = false,
}: {
  player: ResolvedLeaguePlayer
  showStats?: boolean
  showTrend?: boolean
}) {
  return (
    <div className="rounded-2xl border border-[#1E2A42] bg-[#131929] px-4 py-3">
      <div className="flex items-center gap-3">
        <PlayerHeadshot src={player.headshotUrl} alt={player.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[18px] font-semibold text-white">{player.name}</div>
          <div className="truncate text-[13px] text-[#8B9DB8]">
            {player.position}
            {player.team ? ` • ${player.team}` : ''}
            {player.ownerLabel ? ` → ${player.ownerLabel}` : ''}
            {player.classYearLabel ? ` • ${player.classYearLabel}` : ''}
            {player.draftGrade ? ` • Grade ${player.draftGrade}` : ''}
          </div>
          {player.badges?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {player.badges.map((badge) => (
                <span
                  key={`${player.id}-${badge}`}
                  className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/70"
                >
                  {badge}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {player.adp != null ? (
          <div className="rounded-xl bg-[#1C2539] px-3 py-2 text-right">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B9DB8]">ADP</div>
            <div className="text-[15px] font-semibold text-white">{Math.round(player.adp)}</div>
          </div>
        ) : null}
      </div>

      {showTrend && player.trendValue != null ? (
        <div className="mt-3 flex items-center gap-3">
          <div className="text-[22px] font-semibold text-[#00D4AA]">
            {player.trendValue > 0 ? '+' : ''}
            {player.trendValue.toFixed(1)}
          </div>
          <div className="h-1.5 flex-1 rounded-full bg-[#1C2539]">
            <div className="h-1.5 rounded-full bg-[#00D4AA]" style={{ width: `${Math.min(100, Math.max(18, Math.abs(player.trendValue) * 6))}%` }} />
          </div>
        </div>
      ) : null}

      {showStats ? (
        <div className="mt-3 grid grid-cols-5 gap-x-3 gap-y-2 border-t border-white/5 pt-3">
          {player.stats.map((stat) => (
            <div key={`${player.id}-${stat.label}`}>
              <div className="text-[11px] uppercase tracking-[0.16em] text-[#8B9DB8]">{stat.label}</div>
              <div className="text-[14px] font-semibold text-white">{stat.value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function PlayersTab({
  leagueId,
  players,
  trades,
}: {
  leagueId: string
  players: LeaguePlayersData
  trades: LeagueTradesData
}) {
  const searchParams = useSearchParams()
  const initialSubtab = (searchParams?.get('playersTab') ?? 'search').toLowerCase() as LeaguePlayersSubtab
  const [subtab, setSubtab] = useState<LeaguePlayersSubtab>(
    ['search', 'trend', 'available', 'leaders', 'trade'].includes(initialSubtab) ? initialSubtab : 'search'
  )
  const [position, setPosition] = useState('ALL')
  const [query, setQuery] = useState('')
  const [playerUniverse, setPlayerUniverse] = useState<'PRO_PLAYERS' | 'COLLEGE_PLAYERS' | 'ALL'>('ALL')
  const [sortBy, setSortBy] = useState<'adp' | 'draft_grade' | 'draft_year' | 'points'>('adp')

  const positionFilters = useMemo(() => {
    const collegePositions = players.college?.availablePositions ?? []
    return ['ALL', ...Array.from(new Set([...POSITION_FILTERS.slice(1), ...collegePositions.map((entry) => entry.toUpperCase())]))]
  }, [players.college?.availablePositions])

  const mergeUniverse = useCallback(
    (pro: ResolvedLeaguePlayer[], college: ResolvedLeaguePlayer[]) => {
      if (playerUniverse === 'PRO_PLAYERS') return pro
      if (playerUniverse === 'COLLEGE_PLAYERS') return college
      return [...pro, ...college]
    },
    [playerUniverse]
  )

  /*
   * Pro players only. No college trend is measured (`lib/devy/devyTrend.ts`); the college list that
   * used to be merged here ranked `DevyPlayer.stockTrendDelta`, a LEVEL, and drew it as "+N.N" —
   * so every prospect read as rising. The Trend tab says so instead (`college-trend-unmeasured`).
   */
  const filteredTrend = useMemo(
    () => sortPlayers(filterByPosition(mergeUniverse(players.trend, []), position), sortBy),
    [mergeUniverse, players.trend, position, sortBy]
  )
  const filteredAvailable = useMemo(
    () => sortPlayers(filterByPosition(mergeUniverse(players.available, players.college?.available ?? []), position), sortBy),
    [mergeUniverse, players.available, players.college?.available, position, sortBy]
  )
  const filteredLeaders = useMemo(
    () => sortPlayers(filterByPosition(mergeUniverse(players.leaders, players.college?.leaders ?? []), position), sortBy),
    [mergeUniverse, players.leaders, players.college?.leaders, position, sortBy]
  )
  const filteredSearch = useMemo(() => {
    const lower = query.trim().toLowerCase()
    if (!lower) return players.search
    return players.search.filter((team) => team.name.toLowerCase().includes(lower) || (team.teamCode ?? '').toLowerCase().includes(lower))
  }, [players.search, query])

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-5 gap-2 rounded-2xl bg-[#131929] p-3">
        {SUBTABS.map((item) => {
          const Icon = item.icon
          const isActive = subtab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSubtab(item.id)}
              className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl"
            >
              <Icon className={`h-5 w-5 ${isActive ? 'text-[#00D4AA]' : 'text-[#8B9DB8]'}`} />
              <span className={`text-[13px] font-medium ${isActive ? 'text-[#00D4AA]' : 'text-[#8B9DB8]'}`}>{item.label}</span>
            </button>
          )
        })}
      </div>

      {subtab === 'search' ? (
        <>
          <div className="rounded-2xl bg-[#131929] p-3">
            <div className="flex items-center gap-3 rounded-full bg-[#1C2539] px-4 py-3">
              <Search className="h-4.5 w-4.5 text-[#8B9DB8]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search..."
                className="w-full bg-transparent text-[16px] text-white outline-none placeholder:text-[#8B9DB8]"
              />
              <button type="button" onClick={() => setQuery('')} className="text-[13px] font-semibold text-[#00D4AA]">
                Cancel
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {filteredSearch.map((team) => (
              <div key={team.id} className="flex items-center gap-3 rounded-2xl border border-[#1E2A42] bg-[#131929] px-4 py-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#FFB800] text-[12px] font-semibold text-[#FFB800]">
                  W
                </div>
                <PlayerHeadshot src={team.logoUrl} alt={team.name} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[18px] font-semibold text-white">{team.name}</div>
                  <div className="text-[13px] text-[#8B9DB8]">DEF • {team.teamCode ?? '--'}</div>
                </div>
                <div className="text-[12px] font-semibold text-[#8B9DB8]">{team.watchLabel}</div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {subtab !== 'trade' && subtab !== 'search' ? (
        <>
          {players.college ? (
            <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
              {[
                ['PRO_PLAYERS', 'PRO PLAYERS'],
                ['COLLEGE_PLAYERS', 'COLLEGE PLAYERS'],
                ['ALL', 'ALL'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPlayerUniverse(value as 'PRO_PLAYERS' | 'COLLEGE_PLAYERS' | 'ALL')}
                  className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${
                    playerUniverse === value
                      ? 'border-violet-300 bg-violet-500/10 text-violet-100'
                      : 'border-transparent bg-[#131929] text-[#8B9DB8]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
            {positionFilters.map((pill) => (
              <button
                key={pill}
                type="button"
                onClick={() => setPosition(pill)}
                className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${
                  position === pill
                    ? 'border-[#00D4AA] bg-[#0F3D35] text-[#00D4AA]'
                    : 'border-transparent bg-[#131929] text-[#8B9DB8]'
                }`}
              >
                {pill}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-[#131929] px-4 py-3">
            <div className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#8B9DB8]">Sort</div>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as 'adp' | 'draft_grade' | 'draft_year' | 'points')}
              className="rounded-lg border border-white/10 bg-[#1C2539] px-3 py-2 text-sm text-white outline-none"
            >
              <option value="adp">ADP</option>
              <option value="draft_grade">Draft Grade</option>
              <option value="draft_year">Draft Year</option>
              <option value="points">C2C Points</option>
            </select>
          </div>

          {subtab === 'trend' ? (
            <div className="space-y-3">
              {players.college && playerUniverse !== 'PRO_PLAYERS' ? (
                <div
                  data-testid="college-trend-unmeasured"
                  className="rounded-2xl border border-[#1E2A42] bg-[#131929] p-4 text-[14px] text-[#8B9DB8]"
                >
                  College prospects — {DEVY_NO_TREND_LABEL}. See Available and Leaders for them.
                </div>
              ) : null}
              {filteredTrend.map((player) => (
                <PlayerListCard key={player.id} player={player} showTrend />
              ))}
            </div>
          ) : null}

          {subtab === 'available' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[26px] font-semibold text-white">Available</div>
                <div className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#00D4AA]">Season ADP</div>
              </div>
              <Link
                href={`/waiver-ai?leagueId=${leagueId}`}
                className="flex min-h-[48px] items-center justify-between rounded-2xl border border-[#00D4AA]/30 bg-[#0F3D35] px-4 py-3 text-[15px] font-semibold text-[#00D4AA]"
              >
                <span>✦ Get AI waiver picks</span>
                <ArrowRightLeft className="h-4 w-4" />
              </Link>
              <div className="space-y-3">
                {filteredAvailable.map((player) => (
                  <PlayerListCard key={player.id} player={player} showStats />
                ))}
              </div>
            </div>
          ) : null}

          {subtab === 'leaders' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[26px] font-semibold text-white">Leaders</div>
                <div className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#00D4AA]">Season ADP</div>
              </div>
              <div className="space-y-3">
                {filteredLeaders.map((player) => (
                  <PlayerListCard key={player.id} player={player} showStats />
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {subtab === 'trade' ? (
        <div className="space-y-6">
          <LeagueTradePanel leagueId={leagueId} />
          <div className="flex items-center justify-between">
            <h2 className="text-[26px] font-semibold text-white">Trade Block</h2>
            <Link
              href={`/league/${leagueId}?tab=PLAYERS&playersTab=trade`}
              className="rounded-full border border-[#00D4AA] px-4 py-2 text-[14px] font-semibold text-[#00D4AA]"
            >
              TRADE
            </Link>
          </div>
          <TradeBlockCarousel items={trades.tradeBlock} />

          <section className="space-y-3">
            <h2 className="text-[26px] font-semibold text-white">Active Trades</h2>
            {trades.activeTrades.length === 0 ? (
              <div className="rounded-2xl border border-[#1E2A42] bg-[#131929] p-4 text-[14px] text-[#8B9DB8]">
                No active trades right now.
              </div>
            ) : (
              trades.activeTrades.map((trade) => (
                <div key={trade.id} className="space-y-2">
                  <ActiveTradeCard trade={trade} />
                  <Link
                    href={`/trade-evaluator?leagueId=${leagueId}`}
                    className="inline-flex text-[13px] font-semibold text-[#00D4AA]"
                  >
                    ✦ Analyze with AI
                  </Link>
                </div>
              ))
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-[26px] font-semibold text-white">Trade History</h2>
            {trades.history.length === 0 ? (
              <div className="rounded-2xl border border-[#1E2A42] bg-[#131929] p-4 text-[14px] text-[#8B9DB8]">
                No trade history yet.
              </div>
            ) : (
              trades.history.map((trade) => <ActiveTradeCard key={trade.id} trade={trade} />)
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
