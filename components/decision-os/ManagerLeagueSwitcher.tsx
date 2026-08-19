'use client'
/**
 * Fantasy OS Suite — Phase OS-C1: Manager Operating System Foundation.
 *
 * The manager-facing mirror of `CommissionerLeagueSwitcher.tsx`. Deliberately navigates via a real
 * `<Link>` to the existing `/league/[leagueId]` team-focused experience, rather than the
 * in-page `onSelect` state toggle Commissioner Hub uses — that pattern exists there because
 * Commissioner Hub keeps League Focus on the SAME page; Manager OS's team-focused experience already
 * has its own real, established route, so a real navigation is the lower-risk choice (this component
 * touches zero existing single-league code).
 */
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { DecisionOsPanel } from './DecisionOsCardPrimitives'

type ManagerLeagueSwitcherProps = {
  leagues: { id: string; name: string }[]
}

export default function ManagerLeagueSwitcher({ leagues }: ManagerLeagueSwitcherProps) {
  return (
    <DecisionOsPanel title={leagues.length > 0 ? `Switch to a league (${leagues.length})` : 'Switch to a league'}>
      {leagues.length === 0 ? (
        <p className="mt-2 text-xs leading-5 text-muted" data-testid="manager-league-switcher-empty">
          You don&apos;t belong to any leagues yet.
        </p>
      ) : (
        <div className="mt-2 grid gap-1.5" data-testid="manager-league-switcher-list">
          {leagues.map((league) => (
            <Link
              key={league.id}
              href={`/league/${league.id}`}
              data-testid={`manager-league-switcher-item-${league.id}`}
              className="focus-ring flex items-center justify-between gap-2 rounded-lg border border-subtle bg-surface px-3 py-2 text-left text-sm font-semibold text-primary transition hover:border-brand-primary/40 hover:bg-surface-muted"
            >
              <span className="truncate">{league.name}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </DecisionOsPanel>
  )
}
