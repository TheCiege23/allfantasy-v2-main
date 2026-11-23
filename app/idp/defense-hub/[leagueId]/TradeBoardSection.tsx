'use client'

import { useEffect, useMemo, useState } from 'react'

import type { LeagueDefenderBoard, DefenderBoardRow } from '@/lib/values/leagueDefenderBoard'
import { FOREIGN_IDS_UNREADABLE } from '@/lib/core-app/foreignIdSpaceCopy'
import { useMessages } from '@/components/i18n/useMessages'
import { defenseHubMessages } from '@/lib/core-app/messages/defenseHub'
import { idpPositionGroup } from '@/lib/core-app/scoringNotes'

/**
 * Every defender in the league and what he is worth HERE — the board a manager reads before
 * making an offer.
 *
 * 🛑 THE SECTION ABOVE THIS ONE SHOWS ONLY YOUR OWN PLAYERS, AND THAT IS THE WHOLE POINT OF
 * THIS ONE. The hub prices the entire league because replacement level is a league property,
 * then renders `myDefenders` alone. So a manager could read what HIS linebacker was worth and
 * had no way to ask about the one he wants to trade for. Same numbers, nothing filtered out,
 * plus the team holding each player so he knows who to ask.
 *
 * ⚠ IT FETCHES SEPARATELY FROM THE HUB ON PURPOSE. The board is the larger query — every
 * rostered player in the league rather than one roster — and pairing it with the hub's fetch
 * would make the fast half of the page wait for the slow half. A failure here leaves the hub
 * above it intact.
 *
 * ⚠ AND IT RE-STATES THE HUB'S HONESTY RULES RATHER THAN INHERITING THEM. A null value renders
 * as a dash and never 0; a floor price is muted and labelled; kickers get one value shown once
 * with no rank or projection column. Those are not stylistic — each is a measurement the IDP
 * stack made, and a table that renders them the ordinary way un-makes it.
 *
 * 2026-11-14: it opens at the top `BOARD_TOP` by value — a 14-team league listed ~290 rows — with a
 * button for the rest, and a search or "hide my players" shows every match. Its words are in
 * lib/core-app/messages/defenseHub.ts (they were English on the Spanish page), and its method notes
 * are one fold under the table rather than three paragraphs.
 */

/** How many rows the board opens with. */
export const BOARD_TOP = 25

function Dash() {
  return <span className="text-[var(--faint)]">—</span>
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="af-dh-label af-dfh-label mb-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--faint)]">
      {children}
    </h2>
  )
}

