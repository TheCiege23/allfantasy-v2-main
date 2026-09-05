'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RosterPick, RosterPlayer } from '@/components/core-app/screens/useLeagueRosters'
import { resolveTeamLogoUrlSync } from '@/lib/draft-sports-models/player-asset-resolver'

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
  | {
      kind: 'player'
      playerId: string | null
      name: string
      position: string | null
      team: string | null
      value: number | null
      /**
       * ⚠ OPTIONAL AND OFTEN ABSENT, WHICH IS WHY THE GLYPH SURVIVES. A player picked off a
       * roster has one — the rosters route resolves it for 241 of 241. A player found by
       * SEARCH does not: `SearchRow` carries no image, so those rows keep the coloured
       * initial rather than rendering a broken frame.
       */
      imageUrl?: string | null
      /** 30-day direction. Null is unmeasured; 'flat' is measured and unmoved. */
      stock?: 'up' | 'down' | 'flat' | null
      stockDelta?: number | null
      sportHint?: string
    }
  /**
   * `pickId` is present only when the pick came off a real roster. A hand-typed
   * year and round can be priced but never proposed — the trade engine matches a
   * pick by its stored id, so there is nothing for an offer to point at.
   */
  | {
      kind: 'pick'
      year: number
      round: number
      label: string
      pickId?: string | null
      itemType?: 'rookie_pick' | 'future_pick'
      /**
       * ⚠ NULL IS "NOT PRICED", never 0 — the same contract a player carries. A pick typed by
       * hand has no round we can trust and stays null; one taken off a roster is priced by
       * `lib/pick-curve.ts` on the route.
       */
      value?: number | null
    }
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

/**
 * The stock mark: a direction and nothing else.
 *
 * 🛑 THREE STATES, NOT TWO, AND THE THIRD IS THE ONE THAT EARNS ITS PLACE. Up and down are easy.
 * `flat` means MEASURED AND UNMOVED, which is a real answer a manager can act on. A player with no
 * reading at all renders NOTHING — collapsing the two would state a fact about a kicker nobody
 * tracks.
 *
 * Exported so the trade builder renders the identical mark from the identical rule: the same
 * player must not be rising in the picker and flat two inches away in the deal.
 */
export function StockMark(props: { stock?: 'up' | 'down' | 'flat' | null; delta?: number | null }) {
  if (!props.stock) return null
  const glyph = props.stock === 'up' ? '\u2191' : props.stock === 'down' ? '\u2193' : '\u2194'
  const label =
    props.stock === 'flat'
      ? '30-day value: no real change'
      : `30-day value ${props.stock === 'up' ? 'up' : 'down'}${
          typeof props.delta === 'number' ? ` ${Math.abs(Math.round(props.delta)).toLocaleString()}` : ''
        }`
  return (
    <span className="af-tc-stock" data-dir={props.stock} title={label} aria-label={label}>
      {glyph}
    </span>
  )
}

