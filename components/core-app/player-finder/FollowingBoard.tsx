'use client'

import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { PlayerAvatar, TeamLogo } from '@/components/core-app/player-finder/PlayerMarks'
import type { FollowingCardData, FollowingRow } from '@/lib/core-app/followingCard'
import { followingNextText, followingStatusText } from '@/lib/core-app/dashboard3aCopy'
import { followCopy } from '@/lib/core-app/finderFollowCopy'
import { playerRef } from '@/lib/core-app/playerRef'

/**
 * "Following" on the Player Finder home (2026-10-08, "My players"): the players you follow, each
 * opening his Finder card, with his reported status, his next game, and — the reason to look —
 * the leagues of yours where nobody has him, each one a link to that league's waivers.
 *
 * Same data as the /core home's Following card (lib/core-app/followingCard.ts) in the Finder's own
 * row style. ⚠ NULL RENDERS NOTHING: that is "follows unavailable", and an empty board inviting a
 * follow would advertise a button that cannot save. An EMPTY list does render, as the invitation.
 *
 * ⚠ A BLANK STATUS IS "NOTHING REPORTED", NEVER "HEALTHY" — the same rule as the home card.
 */

/** Free-agent leagues named inline before "+N"; the rest are one tap away on his card. */
const FREE_SHOWN = 2

function cardHref(r: FollowingRow): string {
  const ref = r.externalId ? playerRef(r.sport, r.externalId) : null
  return ref ? `/core/players?q=${encodeURIComponent(r.name)}&player=${encodeURIComponent(ref)}` : `/core/players?q=${encodeURIComponent(r.name)}`
}

function headshot(r: FollowingRow): string | null {
  return r.sport === 'NFL' && r.sleeperId ? `https://sleepercdn.com/content/nfl/players/thumb/${r.sleeperId}.jpg` : null
}

function statusTone(status: string): 'bad' | 'warn' | 'none' {
  const s = status.toUpperCase()
  if (s === 'OUT' || s === 'IR' || s === 'PUP' || s === 'SUSPENDED' || s === 'DOUBTFUL') return 'bad'
  if (s === 'QUESTIONABLE' || s === 'DAY-TO-DAY' || s === 'DTD') return 'warn'
  return 'none'
}

export function FollowingBoard({ data }: { data: FollowingCardData | null }) {
  const { language } = useOptionalLanguage()
  if (!data) return null
  const t = followCopy(language)
  const hidden = Math.max(0, data.total - data.rows.length)
  return (
    <section className="af-card af-pf-shares af-pf-following" aria-labelledby="af-pf-following-h">
      <header className="af-pf-shares-head">
        <h3 className="af-label" id="af-pf-following-h">
          {t.boardTitle}
        </h3>
        {data.total > 0 ? <span className="af-pf-shares-sub af-num">{data.total}</span> : null}
      </header>
      {data.rows.length === 0 ? (
        <p className="af-pf-unavailable">{t.boardEmpty}</p>
      ) : (
        <ul className="af-pf-shares-list af-pf-following-list">
          {data.rows.map((r) => {
            const next = followingNextText(r, language)
            const free = r.freeAgentIn
            return (
              <li key={`${r.sport}:${r.playerKey}`} className="af-pf-share af-pf-follow-row" data-tone={r.status ? statusTone(r.status) : 'none'}>
                <Link href={cardHref(r)} className="af-pf-share-link">
                  <PlayerAvatar src={headshot(r)} name={r.name} size={36} />
                  <span className="af-pf-share-who">
                    <span className="af-pf-share-name">
                      {r.name}
                      {r.status ? (
                        <span className="af-chip af-num af-pf-ready af-pf-share-status" data-tone={statusTone(r.status)}>
                          {followingStatusText(r.status, language)}
                        </span>
                      ) : null}
                    </span>
                    <span className="af-pf-share-meta">
                      {r.position ?? ''}
                      {r.team ? (
                        <>
                          {r.position ? ' · ' : ''}
                          <TeamLogo sport={r.sport} team={r.team} size={14} />
                          {r.team}
                        </>
                      ) : null}
                      {next ? <span className="af-num"> · {next}</span> : null}
                    </span>
                  </span>
                </Link>
                {free.length > 0 ? (
                  <span className="af-pf-follow-free">
                    {free.slice(0, FREE_SHOWN).map((l) => (
                      <Link key={l.leagueId} href={l.href} className="af-chip af-pf-follow-free-chip">
                        {t.freeIn(l.leagueName)}
                      </Link>
                    ))}
                    {free.length > FREE_SHOWN ? (
                      <Link href={cardHref(r)} className="af-chip af-pf-follow-free-chip af-num" aria-label={t.freeIn(String(free.length))}>
                        {t.freeMore(free.length - FREE_SHOWN)}
                      </Link>
                    ) : null}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {data.rows.length > 0 && data.statusCoverage === 'unavailable' ? <p className="af-pf-shares-foot">{t.statusUnavailable}</p> : null}
      {hidden > 0 ? <p className="af-pf-shares-foot">{t.more(hidden)}</p> : null}
    </section>
  )
}

export default FollowingBoard
