'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-player-finder.css'
import { PlayerVerdict } from '@/components/core-app/player-finder/PlayerVerdict'
import { SwapCandidates } from '@/components/core-app/player-finder/SwapCandidates'
import { RecommendedMoves } from '@/components/core-app/player-finder/RecommendedMoves'
import { LeagueOwnershipCard } from '@/components/core-app/player-finder/LeagueOwnershipCard'
import { HelpDot } from '@/components/core-app/player-finder/HelpDot'
import { playerRef } from '@/lib/core-app/playerRef'
import { composePlayerMoves, readiness, type PlayerMove } from '@/lib/core-app/playerMoves'
import { platformLabel } from '@/lib/core-app/platformLinks'
import type { LeagueImpact } from '@/lib/core-app/playerImpact'
import type { LeagueSlot, PlayerDetail, PlayerMatch } from '@/lib/core-app/playerFinder'
import type { PlayerLeagueView } from '@/lib/core-app/playerLeagueView'
import type { SectionState } from '@/lib/core-app/leagueHome'

/**
 * Screen 3 — Player Finder.
 *
 * "One name in — every platform, league, slot, injury and the move to make."
 *
 * The handoff prints a line under the search box that is really a promise:
 * "Stats, injuries and news come from live sports data — never an invented
 * number." This screen keeps it literally — every figure shown is read from an
 * ingested row, and everything we cannot compute says so in words instead of
 * rendering a dash that looks like a measurement.
 *
 * ── THREE VIEWS, ONE DOM ─────────────────────────────────────────────────────
 *
 *   CORE     /core/players — every league you play, at once. The 360 | 1fr | 384
 *            grid: search rail, main column, decision column.
 *   LEAGUE   /core/players?league=… — the same screen with `leagueView` on top:
 *            in THIS league, is he yours, someone's (named), or free. It is a
 *            promotion, not a filter (38a·4): the cross-league table stays.
 *   MOBILE   ≤720px — search, player card, the league list, the verdict with
 *            its "Open in <platform>" buttons. The stat tiles, move cards and
 *            season table are desktop-only; the verdict card carries the move.
 *            Same DOM, ordered so the phone reads top-to-bottom without a
 *            second copy of anything — see af-player-finder.css.
 *
 * ⚠ TWO PANELS IN THE DESIGN ARE NOT BUILT, ON PURPOSE, BECAUSE NOTHING BACKS
 * THEM. Measured before building rather than discovered afterwards:
 *
 *   - INJURY TIMELINE (WED DNP / THU LP / FRI FP). No provider we ingest carries
 *     practice participation; `sportsInjury` holds a status and a description and
 *     nothing else. The status we DO have renders as the readiness chip.
 *   - TRADE WINDOW · WHO'S AROUND NOW. Needs per-manager presence ("usually on
 *     Sun 10a–12p", "online now"). `IntelligenceManagerSnapshot.lastActiveAt` is
 *     the only candidate and it is keyed on an import-side manager key with no
 *     join to `LeagueTeam`; nothing else records when a manager is in the app.
 *     Building the panel on that would print a guess beside a real name.
 *   - RECENTLY SEARCHED. Nothing persists a per-user search history.
 *   - SEASON AVG. `PlayerGameStat.fantasyPoints` defaults to 0 and is written
 *     under whichever scoring the importer used — not this league's, not
 *     standard. An average of that would be a number with no name.
 *
 * ⚠ THE CHIMMY CARD IS COMPUTED, NOT GENERATED — see PlayerVerdict for why a
 * page-load LLM call was rejected.
 */

