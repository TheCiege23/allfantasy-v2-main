'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { survivorSideGameMessages } from '@/lib/survivor/survivorSideGameUiMessages'
import type { SurvivorSideGameManagerView } from '@/lib/survivor/survivorSideGameService'

function when(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(getAppIntlLocale(), { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
}

function requestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * The castaway's side games on the island home: the Token Pool (on Exile), the Survivor Pool (on the
 * island), Auction Week bids, the token shop and Exile team bids. Shows only what is running for this
 * castaway, and only their own picks, bids and balances. Renders nothing when no side game applies.
 */
export function SurvivorSideGamesCard({ leagueId }: { leagueId: string }) {
  const m = useMessages(survivorSideGameMessages)
  const [view, setView] = useState<SurvivorSideGameManagerView | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [bids, setBids] = useState<Record<string, number>>({})
  const [exileTeam, setExileTeam] = useState('')
  const [exileAmount, setExileAmount] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survivor/side-games?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      if (!res.ok) return
      const data = (await res.json()) as SurvivorSideGameManagerView
      if (data && Array.isArray(data.games)) setView(data)
    } catch {
      /* the island works without its side games */
    }
  }, [leagueId])

  useEffect(() => { void load() }, [load])

  async function act(payload: Record<string, unknown>) {
    setBusy(true)
    setStatus(null)
    try {
      const res = await fetch('/api/survivor/side-games', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, ...payload }) })
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      setStatus(res.ok ? body.message ?? m.done : body.error ?? m.saveFailed)
      if (res.ok) await load()
    } catch {
      setStatus(m.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  if (!view) return null
  const s = view.settings
  const showTokenPool = view.role === 'exile' && s.tokenPoolEnabled
  const showPool = view.role === 'active' && s.survivorPoolEnabled && view.week >= s.survivorPoolStartWeek
  const auctions = view.role === 'active' ? view.auctions : []
  const showShop = view.shop.length > 0
  const showExileBid = view.role === 'exile' && Boolean(view.exileBid)
  if (!showTokenPool && !showPool && !auctions.length && !showShop && !showExileBid) return null

  const tpPicks = view.tokenPool.picks.filter((p) => p.week === view.week)
  const tpLeft = Math.max(0, s.tokenPoolPicksPerWeek - tpPicks.length)
  const openGames = view.games.filter((g) => g.open)

  // "No reusing a team": the manager's own season-long used list; a used team cannot be picked again.
  const usedTeams = s.survivorPoolNoReuse ? view.pool.usedTeams ?? [] : []
  const gameRow = (kind: 'token_pool_pick' | 'pool_pick', g: (typeof view.games)[number], chosen: string | null, disabled: boolean, used: readonly string[] = []) => (
    <div key={`${kind}-${g.key}`} className="flex flex-wrap items-center gap-2 text-xs" data-testid={`survivor-side-${kind}-${g.key}`}>
      <span className="min-w-[9rem] text-white/70">{g.awayTeam} {m.at} {g.homeTeam} · {when(g.startTime)}</span>
      {[g.awayKey, g.homeKey].map((team, i) => (
        <button key={team} type="button" disabled={busy || disabled || used.includes(team)} onClick={() => void act({ action: kind, gameKey: g.key, teamKey: team })}
          data-used={used.includes(team) ? 'true' : undefined}
          className={`rounded-lg border px-2 py-1 disabled:opacity-40 ${chosen === team ? 'border-emerald-400/60 text-emerald-200' : 'border-white/20'}`}>
          {chosen === team ? `${m.picked}: ` : ''}{i === 0 ? g.awayTeam : g.homeTeam}{used.includes(team) ? ` · ${m.usedTag}` : ''}
        </button>
      ))}
    </div>
  )

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-[13px] text-white/85" data-testid="survivor-side-games-card">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{m.cardTitle}</h3>
        <span className="text-[11px] text-white/60">{m.tokens(view.tokens)}{view.balances.faab != null ? ` · ${m.balances(`$${view.balances.faab}`, view.balances.auctionCash)}` : ''}</span>
      </header>
      {status && <p role="status" className="text-xs text-amber-200">{status}</p>}

      {showTokenPool && (
        <div className="space-y-2" data-testid="survivor-side-token-pool">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-white/60">{m.tokenPoolHeading}</h4>
            {s.tokenPoolMode === 'streak' && <span className="flex items-center gap-2 text-[11px]">{m.pot(view.tokenPool.pot)}
              <button type="button" disabled={busy || view.tokenPool.pot < 1} onClick={() => void act({ action: 'token_pool_cash_out' })} className="rounded-lg border border-white/20 px-2 py-0.5 disabled:opacity-40">{m.cashOut}</button></span>}
          </div>
          {!s.tokenPoolOpen && <p className="text-[11px] text-white/50">{m.tokenPoolClosedNote}</p>}
          {s.tokenPoolOpen && openGames.map((g) => gameRow('token_pool_pick', g, tpPicks.find((p) => p.gameKey === g.key)?.teamKey ?? null, tpLeft === 0 || tpPicks.some((p) => p.gameKey === g.key)))}
        </div>
      )}

      {showPool && (
        <div className="space-y-2" data-testid="survivor-side-pool">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-white/60">{m.poolHeading}</h4>
          <p className="text-[11px] text-white/50">{m.ruleThisWeek(view.poolRule.rule === 'conference' ? view.poolRule.conference : view.poolRule.rule === 'division' ? `${view.poolRule.division ?? ''}` : view.poolRule.rule === 'away_only' ? m.ruleAway : view.poolRule.rule === 'allowed_list' ? view.poolRule.allowedTeams.join(', ') : m.ruleAny)}</p>
          {view.pool.banned && <p className="text-[11px] text-rose-300">{m.poolBannedNote}</p>}
          {!view.pool.banned && !view.pool.entry.alive && (
            <p className="flex items-center gap-2 text-[11px]">{m.poolOutNote} {m.revivesLeft(view.pool.revivesLeft)}
              <button type="button" disabled={busy || view.pool.revivesLeft < 1} onClick={() => void act({ action: 'pool_revive' })} className="rounded-lg border border-white/20 px-2 py-0.5 disabled:opacity-40">{m.revive}</button></p>
          )}
          {usedTeams.length > 0 && <p className="text-[11px] text-white/50" data-testid="survivor-side-pool-used">{m.usedTeams(usedTeams.join(', '))}</p>}
          {view.pool.entry.alive && openGames.map((g) => gameRow('pool_pick', g, view.pool.pick?.gameKey === g.key ? view.pool.pick.teamKey : null, false, usedTeams))}
        </div>
      )}

      {auctions.length > 0 && (
        <div className="space-y-2" data-testid="survivor-side-auctions">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-white/60">{m.auctionsHeading}</h4>
          {auctions.map((a) => (
            <div key={a.auctionId} className="space-y-1 rounded-xl border border-white/[0.06] p-2">
              <p className="text-xs">{a.label} · {a.mode === 'sealed' ? m.modeSealed : m.modeOpen} · {m.closesAt} {when(a.closesAt)}</p>
              {a.items.map((i) => (
                <div key={i.itemId} className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="min-w-[8rem]">{i.label}</span>
                  {i.myBid != null && <span>{m.yourBid(i.myBid)}</span>}
                  {i.highBid != null && <span className="text-white/50">{m.highBidLabel(i.highBid)}</span>}
                  {i.won && <span className="text-emerald-300">{m.won}</span>}
                  {a.takingBids && !(a.mode === 'sealed' && i.myBid != null) && <>
                    <input type="number" min={1} aria-label={`${m.bid} ${i.label}`} value={bids[`${a.auctionId}:${i.itemId}`] ?? ''} onChange={(e) => setBids((b) => ({ ...b, [`${a.auctionId}:${i.itemId}`]: Number(e.target.value) }))} className="w-20 rounded-lg border border-white/15 bg-black/30 px-2 py-0.5" />
                    <button type="button" disabled={busy || !bids[`${a.auctionId}:${i.itemId}`]} onClick={() => void act({ action: 'auction_bid', auctionId: a.auctionId, itemId: i.itemId, amount: bids[`${a.auctionId}:${i.itemId}`] })} className="rounded-lg border border-white/20 px-2 py-0.5 disabled:opacity-40">{m.bid}</button>
                  </>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {showShop && (
        <div className="space-y-2" data-testid="survivor-side-shop">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-white/60">{m.shopHeading}</h4>
          {view.shop.map((item) => (
            <div key={item.id} className="flex items-center gap-2 text-xs">
              <span className="min-w-[8rem] capitalize">{m.shopItem(item.id)}</span>
              <span className="text-white/50">{m.tokens(item.cost)}</span>
              <button type="button" disabled={busy || view.tokens < item.cost} onClick={() => void act({ action: 'shop_buy', itemId: item.id, requestId: requestId() })} className="rounded-lg border border-white/20 px-2 py-0.5 disabled:opacity-40">{m.buy}</button>
            </div>
          ))}
        </div>
      )}

      {showExileBid && view.exileBid && (
        <div className="space-y-2" data-testid="survivor-side-exile-bid">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-white/60">{m.exileBidHeading} · {m.closesAt} {when(view.exileBid.closesAt)}</h4>
          {view.exileBid.awarded ? <p className="text-xs text-emerald-300">{m.awardedTeam(view.exileBid.awarded)}</p> : <>
            <p className="text-[11px] text-white/50">{m.exileBidHelp(s.exileBidBudget)}</p>
            {view.exileBid.myBid && <p className="text-[11px]">{m.yourBid(view.exileBid.myBid.amount)} · {view.exileBid.myBid.team}</p>}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select aria-label={m.exileBidHeading} value={exileTeam} onChange={(e) => setExileTeam(e.target.value)} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1">
                <option value="">—</option>
                {view.exileBid.openTeams.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="number" min={0} max={s.exileBidBudget} aria-label={m.bid} value={exileAmount} onChange={(e) => setExileAmount(Number(e.target.value))} className="w-20 rounded-lg border border-white/15 bg-black/30 px-2 py-1" />
              <button type="button" disabled={busy || !exileTeam} onClick={() => void act({ action: 'exile_bid', team: exileTeam, amount: exileAmount })} className="rounded-lg border border-white/20 px-2 py-1 disabled:opacity-40">{m.placeBid}</button>
            </div>
          </>}
        </div>
      )}
    </section>
  )
}
