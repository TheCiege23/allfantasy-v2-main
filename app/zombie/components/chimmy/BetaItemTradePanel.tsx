'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
type Choice = { id: string; name: string }
type Team = { rosterId: string; name: string; canTrade: boolean; items: Choice[]; players: Choice[] }
type Context = { seasonId: string; myRosterId: string | null; teams: Team[] }
export function BetaItemTradePanel({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<Context | null>(null)
  const [partner, setPartner] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    fetch(`/api/zombie/trade-inventory?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' }).then(async r => { const body = await r.json(); if (active) { if (r.ok) setData(body); else setMessage(body.error || 'Inventory unavailable.') } }).catch(() => { if (active) setMessage('Inventory unavailable.') })
    return () => { active = false }
  }, [leagueId])
  const mine = data?.teams.find(t => t.rosterId === data.myRosterId)
  const theirs = data?.teams.find(t => t.rosterId === partner)
  const toggle = (key: string) => setSelected(old => old.includes(key) ? old.filter(k => k !== key) : [...old, key])
  async function propose() {
    if (!data?.myRosterId || !theirs || !mine) return
    setBusy(true); setMessage('')
    try {
      const assets = [mine, theirs].flatMap(team => ['items', 'players'].flatMap(kind => team[kind as 'items' | 'players'].filter(c => selected.includes(`${team.rosterId}:${kind}:${c.id}`)).map(c => ({
        fromRosterId: team.rosterId, toRosterId: team.rosterId === mine.rosterId ? theirs.rosterId : mine.rosterId,
        assetType: kind === 'items' ? 'zombie_item' : 'player', playerId: kind === 'players' ? c.id : undefined, playerName: c.name,
        metadata: kind === 'items' ? { zombieItemId: c.id, itemLabel: c.name } : {},
      }))))
      if (!assets.some(a => a.assetType === 'zombie_item')) throw new Error('Select at least one serum or weapon.')
      const response = await fetch('/api/redraft/trade-proposals', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, seasonId: data.seasonId, proposerRosterId: mine.rosterId, receiverRosterId: theirs.rosterId, assets }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Trade could not be proposed.')
      setMessage('Offer sent. Your partner can respond in Trade center. League review rules apply; no items move until the trade is approved.'); setSelected([])
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Trade could not be proposed.') }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
    <h2 className="text-lg font-bold text-teal-100">Trade serums, weapons and players</h2>
    <p className="text-sm text-white/65">Survivors and Whisperers may trade. Approved deals appear in league chat. Items received after your last starter begins become usable next week.</p>
    {mine?.canTrade && <>
      <label className="block text-sm text-white">Trade partner<select value={partner} onChange={e => { setPartner(e.target.value); setSelected([]) }} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/20 bg-slate-950 p-2"><option value="">Choose a team</option>{data?.teams.filter(t => t.canTrade && t.rosterId !== mine.rosterId).map(t => <option key={t.rosterId} value={t.rosterId}>{t.name}</option>)}</select></label>
      {theirs && <div className="grid gap-3 sm:grid-cols-2">{[mine, theirs].map(team => <fieldset key={team.rosterId} className="max-h-72 overflow-y-auto rounded-xl border border-white/10 p-3"><legend className="px-1 text-sm font-bold text-white">{team.rosterId === mine.rosterId ? 'You send' : 'You receive'}</legend>{(['items', 'players'] as const).map(kind => <div key={kind}><p className="mt-2 text-xs uppercase text-white/50">{kind}</p>{team[kind].map(c => <label key={c.id} className="flex min-h-[44px] items-center gap-2 text-sm text-white/80"><input type="checkbox" checked={selected.includes(`${team.rosterId}:${kind}:${c.id}`)} onChange={() => toggle(`${team.rosterId}:${kind}:${c.id}`)} />{c.name}</label>)}</div>)}</fieldset>)}</div>}
      <button type="button" onClick={() => void propose()} disabled={busy || !partner || !selected.length} className="min-h-[44px] rounded-lg bg-teal-500/25 px-4 font-semibold text-teal-100 disabled:opacity-40">{busy ? 'Sending…' : 'Propose trade'}</button>
    </>}
    {mine && !mine.canTrade && <p className="text-sm text-amber-100">Your current role cannot trade. Held items stay with your team until revival or loot.</p>}
    {message && <p role="status" className="text-sm text-white/80">{message}</p>}
    <Link href={`/league/${encodeURIComponent(leagueId)}?view=trades`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-teal-200 underline">Open Trade center</Link>
  </section>
}
