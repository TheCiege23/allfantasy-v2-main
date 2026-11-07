"use client"

import { getDiscoverySports } from "@/lib/public-discovery/discovery-sports"
import type {
  DiscoveryFormat,
  DiscoverySort,
  EntryFeeFilter,
  LeagueStyleFilter,
} from "@/lib/public-discovery/types"

export interface DiscoveryFiltersProps {
  sport: string
  format: DiscoveryFormat
  style: LeagueStyleFilter
  sort: DiscoverySort
  entryFee: EntryFeeFilter
  onSportChange: (value: string) => void
  onFormatChange: (value: DiscoveryFormat) => void
  onStyleChange: (value: LeagueStyleFilter) => void
  onSortChange: (value: DiscoverySort) => void
  onEntryFeeChange: (value: EntryFeeFilter) => void
}

const FORMAT_OPTIONS: Array<{ value: DiscoveryFormat; label: string }> = [
  { value: "all", label: "All leagues" },
  { value: "fantasy", label: "Public leagues" },
  { value: "creator", label: "Creator leagues" },
  { value: "bracket", label: "Brackets" },
]

const STYLE_OPTIONS: Array<{ value: LeagueStyleFilter; label: string }> = [
  { value: "all", label: "Any style" },
  { value: "dynasty", label: "Dynasty" },
  { value: "redraft", label: "Redraft" },
  { value: "best_ball", label: "Best ball" },
  { value: "keeper", label: "Keeper" },
  { value: "survivor", label: "Survivor" },
  { value: "guillotine", label: "Guilly" },
  { value: "bracket", label: "Bracket" },
  { value: "community", label: "Community" },
]

const ENTRY_FEE_OPTIONS: Array<{ value: EntryFeeFilter; label: string }> = [
  { value: "all", label: "Any price" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
]

const SORT_OPTIONS: Array<{ value: DiscoverySort; label: string }> = [
  { value: "popularity", label: "Popularity" },
  { value: "newest", label: "Newest" },
  { value: "filling_fast", label: "Filling fast" },
]

function FilterChip({
  active,
  label,
  testId,
  onClick,
}: {
  active: boolean
  label: string
  testId: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className="rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors"
      style={{
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: active ? "var(--accent)" : "var(--panel)",
        color: active ? "var(--bg)" : "var(--text)",
      }}
    >
      {label}
    </button>
  )
}

export function DiscoveryFilters({
  sport,
  format,
  style,
  sort,
  entryFee,
  onSportChange,
  onFormatChange,
  onStyleChange,
  onSortChange,
  onEntryFeeChange,
}: DiscoveryFiltersProps) {
  const sports = getDiscoverySports()

  return (
    <section className="w-full space-y-3" data-testid="discovery-filters-panel">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>
          Sport
        </label>
        <select
          value={sport}
          onChange={(event) => onSportChange(event.target.value)}
          data-testid="discovery-sport-select"
          className="min-h-[44px] rounded-xl border px-3 py-2.5 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          aria-label="Filter leagues by sport"
        >
          <option value="">All sports</option>
          {sports.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>
          Type
        </p>
        <div className="flex flex-wrap gap-2" data-testid="discovery-format-group">
          {FORMAT_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              active={format === option.value}
              label={option.label}
              testId={`discovery-format-${option.value}`}
              onClick={() => onFormatChange(option.value)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>
          Style
        </p>
        <div className="flex flex-wrap gap-2" data-testid="discovery-style-group">
          {STYLE_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              active={style === option.value}
              label={option.label}
              testId={`discovery-style-${option.value}`}
              onClick={() => onStyleChange(option.value)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>
          Price
        </p>
        <div className="flex flex-wrap gap-2" data-testid="discovery-price-group">
          {ENTRY_FEE_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              active={entryFee === option.value}
              label={option.label}
              testId={`discovery-entry-fee-${option.value}`}
              onClick={() => onEntryFeeChange(option.value)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>
          Sort
        </p>
        <div className="flex flex-wrap gap-2" data-testid="discovery-sort-group">
          {SORT_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              active={sort === option.value}
              label={option.label}
              testId={`discovery-sort-${option.value}`}
              onClick={() => onSortChange(option.value)}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
