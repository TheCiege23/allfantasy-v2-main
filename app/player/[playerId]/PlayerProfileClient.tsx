'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, MessageSquare, ArrowLeftRight, Eye } from 'lucide-react'
import { PlayerHeaderCard } from './components/PlayerHeaderCard'
import { OverviewTab } from './tabs/OverviewTab'
import { NewsTab } from './tabs/NewsTab'
import { OutlookTab } from './tabs/OutlookTab'
import { AnalyticsTab } from './tabs/AnalyticsTab'
import { GameLogTab } from './tabs/GameLogTab'
import { DepthChartTab } from './tabs/DepthChartTab'
import { MarketTab } from './tabs/MarketTab'

export type PlayerIdentity = {
  id: string
  name: string
  position: string
  team: string
  sport: string
  sleeperId: string | null
  status: string
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'news', label: 'News' },
  { id: 'outlook', label: 'Outlook' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'gamelog', label: 'Game Log' },
  { id: 'depth', label: 'Depth Chart' },
  { id: 'market', label: 'Market' },
] as const

type TabId = (typeof TABS)[number]['id']

export function PlayerProfileClient({ player }: { player: PlayerIdentity }) {
  const [tab, setTab] = useState<TabId>('overview')

  const headshotUrl = player.sleeperId
    ? `https://sleepercdn.com/content/nfl/players/thumb/${player.sleeperId}.jpg`
    : null

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#080c18] via-[#0a0e1a] to-[#0f0f1a]">
      {/* Top bar */}
      <div className="border-b border-white/[0.06] bg-[#080c18]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Link href="/core" className="text-white/40 hover:text-white/60">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="truncate text-sm font-semibold text-white/70">Player Profile</h1>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href={`/chimmy/chat?prompt=${encodeURIComponent(`Tell me about ${player.name}`)}`}
              className="flex items-center gap-1 rounded-lg bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-300 transition hover:bg-cyan-500/20"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Ask Chimmy
            </Link>
            <button
              type="button"
              className="flex items-center gap-1 rounded-lg border border-white/[0.1] px-2.5 py-1.5 text-[11px] font-semibold text-white/50 transition hover:text-white/70"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" /> Compare
            </button>
            <button
              type="button"
              className="flex items-center gap-1 rounded-lg border border-white/[0.1] px-2.5 py-1.5 text-[11px] font-semibold text-white/50 transition hover:text-white/70"
            >
              <Eye className="h-3.5 w-3.5" /> Watch
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6">
        {/* Header Card */}
        <PlayerHeaderCard player={player} headshotUrl={headshotUrl} />

        {/* Tab Navigation */}
        <div className="mt-6 flex gap-1 overflow-x-auto border-b border-white/[0.06] pb-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 border-b-2 px-3 pb-2.5 pt-1 text-[12px] font-semibold transition ${
                tab === t.id
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-white/40 hover:text-white/60'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="mt-5">
          {tab === 'overview' && <OverviewTab player={player} />}
          {tab === 'news' && <NewsTab player={player} />}
          {tab === 'outlook' && <OutlookTab player={player} />}
          {tab === 'analytics' && <AnalyticsTab player={player} />}
          {tab === 'gamelog' && <GameLogTab player={player} />}
          {tab === 'depth' && <DepthChartTab player={player} />}
          {tab === 'market' && <MarketTab player={player} />}
        </div>
      </div>
    </div>
  )
}
