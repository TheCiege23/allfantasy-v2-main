'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchTradesPanel } from '@/components/core-app/screens/tradesPanelFetch'

/**
 * Offers across your leagues — the strip above the Trade Center's league
 * context bar (design-refs/trade-center-handoff, Core).
 *
 * The Trade Center is league-scoped, but the question a manager arrives with
 * is cross-league: "is anything waiting on me, anywhere?" One tile per
 * connected league answers it without leaving the page, and clicking a tile
 * switches the page's league context.
 *
 * ⚠ NOT SCANNED IS CHECKED BEFORE EMPTY. The panel route returns
 * `pending.scanned` precisely so a league we never read cannot render as a
 * league with nothing in it — the same rule TradeInbox carries. A Yahoo or
 * Sleeper league says "Nothing waiting"; an ESPN league says it was not read,
 * and why.
 *
 * ⚠ ONE PANEL READ PER VISIBLE LEAGUE, BATCHED. Each read may scan the
 * provider's pending transactions. The first eight load on entry; managers can
 * reveal further batches without turning a many-league page load into a sweep.
 *
 * ⚠ NO NEW API ROUTE. Reads the existing `/api/league/trades-panel`.
 */

export type StripLeague = {
  id: string
  name: string
  platform: string
  /** Single letter for the mark — the caller resolves it the way the rail does. */
  mark: string
  /** "NFL · 12 teams" — whatever the caller can say cheaply. */
  meta?: string | null
  syncAge?: 'recent' | 'over-day' | 'unknown'
  deadlineWeek?: number | null
  deadlineKnown?: boolean
  currentWeek?: number | null
}

type OfferLite = { direction: 'incoming' | 'outgoing'; partnerName?: string; proposedAt?: string | null; timestamp?: string | null; status?: string }
type PanelLite = {
  pending?: { scanned: boolean; reason: string | null; platform: string }
  pendingOffers?: OfferLite[]
  activeTrades?: OfferLite[]
}

type LastOffer = { direction: 'incoming' | 'outgoing'; partner: string | null; at: string | null }
type TileState =
  | { kind: 'checking' }
  | { kind: 'failed' }
  | { kind: 'unread'; reason: string | null }
  | { kind: 'waiting'; count: number; nativeCount: number; from: string | null; last: LastOffer | null; partial: boolean }
  | { kind: 'clear'; last: LastOffer | null }

const MAX_LEAGUES_READ = 8

export function stateOf(panel: PanelLite): TileState {
  const partial = Boolean(panel.pending && !panel.pending.scanned)
  const provider = panel.pendingOffers ?? []
  /*
   * AF-native proposals waiting on the viewer count too — they are real offers,
   * they just live in our tables rather than the provider's.
   */
  // Provider offers appear in both lists. Count and summarize each only once.
  const native = (panel.activeTrades ?? []).filter((t) => !t.status?.startsWith('pending_on_'))
  const incoming = [...provider, ...native].filter((o) => o.direction === 'incoming')
  const lastRow = [...provider, ...native]
    .filter((o) => o.direction === 'incoming' || o.direction === 'outgoing')
    .sort((a, b) => {
      const at = Date.parse(a.proposedAt ?? a.timestamp ?? '')
      const bt = Date.parse(b.proposedAt ?? b.timestamp ?? '')
      return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0)
    })[0]
  const last: LastOffer | null = lastRow ? {
    direction: lastRow.direction,
    partner: lastRow.partnerName && lastRow.partnerName !== 'Awaiting response' ? lastRow.partnerName : null,
    at: lastRow.proposedAt ?? lastRow.timestamp ?? null,
  } : null
  const count = incoming.length
  if (count > 0) {
    const from = incoming.find((o) => o.partnerName && o.partnerName !== 'Awaiting response')?.partnerName ?? null
    return { kind: 'waiting', count, nativeCount: native.filter((o) => o.direction === 'incoming').length, from, last, partial }
  }
  if (partial) return { kind: 'unread', reason: panel.pending?.reason ?? null }
  return { kind: 'clear', last }
}

function deadlineLine(league: StripLeague): string {
  if (!league.deadlineKnown) return 'Deadline unavailable'
  if (league.deadlineWeek == null) return 'No trade deadline'
  const current = league.currentWeek
  const when = current === league.deadlineWeek ? ' · this week'
    : current != null && current > league.deadlineWeek ? ' · passed' : ''
  return `Deadline · week ${league.deadlineWeek}${when}`
}

