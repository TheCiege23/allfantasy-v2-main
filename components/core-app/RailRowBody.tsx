'use client'

import type { ReactNode } from 'react'
import { CommissionerBadge } from '@/components/core-app/CommissionerBadge'
import { LeagueMark } from '@/components/core-app/LeagueMark'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { railRowMessages } from '@/lib/core-app/messages/railRow'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { PROJECTION_PROVIDER_LABEL } from '@/lib/core-app/projectionProvider'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import type { RailMatchupSummary, RailSideProjectionSummary, RailStandingSummary } from './AfCoreShell'
import type { LiveRailScore } from './useLiveRailScores'
import { mostHavePlayed } from '@/lib/core-app/liveRailScores'
import type { RailGuillotineLine } from '@/lib/core-app/railGuillotineLine'
import type { RailRecord } from '@/lib/core-app/railRecordRank'

/**
 * The expanded body of one league row in the league rail: name, platform, the
 * live-score status, and this week's head-to-head (both managers, VS between them,
 * each with their score and projection) or, with no opponent, where you sit
 * against the field.
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
  /*
   * ⚠ THE LIVE POLL CARRIES POINTS, NEVER PROJECTIONS. Until most of the field has played, a team that has
   * not kicked off sits at 0, so a points rank puts it at the cut line; the server row ranked that window
   * on projections (`standingIn`). Keep it until the live field says most have played.
   */
  const liveField = live.fieldStanding
  const keepProjected = fieldRace && sameWeek && saved?.standing?.basis === 'projected' &&
    !(liveField && mostHavePlayed(liveField.played ?? liveField.outOf, liveField.outOf))
  const standing = keepProjected
    ? { ...saved!.standing!, weeksLeft: saved!.standing!.weeksLeft ?? liveField?.weeksLeft ?? null }
    : fieldRace ? live.fieldStanding : live.standing
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
 * One team in a rail row, laid out the way Sleeper's league list reads: the manager's avatar,
 * their team name, and their points underneath — the score once the week is played, and this
 * league's projected total either way. The opponent mirrors it on the other side of the "VS".
 *
 * ⚠ ONE PROJECTION, NOT TWO (user call, 2026-10-30). The row used to carry the provider line and
 * AllFantasy's engine side by side under SCORE / SLPR / AF headers. The list is a glance surface;
 * the engine's number still lives on the matchup screen, where it has room to be explained.
 * The projection kept is the provider's line re-scored under THIS league's rules when that could
 * be done (`afProjected`), else the provider's own — the same number the SLPR column showed.
 *
 * ⚠ THE AVATAR IS THE MANAGER'S, NOT THE LEAGUE'S. The league crest is already the 42px mark at
 * the head of the row; repeating it here would say nothing. The loader resolves both sides'
 * `avatarUrl` through `managerArtUrl` — Sleeper stores an avatar *id* where other platforms
 * store a link.
 *
 * ⚠ AND THE INITIAL IS `Array.from`, NOT `slice`. A team name starting with an emoji sliced
 * mid-surrogate serialises differently on server and client and takes hydration down — the same
 * trap the profile mark in the rail foot carries a note about, and half this account's league
 * names begin with 🪓.
 */
