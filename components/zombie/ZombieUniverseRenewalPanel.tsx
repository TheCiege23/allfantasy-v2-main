'use client'
import { useState } from 'react'
type Placement = { userId: string; rosterId: string; displayName: string; destinationLeagueId: string; destinationLevelId: string; slot: number; movement: string; nextFaab: number; faabRule: string }
type Result = { nextSeason: number; leagues: Array<{ previousLeagueId: string; leagueId: string; draftId: string }> }
type Preview = { completed: boolean; result?: Result; season: number; nextSeason: number; previewHash: string;
  pools: Array<{ leagueId: string; name: string; levelId: string }>; assignments: Placement[] }
export function ZombieUniverseRenewalPanel({ universeId, season }: { universeId: string; season: number }) {
  const [preview,setPreview]=useState<Preview|null>(null),[result,setResult]=useState<Result|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reviewed,setReviewed]=useState(false)
  async function request(execute: boolean) {
    setBusy(true);setError('')
    try {
      const path='/api/zombie-universe/'+encodeURIComponent(universeId)+'/renew'
      const res=await fetch(execute?path:path+'?season='+season,{
        method: execute?'POST':'GET', credentials:'include', cache:'no-store',
        ...(execute?{headers:{'Content-Type':'application/json'},body:JSON.stringify({season,previewHash:preview?.previewHash})}:{}),
      })
      const data=await res.json()
      if(!res.ok) { if(execute){setPreview(null);setReviewed(false)}; throw new Error(data.error || 'Could not prepare next season.') }
      if(execute) {setResult(data);setPreview(null)}
      else if(data.completed) {setResult(data.result);setPreview(null)}
      else {setPreview(data);setReviewed(false)}
    } catch(e) {setError(e instanceof Error?e.message:'Request failed.')}
    finally {setBusy(false)}
  }
  return <section className="rounded-2xl border border-emerald-500/25 bg-emerald-950/20 p-4 text-sm text-white/85" aria-label="Zombie season renewal">
    <h2 className="font-bold text-emerald-100">Prepare season {season+1}</h2>
    <p className="mt-2 text-xs leading-relaxed text-white/65">Review every manager’s next league before creating the season. Completed results, roles, items and prizes stay in their original leagues. New rosters start empty, items and prizes start fresh, and drafts stay unstarted. FAAB follows the destination league’s rollover setting. The universe commissioner manages the new leagues; Whisperers are selected after each draft.</p>
    {!result && <button type="button" className="mt-3 min-h-[44px] rounded-lg border border-emerald-400/40 px-4 font-semibold disabled:opacity-50" disabled={busy} onClick={()=>void request(false)}>
      {busy?'Preparing…':'Preview next season'}
    </button>}
    {error && <p role="alert" className="mt-3 text-amber-200">{error}</p>}
    {preview && <div className="mt-4 space-y-3">
      <p className="font-semibold">{preview.assignments.length} managers · {preview.pools.length} leagues · Season {preview.nextSeason}</p>
      {preview.pools.map(pool=><div key={pool.leagueId} className="rounded-xl border border-white/10 p-3">
        <h3 className="break-words font-semibold">{pool.name}</h3>
        <ul className="mt-2 space-y-2 text-xs">{preview.assignments.filter(m=>m.destinationLeagueId===pool.leagueId).map(m=>
          <li key={m.rosterId} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words">{m.slot}. {m.displayName}<span className="ml-2 text-white/50">FAAB {m.nextFaab} · {m.faabRule==='carry_over'?'Carry over':'Reset'}</span></span>
            <span className={m.movement==='promotion'?'text-emerald-200':m.movement==='relegation'?'text-rose-200':'text-white/55'}>
              {m.movement==='watch'?'Same level':m.movement==='promotion'?'Promoted':'Relegated'}
            </span>
          </li>)}</ul>
      </div>)}
      <label className="flex min-h-[44px] items-center gap-3 text-xs"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} className="h-5 w-5 shrink-0" />I reviewed the placements and the fresh-season resets.</label>
      <button type="button" disabled={busy||!reviewed} onClick={()=>void request(true)} className="min-h-[44px] w-full rounded-lg bg-emerald-700 px-4 font-semibold disabled:opacity-50">
        {busy?'Creating next season…':'Create season '+preview.nextSeason}
      </button>
    </div>}
    {result && <div role="status" className="mt-4 space-y-2">
      <p className="font-semibold text-emerald-200">Season {result.nextSeason} is ready.</p>
      {result.leagues.map((l,i)=><a key={l.leagueId} className="flex min-h-[44px] items-center rounded-lg border border-white/15 px-3 underline" href={'/league/'+encodeURIComponent(l.leagueId)+'/draft'}>Open next-season draft {i+1}</a>)}
    </div>}
  </section>
}
