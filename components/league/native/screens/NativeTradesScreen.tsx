'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LeagueTeamSlot, UserLeague } from '@/app/dashboard/types'
import type { LeagueTradeAsset, LeagueTradeBlockPanelItem, LeagueTradeHistoryItem } from '@/components/league/types'
import { ProposeTradeModal } from '@/app/league/[leagueId]/tabs/ProposeTradeModal'
import { openChimmyWithPrompt } from '@/lib/dashboard/open-chimmy-with-prompt'
import { reviewIdFor } from '@/lib/trade-review/reviewIdStore'
import { useVisibleRefresh } from '@/hooks/useVisibleRefresh'
import { Card, ScreenHead } from './NativeScreenParts'

/**
 * Trades — handoff §3, `Trades.png` / `MobileTrades.png`.
 *
 * One read, the same as the Trades tab: `/api/league/trades-panel`. The AF grade on an offer is the
 * panel's own `leagueGrade` (THE grade every trade surface shows — `lib/decision-os/trade/tradeGrade.ts`);
 * nothing is re-graded here. Accept / Decline / Cancel / commissioner review call the same routes as
 * the Trades tab, and building or countering an offer opens the existing `ProposeTradeModal`, which
 * owns rosters, picks, FAAB and its own grade preview.
 */
type Panel = {
  tradeBlock?: LeagueTradeBlockPanelItem[]
  activeTrades?: LeagueTradeHistoryItem[]
  historyTrades?: LeagueTradeHistoryItem[]
}

function gradeTone(letter: string | null | undefined): 'good' | 'warn' | 'bad' {
  const l = String(letter ?? '').trim().toUpperCase()
  if (l.startsWith('A') || l.startsWith('B')) return 'good'
  if (l.startsWith('C')) return 'warn'
  return 'bad'
}

function AssetList({ assets }: { assets: LeagueTradeAsset[] }) {
  if (!assets.length) return <p className="nls-muted">Nothing</p>
  return (
    <ul>
      {assets.map((a) => (
        <li key={a.id}>
          {a.label}
          {a.sublabel ? <small>{a.sublabel}</small> : null}
        </li>
      ))}
    </ul>
  )
}

