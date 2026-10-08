'use client'

import Link from 'next/link'
import { PlayerAvatar, TeamLogo } from '@/components/core-app/player-finder/PlayerMarks'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { finderCopy } from '@/lib/core-app/playerFinderCopy'
import type { TrendingAdds as TrendingAddsData } from '@/lib/core-app/trendingAdds'

/**
 * "Most added this week" — in the finder's rail under "Recently searched": the players the most leagues
 * picked up over the last seven days (lib/core-app/trendingAdds.ts), each opening his card. An
 * aggregate that names no league or manager, so it shows to everyone. Free.
 *
 * The sub-line says how fresh the list is ("through Sep 28") because the transaction sync lags —
 * "this week" is honest, "today" would not be.
 *
 * Spanish (2026-10-07): the words come from playerFinderCopy.ts (`trend*`), built at render from
 * `useOptionalLanguage`, which starts at English on server and client alike. The date stays pinned
 * en-US here and is translated as text ("Sep 28" → "28 sep"), so the first paint cannot disagree.
 */

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })

export function TrendingAdds({ data, leagueParam }: { data: TrendingAddsData | null; leagueParam: string }) {
  const { language } = useOptionalLanguage()
  const t = finderCopy(language)
  if (!data || data.rows.length === 0) return null
  return (
    <section className="af-card af-pf-recent af-pf-trend" aria-labelledby="af-pf-trend-h">
      <header className="af-pf-section-head">
        <h2 className="af-label" id="af-pf-trend-h">
          {t.trendHeading}
        </h2>
        <span className="af-pf-trend-sub af-num">
          {t.trendSub(data.activeLeagues, data.through ? DATE.format(new Date(data.through)) : null)}
        </span>
      </header>
      <ul className="af-pf-match-list">
        {data.rows.map((r) => {
          const body = (
            <>
              <PlayerAvatar src={r.imageUrl} name={r.name} size={32} />
              <span className="af-pf-match-text">
                <span className="af-pf-match-name">{r.name}</span>
                <span className="af-pf-match-meta af-num">
                  {r.position ?? ''}
                  {r.position && r.team ? ' · ' : ''}
                  {r.team ? (
                    <>
                      <TeamLogo sport="NFL" team={r.team} />
                      {r.team}
                    </>
                  ) : null}
                </span>
              </span>
              <span className="af-pf-trend-count af-num" aria-label={t.trendAddedIn(r.leagues)}>
                +{r.leagues}
              </span>
            </>
          )
          return (
            <li key={r.sleeperId}>
              {r.ref ? (
                <Link href={`/core/players?q=${encodeURIComponent(r.name)}&player=${encodeURIComponent(r.ref)}${leagueParam}`} className="af-pf-match af-pf-recent-row">
                  {body}
                </Link>
              ) : (
                <span className="af-pf-match af-pf-recent-row">{body}</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
