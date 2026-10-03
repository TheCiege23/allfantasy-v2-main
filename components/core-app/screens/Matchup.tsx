'use client'

import '@/components/core-app/af-matchup.css'
// The refresh control's own styles (`.af-mp-live*`) live with the all-leagues board it came from.
import '@/components/core-app/af-matchup-pulse.css'
import { MatchupPulseRefresh } from '@/components/core-app/MatchupPulseRefresh'
import { claimRouteRefresh } from '@/components/core-app/routeRefreshClaim'
import Link from 'next/link'
import PlayerName from '@/components/core-app/player-card/PlayerName'
import { PlayerCardLeagueScope } from '@/components/core-app/player-card/PlayerCardProvider'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'
import { SourceActionLink } from '@/components/league-links/SourceActionLink'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { matchupConfidenceText, matchupReasonText } from '@/lib/core-app/matchupReasonText'
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type {
  MatchupData,
  MatchupPlayerCell,
  MatchupSlot,
  MatchupTeam,
} from '@/lib/core-app/matchup'

/**
 * Screen 5 — Matchup.
 *
 * "Live head-to-head, what's left to play, and what decides it."
 *
 * The handoff centres a win probability between the two teams. That number is
 * the most authoritative-looking thing in the whole product, and it needs live
 * scores plus players yet to play — neither of which is ingested for imported
 * leagues. So the centre column states what it would take instead of printing a
 * percentage, and a ratio of current points is explicitly NOT substituted: that
 * would look like a probability without being one.
 *
 * ⚠ THE SLOT-BY-SLOT BOARD IS REAL NOW, AND IT IS NOT A LIVE SCOREBOARD. It
 * pairs the two stored lineups by slot with a headshot on each side, priced
 * under this league's own scoring. `playerScoring` says whether the numbers are
 * live points or projections, and the column header changes with it — a
 * projection sitting under a column labelled "PTS" is the one thing this screen
 * must never render.
 */

export type MatchupProps = {
  data: MatchupData
}

/** Two letters for a team with no crest. Never blank, never a broken image. */
function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * One manager's half of the banner.
 *
 * ⚠ THE NUMBER AND THE TEAM COME FROM DIFFERENT SECTIONS ON PURPOSE. The crest,
 * name and record are known days before kickoff; the score is not. `points` is
 * the scored total when there is one, and `projected` stands in when there is
 * not — labelled, never silently. A projection rendered as a score is the one
 * mistake this banner cannot make, and a blank banner over an unplayed week was
 * the overcorrection it used to make instead.
 */
