'use client'

import { useEffect, useState } from 'react'
import '@/components/core-app/af-war-room.css'
import DraftMusicWidget from '@/components/core-app/draft-music/DraftMusicWidget'
import type { BoardCell, BoardColumn, DraftBoardData } from '@/lib/core-app/draftBoard'

/**
 * The per-league draft board, clock and queue.
 *
 * "On the clock: board, queue, recommendations and the pick-trade panel."
 *
 * ── 2026-09-08: THIS WAS SCREEN 9, THE WAR ROOM ─────────────────────────────
 *
 * It now renders INSIDE Draft HQ, above the board settings, because the War Room
 * has become the season-long Decision OS hub and a draft belongs to Draft HQ in
 * every phase. Nothing about the board changed in the move.
 *
 * ⚠ SO IT NO LONGER OWNS AN `h1`. Draft HQ's own title is the page heading;
 * a second one here gave the screen two competing headings and read to a screen
 * reader as two documents. The status bar is a labelled section instead.
 *
 * The board is real, drawn from stored picks. The clock only appears when the
 * session actually stores one — a completed draft is not "on the clock", and a
 * countdown invented from a default pick length would be the most urgent-looking
 * fiction on the screen.
 */

export type DraftBoardProps = {
  data: DraftBoardData
}

function Unavailable({ reason }: { reason: string }) {
  return <p className="af-wr-unavailable">{reason}</p>
}

function Clock({ endsAt, paused }: { endsAt: Date | null; paused: number | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (paused != null) {
    const m = Math.floor(paused / 60)
    const s = paused % 60
    return (
      <span className="af-wr-clock af-num" data-state="paused">
        {m}:{String(s).padStart(2, '0')} paused
      </span>
    )
  }
  if (!endsAt) {
    return <span className="af-wr-clock af-num" data-state="none">no timer set</span>
  }
  const left = Math.max(0, Math.floor((endsAt.getTime() - now) / 1000))
  const m = Math.floor(left / 60)
  const s = left % 60
  return (
    <span className="af-wr-clock af-num" data-state={left <= 30 ? 'urgent' : 'running'}>
      {m}:{String(s).padStart(2, '0')}
    </span>
  )
}

function Board({ columns, cells }: { columns: BoardColumn[]; cells: BoardCell[] }) {
  const byKey = new Map(cells.map((c) => [`${c.round}:${c.rosterId}`, c]))
  const rounds = Math.max(...cells.map((c) => c.round), 1)

  return (
    <div className="af-wr-board-scroll">
      <table className="af-wr-board">
        <thead>
          <tr>
            <th className="af-label af-wr-board-corner">Rd</th>
            {columns.map((c) => (
              <th key={c.rosterId} className="af-wr-board-head" data-yours={c.isYours}>
                <span className="af-wr-board-team">{c.displayName}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rounds }, (_, i) => i + 1).map((round) => (
            <tr key={round}>
              <th className="af-wr-board-round af-num" scope="row">
                R{round}
              </th>
              {columns.map((col) => {
                const cell = byKey.get(`${round}:${col.rosterId}`)
                return (
                  <td
                    key={col.rosterId}
                    className="af-wr-cell"
                    data-yours={cell?.isYours ?? col.isYours}
                    data-empty={!cell}
                  >
                    {cell ? (
                      <>
                        <span className="af-wr-cell-label af-num">{cell.label}</span>
                        <span className="af-wr-cell-name">{cell.playerName}</span>
                        {cell.position ? (
                          <span className="af-wr-cell-pos af-num">{cell.position}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="af-wr-cell-empty" aria-hidden>
                        —
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DraftBoard({ data }: DraftBoardProps) {
  return (
    <div className="af-wr">
      {/* ── Status bar ──────────────────────────────────────────────── */}
      <header className="af-frame af-wr-status">
        <div className="af-wr-status-text">
          <h2 className="af-display af-wr-title">Draft board · {data.league.name}</h2>
          {data.session.available ? (
            <p className="af-wr-progress">
              {data.session.data.draftType} · {data.session.data.rounds} rounds ·{' '}
              {data.session.data.picksMade} of {data.session.data.totalPicks} picks made
              {data.session.data.currentRound != null
                ? ` · next is round ${data.session.data.currentRound}`
                : ' · complete'}
            </p>
          ) : (
            <Unavailable reason={data.session.reason} />
          )}
        </div>

        <div className="af-wr-clock-wrap">
          {data.clock.available ? (
            <>
              <span
                className="af-label af-wr-clock-label"
                data-yours={data.clock.data.yoursOnClock}
              >
                {data.clock.data.yoursOnClock ? "You're on the clock" : 'On the clock'}
              </span>
              <Clock
                endsAt={data.clock.data.endsAt ? new Date(data.clock.data.endsAt) : null}
                paused={data.clock.data.pausedSecondsRemaining}
              />
            </>
          ) : (
            <span className="af-wr-clock-off">{data.clock.reason}</span>
          )}
        </div>
      </header>

      {/*
        31a — the music widget, collapsed by default and in NORMAL FLOW between
        the status bar and the board. Not floating, not overlaid: a strip that
        covers a pick during a draft is worse than no music at all. It never
        autoplays — audio starts only when someone presses play.
      */}
      <DraftMusicWidget variant="collapsed" playlistName={`${data.league.name} draft`} />

      {/* ── Board ───────────────────────────────────────────────────── */}
      <section className="af-frame af-wr-section">
        <header className="af-wr-section-head">
          <h3 className="af-label">The board</h3>
          <span className="af-wr-legend">
            <span className="af-wr-legend-swatch" data-kind="yours" /> your picks
          </span>
        </header>

        {data.board.available ? (
          <Board columns={data.board.data.columns} cells={data.board.data.cells} />
        ) : (
          <Unavailable reason={data.board.reason} />
        )}
      </section>

      {/* ── Recommendations / queue / advice ────────────────────────── */}
      <div className="af-wr-pair">
        <section className="af-card af-wr-section">
          <h3 className="af-label">Best available for you</h3>
          {/*
            The handoff ranks undrafted players with a fit score. Nothing stores a
            recommendation output, and a confidence number attached to a name is
            acted on immediately during a draft — the worst possible place to
            estimate.
          */}
          <Unavailable reason={data.bestAvailable.reason} />
        </section>

        <section className="af-card af-wr-section">
          <h3 className="af-label">Your queue</h3>
          <Unavailable reason={data.queue.reason} />
          <p className="af-wr-note">
            The queue that drives autopick lives on{' '}
            {data.league.platform === 'manual' ? 'your platform' : data.league.platform}. AllFantasy
            only reads it.
          </p>
        </section>
      </div>
    </div>
  )
}

export default DraftBoard
