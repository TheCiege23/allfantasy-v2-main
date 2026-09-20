"use client"

import { useEffect, useRef } from "react"
import type { PlayoffSeriesView } from "@/lib/playoffs/types"
import {
  abbreviate,
  roundLabel,
  seriesOdds,
  seriesRecordLine,
} from "@/lib/playoffs/playoffBracketGraph"
import { teamColors } from "@/lib/playoffs/playoffTeamColors"
import { isOfficialTeamName } from "@/lib/playoffs/playoffBracketProjection"

/**
 * Series detail.
 *
 * ⚠ NO OVER/UNDER MARKET HERE, BY DECISION. The design carried a "Total runs
 * O/U" Over/Under toggle; the app's own committed terms
 * (lib/legal/FanCredBoundaryDisclosure.ts) state "No gambling, betting, or
 * in-app prize payout systems are offered in AllFantasy." Shipping a wagering
 * control against that is the same defect as `4e984ffac`, where the app
 * charged fees its terms said it never charges. Omitted deliberately, not
 * forgotten.
 *
 * ⚠ NO INNING-BY-INNING LINESCORE EITHER, for a duller reason: nothing
 * ingests it. `providerGamesJson` holds game-level rows, not innings. A
 * fabricated grid would be the most convincing wrong thing on the page, so the
 * modal shows the game-level detail it actually has.
 */

export type PlayoffLiveViewModalProps = {
  series: PlayoffSeriesView | null
  sport: string
  onClose: () => void
}

export default function PlayoffLiveViewModal({ series, sport, onClose }: PlayoffLiveViewModalProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    /*
     * Lock the page behind the sheet. On iOS especially, an unlocked body
     * scrolls under a fixed overlay and the user loses their place in the
     * bracket when the sheet closes.
     */
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  if (!series) return null

  const odds = seriesOdds(series)
  const record = seriesRecordLine(series)
  const live = series.status === "in_progress" || !!series.liveStatus
  const home = teamColors(abbreviate(series.homeTeamName))
  const away = teamColors(abbreviate(series.awayTeamName))
  const decided = !!series.winnerTeamName
  const hasLiveScore = series.liveHomeScore != null && series.liveAwayScore != null

  return (
    <div
      className="af-pb-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${roundLabel(sport, series.round)} series detail`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="af-pb-modal" data-testid="pb-live-modal">
        <div className="af-pb-modal-head">
          <span>
            {roundLabel(sport, series.round)} · {live ? "Live view" : "Series detail"}
          </span>
          <button ref={closeRef} type="button" className="af-pb-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="af-pb-modal-body">
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span
                className="af-pb-badge af-pb-badge--sm"
                style={{ background: home.bg, color: home.fg }}
              >
                {abbreviate(series.homeTeamName)}
              </span>
              <strong style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>
                {isOfficialTeamName(series.homeTeamName) ? series.homeTeamName : "TBD"}
              </strong>
            </div>
            <div style={{ fontSize: 11, color: "var(--pb-muted)", textAlign: "center", flex: "none" }}>
              {record ?? "Series has not started"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <strong style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>
                {isOfficialTeamName(series.awayTeamName) ? series.awayTeamName : "TBD"}
              </strong>
              <span
                className="af-pb-badge af-pb-badge--sm"
                style={{ background: away.bg, color: away.fg }}
              >
                {abbreviate(series.awayTeamName)}
              </span>
            </div>
          </div>

          {live ? (
            <p style={{ marginTop: 14, fontSize: 11, fontWeight: 800, color: "var(--pb-bad)" }}>
              <span className="af-pb-live-dot" aria-hidden="true" />
              LIVE · {series.liveStatus ?? "in progress"}
            </p>
          ) : null}

          {hasLiveScore ? (
            <div className="af-pb-linescore" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Team</th>
                    <th scope="col">R</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{abbreviate(series.homeTeamName)}</td>
                    <td className="af-pb-mono">{series.liveHomeScore}</td>
                  </tr>
                  <tr>
                    <td>{abbreviate(series.awayTeamName)}</td>
                    <td className="af-pb-mono">{series.liveAwayScore}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          <div style={{ marginTop: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                fontWeight: 700,
                marginBottom: 6,
              }}
              className="af-pb-mono"
            >
              <span>
                {abbreviate(series.homeTeamName)} {odds.home}%
              </span>
              <span>
                {abbreviate(series.awayTeamName)} {odds.away}%
              </span>
            </div>
            <div className="af-pb-probbar" role="img" aria-label={`Win probability ${odds.home} to ${odds.away}`}>
              <i style={{ width: `${odds.home}%` }} />
            </div>
            <p className="af-pb-note">
              {odds.basis === "seed"
                ? "Seed-and-record read — the better seed is favoured on a fixed slope. Not a scouting model."
                : "Not enough information to price this series yet."}
            </p>
          </div>

          <dl style={{ marginTop: 16, display: "grid", gap: 8, margin: 0 }}>
            {[
              ["Format", `Best of ${series.bestOf}`],
              ["Venue", series.venue ?? "—"],
              ["Broadcast", series.broadcastNetwork ?? "—"],
              ["Next game", series.nextGameDateLabel ?? "—"],
              ["Status", decided ? `${series.winnerTeamName} advance` : series.status],
            ].map(([k, v]) => (
              <div key={String(k)} className="af-pb-setting-row" style={{ padding: "8px 0" }}>
                <dt style={{ fontSize: 12, color: "var(--pb-muted)" }}>{k}</dt>
                <dd style={{ fontSize: 12, fontWeight: 700, margin: 0, textAlign: "right" }}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="af-pb-modal-foot">
          <button type="button" className="af-pb-btn af-pb-btn--accent" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
