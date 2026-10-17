'use client'

import { TeamLogo } from '@/components/core-app/player-finder/PlayerMarks'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { tradeValueCopy } from '@/lib/core-app/finderTradeValueCopy'
import type { TeamSplit as TeamSplitData } from '@/lib/core-app/teamSplit'

/**
 * "Where your starters come from" — the clubs your starting QB/RB/WR/TE slots belong to across every
 * roster of yours, and the upcoming week one set of byes empties the most of them
 * (lib/core-app/teamSplit.ts). Free: facts about your own rosters.
 *
 * The bars are scaled to the biggest club so the shape reads at a glance; the percentage beside each
 * is of ALL your starting slots, which is the number that matters.
 *
 * Spanish (2026-10-05): rendered only inside PlayerSharesBoard, so its words live with that board's,
 * in finderTradeValueCopy.ts.
 */

const pct = (x: number) => `${Math.round(x * 100)}%`

export function TeamSplit({ data }: { data: TeamSplitData | null }) {
  const { language } = useOptionalLanguage()
  const t = tradeValueCopy(language)
  if (!data || data.teams.length === 0) return null
  const top = data.teams[0].starts
  return (
    <div className="af-pf-split" role="group" aria-labelledby="af-pf-split-h">
      <h4 className="af-label" id="af-pf-split-h">
        {t.splitHeading}
      </h4>
      <p className="af-pf-split-sub af-num">{t.splitSub(data.totalStarts)}</p>
      <ol className="af-pf-split-list">
        {data.teams.map((row) => (
          <li key={row.team} className="af-pf-split-row">
            <span className="af-pf-split-team">
              <TeamLogo sport="NFL" team={row.team} size={16} />
              <strong>{row.team}</strong>
            </span>
            <span className="af-pf-split-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(4, (row.starts / top) * 100)}%` }} />
            </span>
            <span className="af-pf-split-num af-num">
              {pct(row.share)} · {t.splitSlots(row.starts)}
            </span>
            <span className="af-pf-split-who">{row.players.join(', ')}</span>
          </li>
        ))}
      </ol>
      {data.others.teams > 0 || data.unknownStarts > 0 ? (
        <p className="af-pf-split-rest af-num">
          {data.others.teams > 0 ? t.splitMoreClubs(data.others.teams, data.others.starts) : ''}
          {data.others.teams > 0 && data.unknownStarts > 0 ? ' · ' : ''}
          {data.unknownStarts > 0 ? t.splitNoClub(data.unknownStarts) : ''}
        </p>
      ) : null}
      {data.worstBye ? (
        <p className="af-pf-split-bye">
          <strong>{t.splitWorstByeHead(data.worstBye.week)}</strong>
          {t.splitWorstByeBody(data.worstBye.starts, data.totalStarts, pct(data.worstBye.share), data.worstBye.teams.join(', '))}
        </p>
      ) : data.byesKnown ? (
        <p className="af-pf-split-rest">{t.splitNoByeAhead}</p>
      ) : (
        <p className="af-pf-split-rest">{t.splitByesUnknown}</p>
      )}
    </div>
  )
}
