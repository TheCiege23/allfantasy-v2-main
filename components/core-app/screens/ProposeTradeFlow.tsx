'use client'

/**
 * The guided "Propose trade" flow on the league Trade Center — the owner's ask, in AllFantasy's look,
 * after the propose screen Sleeper shows on desktop:
 *
 *   1. Choose trade partners — every team's roster as a column of position-tinted player cards, the
 *      viewer pinned first; a team's column header adds or removes it as a partner (2-way or more).
 *   2. Add trade assets — the viewer and the chosen partners only; each player, pick and FAAB amount
 *      is a toggle, a 3+ team trade names who receives each asset, and a per-team RECEIVES / SENDS
 *      summary follows every change.
 *   3. Review & send — the summary read-only, an optional message and an expiry, then the same POST
 *      `/api/leagues/<id>/trades` the builder's TradeProposePanel sends (the engine reads a multi-team
 *      trade's participants off the assets).
 *
 * Phones (PHONE_QUERY, the breakpoint every /core trade surface uses) show one roster at a time behind a
 * team strip, and the summary as a sheet. Tablets keep every column, narrower; CSS alone does that.
 *
 * Trade-block tags and interest hearts are the league's own native data (`/api/redraft/trades/
 * trade-block`, `/api/redraft/trades/interests`), matched by player id. A league without that data
 * simply shows neither — nothing here is invented.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { LeagueRoster, RosterPick, RosterPlayer } from '@/components/core-app/screens/useLeagueRosters'
import { usePhoneViewport } from '@/components/core-app/screens/TradeAssetSheet'
import { useMessages } from '@/components/i18n/useMessages'
import { proposeTradeFlowMessages } from '@/lib/core-app/messages/proposeTradeFlow'
import '@/components/core-app/af-propose-trade.css'

// ---------------------------------------------------------------------------
// Pure rules (exported for tests)
// ---------------------------------------------------------------------------

export type FlowAsset = {
  key: string
  kind: 'player' | 'pick' | 'faab'
  fromRosterId: string
  toRosterId: string
  /** Player id or pick id; absent for FAAB. */
  ref: string | null
  itemType?: 'rookie_pick' | 'future_pick'
  label: string
  amount?: number
  value: number | null
}

export const EXPIRY_HOURS = [24, 48, 72, 168] as const

/** Position → tint key, the same buckets the builder's position labels use. */
const POSITION_TINT: Record<string, string> = {
  QB: 'qb', RB: 'rb', WR: 'wr', TE: 'te', K: 'k', DEF: 'def', DST: 'def',
  DL: 'dl', DE: 'dl', DT: 'dl', NT: 'dl', LB: 'lb', DB: 'db', CB: 'db', S: 'db', SS: 'db', FS: 'db',
}
export function positionTint(position: string | null | undefined): string {
  return POSITION_TINT[(position ?? '').toUpperCase()] ?? 'other'
}

/** "Jared Goff" → "J. Goff"; a one-word name stays whole. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name.trim()
  return `${parts[0]!.charAt(0)}. ${parts.slice(1).join(' ')}`
}

/**
 * Who receives an asset by default. Two teams: the other side. More: the viewer's assets go to the
 * first partner and a partner's assets come to the viewer — the manager can change either.
 */
export function defaultRecipient(fromRosterId: string, viewerRosterId: string, partners: readonly string[]): string {
  if (fromRosterId === viewerRosterId) return partners[0] ?? viewerRosterId
  return viewerRosterId
}

/** Each team's RECEIVES and SENDS, in team order. */
export function summarize(teamIds: readonly string[], assets: readonly FlowAsset[]) {
  return teamIds.map((rosterId) => ({
    rosterId,
    receives: assets.filter((a) => a.toRosterId === rosterId),
    sends: assets.filter((a) => a.fromRosterId === rosterId),
  }))
}

/** Teams chosen as partners that neither send nor receive anything yet. */
export function partnersNotInDeal(partners: readonly string[], assets: readonly FlowAsset[]): string[] {
  return partners.filter((id) => !assets.some((a) => a.fromRosterId === id || a.toRosterId === id))
}