export function TradeBoardSection({ leagueId }: { leagueId: string }) {
  const m = useMessages(defenseHubMessages)
  const [data, setData] = useState<LeagueDefenderBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hideMine, setHideMine] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    fetch(`/api/idp/players?leagueId=${encodeURIComponent(leagueId)}&view=trade-board`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'not-a-member' : 'request-failed')
        const body = (await r.json()) as unknown
        /*
         * ⚠ VALIDATE THE SHAPE, DO NOT JUST ASSERT IT. This was `as
         * LeagueDefenderBoard` on an unread body, so anything shaped otherwise -
         * a proxy error page answering 200, a partial deploy, a route returning
         * the hub payload - reached `data.rows.filter` inside a useMemo and threw
         * where React cannot contain it. That unmounted the ENTIRE hub, breaking
         * the isolation promised at the top of this file.
         *
         * `rows` is the right thing to test: every board carries it, and a
         * blocked one carries `[]` rather than omitting it, so this admits every
         * real response and rejects every shape that would crash the memo.
         */
        const board = body as LeagueDefenderBoard
        if (!board || !Array.isArray(board.rows)) throw new Error('request-failed')
        return board
      })
      .then((p) => live && setData(p))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [leagueId])

  const rows = useMemo(() => {
    /*
     * ⚠ THIS GUARD MIRRORS THE `data.state !== 'ok'` RETURN BELOW, AND HAS TO.
     * A hook runs before every early return in the render, so guarding only on
     * `!data` still reached `data.rows` on a board that carries no rows - a
     * blocked board has a state and nothing to list. That threw
     * "Cannot read properties of undefined (reading 'filter')" out of a useMemo,
     * which React cannot contain, so it unmounted the WHOLE hub.
     *
     * 🛑 THAT BREAKS THE INVARIANT AT THE TOP OF THIS FILE - "a failure here
     * leaves the hub above it intact" - and it was false for as long as this memo
     * dereferenced a shape it had not checked. Keep the two conditions in step:
     * whatever the render treats as unrenderable, this must treat as no rows.
     */
    if (!data || data.state !== 'ok') return []
    const q = query.trim().toLowerCase()
    return data.rows.filter((r) => {
      if (hideMine && r.ownedBy.isMine) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        (r.team ?? '').toLowerCase().includes(q) ||
        (r.ownedBy.teamName ?? '').toLowerCase().includes(q) ||
        (r.ownedBy.ownerName ?? '').toLowerCase().includes(q)
      )
    })
  }, [data, query, hideMine])

  if (error) {
    return (
      <section>
        <Label>{m.boardTitle}</Label>
        <div className="rounded-[13px] border border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-soft)] px-4 py-3.5 text-[13px] text-[var(--text)]">
          {error === 'not-a-member' ? m.notMember : m.boardLoadFailed}
        </div>
      </section>
    )
  }

  if (!data) {
    return (
      <section>
        <Label>{m.boardTitle}</Label>
        <div className="rounded-[13px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 font-mono text-[11px] text-[var(--faint)]">
          {m.loading}
        </div>
      </section>
    )
  }

  if (data.state !== 'ok') {
    const blocked: Record<string, string> = {
      not_idp_league: m.boardBlocked_not_idp_league,
      no_scoring_settings: m.boardBlocked_no_scoring_settings,
      no_projection_history: m.boardBlocked_no_projection_history,
      valuation_refused: m.boardBlocked_valuation_refused,
      no_league: m.boardBlocked_no_league,
      no_rostered_defenders: m.boardBlocked_no_rostered_defenders,
      ids_unreadable: `${FOREIGN_IDS_UNREADABLE}.`,
    }
    return (
      <section>
        <Label>{m.boardTitle}</Label>
        <div className="rounded-[13px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 text-[13px] text-[var(--muted)]">
          {blocked[data.state] ?? m.boardBlocked_other}
        </div>
      </section>
    )
  }

  /* A search or "hide my players" is looking for something specific, so it shows every match. */
  const filtering = query.trim().length > 0 || hideMine
  const shown = showAll || filtering ? rows : rows.slice(0, BOARD_TOP)
  const unpriced = data.rows.filter((r) => r.value == null).length

  return (
    <section data-testid="defense-trade-board">
      <Label>{m.boardTitle}</Label>

      <p className="mb-3 max-w-[620px] text-[12px] leading-relaxed text-[var(--muted)]">
        {m.boardSub}{' '}
        {/*
          ⚠ THE WEEK IS NOT DECORATION. A number like "5,200" reads as current. In the offseason
          it is a projection for a week that has not been played in months, and the module
          returns `projectedFor` specifically so a surface rendering these can say which one.
        */}
        {data.projectedFor ? (
          <span className="text-[var(--text2)]">{m.boardWeek(data.projectedFor.season, data.projectedFor.week)}</span>
        ) : (
          <span className="text-[var(--warn)]">{m.boardWeekUnknown}</span>
        )}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={m.boardFilter}
          aria-label={m.boardFilterLabel}
          className="min-h-[44px] min-w-[220px] flex-1 rounded-[9px] border border-[var(--line2)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--faint)] focus:border-[var(--accent-line)]"
        />
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-[13px] text-[var(--text2)]">
          <input
            type="checkbox"
            checked={hideMine}
            onChange={(e) => setHideMine(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          {m.hideMine}
        </label>
      </div>

      <div className="overflow-x-auto rounded-[13px] border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full text-left sm:min-w-[720px]">
          <thead>
            <tr className="border-b border-[var(--line)] font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--faint)]">
              <th className="px-4 py-3">{m.colPlayer}</th>
              <th className="hidden px-2 py-3 sm:table-cell">{m.colPos}</th>
              <th className="hidden px-2 py-3 text-right sm:table-cell">{m.colProj.replace(' ↓', '')}</th>
              <th className="hidden px-2 py-3 text-right sm:table-cell">
                <abbr title={m.vorpTip} className="no-underline">
                  {m.colVorp}
                </abbr>
              </th>
              <th className="hidden px-2 py-3 text-right sm:table-cell">{m.colPosRank}</th>
              <th className="px-2 py-3 text-right text-[var(--accent)]">{m.colValue} ↓</th>
              <th className="hidden px-4 py-3 sm:table-cell">{m.colHeldBy}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <BoardRow key={r.sleeperId} row={r} />
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-[11px] text-[var(--faint)]">{filtering ? m.boardNoMatch : m.boardNone}</p>
      ) : null}

      {!filtering && rows.length > BOARD_TOP ? (
        <button
          type="button"
          className="mt-3 min-h-[44px] rounded-[9px] border border-[var(--line2)] bg-[var(--surface)] px-4 text-[13px] font-bold text-[var(--text)]"
          onClick={() => setShowAll(!showAll)}
          data-testid="defense-trade-board-more"
        >
          {showAll ? m.showTop(BOARD_TOP) : m.showAll(rows.length)}
        </button>
      ) : null}

      {/*
        No kicker block here any more (2026-11-23): the hub already shows it, and every kicker carries the same
        value, so a second copy repeated the number and its paragraph word for word on one page.
      */}
      <details className="mt-3 rounded-[13px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3" data-testid="defense-trade-board-how">
        <summary className="cursor-pointer text-[13px] font-bold text-[var(--text)]">{m.boardHowTitle}</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[12px] leading-relaxed text-[var(--muted)]">
          <li>{m.noteLeague}</li>
          <li>{m.noteCrossGroup}</li>
          {unpriced > 0 ? <li>{m.noteUnpriced(unpriced)}</li> : null}
        </ul>
      </details>
    </section>
  )
}