export function TradeAssetPicker(props: {
  onPick: (asset: PickedAsset) => void
  onClose: () => void
  /** Restricts search when the league is single-sport. */
  sport?: string | null
  /**
   * The picks actually held by the roster this side is sending from, when we
   * know whose roster it is. Empty means we do not know — which is a different
   * thing from "they hold none", and the copy below keeps them apart.
   */
  rosterPicks?: RosterPick[]
  /** Whose picks these are, for the label. */
  rosterLabel?: string | null
  /** True once a counterparty is chosen, so "we do not know" can be said precisely. */
  rosterKnown?: boolean
  /**
   * The players on the roster this side sends from.
   *
   * 🛑 THE REASON THIS PICKER STOPPED BEING A SEARCH BOX. Every field it needs was already fetched
   * by `/api/leagues/[id]/trades/rosters` and discarded on the wire, so the only way to name a
   * player was to type him. Passing the roster in makes the common case — offering someone you
   * already own — a click.
   *
   * ⚠ EMPTY IS NOT "NO PLAYERS". It also means the roster has not loaded or is not known yet, and
   * the copy below keeps those apart rather than telling a manager their team is empty.
   */
  rosterPlayers?: RosterPlayer[]
  /**
   * FAAB left to spend, from the roster row.
   *
   * ⚠ NULL MEANS THE LEAGUE TRACKS NO BUDGET — not $0 available. Offering a $0 input for a league
   * with no FAAB invites a bid that cannot be made, so the two render differently.
   */
  faabAvailable?: number | null
  /** Manager identity for the header, so it is obvious whose assets these are. */
  managerName?: string | null
  managerAvatarUrl?: string | null
  managerRecord?: { wins: number; losses: number; ties: number } | null
}) {
  const [tab, setTab] = useState<'player' | 'pick' | 'faab'>('player')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<SearchRow[]>([])
  const [searching, setSearching] = useState(false)

  const [pickYear, setPickYear] = useState(new Date().getFullYear() + 1)
  const [pickRound, setPickRound] = useState(1)
  const [faab, setFaab] = useState(10)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const roster = props.rosterPlayers ?? []

  /**
   * Local filter over the roster.
   *
   * ⚠ SUBSTRING ACROSS NAME, POSITION AND TEAM, not name alone. A manager types "WR" or "GB" as
   * readily as a surname, and a filter that only matched names would silently return nothing for
   * either — indistinguishable from "you have no receivers".
   */
  const filteredRoster = (() => {
    const q = query.trim().toLowerCase()
    if (!q) return roster
    return roster.filter((p) =>
      [p.name, p.position, p.team].some((f) => f?.toLowerCase().includes(q)),
    )
  })()

  const rosterHeading = props.managerName ? `${props.managerName} — roster` : 'On this roster'

  /**
   * The FAAB amount actually offered, clamped to the balance.
   *
   * 🛑 DERIVED, NOT JUST CLAMPED ON CHANGE — and a test caught the difference. `faab` initialises
   * to 10, so a manager with $0 available saw a $10 field and an enabled button without touching
   * anything: an onChange clamp never runs if nothing changes. Clamping at the point of USE means
   * the displayed value, the disabled state and the submitted amount cannot disagree.
   */
  const effectiveFaab = props.faabAvailable != null ? Math.min(faab, props.faabAvailable) : faab

  /**
   * Team logo, resolved on the client from the abbreviation.
   *
   * Returns null for an unknown team or sport, and the row then shows the abbreviation alone —
   * which is why the abbreviation is rendered beside the logo rather than replaced by it.
   */
  const teamLogoFor = (team: string | null): string | null => {
    if (!team) return null
    try {
      return resolveTeamLogoUrlSync(team, props.sport ?? 'NFL')
    } catch {
      return null
    }
  }

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

      {/*
        ── WHOSE ASSETS THESE ARE ───────────────────────────────────────────────────────────────
        Both columns open an identical-looking picker, and picking from the wrong one offers an
        asset the manager does not hold — which the engine refuses only at send. Naming the manager
        here makes that mistake visible before it is made.

        ⚠ A 0-0-0 RECORD IS RENDERED, NOT HIDDEN. Pre-season every team genuinely is 0-0-0, and
        suppressing it would read as "no record available" in the month this gets most use.
      */}
      {props.managerName || props.managerRecord ? (
        <div className="af-tc-picker-manager">
          <span className="af-tc-manager-avatar" aria-hidden="true">
            {props.managerAvatarUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={props.managerAvatarUrl} alt="" loading="lazy" />
            ) : (
              <span className="af-tc-headshot-fallback">
                {(props.managerName ?? '?').slice(0, 1)}
              </span>
            )}
          </span>
          <span className="af-tc-manager-body">
            <span className="af-tc-manager-name">{props.managerName ?? 'This manager'}</span>
            {props.managerRecord ? (
              <span className="af-tc-row-sub">
                {props.managerRecord.wins}-{props.managerRecord.losses}
                {props.managerRecord.ties > 0 ? `-${props.managerRecord.ties}` : ''}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      {tab === 'player' ? (
        <>
          <input
            className="af-tc-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={roster.length > 0 ? 'Filter this roster, or search anyone…' : 'Search a player…'}
            autoFocus
          />

          {/*
            ── THE ROSTER, WHICH IS THE COMMON CASE ─────────────────────────────────────────────
            Offering someone you already own is what a manager does most of the time, so it comes
            first and needs no typing. The filter is LOCAL — instant, and it cannot hide a player
            because a remote search was slow or failed.
          */}
          {roster.length > 0 ? (
            <>
              <span className="af-label">
                {rosterHeading}
                {filteredRoster.length === roster.length
                  ? ` · ${roster.length}`
                  : ` · ${filteredRoster.length} of ${roster.length}`}
              </span>
              {filteredRoster.length === 0 ? (
                <p className="af-tc-row-sub">Nobody on this roster matches that.</p>
              ) : null}
              {filteredRoster.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="af-tc-row af-tc-row--button af-tc-row--player"
                  onClick={() =>
                    props.onPick({
                      kind: 'player',
                      playerId: p.id,
                      name: p.name,
                      position: p.position,
                      team: p.team,
                      value: p.value,
                      imageUrl: p.imageUrl,
                      stock: p.stock,
                      stockDelta: p.stockDelta,
                      sportHint: props.sport ?? undefined,
                    })
                  }
                >
                  {/*
                    A headshot is optional and often absent. The initial keeps row height and
                    alignment identical either way, so a roster does not look ragged.
                  */}
                  <span className="af-tc-headshot" aria-hidden="true">
                    {p.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={p.imageUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="af-tc-headshot-fallback">{p.name.slice(0, 1)}</span>
                    )}
                  </span>

                  <span className="af-tc-row-body">
                    <span className="af-tc-row-name">
                      {p.name}
                      {p.injuryStatus ? (
                        <span className="af-tc-injury" title={p.injuryStatus}>
                          {p.injuryStatus}
                        </span>
                      ) : null}
                    </span>
                    <span className="af-tc-row-sub">
                      {p.position ? <span className="af-tc-pos">{p.position}</span> : null}
                      {/*
                        ⚠ `af-tc-row-team`, NOT `af-tc-team` — the latter is the TEAM CARD in
                        TradeCenter.tsx. Carrying it here inherited `flex-direction: column`, 14px
                        of padding and a border from a component this chip has nothing to do with,
                        which stacked the logo above the abbreviation and made every roster row
                        130px tall against an intended ~48px. The DOM was correct and the tests
                        passed throughout: a textContent assertion cannot see a layout.
                      */}
                      {p.team ? (
                        <span className="af-tc-row-team">
                          {teamLogoFor(p.team) ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={teamLogoFor(p.team) as string} alt="" loading="lazy" />
                          ) : null}
                          {p.team}
                        </span>
                      ) : null}
                      {/*
                        ⚠ ONLY WHEN KNOWN. A null bye means "we do not know"; rendering it as a
                        week — or as 0 — states a fact a manager could plan around and be wrong.
                      */}
                      {p.byeWeek != null ? <span className="af-tc-bye">BYE {p.byeWeek}</span> : null}
                    </span>
                  </span>

                  {/* Unpriced shows an em dash. The picker must never imply zero. */}
                  <StockMark stock={p.stock} delta={p.stockDelta} />
                  <span className="af-tc-row-value" data-unpriced={p.value == null ? 'true' : undefined}>
                    {p.value == null ? '—' : p.value.toLocaleString()}
                  </span>
                </button>
              ))}
            </>
          ) : props.rosterKnown ? (
            <p className="af-tc-row-sub">
              No players are listed on this roster yet. You can still search for anyone below.
            </p>
          ) : null}

          {/*
            Search stays, as the way to reach a player NOT on this roster — valuing a waiver add,
            or a hypothetical. Labelled so it reads as a second section rather than competing with
            the list above.
          */}
          {roster.length > 0 && query.trim().length >= MIN_QUERY ? (
            <span className="af-label">Anyone else</span>
          ) : null}
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
          {/*
            ⚠ REAL PICKS FIRST, WHEN THERE ARE ANY. A pick chosen from the roster
            carries the id the trade engine matches on, so it can be both priced
            AND proposed. Everything below it is analysis-only, and says so.
          */}
          {(props.rosterPicks ?? []).length > 0 ? (
            <>
              <span className="af-label">
                {props.rosterLabel ? `${props.rosterLabel}'s picks` : 'Picks on this roster'}
              </span>
              {(props.rosterPicks ?? []).map((p) => (
                <button
                  key={p.pickId}
                  type="button"
                  className="af-tc-row af-tc-row--button"
                  onClick={() =>
                    props.onPick({
                      kind: 'pick',
                      year: p.season ?? new Date().getFullYear(),
                      round: p.round ?? 1,
                      label: p.label,
                      pickId: p.pickId,
                      itemType: p.itemType,
                      value: p.value,
                    })
                  }
                >
                  <span className="af-tc-row-body">
                    <span className="af-tc-row-name">{p.label}</span>
                    <span className="af-tc-row-sub">On the roster — can be proposed</span>
                  </span>
                  {/*
                    A pick is priced in the SAME cell and the same units as a player, because the
                    two are summed into one total. Rendering it anywhere else would invite the
                    reading that picks are a separate currency.
                  */}
                  <span className="af-tc-row-value" data-unpriced={p.value == null ? 'true' : undefined}>
                    {p.value == null ? '—' : p.value.toLocaleString()}
                  </span>
                </button>
              ))}
            </>
          ) : props.rosterKnown ? (
            <p className="af-tc-row-sub">
              No picks with an id on this roster. A pick can still be added below for the verdict,
              but it cannot be sent as part of an offer.
            </p>
          ) : null}

          <span className="af-label">Add a pick by hand</span>
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
            is nothing to enter here. A pick added this way is priced but not proposable &mdash;
            the league only recognises a pick it already has on a roster.
          </p>
        </div>
      ) : null}

      {tab === 'faab' ? (
        <div className="af-tc-picker-fields">
          {/*
            ── WHAT IS ACTUALLY AVAILABLE ───────────────────────────────────────────────────────
            ⚠ NULL AND ZERO ARE DIFFERENT AND MUST READ DIFFERENTLY. Null means this league tracks
            no FAAB budget at all; zero means the manager has spent it. Showing "$0 available" for
            a league with no budget invites an offer that cannot be made, and hiding the control
            for a manager who is genuinely at zero hides a true fact.
          */}
          {props.faabAvailable == null ? (
            <p className="af-tc-row-sub">
              This league does not track a FAAB budget, so there is no balance to offer from. You
              can still enter an amount if you are pricing a hypothetical.
            </p>
          ) : (
            <p className="af-tc-row-sub">
              <strong>${props.faabAvailable.toLocaleString()}</strong> available
              {props.managerName ? ` to ${props.managerName}` : ''}
              {props.faabAvailable === 0 ? ' — nothing left to offer.' : ''}
            </p>
          )}

          <label className="af-tc-field">
            <span className="af-label">Amount</span>
            <input
              className="af-tc-input"
              type="number"
              inputMode="numeric"
              value={effectiveFaab}
              min={0}
              /*
               * Capped at the balance when there IS one, so the field cannot express an offer the
               * league would refuse. Uncapped when the balance is unknown — a cap of 0 there would
               * be a guess presented as a rule.
               */
              {...(props.faabAvailable != null ? { max: props.faabAvailable } : {})}
              onChange={(e) => {
                /*
                 * Numbers only, and clamped on the way in rather than on submit. `Number('')` is 0
                 * and `Number('abc')` is NaN — both would otherwise reach the engine as an amount.
                 */
                const raw = Number(e.target.value)
                if (!Number.isFinite(raw)) return
                const floored = Math.max(0, Math.floor(raw))
                setFaab(props.faabAvailable != null ? Math.min(floored, props.faabAvailable) : floored)
              }}
            />
          </label>
          <button
            type="button"
            className="af-btn"
            /* Nothing to offer is not a trade — the control says so rather than sending a zero. */
            disabled={effectiveFaab <= 0}
            onClick={() => props.onPick({ kind: 'faab', amount: effectiveFaab })}
          >
            {effectiveFaab > 0 ? `Add $${effectiveFaab.toLocaleString()} FAAB` : 'Enter an amount'}
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
