'use client'

import PlayerName from '@/components/core-app/player-card/PlayerName'

import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'

import { FOREIGN_IDS_UNREADABLE } from '@/lib/core-app/foreignIdSpaceCopy'
import type { WaiverBoard, WaiverBoardState } from '@/lib/waivers/waiverBoard'
import type { RosterNeeds } from '@/lib/waivers/rosterNeeds'
import { useWaiverIntel } from '@/components/decide/useWaiverIntel'
import { isPerGameBasis } from '@/lib/waivers/waiverSportBasis'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { useMessages } from '@/components/i18n/useMessages'
import { waiverLineupBoardMessages } from '@/lib/core-app/messages/waiverLineupBoard'

/**
 * Who is worth adding, ranked by what the add does to YOUR starting lineup.
 *
 * ⚠ IT ANSWERS A DIFFERENT QUESTION FROM THE TWO PANELS BELOW IT, AND THE ORDER MATTERS.
 * `WaiverIntel` prices a bid from market value and this league's bidding history; the AI panel
 * offers a written recommendation. Neither says how much a player would actually change your
 * week. So this sits FIRST — decide who helps, then decide what to pay — and every row names the
 * starter he would displace, because "over Patrick Queen" is the half a manager can act on.
 *
 * ⚠ AND IT IS NOT A "BEST AVAILABLE" LIST. A free agent projected for 14 points is worth nothing
 * to someone already starting three better players at that position. The ranked column is the
 * marginal gain, which also makes flex handling fall out instead of needing a rule.
 */

const REASON: Record<Exclude<WaiverBoardState, 'ok'>, string> = {
  no_team_claimed: 'we cannot tell which roster in this league is yours',
  no_roster: 'no roster rows imported for your team yet',
  // Imported, but unread: "no roster rows" would be false of a league whose ids we cannot match.
  ids_unreadable: FOREIGN_IDS_UNREADABLE.toLowerCase(),
  no_scoring_settings: 'this league publishes no scoring settings, so nothing here can be priced',
  no_slots: 'this league publishes no starting slots, so there is no lineup to improve',
  no_projections: 'nothing on your roster could be projected under this league’s scoring yet',
  // The note below names the sport and why; this line only says what that means for the wire.
  no_producer: 'nothing projects this sport’s players yet, so this wire cannot be priced',
}

export type WaiverLineupBoardProps = {
  leagueId: string
  /**
   * Set on a FAAB league. Each add then carries the bid the Waiver intelligence panel would suggest
   * for him — the same rule, the same request (useWaiverIntel), so the screen has ONE bid source.
   * `remaining` is your FAAB left, when the platform publishes it.
   */
  faab?: { remaining: number | null } | null
  /**
   * Set on a ROLLING-priority league with a published priority. A claim there sends you to the back
   * of the order, so the list says what that costs against what waiting costs — facts, not a verdict.
   */
  rollingPriority?: { priority: number; leagueRosters: number } | null
}

