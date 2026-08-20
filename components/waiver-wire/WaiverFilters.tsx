"use client"

import { Filter, Search } from "lucide-react"
import { getPositionFiltersForSport } from "@/lib/waiver-wire/SportWaiverResolver"
import { WAIVER_STATUS_FILTERS, SORT_OPTIONS } from "@/lib/waiver-wire/WaiverFilterResolver"

type Props = {
  search: string
  onSearchChange: (value: string) => void
  position: string
  onPositionChange: (value: string) => void
  team: string
  onTeamChange: (value: string) => void
  status: string
  onStatusChange: (value: string) => void
  sort: string
  onSortChange: (value: string) => void
  onResetFilters?: () => void
  teams?: string[]
  /** Sport for position filters (e.g. NFL, NBA). When set, position options are sport-specific. */
  sport?: string | null
  /** When 'IDP' for NFL, position options include Offense, DL, LB, DB, DE, DT, CB, S, IDP FLEX. */
  formatType?: string | null
}

export default function WaiverFilters({
  search,
  onSearchChange,
  position,
  onPositionChange,
  team,
  onTeamChange,
  status,
  onStatusChange,
  sort,
  onSortChange,
  onResetFilters,
  teams = [],
  sport,
  formatType,
}: Props) {
  const positionFilters = getPositionFiltersForSport(sport ?? undefined, formatType)
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-white/10 bg-black/70 px-4 pb-2 pt-2 backdrop-blur sm:-mx-0 sm:rounded-xl sm:border sm:bg-black/60 sm:px-3 sm:pt-3">
      <div className="flex items-center gap-2 text-xs text-white/60">
        <Filter className="h-3.5 w-3.5" />
        <span>Filters</span>
      </div>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search players…"
            aria-label="Waiver player search"
            data-testid="waiver-search-input"
            className="w-full rounded-full border border-white/15 bg-black/40 py-1.5 pl-7 pr-3 text-xs text-white placeholder:text-white/40 outline-none"
          />
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-1.5 text-[11px]">
          <div className="flex flex-wrap gap-1.5">
            {positionFilters.map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => onPositionChange(pos)}
                data-testid={`waiver-position-filter-${pos}`}
                className={`rounded-full border px-2.5 py-1 ${
                  position === pos ? "border-[#ff3d81] bg-[#ff3d81]/20 text-[#ffd7e5]" : "border-white/15 bg-black/40 text-white/65"
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
          {teams.length > 0 && (
            <select
              value={team}
              onChange={(e) => onTeamChange(e.target.value)}
              aria-label="Waiver team filter"
              data-testid="waiver-team-filter"
              className="ml-auto rounded-full border border-white/20 bg-black/40 px-2 py-1 text-[11px] text-white outline-none"
            >
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          {WAIVER_STATUS_FILTERS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onStatusChange(s.value)}
              data-testid={`waiver-status-filter-${s.value}`}
              className={`rounded-full px-2 py-0.5 ${
                status === s.value ? "bg-white text-black" : "bg-black/40 text-white/65"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-white/50">Sort</span>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value)}
            aria-label="Waiver sort order"
            data-testid="waiver-sort-order"
            className="rounded-lg border border-white/15 bg-black/60 px-2 py-1 text-[11px] text-white outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {onResetFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              data-testid="waiver-reset-filters"
              className="rounded-lg border border-white/20 bg-black/40 px-2 py-1 text-[11px] text-white/70 hover:text-white"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

