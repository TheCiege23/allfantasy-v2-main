'use client'

/**
 * The league Trade Center's trade panel: Active · Review · History.
 *
 * Built on the same `/api/league/trades-panel` read as the inbox (`fetchTradesPanel` shares the request),
 * so nothing here is a second source of truth. What it adds is the shape of a trade center — one card per
 * trade, a detail pane with ONE block per team (what that team receives and sends, and whether it has
 * accepted), and the actions the engine already has routes for:
 *
 *   accept / reject / cancel / counter   app/api/leagues/[leagueId]/trades/[tradeId]/…
 *   vote (veto | allow)                  …/[tradeId]/vote          — the league veto window
 *   commissioner (approve | reject)      …/[tradeId]/commissioner  — commissioner review
 *
 * ⚠ PROVIDER OFFERS STAY READ-ONLY. A Sleeper or Yahoo offer has no write endpoint we can call, so its card
 * says where to answer it and offers "Load into builder" — never an accept button (see TradeInbox).
 *
 * History is the existing unified timeline (`TradeInbox view="timeline" historyMode`), which already carries
 * the grades, the "then and now" values and the impact review; it is not rebuilt here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LeagueTradeAsset, LeagueTradeHistoryItem } from '@/components/league/types'
import type { TradeRecord } from '@/lib/core-app/trades'
import type { PickedAsset } from '@/components/core-app/screens/TradeAssetPicker'
import { fetchTradesPanel } from '@/components/core-app/screens/tradesPanelFetch'
import { TradeInbox, nativeItemsToAssets, toPickedAssets, type NativeTradeItem } from '@/components/core-app/screens/TradeInbox'
import { useMessages } from '@/components/i18n/useMessages'
import { tradeCenterPanelMessages } from '@/lib/core-app/messages/tradeCenterPanel'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'

type PanelAsset = Pick<LeagueTradeAsset, 'id' | 'label' | 'sublabel' | 'headshotUrl'> & { pick?: LeagueTradeAsset['pick']; idol?: boolean }

type PanelTrade = Pick<
  LeagueTradeHistoryItem,
  | 'id' | 'direction' | 'partnerName' | 'status' | 'timestamp' | 'participantSides' | 'leagueGrade' | 'leagueGradeSide'
  | 'viewerIsCommissioner' | 'viewerIsReceiver' | 'viewerIsProposer' | 'viewerIsParticipant' | 'viewerRosterId'
  | 'expiresAt' | 'acceptedRosterIds' | 'votes' | 'viewerCanVote' | 'proposerName' | 'receiverName' | 'proposerRosterId'
> & { sent: PanelAsset[]; received: PanelAsset[] }

type ProviderAsset = {
  playerId: string | null
  name: string
  position: string | null
  team: string | null
  isPick: boolean
  pickYear: number | null
  pickRound: number | null
  faabAmount: number | null
}

type ProviderOffer = {
  provider?: 'sleeper' | 'yahoo'
  transactionId: string
  direction: 'incoming' | 'outgoing'
  partnerName: string
  proposedAt: string | null
  give: ProviderAsset[]
  get: ProviderAsset[]
}

type PanelData = {
  activeTrades?: PanelTrade[]
  pendingOffers?: ProviderOffer[]
  pending?: { platform: string; leagueUrl: string | null } | null
}

export type TradeCenterTab = 'active' | 'review' | 'history'

type Card =
  | { kind: 'native'; key: string; trade: PanelTrade }
  | { kind: 'provider'; key: string; offer: ProviderOffer }

const REVIEW_STATUSES = new Set(['awaiting_votes', 'awaiting_commissioner'])
const PROCESSING_STATUSES = new Set(['accepted', 'scheduled'])

/** "3rd" for a round; picks read as a token, "3rd / 2027". */
function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

function initials(label: string): string {
  return label.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
}

