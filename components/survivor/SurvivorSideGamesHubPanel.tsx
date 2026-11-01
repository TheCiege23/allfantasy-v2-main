'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { survivorSideGameMessages } from '@/lib/survivor/survivorSideGameUiMessages'
import type { SideGamePrizeKind, SurvivorSideGameSettings } from '@/lib/survivor/survivorSideGameSettings'

type Game = { key: string; homeTeam: string; awayTeam: string; homeKey: string; awayKey: string; startTime: string | null; final: boolean; homeScore: number | null; awayScore: number | null }
type Auction = { auctionId: string; label: string; mode: 'sealed' | 'open'; currency: string; opensAt: string; closesAt: string; status: string; bidCount: number; items: Array<{ itemId: string; label: string; blind: boolean }> }
type View = {
  settings: SurvivorSideGameSettings
  week: number
  games: Game[]
  openPicks: Array<{ game: 'token_pool' | 'pool'; gameKey: string; count: number }>
  pool: Array<{ userId: string; displayName: string; alive: boolean; revivesLeft: number; banned: boolean; wins: number; picked: boolean }>
  auctions: Auction[]
  pendingPurchases: number
  castaways: Array<{ userId: string; displayName: string; rosterId: string | null; playerState: string; auctionCash: number }>
}
type DraftItem = { label: string; blind: boolean; kind: SideGamePrizeKind; amount: number; powerType: 'extra_vote' | 'vote_shield' | 'vote_steal' }

