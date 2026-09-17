import Link from 'next/link'
import type { HubFormat } from '@/lib/core-app/formatHubs'

/**
 * The pill row above every commissioner hub: "All leagues" first, then the six
 * format hubs (five-doors restyle, call 3 — one switcher).
 *
 * No hooks and no directive, so the server-rendered one-league screen, the
 * all-leagues screen and the client-rendered format hubs all draw the same row.
 */

export const HUB_TABS: Record<HubFormat, string> = {
  zombie: 'Zombie',
  tournament: 'Tournament',
  survivor: 'Survivor',
  c2c: 'C2C',
  guillotine: 'Guillotine',
  efl: 'EFL Dynasty',
}

const ORDER: HubFormat[] = ['zombie', 'tournament', 'survivor', 'c2c', 'guillotine', 'efl']

export function HubSwitcher({
  current,
  counts,
  runCount = null,
}: {
  current: HubFormat | 'all'
  /** Leagues of each format the reader is in. */
  counts: Record<HubFormat, number>
  /** Leagues the reader runs, for the "All leagues" pill. Null leaves the count off. */
  runCount?: number | null
}) {
  return (
    <nav className="afh-switch" aria-label="Commissioner hubs">
      <Link href="/core/commissioner" aria-current={current === 'all' ? 'page' : undefined}>
        All leagues{runCount != null && runCount > 0 ? ` · ${runCount}` : ''}
      </Link>
      {ORDER.map((f) => (
        <Link key={f} href={`/core/hubs/${f}`} aria-current={f === current ? 'page' : undefined}>
          {HUB_TABS[f]}
          {counts[f] > 0 && f !== current ? ` · ${counts[f]}` : ''}
        </Link>
      ))}
    </nav>
  )
}
