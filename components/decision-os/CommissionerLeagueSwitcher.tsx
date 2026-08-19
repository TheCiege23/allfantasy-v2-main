'use client'
/**
 * Fantasy OS Suite — Phase OS-B1: Commissioner Multi-League Command Center.
 *
 * Selecting a league transitions the page into the existing League Focus experience — this
 * component itself does no navigation/fetching; it just reports which league id was picked via
 * `onSelect`. The caller (`CommissionerHubPageClient`) owns the actual view-switch.
 */
import { ChevronRight } from 'lucide-react'
import { DecisionOsPanel } from './DecisionOsCardPrimitives'

type CommissionerLeagueSwitcherProps = {
  leagues: { id: string; name: string }[]
  onSelect: (leagueId: string) => void
}

export default function CommissionerLeagueSwitcher({ leagues, onSelect }: CommissionerLeagueSwitcherProps) {
  return (
    <DecisionOsPanel title={leagues.length > 0 ? `Switch to a league (${leagues.length})` : 'Switch to a league'}>
      {leagues.length === 0 ? (
        <p className="mt-2 text-xs leading-5 text-muted" data-testid="league-switcher-empty">
          You don&apos;t commission any leagues yet.
        </p>
      ) : (
        <div className="mt-2 grid gap-1.5" data-testid="league-switcher-list">
          {leagues.map((league) => (
            <button
              key={league.id}
              type="button"
              onClick={() => onSelect(league.id)}
              data-testid={`league-switcher-item-${league.id}`}
              className="focus-ring flex items-center justify-between gap-2 rounded-lg border border-subtle bg-surface px-3 py-2 text-left text-sm font-semibold text-primary transition hover:border-brand-primary/40 hover:bg-surface-muted"
            >
              <span className="truncate">{league.name}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </DecisionOsPanel>
  )
}
