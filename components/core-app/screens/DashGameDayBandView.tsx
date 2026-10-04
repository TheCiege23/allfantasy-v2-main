'use client'

import Link from 'next/link'
import { Dash34Time, Dash34Countdown } from '@/components/core-app/screens/Dashboard34Live'
import { FallbackImg } from '@/components/core-app/FallbackImg'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { oddsText, playActionText } from '@/lib/core-app/homeBandsCopy'
import type { PlayFeedItem } from '@/lib/live/playFeedPresentation'
import type { Next24Row } from '@/lib/core-app/todayStrip'

/**
 * The words of DashGameDayBand, in the reader's language (2026-10-04).
 *
 * The band is a SERVER component: it applies both gates, the four-hour play window against the
 * server's `now`, and the caps, and this says it. A play is rebuilt in Spanish from the parts
 * `playFeedPresentation` now writes, a betting line from the parts `todayStrip` writes — either one
 * without parts stays whole English.
 */
export type GameDayPlay = Pick<PlayFeedItem, 'id' | 'type' | 'playerName' | 'position' | 'team' | 'imageUrl' | 'headline' | 'actionParts'>

export type GameDayRow = Pick<Next24Row, 'time' | 'tone' | 'text' | 'sub' | 'parts' | 'game'> & { key: string }

const TYPE_LABEL: Record<PlayFeedItem['type'], string> = {
  TOUCHDOWN: 'TD',
  BIG_PLAY: 'BIG',
  TURNOVER: 'TO',
  FIELD_GOAL: 'FG',
  DEFENSIVE_SCORE: 'DEF TD',
  SPECIAL_TEAMS_SCORE: 'ST TD',
}

/** TD, FG and their DEF / ST forms are what a Spanish-language broadcast prints too; the two words are not. */
const TYPE_LABEL_ES: Partial<Record<PlayFeedItem['type'], string>> = { BIG_PLAY: 'GRAN', TURNOVER: 'PÉRD' }

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function headlineText(p: GameDayPlay, es: boolean): string {
  if (!es) return p.headline
  const action = playActionText(p.actionParts)
  if (!action) return p.headline
  return `${p.position ? `${p.playerName} (${p.position})` : p.playerName} ${action}`
}

function subText(row: GameDayRow, es: boolean): string | null {
  if (!es || !row.parts) return row.sub
  return [row.parts.sport, row.parts.week != null ? `Semana ${row.parts.week}` : null].filter(Boolean).join(' · ') || null
}

export function DashGameDayBandView({
  record,
  plays,
  upcoming,
}: {
  record: { wins: number; losses: number; week: number } | null
  plays: GameDayPlay[]
  upcoming: GameDayRow[]
}) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const title = es ? 'Día de partido' : 'Game day'

  return (
    <section className="af-core af-gd" aria-label={title}>
      <div className="af-gd-head">
        <span className="af-label af-gd-kicker">{title}</span>
        {record ? (
          <>
            <span className="af-gd-record af-num">
              <b>{es ? `${record.wins} por delante` : `${record.wins} ahead`}</b>
              <span className="af-gd-sep">·</span>
              <i>{es ? `${record.losses} por detrás` : `${record.losses} behind`}</i>
              <span className="af-gd-recmeta">
                {' '}
                {es ? `ahora mismo · semana ${record.week}` : `right now · week ${record.week}`}
              </span>
            </span>
            {/* A sibling of the record, not inside it: one "?" for the line, never per number. */}
            <TopicTip topic="gameDayRecord" />
          </>
        ) : (
          /*
           * Plays are landing but no matchup of yours is scored yet. Saying so
           * beats an absent tile, which reads as a broken scoreboard, and beats
           * a 0–0, which reads as a day played and lost.
           */
          <span className="af-gd-recmeta">
            {es ? 'ninguno de tus enfrentamientos ha sumado puntos todavía' : 'none of your matchups have scored yet'}
          </span>
        )}
      </div>

      {plays.length > 0 ? (
        <p className="af-gd-scope">
          {es ? 'Todas las jugadas de anotación de la NFL, no solo las de tus jugadores' : 'Every NFL scoring play — not only your players'}
        </p>
      ) : null}

      {plays.length > 0 ? (
        <ul className="af-gd-plays">
          {plays.map((p) => (
            <li key={p.id} className="af-gd-play">
              <span className="af-gd-face" aria-hidden>
                {p.imageUrl ? (
                  <FallbackImg src={p.imageUrl} alt="" loading="lazy" fallback={initialsOf(p.playerName)} />
                ) : (
                  initialsOf(p.playerName)
                )}
              </span>
              <span className="af-gd-type af-num" data-type={p.type}>
                {(es ? TYPE_LABEL_ES[p.type] : null) ?? TYPE_LABEL[p.type] ?? (es ? 'JUGADA' : 'PLAY')}
              </span>
              <span className="af-gd-line">
                {headlineText(p, es)}
                {p.team ? <span className="af-gd-team af-num"> {p.team}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        One key for the betting lines, above the list — it replaces a per-row `title=` ("Odds checked
        <ISO>") a phone never showed. The row already prints "line as of …" once a line is over an hour old.
      */}
      {upcoming.some((row) => row.game) ? (
        <p className="af-gd-scope">
          {es ? 'Próximas 24 horas · líneas de apuestas' : 'Next 24 hours · betting lines'} <TopicTip topic="bettingLine" />
        </p>
      ) : null}

      {upcoming.length > 0 ? (
        <ul className="af-gd-next">
          {upcoming.map((row) => (
            <li key={row.key} className="af-gd-nextrow" data-tone={row.tone ?? undefined}>
              <span className="af-gd-nexttime af-num">
                {/* ISO instant localised after hydration — the server cannot
                    know the reader's zone, and a server paint would mismatch. */}
                <Dash34Time iso={row.time} />
              </span>
              <div className="af-gd-nexttext">
                <div className="af-gd-matchup">
                  {/* A crest that fails to load disappears, like one we never had — never a broken glyph. */}
                  {row.game?.awayLogo ? <FallbackImg src={row.game.awayLogo} fallback={null} alt="" width={24} height={24} loading="lazy" /> : null}
                  <span>{row.game?.away ?? row.text}</span>
                  {row.game ? (
                    <>
                      {/* ESPN Deportes' convention: the away side "en" the home side. */}
                      <span>{es ? 'en' : 'at'}</span>
                      {row.game.homeLogo ? <FallbackImg src={row.game.homeLogo} fallback={null} alt="" width={24} height={24} loading="lazy" /> : null}
                      <span>{row.game.home}</span>
                    </>
                  ) : null}
                </div>
                {row.game ? <div className="af-gd-market">{es ? (oddsText(row.game.oddsParts) ?? row.game.odds) : row.game.odds}</div> : null}
                <div className="af-gd-nextsub">
                  {subText(row, es)} · {es ? 'Empieza en' : 'Starts in'} <Dash34Countdown to={row.time} initial="—" />
                </div>
              </div>
              {row.game ? (
                <Link className="af-gd-scoring" href={row.game.href}>
                  {es ? 'Puntuación en vivo →' : 'Live scoring →'}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export default DashGameDayBandView