/**
 * The rank's label: his position GROUP (DL/LB/DB), the same one the hub prints. The rank is computed per group,
 * so pairing it with the raw spelling printed "DE1" here beside "DL1" in Your defenders for one ranking (audit
 * 2026-11-23). An older server sends no `positionGroup`, so it is derived from the position here too.
 */
function rankLabel(row: DefenderBoardRow): string | null {
  if (row.positionRank == null) return null
  const group = row.positionGroup ?? idpPositionGroup(row.position) ?? row.position
  return group ? `${group}${row.positionRank}` : null
}

function BoardRow({ row }: { row: DefenderBoardRow }) {
  const m = useMessages(defenseHubMessages)
  const rank = rankLabel(row)
  const mine = row.ownedBy.isMine
  // Below `sm` the table is Player · Value, so the rest rides on a line under the name.
  const facts = [
    row.position ? (rank ? `${row.position} · ${rank}` : row.position) : rank,
    row.projectedPoints != null ? `${row.projectedPoints.toFixed(1)} proj` : null,
    mine ? m.you : row.ownedBy.teamName ? m.factHeldBy(row.ownedBy.teamName) : null,
  ].filter(Boolean)
  return (
    <tr
      className={`border-b border-[var(--line)] last:border-0 ${mine ? 'bg-[var(--accent-soft)]' : ''}`}
      data-testid="defense-trade-board-row"
    >
      <td className="px-4 py-3">
        <div className="text-[13px] font-extrabold">{row.name}</div>
        <div className="font-mono text-[11px] text-[var(--faint)]">{row.team ?? '—'}</div>
        {facts.length ? <div className="mt-1 text-[12px] text-[var(--text2)] sm:hidden">{facts.join(' · ')}</div> : null}
      </td>
      <td className="hidden px-2 py-3 font-mono text-[11px] text-[var(--text2)] sm:table-cell">{row.position ?? <Dash />}</td>
      {/*
        A dash, never 0.0. A defender this league's scoring could not price has an absent
        projection, and rendering that as zero tells a manager the player scores nothing.
      */}
      <td className="hidden px-2 py-3 text-right font-mono text-[12px] text-[var(--text2)] sm:table-cell">
        {row.projectedPoints != null ? row.projectedPoints.toFixed(1) : <Dash />}
      </td>
      <td className="hidden px-2 py-3 text-right font-mono text-[12px] sm:table-cell">
        {row.vorp != null ? `${row.vorp > 0 ? '+' : ''}${row.vorp.toFixed(1)}` : <Dash />}
      </td>
      <td className="hidden px-2 py-3 text-right font-mono text-[12px] text-[var(--text2)] sm:table-cell">
        {rank ?? <Dash />}
      </td>
      <td className="px-2 py-3 text-right font-mono text-[12px]">
        {row.value == null ? (
          /*
           * 🛑 A DASH, AND THE TITLE SAYS WHY. Null means replacement level could not be
           * established for him — an absence of information, not a cheap player. He is sorted
           * to the bottom by the loader for the same reason.
           */
          <span title={m.notPricedTip}>
            <Dash />
          </span>
        ) : row.valueIsFloor ? (
          <span className="text-[var(--muted)]" title={m.floorTip}>
            {row.value.toLocaleString()}
            <span className="ml-1 text-[11px]"> {m.floor}</span>
          </span>
        ) : (
          row.value.toLocaleString()
        )}
      </td>
      <td className="hidden px-4 py-3 sm:table-cell">
        {/* Your own rows are already tinted: "You", not your team name and "you" again. */}
        {mine ? (
          <div className="text-[12px] font-semibold text-[var(--text)]">{m.you}</div>
        ) : (
          <>
            <div className="text-[12px] font-semibold text-[var(--text2)]">{row.ownedBy.teamName ?? <Dash />}</div>
            <div className="font-mono text-[11px] text-[var(--faint)]">{row.ownedBy.ownerName ?? '—'}</div>
          </>
        )}
      </td>
    </tr>
  )
}
