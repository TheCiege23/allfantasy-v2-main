'use client'

import { useEffect, useMemo, useState } from 'react'

import type { LeagueDefenderBoard, DefenderBoardRow } from '@/lib/values/leagueDefenderBoard'

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
 */

function Dash() {
  return <span className="text-[#3d4468]">—</span>
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#5d648a]">
      {children}
    </div>
  )
}

/** Why the board has nothing to show, said plainly rather than rendered as an empty table. */
const BLOCKED_COPY: Record<string, string> = {
  not_idp_league: 'This league does not score defenders, so there is no defensive board to price.',
  no_scoring_settings: 'We do not hold this league’s scoring settings, so nothing can be priced.',
  no_projection_history:
    'No projection history is on file yet, so no defender can be priced. This is normal in the ' +
    'offseason and resolves when the stat ingest next runs.',
  valuation_refused:
    'Replacement level could not be established for this league, so pricing was refused rather ' +
    'than guessed.',
  no_league: 'We could not resolve this league.',
  no_rostered_defenders: 'No rosters in this league carry a defender yet.',
}

export function TradeBoardSection({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<LeagueDefenderBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hideMine, setHideMine] = useState(false)

  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    fetch(`/api/idp/players?leagueId=${encodeURIComponent(leagueId)}&view=trade-board`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'not-a-member' : 'request-failed')
        return (await r.json()) as LeagueDefenderBoard
      })
      .then((p) => live && setData(p))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [leagueId])

  const rows = useMemo(() => {
    if (!data) return []
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
        <Label>League trade board</Label>
        <div className="rounded-[13px] border border-[#fb5b78]/30 bg-[#fb5b78]/[0.09] px-4 py-3.5 text-[13px] text-[#eef0fa]">
          {error === 'not-a-member'
            ? 'You don’t have access to this league.'
            : 'We couldn’t load the league board. Nothing is shown rather than something wrong.'}
        </div>
      </section>
    )
  }

  if (!data) {
    return (
      <section>
        <Label>League trade board</Label>
        <div className="rounded-[13px] border border-white/[0.07] bg-[#0d1020] px-4 py-3.5 font-mono text-[11px] text-[#5d648a]">
          Loading…
        </div>
      </section>
    )
  }

  if (data.state !== 'ok') {
    return (
      <section>
        <Label>League trade board</Label>
        <div className="rounded-[13px] border border-white/[0.07] bg-[#0d1020] px-4 py-3.5 text-[13px] text-[#8f97bd]">
          {BLOCKED_COPY[data.state] ?? 'This board is unavailable for this league.'}
        </div>
      </section>
    )
  }

  return (
    <section>
      <Label>League trade board — what to offer</Label>

      <p className="mb-3 max-w-[620px] text-[12px] leading-relaxed text-[#8f97bd]">
        Every defender rostered in this league, priced by this league’s own scoring and starting
        slots, with the team holding him.{' '}
        {/*
          ⚠ THE WEEK IS NOT DECORATION. A number like "5,200" reads as current. In the offseason
          it is a projection for a week that has not been played in months, and the module
          returns `projectedFor` specifically so a surface rendering these can say which one.
        */}
        {data.projectedFor ? (
          <span className="text-[#c3c9e6]">
            Projections are for {data.projectedFor.season} week {data.projectedFor.week}.
          </span>
        ) : (
          <span className="text-[#fbbf24]">
            We can’t say which week these projections are for, so read the values with that in
            mind.
          </span>
        )}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a player, team or manager…"
          aria-label="Filter the league trade board"
          className="min-w-[220px] flex-1 rounded-[9px] border border-white/[0.09] bg-[#0d1020] px-3 py-2 text-[12px] text-[#eef0fa] outline-none placeholder:text-[#5d648a] focus:border-[#22d3ee]/50"
        />
        <label className="flex cursor-pointer items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[#8f97bd]">
          <input
            type="checkbox"
            checked={hideMine}
            onChange={(e) => setHideMine(e.target.checked)}
            className="accent-[#22d3ee]"
          />
          Hide my players
        </label>
      </div>

      <div className="overflow-x-auto rounded-[13px] border border-white/[0.07] bg-[#0d1020]">
        <table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className="border-b border-white/[0.07] font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[#5d648a]">
              <th className="px-4 py-3">Player</th>
              <th className="px-2 py-3">Pos</th>
              <th className="px-2 py-3 text-right">Proj</th>
              <th className="px-2 py-3 text-right">VORP</th>
              <th className="px-2 py-3 text-right">Pos rank</th>
              <th className="px-2 py-3 text-right text-[#22d3ee]">Value ↓</th>
              <th className="px-4 py-3">Held by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <BoardRow key={r.sleeperId} row={r} />
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="mt-2 text-[11px] text-[#5d648a]">
          {query || hideMine
            ? 'No defender matches that filter.'
            : 'No defenders are priced in this league yet.'}
        </p>
      )}

      <Kickers data={data} />

      {data.notes.map((n) => (
        <p key={n} className="mt-2 max-w-[720px] text-[11px] leading-relaxed text-[#5d648a]">
          {n}
        </p>
      ))}
    </section>
  )
}

