'use client'

/**
 * Sport tabs for `/live`, one pill per sport with its live-game count.
 *
 * ⚠ ZERO-COUNT SPORTS STAY VISIBLE AND CLICKABLE. Build rule 6 of the handoff,
 * consistent with 14a/14b: never hide a category, just show that it is empty.
 * Hiding NHL on a Tuesday would leave a user unable to tell "no games" apart
 * from "this app does not do hockey".
 */

type SportCount = { sport: string; label: string; liveCount: number }

export function SportTabs({
  counts,
  active,
  onSelect,
}: {
  counts: SportCount[]
  active: string
  onSelect: (sport: string) => void
}) {
  return (
    <div
      className="live-scroll-x flex items-center gap-2 py-3"
      role="tablist"
      aria-label="Sport"
    >
      {counts.map((c) => {
        const isActive = c.sport === active
        const isEmpty = c.liveCount === 0
        return (
          <button
            key={c.sport}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(c.sport)}
            className="live-display flex flex-none items-center gap-2 rounded-full px-4 py-2 text-[13px] font-extrabold transition-colors"
            style={{
              background: isActive ? 'var(--live-accent)' : 'var(--live-chip)',
              // The active pill is a light cyan fill, so its label has to be dark
              // to stay legible — not --text, which is near-white in dark mode.
              color: isActive ? '#04222b' : isEmpty ? 'var(--faint)' : 'var(--text)',
              border: `1px solid ${isActive ? 'transparent' : 'var(--live-line2)'}`,
            }}
          >
            <span>{c.label}</span>
            <span
              className="live-mono text-[12px] font-bold"
              style={{ color: isActive ? '#04222b' : isEmpty ? 'var(--faint)' : 'var(--muted)' }}
              // The count is decorative next to the label for sighted users, but
              // a screen reader needs it spelled out.
              aria-label={`${c.liveCount} live`}
            >
              {c.liveCount}
            </span>
          </button>
        )
      })}
    </div>
  )
}
