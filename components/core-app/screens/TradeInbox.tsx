'use client'

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
 * ⚠ READ-ONLY, BY THE PROVIDER'S CONSTRUCTION. Sleeper's public API has no
 * write endpoint, so there is no accept, no reject and no counter here — those
 * controls would be lies with buttons on them. What we can do is price the
 * offer, which is the point: "Load into builder" drops it into the analyzer on
 * this page, and the manager acts on Sleeper.
 *
 * ⚠ NO NEW API ROUTE. Reads the existing `/api/league/trades-panel`.
 */

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

type NativeRow = {
  id: string
  direction: 'incoming' | 'outgoing' | 'complete'
  partnerName: string
  status?: string
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

export function TradeInbox(props: {
  leagueId: string | null
  /** Hands a whole offer to the builder on this page. */
  onLoad: (give: PickedAsset[], get: PickedAsset[], note: string | null) => void
}) {
  const [data, setData] = useState<PanelResponse | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')

  const { leagueId, onLoad } = props

  const load = useCallback(async () => {
    if (!leagueId) return
    setState('loading')
    try {
      const r = await fetch(`/api/league/trades-panel?leagueId=${encodeURIComponent(leagueId)}`)
      const j = (await r.json().catch(() => ({}))) as PanelResponse
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
  }, [leagueId])

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

      {nativeOpen.length > 0 ? (
        <p className="af-tc-row-sub af-tc-inbox-note">
          {nativeOpen.length} open {nativeOpen.length === 1 ? 'proposal' : 'proposals'} made inside
          AllFantasy — accept, reject and counter live on the league page.
        </p>
      ) : null}
    </div>
  )
}