/** Remaining time, "19h 10m" / "2d 4h" / "12m". Null once it has passed. */
export function timeLeft(expiresAt: string | null | undefined, now: number): string | null {
  if (!expiresAt) return null
  const end = Date.parse(expiresAt)
  if (!Number.isFinite(end)) return null
  const ms = end - now
  if (ms <= 0) return null
  const mins = Math.floor(ms / 60_000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${Math.max(1, m)}m`
}

export function cardStatus(t: PanelTrade): 'incoming' | 'sent' | 'open' | 'votes' | 'commissioner' | 'processing' {
  const s = String(t.status ?? '').toLowerCase()
  if (s === 'awaiting_votes') return 'votes'
  if (s === 'awaiting_commissioner') return 'commissioner'
  if (PROCESSING_STATUSES.has(s)) return 'processing'
  if (t.direction === 'incoming') return 'incoming'
  if (t.direction === 'outgoing') return 'sent'
  return 'open'
}

/**
 * Where each team stands on an open offer. The proposer made it; `acceptedRosterIds` lists who has said yes
 * since (`metadata.acceptedRosterIds`); once the trade has left `pending`, every party has accepted.
 */
export function teamStanding(t: PanelTrade, rosterId: string, proposerRosterId: string | null): 'proposed' | 'accepted' | 'pending' {
  if (proposerRosterId && rosterId === proposerRosterId) return 'proposed'
  if (String(t.status ?? '').toLowerCase() !== 'pending') return 'accepted'
  return (t.acceptedRosterIds ?? []).includes(rosterId) ? 'accepted' : 'pending'
}

/** The proposing roster, as the route sends it; the viewer's own when they proposed it. */
function proposerRosterIdOf(t: PanelTrade): string | null {
  return t.proposerRosterId ?? (t.viewerIsProposer ? t.viewerRosterId ?? null : null)
}

function AssetToken({ asset, pickLabel }: { asset: PanelAsset; pickLabel: string }) {
  if (asset.pick) {
    return (
      <span className="af-tcp-token af-tcp-token--pick" title={asset.label}>
        <span className="af-tcp-token-face" aria-hidden>
          <b>{ordinal(asset.pick.round)}</b>
          {asset.pick.season ? <small>{asset.pick.season}</small> : null}
        </span>
        <span className="af-tcp-token-name">{pickLabel}</span>
      </span>
    )
  }
  return (
    <span className="af-tcp-token" title={asset.label}>
      {asset.headshotUrl ? (
        <img className="af-tcp-token-face" src={asset.headshotUrl} alt="" loading="lazy" width={36} height={36} />
      ) : (
        <span className="af-tcp-token-face" aria-hidden>{initials(asset.label)}</span>
      )}
      <span className="af-tcp-token-name">{asset.label}</span>
    </span>
  )
}

function providerAsset(a: ProviderAsset, i: number): PanelAsset {
  return {
    id: `${a.playerId ?? a.name}-${i}`,
    label: a.name,
    sublabel: [a.position, a.team].filter(Boolean).join(' · ') || null,
    headshotUrl: null,
    ...(a.isPick && a.pickRound != null ? { pick: { season: a.pickYear, round: a.pickRound, originalRosterId: null, fromRosterId: null } } : {}),
  }
}

function platformName(p: string | undefined | null): string {
  if (!p) return 'the platform'
  return p.charAt(0).toUpperCase() + p.slice(1)
}

export function TradeCenterPanel(props: {
  leagueId: string
  /** Hands a provider offer to the builder, as the inbox does. */
  onLoad: (give: PickedAsset[], get: PickedAsset[], note: string | null) => void
  /** Arms the builder to counter a native offer (TradeCenter `startCounter`). */
  onCounter: (input: { tradeId: string; give: PickedAsset[]; get: PickedAsset[]; partnerRosterId: string; label: string }) => void
  /** Bumped by the screen after a send lands, so this panel re-reads. */
  reloadToken?: number
  /** Called after an action here changes a trade, so the rest of the screen re-reads too. */
  onChanged?: () => void
  importedHistory?: readonly TradeRecord[]
  initialTab?: TradeCenterTab
}) {
  const m = useMessages(tradeCenterPanelMessages)
  const { leagueId, reloadToken = 0, onChanged, onLoad, onCounter } = props
  const [data, setData] = useState<PanelData | null>(null)
  const [state, setState] = useState<'loading' | 'idle' | 'failed'>('loading')
  const [tab, setTab] = useState<TradeCenterTab>(props.initialTab ?? 'active')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<{ tradeId: string; action: string } | null>(null)
  const [actionError, setActionError] = useState<{ tradeId: string; message: string } | null>(null)
  const [localReload, setLocalReload] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let live = true
    const force = reloadToken > 0 || localReload > 0
    setState((s) => (data ? s : 'loading'))
    // `Promise.resolve().then` so a stubbed fetch that returns nothing is a failed read, not a crash.
    Promise.resolve()
      .then(() => fetchTradesPanel(leagueId, force ? { force: true } : undefined))
      .then((r) => {
        if (!live) return
        if (!r?.ok) { setState('failed'); return }
        setData(r.data as PanelData)
        setState('idle')
      })
      .catch(() => { if (live) setState('failed') })
    return () => { live = false }
    // `data` is read only to keep a refresh from flashing the panel back to "loading".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, reloadToken, localReload])

  const native = useMemo(
    () => (data?.activeTrades ?? []).filter((t) => t.status !== 'pending_on_sleeper'),
    [data],
  )
  const activeCards: Card[] = useMemo(() => [
    ...native.filter((t) => !REVIEW_STATUSES.has(String(t.status ?? ''))).map((t) => ({ kind: 'native' as const, key: t.id, trade: t })),
    ...(data?.pendingOffers ?? []).map((o) => ({ kind: 'provider' as const, key: `p-${o.transactionId}`, offer: o })),
  ], [native, data])
  const reviewCards: Card[] = useMemo(
    () => native.filter((t) => REVIEW_STATUSES.has(String(t.status ?? ''))).map((t) => ({ kind: 'native' as const, key: t.id, trade: t })),
    [native],
  )
  const cards = tab === 'active' ? activeCards : tab === 'review' ? reviewCards : []
  const current = cards.find((c) => c.key === selected) ?? null

  const refresh = useCallback(() => {
    setLocalReload((n) => n + 1)
    onChanged?.()
  }, [onChanged])

  const post = useCallback(async (tradeId: string, action: 'accept' | 'reject' | 'cancel' | 'vote' | 'commissioner', body?: unknown) => {
    setBusy({ tradeId, action })
    setActionError(null)
    try {
      const r = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(tradeId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        // The engine's own refusal (deadline, lifecycle, veto window) is the message worth reading.
        setActionError({ tradeId, message: j.error || m.actionFailed })
        return
      }
      refresh()
    } catch {
      setActionError({ tradeId, message: m.actionFailed })
    } finally {
      setBusy(null)
    }
  }, [leagueId, refresh, m.actionFailed])

  const counter = useCallback(async (t: PanelTrade) => {
    setBusy({ tradeId: t.id, action: 'counter' })
    setActionError(null)
    try {
      const r = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(t.id)}`, { cache: 'no-store' })
      const j = (await r.json().catch(() => ({}))) as { trade?: { items?: NativeTradeItem[]; receiverRosterId?: string; proposerRosterId?: string } }
      const trade = j.trade
      if (!r.ok || !trade?.items || !trade.receiverRosterId || !trade.proposerRosterId) {
        setActionError({ tradeId: t.id, message: m.counterFailed })
        return
      }
      const { give, get } = nativeItemsToAssets(trade.items, trade.receiverRosterId)
      onCounter({ tradeId: t.id, give, get, partnerRosterId: trade.proposerRosterId, label: t.partnerName || m.detailTitle })
    } catch {
      setActionError({ tradeId: t.id, message: m.counterFailed })
    } finally {
      setBusy(null)
    }
  }, [leagueId, onCounter, m.counterFailed, m.detailTitle])

  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return null
    const t = Date.parse(iso)
    return Number.isFinite(t) ? new Intl.DateTimeFormat(getAppIntlLocale(), { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(t)) : null
  }
  const relative = (iso: string | null | undefined) => {
    if (!iso) return null
    const t = Date.parse(iso)
    if (!Number.isFinite(t)) return null
    const days = Math.floor((now - t) / 86_400_000)
    const rtf = new Intl.RelativeTimeFormat(getAppIntlLocale(), { numeric: 'auto' })
    return days <= 0 ? rtf.format(-Math.max(0, Math.floor((now - t) / 3_600_000)), 'hour') : rtf.format(-days, 'day')
  }

  const statusText = (t: PanelTrade) => ({
    incoming: m.statusIncoming,
    sent: m.statusSent,
    open: m.statusOpen,
    votes: m.statusVotes,
    commissioner: m.statusCommissioner,
    processing: m.statusProcessing,
  })[cardStatus(t)]

  const participants = (t: PanelTrade) => {
    const sides = t.participantSides ?? []
    if (sides.length === 0) return [t.partnerName].filter(Boolean).join(', ')
    return sides.map((s) => (s.isViewer ? m.you : s.name)).join(', ')
  }

  const tabButton = (key: TradeCenterTab, label: string, count: number | null) => (
    <button
      key={key}
      type="button"
      role="tab"
      id={`tcp-tab-${key}`}
      aria-selected={tab === key}
      aria-controls="tcp-tabpanel"
      className="af-tcp-tab"
      data-on={tab === key}
      onClick={() => { setTab(key); setSelected(null); setActionError(null) }}
    >
      {label}
      {count != null && count > 0 ? <span className="af-tcp-count af-num">{count}</span> : null}
    </button>
  )

  const renderCard = (c: Card) => {
    if (c.kind === 'provider') {
      const o = c.offer
      const status = o.direction === 'incoming' ? m.statusIncoming : m.statusSent
      return (
        <button key={c.key} type="button" className="af-tcp-card" data-on={selected === c.key} data-status={o.direction === 'incoming' ? 'incoming' : 'sent'} onClick={() => setSelected(c.key)}>
          <span className="af-tcp-card-top">
            <span className="af-tcp-chip"><span aria-hidden>{o.direction === 'incoming' ? '↓' : '↑'}</span> {status} · {m.statusOnPlatform(platformName(o.provider))}</span>
            {relative(o.proposedAt) ? <span className="af-tcp-when">{relative(o.proposedAt)}</span> : null}
          </span>
          <span className="af-tcp-card-who">{m.you}, {o.partnerName}</span>
          <span className="af-tcp-card-sub">{m.nWayTrade(2)}</span>
          <span className="af-tcp-assets">
            <span className="af-tcp-side">{o.give.map((a, i) => <AssetToken key={i} asset={providerAsset(a, i)} pickLabel={m.pick} />)}</span>
            <span className="af-tcp-swap" aria-label={m.swap}>⇄</span>
            <span className="af-tcp-side">{o.get.map((a, i) => <AssetToken key={i} asset={providerAsset(a, i)} pickLabel={m.pick} />)}</span>
          </span>
        </button>
      )
    }
    const t = c.trade
    const st = cardStatus(t)
    const left = String(t.status ?? '') === 'pending' ? timeLeft(t.expiresAt, now) : null
    const sides = t.participantSides ?? []
    return (
      <button key={c.key} type="button" className="af-tcp-card" data-on={selected === c.key} data-status={st} onClick={() => setSelected(c.key)}>
        <span className="af-tcp-card-top">
          <span className="af-tcp-chip">
            <span aria-hidden>{st === 'incoming' ? '↓' : st === 'sent' ? '↑' : st === 'votes' ? '⚖' : st === 'commissioner' ? '★' : st === 'processing' ? '✓' : '•'}</span> {statusText(t)}
          </span>
          {left ? <span className="af-tcp-when"><span aria-hidden>⏱ </span>{m.endsIn(left)}</span> : relative(t.timestamp) ? <span className="af-tcp-when">{relative(t.timestamp)}</span> : null}
        </span>
        <span className="af-tcp-card-who">{participants(t)}</span>
        <span className="af-tcp-card-sub">{m.nWayTrade(Math.max(2, sides.length))}</span>
        <span className="af-tcp-assets">
          {(sides.length > 0 ? sides : [{ rosterId: 'a', assets: t.sent }, { rosterId: 'b', assets: t.received }]).map((s, i) => (
            <span key={s.rosterId} className="af-tcp-sidewrap">
              {i > 0 ? <span className="af-tcp-swap" aria-label={m.swap}>⇄</span> : null}
              <span className="af-tcp-side">{(s.assets as PanelAsset[]).map((a) => <AssetToken key={a.id} asset={a} pickLabel={m.pick} />)}</span>
            </span>
          ))}
        </span>
        {st === 'votes' && t.votes ? (
          <span className="af-tcp-card-sub">{m.vetoMeter(t.votes.veto, t.votes.needed)}</span>
        ) : null}
      </button>
    )
  }

  const assetLine = (a: PanelAsset) => (
    <li key={a.id} className="af-tcp-line">
      <AssetToken asset={a} pickLabel={m.pick} />
      <span className="af-tcp-line-text">
        <b>{a.label}</b>
        {a.sublabel ? <small>{a.sublabel}</small> : null}
      </span>
    </li>
  )

  const renderDetail = (c: Card) => {
    if (c.kind === 'provider') {
      const o = c.offer
      const platform = platformName(o.provider ?? data?.pending?.platform)
      return (
        <div className="af-tcp-detail-body">
          <p className="af-tcp-note" role="note">{m.readOnlyPlatform(platform)}</p>
          <section className="af-tcp-team">
            <header><b>{m.you}</b></header>
            <div className="af-tcp-cols">
              <div><span className="af-label">{m.receives}</span><ul>{o.get.length ? o.get.map((a, i) => assetLine(providerAsset(a, i))) : <li className="af-tcp-none">{m.nothing}</li>}</ul></div>
              <div><span className="af-label">{m.sends}</span><ul>{o.give.length ? o.give.map((a, i) => assetLine(providerAsset(a, i))) : <li className="af-tcp-none">{m.nothing}</li>}</ul></div>
            </div>
          </section>
          <div className="af-tcp-actions">
            <button type="button" className="af-btn af-btn--ghost" onClick={() => {
              const g = toPickedAssets(o.give, o.provider)
              const k = toPickedAssets(o.get, o.provider)
              onLoad(g.picked, k.picked, null)
            }}>{m.loadIntoBuilder}</button>
            {data?.pending?.leagueUrl ? (
              <a className="af-btn af-btn--ghost" href={data.pending.leagueUrl} target="_blank" rel="noreferrer noopener">{m.actOnPlatform(platform)}</a>
            ) : null}
          </div>
        </div>
      )
    }
    const t = c.trade
    const st = cardStatus(t)
    const sides = t.participantSides ?? []
    const proposerId = proposerRosterIdOf(t)
    const nameOf = (rosterId: string) => {
      const s = sides.find((x) => x.rosterId === rosterId)
      return s ? (s.isViewer ? m.you : s.name) : ''
    }
    const left = String(t.status ?? '') === 'pending' ? timeLeft(t.expiresAt, now) : null
    const when = fmtDate(t.timestamp)
    const heading = when ? (t.direction === 'incoming' ? m.receivedOn(when) : t.direction === 'outgoing' ? m.sentOn(when) : m.proposedOn(when)) : null
    const isBusy = busy?.tradeId === t.id
    const err = actionError?.tradeId === t.id ? actionError.message : null
    const pending = String(t.status ?? '') === 'pending'
    const grade = t.leagueGrade && t.leagueGradeSide !== 'proposer' && t.leagueGrade.graded ? t.leagueGrade : null

    /*
     * Who receives what from whom: an asset in side X's `assets` left X; the side whose `received` holds the
     * same asset id is where it went. A two-team trade needs no lookup, but a three-team one does.
     */
    const destinationOf = (assetId: string) => sides.find((s) => (s.received ?? []).some((a) => a.id === assetId))?.rosterId ?? null
    const originOf = (assetId: string) => sides.find((s) => (s.assets ?? []).some((a) => a.id === assetId))?.rosterId ?? null

    return (
      <div className="af-tcp-detail-body">
        <p className="af-tcp-detail-meta">
          {heading}
          {left ? <> · <span aria-hidden>⏱ </span>{m.endsIn(left)}</> : null}
        </p>
        {grade ? <p className="af-tcp-grade" data-letter={grade.letter}>{m.gradeLine(grade.letter, grade.getValue.toLocaleString(getAppIntlLocale()), grade.giveValue.toLocaleString(getAppIntlLocale()))}</p> : null}
        {sides.map((s) => {
          const standing = teamStanding(t, s.rosterId, proposerId)
          return (
            <section key={s.rosterId} className="af-tcp-team" data-viewer={s.isViewer || undefined}>
              <header>
                {s.avatarUrl ? <img src={s.avatarUrl} alt="" width={28} height={28} /> : <span className="af-tcp-avatar" aria-hidden>{initials(s.name)}</span>}
                <b>{s.isViewer ? m.you : s.name}</b>
                <span className="af-tcp-standing" data-standing={standing}>
                  <span aria-hidden>{standing === 'accepted' ? '✓ ' : standing === 'proposed' ? '• ' : '⏱ '}</span>
                  {standing === 'accepted' ? m.teamAccepted : standing === 'proposed' ? m.teamProposed : m.teamPending}
                </span>
              </header>
              <div className="af-tcp-cols">
                <div>
                  <span className="af-label">{m.receives}</span>
                  <ul>
                    {(s.received ?? []).length ? (s.received as PanelAsset[]).map((a) => (
                      <li key={a.id} className="af-tcp-line">
                        <AssetToken asset={a} pickLabel={m.pick} />
                        <span className="af-tcp-line-text"><b>{a.label}</b>{a.idol ? <span className="af-tcp-idol">{m.idolRidesAlong}</span> : null}<small>{originOf(a.id) ? m.fromTeam(nameOf(originOf(a.id)!)) : a.sublabel}</small></span>
                      </li>
                    )) : <li className="af-tcp-none">{m.nothing}</li>}
                  </ul>
                </div>
                <div>
                  <span className="af-label">{m.sends}</span>
                  <ul>
                    {(s.assets ?? []).length ? (s.assets as PanelAsset[]).map((a) => (
                      <li key={a.id} className="af-tcp-line">
                        <AssetToken asset={a} pickLabel={m.pick} />
                        <span className="af-tcp-line-text"><b>{a.label}</b>{a.idol ? <span className="af-tcp-idol">{m.idolRidesAlong}</span> : null}<small>{destinationOf(a.id) ? m.toTeam(nameOf(destinationOf(a.id)!)) : a.sublabel}</small></span>
                      </li>
                    )) : <li className="af-tcp-none">{m.nothing}</li>}
                  </ul>
                </div>
              </div>
            </section>
          )
        })}

        {st === 'votes' && t.votes ? (
          <div className="af-tcp-vote">
            <div className="af-tcp-meter" role="img" aria-label={m.vetoMeter(t.votes.veto, t.votes.needed)}>
              <span style={{ width: `${Math.min(100, (t.votes.veto / Math.max(1, t.votes.needed)) * 100)}%` }} />
            </div>
            <p>{m.vetoMeter(t.votes.veto, t.votes.needed)} · {m.approveVotes(t.votes.allow)}</p>
            {t.votes.viewerVote ? <p className="af-tcp-note">{m.yourVote(t.votes.viewerVote === 'veto' ? m.voteVeto : m.voteAllow)}</p> : null}
            {!t.viewerCanVote && t.viewerIsParticipant ? <p className="af-tcp-note">{m.partyCannotVote}</p> : null}
          </div>
        ) : null}
        {st === 'commissioner' && !t.viewerIsCommissioner ? <p className="af-tcp-note">{m.commissionerDecides}</p> : null}

        {err ? <p className="af-tcp-error" role="alert">{err}</p> : null}

        <div className="af-tcp-actions">
          {pending && t.viewerIsReceiver ? (
            <>
              <button type="button" className="af-btn af-btn--ghost" disabled={isBusy} onClick={() => void post(t.id, 'reject')}>{isBusy && busy?.action === 'reject' ? m.working : m.decline}</button>
              <button type="button" className="af-btn af-btn--ghost" disabled={isBusy} onClick={() => void counter(t)}>{isBusy && busy?.action === 'counter' ? m.working : m.counter}</button>
              <button type="button" className="af-btn" disabled={isBusy} onClick={() => void post(t.id, 'accept')}>{isBusy && busy?.action === 'accept' ? m.working : m.accept}</button>
            </>
          ) : null}
          {pending && t.viewerIsProposer ? (
            <button type="button" className="af-btn af-btn--ghost" disabled={isBusy} onClick={() => void post(t.id, 'cancel')}>{isBusy && busy?.action === 'cancel' ? m.working : m.cancelOffer}</button>
          ) : null}
          {st === 'votes' && t.viewerCanVote && t.viewerRosterId ? (
            <>
              <button type="button" className="af-btn af-btn--ghost" disabled={isBusy} aria-pressed={t.votes?.viewerVote === 'veto'} onClick={() => void post(t.id, 'vote', { voterRosterId: t.viewerRosterId, vote: 'veto' })}>{isBusy && busy?.action === 'vote' ? m.working : m.veto}</button>
              <button type="button" className="af-btn" disabled={isBusy} aria-pressed={t.votes?.viewerVote === 'allow'} onClick={() => void post(t.id, 'vote', { voterRosterId: t.viewerRosterId, vote: 'allow' })}>{isBusy && busy?.action === 'vote' ? m.working : m.approve}</button>
            </>
          ) : null}
          {st === 'commissioner' && t.viewerIsCommissioner ? (
            <>
              <button type="button" className="af-btn af-btn--ghost" disabled={isBusy} onClick={() => void post(t.id, 'commissioner', { decision: 'reject' })}>{isBusy && busy?.action === 'commissioner' ? m.working : m.veto}</button>
              <button type="button" className="af-btn" disabled={isBusy} onClick={() => void post(t.id, 'commissioner', { decision: 'approve' })}>{isBusy && busy?.action === 'commissioner' ? m.working : m.approve}</button>
            </>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <section className="af-tcp" aria-labelledby="tcp-title">
      <header className="af-tcp-head">
        <h2 id="tcp-title">{m.title}</h2>
        <div role="tablist" aria-label={m.tabsLabel} className="af-tcp-tabs">
          {tabButton('active', m.tabActive, activeCards.length)}
          {tabButton('review', m.tabReview, reviewCards.length)}
          {tabButton('history', m.tabHistory, null)}
        </div>
      </header>

      <div id="tcp-tabpanel" role="tabpanel" aria-labelledby={`tcp-tab-${tab}`}>
        {tab === 'history' ? (
          <TradeInbox
            view="timeline"
            historyMode
            leagueId={leagueId}
            onLoad={onLoad}
            onCounter={onCounter}
            reloadToken={reloadToken + localReload}
            importedHistory={props.importedHistory}
          />
        ) : state === 'loading' && !data ? (
          <p className="af-tc-row-sub">{m.loading}</p>
        ) : state === 'failed' && !data ? (
          <p className="af-tc-row-sub">{m.failed}</p>
        ) : cards.length === 0 ? (
          <p className="af-tcp-empty">{tab === 'active' ? m.emptyActive : m.emptyReview}</p>
        ) : (
          <div className="af-tcp-split" data-detail={current ? 'open' : 'closed'}>
            <div className="af-tcp-list">{cards.map(renderCard)}</div>
            <div className="af-tcp-detail" aria-live="polite">
              {current ? (
                <>
                  <header className="af-tcp-detail-head">
                    <h3>{m.detailTitle}</h3>
                    <button type="button" className="af-tcp-close" aria-label={m.closeDetail} onClick={() => setSelected(null)}>×</button>
                  </header>
                  {renderDetail(current)}
                </>
              ) : (
                <p className="af-tcp-hint">{m.selectHint}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
