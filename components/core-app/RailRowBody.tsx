'use client'

import type { ReactNode } from 'react'
import { CommissionerBadge } from '@/components/core-app/CommissionerBadge'
import { LeagueMark } from '@/components/core-app/LeagueMark'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { PROJECTION_PROVIDER_LABEL } from '@/lib/core-app/projectionProvider'
import type { RailMatchupSummary, RailSideProjectionSummary, RailStandingSummary } from './AfCoreShell'
import type { LiveRailScore } from './useLiveRailScores'
import type { RailGuillotineLine } from '@/lib/core-app/railGuillotineLine'

/**
 * The expanded body of one league row in the league rail: name, freshness, the
 * live-score status, and this week's head-to-head (both teams, score, SLPR and AF
 * projections) or, with no opponent, where you sit against the field.
 *
 * ⚠ ONE IMPLEMENTATION, TWO SHELLS. This lived inline in `AfCoreShell`'s rail, and
 * the /league/[leagueId] workspace drew its own rail of two-letter chips with none
 * of it (user report, 2026-10-18: "the league list doesn't show the whole league
 * list with the current score, projection, league name, manager names"). Both
 * rails now render this, so a fix to how a score or a projection reads lands in
 * both at once rather than drifting into two opinions.
 */

/**
 * The row's matchup: the server snapshot, overlaid with the live poll when one
 * has arrived. Moved verbatim from the core rail. Projections survive only for
 * the same week (and, for the opponent, the same opponent), because the live
 * route carries scores and never projections.
 */
export function mergeRailMatchup(
  saved: RailMatchupSummary | null | undefined,
  live: LiveRailScore | null | undefined,
): RailMatchupSummary | null | undefined {
  if (!live) return saved
  const sameWeek = saved?.season === live.season && saved?.week === live.week
  const fieldRace = saved?.standing?.elimination === true
  const standing = fieldRace ? live.fieldStanding : live.standing
  /* A native row is read from the database with its own projection and its own data stamp. */
  if (live.native) {
    return { ...live, freshAt: live.freshAt ?? null, source: 'live_cache' as const }
  }
  return {
    ...live,
    freshAt: live.updatedAt,
    source: 'live_cache' as const,
    unpaired: fieldRace || live.unpaired,
    yourProjection: sameWeek ? saved?.yourProjection : null,
    opponentProjection: sameWeek && saved?.opponentTeam === live.opponentTeam ? saved?.opponentProjection : null,
    standing: standing ? { ...standing, elimination: fieldRace || standing.elimination } : null,
  }
}

/**
 * One team in a rail row: their platform avatar, their name, their score, and
 * the two projected totals under it.
 *
 * ⚠ THE AVATAR IS THE MANAGER'S, NOT THE LEAGUE'S. The league crest is already
 * the 42px mark at the head of the row; repeating it here would say nothing. The
 * loader resolves both sides' `avatarUrl` through `managerArtUrl` — Sleeper
 * stores an avatar *id* where other platforms store a link, and 85 of this
 * account's 94 claimed teams have one.
 *
 * ⚠ AND THE INITIAL IS `Array.from`, NOT `slice`. A team name starting with an
 * emoji sliced mid-surrogate serialises differently on server and client and
 * takes hydration down — the same trap the profile mark in the rail foot
 * carries a note about, and half this account's league names begin with 🪓.
 */
