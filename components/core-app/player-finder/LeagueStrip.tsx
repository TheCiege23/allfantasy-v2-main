import Link from 'next/link'

import type { StripChip } from '@/lib/core-app/leagueStrip'
import { TopicTip } from '@/components/core-app/TopicTip'

/**
 * One chip per league you play, under the player's name — START / BENCH / IR / TAXI where he is
 * yours, the other team's name where he is not, FA where nobody has him, "?" where we cannot read
 * the league (lib/core-app/leagueStrip.ts). The table below says the same in rows; this is the
 * glance.
 *
 * Each chip opens the card scoped to that league (`?league=`), where the ownership card, the
 * trade visual and the league's own call are.
 */
export function LeagueStrip({ chips, leagueHref }: { chips: StripChip[]; leagueHref: (leagueId: string) => string }) {
  if (chips.length === 0) return null
  const count = (state: StripChip['state']) => chips.filter((c) => c.state === state).length
  const yours = chips.filter((c) => c.state === 'start' || c.state === 'bench' || c.state === 'ir' || c.state === 'taxi').length
  const free = count('free')
  return (
    <div className="af-pf-strip" aria-label="Where he is in each of your leagues">
      <ul className="af-pf-strip-list">
        {chips.map((c) => (
          <li key={c.leagueId}>
            <Link
              href={leagueHref(c.leagueId)}
              className="af-pf-strip-chip"
              data-state={c.state}
              data-tone={c.tone}
              aria-label={c.sentence}
            >
              <span className="af-pf-strip-league">{c.leagueName}</span>
              <span className="af-pf-strip-badge af-num">{c.badge}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="af-pf-strip-sum af-num">
        Yours in {yours} · available in {free} · elsewhere in {count('other')}
        {count('unknown') > 0 ? ` · can't read ${count('unknown')}` : ''}{' '}
        {/* One key for every chip — the per-chip `title` it replaces never showed on a phone. */}
        <TopicTip topic="leagueStripLegend" />
      </p>
    </div>
  )
}
