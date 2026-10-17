'use client'
import { useEffect, useState } from 'react'
type Data = { user?: { tokenBalance?: number; playerState?: string }; returnRules?: { enabled: boolean; week: number; tokensRequired: number; resolved: boolean; slots: number }; error?: string }
export function ExileTokenWallet({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<Data | null>(null)
  useEffect(() => { let active = true; setData(null)
    fetch(`/api/survivor/exile?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' }).then(async r => { const json = await r.json(); if (!r.ok) throw new Error(json.error ?? 'Could not load tokens'); if (active) setData(json) }).catch(e => { if (active) setData({ error: e.message }) })
    return () => { active = false }
  }, [leagueId])
  const rules = data?.returnRules
  const balance = data?.user?.tokenBalance ?? 0
  const minimum = rules?.tokensRequired ?? 0
  const needed = Math.max(0, minimum - balance)
  return <section className="rounded-2xl border border-amber-300/20 bg-[#0b0d14] p-5 text-white">
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <img src="/survivor/exile/token-coin.svg" alt="Exile Island token" width={160} height={160} className="h-36 w-36 shrink-0 object-contain" />
      <div><p className="text-xs uppercase tracking-widest text-amber-200">The Exile token</p><h2 className="mt-2 font-serif text-2xl font-bold text-amber-100">Earn your way back</h2>
        {!data && <p role="status" className="mt-3 text-sm text-white/60">Loading your token balance…</p>}
        {data?.error && <p role="alert" className="mt-3 text-sm text-rose-300">{data.error}</p>}
        {rules && <><p className="mt-3 text-sm text-white/70">{rules.enabled ? `One manager returns after Week ${rules.week}: the highest token balance meeting the ${minimum}-token minimum.` : 'Exile return is disabled for this league.'}</p>
          {data?.user?.playerState === 'exile' ? <><p className="mt-3 flex items-center gap-2 font-mono text-xl"><img src="/survivor/exile/token-icon.svg" alt="" width={24} height={24} />{balance} / {minimum} minimum</p>
            <div className="mt-3 flex flex-wrap gap-2" aria-hidden="true">{Array.from({ length: Math.min(12, minimum) }, (_, i) => <img key={i} src={`/survivor/exile/${i < balance ? 'token-coin' : 'token-empty'}.svg`} alt="" width={48} height={48} />)}{minimum > 12 && <span className="self-center text-sm">{balance} of {minimum}</span>}</div>
            <progress value={Math.min(balance, minimum)} max={Math.max(1, minimum)} aria-label="Progress toward token minimum" className="mt-3 h-2 w-full accent-amber-300" />
            <p className="mt-2 text-sm text-white/65">{rules.resolved ? 'The return deadline has passed.' : !rules.enabled ? 'These tokens do not qualify for a return.' : needed > 0 ? `${needed} more ${needed === 1 ? 'token' : 'tokens'} needed to reach the minimum. The return spot is decided at the deadline.` : 'Minimum reached. You must still lead the qualifying balances at the deadline.'}</p></> : <p className="mt-3 text-sm text-white/50">Your token wallet becomes available when you enter Exile.</p>}
        </>}
      </div>
    </div>
  </section>
}
