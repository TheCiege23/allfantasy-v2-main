'use client'

import { useState, type ReactNode } from 'react'
import { ordinal, positionTone, slotPillLabel } from '@/lib/league/native/nativeScreenModels'
import { matchupTone, type OpponentRank, type RosterGameWeather } from '@/lib/redraft/nflRosterOutlookModel'
import { redraftPositionTone } from '@/lib/league-media/redraftScreens'
import { useRedraftScreenContext } from './RedraftScreenParts'
import './native-screens.css'

export function ScreenHead({ eyebrow, title, sub, children }: { eyebrow: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="nls-head">
      <div className="nls-head-text">
        <p className="nls-eyebrow">{eyebrow}</p>
        <h2 className="nls-title">{title}</h2>
        {sub ? <p className="nls-sub">{sub}</p> : null}
      </div>
      {children ? <div className="nls-head-actions">{children}</div> : null}
    </header>
  )
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ id: T; label: string }>; onChange: (id: T) => void }) {
  return (
    <div className="nls-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Position pill. `tone` defaults to the position of `label`, so a FLEX slot can still be coloured by its player.
 * Inside a redraft screen the colour is read per SPORT (`redraftPositionTone`: a C is a centre in the NBA and
 * NHL but a catcher in MLB), as `data-rd-pos`; every other format keeps the football-only `data-tone`.
 */
export function PosPill({ label, tone }: { label: string | null | undefined; tone?: string | null }) {
  const rd = useRedraftScreenContext()
  const rdTone = rd ? redraftPositionTone(rd.sport, tone ?? label) : null
  return (
    <span className="nls-pos" data-tone={positionTone(tone ?? label)} data-rd-pos={rdTone ?? undefined}>
      {slotPillLabel(label)}
    </span>
  )
}

export function InjuryFlag({ status }: { status: string | null | undefined }) {
  const s = String(status ?? '').trim()
  if (!s || /^(healthy|active|none)$/i.test(s)) return null
  const short = /^questionable$/i.test(s) ? 'Q' : /^doubtful$/i.test(s) ? 'D' : /^out$/i.test(s) ? 'O' : /^(ir|injured reserve)$/i.test(s) ? 'IR' : s.slice(0, 3).toUpperCase()
  const bad = short === 'O' || short === 'IR' || short === 'D'
  return (
    <span className="nls-flag" data-tone={bad ? 'bad' : 'warn'} title={s}>
      {short}
    </span>
  )
}

export function Card({ label, tone, flush, children, right, className }: { label?: ReactNode; tone?: 'accent' | 'warn'; flush?: boolean; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`nls-card ${flush ? 'nls-card-flush' : ''} ${className ?? ''}`} data-tone={tone}>
      {label ? (
        <h3 className={`nls-label ${flush ? 'nls-card-head' : ''}`}>
          <span>{label}</span>
          {right ? <span>{right}</span> : null}
        </h3>
      ) : null}
      {children}
    </section>
  )
}

/** Headshot with the club crest on its corner. Falls back to initials; a crest that fails to load hides itself. */
export function PlayerAvatar({ name, headshotUrl, teamLogoUrl, empty }: { name?: string | null; headshotUrl?: string | null; teamLogoUrl?: string | null; empty?: boolean }) {
  const [broken, setBroken] = useState(false)
  const initials = (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
  return (
    <span className="nls-pavatar" aria-hidden data-empty={empty || undefined}>
      {headshotUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={headshotUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        <span>{initials}</span>
      )}
      {teamLogoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="nls-pavatar-crest" src={teamLogoUrl} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none' }} />
      ) : null}
    </span>
  )
}

/** "vs QB 28th": how the week's opponent ranks against this player's position. 1st allows the fewest points. */
export function OpponentRankChip({ id, opponent, rank, testIdPrefix = 'lineup' }: { id?: string | null; opponent?: string | null; rank?: OpponentRank | null; testIdPrefix?: string }) {
  if (!id || !rank) return null
  const tone = matchupTone(rank)
  const word = tone === 'easy' ? 'a favourable matchup' : tone === 'hard' ? 'a tough matchup' : 'an average matchup'
  const title = `${opponent ?? 'The opponent'} rank ${ordinal(rank.rank)} of ${rank.of} against ${rank.position}: ${rank.allowedPerGame} fantasy points allowed per game over ${rank.games} games. 1st allows the fewest. This is ${word}.`
  return (
    <small className="nls-oprank" data-tone={tone ?? undefined} title={title} data-testid={`${testIdPrefix}-opponent-rank-${id}`}>
      <span aria-hidden>vs {rank.position} <b>{ordinal(rank.rank)}</b></span>
      <span className="nls-sr">{title}</span>
    </small>
  )
}

/** The forecast at the player's game: a glyph and the temperature, with the detail in words for a screen reader. */
export function WeatherChip({ id, weather: w, testIdPrefix = 'lineup' }: { id?: string | null; weather?: RosterGameWeather | null; testIdPrefix?: string }) {
  if (!id || !w) return null
  const temp = w.temperatureF != null && Number.isFinite(w.temperatureF) ? `${Math.round(w.temperatureF)}°` : null
  const detail = w.indoors
    ? 'Indoors: weather is not a factor.'
    : [
        w.conditionLabel,
        temp ? `${temp}F` : null,
        w.windSpeedMph != null ? `wind ${Math.round(w.windSpeedMph)} mph` : null,
        w.precipChancePct != null ? `${Math.round(w.precipChancePct)}% chance of rain or snow` : null,
      ].filter(Boolean).join(', ') || 'Forecast'
  return (
    <small className="nls-wx" title={detail} data-indoors={w.indoors || undefined} data-testid={`${testIdPrefix}-weather-${id}`}>
      <span aria-hidden>{w.symbol}{w.indoors ? ' Dome' : temp ? ` ${temp}` : ''}</span>
      <span className="nls-sr">{detail}</span>
    </small>
  )
}
