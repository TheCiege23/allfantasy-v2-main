'use client'

/**
 * "My games" / "All games" scope toggle.
 *
 * ⚠ "MY GAMES" MEANS A PLAYER YOU ACTUALLY ROSTER — NOTHING ELSE. Build rule 1
 * of the handoff: never a recommended, popular or otherwise editorialised game.
 * The filtering happens server-side in `getLivePageData`; this control only
 * chooses which of the two honest sets is shown.
 */

export function ScopeToggle({
  scope,
  onChange,
}: {
  scope: 'my' | 'all'
  onChange: (scope: 'my' | 'all') => void
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full p-1"
      style={{ background: 'var(--live-chip)', border: '1px solid var(--live-line2)' }}
      role="group"
      aria-label="Which games to show"
    >
      {(['my', 'all'] as const).map((value) => {
        const isActive = scope === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            aria-pressed={isActive}
            className="live-display rounded-full px-4 py-1.5 text-[13px] font-bold transition-colors"
            style={{
              background: isActive ? 'var(--live-accent)' : 'transparent',
              color: isActive ? '#04222b' : 'var(--muted)',
            }}
          >
            {value === 'my' ? 'My games' : 'All games'}
          </button>
        )
      })}
    </div>
  )
}
