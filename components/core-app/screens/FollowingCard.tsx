'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import PlayerName from '@/components/core-app/player-card/PlayerName'
import type { FollowingCardData } from '@/lib/core-app/followingCard'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { followingNextText, followingStatusText } from '@/lib/core-app/dashboard3aCopy'

/**
 * The home "Following" card (user decisions, 2026-09-14): players followed across every
 * league, from the ☆ on any player card, with their reported status and next game.
 *
 * ⚠ NOTHING RENDERS WHEN `data` IS NULL. That is "follows unavailable" (the `player_follows`
 * migration not applied, or the read failed), and an empty card inviting a follow would
 * advertise a star that cannot save.
 *
 * ⚠ A BLANK STATUS IS "NOTHING REPORTED", NEVER "HEALTHY". When the injury feed itself
 * cannot answer, the card says so, so a column of blanks is never left unexplained.
 *
 * Spanish (2026-10-04): the next game is rebuilt from the row's `nextParts` and the status goes through
 * coreUiCopy's designations (lib/core-app/dashboard3aCopy.ts). The provider starts at English on server
 * and client alike, so the first paint agrees.
 */
export function FollowingCard({ data, help }: { data: FollowingCardData | null; help?: ReactNode }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  if (!data) return null
  return (
    <section className="af3a-card af3a-following">
      <header className="af3a-cardhead">
        {/* "Seguidos" — the title of this card's own "?" (help-topics/home.ts `homeFollowing`). */}
        <span className="af3a-label">{es ? 'SEGUIDOS' : 'FOLLOWING'}</span>
        {help}
      </header>
      {data.rows.length === 0 ? (
        es ? (
          <p className="af3a-reason">
            Toca ☆ en la ficha de cualquier jugador para seguirlo en todas tus ligas. Aquí verás su estado
            y su próximo partido.
          </p>
        ) : (
        <p className="af3a-reason">
          Tap ☆ on any player card to follow him across every league. His status and next game will
          show here.
        </p>
        )
      ) : (
        <ul className="af3a-follow-list">
          {data.rows.map((r) => (
            <li key={`${r.sport}:${r.playerKey}`} className="af3a-follow">
              <span className="af3a-follow-name">
                <PlayerName
                  sport={r.sport}
                  sleeperId={r.sleeperId}
                  externalId={r.externalId}
                  name={r.name}
                  position={r.position}
                  team={r.team}
                />
                {r.position || r.team ? <em> {[r.position, r.team].filter(Boolean).join(' · ')}</em> : null}
              </span>
              {r.status ? (
                <span className="af3a-follow-status" data-status={r.status.toLowerCase()}>
                  {followingStatusText(r.status, language)}
                </span>
              ) : null}
              {r.next ? <span className="af3a-follow-next af3a-mono">{followingNextText(r, language)}</span> : null}
              {/*
                The waiver nudge (2026-09-14): he is on nobody's roster in one of your leagues.
                Only leagues whose every roster could be read — see freeAgentLeaguesFor.
              */}
              {r.freeAgentIn?.length ? (
                <Link className="af3a-follow-fa" href={r.freeAgentIn[0].href}>
                  {es
                    ? r.freeAgentIn.length === 1
                      ? `Agente libre en ${r.freeAgentIn[0].leagueName} →`
                      : `Agente libre en ${r.freeAgentIn.length} de tus ligas →`
                    : r.freeAgentIn.length === 1
                      ? `Free agent in ${r.freeAgentIn[0].leagueName} →`
                      : `Free agent in ${r.freeAgentIn.length} of your leagues →`}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {data.statusCoverage === 'unavailable' && data.rows.length > 0 ? (
        <p className="af3a-exp-note">
          {es
            ? 'El parte de lesiones no responde ahora, así que ocultamos los estados.'
            : 'The injury feed can’t answer right now, so statuses are hidden.'}
        </p>
      ) : null}
      {data.total > data.rows.length ? (
        <p className="af3a-exp-note">
          +{data.total - data.rows.length} {es ? 'más que sigues.' : 'more you follow.'}
        </p>
      ) : null}
    </section>
  )
}

export default FollowingCard