function RailSide({
  name,
  avatarUrl,
  score,
  projection,
  them,
}: {
  name: string
  avatarUrl: string | null
  /** Null while the fixture is unplayed, which draws a dash rather than 0.0. */
  score: number | null
  projection: RailSideProjectionSummary | null
  them?: boolean
}) {
  const { language } = useOptionalLanguage()
  const initial = (Array.from(name.trim() || '•')[0] ?? '•').toUpperCase()
  /*
   * ⚠ `pricedFrom > 0` MATTERS: a side where NOTHING priced already draws a dash,
   * and marking that dash as partial rendered it as a dotted "⋯" that read like a
   * third state. Partial means "some of the lineup", which is the only case the
   * mark has anything to add.
   */
  const partial =
    projection != null &&
    projection.pricedFrom > 0 &&
    projection.pricedFrom < projection.starterCount
  /* Two projections, side by side: the provider's (Sleeper) line under this league's rules, and
     AllFantasy's own engine. Neither replaces the other — the user asked to see both. */
  const projected = projection?.afProjected ?? projection?.projected ?? null
  const afEngine = projection?.afEngine ?? null

  return (
    <span
      className="af-rail-row-side"
      data-side={them ? 'them' : undefined}
      data-partial={partial ? 'true' : undefined}
      title={projection
        ? language === 'es'
          ? `Proyección base semanal — ${PROJECTION_PROVIDER_LABEL} (SLPR): proyección de ${PROJECTION_PROVIDER_LABEL} con ${projection.pricedFrom} de ${projection.starterCount} titulares${
              projection.afProjected == null
                ? ', PPR genérico porque no se pudo recalcular con la puntuación de esta liga'
                : ', recalculada con la configuración de esta liga'
            } · AF: motor de AllFantasy con ${projection.afEngineFrom ?? 0} de ${projection.starterCount} titulares · el marcador en vivo se muestra aparte`
          : `Weekly baseline projection — ${PROJECTION_PROVIDER_LABEL} (SLPR): ${PROJECTION_PROVIDER_LABEL}’s projection from ${projection.pricedFrom} of ${projection.starterCount} starters${
              projection.afProjected == null
                ? ', generic PPR because this league’s scoring could not be re-scored'
                : ', re-scored with this league’s settings'
            } · AF: AllFantasy engine from ${projection.afEngineFrom ?? 0} of ${projection.starterCount} starters · live score is shown separately`
        : undefined}
    >
      <span className="af-rail-row-av" aria-hidden>
        <LeagueMark src={avatarUrl} letter={initial} />
      </span>
      <span className="af-rail-row-team">{name}</span>
      <span className="af-rail-row-score">{score == null ? '—' : score.toFixed(1)}</span>
      <span className="af-rail-row-projected">{projected == null ? '—' : projected.toFixed(1)}</span>
      <span className="af-rail-row-projected" data-kind="af">{afEngine == null ? '—' : afEngine.toFixed(1)}</span>
    </span>
  )
}

/** 1st, 2nd, 3rd, 4th … and 11th/12th/13th, which are the ones a naive rule gets wrong. */
function ordinal(n: number): string {
  const teens = n % 100
  if (teens >= 11 && teens <= 13) return `${n}th`
  const unit = n % 10
  if (unit === 1) return `${n}st`
  if (unit === 2) return `${n}nd`
  if (unit === 3) return `${n}rd`
  return `${n}th`
}

/**
 * The rank block that replaces the opponent in a league with no head-to-head.
 *
 * ⚠ IT SAYS WHAT THE NUMBER IS MEASURED FROM, because before kickoff it is not
 * measured from points — every score in the league is 0 in that window and the
 * order comes entirely from the projections. Printing "14th of 18" without
 * saying so would present a projected ordering as a played one.
 */
function RailStanding({ standing }: { standing: RailStandingSummary | null }) {
  const es = useOptionalLanguage().language === 'es'
  if (!standing) {
    return (
      <span className="af-rail-row-side" data-side="them">
        <span className="af-rail-row-team">
          {es ? 'sin enfrentamiento directo: posición aún no medible' : 'no head-to-head — rank not yet measurable'}
        </span>
      </span>
    )
  }

  const last = standing.overCut == null
  const tone = last ? 'bad' : standing.rank > standing.outOf * 0.75 ? 'warn' : undefined

  return (
    <span className="af-rail-row-rank" data-tone={tone}>
      <span className="af-rail-row-rank-pos">
        {standing.tied ? (es ? 'E-' : 'T-') : ''}{es ? `#${standing.rank}` : ordinal(standing.rank)}
        <span className="af-rail-row-rank-of">{es ? ' de ' : ' of '}{standing.outOf}</span>
      </span>
      <span className="af-rail-row-rank-cut">
        {es
          ? standing.overCut == null
            ? standing.tied ? 'empatado en el último lugar' : standing.elimination
              ? 'en la línea de corte'
              : 'último de la liga'
            : `+${standing.overCut.toFixed(1)} ${standing.elimination ? 'sobre el corte' : 'sobre el último'}`
          : standing.overCut == null
            ? standing.tied ? 'tied lowest' : standing.elimination
              ? 'on the block'
              : 'bottom of the league'
            : `+${standing.overCut.toFixed(1)} ${standing.elimination ? 'over the cut' : 'over last'}`}
      </span>
      <span className="af-rail-row-rank-space">
        {standing.placesAboveCut === 0
          ? es ? 'posición de corte' : 'cut position'
          : es
            ? `${standing.placesAboveCut} ${standing.placesAboveCut === 1 ? 'puesto' : 'puestos'} de margen`
            : `${standing.placesAboveCut} ${standing.placesAboveCut === 1 ? 'place' : 'places'} clear`}
      </span>
      <span className="af-rail-row-rank-basis">
        {standing.basis === 'points' ? (es ? 'por puntos' : 'on points') : es ? 'por proyección' : 'on projection'}
      </span>
    </span>
  )
}