/** The body POST /api/leagues/<id>/trades takes — the contract TradeProposePanel sends. */
export function buildProposalBody(args: {
  viewerRosterId: string
  partners: readonly string[]
  assets: readonly FlowAsset[]
  message: string
  expiresInHours: number
}) {
  return {
    proposerRosterId: args.viewerRosterId,
    receiverRosterId: args.partners[0]!,
    assets: args.assets.map((a) =>
      a.kind === 'faab'
        ? { itemType: 'faab' as const, fromRosterId: a.fromRosterId, toRosterId: a.toRosterId, faabAmount: a.amount ?? 0 }
        : {
            itemType: a.kind === 'player' ? ('player' as const) : (a.itemType ?? 'rookie_pick'),
            itemReference: a.ref,
            fromRosterId: a.fromRosterId,
            toRosterId: a.toRosterId,
          },
    ),
    expiresInHours: args.expiresInHours,
    ...(args.message.trim() ? { metadata: { offerMessage: args.message.trim() } } : {}),
  }
}

// ---------------------------------------------------------------------------
// Native trade block + interests (fail-soft: no data, no tags)
// ---------------------------------------------------------------------------

type Signals = { block: Set<string>; interests: Map<string, string> }

function useTradeSignals(leagueId: string, enabled: boolean): [Signals, (playerId: string, playerName: string, position: string | null, rosterId: string) => void] {
  const [signals, setSignals] = useState<Signals>({ block: new Set(), interests: new Map() })
  useEffect(() => {
    if (!enabled) return
    let live = true
    const q = encodeURIComponent(leagueId)
    void Promise.all([
      fetch(`/api/redraft/trades/trade-block?leagueId=${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/redraft/trades/interests?leagueId=${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([block, interests]) => {
      if (!live) return
      const blockIds = new Set<string>(
        (Array.isArray(block?.items) ? block.items : []).map((i: { playerId?: string }) => String(i.playerId ?? '')).filter(Boolean),
      )
      const mine = new Map<string, string>()
      for (const i of Array.isArray(interests?.interests) ? interests.interests : []) {
        if (i?.playerId && i?.id) mine.set(String(i.playerId), String(i.id))
      }
      setSignals({ block: blockIds, interests: mine })
    })
    return () => { live = false }
  }, [leagueId, enabled])

  const toggle = useCallback((playerId: string, playerName: string, position: string | null, rosterId: string) => {
    const existing = signals.interests.get(playerId)
    // Optimistic; a refusal puts it back.
    setSignals((s) => {
      const next = new Map(s.interests)
      if (existing) next.delete(playerId)
      else next.set(playerId, 'pending')
      return { ...s, interests: next }
    })
    const request = existing && existing !== 'pending'
      ? fetch(`/api/redraft/trades/interests/${encodeURIComponent(existing)}`, { method: 'DELETE' })
      : fetch('/api/redraft/trades/interests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leagueId, targetRosterId: rosterId, playerId, playerName, position, interestType: 'player_interest' }),
        })
    void request
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error('refused')
        setSignals((s) => {
          const next = new Map(s.interests)
          if (existing) next.delete(playerId)
          else if (j?.interest?.id) next.set(playerId, String(j.interest.id))
          return { ...s, interests: next }
        })
      })
      .catch(() => {
        setSignals((s) => {
          const next = new Map(s.interests)
          if (existing) next.set(playerId, existing)
          else next.delete(playerId)
          return { ...s, interests: next }
        })
      })
  }, [leagueId, signals.interests])

  return [signals, toggle]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The Trade Center's way in. Without an AllFantasy roster in this league (an imported league the
 * viewer only follows) there is nothing to propose from, and the bar says so instead of opening.
 */
export function ProposeTradeLaunch(props: {
  rosterData: { rosters: readonly LeagueRoster[]; viewerRosterId: string | null } | null
  onOpen: () => void
}) {
  const m = useMessages(proposeTradeFlowMessages)
  const noRoster = Boolean(props.rosterData && !props.rosterData.viewerRosterId)
  const ready = Boolean(props.rosterData?.viewerRosterId) && (props.rosterData?.rosters.length ?? 0) >= 2
  return (
    <div className="af-ptf-launch" data-testid="propose-trade-launch">
      <div>
        <b>{m.open}</b>
        <span>{noRoster ? m.noRoster : props.rosterData ? m.openHint : m.loading}</span>
      </div>
      <button type="button" className="af-ptf-launch-btn" disabled={!ready} onClick={props.onOpen}>{m.open}</button>
    </div>
  )
}

export function ProposeTradeFlow(props: {
  leagueId: string
  rosters: readonly LeagueRoster[]
  viewerRosterId: string
  onClose: () => void
  /** After a confirmed send, so the Trade Center re-reads its panel. */
  onSent?: () => void
  /** Read the league's native trade block and interests (off in tests that don't stub them). */
  signals?: boolean
}) {
  const m = useMessages(proposeTradeFlowMessages)
  const { leagueId, viewerRosterId, onClose, onSent } = props
  const isPhone = usePhoneViewport()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [partners, setPartners] = useState<string[]>([])
  const [assets, setAssets] = useState<FlowAsset[]>([])
  const [faab, setFaab] = useState<Record<string, string>>({})
  const [blockOnly, setBlockOnly] = useState(false)
  const [phoneTeam, setPhoneTeam] = useState<string>(viewerRosterId)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [expiry, setExpiry] = useState<number>(48)
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null)
  const [signals, toggleInterest] = useTradeSignals(leagueId, props.signals !== false)

  const ordered = useMemo(() => {
    const mine = props.rosters.find((r) => r.rosterId === viewerRosterId)
    return [...(mine ? [mine] : []), ...props.rosters.filter((r) => r.rosterId !== viewerRosterId)]
  }, [props.rosters, viewerRosterId])
  const byId = useMemo(() => new Map(ordered.map((r) => [r.rosterId, r])), [ordered])
  const nameOf = useCallback(
    (id: string) => (id === viewerRosterId ? m.you : byId.get(id)?.ownerName ?? m.partner),
    [byId, viewerRosterId, m],
  )
  const dealTeams = useMemo(() => [viewerRosterId, ...partners], [viewerRosterId, partners])
  const hasBlock = signals.block.size > 0

  // Esc closes; Tab stays inside the dialog; the page behind does not scroll.
  useEffect(() => {
    const root = dialogRef.current
    root?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key !== 'Tab' || !root) return
      const f = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])')]
      if (f.length === 0) return
      const first = f[0]!, last = f[f.length - 1]!
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  // Moving between steps puts focus back on the step's heading.
  useEffect(() => { dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus() }, [step])

  const togglePartner = (rosterId: string) => {
    if (rosterId === viewerRosterId) return
    const r = byId.get(rosterId)
    if (!r?.canReceiveProposal) return
    setPartners((p) => (p.includes(rosterId) ? p.filter((x) => x !== rosterId) : [...p, rosterId]))
    // A team leaving the deal takes its assets, and anything headed to it, with it.
    setAssets((list) => list.filter((a) => a.fromRosterId !== rosterId && a.toRosterId !== rosterId))
  }

  const toggleAsset = (asset: Omit<FlowAsset, 'toRosterId'>) => {
    setAssets((list) => (list.some((a) => a.key === asset.key)
      ? list.filter((a) => a.key !== asset.key)
      : [...list, { ...asset, toRosterId: defaultRecipient(asset.fromRosterId, viewerRosterId, partners) }]))
  }
  const setRecipient = (key: string, to: string) => setAssets((list) => list.map((a) => (a.key === key ? { ...a, toRosterId: to } : a)))
  const setFaabAmount = (rosterId: string, raw: string, cap: number) => {
    setFaab((f) => ({ ...f, [rosterId]: raw }))
    const n = Math.floor(Number(raw))
    const key = `${rosterId}:faab`
    setAssets((list) => {
      const rest = list.filter((a) => a.key !== key)
      if (!Number.isFinite(n) || n <= 0) return rest
      const amount = Math.min(n, cap)
      const prev = list.find((a) => a.key === key)
      return [...rest, { key, kind: 'faab', fromRosterId: rosterId, toRosterId: prev?.toRosterId ?? defaultRecipient(rosterId, viewerRosterId, partners), ref: null, label: `$${amount} FAAB`, amount, value: null }]
    })
  }

  const loose = partnersNotInDeal(partners, assets)
  const canNext2 = assets.length > 0 && loose.length === 0

  const send = async () => {
    setSending(true); setOutcome(null)
    try {
      const r = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildProposalBody({ viewerRosterId, partners, assets, message, expiresInHours: expiry })),
      })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!r.ok || !j.ok) { setOutcome({ ok: false, text: j.error ?? m.refused }); return }
      setOutcome({ ok: true, text: m.sent })
      onSent?.()
      onClose()
    } catch {
      setOutcome({ ok: false, text: m.unreachable })
    } finally {
      setSending(false)
    }
  }

  const visibleTeams = (step === 1 ? ordered : ordered.filter((r) => dealTeams.includes(r.rosterId)))
  // A phone shows one roster at a time; the strip above picks which.
  const phoneRoster = visibleTeams.find((r) => r.rosterId === phoneTeam) ?? visibleTeams[0]
  const shownTeams = isPhone ? (phoneRoster ? [phoneRoster] : []) : visibleTeams

  const title = step === 1 ? m.step1Title : step === 2 ? m.step2Title : m.step3Title
  const hint = step === 1 ? m.step1Hint : step === 2 ? m.step2Hint : m.step3Hint
  const tradeLabel = `${m.nWay(dealTeams.length)}: ${dealTeams.map(nameOf).join(', ')}`

  const summary = (
    <TradeSummary
      teams={dealTeams} assets={assets} nameOf={nameOf} m={m}
      editable={step === 2 && partners.length > 1} onRecipient={setRecipient}
    />
  )

  return (
    <div className="af-ptf-backdrop">
      <div ref={dialogRef} className="af-ptf" role="dialog" aria-modal="true" aria-labelledby={titleId} data-step={step}>
        <header className="af-ptf-head">
          <div>
            <span className="af-ptf-step">{m.stepOf(step, 3)}</span>
            <h2 id={titleId} tabIndex={-1} data-autofocus>{title}</h2>
            <p>{hint}</p>
          </div>
          <div className="af-ptf-head-actions">
            {step === 1 && hasBlock ? (
              <label className="af-ptf-check">
                <input type="checkbox" checked={blockOnly} onChange={(e) => setBlockOnly(e.target.checked)} />
                <span>{m.tradeBlockOnly}</span>
              </label>
            ) : null}
            <button type="button" className="af-ptf-x" onClick={onClose} aria-label={m.close}>×</button>
          </div>
        </header>

        {isPhone && step < 3 ? (
          <div className="af-ptf-strip" role="tablist" aria-label={m.teamsLabel}>
            {visibleTeams.map((r) => {
              const on = r.rosterId === (shownTeams[0]?.rosterId ?? '')
              const inDeal = dealTeams.includes(r.rosterId)
              return (
                <button key={r.rosterId} type="button" role="tab" aria-selected={on} className="af-ptf-chip"
                  data-on={on ? 'true' : undefined} data-deal={inDeal ? 'true' : undefined}
                  onClick={() => setPhoneTeam(r.rosterId)}>
                  <Avatar url={r.avatarUrl} name={nameOf(r.rosterId)} />
                  <span>{nameOf(r.rosterId)}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        <div className="af-ptf-body">
          {step < 3 ? (
            <div className="af-ptf-grid" data-cols={shownTeams.length}>
              {shownTeams.map((r) => (
                <TeamColumn
                  key={r.rosterId} roster={r} step={step} m={m}
                  isViewer={r.rosterId === viewerRosterId}
                  name={nameOf(r.rosterId)}
                  selected={partners.includes(r.rosterId)}
                  onToggle={() => togglePartner(r.rosterId)}
                  isPhone={isPhone}
                  block={signals.block} interests={signals.interests}
                  onInterest={(p) => toggleInterest(p.id, p.name, p.position, r.rosterId)}
                  blockOnly={blockOnly && step === 1}
                  assets={assets} onAsset={toggleAsset}
                  faab={faab[r.rosterId] ?? ''} onFaab={(v) => setFaabAmount(r.rosterId, v, r.faabRemaining ?? 0)}
                />
              ))}
            </div>
          ) : (
            <div className="af-ptf-review">
              {summary}
              <ValueLine assets={assets} viewerRosterId={viewerRosterId} m={m} />
              <label className="af-ptf-field">
                <span>{m.message}</span>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={m.messagePlaceholder} rows={3} maxLength={500} />
              </label>
              <label className="af-ptf-field af-ptf-field--inline">
                <span>{m.expiry}</span>
                <select value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
                  {EXPIRY_HOURS.map((h) => <option key={h} value={h}>{m.hours(h)}</option>)}
                </select>
              </label>
            </div>
          )}

          {step === 2 && !isPhone ? <aside className="af-ptf-aside" aria-label={m.summary}>{summary}</aside> : null}
        </div>

        {step === 2 && isPhone ? (
          <div className="af-ptf-sheet" data-open={summaryOpen ? 'true' : undefined}>
            <button type="button" className="af-ptf-sheet-handle" aria-expanded={summaryOpen} onClick={() => setSummaryOpen((o) => !o)}>
              {summaryOpen ? m.hideSummary : m.showSummary} · {assets.length}
            </button>
            {summaryOpen ? summary : null}
          </div>
        ) : null}

        <footer className="af-ptf-foot">
          <div className="af-ptf-foot-info" aria-live="polite">
            <b>{partners.length > 0 ? tradeLabel : m.choosePartner}</b>
            {step === 2 && loose.length > 0 ? <span className="af-ptf-warn">{m.notInDeal(nameOf(loose[0]!))}</span> : null}
            {step === 2 && loose.length === 0 && assets.length === 0 ? <span>{m.pickAssets}</span> : null}
            {outcome ? <span role={outcome.ok ? 'status' : 'alert'} className={outcome.ok ? undefined : 'af-ptf-warn'}>{outcome.text}</span> : null}
          </div>
          <div className="af-ptf-foot-actions">
            {step > 1 ? <button type="button" className="af-ptf-btn" onClick={() => setStep((s) => (s === 3 ? 2 : 1))}>{m.back}</button> : null}
            {step === 1 ? <button type="button" className="af-ptf-btn af-ptf-btn--go" disabled={partners.length === 0} onClick={() => setStep(2)}>{m.next}</button> : null}
            {step === 2 ? <button type="button" className="af-ptf-btn af-ptf-btn--go" disabled={!canNext2} onClick={() => setStep(3)}>{m.next}</button> : null}
            {step === 3 ? <button type="button" className="af-ptf-btn af-ptf-btn--go" disabled={sending || !canNext2} onClick={() => void send()}>{sending ? m.sending : m.send}</button> : null}
          </div>
        </footer>
      </div>
    </div>
  )
}

type M = (typeof proposeTradeFlowMessages)['en']

function Avatar({ url, name }: { url: string | null; name: string }) {
  const initials = name.split(/\s+/).map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase()
  return url
    ? <img className="af-ptf-avatar" src={url} alt="" />
    : <span className="af-ptf-avatar" aria-hidden>{initials}</span>
}

function TeamColumn(props: {
  roster: LeagueRoster
  step: 1 | 2 | 3
  m: M
  isViewer: boolean
  name: string
  selected: boolean
  onToggle: () => void
  isPhone: boolean
  block: Set<string>
  interests: Map<string, string>
  onInterest: (p: RosterPlayer) => void
  blockOnly: boolean
  assets: readonly FlowAsset[]
  onAsset: (a: Omit<FlowAsset, 'toRosterId'>) => void
  faab: string
  onFaab: (v: string) => void
}) {
  const { roster: r, m, step } = props
  const players = props.blockOnly ? r.players.filter((p) => props.block.has(p.id)) : r.players
  const picked = (key: string) => props.assets.some((a) => a.key === key)
  const head = (
    <span className="af-ptf-col-name">
      <Avatar url={r.avatarUrl} name={props.name} />
      <span>{props.name}</span>
      {props.isViewer ? <em>{m.yourTeam}</em> : !r.canReceiveProposal ? <em>{m.cantReceive}</em> : null}
    </span>
  )
  return (
    <section className="af-ptf-col" data-viewer={props.isViewer ? 'true' : undefined} data-selected={props.selected ? 'true' : undefined}>
      {step === 1 && !props.isViewer ? (
        <button type="button" className="af-ptf-col-head" aria-pressed={props.selected} disabled={!r.canReceiveProposal}
          aria-label={props.selected ? m.removePartner(props.name) : m.addPartner(props.name)} onClick={props.onToggle}>
          {head}
          {props.isPhone ? <span className="af-ptf-col-cta">{props.selected ? '✓ ' + m.partner : '+ ' + m.partner}</span> : null}
        </button>
      ) : (
        <div className="af-ptf-col-head" data-static="true">{head}</div>
      )}

      <ul className="af-ptf-cards">
        {players.length === 0 ? <li className="af-ptf-empty">{m.noPlayers}</li> : null}
        {players.map((p) => {
          const key = `${r.rosterId}:player:${p.id}`
          const eyebrow = [p.position, p.team].filter(Boolean).join(' · ') + (p.byeWeek ? ` (${m.byeWeek(p.byeWeek)})` : '')
          const onBlock = props.block.has(p.id)
          const liked = props.interests.has(p.id)
          const body = (
            <>
              <span className="af-ptf-card-eyebrow">{eyebrow}</span>
              <span className="af-ptf-card-name">{shortName(p.name)}</span>
              {onBlock ? <span className="af-ptf-card-tag">{m.tradeBlock}</span> : null}
            </>
          )
          return (
            <li key={p.id} className="af-ptf-card" data-pos={positionTint(p.position)} data-on={step === 2 && picked(key) ? 'true' : undefined}>
              {step === 2 ? (
                <button type="button" className="af-ptf-card-main" aria-pressed={picked(key)} aria-label={m.include(p.name)}
                  onClick={() => props.onAsset({ key, kind: 'player', fromRosterId: r.rosterId, ref: p.id, label: p.name, value: p.value })}>
                  {body}
                  <span className="af-ptf-card-check" aria-hidden>{picked(key) ? '✓' : ''}</span>
                </button>
              ) : (
                <div className="af-ptf-card-main">{body}</div>
              )}
              {step === 1 && !props.isViewer ? (
                <button type="button" className="af-ptf-heart" aria-pressed={liked} aria-label={liked ? m.interested(p.name) : m.notInterested(p.name)}
                  onClick={() => props.onInterest(p)}>{liked ? '♥' : '♡'}</button>
              ) : null}
            </li>
          )
        })}
      </ul>

      {step === 2 ? (
        <div className="af-ptf-extras">
          {r.picks.length > 0 ? (
            <div className="af-ptf-picks">
              <span className="af-ptf-sub">{m.picks}</span>
              {r.picks.map((pk: RosterPick) => {
                const key = `${r.rosterId}:pick:${pk.pickId}`
                const blocked = pk.proposable === false
                return (
                  <button key={pk.pickId} type="button" className="af-ptf-pick" aria-pressed={picked(key)} disabled={blocked}
                    title={blocked ? m.pickNotHere : undefined} aria-label={m.include(pk.label)}
                    onClick={() => props.onAsset({ key, kind: 'pick', fromRosterId: r.rosterId, ref: pk.pickId, itemType: pk.itemType, label: pk.label, value: pk.value })}>
                    {pk.label}
                  </button>
                )
              })}
            </div>
          ) : null}
          {r.faabRemaining != null && r.faabRemaining > 0 ? (
            <label className="af-ptf-faab">
              <span className="af-ptf-sub">{m.faab}</span>
              <span className="af-ptf-faab-row">
                <span aria-hidden>$</span>
                <input type="number" inputMode="numeric" min={0} max={r.faabRemaining} step={1} value={props.faab}
                  onChange={(e) => props.onFaab(e.target.value)} aria-label={`${m.faab} — ${props.name}`} />
                <span>{m.faabOf(r.faabRemaining)}</span>
              </span>
            </label>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function TradeSummary(props: {
  teams: readonly string[]
  assets: readonly FlowAsset[]
  nameOf: (id: string) => string
  m: M
  editable: boolean
  onRecipient: (key: string, to: string) => void
}) {
  const { m, nameOf } = props
  const rows = summarize(props.teams, props.assets)
  return (
    <div className="af-ptf-summary">
      <h3>{m.summary}</h3>
      {rows.map((row) => (
        <div key={row.rosterId} className="af-ptf-sum-team">
          <b>{nameOf(row.rosterId)}</b>
          {row.receives.length === 0 && row.sends.length === 0 ? (
            <p className="af-ptf-empty">{m.nothingYet(nameOf(row.rosterId))}</p>
          ) : (
            <div className="af-ptf-sum-cols">
              <div>
                <span className="af-ptf-sub">{m.receives}</span>
                <ul>{row.receives.map((a) => <li key={a.key}><span>{a.label}</span><small>{m.from(nameOf(a.fromRosterId))}</small></li>)}</ul>
              </div>
              <div>
                <span className="af-ptf-sub">{m.sends}</span>
                <ul>
                  {row.sends.map((a) => (
                    <li key={a.key}>
                      <span>{a.label}</span>
                      {props.editable ? (
                        <label className="af-ptf-to">
                          <small>{m.toTeam}</small>
                          <select value={a.toRosterId} aria-label={m.toWhom(a.label)} onChange={(e) => props.onRecipient(a.key, e.target.value)}>
                            {props.teams.filter((id) => id !== a.fromRosterId).map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
                          </select>
                        </label>
                      ) : <small>{m.to(nameOf(a.toRosterId))}</small>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** Market value in and out for the viewer, from the values the rosters route already priced. */
function ValueLine({ assets, viewerRosterId, m }: { assets: readonly FlowAsset[]; viewerRosterId: string; m: M }) {
  const sum = (xs: readonly FlowAsset[]) => xs.reduce((n, a) => n + (a.value ?? 0), 0)
  const inV = sum(assets.filter((a) => a.toRosterId === viewerRosterId))
  const outV = sum(assets.filter((a) => a.fromRosterId === viewerRosterId))
  if (inV === 0 && outV === 0) return null
  return <p className="af-ptf-value">{m.valueLine(Math.round(inV), Math.round(outV))}</p>
}