export type PlayerFinderProps = {
  query: string
  matches: PlayerMatch[]
  detail: PlayerDetail | null
  leagueCount: number
  /**
   * The league held in the rail, when there is one (38a·4).
   *
   * ⚠ IT PROMOTES AND MARKS, IT DOES NOT FILTER. The handoff scopes this screen
   * to "in THIS league", but a player's whole value on a Sunday is that you can
   * see every league he is in at once — hiding the other eight to honour the
   * scoping would remove the reason the screen exists. So the held league sorts
   * to the top and is labelled; the rest stay below it.
   */
  selectedLeagueId?: string | null
  /**
   * The league-scoped answer for the held league — who has him there. Loaded
   * by the page only when a league is in context and the player resolved to a
   * platform id; null otherwise, and the screen renders no card.
   */
  leagueView?: PlayerLeagueView | null
  /**
   * False on the public `/players/{slug}` surface when nobody is signed in.
   *
   * ⚠ THIS CHANGES WHY A SECTION IS EMPTY, WHICH IS THE WHOLE POINT. The
   * per-league loaders are handed no user and no league ids, so they correctly
   * report that they cannot cross-reference — but "we have no platform id for
   * this player" is a statement about our ingest, and to a signed-out visitor
   * the true statement is "you are not signed in". Showing the ingest reason to
   * a stranger reads as a broken product rather than as a locked door.
   *
   * Defaults to true so every existing signed-in call site is unchanged.
   */
  signedIn?: boolean
}

function Unavailable({ reason }: { reason: string }) {
  return <p className="af-pf-unavailable">{reason}</p>
}

/**
 * The detail headshot, with the one-letter placeholder as the fallback for a
 * missing image AND for one the CDN 404s. The failed src is remembered rather
 * than a boolean so a different player's image gets a fresh attempt.
 */
