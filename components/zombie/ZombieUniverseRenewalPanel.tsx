'use client'
import { useState } from 'react'
import './zombie-universe-theme.css'
import { Archive, ArrowDownRight, ArrowRight, ArrowUpRight, Biohazard, Check, CheckCircle2, ClipboardCheck, Flag, ShieldCheck, Wallet } from 'lucide-react'
import { RenewalCapacity, RenewalSummary, renewalControl } from './ZombieRenewalVisuals'
import { ZombieUniverseAllocationEditor } from './ZombieUniverseAllocationEditor'
import type { UniverseRenewalProposal } from '@/lib/zombie/reviewedUniverseRenewal'
type Placement = { userId: string; rosterId: string; displayName: string; destinationLeagueId: string; destinationLevelId: string; slot: number; movement: string; nextFaab: number; faabRule: string }
type Result = { nextSeason: number; leagues: Array<{ previousLeagueId: string; leagueId: string; draftId: string; name?: string }> }
type Preview = { completed: boolean; result?: Result; season: number; nextSeason: number; previewHash: string;
  pools: Array<{ leagueId: string; name: string; levelId: string; seats: number }>; openSeats?: number; assignments: Placement[] }
export function ZombieUniverseRenewalPanel({ universeId, leagueId, season }: { universeId?: string; leagueId?: string; season: number }) {
  const [preview,setPreview]=useState<Preview|null>(null),[result,setResult]=useState<Result|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reviewed,setReviewed]=useState(false)
  const [editing,setEditing]=useState(false),[proposal,setProposal]=useState<UniverseRenewalProposal|undefined>()
  function invalidate() {setPreview(null);setReviewed(false);setProposal(undefined);setError('')}
  async function request(execute: boolean) {
    setBusy(true);setError('')
    try {
      const path=universeId ? '/api/zombie-universe/'+encodeURIComponent(universeId)+'/renew' : '/api/zombie/league/'+encodeURIComponent(leagueId || '')+'/renew'
      const res=await fetch(execute?path:path+'?season='+season,{
        method: execute?'POST':'GET', credentials:'include', cache:'no-store',
        ...(execute?{headers:{'Content-Type':'application/json'},body:JSON.stringify({season,previewHash:preview?.previewHash,...(proposal?{proposal}:{})})}:{}),
      })
      const data=await res.json()
      if(!res.ok) { if(execute){setPreview(null);setReviewed(false)}; throw new Error(data.error || 'Could not prepare next season.') }
      if(execute) {setResult(data);setPreview(null)}
      else if(data.completed) {setResult(data.result);setPreview(null)}
      else {setPreview(data);setReviewed(false);setProposal(undefined)}
    } catch(e) {setError(e instanceof Error?e.message:'Request failed.')}
    finally {setBusy(false)}
  }
  return <section className="zombie-renewal-shell min-w-0 overflow-hidden rounded-3xl border border-emerald-400/25 bg-gradient-to-br from-emerald-950/60 via-slate-950 to-slate-950 text-sm text-slate-200 shadow-[0_0_32px_rgba(16,185,129,0.07)]" aria-label="Zombie season renewal" aria-busy={busy}>
    <div className="zombie-renewal-header border-b border-emerald-300/15 bg-emerald-300/[0.04] p-4 sm:p-6">
      <div className="flex min-w-0 items-start gap-3 sm:gap-4">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-200"><Biohazard className="h-6 w-6" /></span>
        <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">Zombie command · Season renewal</p><h2 className="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Prepare season {season+1}</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">Your next outbreak starts here. Review the returning field, shape the leagues, and approve a fresh season.</p></div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full border border-white/15 bg-slate-950/60 px-3 py-1.5 text-slate-300">{season} · Archived after completion</span><ArrowRight aria-hidden="true" className="h-4 w-4 text-emerald-200" /><span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 font-semibold text-emerald-100">{season+1} · Fresh season</span></div>
      <ol aria-label="Renewal progress" className="zombie-renewal-progress mt-5 grid grid-cols-3 gap-2">
        {['Plan','Review','Create'].map((label,i)=>{const step=result?2:preview?1:0;return <li key={label} aria-current={step===i?'step':undefined} className={'flex min-w-0 flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium '+(step===i?'border-emerald-300/35 bg-emerald-300/10 text-emerald-100':'border-white/10 text-slate-400')}><span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[11px]">{step>i?<Check className="h-3 w-3" />:i+1}</span>{label}</li>})}
      </ol>
    </div>
    <div className="min-w-0 space-y-5 p-4 sm:p-6">
      <details className="rounded-2xl border border-white/10 bg-slate-900/50 p-3 sm:p-4">
        <summary className="min-h-[44px] cursor-pointer rounded-lg py-3 font-semibold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">What carries forward and what resets</summary>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">Available after the season and every weekly settlement finish. Review every manager’s next league before creating the season.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-2 rounded-xl bg-slate-950/70 p-3"><Archive aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" /><p className="text-xs leading-relaxed"><strong className="block font-semibold text-white">Completed season preserved</strong><span className="text-slate-300">Results, roles, items and prizes stay in their original leagues.</span></p></div>
          <div className="flex items-start gap-2 rounded-xl bg-slate-950/70 p-3"><Flag aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" /><p className="text-xs leading-relaxed"><strong className="block font-semibold text-white">A fresh field</strong><span className="text-slate-300">Empty rosters, fresh items and prizes. Drafts stay unstarted; Whisperers are selected after each draft.</span></p></div>
          <div className="flex items-start gap-2 rounded-xl bg-slate-950/70 p-3"><Wallet aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" /><p className="text-xs leading-relaxed"><strong className="block font-semibold text-white">FAAB follows destination rules</strong><span className="text-slate-300">Each manager’s reset or carry-over budget appears in the preview.</span></p></div>
          <div className="flex items-start gap-2 rounded-xl bg-slate-950/70 p-3"><ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" /><p className="text-xs leading-relaxed"><strong className="block font-semibold text-white">Commissioner stays in control</strong><span className="text-slate-300">Review placements before creation. The commissioner manages the new leagues.</span></p></div>
        </div>
      </details>
      {!result&&<div className="grid gap-2 sm:flex sm:flex-wrap">
        {!editing&&<button type="button" className={renewalControl+' inline-flex items-center justify-center gap-2 border-emerald-300/35 bg-emerald-300/10 text-emerald-100'} disabled={busy} onClick={()=>void request(false)}><ClipboardCheck aria-hidden="true" className="h-4 w-4 shrink-0" />{busy?'Preparing…':'Preview next season'}</button>}
        {universeId&&<button type="button" disabled={busy} aria-expanded={editing} onClick={()=>{invalidate();setEditing(!editing)}} className={renewalControl}>{editing?'Close placement editor':'Edit placements and capacity'}</button>}
      </div>}
      {universeId && editing && !result && <fieldset className="min-w-0" disabled={busy}><ZombieUniverseAllocationEditor universeId={universeId} season={season} onInvalidate={invalidate} onPreview={(data,accepted)=>{const value=data as Preview;if(value.completed&&value.result){setResult(value.result);setPreview(null);setEditing(false)}else{setPreview(value)}setProposal(accepted);setReviewed(false);setError('')}} /></fieldset>}
      {error && <p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-amber-100">{error}</p>}
      {preview && <div className="space-y-4 border-t border-white/10 pt-5">
        <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">Review before creation</p><h3 className="mt-1 text-lg font-semibold text-white">Your season {preview.nextSeason} field</h3><p className="mt-1 text-xs leading-relaxed text-slate-300">Check every destination and budget. Open seats must be filled before a draft can start.</p></div>
        <RenewalSummary managers={preview.assignments.length} leagues={preview.pools.length} openSeats={preview.openSeats??0} />
        <div className="grid min-w-0 items-start gap-3 xl:grid-cols-2">{preview.pools.map(pool=>{const managers=preview.assignments.filter(m=>m.destinationLeagueId===pool.leagueId);return <div key={pool.leagueId} className="min-w-0 rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-3 sm:p-4">
          <h4 className="mb-3 break-words text-base font-semibold text-white">{pool.name} · {pool.seats} seats</h4>
          <RenewalCapacity assigned={managers.length} seats={pool.seats} />
          <ul className="mt-4 divide-y divide-white/10 text-sm">{managers.map(m=>{const MovementIcon=m.movement==='promotion'?ArrowUpRight:m.movement==='relegation'?ArrowDownRight:ArrowRight;return <li key={m.rosterId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3">
            <span className="min-w-0 break-words font-medium text-slate-100">{m.slot}. {m.displayName}<span className="mt-1 block text-xs font-normal text-slate-400">FAAB {m.nextFaab} · {m.faabRule==='carry_over'?'Carry over':'Reset'}</span></span>
            <span className={'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs '+(m.movement==='promotion'?'border-emerald-300/25 bg-emerald-300/10 text-emerald-100':m.movement==='relegation'?'border-rose-300/25 bg-rose-300/10 text-rose-100':'border-white/15 bg-white/5 text-slate-300')}><MovementIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />{m.movement==='watch'?(universeId?'Same level':'Returning manager'):m.movement==='promotion'?'Promoted':'Relegated'}</span>
          </li>})}</ul>
        </div>})}</div>
        <div className="space-y-3 rounded-2xl border border-emerald-300/25 bg-emerald-300/5 p-3 sm:p-4">
          <label className="flex min-h-[44px] cursor-pointer items-start gap-3 text-sm leading-relaxed text-slate-100"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300" />I reviewed the placements and the fresh-season resets.</label>
          <button type="button" disabled={busy||!reviewed} onClick={()=>void request(true)} className={renewalControl+' inline-flex w-full items-center justify-center gap-2 border-emerald-300/40 bg-emerald-300/15 text-emerald-100'}><ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0" />{busy?'Creating next season…':'Create season '+preview.nextSeason}</button>
          <p className="text-xs leading-relaxed text-slate-300">Creation makes separate next-season leagues. It keeps the completed season’s history intact.</p>
        </div>
      </div>}
      {result && <div role="status" className="space-y-3 rounded-2xl border border-emerald-300/30 bg-emerald-300/10 p-4">
        <div className="flex items-start gap-3"><CheckCircle2 aria-hidden="true" className="h-6 w-6 shrink-0 text-emerald-200" /><div><h3 className="text-lg font-semibold text-emerald-100">Season {result.nextSeason} is ready.</h3><p className="mt-1 text-xs leading-relaxed text-slate-300">Open a destination draft to prepare the next season.</p></div></div>
        {result.leagues.map((l,i)=><a key={l.leagueId} className={renewalControl+' flex min-w-0 items-center justify-between gap-3 bg-slate-950/50 py-3'} href={'/league/'+encodeURIComponent(l.leagueId)+'/draft'}><span className="min-w-0 break-words">{l.name || 'Open next-season draft '+(i+1)}</span><ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-200" /></a>)}
      </div>}
    </div>
  </section>
}
