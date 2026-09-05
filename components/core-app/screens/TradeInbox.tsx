'use client'

import { fetchTradesPanel } from '@/components/core-app/screens/tradesPanelFetch'

import { useCallback, useEffect, useState } from 'react'
import type { PickedAsset } from '@/components/core-app/screens/TradeAssetPicker'

/**
 * Inbox & Sent on the Trade Center.
 *
 * WHAT CHANGED: both panels used to be a flat refusal — "pending offers are not
 * ingested" — which was true of the database and false of the platform. Sleeper
 * does expose open offers at `/league/<id>/transactions/<week>` with
 * `status: "pending"`, and `scanPendingSleeperTrades` has read them for the
 * league Trades tab for a while. This brings them onto the surface where a
 * manager can actually do something with one.
 *
 * ⚠ AN EMPTY INBOX IS TWO DIFFERENT FACTS AND THEY MUST NOT LOOK ALIKE. "We
 * looked and nothing is waiting" and "we never looked" are both zero rows. The
 * route now returns `pending.scanned` precisely so this component can tell them
 * apart, and NOTHING here may render "no offers waiting" unless `scanned` is
 * true. Getting this wrong tells a Yahoo manager their inbox is clear when we
 * have never once read it.
 *
 * ⚠ PROVIDER OFFERS ARE READ-ONLY, BY THE PROVIDER'S CONSTRUCTION. Sleeper's
 * public API has no write endpoint, so a Sleeper offer gets no accept, no reject
 * and no counter — those controls would be lies with buttons on them. What we can
 * do is price it: "Load into builder" drops it into the analyzer on this page, and
 * the manager acts on Sleeper.
 *
 * ⚠ AF-NATIVE OFFERS ARE A DIFFERENT STREAM AND THIS DISTINCTION IS THE WHOLE
 * REASON BOTH LISTS EXIST HERE. A native offer lives in our own tables, so it CAN
 * be answered — and incoming ones now carry a Counter control that arms the builder
 * below. The sentence above used to read "no counter here" without qualification,
 * which was true when nothing could be countered and became a false absence claim
 * the moment the native path shipped.
 *
 * ⚠ NO NEW API ROUTE. Reads the existing `/api/league/trades-panel`.
 */

/** One row of `AfLeagueTradeItem` as `GET /api/leagues/<id>/trades/<tradeId>` returns it. */
export type NativeTradeItem = {
  itemType: string
  itemReference: string | null
  fromRosterId: string
  toRosterId: string
  faabAmount?: number | null
  metadata?: unknown
}

type OfferAsset = {
  playerId: string | null
  name: string
  position: string | null
  team: string | null
  isPick: boolean
  pickYear: number | null
  pickRound: number | null
  faabAmount: number | null
}

type Offer = {
  transactionId: string
  direction: 'incoming' | 'outgoing'
  partnerName: string
  proposedAt: string | null
  give: OfferAsset[]
  get: OfferAsset[]
}

/**
 * An `activeTrades` row as `/api/league/trades-panel` returns it.
 *
 * ⚠ THIS TYPE IS A HAND-WRITTEN MIRROR OF THE WIRE SHAPE, so it drifts silently:
 * nothing links it to the route, and a field the route sends is simply absent here
 * until someone needs it. `sent` and `received` were exactly that — returned by
 * `buildNativeActiveTrades` since it was written, undeclared here, and so unusable
 * without a type error the moment the counter row tried to count them.
 */
type NativeRow = {
  id: string
  direction: 'incoming' | 'outgoing' | 'complete'
  partnerName: string
  status?: string
  /** Leaving the viewer's roster / arriving on it. Labels only — see `assetLabel`. */
  sent: Array<{ id: string; label: string }>
  received: Array<{ id: string; label: string }>
}

type PanelResponse = {
  activeTrades?: NativeRow[]
  pending?: {
    scanned: boolean
    reason: string | null
    platform: string
    leagueUrl: string | null
    weeksUnanswered: number
  }
  pendingOffers?: Offer[]
  error?: string
}

/**
 * Back into the builder's asset vocabulary.
 *
 * Returns the assets it could rebuild AND the ones it could not, because a
 * silently shortened offer analyses as a different deal — one side lighter than
 * what the manager was actually sent.
 */
