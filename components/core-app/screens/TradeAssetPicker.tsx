'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The asset picker behind "+ Add asset" on the Trade Center.
 *
 * Three real asset classes — player, pick, FAAB — matching what
 * `TradeConsoleAnalyzeInput` actually accepts. Anything else in the legend
 * (Survivor idols, Zombie weapons and serums) is documented there but cannot be
 * added yet, and this says so rather than offering a control that would build an
 * asset the engine will reject.
 *
 * ⚠ NO NEW API ROUTE. Search posts to the existing
 * `/api/trade-value/player-search`, which was already built for exactly this and
 * returns `{ name, position, team, value, playerId, sport }`.
 */

export type PickedAsset =
  | { kind: 'player'; playerId: string | null; name: string; position: string | null; team: string | null; value: number | null; sportHint?: string }
  | { kind: 'pick'; year: number; round: number; label: string }
  | { kind: 'faab'; amount: number }

type SearchRow = {
  kind: 'player'
  sport: string
  playerId: string | null
  name: string
  position: string | null
  team: string | null
  value: number | null
}

/** Long enough that a fast typist does not fire a request per keystroke. */
const DEBOUNCE_MS = 250
const MIN_QUERY = 2

export function TradeAssetPicker(props: {
  onPick: (asset: PickedAsset) => void
  onClose: () => void
  /** Restricts search when the league is single-sport. */
  sport?: string | null
}) {
  const [tab, setTab] = useState<'player' | 'pick' | 'faab'>('player')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<SearchRow[]>([])
  const [searching, setSearching] = useState(false)

  const [pickYear, setPickYear] = useState(new Date().getFullYear() + 1)
  const [pickRound, setPickRound] = useState(1)
  const [faab, setFaab] = useState(10)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(
    async (q: string) => {
      if (q.trim().length < MIN_QUERY) {
        setRows([])
        return
      }
      setSearching(true)
      try {
        const sport = props.sport ? props.sport.toUpperCase() : 'ALL'
        const r = await fetch(
          `/api/trade-value/player-search?q=${encodeURIComponent(q)}&sport=${encodeURIComponent(sport)}`,
        )
        const j = (await r.json().catch(() => [])) as SearchRow[]
        setRows(Array.isArray(j) ? j : [])
      } catch {
        /* A failed search shows nothing rather than a stale list. */
        setRows([])
      } finally {
        setSearching(false)
      }
    },
    [props.sport],
  )

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void search(query), DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, search])

  return (
    <div className="af-tc-picker">
      <div className="af-tc-picker-tabs">
        {(['player', 'pick', 'faab'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className="af-tc-picker-tab"
            data-on={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'faab' ? 'FAAB' : t === 'pick' ? 'Pick' : 'Player'}
          </button>
        ))}
        <span className="af-tc-spacer" />
        <button type="button" className="af-tc-remove" onClick={props.onClose} aria-label="Close">
          ×
        </button>
      </div>

      {tab === 'player' ? (
        <>
          <input
            className="af-tc-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a player…"
            autoFocus
          />
          {searching ? <p className="af-tc-row-sub">Searching…</p> : null}
          {!searching && query.trim().length >= MIN_QUERY && rows.length === 0 ? (
            <p className="af-tc-row-sub">
              Nobody matched that. Search covers players our value feed knows — a defender or
              kicker may not appear even though he is rosterable.
            </p>
          ) : null}
          {rows.map((r) => (
            <button
              key={`${r.name}-${r.playerId ?? r.team}`}
              type="button"
              className="af-tc-row af-tc-row--button"
              onClick={() =>
                props.onPick({
                  kind: 'player',
                  playerId: r.playerId,
                  name: r.name,
                  position: r.position,
                  team: r.team,
                  value: r.value,
                  sportHint: r.sport,
                })
              }
            >
              <span className="af-tc-row-body">
                <span className="af-tc-row-name">{r.name}</span>
                <span className="af-tc-row-sub">
                  {[r.position, r.team].filter(Boolean).join(' · ')}
                </span>
              </span>
              {/* Unpriced shows an em dash here too — the picker must not imply zero. */}
              <span className="af-tc-row-value" data-unpriced={r.value == null ? 'true' : undefined}>
                {r.value == null ? '—' : r.value.toLocaleString()}
              </span>
            </button>
          ))}
        </>
      ) : null}

      {tab === 'pick' ? (
        <div className="af-tc-picker-fields">
          <label className="af-tc-field">
            <span className="af-label">Year</span>
            <input
              className="af-tc-input"
              type="number"
              value={pickYear}
              min={new Date().getFullYear()}
              max={new Date().getFullYear() + 5}
              onChange={(e) => setPickYear(Number(e.target.value))}
            />
          </label>
          <label className="af-tc-field">
            <span className="af-label">Round</span>
            <input
              className="af-tc-input"
              type="number"
              value={pickRound}
              min={1}
              max={10}
              onChange={(e) => setPickRound(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="af-btn"
            onClick={() =>
              props.onPick({
                kind: 'pick',
                year: pickYear,
                round: pickRound,
                label: `${pickYear} round ${pickRound}`,
              })
            }
          >
            Add pick
          </button>
          {/*
            ⚠ NO SLOT FIELD ON PURPOSE. A pick's slot is projected from the
            sending team's record — see pickOutlook.ts — and asking a manager to
            guess it would override a computed answer with a hunch.
          */}
          <p className="af-tc-row-sub">
            Where in the round it lands is projected from the sending team&rsquo;s record, so there
            is nothing to enter here.
          </p>
        </div>
      ) : null}

      {tab === 'faab' ? (
        <div className="af-tc-picker-fields">
          <label className="af-tc-field">
            <span className="af-label">Amount</span>
            <input
              className="af-tc-input"
              type="number"
              value={faab}
              min={0}
              onChange={(e) => setFaab(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="af-btn"
            onClick={() => props.onPick({ kind: 'faab', amount: faab })}
          >
            Add FAAB
          </button>
        </div>
      ) : null}

      {/*
        ⚠ THE FORMAT-SPECIFIC CLASSES ARE NAMED, NOT OFFERED. Idols, weapons and
        serums are real assets in Survivor and Zombie leagues and they appear in
        the legend — but `TradeConsoleAnalyzeInput` accepts player, pick and faab
        only. A control that built one would produce an asset the engine rejects.
      */}
      <p className="af-tc-row-sub">
        Idols, weapons and serums are tradeable in Survivor and Zombie leagues but cannot be added
        here yet — the analyzer accepts players, picks and FAAB.
      </p>
    </div>
  )
}
