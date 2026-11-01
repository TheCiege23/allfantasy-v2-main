import type { CSSProperties } from 'react'
import { buildRedraftSeasonTrack, type RedraftSeasonFacts } from '@/lib/league-media/redraftSeasonTrack'

const pct = (at: number) => `${Math.round(at * 1000) / 10}%`

/**
 * The redraft header's season track (replaces the 5-step `.nl-phase` bar for redraft leagues).
 * Every value comes from `buildRedraftSeasonTrack`, which drops a marker rather than invent one;
 * with no season length there is no bar at all, only the week and the marker list.
 */
export function RedraftSeasonTrack({ facts, phase }: { facts: RedraftSeasonFacts; phase: string }) {
  const track = buildRedraftSeasonTrack(facts)
  const placed = track.markers.filter(marker => marker.at != null)
  return (
    <div className="nl-rd-track" role="group" aria-label="Season progress" data-testid="redraft-season-track">
      <div className="nl-rd-track-head"><span>The season race</span><strong>{track.weekLabel ?? phase}</strong></div>
      {placed.length > 1 || track.progress != null ? (
        <div className="nl-rd-track-bar" aria-hidden>
          {track.progress != null ? <span className="nl-rd-track-fill" style={{ '--rd-at': pct(track.progress) } as CSSProperties} /> : null}
          {placed.map(marker => <i key={marker.id} className="nl-rd-track-dot" data-marker={marker.id} data-state={marker.state} style={{ '--rd-at': pct(marker.at ?? 0) } as CSSProperties} />)}
        </div>
      ) : null}
      <ol className="nl-rd-track-marks">
        {track.markers.map(marker => <li key={marker.id} data-marker={marker.id} data-state={marker.state} aria-current={marker.state === 'now' ? 'step' : undefined}>{marker.label}</li>)}
      </ol>
    </div>
  )
}