function RailSide({
  name,
  avatarUrl,
  score,
  projection,
  them,
  leading,
}: {
  name: string
  avatarUrl: string | null
  /** Null while the fixture is unplayed, which draws no score rather than 0.0. */
  score: number | null
  projection: RailSideProjectionSummary | null
  them?: boolean
  /** Ahead on the scoreboard right now — the score is drawn in the winning colour. */
  leading?: boolean
}) {
  const msg = useMessages(railRowMessages)
  // The first letter or digit, so "(F) SF TEXANS" reads F rather than "(".
  const chars = Array.from(name.trim() || '•')
  const initial = (chars.find((c) => /[\p{L}\p{N}]/u.test(c)) ?? chars[0] ?? '•').toUpperCase()
  /*
   * ⚠ `pricedFrom > 0` MATTERS: a side where NOTHING priced already draws a dash, and marking
   * that dash as partial read like a third state. Partial means "some of the lineup", which is
   * the only case the mark has anything to add.
   */
  const partial =
    projection != null &&
    projection.pricedFrom > 0 &&
    projection.pricedFrom < projection.starterCount
  const projected = projection?.afProjected ?? projection?.projected ?? null

  return (
    <span
      className="af-rail-row-side"
      data-side={them ? 'them' : undefined}
      data-partial={partial ? 'true' : undefined}
      data-leading={leading ? 'true' : undefined}
      title={projection
        ? msg.sideTitle(
            PROJECTION_PROVIDER_LABEL,
            projection.pricedFrom,
            projection.starterCount,
            projection.afProjected == null,
          )
        : undefined}
    >
      <span className="af-rail-row-av" aria-hidden>
        <LeagueMark src={avatarUrl} letter={initial} />
      </span>
      <span className="af-rail-row-who">
        <span className="af-rail-row-team">{name}</span>
        <span className="af-rail-row-pts">
          {score != null ? <span className="af-rail-row-score">{score.toFixed(1)}</span> : null}
          <span className="af-rail-row-projected">
            <span className="af-rail-row-proj-label">{msg.projShort}</span>
            {projected == null ? '—' : projected.toFixed(1)}
          </span>
        </span>
      </span>
    </span>
  )
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
  const msg = useMessages(railRowMessages)
  if (!standing) {
    return (
      <span className="af-rail-row-side" data-side="them">
        <span className="af-rail-row-team">
          {msg.noHeadToHead}
        </span>
      </span>
    )
  }

  const last = standing.overCut == null
  const tone = last ? 'bad' : standing.rank > standing.outOf * 0.75 ? 'warn' : undefined

  return (
    <span className="af-rail-row-rank" data-tone={tone}>
      <span className="af-rail-row-rank-pos">
        {standing.tied ? msg.tiedPrefix : ''}{msg.rank(standing.rank)}
        <span className="af-rail-row-rank-of">{standing.elimination ? msg.ofAlive(standing.outOf) : `${msg.of}${standing.outOf}`}</span>
      </span>
      <span className="af-rail-row-rank-cut">
        {standing.overCut == null
          ? standing.tied ? msg.tiedLowest : standing.elimination
            ? msg.onTheBlock
            : msg.bottomOfLeague
          : standing.elimination
            ? msg.overTheCut(standing.overCut.toFixed(1))
            : msg.overLast(standing.overCut.toFixed(1))}
      </span>
      <span className="af-rail-row-rank-space">
        {standing.placesAboveCut === 0 ? msg.cutPosition : msg.placesClear(standing.placesAboveCut)}
      </span>
      {/*
        WHO THE CUT FALLS ON (owner's ask, 2026-10-30): the lowest team other than you and their number on
        the same basis — the team you need to stay above, or the one you need to pass when it is you.
      */}
      {standing.elimination && standing.cutTeam && standing.cutTeamValue != null ? (
        <span className="af-rail-row-rank-low">
          {standing.overCut == null
            ? msg.toPass(standing.cutTeam, standing.cutTeamValue.toFixed(1))
            : msg.chopLine(standing.cutTeam, standing.cutTeamValue.toFixed(1))}
        </span>
      ) : null}
      <span className="af-rail-row-rank-basis">
        {standing.basis === 'points' ? msg.onPoints : msg.onProjection}
        {standing.elimination && standing.weeksLeft != null ? ` · ${msg.weeksLeft(standing.weeksLeft)}` : ''}
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
  const msg = useMessages(railRowMessages)
  const chopWeek = line.firstChopWeek
  let pos: ReactNode
  let cut: string
  let space: string | null = null
  let tone: 'bad' | 'warn' | undefined
  const basis = line.basis == null ? null : line.basis === 'points' ? msg.onPoints : msg.onProjection
  const aliveRank = line.rank != null ? (
    <>
      {msg.rank(line.rank)}
      <span className="af-rail-row-rank-of">{msg.ofAlive(line.aliveCount)}</span>
    </>
  ) : null
  switch (line.state) {
    case 'eliminated':
      tone = 'bad'
      pos = line.choppedWeek != null ? msg.choppedWeek(line.choppedWeek) : msg.chopped
      cut = msg.eliminated
      break
    case 'preseason':
      pos = line.draftAt ? `${msg.draft} ${draftWhen(line.draftAt, es)}` : msg.seasonNotStarted
      cut = chopWeek != null ? msg.firstChopWeekLower(chopWeek) : 'Guilly'
      break
    case 'before_first_chop':
      pos = aliveRank ?? msg.aliveCount(line.aliveCount)
      cut = chopWeek != null ? msg.firstChopWeek(chopWeek) : msg.noChopsYet
      break
    case 'no_scores':
      pos = msg.aliveCount(line.aliveCount)
      cut = msg.noScoresYet
      break
    case 'chop_zone':
      tone = 'bad'
      pos = aliveRank
      cut = msg.inChopZone
      space = line.chopMargin != null && line.chopMargin < 0
        ? msg.toSafety(line.chopMargin.toFixed(1))
        : msg.tiedAtLine
      break
    default:
      tone = line.rank != null && line.rank > line.aliveCount * 0.75 ? 'warn' : undefined
      pos = aliveRank
      cut = line.chopMargin != null
        ? msg.aboveChop(line.chopMargin.toFixed(1))
        : msg.alive
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
  /** Scores are moving right now (a fresh live poll on a played week). Draws the LIVE pill. */
  isLive?: boolean
  /** Your win probability this week, strictly between 0 and 1 — the odds bar. Absent draws none. */
  pWin?: number | null
  /** What needs you in this league (urgencyBadges.ts): an empty or ruled-out starter, an offer waiting. */
  attention?: ReadonlyArray<RailAttention>
  /**
   * Where a tap on the head-to-head goes — the league's Matchup screen. The row stays ONE link (a
   * link inside a link is invalid HTML and two tab stops per league); the shell reads this off the
   * tapped element with `railTapTarget` and routes there instead of the league.
   */
  matchupHref?: string | null
  /** Your record and place in this league ("6-3 · 2nd"). Absent or null draws no record. */
  record?: RailRecord | null
}

export type RailAttention = 'lineup' | 'offer'

/**
 * The href a tap on a league row should open: the Matchup screen when the tap landed on the
 * head-to-head, else null (open the league). A modified click (new tab, new window) is left to the
 * browser, which opens the row's own link.
 */
export function railTapTarget(event: { target: EventTarget | null; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; button?: number }): string | null {
  if (event.metaKey || event.ctrlKey || event.shiftKey || (event.button ?? 0) !== 0) return null
  const el = event.target instanceof Element ? event.target.closest('[data-matchup-href]') : null
  return el?.getAttribute('data-matchup-href') || null
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
  isLive,
  pWin,
  attention,
  matchupHref,
  record,
}: RailRowBodyProps) {
  const msg = useMessages(railRowMessages)
  const headToHead = Boolean(m && !m.guillotine && !m.unpaired)
  /* Only a played week has a leader; a level score has none. */
  const lead = headToHead && m?.scored ? Math.sign((m.yourScore ?? 0) - (m.opponentScore ?? 0)) : 0
  const odds = headToHead && pWin != null && pWin > 0 && pWin < 1 ? Math.round(pWin * 100) : null
  return (
    <span className="af-rail-row">
      <span className="af-rail-row-headline">
        <span className="af-rail-row-name">{name}</span>
        {isCommissioner ? <CommissionerBadge /> : null}
        {badges}
        {!badges && isLive ? <span className="af-rail-live-state">{msg.live}</span> : null}
        {swing != null ? (
          <span className="af-rail-swing">
            {swing > 0 ? '+' : ''}{swing.toFixed(1)} swing
          </span>
        ) : null}
      </span>
      {/* On the Career screen only: your finished-season record and titles in this league. */}
      {careerLine ? <span className="af-rail-row-career">{careerLine}</span> : null}
      <span className="af-rail-row-meta">
        {/*
          The platform in its own colour (`.af-platform` in af-core.css), AllFantasy in AF blue, so a
          Sleeper league and a Fantrax one read apart before the name does. No week: every row in the
          list is the same week, so it said nothing per row (user call, 2026-10-30).
        */}
        {!badges ? (
          <span
            className="af-platform af-platform-chip af-rail-row-plat"
            data-platform={isNativePlatform(platform) ? 'native' : platform.toLowerCase()}
          >
            {platformLabel(isNativePlatform(platform) ? null : platform)}
          </span>
        ) : null}
        {record ? (
          <span className="af-rail-row-record af-num">
            {record.wins}-{record.losses}{record.ties ? `-${record.ties}` : ''}
            {record.rank != null ? ` · ${msg.rank(record.rank)}` : ''}
          </span>
        ) : null}
        {showScoreStatus && (syncPaused || delayed) ? <span className="af-rail-delayed">{syncPaused ? msg.syncPaused : msg.updatesDelayed}</span> : null}
        {!delayed && m?.source === 'history_fallback' ? <span>{msg.lastResult}</span> : null}
        {attention?.includes('lineup') ? (
          <span className="af-rail-row-flag" data-tone="bad">{msg.fixLineup}</span>
        ) : null}
        {attention?.includes('offer') ? (
          <span className="af-rail-row-flag" data-tone="warn">{msg.tradeOffer}</span>
        ) : null}
      </span>
      {/* An odd-team league's extra game, in place of the bye (lib/redraft/oddTeamExtraMatchupRules.ts). */}
      {m?.extraMatchup ? (
        <span className="af-rail-row-career" data-testid="rail-extra-matchup">{m.extraMatchup.line}</span>
      ) : null}
      {m ? (
        <span
          className="af-rail-row-line"
          data-vs={headToHead ? 'true' : undefined}
          data-matchup-href={headToHead && matchupHref ? matchupHref : undefined}
          title={headToHead && matchupHref ? msg.openMatchup : undefined}
        >
          <RailSide
            name={m.yourTeam ?? msg.yourTeam}
            avatarUrl={m.yourAvatarUrl}
            /*
              ⚠ NO SCORE, NOT 0.0, ON AN UNPLAYED FIXTURE. A scheduled row carries zeroes as soon
              as the schedule exists; printing them says the game was played and finished nil-all.
            */
            score={m.guillotine ? (m.guillotine.state === 'eliminated' ? null : m.guillotine.points) : m.scored ? m.yourScore : null}
            projection={m.yourProjection ?? null}
            leading={lead > 0}
          />

          {/*
            An elimination league has no opponent BY DESIGN — every roster writes its own
            matchupId — so "v opponent not named" was an honest answer to a question the league
            does not ask. What its manager wants is the distance between them and the cut.
          */}
          {m.guillotine ? (
            <RailGuillotine line={m.guillotine} />
          ) : m.unpaired ? (
            <RailStanding standing={m.standing ?? null} />
          ) : (
            <>
              <span className="af-rail-row-vs" aria-hidden>{msg.vs}</span>
              <RailSide
                them
                name={m.opponentTeam ?? msg.opponentNotNamed}
                avatarUrl={m.opponentAvatarUrl}
                score={m.scored ? m.opponentScore : null}
                projection={m.opponentProjection ?? null}
                leading={lead < 0}
              />
              {/*
                Your chance this week, from the same model the Matchup screen prints (rail-odds route).
                A finished game has no odds, only a result, so it draws no bar.
              */}
              {odds != null ? (
                <span className="af-rail-row-odds" role="img" aria-label={msg.winOdds(odds)}>
                  <span className="af-rail-row-odds-pct">{odds}%</span>
                  <span className="af-rail-row-odds-bar" aria-hidden>
                    <span className="af-rail-row-odds-fill" style={{ width: `${odds}%` }} />
                  </span>
                  <span className="af-rail-row-odds-pct" data-side="them">{100 - odds}%</span>
                </span>
              ) : null}
            </>
          )}
        </span>
      ) : (
        <span className="af-rail-row-line">
          <span className="af-rail-row-team">
            {String(platform).toLowerCase() === 'espn' ? msg.espnUnavailable : msg.matchupNotAvailable}
          </span>
        </span>
      )}
    </span>
  )
}