function lastOfferLine(last: LastOffer | null): string {
  if (!last) return 'No recent offer in this feed'
  const date = last.at && Number.isFinite(Date.parse(last.at))
    ? ` · ${new Date(last.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''
  if (last.direction === 'outgoing') return `Last sent offer${last.partner ? ` · to ${last.partner}` : ''}${date}`
  return `Last received offer${last.partner ? ` · from ${last.partner}` : ''}${date}`
}

function nextAction(state: TileState, platform: string): string {
  if (state.kind === 'waiting') return state.nativeCount > 0 ? 'Respond in league' : `Review ${state.count === 1 ? 'offer' : 'offers'}`
  if (state.kind === 'checking') return 'Open league trades'
  if (state.kind === 'failed') return 'Open league · retry'
  if (state.kind === 'unread' || platform.toLowerCase() === 'sleeper') return 'Check source offers'
  return 'Build a trade'
}

function statusLine(s: TileState, platform: string): { text: string; tone: string } {
  switch (s.kind) {
    case 'checking':
      return { text: 'Checking…', tone: 'faint' }
    case 'failed':
      return { text: 'Could not read this league just now', tone: 'faint' }
    case 'unread':
      return {
        text: s.reason ? `Not read — ${s.reason}` : `Not read — ${platform} offers aren’t ingested yet`,
        tone: 'faint',
      }
    case 'waiting':
      return {
        text: `${s.partial ? 'At least ' : ''}${s.count} ${s.count === 1 ? 'offer' : 'offers'} waiting${s.from ? ` · from ${s.from}` : ''}`,
        tone: 'waiting',
      }
    case 'clear':
      /*
       * Sleeper's public feed carries a trade only once it is accepted (see TradeInbox), so for a
       * Sleeper league "nothing waiting" is a claim we cannot check. Say what we actually know.
       */
      return platform.toLowerCase() === 'sleeper'
        ? { text: 'None visible · open offers live in Sleeper', tone: 'faint' }
        : { text: 'Nothing waiting', tone: 'clear' }
  }
}

export function TradeLeagueStrip(props: { leagues: StripLeague[]; activeLeagueId: string | null }) {
  const [visibleCount, setVisibleCount] = useState(MAX_LEAGUES_READ)
  const leagues = props.leagues.slice(0, visibleCount)
  const [states, setStates] = useState<Record<string, TileState>>({})

  useEffect(() => {
    let cancelled = false
    /* Cancels whichever deferral won — idle callback or timer — on unmount. */
    let cleanupDeferred: () => void = () => {}
    const ids = leagues.map((l) => l.id)
    const idsToRead = ids.filter((id) => !states[id] || states[id].kind === 'checking')
    setStates((previous) => Object.fromEntries(ids.map((id) => [id, previous[id] ?? { kind: 'checking' as const }])))

    /*
     * 🛑 EACH TILE SETTLES ON ITS OWN. This used to be one `Promise.allSettled(...).then()` that
     * called `setStates` ONCE, with every tile's answer, after the LAST league returned — so a
     * single slow league held all eight on "Checking…". Measured on the dev server, panel reads
     * ranged 506ms to 23,534ms in one page load, which meant the fast seven were finished and
     * invisible for twenty-odd seconds while the slowest one decided.
     *
     * ⚠ THE FAN-OUT IS UNCHANGED — same requests, same count, same cap.
     */
    const runOne = async (id: string) => {
      let next: TileState
      try {
        /*
         * ⚠ SHARED. The ACTIVE league is in this list and TradeInbox reads it too, so on
         * every load one league was fetched twice — a full panel read, provider scan
         * included. The other leagues are unaffected; they have only this caller.
         */
        const r = await fetchTradesPanel(id)
        if (!r.ok) throw new Error(String(r.status))
        next = stateOf(r.data as PanelLite)
      } catch {
        next = { kind: 'failed' }
      }
      if (cancelled) return
      /*
       * Merge, never replace: a whole-object `setStates` here would drop the tiles that have
       * already answered, which is the bug this shape exists to avoid.
       */
      setStates((prev) => ({ ...prev, [id]: next }))
    }

    /*
     * 🛑 THIS STRIP IS DECORATION AND IT WAS OUTRANKING THE LEAGUE THE MANAGER IS LOOKING AT.
     *
     * Eight panel reads fired the instant the page mounted. A browser allows roughly six
     * connections per host, and each of those reads can take tens of seconds, so the request for
     * THIS league's own rosters — the players and manager names on screen — queued behind seven
     * leagues nobody asked about. That is a large part of "the managers load in slow, the assets
     * load in slow": not that the data was slow, but that it was waiting its turn.
     *
     * Two changes, and neither drops a request or changes an answer:
     *   1. bounded to two at a time, so the strip can never own the connection pool
     *   2. started on idle rather than on mount, so the current league goes first
     */
    const STRIP_CONCURRENCY = 2
    const start = () => {
      let cursor = 0
      const worker = async (): Promise<void> => {
        while (!cancelled && cursor < idsToRead.length) {
          const id = idsToRead[cursor]
          cursor += 1
          if (id) await runOne(id)
        }
      }
      void Promise.all(Array.from({ length: Math.min(STRIP_CONCURRENCY, idsToRead.length) }, () => worker()))
    }

    /*
     * ⚠ `requestIdleCallback` IS NOT IN SAFARI AND THE TIMEOUT IS NOT OPTIONAL. Without the
     * fallback the strip would simply never load there, and without `timeout` a busy page could
     * postpone it indefinitely — "later" has to mean later, not never.
     */
    const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback
    const cancelRic = (globalThis as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
    let idleHandle: number | null = null
    let timerHandle: ReturnType<typeof setTimeout> | null = null
    if (typeof ric === 'function') idleHandle = ric(start, { timeout: 2000 })
    else timerHandle = setTimeout(start, 250)
    cleanupDeferred = () => {
      if (idleHandle !== null && typeof cancelRic === 'function') cancelRic(idleHandle)
      if (timerHandle !== null) clearTimeout(timerHandle)
    }

    return () => {
      cancelled = true
      /*
       * ⚠ CANCEL THE DEFERRAL TOO, not just the in-flight work. `cancelled` stops a fetch that
       * has already started; a pending idle callback would otherwise fire AFTER unmount and
       * start eight requests for a screen nobody is looking at.
       */
      cleanupDeferred()
    }
    /* Keyed on the id list, not the array identity the page rebuilds per render. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagues.map((l) => l.id).join('|')])

  if (leagues.length === 0) return null

  const beyond = props.leagues.length - leagues.length

  return (
    <section className="af-tc-strip" aria-label="Offers across your leagues">
      <div className="af-tc-strip-head">
        <span className="af-label">Offers across your leagues</span>
        <span className="af-tc-rule" aria-hidden />
        <span className="af-tc-strip-note">
          Sleeper and Yahoo are read · other platforms are not, and say so
          {beyond > 0 ? ` · ${beyond} more available below` : ''}
        </span>
      </div>
      <div className="af-tc-tiles">
        {leagues.map((l) => {
          const s = states[l.id] ?? { kind: 'checking' as const }
          const line = statusLine(s, l.platform)
          const active = l.id === props.activeLeagueId
          return (
            <Link
              key={l.id}
              href={s.kind === 'waiting' && s.nativeCount > 0
                ? `/league/${encodeURIComponent(l.id)}?view=trades`
                : `/core/trades?league=${encodeURIComponent(l.id)}`}
              className="af-tc-tile"
              data-active={active ? 'true' : undefined}
              aria-current={active ? 'true' : undefined}
            >
              <span className="af-tc-tile-head">
                <span className="af-tc-mark af-platform" data-platform={l.platform.toLowerCase()} aria-hidden>
                  {l.mark}
                </span>
                <span className="af-tc-tile-body">
                  <span className="af-tc-tile-name">{l.name}</span>
                  {l.meta ? <span className="af-tc-tile-meta">{l.meta}</span> : null}
                  {l.syncAge === 'over-day' ? <span className="af-tc-tile-sync">Last sync over 24 hours ago</span> : null}
                  {l.syncAge === 'unknown' ? <span className="af-tc-tile-sync">Sync time unavailable</span> : null}
                </span>
              </span>
              <span className="af-tc-tile-status af-num" data-tone={line.tone}>
                {line.text}
              </span>
              <span className="af-tc-tile-deadline">{deadlineLine(l)}</span>
              {(s.kind === 'waiting' || s.kind === 'clear') ? <span className="af-tc-tile-last">{lastOfferLine(s.last)}</span> : null}
              <span className="af-tc-tile-action">{nextAction(s, l.platform)} <span aria-hidden>→</span></span>
            </Link>
          )
        })}
      </div>
      {beyond > 0 ? (
        <button type="button" className="af-tc-strip-more" onClick={() => setVisibleCount((count) => count + MAX_LEAGUES_READ)}>
          Show {Math.min(beyond, MAX_LEAGUES_READ)} more {beyond === 1 ? 'league' : 'leagues'}
        </button>
      ) : null}
    </section>
  )
}
