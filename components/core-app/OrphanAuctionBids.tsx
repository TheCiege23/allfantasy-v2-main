'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreLocale } from '@/lib/core-app/messages/coreLocale'
import type { OrphanAuctionView } from '@/lib/orphan-auction/orphanAuctionService'

/**
 * A team's sealed bids in the league's orphan auction (lib/orphan-auction), on the Waivers page —
 * FAAB is spent here, beside the rest of it. Shows only while an auction is open, and its results for
 * a week after it closes; renders nothing otherwise. The route checks every bid again: this card's
 * running total is a convenience, not the gate. Strings: orphanAuction.* (EN/ES).
 */
const K = 'orphanAuction.'
const RESULTS_FOR_MS = 7 * 86_400_000

const CODE_KEYS: Record<string, string> = {
  AUCTION_CLOSED: 'err.closed',
  UNKNOWN_ASSET: 'err.unknown',
  NOT_WHOLE_DOLLARS: 'err.whole',
  BELOW_MIN_BID: 'err.min',
  OVER_BUDGET: 'err.budget',
}

export function OrphanAuctionBids({ leagueId }: { leagueId: string }) {
  const { language, t, tInterpolate } = useOptionalLanguage()
  const tx = (key: string, vars?: Record<string, string | number>) => (vars ? tInterpolate(K + key, vars) : t(K + key))
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/orphan-auction`
  const [view, setView] = useState<OrphanAuctionView | null>(null)
  const [bids, setBids] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const when = (iso: string) => new Date(iso).toLocaleString(coreLocale(language).usLocale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) return
      const body = (await r.json()) as OrphanAuctionView
      setView(body)
      if (body.supported && body.mine) setBids(Object.fromEntries(Object.entries(body.mine.bids).map(([k, v]) => [k, String(v)])))
    } catch {
      // Nothing to show is the right answer when the auction cannot be read.
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  if (!view?.supported || !view.auction || !view.mine) return null
  const auction = view.auction
  const open = auction.status === 'open' && Date.parse(auction.closesAt) > Date.now()
  if (auction.status === 'closed' && Date.now() - Date.parse(auction.closesAt) > RESULTS_FOR_MS) return null
  if (auction.status === 'open' && !open) {
    return (
      <section id="orphan-auction" className="af-wv-orphan" data-testid="orphan-auction-bids">
        <h2>{tx('title')}</h2>
        <p>{tx('bidsEnded')}</p>
      </section>
    )
  }

  const total = Object.values(bids).reduce((s, v) => s + (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0), 0)
  const over = total > view.mine.budget

  const save = async () => {
    setBusy(true)
    setMessage('')
    try {
      const payload = Object.fromEntries(Object.entries(bids).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)]))
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bid', bids: payload }) })
      const out = (await r.json().catch(() => ({}))) as { error?: string; code?: string }
      if (!r.ok) throw new Error(out.code && CODE_KEYS[out.code] ? tx(CODE_KEYS[out.code]!) : out.error || '')
      setMessage(tx('bidsSaved'))
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : tx('saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    const mine = (auction.results ?? []).filter((r) => r.rosterId === view.mine!.rosterId)
    return (
      <section id="orphan-auction" className="af-wv-orphan" data-testid="orphan-auction-bids">
        <h2>{tx('resultsTitle', { teams: auction.teams.join(', ') })}</h2>
        <p>{mine.length ? tx('youWon', { count: mine.length, paid: mine.reduce((s, r) => s + r.amount, 0) }) : tx('youWonNone')}</p>
        <ul>
          {(auction.results ?? []).map((r) => (
            <li key={r.assetId}>
              {r.label} → <strong>{r.teamName}</strong> · ${r.amount}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section id="orphan-auction" className="af-wv-orphan" data-testid="orphan-auction-bids">
      <h2>{tx('title')}</h2>
      <p>{tx('bidIntro', { teams: auction.teams.join(', '), when: when(auction.closesAt) })}</p>
      <p>{tx('bidRules', { min: auction.minBid })}</p>
      <p data-testid="orphan-auction-total" data-over={over ? 'true' : 'false'}>
        <strong>{tx('budget', { total, budget: view.mine.budget })}</strong>
        {over ? ` · ${tx('err.budget')}` : ''}
      </p>
      <fieldset disabled={busy}>
        <ul>
          {auction.assets.map((a) => (
            <li key={a.id}>
              <label>
                {a.label}
                {a.kind === 'player' && (a.position || a.team) ? ` · ${[a.position, a.team].filter(Boolean).join(' ')}` : ''}
                {a.from ? ` · ${tx('from', { team: a.from })}` : ''}{' '}
                <input
                  type="number"
                  inputMode="numeric"
                  min={auction.minBid}
                  step={1}
                  value={bids[a.id] ?? ''}
                  placeholder="$"
                  aria-label={tx('bidFor', { asset: a.label })}
                  onChange={(e) => setBids((b) => ({ ...b, [a.id]: e.target.value }))}
                  data-testid="orphan-auction-bid"
                  style={{ width: '5.5rem' }}
                />
              </label>
            </li>
          ))}
        </ul>
        <button type="button" className="af-btn" disabled={over} onClick={() => void save()} data-testid="orphan-auction-save">
          {busy ? tx('saving') : tx('saveBids')}
        </button>
      </fieldset>
      <p role="status">{message}</p>
    </section>
  )
}
