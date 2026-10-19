import Link from 'next/link'
import type { HubFormat } from '@/lib/core-app/formatHubs'
import { hubCopy, hubTab } from '@/lib/core-app/formatHubCopy'

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
  language = 'en',
}: {
  current: HubFormat | 'all'
  /** Leagues of each format the reader is in. */
  counts: Record<HubFormat, number>
  /** Leagues the reader runs, for the "All leagues" pill. Null leaves the count off. */
  runCount?: number | null
  /** No hooks here (server and client screens both draw it), so the caller passes the language. */
  language?: string
}) {
  return (
    <nav className="afh-switch" aria-label={hubCopy('Commissioner hubs', language)}>
      <Link href="/core/commissioner" aria-current={current === 'all' ? 'page' : undefined}>
        {hubCopy('All leagues', language)}{runCount != null && runCount > 0 ? ` · ${runCount}` : ''}
      </Link>
      {ORDER.map((f) => (
        <Link
          key={f}
          href={`/core/hubs/${f}`}
          aria-current={f === current ? 'page' : undefined}
          /*
           * A format the reader is in no league of. On a phone these pills were two rows of dead
           * ends above the hub, so the phone hides them (af-format-hubs.css); desktop keeps the
           * full row, where it is how someone discovers a format. The open hub is never hidden.
           */
          data-empty={counts[f] > 0 || f === current ? undefined : 'true'}
        >
          {hubTab(f, HUB_TABS[f], language)}
          {counts[f] > 0 && f !== current ? ` · ${counts[f]}` : ''}
        </Link>
      ))}
    </nav>
  )
}
