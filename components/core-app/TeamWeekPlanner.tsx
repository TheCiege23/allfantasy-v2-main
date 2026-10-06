'use client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { teamWorkspaceCopy } from '@/lib/core-app/teamWorkspaceCopy'
import { useEffect, useState } from 'react'
import type { MyTeamData } from '@/lib/core-app/myTeam'
import { isEligibleForSlot } from '@/lib/core-app/rosterSlots'

type Plan = { slots: Record<string,string>; note: string; savedAt: string }
export default function TeamWeekPlanner({ data, automatic }: { data: MyTeamData; automatic: boolean }) {
  const { language } = useOptionalLanguage()
  const copy = (text: string) => teamWorkspaceCopy(text, language)
  const [week, setWeek] = useState('')
  const [plans, setPlans] = useState<Record<string,Plan>>({})
  const [note, setNote] = useState('')
  const [slots, setSlots] = useState<Record<string,string>>({})
  const [status, setStatus] = useState('')
  const key = `af-week-plans:${data.league.id}:${data.nativeLineup?.rosterId ?? (data.team.available ? data.team.data.teamName : 'unclaimed')}`
  useEffect(() => { try { const v=JSON.parse(localStorage.getItem(key) ?? '{}'); if(v && typeof v==='object' && !Array.isArray(v)) setPlans(v) } catch { setPlans({}) } }, [key])
  useEffect(() => { const p=plans[week]; setNote(typeof p?.note==='string' ? p.note : ''); setSlots(p?.slots && typeof p.slots==='object' ? p.slots : {}) }, [week,plans])
  const players = [...(data.starters.available ? data.starters.data.flatMap(s=>s.player ? [s.player] : []) : []), ...(data.bench.available ? data.bench.data : [])]
  const save=()=>{ const next={...plans,[week]:{slots,note,savedAt:new Date().toISOString()}}; try {localStorage.setItem(key,JSON.stringify(next));setPlans(next);setStatus("Plan saved on this device. The active lineup has not changed.")} catch {setStatus("This browser could not save the plan.")} }
  const remove=()=>{const next={...plans};delete next[week];try{localStorage.setItem(key,JSON.stringify(next));setPlans(next);setNote('');setSlots({});setStatus("Plan removed.")}catch{setStatus("This browser could not remove the plan.")}}
  return <details className="af-tw-panel"><summary>{copy("Plan a future week")}</summary><p>{copy("Personal notes and tentative slots stay on this device. Check the selected week’s projections and lock times before acting.")}</p><label>{copy("Planning week")}<input type="number" min="1" max="30" value={week} onChange={e=>{setWeek(e.target.value);setStatus('')}} /></label>
    {!automatic && data.starters.available && <div className="af-tw-filters">{data.starters.data.map((s,i)=><label key={i}>{s.slotLabel}<select value={slots[String(i)] ?? ''} onChange={e=>setSlots(v=>({...v,[String(i)]:e.target.value}))}><option value="">{copy("Unplanned")}</option>{players.filter(p=>isEligibleForSlot(s.slotLabel,p.position)).map(p=><option key={p.sleeperId} value={p.sleeperId}>{p.name}</option>)}</select></label>)}</div>}
    <label>{copy("Acquisitions, contingency plans, and reminders")}<textarea maxLength={2000} rows={3} value={note} onChange={e=>setNote(e.target.value)} /></label><div className="af-tw-links"><button type="button" className="af-btn" disabled={!Number.isInteger(Number(week)) || Number(week)<1 || Number(week)>30 || new Set(Object.values(slots).filter(Boolean)).size!==Object.values(slots).filter(Boolean).length} onClick={save}>{copy("Save personal plan")}</button><button type="button" className="af-btn" disabled={!plans[week]} onClick={remove}>{copy("Remove plan")}</button></div><p role="status">{copy(status)}</p><p>{copy("Each player can occupy only one planned slot. IR and taxi moves require provider eligibility.")}</p></details>
}
