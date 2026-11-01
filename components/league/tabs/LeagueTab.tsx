'use client'

import { useState } from 'react'
import Link from 'next/link'
import { BarChart3, Trophy } from 'lucide-react'
import StandingsRow from '@/components/league/StandingsRow'
import PlayoffBracket from '@/components/league/PlayoffBracket'
import ActivityFeed from '@/components/league/ActivityFeed'
import WeeklyStoryline from '@/components/league/WeeklyStoryline'
import HypeWeekPreview from '@/components/league/HypeWeekPreview'
import PowerRankings from '@/components/league/PowerRankings'
import LeagueScoringPreviews from '@/components/league/LeagueScoringPreviews'
import type {
  LeagueActivityItem,
  LeagueMatchupPreviewCardData,
  LeaguePlayoffBracketData,
  LeaguePowerRankingItem,
  LeagueStorylineCardData,
  LeagueTeamRow,
} from '@/components/league/types'

export default function LeagueTab({
  leagueId,
  season,
  currentWeek,
  standings,
  activity,
  bracket,
  storyline,
  matchupPreview,
  powerRankings,
  constitution,
}: {
  leagueId: string
  season?: number | null
  currentWeek?: number | null
  standings: LeagueTeamRow[]
  activity: LeagueActivityItem[]
  bracket: LeaguePlayoffBracketData
  storyline: LeagueStorylineCardData | null
  matchupPreview: LeagueMatchupPreviewCardData | null
  powerRankings: LeaguePowerRankingItem[]
  constitution: LeagueStorylineCardData | null
}) {
  const [mode, setMode] = useState<'standings' | 'playoff'>('standings')

  return (
    <div className="space-y-6">
      <LeagueScoringPreviews
        leagueId={leagueId}
        season={season ?? new Date().getFullYear()}
        week={currentWeek ?? 1}
      />
      <WeeklyStoryline item={constitution} />
      <Link href={`/league/${encodeURIComponent(leagueId)}/constitution`} className="inline-flex text-[13px] font-semibold text-[#00D4AA] underline">
        Open the league constitution →
      </Link>
      <Link href={`/league/${encodeURIComponent(leagueId)}/log`} className="inline-flex text-[13px] font-semibold text-[#00D4AA] underline">
        Open the league log →
      </Link>
      <WeeklyStoryline item={storyline} />
      <HypeWeekPreview item={matchupPreview} />
      <PowerRankings items={powerRankings} />

      <div className="flex items-center justify-between">
        <Link
          href={`/league/${leagueId}?tab=LEAGUE`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#00D4AA]/30 bg-[#0F3D35] px-4 py-2 text-[14px] font-semibold text-[#00D4AA]"
        >
          ✦ AI Power Rankings
        </Link>
        <div className="inline-flex overflow-hidden rounded-full border border-[#1E2A42] bg-[#131929]">
          <button
            type="button"
            onClick={() => setMode('standings')}
            className={`inline-flex min-h-[42px] items-center gap-2 px-4 text-[14px] font-semibold ${mode === 'standings' ? 'bg-white text-[#0B0F1E]' : 'text-white'}`}
          >
            <BarChart3 className="h-4 w-4" />
            STAND.
          </button>
          <button
            type="button"
            onClick={() => setMode('playoff')}
            className={`inline-flex min-h-[42px] items-center gap-2 px-4 text-[14px] font-semibold ${mode === 'playoff' ? 'bg-white text-[#0B0F1E]' : 'text-white'}`}
          >
            <Trophy className="h-4 w-4" />
            PLAYOFF
          </button>
        </div>
      </div>

      {mode === 'standings' ? (
        <section className="overflow-hidden rounded-2xl border border-[#1E2A42] bg-[#131929]">
          <div className="grid grid-cols-[24px_1fr_auto] gap-3 border-b border-white/5 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8B9DB8]">
            <div>Rank</div>
            <div>Name</div>
            <div className="text-right">Waiver / PF / PA</div>
          </div>
          {standings.map((row) => (
            <StandingsRow key={row.id} row={row} />
          ))}
        </section>
      ) : (
        <PlayoffBracket bracket={bracket} />
      )}

      <ActivityFeed items={activity} />
    </div>
  )
}
