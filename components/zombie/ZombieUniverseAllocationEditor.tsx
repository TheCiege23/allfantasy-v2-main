'use client'
import { useEffect,useRef,useState } from 'react'
import { ClipboardCheck, Plus, RotateCcw, Save, Search, Trash2 } from 'lucide-react'
import { RenewalCapacity, RenewalSummary, RenewalTierBadge, renewalControl } from './ZombieRenewalVisuals'
import type { UniverseRenewalProposal } from '@/lib/zombie/reviewedUniverseRenewal'
type EditorData={
  completed:boolean;managers:Array<{userId:string;displayName:string;leagueId:string;levelId:string}>;
  pools:Array<{leagueId:string;levelId:string;name:string;seats:number}>;
  levels:Array<{id:string;name:string;maxLeagues:number}>;savedProposal:UniverseRenewalProposal|null;recordedMovementCount:number
}
const input='min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/20 bg-slate-950 px-3 text-base text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300'
export function ZombieUniverseAllocationEditor({universeId,season,onInvalidate,onPreview}:{
  universeId:string;season:number;onInvalidate:()=>void;onPreview:(data:unknown,proposal:UniverseRenewalProposal)=>void
}) {
  const [data,setData]=useState<EditorData|null>(null),[proposal,setProposal]=useState<UniverseRenewalProposal|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[hash,setHash]=useState<string|null>(null)
  const [search,setSearch]=useState(''),[page,setPage]=useState(0)
  const active=useRef(true)
  const path='/api/zombie-universe/'+encodeURIComponent(universeId)+'/renew'
  useEffect(()=>{
    active.current=true
    const controller=new AbortController();setBusy(true);setError('');setData(null);setProposal(null);setHash(null)
    void fetch('/api/zombie-universe/'+encodeURIComponent(universeId)+'/renew?editor=1&season='+season,{credentials:'include',cache:'no-store',signal:controller.signal}).then(async res=>{
      const value=await res.json()
      if(!res.ok)throw new Error(value.error||'Could not load the season.')
      if(value.completed)throw new Error('This season is already renewed. Open its existing next-season drafts.')
      if(controller.signal.aborted)return
      const loaded=value as EditorData
      setData(loaded)
      setProposal({version:1,reason:'',replaceRecordedMovement:false,
        pools:loaded.pools.map(p=>({key:p.leagueId,templateLeagueId:p.leagueId,levelId:p.levelId,name:p.name.slice(0,80),seats:p.seats})),
        placements:loaded.managers.map(m=>({userId:m.userId,poolId:m.leagueId}))})
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load the season.')})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false)})
    return ()=>{active.current=false;controller.abort()}
  },[universeId,season])
  function edit(next:UniverseRenewalProposal){setProposal(next);setHash(null);setMessage('');setError('');onInvalidate()}
  async function submit(save:boolean){
    if(!proposal)return
    if(!save)onInvalidate()
    setBusy(true);setError('');setMessage('')
    try {
      const res=await fetch(path,{method:save?'PUT':'PATCH',credentials:'include',cache:'no-store',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({season,proposal,...(save?{previewHash:hash}:{})})})
      const value=await res.json()
      if(!active.current)return
      if(!res.ok){setHash(null);onInvalidate();throw new Error(value.error||'Could not review the proposal.')}
      if(save)setMessage('Review draft saved. Restore it here after reopening; no leagues have been created.')
      else if(value.completed){setHash(null);onPreview(value,proposal)}
      else {setHash(value.previewHash);onPreview(value,proposal);setMessage('Preview updated. Review every destination and open seat before creating the season.')}
    }catch(e){setError(e instanceof Error?e.message:'Request failed.')}
    finally{setBusy(false)}
  }
  if(!data||!proposal)return <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-slate-950/60 p-5 text-slate-200" aria-busy={busy}>{busy?<p>Loading completed-season placements…</p>:<p role="alert" className="text-amber-200">{error}</p>}</div>
  const counts=new Map(proposal.pools.map(p=>[p.key,proposal.placements.filter(m=>m.poolId===p.key).length]))
  const total=proposal.pools.reduce((n,p)=>n+p.seats,0),unassigned=proposal.placements.filter(p=>!proposal.pools.some(pool=>pool.key===p.poolId)).length
  const filtered=data.managers.filter(m=>m.displayName.toLowerCase().includes(search.toLowerCase()))
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/25)-1)),shown=filtered.slice(currentPage*25,currentPage*25+25)
  return <fieldset disabled={busy} aria-busy={busy} className="mt-6 min-w-0 space-y-5 rounded-2xl border border-cyan-400/25 bg-slate-950/40 p-3 sm:p-5">
    <legend className="px-2 text-base font-semibold text-cyan-100">Next-season placement and capacity plan</legend>
    <p className="max-w-3xl text-sm leading-relaxed text-slate-300">Set the field for the next outbreak. Give every returning manager one destination, then preview the complete plan before approval.</p>
    <RenewalSummary managers={data.managers.length} leagues={proposal.pools.length} openSeats={Math.max(0,total-data.managers.length)} unassigned={unassigned} />
    <p className="text-xs leading-relaxed text-slate-300">{total} total seats. Added capacity stays open and must be filled before that draft starts. Completed leagues and results stay archived.</p>
    {data.savedProposal&&<button type="button" className={renewalControl+' inline-flex items-center gap-2'} onClick={()=>edit(data.savedProposal!)}><RotateCcw aria-hidden="true" className="h-4 w-4 shrink-0" />Restore saved review draft</button>}
    <div className="space-y-3">
      <div><h3 className="text-base font-semibold text-white">1. Build your destination leagues</h3><p className="mt-1 text-xs leading-relaxed text-slate-300">Choose a tier, capacity and completed league to copy rules from.</p></div>
      {proposal.pools.map((p,i)=><details key={p.key} open className="group min-w-0 rounded-2xl border border-white/15 bg-slate-900/70 p-3 sm:p-4">
        <summary className="min-h-[44px] cursor-pointer rounded-lg text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
          <span className="ml-1 break-words text-base font-semibold text-white">{p.name}</span>
          <span className="ml-2 text-xs">{counts.get(p.key)||0}/{p.seats} returning managers</span>
        </summary>
        <div className="mb-4 mt-1 flex flex-wrap items-center justify-between gap-2"><RenewalTierBadge name={data.levels.find(l=>l.id===p.levelId)?.name||'Universe tier'} /><span className="text-xs text-slate-400">Season {season+1} destination</span></div>
        <RenewalCapacity assigned={counts.get(p.key)||0} seats={p.seats} />
        <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0 space-y-1.5 text-xs font-medium text-slate-300">Next-season name<input value={p.name} maxLength={80} className={input} onChange={e=>edit({...proposal,pools:proposal.pools.map((x,n)=>n===i?{...x,name:e.target.value}:x)})}/></label>
          <label className="min-w-0 space-y-1.5 text-xs font-medium text-slate-300">Level<select className={input} value={p.levelId} onChange={e=>edit({...proposal,pools:proposal.pools.map((x,n)=>n===i?{...x,levelId:e.target.value}:x)})}>{data.levels.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="min-w-0 space-y-1.5 text-xs font-medium text-slate-300">Seats<select className={input} value={p.seats} onChange={e=>edit({...proposal,pools:proposal.pools.map((x,n)=>n===i?{...x,seats:Number(e.target.value)}:x)})}>{[8,10,12,14,16].map(n=><option key={n}>{n}</option>)}</select></label>
          <label className="min-w-0 space-y-1.5 text-xs font-medium text-slate-300">Copy rules from<select className={input} value={p.templateLeagueId} onChange={e=>edit({...proposal,pools:proposal.pools.map((x,n)=>n===i?{...x,templateLeagueId:e.target.value}:x)})}>{data.pools.map(t=><option key={t.leagueId} value={t.leagueId}>{t.name}</option>)}</select></label>
        </div>
        <button type="button" disabled={proposal.pools.length===1} className={renewalControl+' mt-3 inline-flex items-center gap-2 border-rose-400/25 text-sm text-rose-200'} onClick={()=>edit({...proposal,pools:proposal.pools.filter(x=>x.key!==p.key),placements:proposal.placements.map(m=>m.poolId===p.key?{...m,poolId:''}:m)})}><Trash2 aria-hidden="true" className="h-4 w-4 shrink-0" />Remove next-season league</button>
      </details>)}
    </div>
    <button type="button" disabled={proposal.pools.length>=24} className={renewalControl+' inline-flex items-center gap-2 text-sm'} onClick={()=>edit({...proposal,pools:[...proposal.pools,{key:'next-'+crypto.randomUUID(),templateLeagueId:data.pools[0].leagueId,levelId:data.levels[0].id,name:'New Zombie League',seats:8}]})}><Plus aria-hidden="true" className="h-4 w-4 shrink-0" />Add next-season league</button>
    <div className="space-y-3 border-t border-white/10 pt-5">
      <div><h3 className="text-base font-semibold text-white">2. Place every returning manager</h3><p className="mt-1 text-xs leading-relaxed text-slate-300">Source leagues are shown below each name. Changes update the capacity cards above.</p></div>
      <label className="block space-y-1.5 text-xs font-medium text-slate-300">Find a returning manager<span className="relative block"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input type="search" className={input+' pl-10'} value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}}/></span></label>
      <div className="space-y-2">{shown.map(m=><label key={m.userId} className="grid min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-3 text-sm sm:grid-cols-2">
        <span className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-xs font-semibold text-cyan-100">{m.displayName.trim().slice(0,2).toUpperCase()}</span><span className="min-w-0 break-words font-medium text-white">{m.displayName}<span className="mt-1 block text-xs font-normal text-slate-400">From {data.pools.find(p=>p.leagueId===m.leagueId)?.name}</span></span></span>
        <select aria-label={'Destination for '+m.displayName} className={input} value={proposal.placements.find(p=>p.userId===m.userId)?.poolId||''} onChange={e=>edit({...proposal,placements:proposal.placements.map(p=>p.userId===m.userId?{...p,poolId:e.target.value}:p)})}>
          <option value="">Choose a destination</option>{proposal.pools.map(p=><option key={p.key} value={p.key}>{p.name} ({counts.get(p.key)||0}/{p.seats})</option>)}
        </select>
      </label>)}</div>
      {filtered.length===0&&<p role="status" className="rounded-xl border border-dashed border-white/20 p-5 text-center text-sm text-slate-300">No returning managers match your search.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <button type="button" disabled={currentPage===0} className={renewalControl} onClick={()=>setPage(currentPage-1)}>Previous managers</button>
        <span className="text-slate-300 tabular-nums">{filtered.length?currentPage*25+1:0}–{Math.min((currentPage+1)*25,filtered.length)} of {filtered.length}</span>
        <button type="button" disabled={(currentPage+1)*25>=filtered.length} className={renewalControl} onClick={()=>setPage(currentPage+1)}>Next managers</button>
      </div>
    </div>
    <div className="space-y-3 border-t border-white/10 pt-5">
      <h3 className="text-base font-semibold text-white">3. Explain and preview your plan</h3>
      <label className="block space-y-1.5 text-xs font-medium text-slate-300">Reason for these placements and capacity changes<textarea className={input+' py-3'} value={proposal.reason} minLength={10} maxLength={1000} rows={3} onChange={e=>edit({...proposal,reason:e.target.value})}/></label>
      <p className="text-xs text-slate-400">10–1,000 characters. Your reason stays with the audit record.</p>
      {data.recordedMovementCount>0&&<label className="flex min-h-[44px] items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-sm leading-relaxed text-amber-100">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-cyan-300" checked={proposal.replaceRecordedMovement} onChange={e=>edit({...proposal,replaceRecordedMovement:e.target.checked})}/>
        I approve replacing recorded movement if this proposal differs. Original allocations and my reason will be retained in the audit trail.
      </label>}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className={renewalControl+' inline-flex items-center justify-center gap-2 border-cyan-300/40 bg-cyan-300/15 text-cyan-100'} onClick={()=>void submit(false)}><ClipboardCheck aria-hidden="true" className="h-4 w-4 shrink-0" />{busy?'Reviewing…':'Preview this proposal'}</button>
        <button type="button" disabled={!hash} className={renewalControl+' inline-flex items-center justify-center gap-2'} onClick={()=>void submit(true)}><Save aria-hidden="true" className="h-4 w-4 shrink-0" />Save review draft</button>
      </div>
      {error&&<p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">{error}</p>}
      {message&&<p role="status" className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">{message}</p>}
      <p className="text-xs leading-relaxed text-slate-400">Edits invalidate the previous preview. Saving a review draft does not create a season. Review and create the season below after previewing.</p>
    </div>
  </fieldset>
}
