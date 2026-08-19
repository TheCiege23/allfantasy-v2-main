/**
 * The draft board — one column per MANAGER, not per pick position.
 *
 * WHAT SLEEPER GETS WRONG AND THIS DOES NOT. Their column headers are blank: you read
 * "2.6" and have to count columns to work out whose pick it is. Here every column is
 * headed by that manager's avatar and name, and it stays that manager's column all the way
 * down even in reversed rounds — which is what makes a 12-wide board scannable.
 *
 * SCROLLING, NOT SHRINKING. An 18-team league gets 14 columns at readable width and scrolls
 * for the rest; a phone gets 5. Fitting 18 columns on a phone would make every one of them
 * illegible. Two things stay pinned while the board scrolls sideways:
 *
 *   - the round number, so you never lose which row you are on
 *   - your own column is marked, so "where am I" is answerable at a glance in an 18-team
 *     league scrolled halfway across
 */
'use client'

import { useMemo } from 'react'
import {
  buildDraftBoard,
  cellForSlot,
  type DraftKind,
} from '@/lib/draft-board/draftBoardGrid'

export type BoardManager = {
  /** 1-based draft slot. Column order follows this. */
  slot: number
  name: string
  avatarUrl?: string | null
}

export type BoardPick = {
  overall: number
  playerName: string
  position?: string | null
  team?: string | null
}

type Props = {
  managers: BoardManager[]
  rounds: number
  kind: DraftKind
  thirdRoundReversal?: boolean
  /** Keyed by overall pick number. Absent = not yet made. */
  picksByOverall?: Record<number, BoardPick>
  /** The viewer's own slot, highlighted throughout. */
  mySlot?: number | null
  /** Overall number of the pick currently on the clock. */
  onTheClockOverall?: number | null
  /** Columns visible before scrolling. Phones override this to 5 via CSS. */
  visibleColumns?: number
}

export function DraftBoardGrid({
  managers,
  rounds,
  kind,
  thirdRoundReversal = false,
  picksByOverall = {},
  mySlot = null,
  onTheClockOverall = null,
  visibleColumns = 14,
}: Props) {
  const board = useMemo(
    () => buildDraftBoard({ rounds, teamCount: managers.length, kind, thirdRoundReversal }),
    [rounds, managers.length, kind, thirdRoundReversal],
  )

  const ordered = useMemo(() => [...managers].sort((a, b) => a.slot - b.slot), [managers])

  if (ordered.length === 0 || board.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3, #7e8894)' }}>
        No draft order yet. The board fills in once the league sets its order.
      </p>
    )
  }

  return (
    <div
      className="af-board"
      style={
        {
          '--af-board-cols': String(visibleColumns),
          '--af-board-round-w': '52px',
        } as React.CSSProperties
      }
    >
      <style>{`
        .af-board { overflow-x: auto; overflow-y: visible; -webkit-overflow-scrolling: touch; }
        .af-board-row { display: flex; align-items: stretch; }
        .af-board-round {
          position: sticky; left: 0; z-index: 2;
          flex: 0 0 var(--af-board-round-w);
          display: flex; align-items: center; justify-content: center;
          background: var(--surface2, #12161f);
          border-right: 1px solid var(--rule-2, rgba(255,255,255,.14));
        }
        .af-board-cell {
          flex: 0 0 calc((100% - var(--af-board-round-w)) / var(--af-board-cols));
          min-width: 96px;
          border-right: 1px solid var(--rule, rgba(255,255,255,.07));
          border-bottom: 1px solid var(--rule, rgba(255,255,255,.07));
        }
        /* A phone cannot show 14 columns legibly; it shows five and scrolls. */
        @media (max-width: 720px) {
          .af-board { --af-board-cols: 5; --af-board-round-w: 40px; }
          .af-board-cell { min-width: 84px; }
        }
      `}</style>

      {/* Header: the thing Sleeper leaves blank. */}
      <div className="af-board-row" style={{ position: 'sticky', top: 0, zIndex: 3 }}>
        <div className="af-board-round" style={{ borderBottom: '1px solid var(--rule-2, rgba(255,255,255,.14))' }} />
        {ordered.map((m) => {
          const mine = mySlot != null && m.slot === mySlot
          return (
            <div
              key={m.slot}
              className="af-board-cell"
              style={{
                padding: '8px 10px',
                display: 'flex', alignItems: 'center', gap: 8,
                background: mine ? 'var(--accent-soft, rgba(37,99,235,.14))' : 'var(--surface2, #12161f)',
                borderBottom: '1px solid var(--rule-2, rgba(255,255,255,.14))',
                borderTop: mine ? '2px solid var(--accent, #2563EB)' : '2px solid transparent',
              }}
            >
              {m.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.avatarUrl}
                  alt=""
                  width={22}
                  height={22}
                  style={{ borderRadius: '50%', flex: '0 0 22px', objectFit: 'cover' }}
                />
              ) : (
                <span
                  aria-hidden
                  style={{
                    width: 22, height: 22, borderRadius: '50%', flex: '0 0 22px',
                    display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800,
                    background: 'var(--chip, rgba(255,255,255,.08))', color: 'var(--ink-3, #7e8894)',
                  }}
                >
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span
                title={m.name}
                style={{
                  fontSize: 12, fontWeight: 650, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  color: mine ? 'var(--accent, #2563EB)' : 'var(--ink, #edeff2)',
                }}
              >
                {m.name}
              </span>
            </div>
          )
        })}
      </div>

      {board.map((row) => (
        <div className="af-board-row" key={row.round}>
          <div className="af-board-round" style={{ flexDirection: 'column', gap: 2, padding: '6px 0' }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-2, #b4bcc6)', fontVariantNumeric: 'tabular-nums' }}>
              {row.round}
            </span>
            {/* Direction is stated, not implied by cell order — a reader should not have to
                infer that round 3 ran backwards. */}
            <span aria-label={row.reversed ? 'runs right to left' : 'runs left to right'}
                  style={{ fontSize: 10, color: 'var(--ink-3, #7e8894)' }}>
              {row.reversed ? '←' : '→'}
            </span>
          </div>

          {ordered.map((m) => {
            const cell = cellForSlot(row, m.slot)
            if (!cell) return <div key={m.slot} className="af-board-cell" />
            const pick = picksByOverall[cell.overall]
            const mine = mySlot != null && m.slot === mySlot
            const onClock = onTheClockOverall != null && cell.overall === onTheClockOverall
            return (
              <div
                key={m.slot}
                className="af-board-cell"
                style={{
                  padding: '7px 10px',
                  minHeight: 56,
                  background: onClock
                    ? 'var(--accent-soft, rgba(37,99,235,.16))'
                    : mine
                      ? 'rgba(255,255,255,.02)'
                      : 'transparent',
                  boxShadow: onClock ? 'inset 0 0 0 1px var(--accent, #2563EB)' : undefined,
                }}
              >
                <div
                  style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
                    color: 'var(--ink-3, #7e8894)', fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {cell.label}
                </div>
                {pick ? (
                  <>
                    <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--ink, #edeff2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {pick.playerName}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ink-3, #7e8894)' }}>
                      {[pick.position, pick.team].filter(Boolean).join(' · ')}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--ink-3, #7e8894)', opacity: onClock ? 1 : 0.55 }}>
                    {onClock ? 'On the clock' : '—'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export default DraftBoardGrid
