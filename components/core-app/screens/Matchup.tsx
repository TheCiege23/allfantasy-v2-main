'use client'

import '@/components/core-app/af-matchup.css'
import PlayerName from '@/components/core-app/player-card/PlayerName'
import { PlayerCardLeagueScope } from '@/components/core-app/player-card/PlayerCardProvider'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'
import { SourceActionLink } from '@/components/league-links/SourceActionLink'
import { useState } from 'react'
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
  align,
}: {
  team: MatchupTeam
  points: number | null
  projected: number | null
  /** AllFantasy's own engine total for this lineup. Shown only before a point is scored. */
  afProjected?: number | null
  align: 'left' | 'right'
}) {
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
          {[team.isYou ? 'You' : team.ownerName || null, team.record].filter(Boolean).join(' · ') ||
            'no record on file'}
        </div>
      </div>
      <div className="af-mu-score-stack" data-align={align}>
        <div className="af-mu-score af-num" data-basis={points != null ? 'scored' : 'projected'}>
          {showing == null ? '—' : showing.toFixed(1)}
        </div>
        {points == null && showing != null ? (
          <span className="af-mu-score-tag af-label">proj</span>
        ) : null}
        {points == null && afProjected != null ? (
          <span className="af-mu-score-af af-num" title="AllFantasy engine projection for this lineup, adjusted to this league's scoring">
            AF {afProjected.toFixed(1)}
          </span>
        ) : null}
      </div>
    </div>
  )
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
}: {
  cell: MatchupPlayerCell | null
  align: 'left' | 'right'
  live: boolean
}) {
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
          <div className="af-mu-half-name">Slot empty</div>
          <div className="af-mu-half-sub">nobody is started here</div>
        </div>
        <div className="af-mu-half-pts af-num">—</div>
      </div>
    )
  }

  const crest = cell.team ? teamLogoUrl(cell.sport ?? 'NFL', cell.team) : null
  const imageUrl = cell.imageUrl && cell.imageUrl !== failedImageUrl ? cell.imageUrl : null
  const value = live ? cell.actual : cell.projected

  return (
    <div className="af-mu-half" data-align={align} data-state="player">
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
            <span className="af-mu-half-unresolved">Unresolved player</span>
          )}
        </div>
        <div className="af-mu-half-sub">
          {cell.name
            ? [cell.position, cell.team].filter(Boolean).join(' · ') || 'no position on file'
            : `id ${cell.playerId}`}
        </div>
      </div>
      {/*
        ⚠ "—" IS NOT 0.0. A player we could not price has no number. A 0.0 is a
        claim, and the only projected ones we make are a starter ruled out or on
        bye — which is why the reason sits beside the number rather than leaving
        a bare zero to be read as a bad projection. Here, not beside the name:
        the name truncates, and this column never does.
      */}
      <div className="af-mu-half-pts af-num" data-unpriced={value == null}>
        {cell.unavailable ? (
          <span
            className="af-mu-flag"
            title={
              cell.unavailable === 'bye'
                ? 'His team is not playing this week. A starter on bye is a guaranteed zero.'
                : 'Unavailable this week. In Best Ball, another eligible roster player can replace this player automatically.'
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
          <span className="af-mu-half-af" title="AllFantasy engine projection, adjusted to this league's scoring">
            AF {cell.afEngine.toFixed(1)}
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

/** Sum of a column, and how many of its cells it was built from. */
function columnTotal(slots: MatchupSlot[], key: 'you' | 'opponent', live: boolean) {
  let total = 0
  let from = 0
  let of = 0
  for (const s of slots) {
    const cell = s[key]
    if (!cell || cell.empty) continue
    of += 1
    const v = live ? cell.actual : cell.projected
    if (v == null) continue
    total += v
    from += 1
  }
  return { total: Math.round(total * 10) / 10, from, of }
}

function LineupBoard({ data }: { data: MatchupData }) {
  if (!data.lineups.available) {
    return <p className="af-mu-unavailable">{data.lineups.reason}</p>
  }

  const live = data.playerScoring.available
  const slots = data.lineups.data
  const yours = columnTotal(slots, 'you', live)
  const theirs = columnTotal(slots, 'opponent', live)
  const yoursAf = afEngineColumnTotal(slots, 'you')
  const theirsAf = afEngineColumnTotal(slots, 'opponent')
  // Before kickoff each cell carries two projections: the provider's (API) and AllFantasy's (AF).
  const heading = live ? 'PTS' : 'API · AF'

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
          ? `Live points as ${data.playerScoring.data.source} scored them — ${data.playerScoring.data.playersScored} players on file.`
          : data.playerScoring.reason}
      </p>
      {data.league.bestBall ? <p className="af-mu-note">Best Ball scores your eligible full roster automatically. This board shows provider-listed starters; eligible bench players can also contribute.</p> : null}

      <div className="af-mu-board" role="table" aria-label="Head to head, slot by slot">
        <div className="af-mu-board-head" role="row">
          <span className="af-label af-mu-board-side" role="columnheader">
            You
          </span>
          <span className="af-label af-mu-board-slot" role="columnheader">
            {heading}
          </span>
          <span className="af-label af-mu-board-side af-mu-board-side--right" role="columnheader">
            Opponent
          </span>
        </div>

        {slots.map((slot, i) => (
          <div className="af-mu-board-row" role="row" key={`${slot.slotLabel}-${i}`}>
            <PlayerHalf cell={slot.you} align="left" live={live} />
            <span className="af-mu-slot" role="cell">
              {slot.slotLabel}
            </span>
            <PlayerHalf cell={slot.opponent} align="right" live={live} />
          </div>
        ))}

        <div className="af-mu-board-foot" role="row">
          <span className="af-mu-foot-total af-num">{yours.total.toFixed(1)}</span>
          <span className="af-mu-foot-label af-label">{data.league.bestBall ? 'listed total' : live ? 'total' : 'projected'}</span>
          <span className="af-mu-foot-total af-mu-foot-total--right af-num">
            {theirs.total.toFixed(1)}
          </span>
        </div>
        {/* AllFantasy's own engine, totalled the same way, before kickoff only. */}
        {!live && (yoursAf != null || theirsAf != null) ? (
          <div className="af-mu-board-foot af-mu-board-foot--af" role="row">
            <span className="af-mu-foot-total af-num">{yoursAf == null ? '—' : yoursAf.toFixed(1)}</span>
            <span className="af-mu-foot-label af-label">AF projected</span>
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
          Built from {yours.from} of your {yours.of} starters and {theirs.from} of their{' '}
          {theirs.of}, so both totals read low — and by different amounts.
        </p>
      ) : null}
    </>
  )
}

export function Matchup({ data }: MatchupProps) {
  /*
   * The two numbers the banner compares: the scored totals when the week has
   * been scored, and the projected finals when it has not. Kept as one pair so
   * the margin chip below cannot end up comparing a score against a projection.
   */
  const scored = data.sides.available
    ? { you: data.sides.data.you.points, opponent: data.sides.data.opponent.points }
    : null
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

  const leader =
    compared && compared.you !== compared.opponent
      ? compared.you > compared.opponent
        ? 'you'
        : 'opponent'
      : null

  return (
    /*
      Every name in this lineup belongs to THIS league, so the card opens in
      its league flavour. One wrap rather than a `leagueId` prop threaded
      through LineupBoard and both PlayerHalf columns.
    */
    <PlayerCardLeagueScope leagueId={data.league.id}>
    <div className="af-mu">
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
            <span className="af-label af-mu-week-label">
              Week {data.week.data.week} · {data.week.data.season}
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
              {weekState === 'final' ? 'Final' : weekState === 'live' ? 'Live' : 'Upcoming'}
            </span>
          </>
        ) : (
          <span className="af-mu-unavailable">{data.week.reason}</span>
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
              Set lineup in {data.league.lineupLink.platformLabel} <span aria-hidden>↗</span>
            </a>
          ) : null}
        </div>
      ) : null}

      {/* ── Head to head ────────────────────────────────────────────── */}
      <section className="af-frame af-mu-h2h">
        {data.teams.available ? (
          <>
            <TeamCard
              team={data.teams.data.you}
              points={scored?.you ?? null}
              projected={projected?.you ?? null}
              afProjected={afTotals?.you ?? null}
              align="left"
            />

            <div className="af-mu-centre">
              <div className="af-label af-mu-centre-label">Win probability</div>
              {data.winProbability.available ? (
                <>
                  <div className="af-mu-centre-value af-num">
                    {Math.round(data.winProbability.data.pWin * 100)}%
                  </div>
                  {/*
                    ⚠ THE CONFIDENCE AND THE MODEL'S OWN SENTENCE STAY ATTACHED TO
                    THE NUMBER. A bare percentage reads as a measurement; this one
                    is a Gaussian over projected margins, and the detail line is
                    what stops it being mistaken for a count of simulated seasons.
                  */}
                  <p className="af-mu-centre-why">
                    {data.winProbability.data.detail} · {data.winProbability.data.confidence}{' '}
                    confidence
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
                  <p className="af-mu-centre-why">{data.winProbability.reason}</p>
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
                  No margin yet
                </div>
              ) : leader ? (
                <div className="af-mu-margin af-num" data-leader={leader}>
                  {scored
                    ? leader === 'you'
                      ? 'You lead by '
                      : 'Behind by '
                    : leader === 'you'
                      ? 'Projected ahead by '
                      : 'Projected behind by '}
                  {Math.abs(compared.you - compared.opponent).toFixed(1)}
                </div>
              ) : (
                <div className="af-mu-margin af-num" data-leader="tied">
                  {scored ? 'Level' : 'Projected level'}
                </div>
              )}
            </div>

            <TeamCard
              team={data.teams.data.opponent}
              points={scored?.opponent ?? null}
              projected={projected?.opponent ?? null}
              afProjected={afTotals?.opponent ?? null}
              align="right"
            />

            {/*
              ⚠ THE UNSCORED-WEEK SENTENCE SURVIVES, IT JUST NO LONGER REPLACES
              THE BANNER. It is the reason the two numbers above it are
              projections, so it belongs UNDER them, inside the same frame —
              not in place of both crests.
            */}
            {data.sides.available ? null : (
              <p className="af-mu-basis">{data.sides.reason}</p>
            )}
          </>
        ) : (
          <p className="af-mu-unavailable af-mu-unavailable--block">{data.teams.reason}</p>
        )}
      </section>

      {/* ── Per-player scoring ──────────────────────────────────────── */}
      <section className="af-frame af-mu-section">
        <header className="af-mu-section-head">
          <h2 className="af-label">Head to head, slot by slot</h2>
        </header>
        <LineupBoard data={data} />
      </section>

      {/* ── What decides it ─────────────────────────────────────────── */}
      <section className="af-frame af-mu-section">
        <header className="af-mu-section-head">
          <h2 className="af-label">What decides it</h2>
        </header>
        <ul className="af-mu-missing">
          <li>
            <span className="af-mu-missing-key">Players yet to play</span>
            <span className="af-mu-missing-why">{data.yetToPlay.reason}</span>
          </li>
          <li>
            <span className="af-mu-missing-key">{data.projectedFinal.available && data.projectedFinal.data.model === 'best_ball_full_roster' ? 'Projected Best Ball final' : 'Projected final'}</span>
            {data.projectedFinal.available ? (
              <span className="af-mu-missing-value af-num">
                {data.projectedFinal.data.you.toFixed(1)} –{' '}
                {data.projectedFinal.data.opponent.toFixed(1)}
                {data.projectedFinal.data.model === 'best_ball_full_roster' ? (
                  <em className="af-mu-missing-caveat"> — highest projected legal lineup from each eligible full roster</em>
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
                    — built without {data.projectedFinal.data.unprojected.you} of your starters and{' '}
                    {data.projectedFinal.data.unprojected.opponent} of theirs, so both totals read
                    low
                  </em>
                ) : null}
              </span>
            ) : (
              <span className="af-mu-missing-why">{data.projectedFinal.reason}</span>
            )}
          </li>
        </ul>
      </section>
    </div>
    </PlayerCardLeagueScope>
  )
}

export default Matchup
