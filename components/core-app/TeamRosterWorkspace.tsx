'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { MyTeamData } from '@/lib/core-app/myTeam'
import { automaticLineup, eligibleComparisons, teamHealth } from '@/lib/core-app/teamWorkspace'
import { hasStarted } from '@/lib/core-app/lineupDecision'
import { COMMS_OPEN_EVENT } from './comms/commsEvents'
import LocalDateTime from './LocalDateTime'
import TeamWeekPlanner from './TeamWeekPlanner'
import '@/components/core-app/af-team-workspace.css'

export default function TeamRosterWorkspace({ data }: { data: MyTeamData }) {
  const router = useRouter()
  const [now, setNow] = useState(0)
  const [slotIndex, setSlotIndex] = useState(0)
  const [candidateId, setCandidateId] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const automatic = !!data.bestBall || !!data.league.bestBall || data.league.lineupMode === 'automatic' || automaticLineup(data.league.format)
  useEffect(() => { setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id) }, [])
  const [pendingVerification,setPendingVerification] = useState<{index:number;id:string}|null>(null)
  useEffect(()=>{if(pendingVerification && data.starters.available && data.starters.data[pendingVerification.index]?.player?.sleeperId===pendingVerification.id){setMessage('Verified: the refreshed roster contains your saved change.');setPendingVerification(null);setCandidateId('')}},[data,pendingVerification])
  const checks = teamHealth(data)
  const comparisons = useMemo(() => eligibleComparisons(data, now), [data, now])
  const comparison = comparisons[slotIndex]
  const selected = comparison?.candidates.find(c => c.player.sleeperId === candidateId)
  const unavailable = selected?.player.ruledOut || selected?.player.onBye
  const started = comparison ? hasStarted(comparison.slot.player, now) || selected?.started : false
  const ask = () => window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail: { tab: 'chimmy', prefill: `In ${data.league.name}, compare ${comparison?.slot.player?.name ?? 'the empty ' + comparison?.slot.slotLabel + ' slot'} with ${selected?.player.name ?? 'eligible bench players'}. Use this league’s scoring, injury status, and individual kickoff evidence. Explain missing data and provider eligibility.` } }))
  const save = async () => {
    if (!data.nativeLineup || !data.starters.available || !selected || started || unavailable || automatic) return
    setSaving(true); setMessage('')
    try {
      const expectedStarters = data.nativeLineup.starterIds
      const nativeId=data.nativeLineup.benchIds[selected.player.sleeperId]
      if(!nativeId) throw new Error('Native bench identity unavailable. Refresh before saving.')
      const res = await fetch('/api/leagues/roster/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId: data.league.id, rosterId: data.nativeLineup.rosterId, starterSwap: { slotIndex, candidateId: nativeId }, expectedStarters, week: data.nativeLineup.week }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save the lineup.')
      if (json.ok !== true) throw new Error('The server did not confirm this save. Refresh to verify the current roster.')
      setPendingVerification({index:slotIndex,id:selected.player.sleeperId}); setMessage('Lineup saved. Refreshing the roster to verify the change.'); router.refresh()
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save the lineup.') }
    finally { setSaving(false) }
  }
  return <section className="af-tw" aria-labelledby="af-roster-workspace-title">
    <header className="af-tw-heading"><div><h2 id="af-roster-workspace-title">{automatic ? 'Availability and depth' : 'Roster decisions'}</h2><p>{automatic ? 'Best Ball scoring selects your scoring lineup automatically.' : 'Compare eligible players before taking action.'}</p></div><Link href={`/core/sync?league=${encodeURIComponent(data.league.id)}`}>Verify provider lineup</Link></header>
    <details className="af-tw-panel" open={checks.some(c => c.tone === 'bad')}><summary>Roster health · {checks.length} checks to review</summary><ul>{checks.map(check => <li key={check.id} data-tone={check.tone}><strong>{check.label}</strong><p>{check.detail}</p></li>)}</ul>{!checks.length && <p>No issues found in readable roster evidence. Provider eligibility and positional limits still apply.</p>}</details>
    {!automatic && comparisons.length > 0 && <details className="af-tw-panel" open><summary>Start/sit comparison</summary><div className="af-tw-filters"><label>Starting slot<select value={slotIndex} onChange={e => { setSlotIndex(Number(e.target.value)); setCandidateId(''); setMessage('') }}>{comparisons.map(c => <option key={c.index} value={c.index}>{c.slot.slotLabel} · {c.slot.player?.name ?? 'Empty'}</option>)}</select></label><label>Eligible bench player<select value={candidateId} onChange={e => setCandidateId(e.target.value)}><option value="">Choose a player</option>{comparison?.candidates.map(c => <option key={c.player.sleeperId} value={c.player.sleeperId}>{c.player.name}{c.started ? ' · game started' : ''}{c.player.ruledOut ? ' · unavailable' : ''}</option>)}</select></label></div>
      {selected && <><div className="af-tw-compare"><div><h3>{comparison.slot.player?.name ?? 'Empty slot'}</h3><p>Projected: {comparison.slot.player?.afProjectedPoints?.toFixed(1) ?? 'Unavailable'}</p><LocalDateTime value={comparison.slot.player?.kickoff ?? null} /></div><div><h3>{selected.player.name}</h3><p>Projected: {selected.player.afProjectedPoints?.toFixed(1) ?? 'Unavailable'}</p><LocalDateTime value={selected.player.kickoff} /><p>{selected.player.injuryStatus ?? 'No injury designation on file'}</p></div></div><p>{selected.delta == null ? 'League-scored difference unavailable.' : `${selected.delta > 0 ? '+' : ''}${selected.delta.toFixed(1)} projected points under this league’s scoring.`} Projections are estimates.</p><p>{started ? 'A game has started. Check provider locks; this is a review, not an actionable swap.' : unavailable ? 'This bench player is unavailable or on bye.' : 'Position eligibility matches. Provider rules, roster limits, and locks must also permit the move.'}</p><div className="af-tw-links"><button type="button" className="af-btn" onClick={ask}>Ask Chimmy to explain</button>{data.nativeLineup && <button type="button" className="af-btn" disabled={!now || saving || !!started || !!unavailable} onClick={save}>{saving ? 'Saving…' : `Save ${selected.player.name} in ${comparison.slot.slotLabel}`}</button>}</div></>}
      {comparison && !comparison.candidates.length && <p>No position-eligible bench alternatives found.</p>}<p role="status">{message}</p>
    </details>}
    <details className="af-tw-panel"><summary>Scoring and lineup rules</summary><p>{data.projectionBasis.scoringKnown ? 'League rules are applied to the projected numbers shown here.' : 'Scoring rules are unavailable; comparisons may be incomplete.'}</p><ul>{data.projectionBasis.notes.map(note => <li key={note}>{note}</li>)}</ul><p>AutoSubs: {data.autoSubs?.enabled === true ? 'Enabled by this league. Review assigned substitutes and provider lock rules.' : data.autoSubs?.enabled === false ? 'Disabled by this league.' : 'The provider has not supplied a verified AutoSubs setting.'}</p>{data.league.sourceLink && <a href={data.league.sourceLink.href} target="_blank" rel="noopener noreferrer">Review roster and substitutes in {data.league.platform} ↗</a>}</details>
    <details className="af-tw-panel"><summary>Future weeks and pending moves</summary>{data.upcomingByes.length ? <ul>{data.upcomingByes.map(bye => <li key={bye.week}>Week {bye.week}: {bye.names.join(', ')}</li>)}</ul> : <p>No upcoming bye evidence available for this roster.</p>}<nav className="af-tw-links" aria-label="Roster planning"><Link href={`/core/schedule?league=${encodeURIComponent(data.league.id)}`}>Schedule and deadlines</Link><Link href={`/core/waivers?league=${encodeURIComponent(data.league.id)}`}>Waiver claims and roster impact</Link><Link href={`/core/trades?league=${encodeURIComponent(data.league.id)}`}>Pending trades</Link></nav><p>Future planning does not change your current lineup.</p></details>
    {!automatic && <details className="af-tw-panel"><summary>Injury contingency preview</summary><p>This preview does not configure or execute AutoSubs. Confirm assigned substitutes in your provider; availability and locks can change.</p><ul>{comparisons.filter(c=>c.slot.player?.ruledOut || c.slot.player?.onBye).map(c=><li key={c.index}><strong>{c.slot.slotLabel} · {c.slot.player?.name}</strong><p>{c.candidates.filter(p=>!p.started && !p.player.ruledOut && !p.player.onBye).slice(0,3).map(p=>p.player.name).join(', ') || 'No readable, available bench alternatives before kickoff.'}</p></li>)}</ul></details>}
    <TeamWeekPlanner data={data} automatic={automatic} />
  </section>
}
