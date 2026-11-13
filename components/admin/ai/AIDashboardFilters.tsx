'use client'

import { Filter } from 'lucide-react'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

/** Display labels for admin filters — keys must match `SUPPORTED_SPORTS`. */
const SPORT_OPTION_LABELS: Record<(typeof SUPPORTED_SPORTS)[number], string> = {
  NFL: 'NFL',
  NBA: 'NBA',
  NHL: 'NHL',
  MLB: 'MLB',
  NCAAF: 'NCAA Football',
  NCAAB: 'NCAA Basketball',
  SOCCER: 'Soccer',
}

export type DashboardFilterState = {
  dateFrom: string
  dateTo: string
  sport: string
  leagueType: string
  feature: string
  userSegment: string
  timeRange: '7d' | '30d' | 'all'
}

export function AIDashboardFilters({
  value,
  onChange,
}: {
  value: DashboardFilterState
  onChange: (next: DashboardFilterState) => void
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/90">
        <Filter className="h-4 w-4 text-violet-400" aria-hidden />
        Filters
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-white/45">
          From
          <input
            type="date"
            value={value.dateFrom}
            onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
            className="rounded-lg border border-white/10 bg-[#0c0c12] px-2 py-1.5 text-sm text-white"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-white/45">
          To
          <input
            type="date"
            value={value.dateTo}
            onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
            className="rounded-lg border border-white/10 bg-[#0c0c12] px-2 py-1.5 text-sm text-white"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-white/45">
          Sport
          <select
            value={value.sport}
            onChange={(e) => onChange({ ...value, sport: e.target.value })}
            className="rounded-lg border border-white/10 bg-[#0c0c12] px-2 py-1.5 text-sm text-white"
          >
            <option value="all">All</option>
            {SUPPORTED_SPORTS.map((sport) => (
              <option key={sport} value={sport}>
                {SPORT_OPTION_LABELS[sport]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-white/45">
          League type
          <select
            value={value.leagueType}
            onChange={(e) => onChange({ ...value, leagueType: e.target.value })}
            className="rounded-lg border border-white/10 bg-[#0c0c12] px-2 py-1.5 text-sm text-white"
          >
            <option value="all">All</option>
            <option value="dynasty">Dynasty</option>
            <option value="redraft">Redraft</option>
            <option value="keeper">Keeper</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-white/45">
          AI feature
          <select
            value={value.feature}
            onChange={(e) => onChange({ ...value, feature: e.target.value })}
            className="rounded-lg border border-white/10 bg-[#0c0c12] px-2 py-1.5 text-sm text-white"
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="trade">Trade</option>
            <option value="waiver">Waiver</option>
            <option value="coaching">Coaching</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-white/45">
          User trust
          <select
            value={value.userSegment}
            onChange={(e) => onChange({ ...value, userSegment: e.target.value })}
            className="rounded-lg border border-white/10 bg-[#0c0c12] px-2 py-1.5 text-sm text-white"
          >
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-white/45">
          Series window
          <select
            value={value.timeRange}
            onChange={(e) => onChange({ ...value, timeRange: e.target.value as DashboardFilterState['timeRange'] })}
            className="rounded-lg border border-white/10 bg-[#0c0c12] px-2 py-1.5 text-sm text-white"
          >
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="all">Full range</option>
          </select>
        </label>
      </div>
    </div>
  )
}