export function toPickedAssets(assets: OfferAsset[]): {
  picked: PickedAsset[]
  dropped: string[]
} {
  const picked: PickedAsset[] = []
  const dropped: string[] = []

  for (const a of assets) {
    if (a.faabAmount != null) {
      picked.push({ kind: 'faab', amount: a.faabAmount })
      continue
    }
    if (a.isPick) {
      if (a.pickYear != null && a.pickRound != null) {
        picked.push({
          kind: 'pick',
          year: a.pickYear,
          round: a.pickRound,
          label: `${a.pickYear} round ${a.pickRound}`,
        })
      } else {
        /* A pick with no year or round cannot be priced as one. */
        dropped.push(a.name)
      }
      continue
    }
    picked.push({
      kind: 'player',
      /*
       * ⚠ NAME, NOT THE PROVIDER'S ID. `playerId` here is a SLEEPER id, and the
       * analyzer's `playerId` means an id in our own space. Passing one for the
       * other would either miss or, worse, resolve to a different player. Name
       * resolution is the same path the search picker uses for every
       * FantasyCalc result, which carries no id either.
       */
      playerId: null,
      name: a.name,
      position: a.position,
      team: a.team,
      value: null,
    })
  }

  return { picked, dropped }
}

function whenLabel(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function assetLine(a: OfferAsset): string {
  if (a.faabAmount != null) return a.name
  if (a.isPick) return a.name
  const meta = [a.position, a.team].filter(Boolean).join(' · ')
  return meta ? `${a.name} — ${meta}` : a.name
}

/**
 * Rebuild a NATIVE trade's items as builder assets, seen from the roster that
 * received the offer.
 *
 * 🛑 THIS IS NOT `toPickedAssets`, AND THE DIFFERENCE IS WHAT MAKES A COUNTER
 * SENDABLE. That converter reads a PROVIDER offer, where the only identifier is a
 * Sleeper id we deliberately do not pass on, so it rebuilds players by NAME and
 * drops picks entirely — fine for pricing, useless for proposing.
 *
 * A native trade stores our own identifiers in `itemReference`: a player id the
 * reconciler can match against the roster, and for a pick the stored pick id the
 * engine matches on. Carrying those through is why the counter arrives as a
 * complete deal instead of tripping the panel's partial-deal refusal.
 */
export function nativeItemsToAssets(
  items: NativeTradeItem[],
  receiverRosterId: string,
): { give: PickedAsset[]; get: PickedAsset[] } {
  const give: PickedAsset[] = []
  const get: PickedAsset[] = []

  for (const it of items) {
    // Seen from the receiver: leaving their roster is a give, arriving is a get.
    const bucket = it.fromRosterId === receiverRosterId ? give : it.toRosterId === receiverRosterId ? get : null
    if (!bucket) continue

    if (it.itemType === 'faab' && it.faabAmount != null) {
      bucket.push({ kind: 'faab', amount: it.faabAmount })
      continue
    }

    const meta = it.metadata && typeof it.metadata === 'object' ? (it.metadata as Record<string, unknown>) : {}
    const str = (k: string): string | null => (typeof meta[k] === 'string' && meta[k] ? (meta[k] as string) : null)

    if (it.itemType === 'rookie_pick' || it.itemType === 'future_pick') {
      const year = Number(meta.pickYear)
      const round = Number(meta.pickRound)
      bucket.push({
        kind: 'pick',
        year: Number.isFinite(year) ? year : 0,
        round: Number.isFinite(round) ? round : 0,
        label: str('playerName') ?? (Number.isFinite(year) && Number.isFinite(round) ? `${year} round ${round}` : 'Pick'),
        // The stored id is the whole point — a pick without one cannot be proposed.
        pickId: it.itemReference,
        itemType: it.itemType,
      })
      continue
    }

    bucket.push({
      kind: 'player',
      playerId: it.itemReference,
      name: str('playerName') ?? it.itemReference ?? 'Player',
      position: str('position'),
      team: str('team'),
      value: null,
    })
  }

  return { give, get }
}

export function TradeInbox(props: {
  leagueId: string | null
  /** Hands a whole offer to the builder on this page. */
  onLoad: (give: PickedAsset[], get: PickedAsset[], note: string | null) => void
  /**
   * Hands a NATIVE offer to the builder in counter mode. Absent means the screen
   * cannot counter, and no counter control is rendered — a button that cannot
   * finish what it starts is the thing this panel already refuses to draw.
   */
  onCounter?: (input: {
    tradeId: string
    give: PickedAsset[]
    get: PickedAsset[]
    partnerRosterId: string
    label: string
  }) => void
  /**
   * Bumped by the screen after a send lands. Sending a counter CLOSES the offer it
   * answers, so without a refetch that offer keeps its Counter button and a second
   * press answers a trade the engine has already moved on from.
   *
   * ⚠ Forced past the share window on purpose. `fetchTradesPanel` collapses reads
   * inside 5s so this component and the league strip make one request — correct on
   * load, wrong here, because the write that just happened is exactly what the
   * cached response predates.
   */
  reloadToken?: number
}) {
  const [data, setData] = useState<PanelResponse | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [countering, setCountering] = useState<{ id: string; state: 'loading' | 'failed' } | null>(null)

  const { leagueId, onLoad, onCounter, reloadToken = 0 } = props

  const load = useCallback(async () => {
    if (!leagueId) return
    setState('loading')
    try {
      /*
       * ⚠ SHARED WITH TradeLeagueStrip, which also reads this league's panel on the same
       * load. Two components, one request — see tradesPanelFetch for the measurement.
       * A non-zero reloadToken means a write just landed, so that sharing is skipped:
       * the cached response is older than the change we are refetching to see.
       */
      const r = await fetchTradesPanel(leagueId, reloadToken > 0 ? { force: true } : undefined)
      const j = r.data as PanelResponse
      if (!r.ok) {
        setData(null)
        setState('failed')
        return
      }
      setData(j)
      setState('idle')
    } catch {
      setData(null)
      setState('failed')
    }
    // reloadToken is a dependency, not decoration: bumping it is what re-runs the read.
  }, [leagueId, reloadToken])

  useEffect(() => {
    void load()
  }, [load])

  const loadOffer = useCallback(
    (o: Offer) => {
      const g = toPickedAssets(o.give)
      const k = toPickedAssets(o.get)
      const dropped = [...g.dropped, ...k.dropped]
      onLoad(
        g.picked,
        k.picked,
        dropped.length > 0
          ? `Loaded without ${dropped.join(', ')} — that asset could not be rebuilt, so the verdict is short one piece.`
          : null,
      )
    },
    [onLoad],
  )

  /*
   * ⚠ THE PANEL'S OWN ASSET SHAPE IS NOT ENOUGH TO COUNTER WITH, so this re-reads
   * the trade. `assetLabel` in the panel route keeps a label and a position and
   * DISCARDS `itemReference` — fine for a list, fatal for a proposal, because the
   * engine matches players and picks by that id. The detail route returns the raw
   * items, so the counter is built from identifiers rather than from display text.
   */
  const counterOffer = useCallback(
    async (t: { id: string; partnerName?: string | null }) => {
      if (!leagueId || !onCounter) return
      setCountering({ id: t.id, state: 'loading' })
      try {
        const r = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(t.id)}`,
          { cache: 'no-store' },
        )
        const j = (await r.json().catch(() => ({}))) as {
          trade?: { items?: NativeTradeItem[]; receiverRosterId?: string; proposerRosterId?: string }
        }
        const trade = j.trade
        if (!r.ok || !trade?.items || !trade.receiverRosterId || !trade.proposerRosterId) {
          setCountering({ id: t.id, state: 'failed' })
          return
        }
        const { give, get } = nativeItemsToAssets(trade.items, trade.receiverRosterId)
        onCounter({
          tradeId: t.id,
          give,
          get,
          /* The viewer received this offer, so the counterparty is whoever proposed it. */
          partnerRosterId: trade.proposerRosterId,
          label: t.partnerName ? `${t.partnerName}’s offer` : 'their offer',
        })
        setCountering(null)
      } catch {
        setCountering({ id: t.id, state: 'failed' })
      }
    },
    [leagueId, onCounter],
  )

  if (!leagueId) return null

  const offers = data?.pendingOffers ?? []
  const inbox = offers.filter((o) => o.direction === 'incoming')
  const sent = offers.filter((o) => o.direction === 'outgoing')
  const pending = data?.pending ?? null

  /*
   * AF-native proposals are a separate stream: they live in our own tables and
   * they DO have accept/reject — on the league page, not here. Counting them is
   * honest; rendering action buttons that this screen cannot honour is not.
   */
  const nativeOpen = (data?.activeTrades ?? []).filter(
    (t) => t.status !== 'pending_on_sleeper' && t.direction !== 'complete',
  )

  /*
   * ⚠ ONLY INCOMING OFFERS CAN BE COUNTERED, and the restriction is the engine's,
   * not a UI preference: countering marks the offer you are answering 'countered'.
   * Offering that on your OWN outgoing proposal would let you close your own offer
   * and call it a negotiation — `cancel` is the control for that, and it exists.
   */
  const nativeIncoming = nativeOpen.filter((t) => t.direction === 'incoming')

  const column = (title: string, rows: Offer[], emptyWhenScanned: string) => (
    <section className="af-tc-inbox-col">
      <div className="af-label">{title}</div>

      {/*
        ⚠ THE ORDER OF THESE BRANCHES IS THE WHOLE POINT. "Not scanned" is
        checked before "empty", so a league we never read never renders as a
        league with nothing in it.
      */}
      {state === 'failed' ? (
        <p className="af-tc-row-sub">
          We couldn&rsquo;t load this league&rsquo;s offers just now.
        </p>
      ) : state === 'loading' && data == null ? (
        <p className="af-tc-row-sub">Checking&hellip;</p>
      ) : pending && !pending.scanned ? (
        <p className="af-tc-row-sub">
          {pending.reason ?? 'Pending offers have not been read for this league.'}
        </p>
      ) : rows.length === 0 ? (
        <p className="af-tc-row-sub">
          {emptyWhenScanned}
          {pending && pending.weeksUnanswered > 0
            ? ` Sleeper did not answer for ${pending.weeksUnanswered} of the weeks we asked about, so this is short of a full read.`
            : ''}
        </p>
      ) : (
        rows.map((o) => (
          <article key={o.transactionId} className="af-tc-offer">
            <header className="af-tc-offer-head">
              <span className="af-tc-offer-partner">{o.partnerName}</span>
              {whenLabel(o.proposedAt) ? (
                <span className="af-tc-row-sub">{whenLabel(o.proposedAt)}</span>
              ) : null}
            </header>

            <div className="af-tc-offer-sides">
              <div>
                <span className="af-tc-sends">You send</span>
                {o.give.length === 0 ? (
                  <p className="af-tc-row-sub">Nothing</p>
                ) : (
                  o.give.map((a, i) => (
                    <p key={`${o.transactionId}-g-${i}`} className="af-tc-offer-asset">
                      {assetLine(a)}
                    </p>
                  ))
                )}
              </div>
              <div>
                <span className="af-tc-sends">You get</span>
                {o.get.length === 0 ? (
                  <p className="af-tc-row-sub">Nothing</p>
                ) : (
                  o.get.map((a, i) => (
                    <p key={`${o.transactionId}-r-${i}`} className="af-tc-offer-asset">
                      {assetLine(a)}
                    </p>
                  ))
                )}
              </div>
            </div>

            <div className="af-tc-offer-actions">
              <button type="button" className="af-btn af-btn--ghost" onClick={() => loadOffer(o)}>
                Load into builder
              </button>
              {/*
                Not an accept button. The provider has no write endpoint, so the
                only truthful action is to send them where the offer lives.
              */}
              {pending?.leagueUrl ? (
                <a
                  className="af-tc-offer-link"
                  href={pending.leagueUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Act on it in Sleeper
                </a>
              ) : null}
            </div>
          </article>
        ))
      )}
    </section>
  )

  return (
    <div className="af-tc-inbox">
      {column('Inbox', inbox, 'Nothing waiting on you right now.')}
      {column('Sent', sent, 'You have no offers out.')}

      {/*
        🛑 THIS NOTE USED TO SAY "accept, reject and counter live on the league page".
        Accept and reject do. Counter did not live anywhere — the route existed with
        zero UI callers, so the sentence sent people looking for a control nobody had
        built. Countering is now done here, and the note claims only what is true.
      */}
      {nativeIncoming.length > 0 && onCounter ? (
        <div className="af-tc-inbox-native">
          <div className="af-label">Open AllFantasy offers</div>
          {nativeIncoming.map((t) => (
            <div key={t.id} className="af-tc-offer-actions af-tc-native-row">
              <span className="af-tc-row-sub">
                {t.partnerName ?? 'A manager'} — {t.received.length} for {t.sent.length}
              </span>
              <button
                type="button"
                className="af-btn af-btn--ghost"
                onClick={() => void counterOffer(t)}
                disabled={countering?.id === t.id && countering.state === 'loading'}
              >
                {countering?.id === t.id && countering.state === 'loading' ? 'Loading…' : 'Counter'}
              </button>
              {countering?.id === t.id && countering.state === 'failed' ? (
                <span className="af-tc-nosignal">Could not load that offer to counter it.</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {nativeOpen.length > nativeIncoming.length || (nativeOpen.length > 0 && !onCounter) ? (
        <p className="af-tc-row-sub af-tc-inbox-note">
          {nativeOpen.length} open {nativeOpen.length === 1 ? 'proposal' : 'proposals'} made inside
          AllFantasy — accept and reject live on the league page.
        </p>
      ) : null}
    </div>
  )
}
