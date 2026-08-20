'use client'

import type { ActivityFeedItemType } from '@/lib/activity/types'

/**
 * 10c filter chips.
 *
 * ⚠ TWO OF THE HANDOFF'S CHIPS HAVE NO SOURCE, AND ARE SHOWN DISABLED RATHER THAN EMPTY.
 * The aggregator behind this feed emits trade / waiver / lineup / message / announcement / injury
 * / standings. There is no draft event and no matchup-result event. A "Draft" chip that filtered
 * to zero rows would read as "no draft activity in this league" when the truth is that we never
 * collect it — a filter that lies about the data is worse than one that admits it is not wired.
 * Same treatment the import screen gives unreleased providers.
 */

export type FeedFilterId = 'all' | 'draft' | 'waivers' | 'trades' | 'lineups' | 'matchups' | 'commish'

export const FEED_FILTERS: {
  id: FeedFilterId
  label: string
  /** Item types this chip keeps. Empty = no source exists yet. */
  types: ActivityFeedItemType[]
  unavailableReason?: string
}[] = [
  { id: 'all', label: 'All', types: [] },
  {
    id: 'draft',
    label: 'Draft',
    types: [],
    unavailableReason: 'Draft picks are not collected into the activity feed yet.',
  },
  { id: 'waivers', label: 'Waivers', types: ['waiver'] },
  { id: 'trades', label: 'Trades', types: ['trade'] },
  { id: 'lineups', label: 'Lineups', types: ['lineup'] },
  {
    id: 'matchups',
    label: 'Matchups',
    types: [],
    unavailableReason: 'Matchup results are not collected into the activity feed yet.',
  },
  // Build rule 3: Commish is its own category, never folded into Trades or a catch-all.
  { id: 'commish', label: 'Commish', types: ['announcement'] },
]

export default function FeedFilterChips({
  active,
  onChange,
}: {
  active: FeedFilterId
  onChange: (id: FeedFilterId) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter feed">
      {FEED_FILTERS.map((f) => {
        const disabled = f.id !== 'all' && f.types.length === 0
        return (
          <button
            key={f.id}
            type="button"
            disabled={disabled}
            title={f.unavailableReason}
            aria-pressed={active === f.id}
            onClick={() => !disabled && onChange(f.id)}
            data-testid={`feed-filter-${f.id}`}
            className={`rounded-full px-3 py-1.5 text-sm font-bold transition ${
              active === f.id
                ? 'bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-400/40'
                : disabled
                  ? 'cursor-not-allowed text-white/25'
                  : 'bg-white/[0.04] text-white/70 hover:text-white'
            }`}
          >
            {f.label}
            {disabled ? (
              <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/25">
                soon
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
