'use client'
import { useEffect,useState } from 'react'
import type { ZombieReadinessReport } from '@/lib/zombie/readiness'
export function ZombieReadinessPanel({leagueId,universeId}:{leagueId?:string;universeId?:string}) {
  const [report,setReport]=useState<ZombieReadinessReport|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0)
  useEffect(()=>{
    const controller=new AbortController()
    setBusy(true);setError('');setReport(null)
    const query=universeId?'universeId='+encodeURIComponent(universeId):'leagueId='+encodeURIComponent(leagueId||'')
    void fetch('/api/zombie/readiness?'+query,{credentials:'include',cache:'no-store',signal:controller.signal}).then(async res=>{
      const data=await res.json()
      if(!res.ok) throw new Error(data.error||'Could not load readiness.')
      if(!controller.signal.aborted) setReport(data)
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Readiness failed.')})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false)})
    return ()=>controller.abort()
  },[leagueId,universeId,revision])
  return <section aria-label="Zombie commissioner readiness" className="rounded-2xl border border-cyan-500/25 bg-slate-950/60 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold text-cyan-100">Survival readiness</h2>
      <button type="button" disabled={busy} onClick={()=>setRevision(v=>v+1)} className="min-h-[44px] rounded-lg border border-white/20 px-4 disabled:opacity-50">{busy?'Checking…':'Refresh checks'}</button></div>
    <p className="mt-2 text-xs text-white/65">Saved league checks help prepare the next step. Live scoring and physical-device acceptance need their own rehearsal. Survivors and Whisperers may trade; Zombies cannot.</p>
    {error&&<p role="alert" className="mt-3 text-amber-200">{error}</p>}
    {report&&<div aria-live="polite" className="mt-3 space-y-4">
      <p className="text-xs text-white/50">Checked {new Date(report.checkedAt).toLocaleString()}</p>
      {report.leagues.length===0&&<p>No leagues are linked to this universe yet.</p>}
      {report.leagues.map(l=><article key={l.leagueId} className="space-y-2">
        <h3 className="break-words font-semibold">{l.name} · {l.sport} {l.season}</h3>
        <ul className="grid gap-2 sm:grid-cols-2">{l.checks.map(c=><li key={c.id} className="min-w-0 rounded-xl border border-white/10 p-3">
          <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{c.label}</span>
          <span className={c.status==='ready'?'text-emerald-200':c.status==='attention'?'text-amber-200':'text-white/55'}>{c.status==='ready'?'Checked':c.status==='attention'?'Needs review':c.status==='waiting'?'Waiting':'Not verified'}</span></div>
          <p className="mt-1 break-words text-xs leading-relaxed text-white/65">{c.detail}</p>
          {c.href&&<a href={c.href} className="mt-2 inline-flex min-h-[44px] items-center underline">Open {c.id==='draft'||c.id==='pool'||c.id==='coverage'?'draft':'league'}</a>}
        </li>)}</ul></article>)}
    </div>}
  </section>
}
