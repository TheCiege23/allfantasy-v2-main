'use client'

import { useState, type ReactNode } from 'react'
import { ordinal, positionTone, slotPillLabel } from '@/lib/league/native/nativeScreenModels'
import { matchupTone, type OpponentRank, type RosterGameWeather } from '@/lib/redraft/nflRosterOutlookModel'
import { redraftPositionTone } from '@/lib/league-media/redraftScreens'
import { useRedraftScreenContext } from './RedraftScreenParts'
import { usePlayerCard, type PlayerCardRef } from '@/components/core-app/player-card/PlayerCardProvider'
import { PC_REF_ATTR, encodePlayerRef } from '@/components/core-app/player-card/playerCardSiblings'
import { teamLogoUrl as teamCrestUrl } from '@/lib/core-app/teamLogo'
import './native-screens.css'

/**
 * Opens the shared player card (components/core-app/player-card) for a row on a league screen.
 * The league workspace mounts the provider; outside it the opener is a no-op, so a screen rendered
 * alone (a unit test) still works. NFL ids on these screens are Sleeper ids; other sports carry
 * the feed's own id.
 */
type NativeCardPlayer = { id?: string | null; name?: string | null; position?: string | null; team?: string | null; imageUrl?: string | null } | null | undefined

function nativeCardRef(sport: string | null | undefined, p: NativeCardPlayer): PlayerCardRef | null {
  const id = String(p?.id ?? '').trim()
  if (!id || !p?.name) return null
  const s = String(sport ?? 'NFL').toUpperCase()
  return {
    sport: s,
    ...(s === 'NFL' ? { sleeperId: id } : { externalId: id }),
    name: p.name,
    position: p.position ?? null,
    team: p.team ?? null,
    imageUrl: p.imageUrl ?? null,
  }
}

/**
 * `open(player, origin?)` opens his card; pass the tapped element as `origin` so the card can swipe
 * through the screen's other players. `open.refAttrs(player)` is the attribute that puts a control in
 * that swipe list — spread it on whatever is tapped (`PlayerNameButton` takes it as `refAttrs`).
 */
export function useNativePlayerCard(sport: string | null | undefined) {
  const card = usePlayerCard()
  const open = (p: NativeCardPlayer, origin?: Element | null) => {
    const ref = nativeCardRef(sport, p)
    if (!ref) return
    // No origin, no second argument: a plain open stays exactly the call it always was.
    if (origin) card.open(ref, { origin })
    else card.open(ref)
  }
  return Object.assign(open, {
    refAttrs: (p: NativeCardPlayer): Record<string, string> => {
      const ref = nativeCardRef(sport, p)
      return ref ? { [PC_REF_ATTR]: encodePlayerRef(ref) } : {}
    },
  })
}

/** A player's name as the button that opens his card. Looks like the text it replaces. */
export function PlayerNameButton({
  name,
  onOpen,
  refAttrs,
  children,
}: {
  name: string
  /** Receives the button, to hand to the card as the swipe origin. */
  onOpen: (origin: HTMLElement) => void
  /** `useNativePlayerCard(...).refAttrs(player)` — joins this name to the card's swipe list. */
  refAttrs?: Record<string, string>
  children: ReactNode
}) {
  return (
    <button type="button" className="nls-namebtn" onClick={(e) => onOpen(e.currentTarget)} aria-label={`Open ${name} player card`} data-testid="player-card-open" {...refAttrs}>
      {children}
    </button>
  )
}

export function ScreenHead({ eyebrow, title, sub, children }: { eyebrow?: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="nls-head">
      <div className="nls-head-text">
        {eyebrow ? <p className="nls-eyebrow">{eyebrow}</p> : null}
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

/**
 * Headshot with the club crest on its corner, for every sport.
 *
 * Headshot falls back to initials. The crest is the passed `teamLogoUrl`, else the registry crest for
 * `sport` + `team` (`lib/core-app/teamLogo` — a known club only, never a guess), else — and also when
 * the crest image fails to load — the team's abbreviation in the same corner chip. So a row always
 * carries its club: a missing image never leaves the corner blank while the team is known.
 */
export function PlayerAvatar({ name, headshotUrl, teamLogoUrl, team, sport, empty }: { name?: string | null; headshotUrl?: string | null; teamLogoUrl?: string | null; team?: string | null; sport?: string | null; empty?: boolean }) {
  // The failed src is remembered, not a boolean, so a different player in the same slot gets a fresh try.
  const [brokenHead, setBrokenHead] = useState<string | null>(null)
  const [brokenCrest, setBrokenCrest] = useState<string | null>(null)
  const initials = (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
  const teamCode = team?.trim() || null
  const crest = teamLogoUrl?.trim() || registryCrest(sport, teamCode)
  const head = headshotUrl?.trim() || null
  return (
    <span className="nls-pavatar" aria-hidden data-empty={empty || undefined} data-testid="nls-pavatar">
      {head && head !== brokenHead ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={head} alt="" loading="lazy" decoding="async" onError={() => setBrokenHead(head)} />
      ) : (
        <span data-testid="nls-pavatar-initials">{initials}</span>
      )}
      {crest && crest !== brokenCrest ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="nls-pavatar-crest" src={crest} alt="" loading="lazy" decoding="async" onError={() => setBrokenCrest(crest)} data-testid="nls-pavatar-crest" />
      ) : teamCode && !isNoTeamCode(teamCode) ? (
        <span className="nls-pavatar-crest nls-pavatar-crest-text" data-testid="nls-pavatar-crest-abbr">{teamCode.slice(0, 3).toUpperCase()}</span>
      ) : null}
    </span>
  )
}

function registryCrest(sport: string | null | undefined, team: string | null): string | null {
  if (!team || !sport) return null
  try {
    return teamCrestUrl(sport, team)
  } catch {
    return null
  }
}

/** "FA" / "Free Agent" carry no club, so they get no corner chip. */
function isNoTeamCode(team: string): boolean {
  const t = team.trim().toUpperCase()
  return t === 'FA' || t === 'FREE AGENT' || t === 'NONE' || t === '-' || t === '—'
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
