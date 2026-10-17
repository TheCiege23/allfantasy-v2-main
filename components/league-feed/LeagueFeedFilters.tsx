'use client'

export type LeagueFeedFilterId =
  | 'all'
  | 'draft'
  | 'waivers'
  | 'trades'
  | 'lineups'
  | 'matchups'
  | 'commissioner'
  | 'ai'

const FILTERS: { id: LeagueFeedFilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'waivers', label: 'Waivers' },
  { id: 'trades', label: 'Trades' },
  { id: 'lineups', label: 'Lineups' },
  { id: 'matchups', label: 'Matchups' },
  { id: 'commissioner', label: 'Commish' },
  { id: 'ai', label: 'AI' },
]

export function LeagueFeedFilters({
  active,
  onChange,
  disabled,
}: {
  active: LeagueFeedFilterId
  onChange: (id: LeagueFeedFilterId) => void
  disabled?: boolean
}) {
  return (
    <div
      className="flex gap-1 overflow-x-auto pb-1 pt-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Filter league feed"
    >
      {FILTERS.map((f) => {
        const isOn = active === f.id
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={isOn}
            disabled={disabled}
            onClick={() => onChange(f.id)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              isOn
                ? 'bg-white/14 text-white shadow-sm ring-1 ring-white/20'
                : 'bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white/80'
            } ${disabled ? 'opacity-50' : ''}`}
          >
            {f.label}
          </button>
        )
      })}
    </div>
  )
}

export function feedItemMatchesFilter(
  filter: LeagueFeedFilterId,
  row: {
    type: string
    category?: string | null
    actorType?: string | null
    source?: string | null
  },
): boolean {
  if (filter === 'all') return true

  const cat = (row.category ?? '').toLowerCase()
  const actor = (row.actorType ?? '').toLowerCase()
  const typ = row.type.toLowerCase()

  if (filter === 'ai') {
    return actor === 'ai' || cat === 'ai'
  }

  if (filter === 'draft') {
    return (
      cat === 'draft' ||
      typ.includes('draft') ||
      typ.includes('pick') ||
      typ.includes('auto_pick')
    )
  }
  if (filter === 'waivers') {
    return cat === 'waivers' || typ.includes('waiver') || typ.includes('claim') || typ.includes('drop')
  }
  if (filter === 'trades') {
    return cat === 'trades' || typ.includes('trade')
  }
  if (filter === 'lineups') {
    return cat === 'lineups' || typ.includes('lineup') || typ.includes('player_moved')
  }
  if (filter === 'matchups') {
    return cat === 'matchups' || typ.includes('matchup') || typ.includes('playoff') || typ.includes('eliminated')
  }
  if (filter === 'commissioner') {
    return (
      cat === 'commissioner' ||
      actor === 'commissioner' ||
      typ.includes('commissioner') ||
      typ.includes('broadcast')
    )
  }

  return true
}
