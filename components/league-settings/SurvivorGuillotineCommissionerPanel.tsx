'use client'
import {useEffect,useState} from 'react'
import {SG_ACTIONS,sgAdvancedDefaults,type SGCommissionerRules} from '@/lib/survivor-guillotine/commissionerRules'
import type {loadSGCommissioner} from '@/lib/survivor-guillotine/commissionerService'
type Data=Awaited<ReturnType<typeof loadSGCommissioner>>
export function SurvivorGuillotineCommissionerPanel({leagueId}:{leagueId:string}){
 const [data,setData]=useState<Data|null>(null),[rules,setRules]=useState<SGCommissionerRules|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false)
 const url=`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/survivor-guillotine-controls`
 useEffect(()=>{let live=true;setData(null);setRules(null);setError('');fetch(url).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(live){setData(d);setRules(d.rules)}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[url])
 function change(patch:Partial<SGCommissionerRules>){setRules(r=>r?{...r,...patch}:r);setSaved(false)}
 async function save(next=rules){if(!data||!next)return;setBusy(true);setError('');try{const r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:next,revision:data.revision})}),d=await r.json();if(!r.ok)throw Error(d.error);setData(d);setRules(d.rules);setSaved(true)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <section className="space-y-4 rounded-xl border border-white/15 p-5"><h3 className="text-lg font-semibold">Survivor Guillotine commissioner</h3>
 <h4 className="font-semibold">Free · complete game rules and manual controls</h4><p>Configure tribes, captain selection, matchup order, sit-outs, Gauntlet, merge and finale, powers, immunity deadlines, scoring, FAAB, trades and ceremony presentation. Existing rules remain free; active-season rule locks protect results and hidden powers.</p>
 <div className="flex flex-wrap gap-4"><a className="underline" href={`/survivor-guillotine/setup?leagueId=${encodeURIComponent(leagueId)}`}>Open rules workshop</a><a className="underline" href={`/survivor-guillotine/${encodeURIComponent(leagueId)}`}>Calendar and manual league operations</a></div>
 {error&&<p role="alert">{error}</p>}{data?.error&&<p role="alert">{data.error}</p>}{rules&&data&&<><p>{data.activated?'Saved commissioner controls are active.':'No new controls are saved. Existing league behavior is unchanged.'}</p>{rules.legacy&&<p>Existing automatic behavior is preserved. Pause and resume it here without a subscription.</p>}{data.emergencyPaused&&<p role="status">League emergency pause is active.</p>}
 {typeof data.currentSeason==='number'&&rules.season!==data.currentSeason&&<p>These controls belong to season {rules.season}. <button type="button" disabled={busy} onClick={()=>change({season:data.currentSeason!,paused:false,legacy:false,advanced:null})}>Prepare controls for current season</button></p>}
 <fieldset disabled={busy} className="space-y-3"><label className="block"><input type="checkbox" checked={rules.paused} onChange={e=>change({paused:e.target.checked})}/> Pause scheduled commissioner actions (free)</label>
 <h4 className="font-semibold">Commissioner subscription · automation controls</h4><p>Enable or change these controls with the league owner’s subscription. Saved activations continue after expiry. Pausing, resuming an unchanged activation, and disabling automation remain free.</p>
 <label className="block"><input type="checkbox" checked={Boolean(rules.advanced)} disabled={!data.isPremium&&!rules.advanced} onChange={e=>change({legacy:false,advanced:e.target.checked?{...sgAdvancedDefaults}:null})}/> Use advanced automation</label>
 {rules.advanced&&<fieldset disabled={!data.isPremium} className="space-y-3">{Object.entries(SG_ACTIONS).map(([key,label])=><label className="block" key={key}><input type="checkbox" checked={Boolean(rules.advanced![key as keyof typeof SG_ACTIONS])} onChange={e=>change({advanced:{...rules.advanced!,[key]:e.target.checked}})}/> {label}</label>)}
 <label className="block"><input type="checkbox" checked={rules.advanced.reviewPhaseChanges} onChange={e=>change({advanced:{...rules.advanced!,reviewPhaseChanges:e.target.checked}})}/> Require manual advancement at Gauntlet, merge, finale and off-period transitions</label>
 <label className="block">Chop Night safety delay (minutes)<input type="number" min={0} max={10080} className="ml-2 rounded bg-black/30 p-2" value={rules.advanced.ceremonyDelayMinutes} onChange={e=>change({advanced:{...rules.advanced!,ceremonyDelayMinutes:Number(e.target.value)}})}/></label></fieldset>}
 <p className="text-sm text-white/65">Automation uses your existing saved calendar. Chop Night, rewards, correction checks and advancement require automatic ceremony mode. Missing-choice fallback requires random fallback in the rules; auctions require a configured auction deadline. Final scoring and valid matchups are required. Ties and unresolved choices stop the chop. A phase review is resolved with the existing manual advance control. The delay does not extend idol deadlines.</p>
 <button type="button" onClick={()=>save()}>Save commissioner controls</button><button type="button" className="ml-4" onClick={()=>save({...rules,legacy:false,advanced:null})}>Disable automation (free)</button>
 </fieldset>{saved&&<p role="status">Commissioner controls saved.</p>}{data.runtime&&<p role="status">{String((data.runtime as Record<string,unknown>).status??'Saved configuration')}</p>}
 </>}
 </section>
}
