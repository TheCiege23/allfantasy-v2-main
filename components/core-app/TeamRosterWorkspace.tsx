'use client'
import TeamAlerts from './TeamAlerts'
import TeamAlertTarget from './TeamAlertTarget'
import { NativeAutoSubsControls } from './NativeAutoSubsControls'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { teamWorkspaceCopy } from '@/lib/core-app/teamWorkspaceCopy'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { MyTeamData } from '@/lib/core-app/myTeam'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { scoringNoteText } from '@/lib/core-app/myTeamReasonText'
import { automaticLineup, eligibleComparisons, teamHealth } from '@/lib/core-app/teamWorkspace'
import { hasStarted } from '@/lib/core-app/lineupDecision'
import { COMMS_OPEN_EVENT } from './comms/commsEvents'
import LocalDateTime from './LocalDateTime'
import TeamWeekPlanner from './TeamWeekPlanner'
import '@/components/core-app/af-team-workspace.css'

export default function TeamRosterWorkspace({ data }: { data: MyTeamData }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const copy = (text: string) => teamWorkspaceCopy(text, language)
  const router = useRouter()
  const [now, setNow] = useState(0)
  const [slotIndex, setSlotIndex] = useState(0)
  const [candidateId, setCandidateId] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const automatic = !!data.bestBall || !!data.league.bestBall || data.league.lineupMode === 'automatic' || automaticLineup(data.league.format)
  useEffect(() => { setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id) }, [])
  const [pendingVerification,setPendingVerification] = useState<{index:number;id:string}|null>(null)
  useEffect(()=>{if(pendingVerification && data.starters.available && data.starters.data[pendingVerification.index]?.player?.sleeperId===pendingVerification.id){setMessage("Verified: the refreshed roster contains your saved change.");setPendingVerification(null);setCandidateId('')}},[data,pendingVerification])
  const checks = teamHealth(data, language)
  const comparisons = useMemo(() => eligibleComparisons(data, now), [data, now])
  const reviewAlert = useCallback((index:number)=>{setSlotIndex(index);setCandidateId('');setMessage('')},[])
  const comparison = comparisons[slotIndex]
  const selected = comparison?.candidates.find(c => c.player.sleeperId === candidateId)
  const unavailable = selected?.player.ruledOut || selected?.player.onBye
  const started = comparison ? hasStarted(comparison.slot.player, now) || selected?.started : false
  const ask = () => window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail: { tab: 'chimmy', prefill: es ? `En ${data.league.name}, compara ${comparison?.slot.player?.name ?? 'la plaza vacía ' + comparison?.slot.slotLabel} con ${selected?.player.name ?? 'suplentes elegibles'}. Usa la puntuación de esta liga, el estado de lesión y el inicio de cada partido. Explica los datos faltantes y la elegibilidad en la plataforma.` : `In ${data.league.name}, compare ${comparison?.slot.player?.name ?? 'the empty ' + comparison?.slot.slotLabel + ' slot'} with ${selected?.player.name ?? 'eligible bench players'}. Use this league’s scoring, injury status, and individual kickoff evidence. Explain missing data and provider eligibility.` } }))
  const save = async () => {
    if (!data.nativeLineup || !data.starters.available || !selected || started || unavailable || automatic) return
    setSaving(true); setMessage('')
    try {
      const expectedStarters = data.nativeLineup.starterIds
      const nativeId=data.nativeLineup.benchIds[selected.player.sleeperId]
      if(!nativeId) throw new Error(copy("Native bench identity unavailable. Refresh before saving."))
      const res = await fetch('/api/leagues/roster/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId: data.league.id, rosterId: data.nativeLineup.rosterId, starterSwap: { slotIndex, candidateId: nativeId }, expectedStarters, week: data.nativeLineup.week }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? copy("Could not save the lineup."))
      if (json.ok !== true) throw new Error(copy("The server did not confirm this save. Refresh to verify the current roster."))
      setPendingVerification({index:slotIndex,id:selected.player.sleeperId}); setMessage("Lineup saved. Refreshing the roster to verify the change."); router.refresh()
    } catch (e) { setMessage(e instanceof Error ? e.message : copy("Could not save the lineup.")) }
    finally { setSaving(false) }
  }
  return <section className="af-tw" aria-labelledby="af-roster-workspace-title">
    <header className="af-tw-heading"><div><h2 id="af-roster-workspace-title">{automatic ? copy("Availability and depth") : copy("Roster decisions")}</h2><p>{automatic ? copy("Best Ball scoring selects your scoring lineup automatically.") : copy("Compare eligible players before taking action.")}</p></div><Link href={`/core/sync?league=${encodeURIComponent(data.league.id)}`}>{copy("Verify provider lineup")}</Link></header>
    <TeamAlertTarget key={data.league.id} data={data} onReview={reviewAlert} />
    <details className="af-tw-panel" open={checks.some(c => c.tone === 'bad')}><summary>{es ? `Estado de plantilla · ${checks.length} revisiones pendientes` : `Roster health · ${checks.length} checks to review`}</summary><ul>{checks.map(check => <li key={check.id} data-tone={check.tone}><strong>{check.label}</strong><p>{check.detail}</p></li>)}</ul>{!checks.length && <p>{copy("No issues found in readable roster evidence. Provider eligibility and positional limits still apply.")}</p>}</details>
    {!automatic && comparisons.length > 0 && <details className="af-tw-panel" open><summary>{copy("Start/sit comparison")}</summary><div className="af-tw-filters"><label>{copy("Starting slot")}<select value={slotIndex} onChange={e => { setSlotIndex(Number(e.target.value)); setCandidateId(''); setMessage('') }}>{comparisons.map(c => <option key={c.index} value={c.index}>{c.slot.slotLabel} · {c.slot.player?.name ?? copy("Empty")}</option>)}</select></label><label>{copy("Eligible bench player")}<select value={candidateId} onChange={e => setCandidateId(e.target.value)}><option value="">{copy("Choose a player")}</option>{comparison?.candidates.map(c => <option key={c.player.sleeperId} value={c.player.sleeperId}>{c.player.name}{c.started ? copy(" · game started") : ''}{c.player.ruledOut ? copy(" · unavailable") : ''}</option>)}</select></label></div>
      {selected && <><div className="af-tw-compare"><div><h3>{comparison.slot.player?.name ?? copy("Empty slot")}</h3><p>{es ? 'Proyección: ' : 'Projected: '}{comparison.slot.player?.afProjectedPoints?.toFixed(1) ?? copy("Unavailable")}</p><LocalDateTime value={comparison.slot.player?.kickoff ?? null} /></div><div><h3>{selected.player.name}</h3><p>{es ? 'Proyección: ' : 'Projected: '}{selected.player.afProjectedPoints?.toFixed(1) ?? copy("Unavailable")}</p><LocalDateTime value={selected.player.kickoff} /><p>{selected.player.injuryStatus ? coreUiCopy(selected.player.injuryStatus, language) : copy("No injury designation on file")}</p></div></div><p>{selected.delta == null ? copy("League-scored difference unavailable.") : `${selected.delta > 0 ? '+' : ''}${selected.delta.toFixed(1)} ${es ? 'puntos proyectados según la puntuación de esta liga.' : 'projected points under this league’s scoring.'}`} {es ? 'Las proyecciones son estimaciones.' : 'Projections are estimates.'}</p><p>{started ? copy("A game has started. Check provider locks; this is a review, not an actionable swap.") : unavailable ? copy("This bench player is unavailable or on bye.") : copy("Position eligibility matches. Provider rules, roster limits, and locks must also permit the move.")}</p><div className="af-tw-links"><button type="button" className="af-btn" onClick={ask}>{copy("Ask Chimmy to explain")}</button>{data.nativeLineup && <button type="button" className="af-btn" disabled={!now || saving || !!started || !!unavailable} onClick={save}>{saving ? copy("Saving…") : es ? `Guardar a ${selected.player.name} en ${comparison.slot.slotLabel}` : `Save ${selected.player.name} in ${comparison.slot.slotLabel}`}</button>}</div></>}
      {comparison && !comparison.candidates.length && <p>{copy("No position-eligible bench alternatives found.")}</p>}<p role="status">{copy(message)}</p>
    </details>}
    <details className="af-tw-panel"><summary>{copy("Scoring and lineup rules")}</summary><p>{data.projectionBasis.scoringKnown ? copy("League rules are applied to the projected numbers shown here.") : copy("Scoring rules are unavailable; comparisons may be incomplete.")}</p><ul>{data.projectionBasis.notes.map(note => <li key={note}>{scoringNoteText(note, language)}</li>)}</ul><p>AutoSubs: {data.autoSubs?.enabled === true ? copy("Enabled by this league. Review assigned substitutes and provider lock rules.") : data.autoSubs?.enabled === false ? copy("Disabled by this league.") : copy("The provider has not supplied a verified AutoSubs setting.")}</p>{data.league.sourceLink && <a href={data.league.sourceLink.href} target="_blank" rel="noopener noreferrer">{es ? 'Revisar plantilla y sustitutos en ' : 'Review roster and substitutes in '}{platformLabel(data.league.platform)} ↗</a>}</details>
    <details className="af-tw-panel"><summary>{copy("Future weeks and pending moves")}</summary>{data.upcomingByes.length ? <ul>{data.upcomingByes.map(bye => <li key={bye.week}>{es ? 'Semana' : 'Week'} {bye.week}: {bye.names.join(', ')}</li>)}</ul> : <p>{copy("No upcoming bye evidence available for this roster.")}</p>}<nav className="af-tw-links" aria-label={copy("Roster planning")}><Link href={`/core/schedule?league=${encodeURIComponent(data.league.id)}`}>{copy("Schedule and deadlines")}</Link><Link href={`/core/waivers?league=${encodeURIComponent(data.league.id)}`}>{copy("Waiver claims and roster impact")}</Link><Link href={`/core/trades?league=${encodeURIComponent(data.league.id)}`}>{copy("Pending trades")}</Link></nav><p>{copy("Future planning does not change your current lineup.")}</p></details>
    {!automatic && <details className="af-tw-panel"><summary>{copy("Injury contingency preview")}</summary><p>{copy("This preview does not configure or execute AutoSubs. Confirm assigned substitutes in your provider; availability and locks can change.")}</p><ul>{comparisons.filter(c=>c.slot.player?.ruledOut || c.slot.player?.onBye).map(c=><li key={c.index}><strong>{c.slot.slotLabel} · {c.slot.player?.name}</strong><p>{c.candidates.filter(p=>!p.started && !p.player.ruledOut && !p.player.onBye).slice(0,3).map(p=>p.player.name).join(', ') || copy("No readable, available bench alternatives before kickoff.")}</p></li>)}</ul></details>}
    {!automatic && data.nativeLineup && <NativeAutoSubsControls data={data} />}
    <TeamAlerts leagueId={data.league.id} />
    <TeamWeekPlanner data={data} automatic={automatic} />
  </section>
}
