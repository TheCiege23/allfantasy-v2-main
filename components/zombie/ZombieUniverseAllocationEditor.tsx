'use client'
import { useEffect,useRef,useState } from 'react'
import type { UniverseRenewalProposal } from '@/lib/zombie/reviewedUniverseRenewal'
type EditorData={
  completed:boolean;managers:Array<{userId:string;displayName:string;leagueId:string;levelId:string}>;
  pools:Array<{leagueId:string;levelId:string;name:string;seats:number}>;
  levels:Array<{id:string;name:string;maxLeagues:number}>;savedProposal:UniverseRenewalProposal|null;recordedMovementCount:number
}
const input='min-h-[44px] w-full min-w-0 rounded-lg border border-white/20 bg-slate-950 px-3 text-base text-white'
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
      else {setHash(value.previewHash);onPreview(value,proposal);setMessage('Preview updated. Review every destination and open seat before creating the season.')}
    }catch(e){setError(e instanceof Error?e.message:'Request failed.')}
    finally{setBusy(false)}
  }
  if(!data||!proposal)return <div className="mt-4 rounded-xl border border-white/15 p-3">{busy?<p>Loading completed-season placements…</p>:<p role="alert" className="text-amber-200">{error}</p>}</div>
  const counts=new Map(proposal.pools.map(p=>[p.key,proposal.placements.filter(m=>m.poolId===p.key).length]))
  const total=proposal.pools.reduce((n,p)=>n+p.seats,0),unassigned=proposal.placements.filter(p=>!proposal.pools.some(pool=>pool.key===p.poolId)).length
  const filtered=data.managers.filter(m=>m.displayName.toLowerCase().includes(search.toLowerCase()))
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/25)-1)),shown=filtered.slice(currentPage*25,currentPage*25+25)
  return <fieldset disabled={busy} className="mt-4 min-w-0 space-y-4 rounded-xl border border-cyan-400/25 p-3">
    <legend className="px-1 font-semibold text-cyan-100">Next-season placement and capacity plan</legend>
    <p className="text-xs leading-relaxed text-white/65">Every returning manager must have one destination. Choose the prior league whose rules each destination copies. Added capacity stays open and must be filled before that draft starts. Past leagues and season results stay archived.</p>
    <p className="font-semibold">{data.managers.length} returning managers · {total} seats · {Math.max(0,total-data.managers.length)} open seats · {unassigned} unassigned</p>
    {data.savedProposal&&<button type="button" className="min-h-[44px] rounded-lg border border-white/20 px-3" onClick={()=>edit(data.savedProposal!)}>Restore saved review draft</button>}
    <div className="space-y-2">{proposal.pools.map((p,i)=><details key={p.key} open className="rounded-lg border border-white/15 p-3">
      <summary className="min-h-[44px] cursor-pointer break-words font-semibold">{p.name} · {counts.get(p.key)||0}/{p.seats} returning managers</summary>
      <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs">Next-season name<input value={p.name} maxLength={80} className={input} onChange={e=>edit({...proposal,pools:proposal.pools.map((x,n)=>n===i?{...x,name:e.target.value}:x)})}/></label>
        <label className="space-y-1 text-xs">Level<select className={input} value={p.levelId} onChange={e=>edit({...proposal,pools:proposal.pools.map((x,n)=>n===i?{...x,levelId:e.target.value}:x)})}>{data.levels.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="space-y-1 text-xs">Seats<select className={input} value={p.seats} onChange={e=>edit({...proposal,pools:proposal.pools.map((x,n)=>n===i?{...x,seats:Number(e.target.value)}:x)})}>{[8,10,12,14,16].map(n=><option key={n}>{n}</option>)}</select></label>
        <label className="space-y-1 text-xs">Copy rules from<select className={input} value={p.templateLeagueId} onChange={e=>edit({...proposal,pools:proposal.pools.map((x,n)=>n===i?{...x,templateLeagueId:e.target.value}:x)})}>{data.pools.map(t=><option key={t.leagueId} value={t.leagueId}>{t.name}</option>)}</select></label>
      </div>
      <button type="button" disabled={proposal.pools.length===1} className="mt-2 min-h-[44px] rounded-lg border border-rose-400/30 px-3 text-rose-200 disabled:opacity-40" onClick={()=>edit({...proposal,pools:proposal.pools.filter(x=>x.key!==p.key),placements:proposal.placements.map(m=>m.poolId===p.key?{...m,poolId:''}:m)})}>Remove next-season league</button>
    </details>)}</div>
    <button type="button" disabled={proposal.pools.length>=24} className="min-h-[44px] rounded-lg border border-white/20 px-3 disabled:opacity-40" onClick={()=>edit({...proposal,pools:[...proposal.pools,{key:'next-'+crypto.randomUUID(),templateLeagueId:data.pools[0].leagueId,levelId:data.levels[0].id,name:'New Zombie League',seats:8}]})}>Add next-season league</button>
    <label className="block space-y-1 text-xs">Find a returning manager<input type="search" className={input} value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}}/></label>
    <div className="space-y-2">{shown.map(m=><label key={m.userId} className="grid min-w-0 gap-2 rounded-lg border border-white/10 p-3 text-xs sm:grid-cols-2">
      <span className="break-words">{m.displayName}<span className="mt-1 block text-white/50">From {data.pools.find(p=>p.leagueId===m.leagueId)?.name}</span></span>
      <select aria-label={'Destination for '+m.displayName} className={input} value={proposal.placements.find(p=>p.userId===m.userId)?.poolId||''} onChange={e=>edit({...proposal,placements:proposal.placements.map(p=>p.userId===m.userId?{...p,poolId:e.target.value}:p)})}>
        <option value="">Choose a destination</option>{proposal.pools.map(p=><option key={p.key} value={p.key}>{p.name} ({counts.get(p.key)||0}/{p.seats})</option>)}
      </select>
    </label>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <button type="button" disabled={currentPage===0} className="min-h-[44px] rounded-lg border border-white/20 px-3 disabled:opacity-40" onClick={()=>setPage(currentPage-1)}>Previous managers</button>
      <span>{filtered.length?currentPage*25+1:0}–{Math.min((currentPage+1)*25,filtered.length)} of {filtered.length}</span>
      <button type="button" disabled={(currentPage+1)*25>=filtered.length} className="min-h-[44px] rounded-lg border border-white/20 px-3 disabled:opacity-40" onClick={()=>setPage(currentPage+1)}>Next managers</button>
    </div>
    <label className="block space-y-1 text-xs">Reason for these placements and capacity changes<textarea className={input+' py-2'} value={proposal.reason} minLength={10} maxLength={1000} rows={3} onChange={e=>edit({...proposal,reason:e.target.value})}/></label>
    {data.recordedMovementCount>0&&<label className="flex min-h-[44px] items-start gap-3 text-xs leading-relaxed">
      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={proposal.replaceRecordedMovement} onChange={e=>edit({...proposal,replaceRecordedMovement:e.target.checked})}/>
      I approve replacing recorded movement if this proposal differs. Original allocations and my reason will be retained in the audit trail.
    </label>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="min-h-[44px] rounded-lg bg-cyan-800 px-4 font-semibold" onClick={()=>void submit(false)}>{busy?'Reviewing…':'Preview this proposal'}</button>
      <button type="button" disabled={!hash} className="min-h-[44px] rounded-lg border border-white/20 px-4 disabled:opacity-40" onClick={()=>void submit(true)}>Save review draft</button>
    </div>
    {error&&<p role="alert" className="text-amber-200">{error}</p>}
    {message&&<p role="status" className="text-emerald-200">{message}</p>}
    <p className="text-xs text-white/50">Edits invalidate the previous preview. Saving a review draft does not create a season.</p>
  </fieldset>
}