function Headshot({ src, name }: { src: string | null; name: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!src || src === failedSrc) {
    return (
      <div className="af-pf-headshot af-pf-headshot--none" aria-hidden>
        {name.charAt(0)}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="af-pf-headshot"
      src={src}
      alt=""
      width={72}
      height={72}
      onError={() => setFailedSrc(src)}
    />
  )
}

function StatTile({
  label,
  help,
  tip,
  state,
  value,
  tone,
}: {
  label: string
  help?: string
  /** The `?` beside the label, per the handoff's tooltip pattern. */
  tip?: { title: string; body: string }
  state?: SectionState<unknown>
  value?: string | null
  tone?: 'good' | 'warn' | 'bad'
}) {
  const missing = state ? !state.available : value == null
  return (
    <div className="af-pf-tile" data-missing={missing} data-tone={missing ? undefined : tone}>
      <div className="af-pf-tile-value af-num">{missing ? '—' : value}</div>
      <div className="af-pf-tile-label">
        <span className="af-label">{label}</span>
        {tip ? <HelpDot title={tip.title} body={tip.body} /> : null}
      </div>
      {missing && state && !state.available ? (
        <div className="af-pf-tile-why">{state.reason}</div>
      ) : help ? (
        <div className="af-pf-tile-why">{help}</div>
      ) : null}
    </div>
  )
}

/**
 * The signed-out replacement for a per-league section's reason.
 *
 * One sentence, and it names what is behind the door rather than just asking for
 * a sign-in — the sections it covers are the reason this page is worth an
 * account at all.
 */
const SIGN_IN_REASON =
  'Sign in to see which of your leagues roster him, what slot he is in, and what he is worth under each league’s own scoring.'

/** "Sleeper and ESPN", "Sleeper, ESPN and Yahoo". */
function listPlatforms(platforms: string[]): string {
  const names = [...new Set(platforms.map(platformLabel))]
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function slotTone(slot: string, move: PlayerMove | undefined): 'good' | 'warn' | 'bad' | 'none' {
  if (slot === 'STARTER') return 'good'
  if (slot === 'IR SLOT') return 'warn'
  if (slot === 'BENCH' || slot === 'TAXI') return move ? 'bad' : 'none'
  return 'none'
}

/**
 * One row of "Every platform, every league": the league slot joined to its
 * impact row (league-scored points) and to the move that fixes it, if any.
 */
type LeagueRow = {
  slot: LeagueSlot
  impact: LeagueImpact | undefined
  move: PlayerMove | undefined
  held: boolean
}

const ROW_RANK: Record<string, number> = { bad: 0, warn: 1, none: 2, good: 3, other: 4 }

function rowTone(r: LeagueRow): 'bad' | 'warn' | 'none' | 'good' | 'other' {
  if (!r.slot.isYours) return 'other'
  if (r.move) return r.move.tone === 'good' ? 'none' : r.move.tone
  return r.slot.slot === 'STARTER' ? 'good' : 'none'
}

function rowAction(r: LeagueRow, last: string): ReactNode {
  if (!r.slot.isYours) {
    return (
      <Link href={`/core/trades?league=${encodeURIComponent(r.slot.leagueId)}`} className="af-pf-link">
        Trade for {last} →
      </Link>
    )
  }
  if (r.move && r.move.tone !== 'good' && r.move.link) {
    return r.move.link.external ? (
      <a className="af-pf-link" href={r.move.link.href} target="_blank" rel="noopener noreferrer">
        Where to fix it →
      </a>
    ) : (
      <Link className="af-pf-link" href={r.move.link.href}>
        Where to fix it →
      </Link>
    )
  }
  if (r.slot.slot === 'STARTER') return <span className="af-pf-nothing">Nothing to do</span>
  if (r.impact?.startOver && r.impact.startOver.delta <= 0) {
    return (
      <span className="af-pf-nothing" title={`${r.impact.startOver.name} projects higher in that slot`}>
        Bench is right
      </span>
    )
  }
  if (r.slot.slot === 'IR SLOT') return <span className="af-pf-nothing">On IR — no report says otherwise</span>
  return (
    <span className="af-pf-nothing" title={r.impact && !r.impact.afPoints.available ? r.impact.afPoints.reason : undefined}>
      No call — unpriced
    </span>
  )
}

export function PlayerFinder({
  query,
  matches,
  detail,
  leagueCount,
  selectedLeagueId = null,
  leagueView = null,
  signedIn = true,
}: PlayerFinderProps) {
  /*
   * Swap the ingest-level reason for the sign-in one on exactly the sections
   * that are gated. Everything else on this screen — bio, injury, projection,
   * season statistics — is public sports data and keeps its real reason.
   */
  const gatedReason = (state: SectionState<unknown> | { available: false; reason: string }) =>
    !signedIn ? SIGN_IN_REASON : (state as { reason: string }).reason

  const leagueParam = selectedLeagueId ? `&league=${encodeURIComponent(selectedLeagueId)}` : ''

  // ── Derived, once, from the loaders' output ──────────────────────────────
  const impactRows: LeagueImpact[] = detail?.impact.available ? detail.impact.data : []
  const impactById = new Map(impactRows.map((i) => [i.leagueId, i]))
  const injuryStatus = detail?.injury.available ? detail.injury.data.status : null
  const moves: PlayerMove[] = detail
    ? composePlayerMoves({
        playerName: detail.player.name,
        injuryStatus,
        impact: impactRows,
        freeAgents: detail.recommendedMoves.available ? detail.recommendedMoves.data : [],
      })
    : []
  const moveByLeague = new Map<string, PlayerMove>()
  for (const m of moves) if (m.tone !== 'good' && !moveByLeague.has(m.leagueId)) moveByLeague.set(m.leagueId, m)
  const ready = detail ? readiness(injuryStatus, detail.injury.available) : null
  const last = detail ? (detail.player.name.trim().split(/\s+/).slice(-1)[0] ?? detail.player.name) : ''

  const leagueRows: LeagueRow[] = (detail?.leagues.available ? detail.leagues.data : [])
    .map((slot) => ({
      slot,
      impact: impactById.get(slot.leagueId),
      move: moveByLeague.get(slot.leagueId),
      held: slot.leagueId === selectedLeagueId,
    }))
    /*
     * The held league first, then what needs you: a wrong slot outranks a right
     * one, and a league where someone else has him comes last — it is context
     * for a trade, not a lineup to fix.
     */
    .sort((a, b) => {
      if (a.held !== b.held) return a.held ? -1 : 1
      return ROW_RANK[rowTone(a)] - ROW_RANK[rowTone(b)]
    })

  const yoursCount = leagueRows.filter((r) => r.slot.isYours).length
  const otherMatches = detail
    ? matches.filter((m) => !(m.externalId === detail.player.externalId && m.sport === detail.player.sport))
    : matches

  return (
    <div className="af-core af-pf af-pf--2a" data-public={!signedIn} data-has-detail={Boolean(detail)}>
      {/* ── Search rail (360px) ─────────────────────────────────────── */}
      {/*
        The rail owns the search, the matches and the live-data promise. h1 is
        "Player Finder" and the player name is h2 — the SEO order the handoff
        specifies.
      */}
      <aside className="af-pf-rail" aria-label="Search">
        <h1 className="af-display af-pf-h1">Player Finder</h1>
        <form className="af-pf-search-wrap" method="get" action="/core/players">
          {/* Keeps the held league in context across a new search. */}
          {selectedLeagueId ? <input type="hidden" name="league" value={selectedLeagueId} /> : null}
          <label className="af-search af-pf-search">
            <span className="af-search-icon" aria-hidden>
              ○
            </span>
            <input
              className="af-search-input"
              name="q"
              defaultValue={query}
              placeholder="Search any player"
              aria-label="Search any player"
              autoComplete="off"
            />
            <button type="submit" className="af-btn af-pf-search-btn">
              Search
            </button>
          </label>
          <p className="af-pf-search-note">
            {signedIn
              ? 'Searches every platform you have connected at once — Sleeper, ESPN and Yahoo.'
              : 'One search covers Sleeper, ESPN and Yahoo at once. Connect a league to see your own slots and matchups.'}
          </p>
        </form>

        {/*
          ── Matches ─────────────────────────────────────────────────
          Suppressed entirely on the public page, where there is no query and
          nothing to match: a "MATCHES · 0" header above "type at least two
          characters" is the search box restating itself, and on a page a
          stranger landed on from Google it reads as a failed search they never
          ran.

          On a phone with a player already resolved, the full card is hidden
          and the OTHER matches collapse to a chip row under the search — the
          player card is what the screen was opened for, and it goes first.
        */}
        {signedIn || matches.length > 0 ? (
          <section className={`af-card af-pf-matches${detail ? ' af-pf-d-only' : ''}`}>
            <header className="af-pf-section-head">
              <h2 className="af-label">Matches · {matches.length}</h2>
            </header>

            {matches.length === 0 ? (
              <p className="af-pf-unavailable">
                {query.trim().length < 2
                  ? 'Type at least two characters to search.'
                  : `No player matching “${query}”.`}
              </p>
            ) : (
              <ul className="af-pf-match-list">
                {matches.map((m) => (
                  <li key={`${m.sport}-${m.externalId}`}>
                    <Link
                      // Sport-qualified: `externalId` alone is ambiguous across
                      // sports and opened whichever athlete came back first.
                      href={`/core/players?q=${encodeURIComponent(query)}&player=${encodeURIComponent(playerRef(m.sport, m.externalId))}${leagueParam}`}
                      className="af-pf-match"
                      data-active={
                        detail?.player.externalId === m.externalId && detail?.player.sport === m.sport
                      }
                    >
                      <span className="af-pf-match-name">{m.name}</span>
                      <span className="af-pf-match-meta">
                        {[m.position, m.team].filter(Boolean).join(' · ') || 'no position on file'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {detail && otherMatches.length > 0 ? (
          <div className="af-pf-m-only af-pf-others" aria-label="Other matches">
            <span className="af-label">Also matched</span>
            {otherMatches.slice(0, 4).map((m) => (
              <Link
                key={`${m.sport}-${m.externalId}`}
                href={`/core/players?q=${encodeURIComponent(query)}&player=${encodeURIComponent(playerRef(m.sport, m.externalId))}${leagueParam}`}
                className="af-chip af-pf-other"
              >
                {m.name}
                {m.position ? <span className="af-pf-other-pos af-num">{m.position}</span> : null}
              </Link>
            ))}
          </div>
        ) : null}

        {/*
          The live-data promise is pinned to the foot of the rail, where the
          handoff puts it. It is a claim about every number on this screen, so
          it belongs beside the search rather than buried under one section.
        */}
        <p className="af-pf-rail-foot af-pf-d-only">
          Stats, injuries and news come from live sports data — never an invented
          number.
        </p>
      </aside>

      <main className="af-pf-main">
        {/* ── The league in context: who has him HERE ─────────────────── */}
        {detail && leagueView ? <LeagueOwnershipCard view={leagueView} playerName={detail.player.name} /> : null}

        {/* ── Detail ────────────────────────────────────────────────── */}
        {detail ? (
          <section className="af-card af-pf-detail">
            <header className="af-pf-detail-head">
              <Headshot src={detail.player.imageUrl} name={detail.player.name} />

              <div className="af-pf-identity">
                <div className="af-pf-name-row">
                  <h2 className="af-display af-pf-name">{detail.player.name}</h2>
                  {/*
                    Readiness, from the injury feed. No row means no chip — the
                    injury section below says "no designation on file", which is
                    not the same claim as READY.
                  */}
                  {ready ? (
                    <span className="af-chip af-num af-pf-ready" data-tone={ready.tone}>
                      {ready.label}
                      {detail.injury.available &&
                      detail.injury.data.description &&
                      detail.injury.data.description.length <= 28
                        ? ` · ${detail.injury.data.description}`
                        : ''}
                    </span>
                  ) : null}
                </div>
                <div className="af-pf-line">
                  {[
                    detail.player.position,
                    detail.player.team,
                    detail.player.number != null ? `#${detail.player.number}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  {signedIn && detail.leagues.available ? (
                    <span className="af-pf-rostered">
                      {' · '}
                      {yoursCount > 0
                        ? `on ${yoursCount} of your ${leagueCount} ${leagueCount === 1 ? 'league' : 'leagues'}${
                            detail.player.platforms.length > 0 ? `, across ${listPlatforms(detail.player.platforms)}` : ''
                          }`
                        : `not on any of your ${leagueCount} ${leagueCount === 1 ? 'league' : 'leagues'}`}
                      {leagueRows.some((r) => !r.slot.isYours)
                        ? ` · rostered by others in ${leagueRows.filter((r) => !r.slot.isYours).length}`
                        : ''}
                    </span>
                  ) : !signedIn ? (
                    <span className="af-pf-rostered"> · sign in to see him across your leagues</span>
                  ) : (
                    <span className="af-pf-rostered"> · cross-league lookup unavailable</span>
                  )}
                </div>
              </div>

              <span className="af-sync af-num" data-stale={detail.freshness.stale}>
                {detail.freshness.stale ? '⚠ ' : ''}
                {detail.freshness.label}
              </span>
            </header>

            {/* Stat tiles — a missing one says why rather than showing a bare dash */}
            <div className="af-pf-tiles af-pf-d-only">
              {/*
                ⚠ "STANDARD SCORING" IS SAID OUT LOUD BECAUSE THE FEED IS NOT
                LEAGUE-SPECIFIC. This screen spans every league the user is in, and
                the same player is worth different points in each. The per-league
                number is in the table below; this tile is the one feed number.
              */}
              <StatTile
                label={detail.projection.available ? `Proj wk ${detail.projection.data.week}` : 'Proj this week'}
                state={detail.projection}
                value={detail.projection.available ? detail.projection.data.points.toFixed(1) : null}
                tone="good"
                tip={{
                  title: 'Projection',
                  body: 'The projection feed’s standard-scoring number for this week. What he is worth in each of YOUR leagues — under that league’s own scoring — is the PROJ column in the table below.',
                }}
                help={
                  detail.projection.available
                    ? `Standard scoring · ${detail.projection.data.season}`
                    : undefined
                }
              />
              <StatTile
                label="Pos rank"
                state={detail.positionRank}
                value={
                  detail.positionRank.available
                    ? `${detail.positionRank.data.position}${detail.positionRank.data.rank}`
                    : null
                }
                tone="warn"
                // The denominator lives here rather than in the value so the tile
                // reads "WR12 / of 143 projected" — a rank AND its universe.
                help={
                  detail.positionRank.available
                    ? `of ${detail.positionRank.data.outOf} projected ${detail.positionRank.data.position}s`
                    : undefined
                }
              />
              <StatTile
                label="Snap share"
                state={detail.snapShare}
                value={
                  detail.snapShare.available
                    ? `${Math.round(detail.snapShare.data.share * 100)}%`
                    : null
                }
                tip={{
                  title: 'Snap share',
                  body: 'Share of his team’s offensive plays he was on the field for, over the games we hold. Rising snap share usually comes before rising points.',
                }}
                help={
                  detail.snapShare.available
                    ? `${detail.snapShare.data.basis === 'defense' ? 'Defensive' : 'Offensive'} snaps · ${detail.snapShare.data.games} game${detail.snapShare.data.games === 1 ? '' : 's'}`
                    : undefined
                }
              />
              <StatTile
                label="Age"
                value={detail.bio.age != null ? String(detail.bio.age) : null}
                help={detail.bio.age == null ? 'no birth date on file' : undefined}
              />
            </div>

            {/* ── Injury ────────────────────────────────────────────── */}
            <section className="af-pf-block af-pf-d-only">
              <h3 className="af-label">Injury</h3>
              {detail.injury.available ? (
                <div className="af-pf-injury">
                  <span className="af-chip af-pf-injury-status">
                    {detail.injury.data.status ?? 'no designation'}
                  </span>
                  {detail.injury.data.description ? (
                    <p className="af-pf-injury-note">{detail.injury.data.description}</p>
                  ) : null}
                </div>
              ) : (
                <Unavailable reason={detail.injury.reason} />
              )}
            </section>

            {/* ── Every platform, every league ──────────────────────── */}
            {/*
              ⚠ THIS IS THE DECISION TABLE, NOT A REFERENCE LIST. Slot truth beats
              projection: a bench or IR row with a good number is the headline
              problem, and it is coloured as one. Each row carries the league's
              OWN scoring result — never the feed number — and ends in where to
              fix it, or "nothing to do", or "trade for him" when someone else
              has him.
            */}
            <section className="af-pf-block af-pf-leagues" aria-labelledby="af-pf-leagues-h">
              <header className="af-pf-block-head">
                <h3 className="af-pf-h3" id="af-pf-leagues-h">
                  Every platform, every league
                </h3>
                <p className="af-pf-block-sub">Slot and status as they stand right now</p>
              </header>
              {/*
                ⚠ SIGNED OUT, "AVAILABLE WITH ZERO ROWS" IS NOT AN ANSWER. The
                loader is handed an empty league list and correctly returns an
                empty array marked available — but rendering that as "he is not
                rostered in any league you have connected" tells a stranger a
                fact about leagues they do not have. The signed-out branch is
                checked first for that reason.
              */}
              {!signedIn ? (
                <>
                  <Unavailable reason={SIGN_IN_REASON} />
                  <Link href="/signup" className="af-btn af-pf-signin">
                    Connect a league — it is free
                  </Link>
                </>
              ) : detail.leagues.available ? (
                leagueRows.length === 0 ? (
                  <p className="af-pf-unavailable">
                    He is not on any roster in the {leagueCount} {leagueCount === 1 ? 'league' : 'leagues'} you have connected.
                  </p>
                ) : (
                  <table className="af-pf-table">
                    <thead>
                      <tr>
                        <th className="af-label">League</th>
                        <th className="af-label">Slot</th>
                        <th className="af-label af-pf-col-status">Status</th>
                        <th className="af-label af-pf-col-proj">Proj</th>
                        <th className="af-label" />
                      </tr>
                    </thead>
                    <tbody>
                      {leagueRows.map((r) => {
                        const l = r.slot
                        const tone = rowTone(r)
                        return (
                          <tr key={l.leagueId} data-tone={tone} data-held={r.held}>
                            <td className="af-pf-col-league">
                              <Link href={`/core?league=${encodeURIComponent(l.leagueId)}`} className="af-pf-league-name">
                                {l.leagueName}
                              </Link>
                              <span className="af-pf-league-meta">
                                <span className="af-platform af-pf-platform" data-platform={l.platform}>
                                  {l.platform}
                                </span>
                                {l.format ? <span>{l.format}</span> : null}
                                {!l.isYours ? (
                                  <span className="af-pf-owner">
                                    {l.owner
                                      ? `rostered by ${l.owner.ownerName ? `@${l.owner.ownerName}` : l.owner.teamName}`
                                      : 'rostered by another manager'}
                                  </span>
                                ) : null}
                                {r.held ? <span className="af-pf-impact-held af-label">This league</span> : null}
                              </span>
                            </td>
                            <td className="af-pf-col-slot">
                              <span className="af-chip af-num af-pf-slot" data-tone={slotTone(l.slot, r.move)}>
                                {r.impact?.exactSlot ?? l.slot}
                              </span>
                              {r.impact && !r.impact.slotConfirmed ? (
                                <span className="af-pf-impact-unconfirmed">slot unconfirmed</span>
                              ) : null}
                            </td>
                            <td className="af-pf-col-status">
                              {l.isYours && ready ? (
                                <span className="af-pf-status af-num" data-tone={ready.tone}>
                                  {ready.label}
                                </span>
                              ) : (
                                <span className="af-pf-nothing">—</span>
                              )}
                            </td>
                            <td className="af-pf-col-proj">
                              {l.isYours && r.impact?.afPoints.available ? (
                                <span
                                  className="af-pf-proj af-num"
                                  title={`this league’s scoring · ${r.impact.afPoints.data.matchedKeys}/${r.impact.afPoints.data.scoredKeys} keys`}
                                >
                                  {r.impact.afPoints.data.points.toFixed(1)}
                                </span>
                              ) : (
                                <span
                                  className="af-pf-nothing"
                                  title={l.isYours && r.impact && !r.impact.afPoints.available ? r.impact.afPoints.reason : undefined}
                                >
                                  —
                                </span>
                              )}
                            </td>
                            <td className="af-pf-table-action">{rowAction(r, last)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              ) : (
                <Unavailable reason={gatedReason(detail.leagues)} />
              )}
              {signedIn && detail.leagues.available && leagueRows.some((r) => r.slot.isYours) && !detail.impact.available ? (
                <p className="af-pf-unavailable">{detail.impact.reason}</p>
              ) : null}
            </section>

            {/* ── Recommended moves ─────────────────────────────────── */}
            {signedIn ? (
              <div className="af-pf-d-only">
                <RecommendedMoves
                  moves={moves}
                  emptyReason={
                    !detail.impact.available
                      ? detail.impact.reason
                      : impactRows.length === 0
                        ? 'He is not on any of your rosters, so there is no lineup to fix.'
                        : null
                  }
                />
              </div>
            ) : null}

            {/* ── Season stats ──────────────────────────────────────── */}
            <section className="af-pf-block af-pf-d-only">
              <h3 className="af-label">Season statistics</h3>
              {detail.seasonStats.available ? (
                <ul className="af-pf-seasons">
                  {detail.seasonStats.data.map((s) => (
                    <li key={s.season} className="af-pf-season">
                      <span className="af-num af-pf-season-year">{s.season}</span>
                      <span className="af-pf-season-stats">
                        {Object.entries(s.stats)
                          .slice(0, 6)
                          .map(([k, v]) => `${k} ${v}`)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Unavailable reason={detail.seasonStats.reason} />
              )}
            </section>
          </section>
        ) : (
          <section className="af-card af-pf-detail af-pf-detail--empty">
            <p className="af-pf-unavailable">Pick a match to see slots, injury and season history.</p>
          </section>
        )}
      </main>

      {/*
        The decision column. It renders only when there is a resolved player AND
        real per-league impact behind it — an empty rail of headed cards would
        imply we looked and found nothing, which is different from not looking.
      */}
      {detail && impactRows.length > 0 ? (
        <aside className="af-pf-side" aria-label="What to do">
          <PlayerVerdict playerName={detail.player.name} impact={impactRows} moves={moves} />
          <SwapCandidates impact={impactRows} />
        </aside>
      ) : null}
    </div>
  )
}

export default PlayerFinder
