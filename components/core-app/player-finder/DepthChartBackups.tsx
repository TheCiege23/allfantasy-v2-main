'use client'

import { groupCells, type BackupCell, type DepthChartView } from '@/lib/core-app/depthChart'
import { finderPlayerInfoCopy, infoDateText, type PlayerInfoCopy } from '@/lib/core-app/finderPlayerInfoCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * "Next man up" — his team's depth chart at his spot, and for each player around him, where that
 * player is in your leagues (lib/core-app/depthChart.ts, loaded by depthChartBackups.ts).
 *
 * Free: the chart and roster presence are facts, the same footing as the league strip. What is yours
 * and what you can claim are listed league by league, because those are the moves; leagues where
 * someone else has him, or whose rosters we could not read, collapse to a count with their names.
 *
 * Spanish (2026-10-05): the words come from finderPlayerInfoCopy.ts at render; the "yours" detail from
 * depthChart.ts's closed vocabulary, the other team's name as written, the date through `kickoffText`.
 */

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function names(cells: readonly BackupCell[]): string {
  return cells.map((c) => c.leagueName).join(', ')
}

function Presence({ cells, last, t }: { cells: readonly BackupCell[]; last: string; t: PlayerInfoCopy }) {
  const g = groupCells(cells)
  return (
    <ul className="af-pf-dc-where">
      {g.yours.map((c) => (
        <li key={c.leagueId} className="af-pf-dc-cell is-yours">
          <span className="af-pf-dc-tag">{t.dcYours}</span> {c.leagueName}
          {c.detail ? <span className="af-pf-dc-detail"> · {t.dcDetail(c.detail)}</span> : null}
        </li>
      ))}
      {g.free.map((c) => (
        <li key={c.leagueId} className="af-pf-dc-cell is-free">
          <span className="af-pf-dc-tag">{t.dcFree}</span> {c.leagueName}
          {c.claim ? (
            <a
              className="af-pf-dc-claim"
              href={c.claim.href}
              {...(c.claim.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {t.dcClaim(last, c.claim.platformLabel)}
            </a>
          ) : null}
        </li>
      ))}
      {g.other.length > 0 ? (
        <li className="af-pf-dc-cell is-other">
          <span className="af-pf-dc-tag">{t.dcTaken}</span>
          {t.dcTakenIn(g.other.length)}{' '}
          {g.other.map((c) => (c.detail ? `${c.leagueName} (${c.detail})` : c.leagueName)).join(', ')}
        </li>
      ) : null}
      {g.unknown.length > 0 ? (
        <li className="af-pf-dc-cell is-unknown">
          <span className="af-pf-dc-tag">{t.dcCantRead}</span> {names(g.unknown)}
        </li>
      ) : null}
    </ul>
  )
}

export function DepthChartBackups({
  data,
  playerName,
  hrefFor,
}: {
  data: DepthChartView | null
  playerName: string
  /** The finder link for a player ref, keeping the page's league scope. */
  hrefFor: (ref: string, name: string) => string
}) {
  const { language } = useOptionalLanguage()
  if (!data || data.entries.length < 2) return null
  const t = finderPlayerInfoCopy(language)
  const last = (n: string) => n.trim().split(/\s+/).slice(-1)[0] || n
  const him = last(playerName)
  const asOf = infoDateText(DATE.format(new Date(data.asOfIso)), language)
  return (
    <section className="af-card af-pf-dc" aria-labelledby="af-pf-dc-h">
      <h3 className="af-label" id="af-pf-dc-h">
        {t.dcHeading(data.team, t.dcSlot(data.slot))}
      </h3>
      <ol className="af-pf-dc-list">
        {data.entries.map((e) => {
          const cells = e.sleeperId && data.presence ? data.presence[e.sleeperId] : undefined
          return (
            <li key={`${e.depth}-${e.name}`} className={`af-pf-dc-row${e.isHim ? ' is-him' : ''}`}>
              <div className="af-pf-dc-head">
                <span className="af-pf-dc-depth af-num" aria-label={t.dcDepthAria(e.depth)}>
                  {e.depth}
                </span>
                {e.ref && !e.isHim ? (
                  <a className="af-pf-dc-name" href={hrefFor(e.ref, e.name)}>
                    {e.name}
                  </a>
                ) : (
                  <span className="af-pf-dc-name">{e.name}</span>
                )}
                {e.isHim ? <span className="af-pf-dc-you">{t.dcThisPlayer}</span> : null}
              </div>
              {!e.isHim && cells ? <Presence cells={cells} last={last(e.name)} t={t} /> : null}
            </li>
          )
        })}
      </ol>
      <p className="af-pf-dc-foot">
        {data.hisDepth === 1 ? t.dcWhoPlays(him) : t.dcHisNumber(him, data.hisDepth)}
        {t.dcAsOf(asOf)}
      </p>
    </section>
  )
}
