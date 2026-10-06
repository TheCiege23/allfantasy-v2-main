'use client'

import Link from 'next/link'
import TeamRosterWorkspace from '@/components/core-app/TeamRosterWorkspace'
import { LineupVerification } from '@/components/core-app/LineupVerification'
import PlayerName from '@/components/core-app/player-card/PlayerName'
import { PlayerCardLeagueScope } from '@/components/core-app/player-card/PlayerCardProvider'
import { useEffect, useId, useState } from 'react'
import '@/components/core-app/af-my-team.css'
import { lineupDecision } from '@/lib/core-app/lineupDecision'
import { BENCH_SWAP_POINTS } from '@/lib/core-app/rosterSlots'
import { summariseLineupCheck, type LineupCheck, type LineupCheckItem } from '@/lib/core-app/lineupCheck'
import { DISTANT_LOCK_DAYS } from '@/lib/core-app/lockLabel'
import { SourceActionLink } from '@/components/league-links/SourceActionLink'
import type { BenchCheck, LineupPlayer, LineupSlot, MyTeamData } from '@/lib/core-app/myTeam'
import type { TaxiTenure } from '@/lib/core-app/taxiTenure'
import type { MatchupSide, NextMatchup } from '@/lib/core-app/nextMatchup'
import type { RosterGrade } from '@/lib/core-app/rosterGrade'
import { buildProjectionQuestion } from '@/lib/core-app/scoringNotes'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { PROJECTION_PROVIDER_LABEL } from '@/lib/core-app/projectionProvider'
import { InfoTip } from '@/components/core-app/InfoTip'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { myTeamCardReasonText, myTeamReasonText, scoringNoteText } from '@/lib/core-app/myTeamReasonText'

export type MyTeamProps = {
  data: MyTeamData
}

/** A section the loader could not fill, in the reader's language — `myTeamReasonText` has why. */
function Unavailable({ reason }: { reason: string }) {
  const { language } = useOptionalLanguage()
  return <p className="af-mt-unavailable">{myTeamReasonText(reason, language)}</p>
}

/**
 * Players on this list whose ids match nobody we hold. They are dropped from the rows (there is
 * no name to print), so without this line an ESPN bench of unmatched ids read as an empty bench.
 */
function UnidentifiedNote({ count }: { count: number }) {
  const { language } = useOptionalLanguage()
  if (count <= 0) return null
  return (
    <p className="af-mt-footnote af-mt-unidentified">
      {language === 'es'
        ? `${count} ${count === 1 ? 'jugador más' : 'jugadores más'} en esta lista no ${count === 1 ? 'coincide' : 'coinciden'} con nadie en nuestros datos, así que no se muestra${count === 1 ? '' : 'n'}. Siguen en tu plantilla.`
        : `${count} more ${count === 1 ? 'player' : 'players'} on this list could not be matched to anyone we hold, so ${count === 1 ? 'is' : 'are'} not shown. ${count === 1 ? 'He is' : 'They are'} still on your roster.`}
    </p>
  )
}

/**
 * Live countdown to the lineup lock.
 *
 * ⚠ IT USED TO PRINT "2321:15:08". Hours were the largest unit, so a lock 97
 * days out rendered as a four-digit hour count that read like a stopwatch. The
 * number was accurate and completely unreadable, and it hid the real problem —
 * that it was counting down to the wrong game entirely.
 *
 * Days now lead when there are days. Past a week the countdown stops being a
 * deadline at all and the banner says what it actually knows.
 */
function LockCountdown({
  at,
  anyEmptySlot,
  platform,
  fixHref = null,
  week,
  daysAway,
  next = false,
  asOf,
}: {
  at: Date
  anyEmptySlot: boolean
  platform: string
  /** The provider's lineup screen, when the loader resolved one. Null renders the line as text. */
  fixHref?: string | null
  week: number | null
  daysAway: number
  next?: boolean
  asOf?: number
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const [now, setNow] = useState<number>(() => asOf ?? Date.now())
  /*
   * ⚠ THE LOCK TIME WAS ALWAYS PRINTED IN UTC — a Sunday 1pm Eastern kickoff read "17:00 UTC".
   * UTC is the one zone server and browser agree on, so it is what the server renders and what
   * hydration matches; the reader's own zone replaces it after mount, when it is knowable.
   */
  const [localTime, setLocalTime] = useState<string | null>(null)
  const atMs = at.getTime()
  useEffect(() => {
    try {
      setLocalTime(
        new Intl.DateTimeFormat(language === 'es' ? 'es' : undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        }).format(new Date(atMs)),
      )
    } catch {
      setLocalTime(null)
    }
  }, [atMs, language])

  useEffect(() => {
    setNow(Date.now())
    // A ticking second hand on a deadline eight days out is noise; it only
    // earns the re-render when the number is actually moving for the reader.
    const period = daysAway >= 1 ? 60_000 : 1_000
    const t = setInterval(() => setNow(Date.now()), period)
    return () => clearInterval(t)
  }, [daysAway])

  const ms = at.getTime() - now
  const locked = ms <= 0
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86_400)
  const h = Math.floor((total % 86_400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  const label = locked
    ? copy('Games started')
    : d > 0
      ? `${d}d ${h}h ${m}m`
      : `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`

  const urgent = !locked && (ms <= 3_600_000 || anyEmptySlot)

  return (
    <div className="af-mt-lock" data-urgent={urgent} data-locked={locked}>
      {/*
        ⚠ STAYS A SPAN WHILE THE SECTIONS BELOW BECAME HEADINGS. The lock strip
        renders ABOVE the team name, so promoting it puts an h2 in front of the
        page's h1 and the outline starts one level too deep. It is a status
        banner rather than a section, and it carries its own text ("Week 1
        locks", the time, the reason) which a screen reader reads in document
        order regardless. The matchup, byes and roster lists below ARE sections
        and are headings.
      */}
      <span className="af-label af-mt-lock-label">
        {week != null ? `${copy('Week')} ${week} · ${copy(next ? 'next player kickoff' : 'first kickoff')}` : copy(next ? 'Next player kickoff' : 'First kickoff')}
      </span>
      <span className="af-num af-mt-lock-time">{label}</span>
      <span className="af-mt-lock-note">
        {localTime ?? `${at.toUTCString().slice(0, 22)} UTC`}
        {` · ${copy('confirm individual locks and AutoSubs on your platform')}`}
        {anyEmptySlot ? ` · ${copy('a starting slot is still empty')}` : null}
      </span>
      {/*
        ⚠ IT LOOKED LIKE A LINK AND WAS A SPAN. Accent caps under an urgent banner read as a
        control; tapping it did nothing. Now it IS the provider's lineup screen when we have one.
      */}
      {anyEmptySlot && !locked ? (
        fixHref ? (
          /* A real button now: the most urgent action on the page was 11px caps (audit 2026-10-02). */
          <a className="af-btn af-mt-lock-fix" href={fixHref} target="_blank" rel="noopener noreferrer">
            {copy('Fix it in')} {platform} <span aria-hidden>↗</span>
          </a>
        ) : (
          <span className="af-mt-lock-fix">{copy('Fix it in')} {platform}</span>
        )
      ) : null}
    </div>
  )
}

/**
 * Which colour family a slot belongs to.
 *
 * Grouped rather than one colour per slot: a manager scanning a 16-slot IDP
 * lineup is looking for "where are my defenders", not for a unique hue per
 * label. FLEX and SUPER_FLEX take the group of whoever is actually in them,
 * which the caller passes.
 */
function posGroup(label: string | null | undefined): string {
  const p = (label ?? '').trim().toUpperCase()
  if (p.startsWith('QB')) return 'qb'
  if (p.startsWith('RB')) return 'rb'
  if (p.startsWith('WR')) return 'wr'
  if (p.startsWith('TE')) return 'te'
  if (p === 'K' || p.startsWith('PK')) return 'k'
  if (['DEF', 'DST'].includes(p)) return 'def'
  if (['DL', 'DE', 'DT'].includes(p)) return 'dl'
  if (['LB', 'ILB', 'OLB', 'MLB'].includes(p)) return 'lb'
  if (['DB', 'CB', 'S', 'SS', 'FS'].includes(p)) return 'db'
  if (p.includes('FLEX') || p === 'WRT' || p === 'WRTQ' || p === 'W/R') return 'flex'
  return 'other'
}

/**
 * "DEN @ SF · Sun 4:25p ET", as two pieces that each stay whole.
 *
 * ⚠ ON A PHONE THIS LINE NEVER FITS, SO THE QUESTION IS ONLY WHERE IT BREAKS. The
 * player column is ~112px at 375 and the whole line with weather is ~170, so it
 * wrapped wherever the text ran out — "WAS vs IND · Sun / 9:30a ET", the day
 * stranded from its time. Measured on the live page with this split: every row
 * reads "WAS vs IND" over "Sun 9:30a ET ☁ 61°" at the same 31px height, with no
 * overflow. Desktop keeps the one line and its separator (af-my-team.css).
 */
/**
 * "DEN vs MIA · Thu 10/1 8:15p ET". Built on the server (`formatKickoff` in myTeam.ts) with the
 * locale pinned so it hydrates, so the kickoff is translated here, at render — «jue 1/10 8:15p ET».
 * The team codes and "vs"/"@" read the same in Spanish.
 */
function GameContext({ text }: { text: string | null }) {
  const { language } = useOptionalLanguage()
  if (!text) return <>{language === 'es' ? 'no se encontró partido esta semana' : 'no game found for this week'}</>
  const at = text.indexOf(' · ')
  if (at < 0) return <>{kickoffText(text, language)}</>
  return (
    <>
      <span className="af-mt-opp">{text.slice(0, at)}</span>
      <span className="af-mt-sep"> · </span>
      <span className="af-mt-when">{kickoffText(text.slice(at + 3), language)}</span>
    </>
  )
}

/**
 * Where his game stands, in words a touch screen can read — not a `title` that only a mouse
 * ever sees.
 *
 * "Final" needs a final status; past kickoff with no fresh status says "Kicked off", never
 * "Final" (see `myTeamGameDay.ts`). Points are the platform's own, and appear only when a score
 * row is held — an ESPN league reads "Final" with no number rather than a guessed one.
 */
function GameDayChip({ day }: { day: NonNullable<LineupPlayer['gameDay']> }) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  if (day.state === 'upcoming') return null
  const label = day.state === 'final' ? copy('Final') : day.state === 'live' ? copy('Live') : copy('Kicked off')
  const pts = day.points != null ? `${day.points.toFixed(1)} ${copy('pts')}` : null
  const why =
    day.points == null
      ? copy('Points scored are not imported for this league yet.')
      : copy('Points as your platform scored them. Stat corrections can still move this.')
  return (
    <span className="af-mt-gameday" data-state={day.state} title={why}>
      <span className="af-mt-gameday-state">{label}</span>
      {pts ? <span className="af-mt-gameday-pts af-num">{pts}</span> : null}
    </span>
  )
}

/**
 * The week so far, over the starters: who has played and what they put up. The projected
 * totals above stay projections; this is the line that says some of the week is already in.
 */
function StarterGameDayLine({ summary }: { summary: NonNullable<MyTeamData['starterGameDay']> }) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const played = summary.final + summary.live + summary.started
  const parts = [
    summary.final ? `${summary.final} ${copy('final')}` : null,
    summary.live ? `${summary.live} ${copy('live')}` : null,
    summary.started ? `${summary.started} ${copy('kicked off')}` : null,
    summary.upcoming ? `${summary.upcoming} ${copy('to play')}` : null,
  ].filter(Boolean)
  const scored =
    summary.scored == null
      ? copy('points scored are not imported for this league yet')
      : `${summary.scored.toFixed(1)} ${copy('pts scored')}${
          summary.scoredCount < played ? ` (${summary.scoredCount} ${copy('of')} ${played})` : ''
        }`
  return (
    <p className="af-mt-gameday-line">
      <span className="af-label">{copy('This week so far')}</span> {parts.join(' · ')} · {scored}
    </p>
  )
}

/**
 * Weather, or the venue when there is no forecast yet.
 *
 * Two different statements, and they must not look alike: "roofed, so weather
 * cannot matter" is settled, while "open-air, and we have no forecast for a
 * game twelve days out" is a gap that will fill in. The forecast cron reaches
 * about a week ahead, so most of a preseason roster shows the second.
 */