function when(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(getAppIntlLocale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
}

/** `datetime-local` value → ISO (the browser's local time, which is what the commissioner typed). */
function localToIso(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/**
 * Commissioner Hub → Exile Island: the live side-game controls — start/stop the Token Pool, settle a
 * game by hand (the override), Survivor Pool standings with "grant a revive", Auction Week (schedule,
 * open now, close now, cancel) and auction cash. Settings live in league settings → Exile.
 */
export function SurvivorSideGamesHubPanel({ leagueId }: { leagueId: string }) {
  const m = useMessages(survivorSideGameMessages)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [winners, setWinners] = useState<Record<string, string>>({})
  const [cash, setCash] = useState<Record<string, number>>({})
  const [auction, setAuction] = useState({ label: '', mode: 'sealed' as 'sealed' | 'open', opensAt: '', closesAt: '' })
  const [items, setItems] = useState<DraftItem[]>([{ label: '', blind: false, kind: 'advantage', amount: 0, powerType: 'extra_vote' }])
  const [exposed, setExposed] = useState<{ userId: string; preview: string | null }>({ userId: '', preview: null })

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survivor/commissioner?leagueId=${encodeURIComponent(leagueId)}&type=side_games`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as View
      if (!data?.settings || !Array.isArray(data.games)) throw new Error('shape')
      setView(data)
      setError(null)
    } catch {
      setError(m.loadFailed)
    }
  }, [leagueId, m.loadFailed])

  useEffect(() => { void load() }, [load])

  async function act(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    setStatus(null)
    try {
      const res = await fetch('/api/survivor/commissioner', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, ...payload }) })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || m.saveFailed)
      setStatus(m.done)
      await load()
      return true
    } catch (e) {
      setStatus(e instanceof Error ? e.message : m.saveFailed)
      return false
    } finally {
      setBusy(false)
    }
  }

  /** "Removed if exposed": first a preview (nothing changes), then the commissioner confirms. */
  async function exposure(confirm: boolean) {
    setBusy(true)
    setStatus(null)
    try {
      const res = await fetch('/api/survivor/commissioner', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, action: 'exile_exposure_penalty', userId: exposed.userId, confirm }) })
      const body = (await res.json().catch(() => ({}))) as { error?: string; preview?: boolean; message?: string }
      if (!res.ok) throw new Error(body.error || m.saveFailed)
      if (body.preview) setExposed((x) => ({ ...x, preview: body.message ?? m.exposureApply }))
      else { setExposed({ userId: '', preview: null }); setStatus(m.done); await load() }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : m.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="text-sm text-rose-300" role="alert">{error}</p>
  if (!view) return <p className="text-sm text-white/50">{m.loading}</p>
  const s = view.settings
  const picksOn = (gameKey: string) => view.openPicks.filter((p) => p.gameKey === gameKey).reduce((n, p) => n + p.count, 0)
  const settleable = view.games.filter((g) => picksOn(g.key) > 0)

  return (
    <div className="space-y-5 text-[13px] text-white/85" data-testid="survivor-side-games-hub">
      <p className="text-[11px] text-white/60">{m.hubIntro}</p>
      {status && <p role="status" className="text-sm text-amber-200">{status}</p>}

      {s.tokenPoolEnabled && (
        <section className="flex items-center justify-between rounded-xl border border-white/10 p-3">
          <span>{m.tokenPoolTitle}: {s.tokenPoolOpen ? m.tokenPoolOpen : m.tokenPoolClosedNote}</span>
          <button type="button" disabled={busy} onClick={() => void act({ action: 'token_pool_toggle', open: !s.tokenPoolOpen })} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs disabled:opacity-40" data-testid="survivor-token-pool-toggle">
            {s.tokenPoolOpen ? m.closeNow : m.openNow}
          </button>
        </section>
      )}

      <section className="space-y-2 rounded-xl border border-white/10 p-3">
        <h4 className="text-sm font-semibold">{m.settleTitle}</h4>
        <p className="text-[11px] text-white/50">{m.settleHelp}</p>
        {settleable.length === 0 && <p className="text-xs text-white/40">{m.openPicks(0)}</p>}
        {settleable.map((g) => (
          <div key={g.key} className="flex flex-wrap items-center gap-2" data-testid={`survivor-settle-${g.key}`}>
            <span className="min-w-[10rem]">{g.awayTeam} {m.at} {g.homeTeam}{g.final ? ` (${g.awayScore}-${g.homeScore})` : ''}</span>
            <span className="text-[11px] text-white/50">{m.openPicks(picksOn(g.key))}</span>
            <select aria-label={m.settleWinner} value={winners[g.key] ?? ''} onChange={(e) => setWinners((w) => ({ ...w, [g.key]: e.target.value }))} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs">
              <option value="">{m.settleWinner}</option>
              <option value={g.awayKey}>{g.awayTeam}</option>
              <option value={g.homeKey}>{g.homeTeam}</option>
              <option value="tie">{m.settleTie}</option>
            </select>
            <button type="button" disabled={busy || !winners[g.key]} onClick={() => void act({ action: 'side_game_settle', week: view.week, gameKey: g.key, winnerKey: winners[g.key] })} className="rounded-lg border border-white/20 px-3 py-1 text-xs disabled:opacity-40">{m.settle}</button>
          </div>
        ))}
      </section>

      {s.survivorPoolEnabled && (
        <section className="space-y-2 rounded-xl border border-white/10 p-3">
          <h4 className="text-sm font-semibold">{m.poolStandings}</h4>
          {view.pool.map((p) => (
            <div key={p.userId} className="flex flex-wrap items-center gap-2" data-testid={`survivor-pool-row-${p.userId}`}>
              <span className="min-w-[8rem]">{p.displayName}</span>
              <span className="text-[11px] text-white/60">{p.banned ? m.banned : p.alive ? m.alive : m.out} · {m.revivesLeft(p.revivesLeft)}</span>
              <button type="button" disabled={busy} onClick={() => void act({ action: 'pool_grant_revive', targetUserId: p.userId, count: 1 })} className="rounded-lg border border-white/20 px-2 py-1 text-[11px] disabled:opacity-40">{m.grantRevive}</button>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2 rounded-xl border border-white/10 p-3">
        <h4 className="text-sm font-semibold">{m.auctionsTitle}</h4>
        {view.auctions.map((a) => (
          <div key={a.auctionId} className="flex flex-wrap items-center gap-2" data-testid={`survivor-auction-${a.auctionId}`}>
            <span className="min-w-[10rem]">{a.label}</span>
            <span className="text-[11px] text-white/50">{a.status} · {when(a.opensAt)} → {when(a.closesAt)} · {m.bidsCount(a.bidCount)}</span>
            {(a.status === 'scheduled') && <button type="button" disabled={busy} onClick={() => void act({ action: 'auction_status', auctionId: a.auctionId, status: 'open' })} className="rounded-lg border border-white/20 px-2 py-1 text-[11px]">{m.openNow}</button>}
            {(a.status === 'scheduled' || a.status === 'open') && <button type="button" disabled={busy} onClick={() => void act({ action: 'auction_status', auctionId: a.auctionId, status: 'closed' })} className="rounded-lg border border-white/20 px-2 py-1 text-[11px]">{m.closeNow}</button>}
            {(a.status === 'scheduled' || a.status === 'open') && <button type="button" disabled={busy} onClick={() => void act({ action: 'auction_status', auctionId: a.auctionId, status: 'cancelled' })} className="rounded-lg border border-white/20 px-2 py-1 text-[11px]">{m.cancel}</button>}
          </div>
        ))}
        <details className="rounded-lg border border-white/[0.06] p-2">
          <summary className="cursor-pointer text-xs">{m.newAuction}</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <input aria-label={m.auctionLabel} placeholder={m.auctionLabel} value={auction.label} onChange={(e) => setAuction((x) => ({ ...x, label: e.target.value }))} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs" />
            <select aria-label={m.auctionMode} value={auction.mode} onChange={(e) => setAuction((x) => ({ ...x, mode: e.target.value as 'sealed' | 'open' }))} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs"><option value="sealed">{m.modeSealed}</option><option value="open">{m.modeOpen}</option></select>
            <label className="text-[11px] text-white/60">{m.opensAt} <input type="datetime-local" aria-label={m.opensAt} value={auction.opensAt} onChange={(e) => setAuction((x) => ({ ...x, opensAt: e.target.value }))} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs" /></label>
            <label className="text-[11px] text-white/60">{m.closesAt} <input type="datetime-local" aria-label={m.closesAt} value={auction.closesAt} onChange={(e) => setAuction((x) => ({ ...x, closesAt: e.target.value }))} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs" /></label>
          </div>
          {items.map((it, i) => (
            <div key={i} className="mt-2 flex flex-wrap gap-2">
              <input aria-label={m.itemLabel} placeholder={m.itemLabel} value={it.label} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs" />
              <select aria-label={m.poolPrize} value={it.kind} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, kind: e.target.value as SideGamePrizeKind } : x)))} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs">
                <option value="advantage">{m.prizeAdvantage}</option><option value="free_trade_token">{m.prizeFreeTrade}</option><option value="steal_blocker">{m.prizeBlocker}</option>
                <option value="faab">{m.prizeFaab}</option><option value="score_bonus">{m.prizeScore}</option><option value="tokens">{m.prizeTokens}</option>
                {s.disadvantagesEnabled?.includes('opponent_penalty') && <option value="opponent_penalty">{m.prizeOpponentPenalty}</option>}
                {s.disadvantagesEnabled?.includes('vote_taken') && <option value="vote_taken">{m.prizeVoteTaken}</option>}
              </select>
              {it.kind === 'advantage' && <select aria-label={m.prizeAdvantage} value={it.powerType} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, powerType: e.target.value as DraftItem['powerType'] } : x)))} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs"><option value="extra_vote">extra vote</option><option value="vote_shield">vote shield</option><option value="vote_steal">vote steal</option></select>}
              {['faab', 'score_bonus', 'tokens', 'opponent_penalty'].includes(it.kind) && <input type="number" min={1} max={1000} aria-label={m.poolPrizeAmount} value={it.amount} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} className="w-20 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs" />}
              <label className="flex items-center gap-1 text-[11px] text-white/60"><input type="checkbox" checked={it.blind} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, blind: e.target.checked } : x)))} />{m.itemBlind}</label>
            </div>
          ))}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setItems((xs) => [...xs, { label: '', blind: false, kind: 'advantage', amount: 0, powerType: 'extra_vote' }])} disabled={items.length >= 12} className="rounded-lg border border-white/20 px-2 py-1 text-[11px]">{m.addItem}</button>
            <button type="button" disabled={busy || !auction.label || !auction.opensAt || !auction.closesAt} data-testid="survivor-auction-create"
              onClick={async () => {
                const ok = await act({
                  action: 'auction_create',
                  auction: { ...auction, opensAt: localToIso(auction.opensAt), closesAt: localToIso(auction.closesAt), items: items.map((it) => ({ label: it.label, blind: it.blind, prize: { kind: it.kind, amount: it.amount, powerType: it.powerType } })) },
                })
                if (ok) { setAuction({ label: '', mode: 'sealed', opensAt: '', closesAt: '' }); setItems([{ label: '', blind: false, kind: 'advantage', amount: 0, powerType: 'extra_vote' }]) }
              }}
              className="rounded-lg border border-[#ff3d81]/40 px-3 py-1 text-[11px] disabled:opacity-40">{m.create}</button>
          </div>
        </details>
      </section>

      {s.auctionCurrency === 'auction_cash' && (
        <section className="space-y-2 rounded-xl border border-white/10 p-3">
          <h4 className="text-sm font-semibold">{m.cashTitle}</h4>
          {view.castaways.filter((c) => c.rosterId && c.playerState === 'active').map((c) => (
            <div key={c.userId} className="flex items-center gap-2">
              <span className="min-w-[8rem]">{c.displayName}</span>
              <span className="text-[11px] text-white/60">${c.auctionCash}</span>
              <input type="number" aria-label={`${m.cashTitle} ${c.displayName}`} value={cash[c.userId] ?? 0} onChange={(e) => setCash((x) => ({ ...x, [c.userId]: Number(e.target.value) }))} className="w-20 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs" />
              <button type="button" disabled={busy || !cash[c.userId]} onClick={() => void act({ action: 'auction_cash_grant', rosterId: c.rosterId, amount: cash[c.userId] })} className="rounded-lg border border-white/20 px-2 py-1 text-[11px] disabled:opacity-40">{m.grantCash}</button>
            </div>
          ))}
        </section>
      )}

      {s.hideExileMembership && s.exileExposureRule && s.exileExposureRule !== 'off' && (
        <section className="space-y-2 rounded-xl border border-rose-400/20 p-3" data-testid="survivor-exposure-section">
          <h4 className="text-sm font-semibold">{m.exposureTitle}</h4>
          <p className="text-[11px] text-white/50">{m.exposureHelp}</p>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label={m.exposureTitle} value={exposed.userId} onChange={(e) => setExposed({ userId: e.target.value, preview: null })} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs">
              <option value="">—</option>
              {view.castaways.filter((c) => c.playerState !== 'eliminated').map((c) => <option key={c.userId} value={c.userId}>{c.displayName}</option>)}
            </select>
            {!exposed.preview
              ? <button type="button" disabled={busy || !exposed.userId} onClick={() => void exposure(false)} className="rounded-lg border border-white/20 px-2 py-1 text-[11px] disabled:opacity-40" data-testid="survivor-exposure-review">{m.exposureCheck}</button>
              : <button type="button" disabled={busy} onClick={() => void exposure(true)} className="rounded-lg border border-rose-400/40 px-2 py-1 text-[11px] disabled:opacity-40" data-testid="survivor-exposure-confirm">{m.exposureApply}</button>}
          </div>
          {exposed.preview && <p className="text-[11px] text-rose-200" role="status">{exposed.preview}</p>}
        </section>
      )}

      {view.pendingPurchases > 0 && <p className="text-[11px] text-white/50">{m.pendingPurchases(view.pendingPurchases)}</p>}
    </div>
  )
}
