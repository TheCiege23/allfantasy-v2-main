'use client'

/**
 * Two pieces of the old league header that imported leagues lost when they moved into the shared workspace
 * (2026-11-22), brought back with the same data, wording and test ids:
 *
 * - `IdpViewSwitch`: Offense / Defense / Full team for an IDP league. It only changes the Team tab's view, so
 *   LeagueShell shows it above that tab rather than on every screen.
 * - `DevyBucketCounts`: "N NFL · N Taxi · N Devy" for a devy league, in the workspace header.
 */

export type IdpViewMode = 'offense' | 'defense' | 'full'

const IDP_MODES: readonly IdpViewMode[] = ['offense', 'defense', 'full']

export function IdpViewSwitch({ value, onChange }: { value: IdpViewMode; onChange: (mode: IdpViewMode) => void }) {
  return (
    <div className="mb-3 flex max-w-md flex-wrap gap-1 rounded-lg border border-white/[0.08] bg-black/20 p-1" role="group" aria-label="IDP view" data-testid="idp-view-switch">
      {IDP_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={`min-h-[44px] flex-1 rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ${
            value === mode
              ? mode === 'offense'
                ? 'bg-idp-offense/25 text-blue-100'
                : mode === 'defense'
                  ? 'bg-idp-defense/25 text-red-100'
                  : 'bg-idp-combined/25 text-violet-100'
              : 'text-white/60 hover:bg-white/[0.04]'
          }`}
          data-testid={`idp-view-${mode}`}
        >
          {mode === 'full' ? 'Full team' : mode}
        </button>
      ))}
    </div>
  )
}

export function DevyBucketCounts({ stats }: { stats: { active: number; taxi: number; devy: number } }) {
  const parts: Array<[string, number, string]> = [
    ['NFL', stats.active, 'var(--devy-active)'],
    ['Taxi', stats.taxi, 'var(--devy-taxi)'],
    ['Devy', stats.devy, 'var(--devy-devy)'],
  ]
  return (
    <p className="nl-devy-counts" data-testid="devy-bucket-stats">
      {parts.map(([label, count, color], index) => (
        <span key={label}>
          {index > 0 ? <span className="nl-devy-sep" aria-hidden>·</span> : null}
          <span className="nl-devy-dot" style={{ background: color }} aria-hidden />
          {count} {label}
        </span>
      ))}
    </p>
  )
}