function TeamCard({
  team,
  points,
  projected,
  afProjected = null,
  leftToPlay = null,
  align,
}: {
  team: MatchupTeam
  points: number | null
  projected: number | null
  /** AllFantasy's own engine total for this lineup. Shown only before a point is scored. */
  afProjected?: number | null
  /**
   * Starters still to play or playing now — live weeks only. Null when it is not known for EVERY
   * starter: a count that silently skipped the ones we could not place would read as "fewer left".
   */
  leftToPlay?: number | null
  align: 'left' | 'right'
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const showing = points ?? projected
  return (
    <div className="af-mu-team" data-align={align} data-you={team.isYou}>
      {team.avatarUrl && team.avatarUrl !== failedAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="af-mu-crest af-mu-crest--img" src={team.avatarUrl} alt="" width={48} height={48} onError={() => setFailedAvatarUrl(team.avatarUrl!)} />
      ) : (
        <div className="af-mu-crest" aria-hidden>
          {initialsOf(team.teamName)}
        </div>
      )}
      <div className="af-mu-team-text">
        <div className="af-mu-team-name">{team.teamName}</div>
        <div className="af-mu-team-meta">
          {[team.isYou ? copy('You') : team.ownerName || null, team.record].filter(Boolean).join(' · ') ||
            copy('no record on file')}
        </div>
      </div>
      <div className="af-mu-score-stack" data-align={align}>
        <div className="af-mu-score af-num" data-basis={points != null ? 'scored' : 'projected'}>
          {showing == null ? '—' : showing.toFixed(1)}
        </div>
        {points == null && showing != null ? (
          <span className="af-mu-score-tag af-label">{copy('proj')}</span>
        ) : null}
        {points == null && afProjected != null ? (
          <span className="af-mu-score-af af-num" title={copy("AllFantasy engine projection for this lineup, adjusted to this league's scoring")}>
            AF {afProjected.toFixed(1)}
          </span>
        ) : null}
        {leftToPlay != null ? (
          <span className="af-mu-left af-num" data-none={leftToPlay === 0 || undefined}>
            {leftToPlay === 0 ? copy('All played') : `${leftToPlay} ${copy('left to play')}`}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The score, pinned to the top of a phone or tablet once the banner has scrolled away.
 *
 * ⚠ WHY THIS EXISTS. On a 375px phone the banner starts ~570px down and a 28-starter board runs
 * thousands of pixels below it — measured 2026-10-02, about three slot rows fit on a screen. Scrolling
 * the board to see who is playing meant losing the score, which is the one number the manager is
 * watching. Tapping the bar returns to the banner.
 *
 * Rendered only while the banner is OUT of view (an IntersectionObserver, no scroll listener), and
 * shown by CSS only while the matchup itself is narrow (≤760px of matchup, af-matchup.css) — a wide
 * matchup shows both at once. It repeats what the banner already says, so a screen reader is not
 * read it twice: it is a plain button labelled for its action.
 *
 * ⚠ IT SITS OVER THE MATCHUP, NOT THE WINDOW. Under a tablet's desktop shell a full-width fixed bar
 * covered the rail and nav, so the matchup's own box is measured into `--af-mu-sticky-left/-width`;
 * on a phone the CSS ignores both and goes full-bleed.
 */
function StickyScore({
  target,
  you,
  them,
  basis,
  pWin,
  leader,
}: {
  target: RefObject<HTMLElement | null>
  you: { name: string; value: number | null }
  them: { name: string; value: number | null }
  basis: 'scored' | 'projected'
  pWin: number | null
  leader: 'you' | 'opponent' | null
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const [show, setShow] = useState(false)
  useEffect(() => {
    const el = target.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setShow(!entry.isIntersecting && entry.boundingClientRect.top < 0), {
      threshold: 0,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [target])
  const [box, setBox] = useState<{ left: number; width: number } | null>(null)
  useEffect(() => {
    if (!show) return
    const matchup = target.current?.closest('.af-mu')
    if (!matchup) return
    const measure = () => {
      const r = matchup.getBoundingClientRect()
      setBox((prev) =>
        prev && prev.left === Math.round(r.left) && prev.width === Math.round(r.width)
          ? prev
          : { left: Math.round(r.left), width: Math.round(r.width) },
      )
    }
    measure()
    /* The rail opening or closing moves the matchup without resizing the window. */
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(matchup)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [show, target])
  if (!show) return null
  const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(1))
  return (
    <button
      type="button"
      className="af-mu-sticky"
      style={
        box
          ? ({ '--af-mu-sticky-left': `${box.left}px`, '--af-mu-sticky-width': `${box.width}px` } as CSSProperties)
          : undefined
      }
      data-leader={leader ?? undefined}
      data-basis={basis}
      onClick={() => target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      aria-label={copy('Back to the score')}
    >
      <span className="af-mu-sticky-side" data-side="you">
        <span className="af-mu-sticky-name">{you.name}</span>
        <span className="af-mu-sticky-n af-num">{fmt(you.value)}</span>
      </span>
      <span className="af-mu-sticky-mid">
        {pWin != null ? (
          <span className="af-mu-sticky-wp af-num" data-tone={pWin >= 0.5 ? 'good' : 'bad'}>
            {Math.round(pWin * 100)}%
          </span>
        ) : (
          <span className="af-mu-sticky-wp af-num">{basis === 'projected' ? copy('proj') : copy('vs')}</span>
        )}
      </span>
      <span className="af-mu-sticky-side" data-side="them">
        <span className="af-mu-sticky-n af-num">{fmt(them.value)}</span>
        <span className="af-mu-sticky-name">{them.name}</span>
      </span>
    </button>
  )
}

/**
 * "Q", "D", "DTD" — the injury feed's word for an UNCERTAINTY, shortened the way every fantasy app
 * prints it. Anything unrecognised keeps its first word rather than being dropped.
 */
export function injuryTag(status: string): string {
  const s = status.trim().toLowerCase()
  if (s.startsWith('quest')) return 'Q'
  if (s.startsWith('doubt')) return 'D'
  if (s.startsWith('prob')) return 'P'
  if (s.replace(/[^a-z]/g, '') === 'daytoday' || s === 'dtd') return 'DTD'
  return status.trim().split(/\s+/)[0].slice(0, 4).toUpperCase()
}

/**
 * "Sun 1:00 PM" — in the VIEWER's timezone.
 *
 * 🛑 FORMATTED AFTER MOUNT, ON PURPOSE. The server renders in UTC; a kickoff formatted there reads
 * "Sun 5:00 PM" to a manager in New York for a 1:00 PM game — the bug My Team shipped and fixed in
 * ae6425fc8. Formatting during render would also make server and client HTML disagree. So the
 * server sends the instant, and the browser names it.
 */
function Kickoff({ iso }: { iso: string }) {
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    const at = new Date(iso)
    if (Number.isNaN(at.getTime())) return
    setLabel(
      at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
    )
  }, [iso])
  return label ? <time dateTime={iso}>{label}</time> : null
}

/** Starters still to play for one side, or null when any of their game states is unknown. */
function leftFor(side: { upcoming: number; live: number; unknown: number } | undefined): number | null {
  if (!side || side.unknown > 0) return null
  return side.upcoming + side.live
}

/**
 * One player in one half of a slot row.
 *
 * ⚠ AN EMPTY SLOT AND AN UNRESOLVED ID RENDER DIFFERENTLY ON PURPOSE. The first
 * is a hole in someone's lineup; the second is our identity bridge failing on a
 * player who is sitting in the slot. Showing the second as the first sends a
 * manager to their platform to fix nothing.
 */
function PlayerHalf({
  cell,
  align,
  live,
  edge = null,
}: {
  cell: MatchupPlayerCell | null
  align: 'left' | 'right'
  live: boolean
  /** Which side of this slot is ahead — tints the half so the board reads at a glance. */
  edge?: SlotEdge | null
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null)
  if (!cell) {
    return <div className="af-mu-half" data-align={align} data-state="none" />
  }

  if (cell.empty) {
    return (
      <div className="af-mu-half" data-align={align} data-state="empty">
        <span className="af-mu-portrait af-mu-portrait--empty" aria-hidden>
          —
        </span>
        <div className="af-mu-half-text">
          <div className="af-mu-half-name">{copy('Slot empty')}</div>
          <div className="af-mu-half-sub">{copy('nobody is started here')}</div>
        </div>
        <div className="af-mu-half-pts af-num">—</div>
      </div>
    )
  }

  const crest = cell.team ? teamLogoUrl(cell.sport ?? 'NFL', cell.team) : null
  const imageUrl = cell.imageUrl && cell.imageUrl !== failedImageUrl ? cell.imageUrl : null
  /*
   * 🛑 A STARTER WHOSE GAME HAS NOT KICKED OFF HAS NO POINTS, NOT ZERO POINTS. Sleeper writes a 0
   * into `players_points` for every starter the moment the week opens, so on a Friday of week 4
   * (measured 2026-10-02, a 28-starter league) every one of the manager's unplayed starters read
   * "○ 0.0" — a yet-to-play marker beside what looks like a bust. A 0 on an upcoming game is the
   * platform's placeholder, so it renders as the absence it is.
   */
  const notYetPlayed = live && cell.gameState === 'upcoming' && (cell.actual == null || cell.actual === 0)
  const value = live ? (notYetPlayed ? null : cell.actual) : cell.projected

  return (
    <div className="af-mu-half" data-align={align} data-state="player" data-edge={edge ?? undefined}>
      <span className="af-mu-portrait">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="af-mu-face" src={imageUrl} alt="" width={34} height={34} loading="lazy" onError={() => setFailedImageUrl(imageUrl)} />
        ) : (
          <span className="af-mu-face af-mu-face--none" aria-hidden>
            {(cell.name ?? '?').charAt(0).toUpperCase()}
          </span>
        )}
        {/*
          The club crest overlaps the headshot rather than taking a column of
          its own — one object, "the player and who he plays for", which is how
          every sports app renders it and how MyTeam already does.
        */}
        {crest && crest !== failedLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="af-mu-club" src={crest} alt="" width={15} height={15} loading="lazy" onError={() => setFailedLogoUrl(crest)} />
        ) : null}
      </span>
      <div className="af-mu-half-text">
        <div className="af-mu-half-name">
          {/*
            The name opens the player card. `PlayerName` degrades to plain text
            when there is no id, which is exactly the unresolved case below —
            an inert button on a row we could not identify would offer a lookup
            that cannot happen.
          */}
          {cell.name ? (
            <PlayerName
              sport={cell.sport ?? 'NFL'}
              sleeperId={cell.sleeperId}
              name={cell.name}
              position={cell.position}
              team={cell.team}
              imageUrl={cell.imageUrl}
            />
          ) : (
            <span className="af-mu-half-unresolved">{copy('Unresolved player')}</span>
          )}
          {cell.injury ? (
            <span className="af-mu-inj" title={cell.injury}>
              {injuryTag(cell.injury)}
            </span>
          ) : null}
        </div>
        <div className="af-mu-half-sub">
          {cell.name
            ? [cell.position, cell.team].filter(Boolean).join(' · ') || copy('no position on file')
            : `id ${cell.playerId}`}
        </div>
        {/*
          When and against whom — for a starter whose game is still to come. Once he has played, the
          number beside him is the story; before, "Sun 1:00 PM @ BUF" is what a manager checks.
        */}
        {(cell.gameState === 'upcoming' || (!live && cell.gameState !== 'final')) && (cell.kickoff || cell.opponentClub) && !cell.unavailable ? (
          <div className="af-mu-half-game">
            {cell.kickoff ? <Kickoff iso={cell.kickoff} /> : null}
            {cell.opponentClub ? (
              <span>
                {cell.kickoff ? ' ' : ''}
                {cell.home ? 'vs' : '@'} {cell.opponentClub}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {/*
        ⚠ "—" IS NOT 0.0. A player we could not price has no number. A 0.0 is a
        claim, and the only projected ones we make are a starter ruled out or on
        bye — which is why the reason sits beside the number rather than leaving
        a bare zero to be read as a bad projection. Here, not beside the name:
        the name truncates, and this column never does.
      */}
      <div className="af-mu-half-pts af-num" data-unpriced={value == null}>
        {/*
          ⚠ WHY A MARKER AND NOT HIS PROJECTION. Mid-week a starter who has not played reads "—",
          the same as one we could not price, and "who is still to play" is the question this
          board exists to answer. His projection would answer it too, but in a column headed PTS
          — the one thing this screen must never render. So the number stays honest and the
          marker says why it is empty. Live weeks only: before kickoff every starter is yet to
          play, and a dot on all of them says nothing.
        */}
        {live && (cell.gameState === 'live' || cell.gameState === 'upcoming') ? (
          <span
            className="af-mu-gs"
            data-state={cell.gameState}
            role="img"
            aria-label={copy(cell.gameState === 'live' ? 'Playing now' : 'Yet to play')}
            title={copy(cell.gameState === 'live' ? 'Playing now' : 'Yet to play')}
          />
        ) : null}
        {cell.unavailable ? (
          <span
            className="af-mu-flag"
            title={
              cell.unavailable === 'bye'
                ? copy('His team is not playing this week. A starter on bye is a guaranteed zero.')
                : copy('Unavailable this week. In Best Ball, another eligible roster player can replace this player automatically.')
            }
          >
            {cell.unavailable === 'bye' ? 'BYE' : 'OUT'}
          </span>
        ) : null}
        {value == null ? '—' : value.toFixed(1)}
        {/*
          AllFantasy's own engine, under the provider's number, before kickoff only — once
          points are live the board is about what happened, not about either projection.
        */}
        {!live && cell.afEngine != null ? (
          <span className="af-mu-half-af" title={copy("AllFantasy engine projection, adjusted to this league's scoring")}>
            AF {cell.afEngine.toFixed(1)}
          </span>
        ) : null}
        {/*
          What an unplayed starter is still expected to add — on its own line and LABELLED, so it is
          never read as points in the PTS column above it. "Who is still to play, and for how much"
          is the question a manager opens this board mid-week to answer.
        */}
        {notYetPlayed && cell.projected != null && !cell.unavailable ? (
          <span className="af-mu-half-proj" title={copy("Projected points still to come, under this league's scoring")}>
            {copy('proj')} {cell.projected.toFixed(1)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * AllFantasy's own engine, totalled over one side's starters.
 *
 * A starter ruled out or on bye is a known 0 (his provider cell already says so); a starter the
 * engine never wrote is skipped rather than counted as zero. Null when the engine priced nobody,
 * so a lineup with no AF rows reads `—` instead of a confident 0.0.
 */
export function afEngineColumnTotal(slots: MatchupSlot[], key: 'you' | 'opponent'): number | null {
  let total = 0
  let rows = 0
  for (const s of slots) {
    const cell = s[key]
    if (!cell || cell.empty) continue
    if (cell.unavailable) continue
    if (cell.afEngine == null) continue
    total += cell.afEngine
    rows += 1
  }
  return rows > 0 ? Math.round(total * 10) / 10 : null
}

export type SlotEdge = 'ahead' | 'behind' | 'even'

/**
 * Who is winning ONE slot — scored points on a live board, projections before kickoff.
 *
 * Null when either side has no number to compare (an empty slot, an unpriced player, a starter
 * still to play on a live board): a tint over an unknown would claim a result that does not exist.
 */
export function slotEdges(
  slot: MatchupSlot,
  live: boolean,
): { you: SlotEdge; opponent: SlotEdge } | null {
  const valueOf = (c: MatchupPlayerCell | null): number | null => {
    if (!c || c.empty) return null
    if (!live) return c.projected
    if (c.gameState === 'upcoming' && (c.actual == null || c.actual === 0)) return null
    return c.actual
  }
  const a = valueOf(slot.you)
  const b = valueOf(slot.opponent)
  if (a == null || b == null) return null
  if (Math.abs(a - b) < 0.05) return { you: 'even', opponent: 'even' }
  return a > b ? { you: 'ahead', opponent: 'behind' } : { you: 'behind', opponent: 'ahead' }
}

/** Sum of a column, and how many of its cells it was built from. */
function columnTotal(slots: MatchupSlot[], key: 'you' | 'opponent', live: boolean) {
  let total = 0
  let from = 0
  let of = 0
  for (const s of slots) {
    const cell = s[key]
    if (!cell || cell.empty) continue
    /*
     * A live starter still to kick off is not a gap in our data — nobody has points for him yet.
     * Counting him in `of` made a Friday board say "built from 2 of your 28 starters, so both
     * totals read low" about a week that simply had not been played.
     */
    if (live && cell.gameState === 'upcoming' && (cell.actual == null || cell.actual === 0)) continue
    of += 1
    const v = live ? cell.actual : cell.projected
    if (v == null) continue
    total += v
    from += 1
  }
  return { total: Math.round(total * 10) / 10, from, of }
}

function LineupBoard({ data }: { data: MatchupData }) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  if (!data.lineups.available) {
    return <p className="af-mu-unavailable">{matchupReasonText(data.lineups.reason, language)}</p>
  }

  const live = data.playerScoring.available
  const slots = data.lineups.data
  const yours = columnTotal(slots, 'you', live)
  const theirs = columnTotal(slots, 'opponent', live)
  const yoursAf = afEngineColumnTotal(slots, 'you')
  const theirsAf = afEngineColumnTotal(slots, 'opponent')
  // Before kickoff each cell carries two projections: Sleeper's (SLPR) and AllFantasy's (AF).
  // "SLPR/AF", not "API · AF" (2026-10-03): named for who made it, and short enough for the 62px column.
  const heading = live ? 'PTS' : 'SLPR/AF'
  /* Slot-by-slot tally — only slots where both sides have a number count. */
  const tally = { you: 0, opponent: 0, even: 0 }
  for (const s of slots) {
    const e = slotEdges(s, live)
    if (!e) continue
    if (e.you === 'ahead') tally.you += 1
    else if (e.you === 'behind') tally.opponent += 1
    else tally.even += 1
  }
  const tallied = tally.you + tally.opponent + tally.even

  return (
    <>
      {/*
        ⚠ THE IDENTITY GAP LEADS, ABOVE EVEN THE BASIS NOTE. When not one id
        resolves, every row below is nameless and unpriced — reading the basis
        note first ("these are projections") makes no sense when the reader
        cannot see who anyone is. Cause before consequence.
      */}
      {data.identityNote ? (
        <p className="af-mu-identity-gap">{data.identityNote}</p>
      ) : null}

      {/*
        The basis is stated ABOVE the board, not under it. It changes what every
        number in the table means, and a note nobody reaches is the same as no
        note.
      */}
      <p className="af-mu-note af-mu-note--lead">
        {live
          ? language === 'es' ? `Puntos en vivo según ${data.playerScoring.data.source} — ${data.playerScoring.data.playersScored} jugadores registrados.` : `Live points as ${data.playerScoring.data.source} scored them — ${data.playerScoring.data.playersScored} players on file.`
          : matchupReasonText(data.playerScoring.reason, language)}
      </p>
      {/* The key for the per-player markers — only when one is on the board. */}
      {live && slots.some((s) => [s.you, s.opponent].some((c) => c?.gameState === 'live' || c?.gameState === 'upcoming')) ? (
        <p className="af-mu-gs-key">
          <span><span className="af-mu-gs" data-state="live" aria-hidden /> {copy('playing now')}</span>
          <span><span className="af-mu-gs" data-state="upcoming" aria-hidden /> {copy('yet to play')}</span>
        </p>
      ) : null}
      {data.league.bestBall ? <p className="af-mu-note">{copy('Best Ball scores your eligible full roster automatically. This board shows provider-listed starters; eligible bench players can also contribute.')}</p> : null}

      {tallied > 0 ? (
        <p className="af-mu-tally" data-leader={tally.you > tally.opponent ? 'you' : tally.you < tally.opponent ? 'opponent' : 'tied'}>
          <span className="af-mu-tally-n af-num" data-side="you">{tally.you}</span>
          <span className="af-mu-tally-label">
            {language === 'es'
              ? `posiciones ${live ? 'ganando' : 'proyectadas a favor'} · ${tally.opponent} en contra${tally.even ? ` · ${tally.even} igualadas` : ''}`
              : `${live ? 'slots winning' : 'slots projected to win'} · ${tally.opponent} losing${tally.even ? ` · ${tally.even} even` : ''}`}
          </span>
          {tallied < slots.length ? (
            <span className="af-mu-tally-of">
              {language === 'es' ? `de ${tallied} comparables` : `of ${tallied} comparable`}
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="af-mu-board" role="table" aria-label={copy('Head to head, slot by slot')}>
        <div className="af-mu-board-head" role="row">
          <span className="af-label af-mu-board-side" role="columnheader">
            {copy('You')}
          </span>
          <span className="af-label af-mu-board-slot" role="columnheader">
            {heading}
          </span>
          <span className="af-label af-mu-board-side af-mu-board-side--right" role="columnheader">
            {copy('Opponent')}
          </span>
        </div>

        {slots.map((slot, i) => {
          const edge = slotEdges(slot, live)
          return (
            <div className="af-mu-board-row" role="row" key={`${slot.slotLabel}-${i}`} data-edge={edge?.you}>
              <PlayerHalf cell={slot.you} align="left" live={live} edge={edge?.you ?? null} />
              <span className="af-mu-slot" role="cell">
                {slot.slotLabel}
              </span>
              <PlayerHalf cell={slot.opponent} align="right" live={live} edge={edge?.opponent ?? null} />
            </div>
          )
        })}

        <div className="af-mu-board-foot" role="row">
          {/* "—" when not one cell on that side had a number: a 0.0 total is a claim. */}
          <span className="af-mu-foot-total af-num">{yours.from === 0 ? '—' : yours.total.toFixed(1)}</span>
          <span className="af-mu-foot-label af-label">{copy(data.league.bestBall ? 'listed total' : live ? 'total' : 'projected')}</span>
          <span className="af-mu-foot-total af-mu-foot-total--right af-num">
            {theirs.from === 0 ? '—' : theirs.total.toFixed(1)}
          </span>
        </div>
        {/* AllFantasy's own engine, totalled the same way, before kickoff only. */}
        {!live && (yoursAf != null || theirsAf != null) ? (
          <div className="af-mu-board-foot af-mu-board-foot--af" role="row">
            <span className="af-mu-foot-total af-num">{yoursAf == null ? '—' : yoursAf.toFixed(1)}</span>
            <span className="af-mu-foot-label af-label">{copy('AF projected')}</span>
            <span className="af-mu-foot-total af-mu-foot-total--right af-num">
              {theirsAf == null ? '—' : theirsAf.toFixed(1)}
            </span>
          </div>
        ) : null}
      </div>

      {/*
        ⚠ COVERAGE SITS WITH THE TOTALS, BECAUSE THE TWO SIDES CAN BE SHORT BY
        DIFFERENT AMOUNTS. That does not merely make both columns low — it tilts
        the gap between them, which is the only thing anyone reads off this
        board.
      */}
      {yours.from < yours.of || theirs.from < theirs.of ? (
        <p className="af-mu-note">
          {language === 'es'
            ? `Calculado con ${yours.from} de tus ${yours.of} titulares y ${theirs.from} de sus ${theirs.of}; ambos totales pueden ser bajos en distinta medida.`
            : `Built from ${yours.from} of your ${yours.of} starters and ${theirs.from} of their ${theirs.of}, so both totals read low — and by different amounts.`}
        </p>
      ) : null}
    </>
  )
}

export function Matchup({ data }: MatchupProps) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  /*
   * The two numbers the banner compares: the scored totals when the week has
   * been scored, and the projected finals when it has not. Kept as one pair so
   * the margin chip below cannot end up comparing a score against a projection.
   */
  const scoredRaw = data.sides.available
    ? { you: data.sides.data.you.points, opponent: data.sides.data.opponent.points }
    : null
  /*
   * 🛑 0–0 BEFORE ANYONE HAS PLAYED IS NOT A SCORE. Once the NFL week opens on Thursday, the
   * platform publishes a matchup row at 0–0 for every league — including ones none of whose
   * starters play until Sunday. Treated as scored, that banner read "0.0 – 0.0 · Level" directly
   * under "Win probability 99%" (measured 2026-10-02, tablet, a 187–113 projected matchup). Until
   * a starter on either side has actually played, the banner compares the projections instead.
   */
  const anyStarterPlayed = data.lineups.available
    ? data.lineups.data.some((s) =>
        [s.you, s.opponent].some(
          (c) =>
            c != null &&
            !c.empty &&
            (c.gameState === 'live' || (c.gameState === 'final' && !c.unavailable) || (c.actual ?? 0) !== 0),
        ),
      )
    : data.starterCountsBySide != null
      ? data.starterCountsBySide.you.live + data.starterCountsBySide.you.final +
          data.starterCountsBySide.opponent.live + data.starterCountsBySide.opponent.final > 0
      : true
  const scored =
    scoredRaw && scoredRaw.you === 0 && scoredRaw.opponent === 0 && !anyStarterPlayed ? null : scoredRaw
  const projected = data.projectedFinal.available
    ? { you: data.projectedFinal.data.you, opponent: data.projectedFinal.data.opponent }
    : null
  const compared = scored ?? projected
  /* The AF engine's totals for the banner, from the same lineups the board below prices. */
  const afTotals = data.lineups.available
    ? { you: afEngineColumnTotal(data.lineups.data, 'you'), opponent: afEngineColumnTotal(data.lineups.data, 'opponent') }
    : null
  const weekState: 'final' | 'live' | 'upcoming' = !data.week.available
    ? 'upcoming'
    : data.week.data.isFinal
      ? 'final'
      : scored
        ? 'live'
        : 'upcoming'

  /* Who still has starters to play — the live banner's "N left to play" under each score. */
  const bySide = data.starterCountsBySide ?? null
  const yourLeft = weekState === 'live' ? leftFor(bySide?.you) : null
  const theirLeft = weekState === 'live' ? leftFor(bySide?.opponent) : null
  /*
   * Can anything on this page move within seconds? A starter's game in progress — the same test the
   * all-leagues board applies (`MatchupPulse.liveNow`).
   *
   * 🛑 NOT "A STARTER LEFT". Counting starters still to kick off (and unknown states as "maybe") held
   * this page on the 20s cadence from Thursday night to Monday, a full re-render each tick. An idle
   * page still refreshes every two minutes, and once just after the next kickoff below — so an
   * unknown game state is refreshed, not frozen.
   */
  const inPlay = bySide != null && bySide.you.live + bySide.opponent.live > 0
  /* The earliest kickoff among starters still to play, either side — the refresh wakes for it. */
  const nextKickoffAt = data.lineups.available
    ? data.lineups.data
        .flatMap((s) => [s.you, s.opponent])
        .filter((c): c is MatchupPlayerCell => c != null && !c.empty && c.gameState === 'upcoming' && !!c.kickoff)
        .map((c) => c.kickoff as string)
        .sort()[0] ?? null
    : null
  /*
   * A finished week renders no refresh control, so nothing held the route — and the shell's own
   * game-day timer then re-rendered a FINAL matchup every 20s whenever any game anywhere was on.
   * Nothing on a final page moves; claim the route so neither timer spends a render on it.
   */
  useEffect(() => (weekState === 'final' ? claimRouteRefresh() : undefined), [weekState])

  const leader =
    compared && compared.you !== compared.opponent
      ? compared.you > compared.opponent
        ? 'you'
        : 'opponent'
      : null

  const bannerRef = useRef<HTMLElement | null>(null)

  return (
    /*
      Every name in this lineup belongs to THIS league, so the card opens in
      its league flavour. One wrap rather than a `leagueId` prop threaded
      through LineupBoard and both PlayerHalf columns.
    */
    <PlayerCardLeagueScope leagueId={data.league.id}>
    <div className="af-mu">
      {data.teams.available ? (
        <StickyScore
          target={bannerRef}
          you={{ name: data.teams.data.you.teamName, value: scored?.you ?? projected?.you ?? null }}
          them={{ name: data.teams.data.opponent.teamName, value: scored?.opponent ?? projected?.opponent ?? null }}
          basis={scored ? 'scored' : 'projected'}
          pWin={data.winProbability.available ? data.winProbability.data.pWin : null}
          leader={leader}
        />
      ) : null}
      {/* ── Week banner ─────────────────────────────────────────────── */}
      <header className="af-mu-week">
        {/*
          The league is NAMED AND SHOWN. On an account with sixty leagues the
          only thing that told you which one you were looking at was a
          highlighted rail chip, which is a poor answer to "whose matchup is
          this".
        */}
        {data.league.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="af-mu-league-crest"
            src={data.league.logoUrl}
            alt=""
            width={24}
            height={24}
          />
        ) : (
          <span className="af-mu-league-crest af-mu-league-crest--none" aria-hidden>
            {initialsOf(data.league.name)}
          </span>
        )}
        {/*
          ⚠ THE PAGE HAD NO h1 AT ALL. Its outline began at "HEAD TO HEAD, SLOT
          BY SLOT", so a screen reader jumping by heading landed halfway down and
          nothing named the document — while the two sibling screens both have
          one (`/core/matchup` renders "Matchup", `/core/my-team?league=` renders
          the team name). The league is what this page is about and it is already
          the first thing in the banner, so it is the heading rather than a new
          one being invented above it.
        */}
        <h1 className="af-mu-league-name">{data.league.name}</h1>

        {data.week.available ? (
          <>
            {/*
              ‹ Week 4 › — last week's result and next week's matchup, one tap each. Links only to a
              week this league has results stored for (`weekNav`), so neither arrow can open a page
              that says "no weekly results stored".
            */}
            <span className="af-mu-weeknav">
              {data.weekNav?.prev != null ? (
                <Link
                  className="af-mu-weeknav-btn"
                  href={`/core/matchup?league=${encodeURIComponent(data.league.id)}&week=${data.weekNav.prev}`}
                  aria-label={`${copy('Week')} ${data.weekNav.prev}`}
                  prefetch={false}
                >
                  ‹
                </Link>
              ) : null}
              <span className="af-label af-mu-week-label">
                {copy('Week')} {data.week.data.week} · {data.week.data.season}
              </span>
              {data.weekNav?.next != null ? (
                <Link
                  className="af-mu-weeknav-btn"
                  href={`/core/matchup?league=${encodeURIComponent(data.league.id)}&week=${data.weekNav.next}`}
                  aria-label={`${copy('Week')} ${data.weekNav.next}`}
                  prefetch={false}
                >
                  ›
                </Link>
              ) : null}
            </span>
            {/*
              ⚠ "NOT SCORED" READ AS BROKEN. Before kickoff nothing is wrong: the
              week simply has not started, and the board below is a projection of
              it. Three states, named for what the manager is looking at.
            */}
            <span
              className="af-mu-week-state af-num"
              data-final={data.week.data.isFinal}
              data-state={weekState}
            >
              {copy(weekState === 'final' ? 'Final' : weekState === 'live' ? 'Live' : 'Upcoming')}
            </span>
            {/*
              ⚠ THIS PAGE USED TO BE A SNAPSHOT ON GAME DAY. The all-leagues board refreshed itself;
              the one-league board — the page someone actually watches during their game — sat on
              whatever it read at load until they pulled to reload. Same control, same cadence, same
              hidden-tab rule. A finished week has nothing left to move, so it gets none.
            */}
            {weekState !== 'final' ? (
              <MatchupPulseRefresh inPlay={inPlay} nextKickoffAt={nextKickoffAt} label={copy('Refresh this matchup')} />
            ) : null}
          </>
        ) : data.league.elimination ? (
          <span className="af-label af-mu-week-label">
            {copy(data.league.elimination === 'survivor_guillotine' ? 'Survivor Guillotine' : 'Guillotine')}
          </span>
        ) : (
          <span className="af-mu-unavailable">{matchupReasonText(data.week.reason, language)}</span>
        )}

      </header>

      {/*
        The provider hand-offs sit in their own row rather than inside the banner, so the
        league-first phone layout can drop them BELOW the lineup board (order in
        af-core-shell.css) — the score and both lineups first, "open it in Sleeper" after.
        Rendered only when there is a link: a native league has nothing to hand off to.
      */}
      {data.league.sourceLink || data.league.lineupLink ? (
        <div className="af-mu-handoff">
          {/*
            ⚠ THE ONLY PLACE ANYTHING CAN ACTUALLY CHANGE. AllFantasy is read-only
            for an imported league, so a screen that shows a losing matchup and no
            way to act on it is a dead end. The href is resolved server-side
            through one hardened resolver — never built here — and the component
            renders nothing at all for a native league.
          */}
          {data.league.sourceLink ? (
            <SourceActionLink
              link={data.league.sourceLink}
              className="af-btn af-mu-source"
            />
          ) : null}

          {/*
            The one tap from a swing alert to the fix (2026-09-14): the provider's lineup
            screen for YOUR team. Resolved server-side and only when that format is
            verified — see MatchupData.league.lineupLink.
          */}
          {data.league.lineupLink ? (
            <a
              className="af-btn af-mu-source"
              data-handoff="lineup"
              href={data.league.lineupLink.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy('Set lineup in')} {data.league.lineupLink.platformLabel} <span aria-hidden>↗</span>
            </a>
          ) : null}
        </div>
      ) : null}

      {data.league.elimination ? (
        /*
          🛑 NO VERSUS FOR AN ELIMINATION LEAGUE. The lowest score each week goes home, so the
          question is "am I above the chop line", which is a standings question — not "am I beating
          the roster a provider happened to pair me with". This page drew exactly that fake
          head-to-head, with a win probability, until 2026-10-02.
        */
        <section className="af-frame af-mu-section" aria-labelledby="af-mu-elim">
          <header className="af-mu-section-head">
            <h2 className="af-label" id="af-mu-elim">
              {copy('No head-to-head in this league')}
            </h2>
          </header>
          <p className="af-mu-basis">
            {language === 'es'
              ? 'En una liga guillotina compites contra toda la liga: cada semana se elimina la puntuación más baja, así que no hay un único rival.'
              : 'In a guillotine league you play the whole field: the lowest score each week is eliminated, so there is no single opponent to face.'}
          </p>
          <p className="af-mu-basis">
            <Link href={`/core/standings?league=${encodeURIComponent(data.league.id)}`} prefetch={false}>
              {copy('See where you stand against the chop line')} →
            </Link>
            {' · '}
            <Link href={`/core/my-team?league=${encodeURIComponent(data.league.id)}`} prefetch={false}>
              {copy('Check your lineup')} →
            </Link>
          </p>
        </section>
      ) : (
      <>
      {/* ── Head to head ────────────────────────────────────────────── */}
      <section className="af-frame af-mu-h2h" data-leader={leader ?? undefined} ref={bannerRef}>
        {data.teams.available ? (
          <>
            <TeamCard
              team={data.teams.data.you}
              points={scored?.you ?? null}
              projected={projected?.you ?? null}
              afProjected={afTotals?.you ?? null}
              leftToPlay={yourLeft}
              align="left"
            />

            <div className="af-mu-centre">
              <div className="af-label af-mu-centre-label">{copy('Win probability')}</div>
              {data.winProbability.available ? (
                <>
                  <div
                    className="af-mu-centre-value af-num"
                    data-tone={data.winProbability.data.pWin >= 0.5 ? 'good' : 'bad'}
                  >
                    {Math.round(data.winProbability.data.pWin * 100)}%
                  </div>
                  {/*
                    The same number as a bar — your share on the left, theirs on the right, matching
                    the two team cards either side of it. A percentage is read; a bar is SEEN, which
                    is what a glance at a phone mid-game needs.
                  */}
                  <div
                    className="af-mu-wp"
                    role="img"
                    aria-label={`${copy('Win probability')} ${Math.round(data.winProbability.data.pWin * 100)}%`}
                  >
                    <span
                      className="af-mu-wp-you"
                      style={{ width: `${Math.min(100, Math.max(0, data.winProbability.data.pWin * 100))}%` }}
                    />
                  </div>
                  {/*
                    ⚠ THE CONFIDENCE AND THE MODEL'S OWN SENTENCE STAY ATTACHED TO
                    THE NUMBER. A bare percentage reads as a measurement; this one
                    is a Gaussian over projected margins, and the detail line is
                    what stops it being mistaken for a count of simulated seasons.
                  */}
                  <p className="af-mu-centre-why">
                    {matchupReasonText(data.winProbability.data.detail, language)} ·{' '}
                    {matchupConfidenceText(data.winProbability.data.confidence, language)}
                  </p>
                </>
              ) : (
                <>
                  {/*
                    No percentage, on purpose. The reason is shown in its place so
                    the gap reads as a known absence rather than a value still
                    loading.
                  */}
                  <div className="af-mu-centre-dash af-num" aria-hidden>
                    —
                  </div>
                  <p className="af-mu-centre-why">{matchupReasonText(data.winProbability.reason, language)}</p>
                </>
              )}

              {/*
                ⚠ THE CHIP SAYS WHICH OF THE TWO IT IS MEASURING. "Ahead by 62.9"
                over an unplayed week is a projection, and a manager who reads it
                as a live lead has been told something false by a screen that
                knew better.
              */}
              {compared == null ? (
                <div className="af-mu-margin af-num" data-leader="unknown">
                  {copy('No margin yet')}
                </div>
              ) : leader ? (
                <div className="af-mu-margin af-num" data-leader={leader}>
                  {scored
                    ? leader === 'you'
                      ? copy('You lead by ')
                      : copy('Behind by ')
                    : leader === 'you'
                      ? copy('Projected ahead by ')
                      : copy('Projected behind by ')}
                  {Math.abs(compared.you - compared.opponent).toFixed(1)}
                </div>
              ) : (
                <div className="af-mu-margin af-num" data-leader="tied">
                  {copy(scored ? 'Level' : 'Projected level')}
                </div>
              )}
            </div>

            <TeamCard
              team={data.teams.data.opponent}
              points={scored?.opponent ?? null}
              projected={projected?.opponent ?? null}
              afProjected={afTotals?.opponent ?? null}
              leftToPlay={theirLeft}
              align="right"
            />

            {/*
              ⚠ THE UNSCORED-WEEK SENTENCE SURVIVES, IT JUST NO LONGER REPLACES
              THE BANNER. It is the reason the two numbers above it are
              projections, so it belongs UNDER them, inside the same frame —
              not in place of both crests.
            */}
            {data.sides.available ? null : (
              <p className="af-mu-basis">{matchupReasonText(data.sides.reason, language)}</p>
            )}
          </>
        ) : (
          <p className="af-mu-unavailable af-mu-unavailable--block">{matchupReasonText(data.teams.reason, language)}</p>
        )}
      </section>

      {/* ── Per-player scoring ──────────────────────────────────────── */}
      <section className="af-frame af-mu-section">
        <header className="af-mu-section-head">
          <h2 className="af-label">{copy('Head to head, slot by slot')}</h2>
        </header>
        <LineupBoard data={data} />
      </section>

      {/* ── What decides it ─────────────────────────────────────────── */}
      <section className="af-frame af-mu-section">
        <header className="af-mu-section-head">
          <h2 className="af-label">{copy('What decides it')}</h2>
        </header>
        <ul className="af-mu-missing">
          {/*
            The series with this manager. "Meetings on file", never "all-time": a Sleeper league gets a
            new id every season, so what is on file is this season's league.
          */}
          {data.headToHead && data.headToHead.meetings.length > 0 ? (
            <li>
              <span className="af-mu-missing-key">{copy('Head to head')}</span>
              <span className="af-mu-missing-value af-num">
                {data.headToHead.wins}–{data.headToHead.losses}
                {data.headToHead.ties ? `–${data.headToHead.ties}` : ''}
                <em className="af-mu-missing-caveat">
                  {' '}
                  — {language === 'es'
                    ? `enfrentamientos registrados; último: ${data.headToHead.meetings[0].you.toFixed(1)}–${data.headToHead.meetings[0].them.toFixed(1)} (sem. ${data.headToHead.meetings[0].week})`
                    : `meetings on file; last: ${data.headToHead.meetings[0].you > data.headToHead.meetings[0].them ? 'W' : data.headToHead.meetings[0].you < data.headToHead.meetings[0].them ? 'L' : 'T'} ${data.headToHead.meetings[0].you.toFixed(1)}–${data.headToHead.meetings[0].them.toFixed(1)} (wk ${data.headToHead.meetings[0].week})`}
                </em>
              </span>
            </li>
          ) : null}
          <li>
            <span className="af-mu-missing-key">{copy('Players yet to play')}</span>
            <span className="af-mu-missing-why">{matchupReasonText(data.yetToPlay.reason, language)}</span>
          </li>
          <li>
            <span className="af-mu-missing-key">{copy(data.projectedFinal.available && data.projectedFinal.data.model === 'best_ball_full_roster' ? 'Projected Best Ball final' : 'Projected final')}</span>
            {data.projectedFinal.available ? (
              <span className="af-mu-missing-value af-num">
                {data.projectedFinal.data.you.toFixed(1)} –{' '}
                {data.projectedFinal.data.opponent.toFixed(1)}
                {data.projectedFinal.data.model === 'best_ball_full_roster' ? (
                  <em className="af-mu-missing-caveat"> — {copy('highest projected legal lineup from each eligible full roster')}</em>
                ) : null}
                {/*
                  ⚠ SHOWN WHENEVER EITHER SIDE IS SHORT, BECAUSE THE TWO SIDES CAN
                  BE SHORT BY DIFFERENT AMOUNTS. That does not just make both totals
                  low, it tilts the comparison — the side missing more starters
                  looks like it is losing when it may not be.
                */}
                {data.projectedFinal.data.unprojected.you +
                  data.projectedFinal.data.unprojected.opponent >
                0 ? (
                  <em className="af-mu-missing-caveat">
                    {' '}
                    — {language === 'es'
                      ? `calculado sin ${data.projectedFinal.data.unprojected.you} de tus titulares y ${data.projectedFinal.data.unprojected.opponent} de los suyos; ambos totales pueden ser bajos`
                      : `built without ${data.projectedFinal.data.unprojected.you} of your starters and ${data.projectedFinal.data.unprojected.opponent} of theirs, so both totals read low`}
                  </em>
                ) : null}
              </span>
            ) : (
              <span className="af-mu-missing-why">{matchupReasonText(data.projectedFinal.reason, language)}</span>
            )}
          </li>
        </ul>
      </section>
      </>
      )}
    </div>
    </PlayerCardLeagueScope>
  )
}

export default Matchup
