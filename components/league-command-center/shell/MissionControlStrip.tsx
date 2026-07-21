import Link from 'next/link'
import type {
  MissionControlData,
  MissionControlTile,
  MissionControlTileId,
  MissionControlTone,
} from '@/lib/league-command-center/sections/missionControl'
import { CoverageBadge } from '../primitives/CoverageBadge'
import { DegradationNotice } from '../primitives/Panel'

/**
 * League Mission Control — five live indicators directly under the hero.
 *
 * The heartbeat of the league: status, next deadline, data freshness, platform,
 * and what needs attention, all readable before the user scrolls.
 *
 * Two rendering rules carry the honesty guarantees from the loader through to
 * the screen, and neither is cosmetic:
 *
 *  - **A withheld value never borrows a health colour.** When
 *    `withheldReason` is set, the tile renders in the neutral "unknown" treatment
 *    regardless of tone, so "we are not measuring this" can never be mistaken at a
 *    glance for "this is fine".
 *  - **Coverage travels with the score.** A tile showing a composite always
 *    renders its `CoverageBadge`, so a partly-defaulted number is never presented
 *    as a fully measured one.
 */

const TONE_VAR: Record<MissionControlTone, string> = {
  good: 'var(--cc-good)',
  warn: 'var(--cc-ops)',
  bad: 'var(--cc-bad)',
  info: 'var(--cc-info)',
  neutral: 'var(--cc-text-3)',
  unknown: 'var(--cc-text-4)',
}

const TILE_ICON: Record<MissionControlTileId, string> = {
  status: 'ph-heartbeat',
  deadline: 'ph-clock-countdown',
  freshness: 'ph-database',
  platform: 'ph-plugs-connected',
  attention: 'ph-warning',
}

function TileBody({ tile }: { tile: MissionControlTile }) {
  // A withheld value is always rendered as unknown, never in the tone it would
  // have had — see the component docstring.
  const accent = tile.withheldReason ? TONE_VAR.unknown : TONE_VAR[tile.tone]
  const isLocked = tile.withheldReason === 'not_entitled'

  return (
    <>
      <span className="af-cc-mc__icon" style={{ color: accent, borderColor: accent }}>
        <i className={`ph ${isLocked ? 'ph-lock-simple' : TILE_ICON[tile.id]}`} aria-hidden="true" />
      </span>

      <span className="af-cc-mc__body">
        <span className="af-cc-mc__label">{tile.label}</span>
        <span className="af-cc-mc__value" style={{ color: accent }}>
          {tile.value}
        </span>
        <span className="af-cc-mc__detail">{tile.detail}</span>
        {tile.coverage ? (
          <CoverageBadge real={tile.coverage.real} total={tile.coverage.total} />
        ) : null}
      </span>

      {tile.href ? (
        <i className="ph ph-caret-right af-cc-mc__caret" aria-hidden="true" />
      ) : null}
    </>
  )
}

function Tile({ tile }: { tile: MissionControlTile }) {
  const className = [
    'af-cc-mc__tile',
    tile.withheldReason ? 'af-cc-mc__tile--withheld' : null,
  ]
    .filter(Boolean)
    .join(' ')

  /*
   * Entitlement is the one withheld state with somewhere useful to go, so it is
   * the one that stays clickable. The others deliberately do not link: a tile
   * that navigates nowhere useful is worse than one that does not navigate.
   * `freshness` and `platform` gain links in the phase that builds the Import
   * Status card they would point at.
   */
  if (tile.withheldReason === 'not_entitled') {
    return (
      <Link href="/upgrade" className={className}>
        <TileBody tile={tile} />
      </Link>
    )
  }

  if (tile.href) {
    return (
      <Link href={tile.href} className={className}>
        <TileBody tile={tile} />
      </Link>
    )
  }

  return (
    <div className={className}>
      <TileBody tile={tile} />
    </div>
  )
}

export function MissionControlStrip({ data }: { data: MissionControlData }) {
  return (
    <section className="af-cc-mc" aria-label="League Mission Control">
      <div className="af-cc-mc__head">
        <h2 className="af-cc-mc__title">League Mission Control</h2>
        <span className="af-cc-mc__hint">
          Live league state. Anything we can&apos;t measure says so.
        </span>
      </div>

      <div className="af-cc-mc__grid">
        {data.tiles.map((tile) => (
          <Tile key={tile.id} tile={tile} />
        ))}
      </div>

      <DegradationNotice warnings={data.warnings} />
    </section>
  )
}

export default MissionControlStrip
