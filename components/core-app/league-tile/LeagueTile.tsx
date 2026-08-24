'use client'

import Link from 'next/link'
import {
  type LeagueTileModel,
  platformMark,
  resolveTileName,
  tileFallbackColor,
  tileInitials,
} from './leagueTileModel'
import '@/components/core-app/af-league-tile.css'

/**
 * 27a — the league tile. One component, five lifecycle states.
 *
 * Read `leagueTileModel.ts` first: it carries the anatomy contract and the
 * reasoning behind the seeded fallback colour and the naming-collision fix.
 * This file is only the rendering of that model.
 *
 * The `rail` variant is the same tile at reduced scale for the mini-list — same
 * component, a density flag, not a second component. The handoff draws it as
 * "the rail" showing five tiles in context, and drawing that from a copy of this
 * file is how the two drift apart.
 */

export type LeagueTileProps = {
  model: LeagueTileModel
  /** Names that appear more than once in this list — see `findCollidingNames`. */
  collidingNames?: ReadonlySet<string>
  /** Reduced-scale list row rather than a full card. */
  variant?: 'card' | 'rail'
}

/**
 * League art with the platform badge as a corner mark.
 *
 * ⚠ THE BADGE CARRIES A 1.5px RING IN THE TILE'S BACKGROUND COLOUR. Required on
 * photographic art, where a bare badge sits on unpredictable pixels and stops
 * being readable. The handoff says flat-colour fallback art does not strictly
 * need it — it gets it anyway, because a badge that changes shape depending on
 * whether a league happens to have uploaded a picture is a worse inconsistency
 * than a ring nobody notices.
 */
function TileArt({
  model,
  size,
}: {
  model: LeagueTileModel
  size: number
}) {
  const fallback = tileFallbackColor(model.id)
  return (
    <span className="af-lt-art" style={{ width: size, height: size }}>
      {model.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- league art comes
        // from arbitrary platform CDNs (Sleeper, ESPN, Yahoo avatars); next/image
        // would need every one of those hosts allowlisted in next.config.
        <img className="af-lt-img" src={model.imageUrl} alt="" loading="lazy" />
      ) : (
        <span
          className="af-lt-fallback"
          style={{ background: fallback.bg, color: fallback.fg }}
          aria-hidden
        >
          {tileInitials(model.name)}
        </span>
      )}
      <span
        className="af-lt-badge af-platform"
        data-platform={model.platform}
        title={model.platform}
        aria-hidden
      >
        {platformMark(model.platform)}
      </span>
    </span>
  )
}

/**
 * The score line.
 *
 * ⚠ A PROJECTION IS LABELLED AS ONE. `projected` renders the "proj" marker and
 * the muted treatment. Showing a projected 118.4 in the same type as a live
 * 118.4 is how a tile ends up reporting a game that has not been played.
 */
function TileScore({ score }: { score: NonNullable<LeagueTileModel['score']> }) {
  const leading = score.you > score.opponent
  return (
    <span className="af-lt-score" data-projected={score.projected}>
      <span className="af-lt-score-nums af-num" data-leading={leading}>
        {score.you.toFixed(1)}
        <i className="af-lt-score-sep">–</i>
        {score.opponent.toFixed(1)}
      </span>
      {score.projected ? <span className="af-lt-score-tag">proj</span> : null}
      {score.opponentName ? (
        <span className="af-lt-score-opp">vs {score.opponentName}</span>
      ) : null}
    </span>
  )
}

export function LeagueTile({ model, collidingNames, variant = 'card' }: LeagueTileProps) {
  const name = resolveTileName(model, collidingNames)
  const { status } = model

  return (
    <Link
      href={model.href}
      className="af-lt"
      data-variant={variant}
      data-tone={status.tone}
      data-state={status.kind}
    >
      <TileArt model={model} size={variant === 'rail' ? 26 : 40} />

      <span className="af-lt-body">
        <span className="af-lt-name" title={model.name}>
          {name.text}
          {name.disambiguated ? (
            <i
              className="af-lt-disambig"
              title="Another league of yours has the same name — the last four of its id is shown so you can tell them apart. Set a nickname to replace it."
            >
              ⓘ
            </i>
          ) : null}
        </span>

        {/* Fixed across every state, by contract. */}
        <span className="af-lt-format af-num">{model.formatLine}</span>

        {/* The only line that changes per state. */}
        <span className="af-lt-status">
          <i className="af-lt-dot" aria-hidden />
          <b className="af-lt-state">{status.label}</b>
          <span className="af-lt-reason">{status.reason}</span>
        </span>
      </span>

      {model.score ? <TileScore score={model.score} /> : null}
    </Link>
  )
}

export default LeagueTile