/** "Mon 8pm" in the viewer's own zone. */
function draftWhen(iso: string, es: boolean): string {
  const at = new Date(iso)
  if (!Number.isFinite(at.getTime())) return ''
  const day = at.toLocaleDateString(es ? 'es' : 'en-US', { weekday: 'short' })
  const time = at.toLocaleTimeString(es ? 'es' : 'en-US', { hour: 'numeric', minute: at.getMinutes() ? '2-digit' : undefined })
  return `${day} ${es ? time : time.replace(/\s?([AP])M$/i, (_, h: string) => `${h.toLowerCase()}m`)}`
}

/**
 * A native guillotine league's line, in the slot a head-to-head opponent would take.
 *
 * ⚠ THE SAME FOUR CLASSES AS `RailStanding`, ON PURPOSE: the tray layout check
 * (e2e/mobile/league-tray-layout.spec.ts) requires every class the row uses to exist in this file or
 * the shell, and the line is the same shape — a position, the distance to the cut, the space, the basis.
 */
function RailGuillotine({ line }: { line: RailGuillotineLine }) {
  const es = useOptionalLanguage().language === 'es'
  const chopWeek = line.firstChopWeek
  let pos: ReactNode
  let cut: string
  let space: string | null = null
  let tone: 'bad' | 'warn' | undefined
  const basis = line.basis == null ? null : line.basis === 'points' ? (es ? 'por puntos' : 'on points') : es ? 'por proyección' : 'on projection'
  const aliveRank = line.rank != null ? (
    <>
      {es ? `#${line.rank}` : ordinal(line.rank)}
      <span className="af-rail-row-rank-of">{es ? ` de ${line.aliveCount} vivos` : ` of ${line.aliveCount} alive`}</span>
    </>
  ) : null
  switch (line.state) {
    case 'eliminated':
      tone = 'bad'
      pos = line.choppedWeek != null ? (es ? `Eliminado sem ${line.choppedWeek}` : `Chopped wk ${line.choppedWeek}`) : es ? 'Eliminado' : 'Chopped'
      cut = es ? 'fuera de la liga' : 'eliminated'
      break
    case 'preseason':
      pos = line.draftAt ? `${es ? 'Draft' : 'Draft'} ${draftWhen(line.draftAt, es)}` : es ? 'Temporada sin empezar' : 'Season not started'
      cut = chopWeek != null ? (es ? `primer corte sem ${chopWeek}` : `first chop wk ${chopWeek}`) : 'Guilly'
      break
    case 'before_first_chop':
      pos = aliveRank ?? (es ? `${line.aliveCount} vivos` : `${line.aliveCount} alive`)
      cut = chopWeek != null ? (es ? `Primer corte sem ${chopWeek}` : `First chop wk ${chopWeek}`) : es ? 'sin cortes aún' : 'no chops yet'
      break
    case 'no_scores':
      pos = es ? `${line.aliveCount} vivos` : `${line.aliveCount} alive`
      cut = es ? 'sin puntos todavía' : 'no scores yet'
      break
    case 'chop_zone':
      tone = 'bad'
      pos = aliveRank
      cut = es ? 'en zona de corte' : 'in the chop zone'
      space = line.chopMargin != null && line.chopMargin < 0
        ? es ? `${line.chopMargin.toFixed(1)} para salvarse` : `${line.chopMargin.toFixed(1)} to safety`
        : es ? 'empatado en la línea' : 'tied at the line'
      break
    default:
      tone = line.rank != null && line.rank > line.aliveCount * 0.75 ? 'warn' : undefined
      pos = aliveRank
      cut = line.chopMargin != null
        ? es ? `+${line.chopMargin.toFixed(1)} sobre el corte` : `+${line.chopMargin.toFixed(1)} above chop`
        : es ? 'vivo' : 'alive'
  }
  return (
    <span className="af-rail-row-rank" data-tone={tone} data-guillotine={line.state}>
      <span className="af-rail-row-rank-pos" suppressHydrationWarning>{pos}</span>
      <span className="af-rail-row-rank-cut">{cut}</span>
      {space ? <span className="af-rail-row-rank-space">{space}</span> : null}
      {basis && (line.state === 'alive' || line.state === 'chop_zone' || line.state === 'before_first_chop')
        ? <span className="af-rail-row-rank-basis">{basis}</span>
        : null}
    </span>
  )
}

