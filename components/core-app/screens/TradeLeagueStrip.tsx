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
 * ⚠ ONE PANEL READ PER LEAGUE, IN PARALLEL, CAPPED. Each read may scan the
 * provider's pending transactions, which is what the league Trades tab already
 * costs per open. Ten leagues at once is ten of those; the cap keeps a manager
 * with thirty leagues from turning a page load into a provider sweep.
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
}

type PanelLite = {
  pending?: { scanned: boolean; reason: string | null; platform: string }
  pendingOffers?: Array<{ direction: 'incoming' | 'outgoing'; partnerName: string }>
  activeTrades?: Array<{ direction: string; status?: string; partnerName?: string }>
}

type TileState =
  | { kind: 'checking' }
  | { kind: 'failed' }
  | { kind: 'unread'; reason: string | null }
  | { kind: 'waiting'; count: number; from: string | null }
  | { kind: 'clear' }

const MAX_LEAGUES_READ = 8

function stateOf(panel: PanelLite): TileState {
  /* The order of these branches is the whole point — see the header. */
  if (panel.pending && !panel.pending.scanned) {
    return { kind: 'unread', reason: panel.pending.reason }
  }
  const incoming = (panel.pendingOffers ?? []).filter((o) => o.direction === 'incoming')
  /*
   * AF-native proposals waiting on the viewer count too — they are real offers,
   * they just live in our tables rather than the provider's.
   */
  const native = (panel.activeTrades ?? []).filter(
    (t) => t.direction === 'incoming' && t.status !== 'pending_on_sleeper',
  )
  const count = incoming.length + native.length
  if (count > 0) {
    const from = incoming[0]?.partnerName ?? native[0]?.partnerName ?? null
    return { kind: 'waiting', count, from }
  }
  return { kind: 'clear' }
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
        text: `${s.count} ${s.count === 1 ? 'offer' : 'offers'} waiting${s.from ? ` · from ${s.from}` : ''}`,
        tone: 'waiting',
      }
    case 'clear':
      return { text: 'Nothing waiting', tone: 'clear' }
  }
}

export function TradeLeagueStrip(props: { leagues: StripLeague[]; activeLeagueId: string | null }) {
  const leagues = props.leagues.slice(0, MAX_LEAGUES_READ)
  const [states, setStates] = useState<Record<string, TileState>>({})

  useEffect(() => {
    let cancelled = false
    /* Cancels whichever deferral won — idle callback or timer — on unmount. */
    let cleanupDeferred: () => void = () => {}
    const ids = leagues.map((l) => l.id)
    setStates(Object.fromEntries(ids.map((id) => [id, { kind: 'checking' as const }])))

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
        while (!cancelled && cursor < ids.length) {
          const id = ids[cursor]
          cursor += 1
          if (id) await runOne(id)
        }
      }
      void Promise.all(Array.from({ length: STRIP_CONCURRENCY }, () => worker()))
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
          {beyond > 0 ? ` · ${beyond} more not read here` : ''}
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
              href={`/core/trades?league=${encodeURIComponent(l.id)}`}
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
                </span>
              </span>
              <span className="af-tc-tile-status af-num" data-tone={line.tone}>
                {line.text}
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