export function WaiverLineupBoard({ leagueId, faab = null, rollingPriority = null }: WaiverLineupBoardProps) {
  const [board, setBoard] = useState<WaiverBoard | null>(null)
  const [failed, setFailed] = useState(false)
  /* The filter bar: a name search and one position chip at a time, over the ranked adds only. */
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<string | null>(null)
  const { data: intelResponse } = useWaiverIntel(leagueId, faab != null)
  const bidQuotes = intelResponse && intelResponse.supported ? (intelResponse.intel?.bidQuotes ?? null) : null
  /*
   * Spanish, including what the LOADER wrote: the notes and the state reasons arrive in English
   * whatever the reader chose (no /core loader reads the language), so they go through `copy`, whose
   * patterns rebuild the templated ones ("74 free agents are…") around their numbers.
   */
  const { language } = useOptionalLanguage()
  const m = useMessages(waiverLineupBoardMessages)
  const copy = (english: string) => coreUiCopy(english, language)
  /*
   * Arriving from the home's "Add <player> in <league>" button (TriageBestAdd): `player` is the add
   * to highlight, `out` the injured starter the button priced at zero. Passing `out` on prices this
   * board the same way, so the player the button named is the one at the top here. Null-safe: tests
   * and pages without the app router have no search params.
   */
  const params = useSearchParams()
  const highlight = params?.get('player') ?? null
  const outParam = params?.get('out') ?? null
  const out = outParam && /^[A-Za-z0-9_-]{1,32}$/.test(outParam) ? outParam : null

  useEffect(() => {
    let alive = true
    setBoard(null)
    setFailed(false)
    fetch(`/api/idp/players?leagueId=${encodeURIComponent(leagueId)}&view=waiver-board&limit=10${out ? `&unavailable=${encodeURIComponent(out)}` : ''}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        return (await r.json()) as WaiverBoard
      })
      .then((b) => alive && setBoard(b))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [leagueId, out])

  // Bring the highlighted add into view once the board has drawn him.
  useEffect(() => {
    if (!highlight || !board) return
    const el = document.querySelector(`[data-wlb-player="${CSS.escape(highlight)}"]`)
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight, board])

  /*
   * A panel that cannot form an opinion removes itself. The rest of this screen is the real
   * surface; a broken card sitting above working panels is worse than no card.
   */
  if (failed) return null
  /*
   * ⚠ LOADING HOLDS ITS PLACE. This used to return null until the fetch landed, so the card
   * appeared afterwards and pushed the bid pricing and everything below it down the page — on a
   * phone, mid-scroll. A placeholder of the same shape keeps the layout still; a failure still
   * removes the card entirely, per the rule above.
   */
  if (!board) {
    return (
      <section className="af-card af-wv-section af-wlb" data-testid="waiver-lineup-board-loading" aria-busy="true">
        <div className="af-wv-section-head">
          <h2 className="af-label">{m.worthAdding}</h2>
        </div>
        <div className="af-wlb-skel" aria-hidden />
        <div className="af-wlb-skel" aria-hidden />
        <div className="af-wlb-skel" aria-hidden />
      </section>
    )
  }

  /*
   * ⚠ OUTSIDE THE NFL EVERY NUMBER IS PER GAME, FROM A SEASON RATE — never "this week". The header,
   * each row and the empty state say so; the board's notes say which scoring priced it.
   */
  const perGame = isPerGameBasis(board.basis)
  const sport = board.sport ?? 'NFL'

  return (
    <section className="af-card af-wv-section af-wlb" data-testid="waiver-lineup-board">
      <div className="af-wv-section-head">
        {/* One "?" for the whole list — how +N, "over …" and AF are read — not four per row. */}
        <h2 className="af-label">
          {m.worthAdding} <TopicTip topic="worthAdding" />
        </h2>
        {board.state === 'ok' && board.currentLineupPoints != null ? (
          <span className="af-wv-section-note af-num">
            {/* The BEST lineup your roster can field — not the one set on the platform. */}
            {m.yourBestLineup} {board.currentLineupPoints}
            {perGame ? m.perGame : board.week ? m.weekSuffix(board.week) : ''}
          </span>
        ) : null}
      </div>

      {board.state === 'ok' && board.needs ? <RosterNeedsStrip needs={board.needs} /> : null}

      {board.state !== 'ok' ? (
        <p className="af-wlb-why">{copy(REASON[board.state])}</p>
      ) : board.candidates.length === 0 ? (
        // A finding, not an error — nobody available changes the lineup.
        <p className="af-wlb-why">
          {copy(
            perGame
              ? 'nobody on the wire would improve your starting lineup per game'
              : 'nobody on the wire would improve your starting lineup this week',
          )}
        </p>
      ) : (
        <WaiverFilteredList candidates={board.candidates} query={query} pos={pos} onQuery={setQuery} onPos={setPos}>
          {(shown) => (
        <ul className="af-wlb-list">
          {shown.map((c) => (
            <li
              key={c.sleeperId ?? c.playerKey ?? c.name}
              className="af-wlb-row"
              data-wlb-player={c.sleeperId ?? undefined}
              data-highlight={highlight && c.sleeperId === highlight ? 'true' : undefined}
            >
              {/*
                The position as a tinted badge leading the row (the redesign's table). Decorative: the
                meta line still says the position in text — only hidden visually while the badge is
                there (af-waivers.css), so a reader hears it once.
              */}
              <span className="af-wlb-pos" data-pos={posKey(c.position)} aria-hidden="true">
                {c.position ?? '—'}
              </span>
              <span className="af-wlb-who">
                <span className="af-wlb-name">
                  {/*
                    Opens the player card in this league's context (handoff STATE 7). Outside the
                    NFL there is no Sleeper id (`sleeperId` is null), so the name renders as text:
                    the card's other lookup is by `externalId`, which is not scoped to a provider,
                    and a college Rolling Insights number can be a CFBD row's number too.
                  */}
                  <PlayerName
                    sport={sport}
                    sleeperId={c.sleeperId}
                    name={c.name}
                    position={c.position}
                    team={c.team}
                    leagueId={leagueId}
                  />
                </span>
                <span className="af-wlb-meta">
                  <span className="af-wlb-meta-pos">{c.position ?? '—'} · </span>
                  {c.team ? `${c.team} · ` : ''}{m.proj}{' '}
                  <span className="af-num">{c.projectedPoints.toFixed(1)}</span>
                  {/* AllFantasy's own engine, beside the provider's figure. */}
                  {c.afProjectedPoints != null ? (
                    <>
                      {' · '}
                      <span
                        className="af-wlb-af af-num"
                        title={m.afEngineTitle}
                      >
                        AF {c.afProjectedPoints.toFixed(1)}
                      </span>
                    </>
                  ) : null}
                  {/*
                    ⚠ A FORM NUMBER IS BACKWARD-LOOKING AND SAYS SO. It is a recency-weighted mean
                    of what he has actually scored here, used only where no projection feed covers
                    him. It knows nothing about a coming bye or a changed depth chart, so
                    rendering it identically to a real projection would make a forecast the
                    number never made. The design's LIMITED DATA chip is exactly this case.
                  */}
                  {c.basis === 'form' ? (
                    <span
                      className="af-wlb-chip"
                      title={m.formTitle}
                    >
                      {m.formChip(c.formGames)}
                    </span>
                  ) : null}
                  {c.basis === 'season_rate' ? (
                    <span
                      className="af-wlb-chip"
                      title={m.seasonRateTitle}
                    >
                      {m.seasonRateChip}
                    </span>
                  ) : null}
                  {/*
                    The bid, from the Waiver intelligence rule — the only bid source on this
                    screen. A player that rule has no market value for gets no figure, never a
                    made-up one; "over your $N left" is said rather than hidden.
                  */}
                  {faab && c.sleeperId && bidQuotes?.[c.sleeperId] != null ? (
                    <span
                      className="af-wlb-bid af-num"
                      data-over={faab.remaining != null && bidQuotes[c.sleeperId] > faab.remaining ? 'true' : undefined}
                      title={m.bidTitle}
                    >
                      {m.bid} ~${bidQuotes[c.sleeperId]}
                      {faab.remaining != null && bidQuotes[c.sleeperId] > faab.remaining
                        ? m.overYourLeft(faab.remaining)
                        : ''}
                    </span>
                  ) : null}
                </span>
              </span>
              {/* The headline. Everything else on the row justifies it. */}
              <span className="af-wlb-gain af-num">+{c.gain.toFixed(1)}</span>
              <span className="af-wlb-over">
                {c.displaces ? (
                  <>
                    {m.over} {c.displaces.name}{' '}
                    <span className="af-num">
                      ({c.displaces.projectedPoints.toFixed(1)}
                      {c.displaces.afProjectedPoints != null ? ` · AF ${c.displaces.afProjectedPoints.toFixed(1)}` : ''})
                    </span>
                  </>
                ) : (
                  // No incumbent to name; a blank here would read as a bug.
                  m.fillsEmptySlot
                )}
              </span>
            </li>
          ))}
        </ul>
          )}
        </WaiverFilteredList>
      )}

      {rollingPriority && board.state === 'ok' && board.candidates.length > 0 ? (
        <PriorityCost priority={rollingPriority} candidates={board.candidates} perGame={perGame} />
      ) : null}

      {/*
        Coverage rides with the ranking. A board built from a third of the wire is a different
        claim from one built off all of it, and nothing else on screen would say which.
      */}
      {board.notes.map((n) => (
        <p key={n} className="af-wlb-note">
          {copy(n)}
        </p>
      ))}
    </section>
  )
}

/**
 * What your roster needs from the wire: empty starting slots this week, positions with no backup,
 * and byes in the weeks just ahead. Three checkable facts (lib/waivers/rosterNeeds.ts) — nothing
 * here grades the roster.
 */
/** The tint family for a position badge: the four skill positions by name, kickers, and one for the rest. */
function posKey(position: string | null | undefined): string {
  const p = String(position ?? '').toUpperCase()
  if (p === 'QB' || p === 'RB' || p === 'WR' || p === 'TE' || p === 'K') return p
  return 'OTHER'
}

type Candidate = WaiverBoard['candidates'][number]

/**
 * The full-width filter bar over the ranked adds, then the list. Exported for tests.
 *
 * It filters what the board already ranked — it never asks for more players, and the ranking itself is
 * untouched. Chips are the positions actually on the list (no chip that can only ever empty it), and the
 * bar is not drawn for a list too short to need one.
 */
export function WaiverFilteredList({
  candidates,
  query,
  pos,
  onQuery,
  onPos,
  children,
}: {
  candidates: Candidate[]
  query: string
  pos: string | null
  onQuery: (q: string) => void
  onPos: (p: string | null) => void
  children: (shown: Candidate[]) => ReactNode
}) {
  const m = useMessages(waiverLineupBoardMessages)
  const positions = [...new Set(candidates.map((c) => c.position).filter((p): p is string => !!p))]
  const q = query.trim().toLowerCase()
  const shown = candidates.filter(
    (c) => (pos == null || c.position === pos) && (q === '' || c.name.toLowerCase().includes(q)),
  )
  const showBar = candidates.length >= 3
  return (
    <>
      {showBar ? (
        <div className="af-wlb-filter" role="group" aria-label={m.filterLabel} data-testid="waiver-filter-bar">
          <input
            type="search"
            className="af-wlb-search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={m.searchPlaceholder}
            aria-label={m.searchLabel}
          />
          {positions.length > 1 ? (
            <div className="af-wlb-chips">
              <button type="button" className="af-wlb-chip-btn" aria-pressed={pos == null} onClick={() => onPos(null)}>
                {m.allPositions}
              </button>
              {positions.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="af-wlb-chip-btn"
                  data-pos={posKey(p)}
                  aria-pressed={pos === p}
                  onClick={() => onPos(pos === p ? null : p)}
                >
                  {p}
                </button>
              ))}
            </div>
          ) : null}
          {shown.length !== candidates.length ? (
            <span className="af-wlb-count af-num" aria-live="polite">
              {m.showing(shown.length, candidates.length)}
            </span>
          ) : null}
        </div>
      ) : null}
      {shown.length > 0 ? (
        <>
          {/* Column heads for the wide table; every row carries its own labels, so this is decoration. */}
          <div className="af-wlb-head" aria-hidden="true">
            <span />
            <span>{m.colPlayer}</span>
            <span>{m.colGain}</span>
            <span>{m.colOver}</span>
          </div>
          {children(shown)}
        </>
      ) : (
        <p className="af-wlb-why" data-testid="waiver-filter-empty">
          {m.noMatches}{' '}
          <button
            type="button"
            className="af-wlb-clear"
            onClick={() => {
              onQuery('')
              onPos(null)
            }}
          >
            {m.clearFilter}
          </button>
        </p>
      )}
    </>
  )
}

function RosterNeedsStrip({ needs }: { needs: RosterNeeds }) {
  const m = useMessages(waiverLineupBoardMessages)
  const byes = needs.byes.filter((b) => b.players.some((p) => p.starter))
  if (needs.emptySlots.length === 0 && needs.noBackup.length === 0 && byes.length === 0) return null
  return (
    <ul className="af-wlb-needs" data-testid="waiver-roster-needs" aria-label={m.rosterNeedsLabel}>
      {needs.emptySlots.length > 0 ? (
        <li data-tone="bad">
          <span className="af-wlb-need-k">
            {m.empty}
            {needs.week != null ? m.inWeek(needs.week) : ''}
          </span>
          {needs.emptySlots.join(', ')}
        </li>
      ) : null}
      {needs.noBackup.map((n) => (
        <li key={n.position} data-tone="warn">
          <span className="af-wlb-need-k">{m.noBackup(n.position)}</span>
          {m.rosteredFor(n.rostered, n.starting)}
        </li>
      ))}
      {byes.map((b) => (
        <li key={b.week} data-tone={needs.week != null && b.week === needs.week ? 'bad' : 'muted'}>
          <span className="af-wlb-need-k">{m.byeWeek(b.week)}</span>
          {/* Starters only: a bench player's bye changes nothing you start. */}
          {b.players
            .filter((p) => p.starter)
            .map((p) => `${p.name}${p.position ? ` (${p.position})` : ''}`)
            .join(', ')}
        </li>
      ))}
    </ul>
  )
}

/**
 * Rolling priority: a claim sends you to the back of the order. Two numbers decide whether that
 * is worth it — the best add's gain, and how much you give up by taking the next-best instead
 * (or by waiting, when he is the only one). Stated, not decided: how much a priority slot is
 * worth this late in a season is the manager's call.
 */
function PriorityCost({
  priority,
  candidates,
  perGame,
}: {
  priority: { priority: number; leagueRosters: number }
  candidates: WaiverBoard['candidates']
  perGame: boolean
}) {
  const m = useMessages(waiverLineupBoardMessages)
  const [top, next] = candidates
  const unit = perGame ? m.perGame : ''
  const last = priority.priority === priority.leagueRosters
  return (
    <p className="af-wlb-priority" data-testid="waiver-priority-cost">
      <strong>{m.yourPriority(priority.priority, priority.leagueRosters)}</strong>{' '}
      {last ? m.alreadyLast : m.claimSendsYouTo(priority.leagueRosters)}
      {!last
        ? next
          ? m.priorityGap(top.name, top.gain.toFixed(1), unit, next.name, next.gain.toFixed(1), (top.gain - next.gain).toFixed(1))
          : m.onlyFreeAgent(top.name, top.gain.toFixed(1), unit)
        : ''}
    </p>
  )
}

export default WaiverLineupBoard