function BoardRow({ row }: { row: DefenderBoardRow }) {
  return (
    <tr
      className={`border-b border-white/[0.04] last:border-0 ${
        row.ownedBy.isMine ? 'bg-[#22d3ee]/[0.05]' : ''
      }`}
    >
      <td className="px-4 py-3">
        <div className="text-[13px] font-extrabold">{row.name}</div>
        <div className="font-mono text-[10px] text-[#5d648a]">{row.team ?? '—'}</div>
      </td>
      <td className="px-2 py-3 font-mono text-[11px] text-[#c3c9e6]">{row.position ?? <Dash />}</td>
      {/*
        A dash, never 0.0. A defender this league's scoring could not price has an absent
        projection, and rendering that as zero tells a manager the player scores nothing.
      */}
      <td className="px-2 py-3 text-right font-mono text-[12px] text-[#c3c9e6]">
        {row.projectedPoints != null ? row.projectedPoints.toFixed(1) : <Dash />}
      </td>
      <td className="px-2 py-3 text-right font-mono text-[12px]">
        {row.vorp != null ? `${row.vorp > 0 ? '+' : ''}${row.vorp.toFixed(1)}` : <Dash />}
      </td>
      <td className="px-2 py-3 text-right font-mono text-[12px] text-[#c3c9e6]">
        {row.positionRank != null && row.position ? (
          `${row.position}${row.positionRank}`
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-2 py-3 text-right font-mono text-[12px]">
        {row.value == null ? (
          /*
           * 🛑 A DASH, AND THE TITLE SAYS WHY. Null means replacement level could not be
           * established for him — an absence of information, not a cheap player. He is sorted
           * to the bottom by the loader for the same reason.
           */
          <span title="Not priced: replacement level could not be established for him. This is not the same as being worth nothing.">
            <Dash />
          </span>
        ) : row.valueIsFloor ? (
          <span
            className="text-[#8b93b7]"
            title="Floor price: below this league's meaningful board, not a measured value. Do not compare two floor-priced defenders."
          >
            {row.value.toLocaleString()}
            <span className="ml-1 text-[10px]">floor</span>
          </span>
        ) : (
          row.value.toLocaleString()
        )}
      </td>
      <td className="px-4 py-3">
        <div className="text-[12px] font-semibold text-[#c3c9e6]">
          {row.ownedBy.teamName ?? <Dash />}
        </div>
        <div className="font-mono text-[10px] text-[#5d648a]">
          {row.ownedBy.isMine ? 'you' : (row.ownedBy.ownerName ?? '—')}
        </div>
      </td>
    </tr>
  )
}

/**
 * Kickers across the league.
 *
 * 🛑 ONE VALUE, STATED ONCE ABOVE THE LIST — NOT A COLUMN REPEATED DOWN IT. Every kicker here
 * carries the same number by design, and a reader scanning a column of identical values
 * concludes the page is broken rather than that the position is flat. The hub renders it the
 * same way for the same reason.
 *
 * ⚠ NO PROJ / VORP / RANK COLUMNS. Kicker rank does not carry year to year — negative in all
 * six measured season pairs — so those columns would invite a comparison the data refuses.
 */
function Kickers({ data }: { data: LeagueDefenderBoard }) {
  if (!data.kickerValue || data.kickers.length === 0) return null

  return (
    <div className="mt-[22px]">
      <Label>Kickers in this league</Label>
      <div className="rounded-[13px] border border-white/[0.07] bg-[#0d1020] p-[13px]">
        <div className="flex items-baseline gap-2.5">
          <div className="font-mono text-[17px] font-black text-[#eef0fa]">
            {data.kickerValue.value?.toLocaleString()}
          </div>
          <div className="text-[11px] text-[#8f97bd]">for any kicker in this league</div>
        </div>
        <p className="mt-1.5 max-w-[560px] text-[11px] leading-relaxed text-[#5d648a]">
          {data.kickerValue.basis}
        </p>
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {data.kickers.map((k) => (
            <li key={k.sleeperId} className="text-[12px] text-[#c3c9e6]">
              {k.name}
              <span className="ml-1.5 font-mono text-[10px] text-[#5d648a]">
                {k.ownedBy.isMine ? 'you' : (k.ownedBy.teamName ?? k.ownedBy.ownerName ?? '—')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