function ago(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const h = Math.round((Date.now() - t) / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function NativeTradesScreen({ league, teams }: { league: UserLeague; teams: LeagueTeamSlot[] }) {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [builderOpen, setBuilderOpen] = useState(false)

  const load = useCallback(
    async (background = false) => {
      if (!background) {
        setLoading(true)
        setError(null)
      }
      try {
        const res = await fetch(`/api/league/trades-panel?leagueId=${encodeURIComponent(league.id)}${background ? '' : '&history=1'}`, { credentials: 'include', cache: 'no-store' })
        const json = (await res.json().catch(() => null)) as Panel | null
        if (!res.ok) {
          if (!background) setError('We could not load trades.')
          return
        }
        setPanel((prev) => (background && prev ? { ...prev, activeTrades: json?.activeTrades ?? prev.activeTrades, tradeBlock: json?.tradeBlock ?? prev.tradeBlock } : json))
      } catch {
        if (!background) setError('We could not load trades.')
      } finally {
        if (!background) setLoading(false)
      }
    },
    [league.id],
  )
  useEffect(() => {
    void load()
  }, [load])
  useVisibleRefresh(() => load(true))

  const active = useMemo(() => panel?.activeTrades ?? [], [panel])
  const offers = useMemo(
    () => active.filter((t) => (t.viewerIsReceiver && t.status === 'pending') || (t.viewerIsCommissioner && t.status === 'awaiting_commissioner')),
    [active],
  )
  const outgoing = useMemo(() => active.filter((t) => t.viewerIsProposer && t.status === 'pending'), [active])
  const recent = useMemo(() => (panel?.historyTrades ?? []).filter((t) => t.status === 'accepted' || t.direction === 'complete').slice(0, 5), [panel])
  const block = panel?.tradeBlock ?? []

  const act = async (tradeId: string, path: 'accept' | 'reject' | 'cancel') => {
    setBusy(tradeId)
    setActionErr(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(league.id)}/trades/${encodeURIComponent(tradeId)}/${path}`, { method: 'POST' })
      if (!res.ok) {
        setActionErr(`We could not ${path === 'reject' ? 'decline' : path} this trade. Nothing was changed.`)
        return
      }
      await load()
    } catch {
      setActionErr('That did not go through. Nothing was changed.')
    } finally {
      setBusy(null)
    }
  }
  const review = async (tradeId: string, decision: 'approve' | 'reject') => {
    setBusy(tradeId)
    setActionErr(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(league.id)}/trades/${encodeURIComponent(tradeId)}/commissioner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reviewId: reviewIdFor(tradeId) }),
      })
      if (!res.ok) {
        setActionErr('We could not save that commissioner decision. Nothing was changed.')
        return
      }
      await load()
    } finally {
      setBusy(null)
    }
  }
  const askChimmy = (t: LeagueTradeHistoryItem) =>
    openChimmyWithPrompt({
      leagueId: league.id,
      source: 'trade',
      prompt: `${t.partnerName} offered me ${t.received.map((a) => a.label).join(', ') || 'nothing'} for ${t.sent.map((a) => a.label).join(', ') || 'nothing'}. Should I accept, counter or decline?`,
    })

  const deadline = league.tradeDeadlineWeek ? `Deadline · Wk ${league.tradeDeadlineWeek}` : 'Deadline · none'

  return (
    <div className="nls" data-testid="native-trades-screen">
      <ScreenHead eyebrow={`${league.name} · Trades`} title="Trade center">
        <span className="nls-chip">{deadline}</span>
        <button type="button" className="nls-btn" data-variant="primary" onClick={() => setBuilderOpen(true)}>Propose a trade</button>
      </ScreenHead>

      {error ? <p className="nls-error" role="alert">{error}</p> : null}
      {actionErr ? <p className="nls-error" role="alert">{actionErr}</p> : null}
      {loading && !panel ? <p className="nls-empty" role="status">Loading trades…</p> : null}

      {offers.map((t) => {
        const g = t.leagueGrade && t.leagueGrade.graded ? t.leagueGrade : null
        const isReview = t.status === 'awaiting_commissioner'
        return (
          <section key={t.id} className="nls-card" data-tone="warn" aria-label={`Offer from ${t.partnerName}`}>
            <div className="nls-offer-head">
              <span className="nls-chip" data-tone="warn">{isReview ? 'Needs your review' : 'Offer received'}</span>
              <strong>{isReview ? `${t.proposerName ?? t.partnerName} ⇄ ${t.receiverName ?? 'partner'}` : t.partnerName}</strong>
              <small>{ago(t.timestamp)}</small>
              {g && !isReview ? (
                <span className="nls-offer-grade" data-pts={gradeTone(g.letter) === 'good' ? 'good' : gradeTone(g.letter) === 'bad' ? 'bad' : undefined}>
                  AF grade for you · {g.letter}
                </span>
              ) : null}
            </div>
            <div className="nls-givegets">
              <div>
                <h4 className="nls-label">{isReview ? `${t.proposerName ?? 'Proposer'} gives` : 'You give'}</h4>
                <AssetList assets={t.sent} />
              </div>
              <div>
                <h4 className="nls-label">{isReview ? `${t.receiverName ?? 'Receiver'} gives` : 'You get'}</h4>
                <AssetList assets={t.received} />
              </div>
            </div>
            {g && !isReview && g.recommendation ? <p className="nls-muted nls-offer-note">{g.recommendation}</p> : null}
            <div className="nls-actions nls-offer-actions">
              {isReview ? (
                <>
                  <button type="button" className="nls-btn" data-variant="primary" disabled={busy === t.id} onClick={() => void review(t.id, 'approve')}>Approve</button>
                  <button type="button" className="nls-btn" disabled={busy === t.id} onClick={() => void review(t.id, 'reject')}>Veto</button>
                </>
              ) : (
                <>
                  <button type="button" className="nls-btn" data-variant="primary" disabled={busy === t.id} onClick={() => void act(t.id, 'accept')}>Accept</button>
                  <button type="button" className="nls-btn" disabled={busy === t.id} onClick={() => setBuilderOpen(true)}>Counter</button>
                  <button type="button" className="nls-btn" disabled={busy === t.id} onClick={() => void act(t.id, 'reject')}>Decline</button>
                  <button type="button" className="nls-btn" onClick={() => askChimmy(t)}>Ask Chimmy</button>
                </>
              )}
            </div>
          </section>
        )
      })}

      {panel ? (
        <div className="nls-cols">
          <div className="nls nls-stack">
            <Card label="Build a trade">
              <p>Pick a partner, choose what you give and what you get, and AF grades the deal for both sides before you send it.</p>
              <div className="nls-actions nls-actions-top">
                <button type="button" className="nls-btn" data-variant="primary" onClick={() => setBuilderOpen(true)}>Open trade builder</button>
              </div>
            </Card>
            <Card label="Your open offers">
              {outgoing.length ? (
                <ul className="nls-list">
                  {outgoing.map((t) => (
                    <li key={t.id} className="nls-toolbar">
                      <span className="nls-grow">
                        To <b>{t.partnerName}</b>: {t.sent.map((a) => a.label).join(', ') || 'nothing'} for {t.received.map((a) => a.label).join(', ') || 'nothing'}
                      </span>
                      <button type="button" className="nls-btn" data-size="sm" disabled={busy === t.id} onClick={() => void act(t.id, 'cancel')}>Cancel</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No offers waiting on other managers.</p>
              )}
            </Card>
          </div>
          <aside className="nls-aside" aria-label="League trades">
            <Card label="League trade block">
              {block.length ? (
                <ul className="nls-list">
                  {block.slice(0, 6).map((b) => (
                    <li key={b.id}><b>{b.ownerName}</b> shopping {b.name} · {b.position}{b.team ? ` · ${b.team}` : ''}</li>
                  ))}
                </ul>
              ) : (
                <p>Nobody has listed a player yet.</p>
              )}
            </Card>
            <Card label="Recent trades">
              {recent.length ? (
                <ul className="nls-list">
                  {recent.map((t) => (
                    <li key={t.id}>
                      <b>{t.proposerName ?? 'You'}</b> gets {t.received.map((a) => a.label).join(', ') || '—'}; <b>{t.receiverName ?? t.partnerName}</b> gets {t.sent.map((a) => a.label).join(', ') || '—'}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No trades yet this season.</p>
              )}
            </Card>
          </aside>
        </div>
      ) : null}

      <ProposeTradeModal open={builderOpen} onClose={() => setBuilderOpen(false)} leagueId={league.id} teams={teams} platform={league.platform} sport={league.sport} onSubmitted={() => { setBuilderOpen(false); void load() }} />
    </div>
  )
}