function VenueMark({
  indoors,
  weather,
}: {
  indoors: boolean | null
  weather: LineupPlayer['weather']
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const es = language === 'es'
  if (weather?.indoors || indoors === true) {
    return (
      <span
        className="af-mt-venue"
        data-indoors="true"
        title={copy('Indoor or roofed stadium — weather is not a factor. Retractable roofs count as roofed; we do not track whether the roof is open.')}
        aria-label={copy('Indoor stadium')}
      >
        ⌂
      </span>
    )
  }

  if (weather && !weather.indoors) {
    const bits = [
      weather.temperatureF != null ? `${Math.round(weather.temperatureF)}°F` : null,
      weather.windSpeedMph != null && weather.windSpeedMph >= 8
        ? es ? `viento de ${Math.round(weather.windSpeedMph)} mph` : `${Math.round(weather.windSpeedMph)} mph wind`
        : null,
      weather.precipChancePct != null && weather.precipChancePct >= 20
        ? es ? `${Math.round(weather.precipChancePct)}% de lluvia` : `${Math.round(weather.precipChancePct)}% precip`
        : null,
      weather.conditionLabel,
    ].filter(Boolean)
    return (
      <span
        className="af-mt-venue"
        data-indoors="false"
        data-forecast="true"
        title={bits.join(' · ') || copy('Open-air stadium')}
        aria-label={bits.join(', ') || copy('Outdoor stadium')}
      >
        {weather.symbol}
        {weather.temperatureF != null ? (
          <span className="af-mt-temp af-num">{Math.round(weather.temperatureF)}°</span>
        ) : null}
      </span>
    )
  }

  if (indoors === false) {
    return (
      <span
        className="af-mt-venue"
        data-indoors="false"
        title={copy('Open-air stadium — no forecast yet for this kickoff')}
        aria-label={copy('Outdoor stadium, forecast not available yet')}
      >
        ☁
      </span>
    )
  }

  return null
}

/** "2nd", or «2.º» in Spanish — it sits inside Spanish sentences too ("terminó 2.º de 12"). */
function ordinal(n: number, es = false): string {
  if (es) return `${n}.º`
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/**
 * The line under the roster rank.
 *
 * ⚠ NO LETTER GRADE. This repo shipped a "C" trade grade that meant "we priced
 * nothing", and nobody could tell it apart from a considered verdict. A rank
 * names its comparison; a letter invents a scale and hides its inputs. When
 * coverage is partial that is stated here rather than folded into the number.
 */
function gradeSubtitle(g: RosterGrade, es = false): string {
  const parts: string[] = []
  const vsMedian = g.value - g.median
  parts.push(
    Math.abs(vsMedian) < g.median * 0.03
      ? es ? 'justo en la mediana de la liga' : 'right on the league median'
      : es
        ? `${Math.abs(vsMedian).toLocaleString('es')} ${vsMedian > 0 ? 'por encima' : 'por debajo'} de la mediana`
        : `${Math.abs(vsMedian).toLocaleString()} ${vsMedian > 0 ? 'above' : 'below'} the median`,
  )
  if (g.strongest) {
    parts.push(es
      ? `${g.strongest.position} es tu mejor posición (${ordinal(g.strongest.rank, true)})`
      : `${g.strongest.position} is your best (${ordinal(g.strongest.rank)})`)
  }
  if (g.weakest && g.weakest.position !== g.strongest?.position) {
    parts.push(es
      ? `${g.weakest.position} la más débil (${ordinal(g.weakest.rank, true)})`
      : `${g.weakest.position} your thinnest (${ordinal(g.weakest.rank)})`)
  }
  if (g.pricedPlayers < g.totalPlayers) {
    parts.push(es ? `valorados ${g.pricedPlayers} de tus ${g.totalPlayers}` : `priced ${g.pricedPlayers} of your ${g.totalPlayers}`)
  }
  /*
   * WHICH CLAIM THIS RANK IS MAKING. Repriced under your league's scoring is a
   * different and much stronger statement than a raw market ordering, and a
   * manager in a TE-premium or IDP league is entitled to know which one they
   * are reading. Both are honest; presenting them identically would not be.
   */
  parts.push(
    g.basis.leagueScored
      ? es ? 'valorado con tu puntuación' : 'valued under your scoring'
      : es ? 'precios de mercado, sin ajustar a tu puntuación' : 'market prices, not adjusted for your scoring',
  )
  return parts.join(' · ')
}

/**
 * Where your roster is deep and where it is thin, position by position, against THIS league.
 *
 * The header tile already names the two ends ("WR is your best (2nd)"); the ranks between them
 * were computed by `getRosterGrade` and thrown away. They are the part a manager uses to decide
 * what to trade from and what to trade for. Same values, same basis line as the tile.
 */
/** "Sep 28" in Eastern — the schedule's zone, and fixed so the server and client render alike. */
function shortDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(date)
}

const ACTIVITY_TAG: Record<string, string> = { trade: 'TRADE', waiver: 'CLAIM', roster_move: 'ADD/DROP' }

/**
 * Your own trades, claims and adds/drops in this league (`teamActivity.ts`). The league home has a
 * league-wide feed; this answers "what did I change?" without scanning everyone's moves for your
 * name. A bid shows only when the provider recorded one — null is unknown, never $0.
 */
function TeamActivityCard({ activity, myTeamName }: { activity: NonNullable<MyTeamData['teamActivity']>; myTeamName: string | null }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  return (
    <section className="af-frame af-mt-moves" aria-label={es ? 'Tus movimientos recientes' : 'Your recent moves'}>
      <h2 className="af-label">{es ? 'Tus movimientos recientes' : 'Your recent moves'}</h2>
      {activity.items.length === 0 ? (
        <p className="af-mt-moves-note">
          {es ? 'No hay movimientos tuyos en la actividad registrada.' : 'No moves by you in the activity we hold.'}
          {activity.feedNewest
            ? es
              ? ` Actividad de la liga registrada hasta el ${shortDate(activity.feedNewest)}.`
              : ` League activity on file through ${shortDate(activity.feedNewest)}.`
            : ''}
        </p>
      ) : (
        <ul className="af-mt-moves-list">
          {activity.items.map((m) => {
            const partners = m.kind === 'trade' ? m.involvedTeams.filter((t) => t !== myTeamName) : []
            return (
              <li key={m.id} data-kind={m.kind}>
                <div className="af-mt-moves-head">
                  <span className="af-mt-moves-tag">{ACTIVITY_TAG[m.kind] ?? m.kind}</span>
                  <span className="af-mt-moves-date af-num">{shortDate(m.occurredAt)}</span>
                  {partners.length ? (
                    <span className="af-mt-moves-meta">{es ? 'con' : 'with'} {partners.join(', ')}</span>
                  ) : null}
                  {m.bid != null ? <span className="af-mt-moves-bid af-num">${m.bid}</span> : null}
                </div>
                <div className="af-mt-moves-body">
                  {m.adds.map((p) => (
                    <span key={`a${p.id}`} className="af-mt-moves-add">+ {p.label}</span>
                  ))}
                  {m.drops.map((p) => (
                    <span key={`d${p.id}`} className="af-mt-moves-drop">− {p.label}</span>
                  ))}
                  {m.picks.map((pk) => (
                    <span key={`p${pk}`} className="af-mt-moves-meta">{pk}</span>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function PositionStrengthCard({ grade }: { grade: RosterGrade }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const positions = grade.positions ?? []
  return (
    <section className="af-frame af-mt-posstr" aria-label={es ? 'Fuerza por posición' : 'Positional strength'}>
      <h2 className="af-label">{es ? 'Fuerza por posición' : 'Positional strength'}</h2>
      <ul className="af-mt-posstr-list">
        {positions.map((p) => {
          // 1 of 12 fills the bar; 12 of 12 leaves a sliver, so last place is still visible.
          const pct = Math.max(4, Math.round(((p.outOf - p.rank + 1) / p.outOf) * 100))
          const tone = p.rank / p.outOf <= 1 / 3 ? 'good' : p.rank / p.outOf > 2 / 3 ? 'bad' : 'mid'
          return (
            <li key={p.position} data-tone={tone}>
              <span className="af-mt-posstr-pos af-num">{p.position}</span>
              <span className="af-mt-posstr-bar" aria-hidden>
                <span style={{ width: `${pct}%` }} />
              </span>
              <span className="af-mt-posstr-rank af-num">
                {ordinal(p.rank, es)} {es ? 'de' : 'of'} {p.outOf}
              </span>
              {p.median != null ? (
                <span className="af-mt-posstr-meta">
                  {p.value.toLocaleString()} {es ? 'vs mediana' : 'vs median'} {p.median.toLocaleString()}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
      <p className="af-mt-posstr-note">
        {grade.basis.leagueScored
          ? es
            ? 'Valor de plantilla con la puntuación de tu liga, contra los demás equipos de esta liga.'
            : 'Roster value priced under your league’s scoring, against the other teams in this league.'
          : es
            ? 'Valor de plantilla con precios de mercado PPR de 12 equipos, contra los demás equipos de esta liga.'
            : 'Roster value at 12-team PPR market prices, against the other teams in this league.'}
      </p>
    </section>
  )
}


/**
 * Your chance to win, from the shared forecast the Matchup screen and the all-leagues board use —
 * so this card can never say 70% beside a Matchup tab that says 55%. When the forecast declines it
 * says why, in the forecast's own words, instead of printing a number it does not stand behind.
 */
function WinForecast({ forecast }: { forecast: NonNullable<NextMatchup['forecast']> }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  if (!forecast.available) {
    return (
      <p className="af-mt-mu-win" data-available="false">
        {es ? 'Sin probabilidad de victoria' : 'No win probability'} — {myTeamCardReasonText(forecast.reason, language)}.
      </p>
    )
  }
  const pct = Math.round(forecast.pWin * 100)
  const margin = forecast.projectedMargin
  const marginText = `${margin >= 0 ? '+' : '−'}${Math.abs(margin).toFixed(1)}`
  return (
    <p className="af-mt-mu-win" data-available="true" data-favoured={pct >= 50}>
      <span className="af-mt-mu-win-pct af-num">{pct}%</span>{' '}
      {es ? 'probabilidad de ganar' : 'to win'}
      <span className="af-mt-mu-win-meta">
        {' · '}
        {es ? 'margen proyectado' : 'projected margin'} <span className="af-num">{marginText}</span>
        {' · '}
        {es ? 'confianza' : 'confidence'}{' '}
        {es
          ? ({ HIGH: 'alta', MEDIUM: 'media', LOW: 'baja', INSUFFICIENT: 'insuficiente' } as Record<string, string>)[forecast.confidence] ?? forecast.confidence
          : forecast.confidence.toLowerCase()}
      </span>
    </p>
  )
}

/** One side of the projected matchup. */
function MatchupSideView({ side, label }: { side: MatchupSide; label: string }) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  return (
    <div className="af-mt-mu-side">
      <div className="af-mt-mu-who">
        {side.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="af-mt-mu-av" src={side.avatarUrl} alt="" width={26} height={26} />
        ) : null}
        <div>
          <div className="af-mt-mu-name">{side.teamName ?? side.managerName ?? label}</div>
          {side.managerName && side.teamName ? (
            <div className="af-mt-mu-sub">{side.managerName}</div>
          ) : null}
        </div>
      </div>
      <div className="af-mt-mu-pts af-num">
        {side.projected != null ? side.projected.toFixed(1) : '—'}
      </div>
      {/* AllFantasy's own engine for the same lineup, beside the provider total. */}
      {side.afProjected != null ? (
        <div className="af-mt-mu-af af-num" title={copy("AllFantasy engine projection, adjusted to this league's scoring")}>
          AF {side.afProjected.toFixed(1)}
        </div>
      ) : null}
      {/*
        Coverage sits with the number, not in a footnote. A total built from
        five of nine starters always reads LOW, and a manager comparing two
        low-in-different-ways totals is being misled by the gap between them.
      */}
      {side.projected != null && side.projectedFrom < side.starterCount ? (
        <div className="af-mt-mu-cov">
          {language === 'es' ? `con ${side.projectedFrom} de ${side.starterCount}` : `from ${side.projectedFrom} of ${side.starterCount}`}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The one-line read on the matchup, or nothing.
 *
 * ⚠ SILENT WHEN EITHER SIDE IS PARTIALLY PRICED. A margin between two totals
 * built from different numbers of starters is not a margin, it is an artefact
 * of coverage — and "you are favoured by 12" is exactly the sentence someone
 * would act on.
 */
function edge(m: NextMatchup, bestBall: boolean, es = false): string | null {
  const you = m.you
  const them = m.opponent
  if (!them || you.projected == null || them.projected == null) return null
  if (you.projectedFrom < you.starterCount || them.projectedFrom < them.starterCount) return null

  const diff = Math.round((you.projected - them.projected) * 10) / 10
  const by = Math.abs(diff).toFixed(1)
  if (bestBall) {
    return es
      ? `Los titulares mostrados proyectan ${by} ${diff >= 0 ? 'a favor' : 'en contra'}; no incluye los reemplazos elegibles del banquillo de Best Ball.`
      : `Listed starters project ${by} ${diff >= 0 ? 'ahead' : 'behind'}; eligible Best Ball bench replacements are not included.`
  }
  if (Math.abs(diff) < 3) return es ? 'Proyección a menos de tres puntos: es una moneda al aire.' : 'Projected within three points — this is a coin flip.'
  return diff > 0
    ? es ? `Tienes una ventaja proyectada de ${by}.` : `You are projected ahead by ${by}.`
    : es ? `Tienes una desventaja proyectada de ${by}.` : `You are projected behind by ${by}.`
}

function PlayerCell({ player }: { player: LineupPlayer }) {
  const { language } = useOptionalLanguage()
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const [failedLogoUrls, setFailedLogoUrls] = useState<string[]>([])
  const imageUrl = player.imageUrl && player.imageUrl !== failedImageUrl ? player.imageUrl : null
  const registryLogoUrl = player.team ? teamLogoUrl(player.sport ?? 'NFL', player.team) : null
  const logoUrl = [player.logoUrl, registryLogoUrl].find((url) => url && !failedLogoUrls.includes(url)) || ''
  return (
    <div className="af-mt-player">
      {/*
        ONE MARK, NOT TWO. The crest used to sit beside the headshot as a
        separate image, costing a whole column and reading as two unrelated
        things. Overlapped at the corner it becomes one object -- the player,
        and who he plays for -- which is how every sports app does it.
      */}
      <span className="af-mt-portrait">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="af-mt-avatar" src={imageUrl} alt="" width={36} height={36} onError={() => setFailedImageUrl(imageUrl)} />
        ) : (
          <span className="af-mt-avatar af-mt-avatar--none" aria-hidden>
            {player.name.charAt(0)}
          </span>
        )}
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="af-mt-teamlogo"
            src={logoUrl}
            alt=""
            width={16}
            height={16}
            loading="lazy"
            onError={() => setFailedLogoUrls((urls) => [...urls, logoUrl])}
          />
        ) : null}
      </span>
      {/*
        The NFL team crest, beside the headshot. Two images that mean different
        things — who he is, and who he plays for — and the second is how a
        manager scanning sixteen rows finds the player they are thinking of.

        Sport is passed through rather than assumed: `teamLogoUrl` resolves a
        different CDN per sport and returns '' for one it does not know, which
        renders nothing rather than a broken image.
      */}
      <div className="af-mt-player-text">
        <div className="af-mt-player-name">
          {/*
            The name opens the player card (design handoff 2026-09-07, STATE 7).
            No `leagueId` prop: `PlayerCardLeagueScope` further down this file
            supplies it, so every name on this screen gets the LEAGUE flavour —
            who holds him here, this league's price, your roster at his position —
            without threading an id through PlayerCell and BenchRow.
          */}
          <PlayerName
            sport={player.sport ?? 'NFL'}
            sleeperId={player.sleeperId}
            name={player.name}
            position={player.position}
            team={player.team}
            imageUrl={player.imageUrl}
          />
          {/*
            ⚠ BESIDE THE NAME, NOT IN THE META LINE. A bye is the single most
            important fact about a player this week — it is the difference
            between a starter and a guaranteed zero — and buried on the second
            line next to a kickoff time it was being read last.
          */}
          {player.onBye ? (
            <span
              className="af-mt-bye"
              title={coreUiCopy('His team is not playing this week. A starter on bye is a guaranteed zero.', language)}
            >
              {language === 'es' ? 'DESCANSO' : 'BYE'}
            </span>
          ) : null}
        </div>
        <div className="af-mt-player-meta">
          <GameContext text={player.gameContext} />
          {/* A forecast for a game already under way or over answers nothing. */}
          {player.gameDay && player.gameDay.state !== 'upcoming' ? (
            <GameDayChip day={player.gameDay} />
          ) : (
            <VenueMark indoors={player.indoors} weather={player.weather} />
          )}
          {player.preseason ? (
            <span
              className="af-mt-pre"
              title="Preseason game. Starters usually play a series or two, so a projection here does not describe a fantasy week."
            >
              PRESEASON
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * The designation, in the shorthand managers actually use.
 *
 * THE FULL WORDS WERE THE WIDEST THING ON THE ROW. "NO DESIGNATION" is fourteen
 * characters carrying one bit of information, and it sat mid-row pushing every
 * number around it. Nobody says "questionable" out loud.
 *
 * The full word survives as the title and the aria-label, so nothing is lost
 * for anyone who does not know the shorthand or is using a screen reader.
 */
function abbreviate(status: string): { short: string; tone: string; full: string } {
  const t = status.trim().toLowerCase()
  if (t.includes('did not practice') || t === 'dnp') return { short: 'DNP', tone: 'warn', full: status }
  if (t.includes('injured reserve') || t === 'ir') return { short: 'IR', tone: 'bad', full: status }
  if (t.includes('suspend')) return { short: 'SUS', tone: 'bad', full: status }
  if (t.includes('pup')) return { short: 'PUP', tone: 'bad', full: status }
  if (t.includes('doubt')) return { short: 'D', tone: 'bad', full: status }
  if (t.includes('question')) return { short: 'Q', tone: 'warn', full: status }
  if (t.includes('out')) return { short: 'O', tone: 'bad', full: status }
  if (t.includes('probable')) return { short: 'P', tone: 'ok', full: status }
  /* ⚠ BEFORE 'active', WHICH IT CONTAINS. "Inactive" used to fall through to the
     line below and render as a green H for Healthy. */
  if (t.includes('inactive')) return { short: 'INA', tone: 'bad', full: status }
  if (t.includes('active') || t.includes('healthy')) return { short: 'H', tone: 'ok', full: 'Healthy' }
  /* An unfamiliar designation is shown as-is rather than given an invented
     letter, because a wrong abbreviation is worse than a long one. */
  return { short: status.slice(0, 3).toUpperCase(), tone: 'none', full: status }
}

/**
 * The status in Spanish, by its abbreviation — the same words as `RosterKey`. `full` is the
 * provider's own text ("Questionable"), so without this a screen reader said English in Spanish.
 * An unfamiliar designation keeps the provider's text, as `abbreviate` does.
 */
const STATUS_ES: Record<string, string> = {
  H: 'sano', Q: 'dudoso', D: 'poco probable', O: 'fuera', IR: 'reserva de lesionados', DNP: 'no entrenó',
  P: 'probable', SUS: 'suspendido', PUP: 'no apto físicamente', INA: 'inactivo',
}

function StatusChip({ status }: { status: string | null }) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  if (!status) {
    return (
      <span
        className="af-mt-status"
        data-tone="none"
        title={copy('No injury designation reported, which is not the same as confirmed healthy')}
      >
        &mdash;
      </span>
    )
  }
  const { short, tone, full: provider } = abbreviate(status)
  const full = language === 'es' ? STATUS_ES[short] ?? provider : provider
  return (
    <span className="af-mt-status" data-tone={tone} title={full} aria-label={full}>
      {short}
    </span>
  )
}

/**
 * The two projections, side by side.
 *
 * ⚠ THE EM DASH IS NOT DECORATION AND MUST NEVER BECOME "0.0" — except in the
 * one case where zero is a fact. Null means the feed does not carry this player;
 * zero means we expect him to score nothing. A player his league has ruled OUT
 * genuinely will score nothing, and `ruledOut` is how that case arrives here.
 * Every other absence stays an em dash.
 *
 * The AF column is the league-scored number. When it is missing but the generic
 * one is present, that is not a gap in the player's data — it means the league's
 * own scoring could not be applied, and the caveat under the roster says so.
 */
function Projections({ player }: { player: LineupPlayer }) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const fmt = (v: number | null) =>
    v == null ? <span className="af-mt-proj--none">&mdash;</span> : v.toFixed(1)
  const pct = (v: number | null | undefined) =>
    v == null ? <span className="af-mt-proj--none">&mdash;</span> : `${Math.round(v * 100)}%`

  return (
    <div className="af-mt-projpair">
      {/*
        ⚠ THE LEAGUE-SCORED NUMBER LEADS, and the order carries meaning. Generic
        PPR was first and full weight, so the most prominent figure on every row
        was the one scored for a league nobody is in — while the column that
        matches what the platform itself displays sat behind it. Measured on a
        real roster: ours 30.0 against Sleeper's 29.98; generic said 20.5.
      */}
      <span
        className="af-mt-proj af-mt-proj--af af-num"
        title={`${copy("Provider (Sleeper) projection scored under YOUR league's rules")}${
          player.projectedPoints != null ? ` · ${copy('standard PPR')} ${player.projectedPoints.toFixed(1)}` : ''
        }`}
      >
        {fmt(player.afProjectedPoints)}
      </span>
      {/*
        AllFantasy's own engine, beside the provider's number — the second opinion. It took the
        generic-PPR column's place: that figure is scored for a league nobody is in, and it is
        still in the first cell's title for anyone comparing against the raw feed.
      */}
      <span
        className="af-mt-proj af-mt-proj--engine af-num"
        title={copy("AllFantasy's own projection engine, adjusted to your league's scoring")}
      >
        {fmt(player.afEngineProjectedPoints ?? null)}
      </span>
      {/*
        OWN and START are the app's own market, read from every roster we hold.
        They replaced a "share" column that divided this player's projection by
        his own team's total — a real number answering a question nobody asked.
      */}
      <span
        className="af-mt-share af-num"
        title={copy('Share of AllFantasy leagues rostering this player')}
      >
        {pct(player.market?.ownPct)}
      </span>
      <span
        className="af-mt-share af-num"
        title={copy('Of the leagues that roster him, how many are starting him this week. Byes and injuries move this on their own.')}
      >
        {pct(player.market?.startPct)}
      </span>
    </div>
  )
}

/**
 * What the two projection columns are, in sentences a manager can act on.
 *
 * ⚠ THE COLUMN WAS "API", AND THE OLD SENTENCE CREDITED SLEEPER WITH IDP SCORING. "API" named
 * nothing a manager recognises, and Sleeper's projection has no defensive line at all — in an IDP
 * league the defenders are priced by AllFantasy's own IDP model. Named now, and the defender case
 * said out loud. See `projectionProvider.ts` for the census behind the name.
 */
const AF_PTS_EXPLAINER =
  'SLEEPER is Sleeper’s own projection, re-scored under YOUR league’s settings — your reception ' +
  'value, TE premium and passing-TD value. Sleeper projects no defensive stats, so in an IDP league ' +
  'defenders are priced by AllFantasy’s IDP model instead. ' +
  'AF is AllFantasy’s own projection engine, adjusted to the same settings.'

/** The matchup card's two figures per side. The AF line explained itself only by a hover title. */
const MATCHUP_NUMBERS_EXPLAINER =
  'The large number is Sleeper’s projection for each lineup, re-scored under your league’s settings. ' +
  'AF beneath it is AllFantasy’s own engine on the same lineup and the same settings.'
const MATCHUP_COVERAGE_EXPLAINER =
  '“from 5 of 9” means only five starters have a projection yet, so that total reads low.'

/** The two market columns' headings, per language — one source for the header and the key. */
export const MARKET_COLUMN_LABELS = {
  en: { own: 'OWN', start: 'START' },
  es: { own: 'PROP.', start: 'TIT.' },
} as const

/** What OWN and START are — the two market columns the explainer used to leave to a hover title. */
const MARKET_COLUMNS_EXPLAINER =
  'OWN is the share of AllFantasy leagues that roster him. START is, of those leagues, how many ' +
  'start him this week — byes and injuries move it on their own. Both show on wide screens.'

function ProjHeader() {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  return (
    <div className="af-mt-projhead">
      {/*
        No `title` on this heading: the popover is its descendant, and a title here would pop a
        second, hover-only copy of the same text over the popover itself.
      */}
      <span className="af-label af-mt-projhead--af">
        {PROJECTION_PROVIDER_LABEL}
        {/*
          The question mark is the point: two numbers sitting side by side with
          no explanation reads as a bug, not a feature.

          ⚠ IT WAS A `span role="img"` WITH A TOOLTIP — the one explanation of the page's two
          numbers, and nothing could OPEN it but a mouse hovering a 12px circle. Not focusable,
          not tappable (audit 2026-10-02). Now the shared `InfoTip`, which keeps its popover inside
          its own wrapper — so the narrow page's `nth-child` rules still hide OWN and START, not AF.
          It explains all four columns: one "?" per header, never one per row.
        */}
        <InfoTip label={copy('What Sleeper, AF, OWN and START mean')} title={copy('What these columns mean')}>
          <span className="af-info-para">{copy(AF_PTS_EXPLAINER)}</span>
          <span className="af-info-para">{copy(MARKET_COLUMNS_EXPLAINER)}</span>
        </InfoTip>
      </span>
      <span className="af-label af-mt-projhead--engine" title={copy("AllFantasy's own projection engine, adjusted to your league's scoring")}>
        AF
      </span>
      {/*
        «PROP.» (propiedad) and «TIT.» (titular) in Spanish — the abbreviations Spanish fantasy
        sites use for "% owned" / "% started". ⚠ MEASURED TO FIT, not guessed: these columns are
        44px and 46px, and on production at 1280px «TIENEN» needed 48px, «TITUL.» 48 and «TITULAR»
        55 (2026-10-03). The "?" above and the key below spell both out.
      */}
      <span className="af-label" title={copy('Share of AllFantasy leagues rostering this player')}>
        {MARKET_COLUMN_LABELS[language === 'es' ? 'es' : 'en'].own}
      </span>
      <span
        className="af-label"
        title={copy('Of the leagues rostering him, how many start him this week')}
      >
        {MARKET_COLUMN_LABELS[language === 'es' ? 'es' : 'en'].start}
      </span>
    </div>
  )
}

/**
 * What every abbreviation on the roster means, in visible text.
 *
 * ⚠ A TOUCH SCREEN NEVER SHOWS A `title`. The status letters (H, Q, D, O, IR, DNP), the em dash,
 * the venue marks and the API / AF / OWN / START headings were each explained only by a hover
 * tooltip — which is to say, on a phone and an iPad, not at all (audit 2026-10-02). Collapsed by
 * default so it costs one line; the definitions reuse this file's own explainer strings, so the
 * key cannot drift from the tooltips it stands in for.
 */
function RosterKey() {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const es = language === 'es'
  const items: Array<[string, string]> = es
    ? [
        ['H', 'sano'], ['Q', 'dudoso'], ['D', 'poco probable'], ['O', 'fuera'], ['IR', 'reserva de lesionados'],
        ['DNP', 'no entrenó'], ['—', 'sin designación reportada, que no es lo mismo que confirmado sano'],
        ['⌂', 'estadio techado: el clima no cuenta'], ['☀ ☁', 'pronóstico al inicio del partido'],
      ]
    : [
        ['H', 'healthy'], ['Q', 'questionable'], ['D', 'doubtful'], ['O', 'out'], ['IR', 'injured reserve'],
        ['DNP', 'did not practice'], ['—', 'no designation reported, which is not the same as confirmed healthy'],
        ['⌂', 'roofed stadium: weather is not a factor'], ['☀ ☁', 'forecast at kickoff'],
      ]
  return (
    <details className="af-mt-key">
      <summary>{es ? 'Qué significan las abreviaturas' : 'What the abbreviations mean'}</summary>
      <dl>
        {items.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div>
          <dt>{PROJECTION_PROVIDER_LABEL} · AF</dt>
          <dd>{copy(AF_PTS_EXPLAINER)}</dd>
        </div>
        <div>
          <dt>{MARKET_COLUMN_LABELS[es ? 'es' : 'en'].own} · {MARKET_COLUMN_LABELS[es ? 'es' : 'en'].start}</dt>
          <dd>
            {es
              ? 'propiedad y titular: cuántas ligas de AllFantasy lo tienen, y de esas cuántas lo alinean esta semana (en pantallas anchas)'
              : 'how many AllFantasy leagues roster him, and of those how many start him this week (wide screens)'}
          </dd>
        </div>
      </dl>
    </details>
  )
}

/**
 * The bench check, joined under the starter it is about.
 *
 * ⚠ IT RENDERS FOR BOTH VERDICTS ON PURPOSE. A strip that only ever appears
 * when you are wrong teaches people to read its ABSENCE as "nothing to see" —
 * when absence actually means "nobody eligible outprojects him", which is a
 * different and much weaker statement than "we checked and he is the play".
 * Saying so out loud is the whole value of running the check every week.
 */
const CHECK_TAG: Record<LineupCheckItem['kind'], string> = { out: 'OUT', bye: 'BYE', empty: 'EMPTY', swap: 'SWAP', questionable: 'Q' }
/** The same tags in Spanish — Q stays Q, as in the abbreviation key. */
const CHECK_TAG_ES: Record<LineupCheckItem['kind'], string> = { out: 'FUERA', bye: 'DESCANSO', empty: 'VACÍO', swap: 'CAMBIO', questionable: 'Q' }

/**
 * Draft capital and lineup age, side by side — the two facts that decide a dynasty team's next
 * three seasons, which this page never showed. See `dynastyOutlook.ts`. Each half degrades on its
 * own: no picks synced says so, no ages on file says so, neither hides the other.
 */
function DynastyCard({ outlook }: { outlook: NonNullable<MyTeamData['dynasty']> }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const { picks, ages } = outlook
  return (
    <section className="af-frame af-mt-dynasty" aria-label={es ? 'Panorama dinastía' : 'Dynasty outlook'}>
      <h2 className="af-label">{es ? 'Panorama dinastía' : 'Dynasty outlook'}</h2>

      <h3 className="af-mt-dynasty-h">{es ? 'Selecciones de draft' : 'Draft capital'}</h3>
      {picks.available ? (
        picks.bySeason.length === 0 ? (
          <p className="af-mt-dynasty-note">{es ? 'No tienes selecciones en los próximos drafts.' : 'You hold no picks in the upcoming drafts.'}</p>
        ) : (
          <>
            <ul className="af-mt-dynasty-picks">
              {picks.bySeason.map((s) => (
                <li key={s.season}>
                  <span className="af-mt-dynasty-season af-num">{s.season}</span>
                  <span className="af-mt-dynasty-list">
                    {s.picks
                      .map((p) => (p.fromTeamName ? `${p.label} (${es ? 'vía' : 'via'} ${myTeamReasonText(p.fromTeamName, language)})` : p.label))
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
            {picks.coverage === 'traded_only' ? (
              <p className="af-mt-dynasty-note">
                {es
                  ? 'Solo se listan las selecciones que cambiaron de manos: el tamaño del draft de esta liga no está registrado.'
                  : 'Only picks that changed hands are listed — this league’s draft size is not on file.'}
              </p>
            ) : null}
          </>
        )
      ) : (
        <p className="af-mt-dynasty-note">{myTeamReasonText(picks.reason, language)}.</p>
      )}

      <h3 className="af-mt-dynasty-h">{es ? 'Edad de la alineación' : 'Lineup age'}</h3>
      {ages.available ? (
        <>
          <p className="af-mt-dynasty-line">
            {es ? 'Edad mediana de titulares' : 'Starters’ median age'}{' '}
            <span className="af-num af-mt-dynasty-num">{ages.medianStarterAge}</span>
            {ages.known < ages.total ? (
              <span className="af-mt-dynasty-note"> ({ages.known} {es ? 'de' : 'of'} {ages.total} {es ? 'con edad registrada' : 'with an age on file'})</span>
            ) : null}
            {' · '}
            <span className="af-num">{ages.youngCore}</span> {es ? 'jugadores de 24 años o menos' : 'players 24 or younger'}
          </p>
          {ages.aging.length === 0 ? (
            <p className="af-mt-dynasty-note">
              {es ? 'Ningún titular ha pasado la edad en que su posición suele declinar.' : 'No starter is past the age his position usually declines.'}
            </p>
          ) : (
            <ul className="af-mt-dynasty-aging">
              {ages.aging.map((a) => (
                <li key={a.sleeperId}>
                  <span className="af-mt-dynasty-name">{a.name}</span>{' '}
                  <span className="af-mt-dynasty-note">
                    {a.position} · {a.age} — {es ? `los ${a.position} suelen declinar desde los ${a.threshold}` : `${a.position}s usually decline from ${a.threshold}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="af-mt-dynasty-note">{myTeamReasonText(ages.reason, language)}.</p>
      )}
    </section>
  )
}

/** What `/api/idp/players?view=waiver-board` returns, as far as this card reads it. */
type WaiverBoardPayload = {
  state: string
  candidates: Array<{
    sleeperId: string | null
    name: string
    position: string | null
    team: string | null
    projectedPoints: number
    gain: number
    displaces: { name: string } | null
  }>
}

/**
 * Free agents who would START for you this week, when the roster has a hole nobody on the bench
 * fills — the one case the bench check cannot answer.
 *
 * ⚠ FETCHED ONLY THEN, AND AFTER RENDER. The waiver board reads the league's free-agent pool and
 * prices it; doing that inside My Team's server render would slow every visit to fix a case most
 * visits do not have. The OUT and bye starters are sent as `unavailable` so the board prices each
 * add against the hole, not against a ruled-out player's leftover projection.
 *
 * Ranked by the board's own rule (gain to your best lineup), and linked to the league's Waivers
 * screen, which carries bids, priority and the run clock.
 */
function FreeAgentFill({ check, leagueId }: { check: LineupCheck; leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const holes = check.items.filter((i) => (i.kind === 'out' || i.kind === 'bye' || i.kind === 'empty') && !i.replacement)
  const unavailable = check.items
    .filter((i) => (i.kind === 'out' || i.kind === 'bye') && i.playerId)
    .map((i) => i.playerId as string)
  const key = holes.length > 0 ? `${leagueId}|${unavailable.join(',')}` : null
  const [board, setBoard] = useState<{ key: string; data: WaiverBoardPayload | null } | null>(null)
  useEffect(() => {
    if (!key) return
    let live = true
    const qs = new URLSearchParams({ leagueId, view: 'waiver-board', limit: '3' })
    if (unavailable.length) qs.set('unavailable', unavailable.join(','))
    fetch(`/api/idp/players?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: WaiverBoardPayload | null) => {
        if (live) setBoard({ key, data })
      })
      .catch(() => {
        if (live) setBoard({ key, data: null })
      })
    return () => {
      live = false
    }
    // `unavailable` is folded into `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, leagueId])
  if (!key) return null
  const waiversHref = `/core/waivers?league=${encodeURIComponent(leagueId)}`
  const current = board?.key === key ? board : null
  const picks = current?.data?.state === 'ok' ? current.data.candidates : []
  return (
    <div className="af-mt-check-fa" aria-live="polite">
      <span className="af-label">{es ? 'Agentes libres que entrarían' : 'Free agents who would start'}</span>
      {!current ? (
        <p className="af-mt-check-fa-note">{es ? 'Revisando agentes libres…' : 'Checking free agents…'}</p>
      ) : picks.length === 0 ? (
        <p className="af-mt-check-fa-note">
          {es ? 'Ningún agente libre mejora tu alineación esta semana.' : 'No free agent improves your lineup this week.'}
        </p>
      ) : (
        <ul className="af-mt-check-fa-list">
          {picks.map((c) => (
            <li key={c.sleeperId ?? c.name}>
              <span className="af-mt-check-fa-name">{c.name}</span>
              <span className="af-mt-check-fa-meta">
                {[c.position, c.team].filter(Boolean).join(' · ')}
              </span>
              <span className="af-mt-check-fa-gain af-num">+{c.gain.toFixed(1)} pts</span>
              {c.displaces ? (
                <span className="af-mt-check-fa-meta">
                  {es ? `reemplaza a ${c.displaces.name}` : `replaces ${c.displaces.name}`}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Link className="af-mt-check-fa-link" href={waiversHref}>
        {es ? 'Ver todas las altas, ofertas y prioridad' : 'See every add, bids and priority'}
      </Link>
    </div>
  )
}

function checkLine(item: LineupCheckItem, es: boolean): string {
  const r = item.replacement
  const pts = (n: number) => n.toFixed(1)
  const start = r ? (es ? ` — revisa a ${r.name} (${pts(r.projected)})` : ` — review ${r.name} (${pts(r.projected)})`) : es ? ' — busca un reemplazo' : ' — find a replacement'
  switch (item.kind) {
    case 'out':
      return (es ? `${item.name} está descartado` : `${item.name} is ruled out`) + start
    case 'bye':
      return (es ? `${item.name} descansa esta semana` : `${item.name} is on bye`) + start
    case 'empty':
      return es ? `El puesto ${item.slotLabel} está vacío` : `${item.slotLabel} is empty`
    case 'swap':
      return es
        ? `Compara a ${r!.name} con ${item.name} (+${pts(r!.gain ?? 0)})`
        : `Compare ${r!.name} with ${item.name} (+${pts(r!.gain ?? 0)})`
    case 'questionable':
      return es ? `${item.name} es duda — ten un suplente listo` : `${item.name} is questionable — have a backup ready`
  }
}

/**
 * The roster's verdict, above the roster. Every line links to its row; the rows keep their own
 * detail (and the bench check strip keeps its Chimmy question). See `lineupCheck.ts`.
 */
function LineupCheckCard({ check, platform, fixHref, leagueId }: { check: LineupCheck; platform: string; fixHref: string | null; leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const certain = check.items.some((i) => i.kind !== 'questionable')
  const lockedNote = check.locked
    ? es
      ? ` ${check.locked} ${check.locked === 1 ? 'titular ya llegó al inicio del partido' : 'titulares ya llegaron al inicio del partido'}.`
      : ` ${check.locked} ${check.locked === 1 ? 'starter has' : 'starters have'} reached kickoff; confirm individual locks on your platform.`
    : ''
  return (
    <section className="af-frame af-mt-check" aria-label={es ? 'Revisión de alineación' : 'Lineup check'} data-clear={check.items.length === 0 && !check.unresolved}>
      <h2 className="af-label">{es ? 'Revisión de alineación' : 'Lineup check'}</h2>
      {check.unresolved ? <p role="status">{es ? `${check.unresolved} puesto(s) ocupado(s) no pudieron revisarse porque no identificamos al jugador.` : `${check.unresolved} filled slot(s) could not be checked because the player identity is unresolved.`}</p> : null}
      <p className="af-mt-footnote">{es ? 'Estas son opciones para revisar. Confirma elegibilidad, cierres y AutoSubs en tu plataforma antes de cambiar la alineación.' : 'These are candidates for review. Confirm eligibility, locks, and AutoSubs on your platform before changing the lineup.'}</p>
      {check.items.length === 0 ? (
        <p className="af-mt-check-clear">
          {es
            ? `No se identificaron problemas entre los titulares que pudimos revisar. Confirma las noticias y las reglas en tu plataforma.`
            : `No issues were identified among the starters we could check. Confirm current news and rules on your platform.`}
          {lockedNote}
        </p>
      ) : (
        <>
          <ul className="af-mt-check-list">
            {check.items.map((item) => (
              <li key={`${item.kind}-${item.anchor}`} data-kind={item.kind}>
                <a href={`#${item.anchor}`} className="af-mt-check-item">
                  <span className="af-mt-check-tag">{(es ? CHECK_TAG_ES : CHECK_TAG)[item.kind]}</span>
                  <span className="af-mt-check-slot af-num">{item.slotLabel}</span>
                  <span className="af-mt-check-text">{checkLine(item, es)}</span>
                </a>
              </li>
            ))}
          </ul>
          {lockedNote ? <p className="af-mt-check-locked">{lockedNote.trim()}</p> : null}
          <FreeAgentFill check={check} leagueId={leagueId} />
          {certain && fixHref ? (
            <a className="af-btn af-mt-check-fix" href={fixHref} target="_blank" rel="noopener noreferrer">
              {es ? `Corregir en ${platform}` : `Fix in ${platform}`}
            </a>
          ) : null}
        </>
      )}
    </section>
  )
}

function BenchCheckStrip({ check, leagueId }: { check: BenchCheck; leagueId: string }) {
  const gap = check.benchProjected - check.starterProjected
  const es = useOptionalLanguage().language === 'es'
  return (
    <div className="af-mt-bench-check" data-verdict={check.verdict}>
      <span className="af-label af-mt-bench-check-tag">{es ? 'Revisión del banquillo' : 'Bench check'}</span>
      <span className="af-mt-bench-check-text">
        {es ? (
          /* The same two numbers and the same threshold, in Spanish word order. */
          <>
            <strong>{check.benchName}</strong> (suplente) proyecta{' '}
            <span className="af-num">{check.benchProjected.toFixed(1)}</span> frente a los{' '}
            <span className="af-num">{check.starterProjected.toFixed(1)}</span> de {check.starterName}
            {check.verdict === 'swap'
              ? ': la mejor opción esta semana.'
              : `: dentro del margen de ${BENCH_SWAP_POINTS} puntos que estas proyecciones pueden distinguir, así que tu titular está bien así.`}
          </>
        ) : check.verdict === 'swap' ? (
          <>
            <strong>{check.benchName}</strong> (bench) projects{' '}
            <span className="af-num">{check.benchProjected.toFixed(1)}</span> against{' '}
            {check.starterName}&rsquo;s{' '}
            <span className="af-num">{check.starterProjected.toFixed(1)}</span> — the stronger
            play this week.
          </>
        ) : (
          <>
            {/*
              ⚠ NAMES THE GAP AND THE THRESHOLD. "Too close to call" with no
              numbers reads as a hedge; with them it is a statement the reader
              can check, and can disagree with.
            */}
            <strong>{check.benchName}</strong> (bench) projects{' '}
            <span className="af-num">{check.benchProjected.toFixed(1)}</span> against{' '}
            {check.starterName}&rsquo;s{' '}
            <span className="af-num">{check.starterProjected.toFixed(1)}</span> — inside the{' '}
            {BENCH_SWAP_POINTS}-point margin these projections can actually tell apart, so your
            starter is fine as-is.
          </>
        )}
      </span>
      <button type="button" className="af-mt-bench-ask" onClick={() => window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail: {
        tab: 'chimmy', leagueId,
        // No internal system names in text the user sends as their own question — see
        // LineupIntelligenceActions for the same correction.
        // In the reader's language too: it lands in their own composer as the question they send.
        prefill: es
          ? `¿Debería poner de titular a ${check.benchName} en lugar de ${check.starterName} en esta liga? Compara las proyecciones con la puntuación de la liga, lesiones, elegibilidad de posición y cierres por inicio de partido.`
          : `Should I start ${check.benchName} instead of ${check.starterName} in this league? Compare league-scored projections, injuries, positional eligibility and kickoff locks.`,
      } }))}>{es ? 'Preguntar a Chimmy por este cambio' : 'Ask Chimmy about this swap'}</button>
      <span className="af-mt-bench-caveat">
        {es
          ? 'Comparación de proyecciones · confirma lesiones, cierres por inicio y cambios automáticos en tu plataforma.'
          : 'Projection comparison · confirm injury updates, kickoff locks and AutoSubs on your platform.'}
      </span>
    </div>
  )
}

function SlotRow({
  slot,
  platform,
  leagueId,
  sourceLink,
  anchor,
  automatic,
  sourceHref,
}: {
  slot: LineupSlot
  automatic?: boolean
  sourceHref?: string
  anchor?: string
  platform: string
  leagueId: string
  sourceLink: MyTeamData['league']['sourceLink']
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  return (
    /*
      ⚠ A STARTER ON BYE IS TREATED LIKE AN EMPTY SLOT, because it is one — a
      guaranteed zero in a slot the manager still has time to fill. The empty
      state was already the loudest thing on the row; this is the same problem
      wearing a name.
    */
    <li id={anchor} className="af-mt-row" data-empty={slot.empty} data-bye={slot.player?.onBye === true} data-game={slot.player?.gameDay?.state}>
      <span className="af-mt-slot af-num" data-pos={posGroup(slot.slotLabel)}>
        {slot.slotLabel}
      </span>

      {slot.player ? (
        <>
          <PlayerCell player={slot.player} />
          <StatusChip status={slot.player.injuryStatus} />
          <Projections player={slot.player} />
        </>
      ) : slot.unresolvedId ? (
        <div className="af-mt-player af-mt-unresolved">
          <div>
            <div className="af-mt-player-name">Player we could not identify</div>
            <div className="af-mt-player-meta">
              This slot is filled, but id {slot.unresolvedId} does not match any player we hold.
            </div>
          </div>
        </div>
      ) : (
        <>
          {/*
            ⚠ THE BUTTON BELONGS INSIDE THIS CELL — af-my-team.css is written for exactly that ("a
            flex row holding the 'Empty' text block and this button"). Rendered as the cell's
            SIBLING it became a loose grid item, auto-placed into the 34–46px slot-badge column:
            measured 34px wide with its label overflowing by 26px at 375, 23 at 768, 20 at 1280.
          */}
          <div className="af-mt-player af-mt-empty-text">
            <div>
              <div className="af-mt-player-name">{copy('Empty')}</div>
              <div className="af-mt-player-meta">{copy('Nobody is starting in this slot')}</div>
            </div>
            {/*
              ⚠ NO LINK IS BETTER THAN THE WRONG ONE. With no platform link on file (a native
              league) this fell back to /core/sync, which re-imports a league and fixes nothing
              about an empty slot. Said in words instead, as the lock banner already does.
            */}
            {automatic ? null : sourceHref ? (
              <Link href={sourceHref} className="af-btn af-mt-fix">
                Fix in {platform}
              </Link>
            ) : (
              <span className="af-mt-player-meta af-mt-fix-none">Fill it where your league sets lineups — there is no platform link on file.</span>
            )}
          </div>
        </>
      )}

      {/*
        ⚠ SPANS FROM COLUMN 2, NOT COLUMN 1. This list is a TABLE, not the stack
        of separately-bordered cards the handoff draws, so the design's
        "joined box" treatment does not translate literally. Starting under the
        player rather than under the slot gutter is what makes it read as
        attached to THIS row in a table layout.
      */}
      {slot.benchCheck ? <BenchCheckStrip check={slot.benchCheck} leagueId={leagueId} /> : null}
    </li>
  )
}

/** A bench, IR or taxi row — every one priced, same as a starter. */
function BenchRow({
  player,
  slotLabel,
  trailing,
}: {
  player: LineupPlayer
  slotLabel: string
  trailing?: React.ReactNode
}) {
  return (
    <li id={`lineup-player-${player.sleeperId}`} className="af-mt-row" data-game={player.gameDay?.state}>
      <span
        className="af-mt-slot af-num"
        data-pos={posGroup(player.position ?? slotLabel)}
      >
        {slotLabel}
      </span>
      <PlayerCell player={player} />
      <StatusChip status={player.injuryStatus} />
      {/*
        Bench players carry no lineup share on purpose — they contribute nothing
        to the projected starting total, and printing "0%" beside them would
        read as a judgement on the player rather than a fact about the lineup.
      */}
      <Projections player={player} />
      {trailing}
    </li>
  )
}

/**
 * How many taxi years are left, or an honest silence.
 *
 * "1 year left of 2", not "1 of 2 year left": the noun agrees with the count beside it. The old
 * order pluralised on the remaining years but printed the noun after the limit, so it read wrong
 * every time the two differed (audit, 2026-10-02, live on KBFL).
 */
function TaxiYears({ tenure }: { tenure: TaxiTenure | null }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  if (!tenure) {
    return (
      <span
        className="af-mt-taxi-years af-mt-taxi-years--none"
        title={es
          ? 'Hace falta el límite de años de taxi de la liga y su historial de plantillas a fin de temporada. Falta uno de los dos, así que no vamos a adivinar.'
          : "This needs the league's taxi-year limit and its season-end roster history. One of them is missing, so we are not going to guess."}
      >
        {es ? 'años restantes desconocidos' : 'years left unknown'}
      </span>
    )
  }
  const n = tenure.yearsRemaining
  return (
    <span className="af-mt-taxi-years af-num" data-last={n <= 1}>
      {n === 0
        ? es ? 'sin años de taxi' : 'no taxi years left'
        : es
          ? `${n === 1 ? 'queda 1 año' : `quedan ${n} años`} de ${tenure.yearsAllowed}`
          : `${n} ${n === 1 ? 'year' : 'years'} left of ${tenure.yearsAllowed}`}
    </span>
  )
}

/**
 * My Team between seasons: pre-draft, season complete, or eliminated.
 *
 * WHY. These three states used to end on a bare page — an unstyled league name, one sentence and a
 * link — while the loader had already computed the team's record, its roster value against the
 * league, its draft capital and its recent moves. A dynasty manager spends half the year here, and
 * the page had nothing to say to them. Same loader, same cards as the in-season screen; only the
 * weekly lineup machinery (lock, matchup, starters) is left out, because there is no week.
 *
 * The headline and sentence are unchanged (their Spanish copy already exists).
 */
function OffseasonView({ data }: MyTeamProps) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const es = language === 'es'
  const id = encodeURIComponent(data.league.id)
  const dynasty = data.dynasty != null || String(data.league.format ?? '').toLowerCase() === 'dynasty'
  const phase = data.preDraft ? 'predraft' : data.eliminated ? 'eliminated' : 'complete'
  /*
   * ⚠ OPTIONAL-CHAINED ON PURPOSE. The type marks these sections required, but the loader's early
   * returns (no claimed team, no roster) omit `rosterGrade` and friends — and the off-season is
   * exactly when a league is most often unclaimed. The in-season view never reaches here.
   */
  const team = data.team?.available ? data.team.data : null
  const grade = data.rosterGrade?.available ? data.rosterGrade.data : null
  /*
   * Rank only with a record behind it — before a scored game it is import order (see the in-season
   * header). A finished season's rank is the final standing, which is worth saying.
   */
  const standing = team && team.recordKnown
    ? `${team.record}${team.rank != null && phase === 'complete' ? (es ? ` · terminó ${ordinal(team.rank, true)} de ${team.teamCount}` : ` · finished ${ordinal(team.rank)} of ${team.teamCount}`) : ''}`
    : null
  const actions: Array<{ href: string; label: string; primary?: boolean }> = []
  if (phase === 'predraft') actions.push({ href: `/core/draft-hq?league=${id}`, label: es ? 'Abrir Draft HQ' : 'Open Draft HQ', primary: true })
  if (phase !== 'predraft' && dynasty) {
    actions.push({ href: `/core/draft-hq?league=${id}`, label: es ? 'Planear el draft de novatos' : 'Plan your rookie draft', primary: true })
    actions.push({ href: `/core/trades?league=${id}`, label: es ? 'Centro de intercambios' : 'Trade center' })
  }
  actions.push({ href: `/core?league=${id}`, label: copy('Open league overview'), primary: actions.length === 0 })
  const showStrength = grade != null && (grade.positions?.length ?? 0) > 1
  return (
    <div className="af-mt af-mt-off" data-phase={phase}>
      <section className="af-frame af-mt-off-hero">
        <span className="af-label">{data.league.name}</span>
        <h1 className="af-display af-mt-off-title">
          {copy(data.preDraft ? 'Draft pending' : data.eliminated ? 'Team eliminated' : 'Season complete')}
        </h1>
        <p className="af-mt-off-lead">
          {copy(data.preDraft ? 'This league has not finished its draft. Empty roster slots do not need a lineup fix yet.' : data.eliminated ? 'This team is no longer competing. Empty roster slots do not need a lineup fix.' : 'This season has finished. There are no active weekly lineup tasks.')}
        </p>
        {team ? (
          <p className="af-mt-off-team">
            <span className="af-mt-off-team-name">{team.teamName}</span>
            {standing ? <span className="af-mt-off-team-meta af-num"> · {standing}</span> : null}
            {grade ? (
              <span className="af-mt-off-team-meta">
                {' · '}
                {es ? 'valor de plantilla' : 'roster value'} {ordinal(grade.rank, es)} {es ? 'de' : 'of'} {grade.outOf}
              </span>
            ) : null}
          </p>
        ) : null}
        <nav className="af-mt-off-actions" aria-label={es ? 'Siguientes pasos' : 'Next steps'}>
          {actions.map((a) => (
            <a key={a.href + a.label} className={a.primary ? 'af-btn' : 'af-btn af-btn--ghost'} href={a.href}>
              {a.label}
            </a>
          ))}
        </nav>
      </section>
      <div className="af-mt-body">
        <div className="af-mt-main">
          {data.dynasty ? <DynastyCard outlook={data.dynasty} /> : null}
          {showStrength && grade ? <PositionStrengthCard grade={grade} /> : null}
        </div>
        <div className="af-mt-aside">
          {data.teamActivity ? <TeamActivityCard activity={data.teamActivity} myTeamName={team?.teamName ?? null} /> : null}
        </div>
      </div>
    </div>
  )
}

type WeekProjection = Extract<MyTeamData['projections'], { available: true }>['data']

/** Per-viewer convenience only: a cleared or blocked store just means "collapsed". */
const COMPARE_KEY = 'af-mt-compare'

/**
 * The week's projected total — ONE number, with the others one tap away.
 *
 * ⚠ THREE PROJECTIONS IN A ROW WAS TOO MANY (audit 2026-10-02). The header carried the provider's
 * total re-scored for this league (Sleeper's — labelled "API" until 2026-10-03), AllFantasy's
 * engine on the same starters (AF) and the generic standard total, at equal weight, beside the
 * record and the roster value — five slabs, three of them the same question. A manager wants one
 * answer; the comparison is for the one who asks for it. So the league-scored Sleeper total leads
 * (the same number the roster's accent column
 * carries, row by row), and AF and standard sit behind "Compare".
 *
 * ⚠ HIDDEN, NOT UNMOUNTED. The collapsed tiles stay in the DOM with `hidden`, so `aria-controls`
 * always names real elements and the comparison is one toggle away rather than a re-render.
 *
 * The choice is remembered per browser — someone who always compares should not click every
 * time — and read after mount, because the server cannot see it and first paint must match.
 * No button at all when there is nothing to compare against.
 */
function ProjectionTiles({ proj, bestBall }: { proj: WeekProjection | null; bestBall: boolean }) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const es = language === 'es'
  const [compare, setCompare] = useState(false)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COMPARE_KEY) === '1') setCompare(true)
    } catch { /* blocked store — collapsed */ }
  }, [])
  const toggle = () => {
    setCompare((open) => {
      try {
        window.localStorage.setItem(COMPARE_KEY, open ? '0' : '1')
      } catch { /* the choice still holds for this page */ }
      return !open
    })
  }
  const engineId = useId()
  const standardId = useId()
  const canCompare = proj != null && (proj.afEngineTotal != null || proj.standardComparable)

  return (
    <div className="af-mt-projgroup" data-compare={compare ? 'true' : 'false'}>
      <div className="af-mt-tile af-mt-tile--proj af-mt-tile--af af-mt-tile--lead">
        <div className="af-mt-tile-value af-num">
          {proj?.afTotal != null ? proj.afTotal.toFixed(1) : '—'}
        </div>
        {/*
          Named for who made it. In an IDP league the total is Sleeper's offence plus AllFantasy's
          IDP model for the defenders, and the label says both rather than crediting Sleeper with
          numbers Sleeper never published.
        */}
        <div className="af-label">
          {copy(
            proj?.defendersModelled
              ? bestBall ? 'Listed starters · Sleeper + AF IDP · your league' : 'Projected · Sleeper + AF IDP · your league'
              : bestBall ? 'Listed starters · Sleeper · your league' : 'Projected · Sleeper · your league',
          )}
        </div>
        {canCompare ? (
          <button
            type="button"
            className="af-mt-compare-btn"
            aria-expanded={compare}
            aria-controls={`${engineId} ${standardId}`}
            onClick={toggle}
          >
            {compare ? (es ? 'Ocultar comparación' : 'Hide comparison') : (es ? 'Comparar proyecciones' : 'Compare projections')}
          </button>
        ) : null}
      </div>
      {/*
        AllFantasy's own engine over the same starters — the second projection, at
        the same weight as the provider's so neither reads as the footnote once shown.
      */}
      <div id={engineId} hidden={!compare} className="af-mt-tile af-mt-tile--proj af-mt-tile--af af-mt-tile--engine">
        <div className="af-mt-tile-value af-num">
          {proj?.afEngineTotal != null ? proj.afEngineTotal.toFixed(1) : '—'}
        </div>
        <div className="af-label">{copy(bestBall ? 'Listed starters · AF · your league' : 'Projected · AF · your league')}</div>
      </div>
      {/*
        ⚠ WITHHELD WHEN IT IS NOT COMPARABLE. In an IDP league the
        generic line does not score defenders, so this total covers only
        the offensive half of the lineup — 53.0 sitting beside a league
        total of 166.7, two numbers that look like a pair and are
        measured over different players.
      */}
      <div
        id={standardId}
        hidden={!compare}
        className="af-mt-tile af-mt-tile--proj"
        data-missing={proj ? !proj.standardComparable : undefined}
      >
        <div className="af-mt-tile-value af-num">
          {proj && proj.standardComparable ? proj.total.toFixed(1) : '—'}
        </div>
        <div className="af-label">{copy(bestBall ? 'Listed starters · standard' : 'Projected · standard')}</div>
        {proj && !proj.standardComparable ? (
          <div className="af-mt-tile-why">
            {copy('Standard scoring does not price defenders, so there is no like-for-like total in an IDP league.')}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function MyTeam({ data }: MyTeamProps) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const es = language === 'es'
  const [decisionNow, setDecisionNow] = useState(() => data.lock?.available ? data.lock.data.asOf ?? Date.now() : Date.now())
  useEffect(() => {
    setDecisionNow(Date.now())
    const timer = setInterval(() => setDecisionNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  // A streamed roster can arrive after the browser's native fragment lookup.
  // Re-check on mount/hash changes, never on routine lineup refreshes.
  useEffect(() => {
    let highlighted: HTMLElement | null = null
    const reveal = () => {
      highlighted?.removeAttribute('data-lineup-target')
      highlighted = null
      const id = window.location.hash.slice(1)
      if (!/^lineup-(player|slot)-[a-zA-Z0-9_-]+$/.test(id)) return
      const row = document.getElementById(id)
      if (!row?.classList.contains('af-mt-row')) return
      highlighted = row
      row.setAttribute('data-lineup-target', 'true')
      row.scrollIntoView({ block: 'center' })
    }
    reveal()
    window.addEventListener('hashchange', reveal)
    return () => {
      window.removeEventListener('hashchange', reveal)
      highlighted?.removeAttribute('data-lineup-target')
    }
  }, [data.league.id])

  // "Sleeper", not "sleeper": the raw id read as a typo in "Fix in sleeper" and "Lineup from sleeper".
  const platform = data.league.platform === 'manual' ? copy('your platform') : platformLabel(data.league.platform)
  const bestBall = data.bestBall === true || data.league.bestBall === true

  if (data.preDraft || data.eliminated || data.completed) return <OffseasonView data={data} />


  const proj = data.projections.available ? data.projections.data : null
  const { slot: decisionSlot, started: decisionStarted, replacementStarted, delta: leagueDelta } = lineupDecision(
    data.starters.available ? data.starters.data : [],
    data.bench.available ? data.bench.data : [],
    decisionNow,
  )



  /*
   * The per-lineup "share" helper lived here and has been DELETED, not merely
   * unused. It divided a player's projection by his own team's total, which is
   * a real number answering a question nobody asked — and left in place it
   * would invite someone to wire it back beside OWN and START, where two
   * different meanings of "share" would sit in adjacent columns.
   *
   * What replaced it is app-wide: see lib/core-app/rosteredMarket.ts.
   */

  function askChimmy() {
    window.dispatchEvent(
      new CustomEvent(COMMS_OPEN_EVENT, {
        detail: {
          tab: 'chimmy',
          leagueId: data.league.id,
          prefill: buildProjectionQuestion(data.league.name, proj?.week ?? null),
        },
      }),
    )
  }

  return (
    /*
      Every player name inside this screen belongs to THIS league, so the
      card opens in its league flavour. One wrap instead of a `leagueId`
      prop threaded through PlayerCell, BenchRow and three call sites —
      which is the version somebody silently half-applies.
    */
    <PlayerCardLeagueScope leagueId={data.league.id}>
    <div className="af-mt">
      <header className="af-frame af-mt-head">
        {data.team.available ? (
          <>
            {data.team.data.managerAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="af-mt-crest af-mt-crest--photo"
                src={data.team.data.managerAvatarUrl}
                alt=""
                width={48}
                height={48}
              />
            ) : (
              <div className="af-mt-crest" aria-hidden>
                {data.team.data.teamName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="af-mt-head-text">
              <h1 className="af-display af-mt-team-name">{data.team.data.teamName}</h1>
              <div className="af-mt-head-meta">
                {/* The manager's name was imported from day one and never shown. */}
                {data.team.data.ownerName} · {data.league.name}
                {/*
                  ⚠ A RANK BEFORE A SCORED GAME IS IMPORT ORDER. Every team is 0-0, so "3 of 12"
                  in preseason (or a guillotine week 1) printed the importer's row order as a
                  standing. Shown only once the record is.
                */}
                {data.team.data.rank != null && data.team.data.recordKnown
                  ? ` · ${data.team.data.rank} ${es ? 'de' : 'of'} ${data.team.data.teamCount}`
                  : ` · ${data.team.data.teamCount} ${es ? 'equipos' : 'teams'}`}
              </div>
            </div>

            {/*
              ⚠ WHERE THE BENCH CHECK ACTUALLY GETS ACTED ON. This screen can
              tell you the wrong player is starting; it can never fix it, because
              AllFantasy does not write lineups for an imported league. Without
              this the advice has nowhere to go. Resolved server-side through the
              one hardened resolver, and absent entirely for a native league.
            */}
            {data.league.sourceLink && !bestBall ? (
              <SourceActionLink
                link={data.league.sourceLink}
                className="af-btn af-mt-source"
              />
            ) : null}

            {/*
        ⚠ ABOVE THE ROSTER AND ABOVE THE TOTALS, because it explains BOTH — the
        nameless rows AND the absent bench advice. The bench check skips any
        player it cannot price, so on a league whose ids do not resolve it runs,
        finds nothing, and says nothing; that silence would otherwise read as
        "your lineup is fine".
      */}
      {data.identityNote ? (
        <p className="af-mt-identity-gap">{data.identityNote}</p>
      ) : null}

      {/* ── Both weekly totals, at the top where they belong ──── */}
            <div className="af-mt-tiles">
              {/*
                THE TWO TOTALS ARE ONE COMPARISON, NOT TWO FACTS, so they share a
                frame. As four equal slabs in a row nothing said which number
                applies to the reader, and the whole reason both are here is that
                they differ. Your league's total leads at full size; standard
                sits beside it, smaller, as the thing being compared against.
              */}
              <ProjectionTiles proj={proj} bestBall={bestBall} />
              {/*
                ⚠ THE ABSENT RECORD IS PROSE AND MUST NOT SIT IN THE VALUE SLOT.
                `af-mt-tile-value` is a 24px tabular figure; the preseason string
                went in there and rendered as the largest thing on the screen,
                wrapping across three lines of a numeric slab and shoving the
                roster-value tile onto its own row. Same treatment as the
                unavailable roster grade below: an em dash, and the reason under
                it in the caption.
              */}
              <div className="af-mt-tile" data-missing={!data.team.data.recordKnown || undefined}>
                <div className="af-mt-tile-value af-num">
                  {data.team.data.recordKnown ? data.team.data.record : '—'}
                </div>
                <div className="af-label">{copy('Record')}</div>
                {data.team.data.recordKnown ? null : (
                  <div className="af-mt-tile-why">{data.team.data.record}</div>
                )}
              </div>
              {data.rosterGrade.available ? (
                <div className="af-mt-tile af-mt-tile--grade">
                  <div className="af-mt-tile-value af-num">
                    {ordinal(data.rosterGrade.data.rank, language === 'es')}
                    <span className="af-mt-grade-of"> {copy('of')} {data.rosterGrade.data.outOf}</span>
                  </div>
                  <div className="af-label">{copy('Roster value in this league')}</div>
                  <div className="af-mt-tile-why">
                    {gradeSubtitle(data.rosterGrade.data, language === 'es')}
                  </div>
                </div>
              ) : (
                <div className="af-mt-tile" data-missing="true">
                  <div className="af-mt-tile-value af-num">—</div>
                  <div className="af-label">{copy('Roster value')}</div>
                  <div className="af-mt-tile-why">{myTeamReasonText(data.rosterGrade.reason, language)}</div>
                </div>
              )}
            </div>
          </>
        ) : (
          <Unavailable reason={data.team.reason} />
        )}
      </header>

      {platform.toLowerCase() === 'sleeper' && <LineupVerification verification={data.lineupVerification} />}
      {/* ── Lock banner ─────────────────────────────────────────────── */}
      {bestBall ? <div className="af-mt-lock" data-urgent={false}>
        <span className="af-label af-mt-lock-label">{copy('Best Ball · automatic lineup')}</span>
        <span className="af-mt-lock-note">{copy('Your provider selects the scoring lineup. Review injuries and roster depth; manual start/sit swaps are not needed.')}</span>
      </div> : data.lock.available ? (
        data.lock.data.daysAway >= DISTANT_LOCK_DAYS ? (
          /*
            ⚠ A LOCK MORE THAN A WEEK OUT IS A COVERAGE GAP, NOT A DEADLINE, and
            counting down to it is how this banner spent weeks pointing at a
            November game. Saying so is more useful than a large number.
          */
          <div className="af-mt-lock" data-urgent={false} data-locked={false}>
            <span className="af-label af-mt-lock-label">{copy('Lineup lock')}</span>
            <span className="af-mt-lock-note">
              {language === 'es'
                ? `El próximo partido registrado de tus titulares es en ${data.lock.data.daysAway} días${data.lock.data.week != null ? ` (semana ${data.lock.data.week})` : ''}. Es demasiado pronto para una hora de cierre; probablemente aún falta el calendario de esta semana.`
                : `The next game we hold for your starters is ${data.lock.data.daysAway} days away${data.lock.data.week != null ? ` (week ${data.lock.data.week})` : ''}. That is further out than a lineup lock should be, so this week's schedule probably has not been ingested yet rather than your lineup being safe for ${data.lock.data.daysAway} days.`}
            </span>
          </div>
        ) : (
          <LockCountdown
            at={new Date(data.lock.data.at)}
            anyEmptySlot={data.lock.data.anyEmptySlot}
            platform={platform}
            fixHref={data.league.sourceLink?.href ?? null}
            week={data.lock.data.week}
            daysAway={data.lock.data.daysAway}
            next={data.lock.data.next}
            asOf={data.lock.data.asOf}
          />
        )
      ) : (
        <div className="af-mt-lock" data-urgent={false} data-locked={false}>
          <span className="af-label af-mt-lock-label">{copy('Lineup lock')}</span>
          <span className="af-mt-lock-note">{myTeamReasonText(data.lock.reason, language)}</span>
        </div>
      )}

      {!bestBall ? (
        <section className="af-frame af-mt-decision" aria-labelledby="af-mt-decision-title">
          <div>
            <span className="af-label">{copy('Lineup decision')}</span>
            <h2 id="af-mt-decision-title">
              {decisionStarted
                ? (language === 'es' ? `Revisa el cierre de ${decisionSlot?.player?.name}` : `Review ${decisionSlot?.player?.name}'s lock`)
                : decisionSlot?.empty
                ? es ? `Cubre tu posición ${decisionSlot.slotLabel}` : `Fill your ${decisionSlot.slotLabel} slot`
                : decisionSlot?.player?.ruledOut
                  ? es ? `Reemplaza a ${decisionSlot.player.name}` : `Replace ${decisionSlot.player.name}`
                  : decisionSlot?.player?.onBye
                    ? es ? `Cubre la semana de descanso de ${decisionSlot.player.name}` : `Cover ${decisionSlot.player.name}'s bye`
                    : decisionSlot?.benchCheck?.verdict === 'swap'
                      ? es
                        ? `Revisa ${decisionSlot.benchCheck.starterName} frente a ${decisionSlot.benchCheck.benchName}`
                        : `Review ${decisionSlot.benchCheck.starterName} vs ${decisionSlot.benchCheck.benchName}`
                      : copy('Review your starting lineup')}
            </h2>
            <p>
              {decisionStarted || replacementStarted
                ? (language === 'es'
                  ? 'El partido del titular o de la opción de banca ya comenzó. Confirma los cierres y AutoSubs en tu plataforma; este aviso no garantiza que puedas cambiar la alineación.'
                  : 'The starter or bench option has already reached kickoff. Confirm locks and AutoSubs on your platform; this notice does not establish that a lineup change is allowed.')
                : decisionSlot?.empty
                ? copy('This starting slot was empty when checked. Confirm the current lineup, eligibility, locks, and AutoSubs on your platform.')
                : decisionSlot?.player?.ruledOut || decisionSlot?.player?.onBye
                  ? es
                    ? `${decisionSlot.player.name} está ${decisionSlot.player.onBye ? 'en semana de descanso' : 'descartado'}. Revisa la elegibilidad del reemplazo, los cierres individuales y los cambios automáticos en tu plataforma.`
                    : `${decisionSlot.player.name} is ${decisionSlot.player.onBye ? 'on a bye' : 'ruled out'}. Review replacement eligibility, individual locks, and AutoSubs on your platform.`
                  : decisionSlot?.benchCheck?.verdict === 'swap'
                    ? leagueDelta != null && leagueDelta > 0
                      ? es
                        ? `${decisionSlot.benchCheck.benchName} proyecta ${leagueDelta.toFixed(1)} puntos más con la puntuación de esta liga. Confirma primero su estado de lesión y su elegibilidad.`
                        : `${decisionSlot.benchCheck.benchName} projects ${leagueDelta.toFixed(1)} more points under this league's scoring. Confirm injury status and eligibility first.`
                      : leagueDelta != null
                        ? (language === 'es'
                          ? 'La puntuación de esta liga no favorece la opción de banca. No se recomienda un cambio con estas proyecciones.'
                          : "This league's scoring does not favor the bench option. These projections do not support a swap.")
                        : (language === 'es'
                          ? 'La comparación sugiere una revisión, pero no se pudo confirmar la identidad o las proyecciones de esta liga. Actualiza antes de considerar un cambio.'
                          : 'The bench check suggests a review, but the player identity or league-scored values could not be confirmed. Refresh before considering a swap.')
                    : data.starters.available
                      ? copy('No empty, out, or bye slot was identified among the players we could read. Unresolved players and missing news may hide issues; confirm the lineup on your platform.')
                      : myTeamReasonText(data.starters.reason, language)}
            </p>
            <small>
              {proj
                ? es
                  ? `Semana ${proj.week} · ${proj.afProjected} de ${proj.projected + proj.unprojected} titulares valorados para esta liga`
                  : `Week ${proj.week} · ${proj.afProjected} of ${proj.projected + proj.unprojected} starters priced for this league`
                : copy('Projection coverage unavailable')}
            </small>
          </div>
          <div className="af-mt-decision-actions">
            <a className="af-btn af-btn--ghost" href="#af-mt-starters">{copy('Review starters')}</a>
            {data.league.sourceLink ? <SourceActionLink link={data.league.sourceLink} className="af-btn" /> : null}
          </div>
        </section>
      ) : null}


      <TeamRosterWorkspace data={data} />
     {/* ── Team header ─────────────────────────────────────────────── */}


      {/*
        ⚠ TWO COLUMNS FROM ONE DOM, NOT TWO LAYOUTS. Wide: the roster is the main column and
        the matchup, byes and scoring basis sit beside it, so a 1000px screen stops putting 480px
        between a name and its numbers. Narrow: both wrappers are display:contents, the page is
        one column again, and byes + basis move BELOW the roster (CSS order) — on a 375px phone they
        were 479px standing between the lock banner and the first starter. af-my-team.css, "Layout pass".
      */}
      <div className="af-mt-body">
      <div className="af-mt-aside">
      {/* ── Who you play, projected ─────────────────────────────────── */}
      {/*
        ⚠ THIS IS WHERE "POINTS FOR / AGAINST" USED TO BE. Those were the
        season's running totals — 0-0 for every team in the league until a game
        is scored — so the two most prominent numbers on the screen were em
        dashes for the entire preseason. What a manager wants in that window is
        not the points they have scored; it is the points they are about to.
      */}
      {data.nextMatchup.available ? (
        <section className="af-frame af-mt-matchup">
          <div className="af-mt-mu-head">
            <h2 className="af-label">
              {copy('Week')} {data.nextMatchup.data.week} · {copy(bestBall ? 'listed starter projections' : 'projected matchup')}
              {/*
                One "?" for the card, not one per side: both sides carry the same two numbers. Only
                when there ARE numbers — explaining two dashes is noise.
              */}
              {data.nextMatchup.data.you.projected != null ? (
                <InfoTip label={copy('What the matchup numbers mean')} title={copy('The two numbers')}>
                  <span className="af-info-para">{copy(MATCHUP_NUMBERS_EXPLAINER)}</span>
                  <span className="af-info-para">{copy(MATCHUP_COVERAGE_EXPLAINER)}</span>
                </InfoTip>
              ) : null}
            </h2>
            {data.nextMatchup.data.bye ? (
              <span className="af-mt-mu-bye">{copy('no opponent recorded — bye')}</span>
            ) : null}
          </div>
          <div className="af-mt-mu-body">
            <MatchupSideView side={data.nextMatchup.data.you} label={copy('You')} />
            <span className="af-mt-mu-v" aria-hidden>
              v
            </span>
            {data.nextMatchup.data.opponent ? (
              <MatchupSideView side={data.nextMatchup.data.opponent} label={copy('Them')} />
            ) : (
              <div className="af-mt-mu-side af-mt-mu-side--none">
                <div className="af-mt-mu-name">{copy('Opponent not set')}</div>
                <div className="af-mt-mu-sub">
                  {copy('The league recorded this week without pairing teams.')}
                </div>
              </div>
            )}
          </div>
          {edge(data.nextMatchup.data, bestBall) ? (
            <p className="af-mt-mu-edge">{edge(data.nextMatchup.data, bestBall, language === 'es')}</p>
          ) : data.nextMatchup.data.unpricedReason ? (
            // Two dashes and nothing else read as a broken screen; say why, where the read goes.
            <p className="af-mt-mu-edge">
              {copy('No projected totals')} — {myTeamCardReasonText(data.nextMatchup.data.unpricedReason, language)}.
            </p>
          ) : null}
          {data.nextMatchup.data.forecast ? <WinForecast forecast={data.nextMatchup.data.forecast} /> : null}
        </section>
      ) : (
        <p className="af-mt-footnote">{myTeamCardReasonText(data.nextMatchup.reason, language)}</p>
      )}

      {/* ── Byes forming ────────────────────────────────────────────── */}
      {/*
        Shown ahead of time on purpose. Discovering in week 6 that four
        starters share a week 7 bye is discovering it after the waiver wire has
        been picked over.
      */}
      {data.upcomingByes.length > 0 ? (
        <section className="af-frame af-mt-byes">
          <h2 className="af-label">{copy('Byes coming up')}</h2>
          <ul className="af-mt-byes-list">
            {data.upcomingByes.map((b) => (
              <li key={b.week} data-stack={b.names.length >= 3}>
                <span className="af-mt-byes-wk af-num">{copy('Week')} {b.week}</span>
                <span className="af-mt-byes-who">
                  {b.names.length} {copy('off')} · {b.names.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Why the two numbers differ ──────────────────────────────── */}
      {proj ? (
        <section className="af-frame af-mt-basis">
          <div className="af-mt-basis-text">
            {data.projectionBasis.scoringKnown ? (
              data.projectionBasis.notes.length > 0 ? (
                <>
                  <p className="af-mt-basis-lead">
                    {copy('Your league scores differently from the standard projection:')}
                  </p>
                  <ul className="af-mt-basis-list">
                    {data.projectionBasis.notes.map((n) => (
                      <li key={n}>{scoringNoteText(n, language)}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="af-mt-basis-lead">
                  {copy('Your league uses standard PPR scoring, so both numbers should agree. Where they do not, it is because we could not score a player under your rules.')}
                </p>
              )
            ) : (
              <p className="af-mt-basis-lead">
                {copy('We do not hold this league’s scoring settings, so there is no league-specific projection to show — only the standard one.')}
              </p>
            )}
            {proj.afTotal != null && proj.afProjected < proj.projected ? (
              <p className="af-mt-basis-cov">
                {language === 'es'
                  ? `El total de tu liga incluye ${proj.afProjected} de ${proj.projected} titulares con proyección, así que puede parecer bajo frente al estándar.`
                  : `Your league’s total is built from ${proj.afProjected} of ${proj.projected} priced starters, so it reads low next to the standard one.`}
              </p>
            ) : null}
          </div>
          <button type="button" className="af-btn af-mt-ask" onClick={askChimmy}>
            {copy('Ask Chimmy why they differ')}
          </button>
        </section>
      ) : null}

      {/* ── Positional strength: every position, not only the two ends ─ */}
      {data.rosterGrade.available && (data.rosterGrade.data.positions?.length ?? 0) > 1 ? (
        <PositionStrengthCard grade={data.rosterGrade.data} />
      ) : null}

      {/* ── Your recent moves in this league ─────────────────────────── */}
      {data.teamActivity ? <TeamActivityCard activity={data.teamActivity} myTeamName={data.team.available ? data.team.data.teamName : null} /> : null}

      {/* ── Dynasty outlook: the next three seasons, not this week ────── */}
      {data.dynasty ? <DynastyCard outlook={data.dynasty} /> : null}

      </div>
      <div className="af-mt-main">
      {/* ── Lineup check: the whole roster's verdict in one place ─────── */}
      {!bestBall && data.starters.available ? (
        <LineupCheckCard
          check={summariseLineupCheck(data.starters.data, decisionNow)}
          platform={platform}
          leagueId={data.league.id}
          fixHref={data.league.sourceLink?.href ?? null}
        />
      ) : null}
      {/* ── Starters ────────────────────────────────────────────────── */}
      <section id="af-mt-starters" className="af-frame af-mt-section">
        <header className="af-mt-section-head">
          <h2 className="af-label">{copy('Starters')}</h2>
          <span className="af-mt-section-note">
            {data.nativeLineup ? (language === 'es' ? 'Liga nativa AllFantasy. Guarda cambios válidos en Decisiones de plantilla; se aplican las reglas y cierres del servidor.' : 'Native AllFantasy lineup. Save eligible changes in Roster decisions; server rules and locks apply.') : bestBall
              ? language === 'es' ? `Plantilla Best Ball de ${platform}. Los titulares elegibles se seleccionan automáticamente.` : `Best Ball roster from ${platform}. Scoring selects your eligible starters automatically.`
              : language === 'es' ? `Alineación de ${platform}. Para cambiarla, abre ${platform}; AllFantasy solo la consulta.` : `Lineup from ${platform}. To change it, open ${platform} — AllFantasy only reads.`}
          </span>
          <ProjHeader />
        </header>
        <RosterKey />

        {data.starterGameDay ? <StarterGameDayLine summary={data.starterGameDay} /> : null}

        {data.starters.available ? (
          <ul className="af-mt-list">
            {data.starters.data.map((slot, i) => (
              <SlotRow
                key={`${slot.slotLabel}-${i}`}
                anchor={slot.player ? `lineup-player-${slot.player.sleeperId}` : `lineup-slot-${i}`}
                slot={slot}
                automatic={bestBall}
                sourceHref={data.league.sourceLink?.href}
                platform={platform}
                leagueId={data.league.id}
                sourceLink={data.league.sourceLink}
              />
            ))}
          </ul>
        ) : (
          <Unavailable reason={data.starters.reason} />
        )}
      </section>

      {/* ── Bench ───────────────────────────────────────────────────── */}
      <section className="af-frame af-mt-section">
        <header className="af-mt-section-head">
          <h2 className="af-label">{copy('Bench')}</h2>
          <ProjHeader />
        </header>
        {data.bench.available ? (
          <>
            <ul className="af-mt-list">
              {data.bench.data.map((p) => (
                <BenchRow key={p.sleeperId} player={p} slotLabel="BN" />
              ))}
            </ul>
            <UnidentifiedNote count={data.unidentified?.bench ?? 0} />
          </>
        ) : (
          <Unavailable reason={data.bench.reason} />
        )}
      </section>

      {/* ── Injured reserve ─────────────────────────────────────────── */}
      {data.ir.available ? (
        <section className="af-frame af-mt-section">
          <header className="af-mt-section-head">
            <h2 className="af-label">{copy('Injured reserve')}</h2>
          </header>
          <ul className="af-mt-list">
            {data.ir.data.map((p) => (
              <BenchRow key={p.sleeperId} player={p} slotLabel="IR" />
            ))}
          </ul>
          <UnidentifiedNote count={data.unidentified?.ir ?? 0} />
        </section>
      ) : null}

      {/* ── Taxi squad ──────────────────────────────────────────────── */}
      {/*
        ⚠ SEPARATE FROM IR ON PURPOSE. These were one list and every row in it
        was labelled "IR", which says a healthy taxi rookie is injured.
      */}
      {data.taxi.available ? (
        <section className="af-frame af-mt-section">
          <header className="af-mt-section-head">
            <h2 className="af-label">{copy('Taxi squad')}</h2>
            <span className="af-mt-section-note">
              {copy('Not eligible to start. Years left counts season-end rosters against your league’s taxi limit.')}
            </span>
          </header>
          <ul className="af-mt-list">
            {data.taxi.data.map((p) => (
              <BenchRow
                key={p.sleeperId}
                player={p}
                slotLabel="TAXI"
                trailing={<TaxiYears tenure={p.tenure} />}
              />
            ))}
          </ul>
          <UnidentifiedNote count={data.unidentified?.taxi ?? 0} />
        </section>
      ) : null}

      {/* ── Coverage footnote ───────────────────────────────────────── */}
      {/*
        ⚠ NO STANDARD-COVERAGE LINE WHERE THERE IS NO STANDARD TOTAL. In an IDP
        league the standard tile reads "—" and explains why, but this footnote
        still said "Standard total built from 7 of 16 starters … so it reads low"
        — a total the page had just declined to show, and a count inflated by
        every defender standard scoring cannot price. The tile carries the
        explanation; the footnote stays out of it.
      */}
      {data.projections.available && !data.projections.data.standardComparable && data.projections.data.unprojected > 0 ? null : data.projections.available ? (
        <p className="af-mt-footnote">
          {data.projections.data.unprojected === 0
            ? language === 'es' ? `Los ${data.projections.data.projected} titulares tienen proyección · ${data.projections.data.season}, semana ${data.projections.data.week}` : `All ${data.projections.data.projected} starters projected · ${data.projections.data.season} week ${data.projections.data.week}`
            : language === 'es' ? `Total estándar calculado con ${data.projections.data.projected} de ${data.projections.data.projected + data.projections.data.unprojected} titulares; ${data.projections.data.unprojected} sin proyección, así que puede parecer bajo.` : `Standard total built from ${data.projections.data.projected} of ${
                data.projections.data.projected + data.projections.data.unprojected
              } starters — ${data.projections.data.unprojected} ${
                data.projections.data.unprojected === 1 ? 'has' : 'have'
              } no projection on file, so it reads low.`}
        </p>
      ) : (
        <p className="af-mt-footnote">
          {copy('Projections are not shown because')} {myTeamReasonText(data.projections.reason, language)}.
        </p>
      )}
      </div>
      </div>
    </div>
    </PlayerCardLeagueScope>
  )
}

export default MyTeam
