'use client'

import { TeamLogo } from '@/components/core-app/player-finder/PlayerMarks'
import type { TeamSplit as TeamSplitData } from '@/lib/core-app/teamSplit'

/**
 * "Where your starters come from" — the clubs your starting QB/RB/WR/TE slots belong to across every
 * roster of yours, and the upcoming week one set of byes empties the most of them
 * (lib/core-app/teamSplit.ts). Free: facts about your own rosters.
 *
 * The bars are scaled to the biggest club so the shape reads at a glance; the percentage beside each
 * is of ALL your starting slots, which is the number that matters.
 */

const pct = (x: number) => `${Math.round(x * 100)}%`

export function TeamSplit({ data }: { data: TeamSplitData | null }) {
  if (!data || data.teams.length === 0) return null
  const top = data.teams[0].starts
  return (
    <div className="af-pf-split" role="group" aria-labelledby="af-pf-split-h">
      <h4 className="af-label" id="af-pf-split-h">
        Where your starters come from
      </h4>
      <p className="af-pf-split-sub af-num">
        {data.totalStarts} starting QB/RB/WR/TE {data.totalStarts === 1 ? 'slot' : 'slots'} across your rosters
      </p>
      <ol className="af-pf-split-list">
        {data.teams.map((t) => (
          <li key={t.team} className="af-pf-split-row">
            <span className="af-pf-split-team">
              <TeamLogo sport="NFL" team={t.team} size={16} />
              <strong>{t.team}</strong>
            </span>
            <span className="af-pf-split-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(4, (t.starts / top) * 100)}%` }} />
            </span>
            <span className="af-pf-split-num af-num">
              {pct(t.share)} · {t.starts} {t.starts === 1 ? 'slot' : 'slots'}
            </span>
            <span className="af-pf-split-who">{t.players.join(', ')}</span>
          </li>
        ))}
      </ol>
      {data.others.teams > 0 || data.unknownStarts > 0 ? (
        <p className="af-pf-split-rest af-num">
          {data.others.teams > 0
            ? `${data.others.teams} more ${data.others.teams === 1 ? 'club' : 'clubs'} · ${data.others.starts} ${data.others.starts === 1 ? 'slot' : 'slots'}`
            : ''}
          {data.others.teams > 0 && data.unknownStarts > 0 ? ' · ' : ''}
          {data.unknownStarts > 0 ? `${data.unknownStarts} with no club on file` : ''}
        </p>
      ) : null}
      {data.worstBye ? (
        <p className="af-pf-split-bye">
          <strong>Week {data.worstBye.week} is your biggest bye ahead:</strong> {data.worstBye.starts} of your {data.totalStarts} starting
          slots ({pct(data.worstBye.share)}) are off — {data.worstBye.teams.join(', ')}.
        </p>
      ) : data.byesKnown ? (
        <p className="af-pf-split-rest">None of these clubs has a bye still ahead.</p>
      ) : (
        <p className="af-pf-split-rest">Bye weeks aren&apos;t on file yet, so there&apos;s no bye call.</p>
      )}
    </div>
  )
}