export type RailRowBodyProps = {
  name: string
  platform: string
  /** The merged matchup (see `mergeRailMatchup`); absent draws the "no head-to-head" line. */
  m: RailMatchupSummary | null | undefined
  /** The live poll's row for this league, when it has one. Drives the score-status line. */
  live?: LiveRailScore | null
  isCommissioner?: boolean
  syncPaused?: boolean
  delayed?: boolean
  /** Minutes since `m.freshAt` by the client clock; null before mount or with no stamp. */
  freshMinutes?: number | null
  /** Drawn only while the rail is expanded — a collapsed rail has nowhere to put it. */
  showScoreStatus: boolean
  swing?: number | null
  careerLine?: string | null
  /** Extra headline badges (platform chip, live dot) for shells that want them. */
  badges?: ReactNode
}

export function RailRowBody({
  name,
  platform,
  m,
  live,
  isCommissioner,
  syncPaused,
  delayed,
  showScoreStatus,
  swing,
  careerLine,
  badges,
}: RailRowBodyProps) {
  const { language } = useOptionalLanguage()
  return (
    <span className="af-rail-row">
      <span className="af-rail-row-headline">
        <span className="af-rail-row-name">{name}</span>
        {isCommissioner ? <CommissionerBadge /> : null}
        {badges}
        {swing != null ? (
          <span className="af-rail-swing">
            {swing > 0 ? '+' : ''}{swing.toFixed(1)} swing
          </span>
        ) : null}
      </span>
      {/* On the Career screen only: your finished-season record and titles in this league. */}
      {careerLine ? <span className="af-rail-row-career">{careerLine}</span> : null}
      <span className="af-rail-row-meta">
        {!badges ? <span>{['manual', 'allfantasy'].includes(platform.toLowerCase()) ? 'AllFantasy' : platform}</span> : null}
        {m?.week ? <span>{language === 'es' ? 'Semana' : 'Week'} {m.week}</span> : null}
        {showScoreStatus && (syncPaused || delayed) ? <span className="af-rail-delayed">{syncPaused ? (language === 'es' ? 'Sincronización en pausa' : 'Sync paused') : (language === 'es' ? 'Actualizaciones retrasadas' : 'Updates delayed')}</span> : null}
        {!delayed && m?.source === 'history_fallback' ? <span>{language === 'es' ? 'Último resultado' : 'Last result'}</span> : null}
      </span>
      {m ? (
        <span className="af-rail-row-line">
          <span className="af-rail-row-labels" aria-hidden>
            <span />
            <span>{m.source === 'history_fallback' ? (language === 'es' ? 'ÚLT' : 'LAST') : language === 'es' ? 'PTS' : 'SCORE'}</span>
            {/*
              "SLPR", not "API" (2026-10-03) and not "SLEEPER": the column is 38px of
              11px monospace, where the full word measures ~52px. The tooltip spells it.
            */}
            <span title={language === 'es' ? `Proyección de ${PROJECTION_PROVIDER_LABEL}` : `${PROJECTION_PROVIDER_LABEL} projection`}>SLPR</span>
            <span title={language === 'es' ? 'Proyección del motor de AllFantasy' : 'AllFantasy engine projection'}>AF</span>
          </span>
          <RailSide
            name={m.yourTeam ?? (language === 'es' ? 'Tu equipo' : 'Your team')}
            avatarUrl={m.yourAvatarUrl}
            /*
              ⚠ A DASH, NOT 0.00, ON AN UNPLAYED FIXTURE. A scheduled
              row carries zeroes as soon as the schedule exists;
              printing them says the game was played and finished
              nil-all.
            */
            score={m.guillotine ? (m.guillotine.state === 'eliminated' ? null : m.guillotine.points) : m.scored ? m.yourScore : null}
            projection={m.yourProjection ?? null}
          />

          {/*
            An elimination league has no opponent BY DESIGN — every
            roster writes its own matchupId — so "v opponent not
            named" was an honest answer to a question the league does
            not ask. What its manager wants is the distance between
            them and the cut.
          */}
          {m.guillotine ? (
            <RailGuillotine line={m.guillotine} />
          ) : m.unpaired ? (
            <RailStanding standing={m.standing ?? null} />
          ) : (
            <RailSide
              them
              name={m.opponentTeam ?? (language === 'es' ? 'rival sin nombre' : 'opponent not named')}
              avatarUrl={m.opponentAvatarUrl}
              score={m.scored ? m.opponentScore : null}
              projection={m.opponentProjection ?? null}
            />
          )}
        </span>
      ) : (
        <span className="af-rail-row-line">
          <span className="af-rail-row-team">
            {String(platform).toLowerCase() === 'espn'
              ? language === 'es'
                ? 'ESPN no devolvió un calendario de enfrentamientos para esta liga'
                : 'Matchup unavailable from ESPN'
              : language === 'es'
                ? 'sin enfrentamiento directo registrado esta semana'
                : 'Matchup not available yet'}
          </span>
        </span>
      )}
    </span>
  )
}
