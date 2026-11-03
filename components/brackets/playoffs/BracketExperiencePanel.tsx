"use client"
import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"
import type { BracketExperience, BracketAlertPreferences, LedgerRow } from "@/lib/playoffs/bracketExperience"
import { bracketCompanionCopy, bracketCompanionLocale } from "@/lib/brackets/bracketCompanionCopy"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
export function BracketEntryChecklist({ experience: data, challengeId, entryId }: { experience: BracketExperience; challengeId: string; entryId?: string }) {
  const { language } = useOptionalLanguage(), c = bracketCompanionCopy(language), locale = bracketCompanionLocale(language)
  const href = entryId ? `/brackets/leagues/${challengeId}/entries/${entryId}` : `/brackets/leagues/${challengeId}`
  const checklist = data.checklist
  const fmt = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(locale) : c.unavailable
  return (<section aria-label={c.checklist} className="af-coach-checklist">
      <h3>{c.checklist}</h3>
      {!checklist.hasEntry ? <Link href={href}>{c.create} →</Link> : <>
        <ol className="af-coach-steps"><li>✓ {c.create}</li><li>{checklist.missing ? "○" : "✓"} {c.savedCount(checklist.saved,checklist.available)}</li><li>{checklist.finalizedAt ? "✓" : "○"} {checklist.finalizedAt ? `${c.finalized}: ${fmt(checklist.finalizedAt)}` : c.submit}</li></ol>
        {checklist.nextDeadline ? <p>{c.deadline}: <time dateTime={checklist.nextDeadline}>{fmt(checklist.nextDeadline)}</time></p> : <p>{c.noDeadline}</p>}
        {checklist.firstMissingId && <Link href={`${href}#playoff-series-${checklist.firstMissingId}`}>{c.reviewMissing} →</Link>}
        {checklist.readyToFinalize && <p><Link href={`${href}#bracket-finalize`}>{c.finalize} →</Link> · {c.ready}</p>}
        <p className="af-coach-faint">{c.finalizeWarning}</p>
      </>}
      {checklist.pendingMatchups > 0 && <p className="af-coach-faint">{c.pendingCount(checklist.pendingMatchups)}</p>}
    </section>)
}

export default function BracketExperiencePanel({ experience: data, challengeId, entryId, activeTab, hideChecklist = false }: { experience: BracketExperience; challengeId: string; entryId?: string; activeTab?: string; hideChecklist?: boolean }) {
  const { language } = useOptionalLanguage(), c = bracketCompanionCopy(language), locale = bracketCompanionLocale(language)
  const id = useId(), [localTab,setTab] = useState("ledger"), [filter,setFilter] = useState("all"), [limit,setLimit] = useState(10)
  const [prefs,setPrefs] = useState<BracketAlertPreferences>(data.alerts), [dirty,setDirty] = useState(false), [saving,setSaving] = useState(false), [status,setStatus] = useState("")
  const tab = activeTab ?? localTab
  const pending = useRef(false)
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setPrefs(data.alerts) }, [data.alerts])
  const href = entryId ? `/brackets/leagues/${challengeId}/entries/${entryId}` : `/brackets/leagues/${challengeId}`
  const fmt = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(locale) : c.unavailable
  const rows = data.ledger.filter(row => filter !== "points" || row.points > 0)
  function edit<K extends keyof BracketAlertPreferences>(key: K, value: BracketAlertPreferences[K]) { editing.current = true; setDirty(true); setPrefs(p => ({ ...p,[key]:value })); setStatus("") }
  async function save() {
    if (pending.current) return
    pending.current = true; setSaving(true); setStatus("")
    try {
      const response = await fetch(`/api/brackets/playoffs/${encodeURIComponent(challengeId)}/coach/alerts`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...prefs, locale: language === "es" ? "es" : "en" }) })
      const result = await response.json()
      if (!response.ok || !result.alerts || typeof result.alerts.enabled !== "boolean") throw new Error("preferences")
      editing.current = false; setPrefs(result.alerts); setDirty(false); setStatus(c.savedPreferences)
    } catch { setStatus(c.saveFailed) }
    finally { pending.current = false; setSaving(false) }
  }
  const result = (row: LedgerRow) => `${row.awayScore ?? "—"} – ${row.homeScore ?? "—"} · ${row.winner ?? c.pending}`
  return <div className="af-experience">
    {!hideChecklist && <BracketEntryChecklist experience={data} challengeId={challengeId} entryId={entryId} />}
    {!activeTab && <nav aria-label={c.ledger}>{[{ id:"ledger",label:c.ledger },{ id:"standings",label:c.standings },...(data.scheduledTracking === false ? [] : [{ id:"alerts",label:c.alerts }])].map(t => <button type="button" key={t.id} aria-pressed={tab===t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}</nav>}
    {tab === "ledger" && <section aria-label={c.ledger}>
      <p><strong>{c.official}: {data.officialTotal}</strong> · {c.explained}: {data.explainedTotal}</p>
      {data.officialTotal !== data.explainedTotal && <p role="status" className="af-coach-warning">{c.mismatch}</p>}
      <label htmlFor={`${id}-filter`}>{c.filter}</label><select id={`${id}-filter`} value={filter} onChange={e => { setFilter(e.target.value); setLimit(10) }}><option value="all">{c.all}</option><option value="points">{c.pointsOnly}</option><option value="changes">{c.changes}</option></select>
      {filter !== "changes" && <><div className="af-coach-table" tabIndex={0} role="region" aria-label={c.ledger}><table><caption>{c.explained}</caption><thead><tr><th>{c.match}</th><th>{c.selected}</th><th>{c.result}</th><th>{c.points}</th><th>{c.reason}</th><th>{c.source}</th></tr></thead><tbody>{rows.slice(0,limit).map(row => <tr key={row.id}><td>{c.at(row.away,row.home)}</td><td>{row.pick ?? c.none}</td><td>{result(row)}</td><td>+{row.points} / {row.available}</td><td>{c.reasons[row.reason]}</td><td>{fmt(row.sourceAt)}</td></tr>)}</tbody></table></div>{rows.length > limit && <button type="button" onClick={() => setLimit(n => n+20)}>{c.more} ({rows.length-limit})</button>}</>}
      <h3>{c.history}</h3><p className="af-coach-faint">{data.scheduledTracking === false ? c.trackingUnsupported : data.history.since ? c.historySince(fmt(data.history.since)) : c.noHistory}</p>
      {data.history.trimmed > 0 && <p>{c.trimmed(data.history.trimmed)}</p>}
      <ul>{data.history.events.slice(0,limit).map(event => <li key={event.id}><article><strong>{c.at(event.after.away,event.after.home)} · {event.kind === "corrected" ? c.correction : event.kind === "settled" ? c.settled : c.eligibility}</strong><p>{fmt(event.observedAt)} · {event.delta > 0 ? "+" : ""}{event.delta} {c.points}</p><p>{event.before ? result(event.before) : c.pending} → {result(event.after)}</p><p>{event.before?.points ?? 0} → {event.after.points} · {c.reasons[event.after.reason]}</p></article></li>)}</ul>
      {!data.history.events.length && <p>{c.noChanges}</p>}
      {data.history.events.length > limit && <button type="button" onClick={() => setLimit(n => n+20)}>{c.more}</button>}
    </section>}
    {tab === "standings" && <section aria-label={c.standings}><h3>{c.standings}</h3><p>{c.projectedHelp}</p>
      {data.standings ? <>{data.standings.staleGames > 0 && <p className="af-coach-warning">{c.stale(data.standings.staleGames)}</p>}<div className="af-coach-table" tabIndex={0} role="region" aria-label={c.standings}><table><caption>{c.provisional} · {fmt(data.standings.asOf)}</caption><thead><tr><th>{c.entry}</th><th>{c.officialRank}</th><th>{c.official}</th><th>{c.livePoints}</th><th>{c.projectedRank}</th><th>{c.movement}</th></tr></thead><tbody>{data.standings.rows.map(row => <tr key={row.id} aria-current={row.id===entryId ? "true" : undefined}><td>{row.name}</td><td>{row.officialRank ?? "—"}</td><td>{row.officialScore}</td><td>+{row.livePoints}</td><td>{row.provisionalRank}</td><td>{row.movement == null ? "—" : row.movement > 0 ? `↑${row.movement}` : row.movement < 0 ? `↓${Math.abs(row.movement)}` : "—"}</td></tr>)}</tbody></table></div>{!data.standings.rows.length && <p>{c.noStandings}</p>}</> : <p>{c.projectionUnavailable}</p>}
    </section>}
    {tab === "alerts" && data.scheduledTracking !== false && <section aria-label={c.alerts}><h3>{c.alerts}</h3><p>{c.alertsHelp}</p><fieldset disabled={saving}>
      {(["enabled","missingPicks","locks","results","rankChanges","spoilerSafe"] as const).map(key => <label className="af-coach-checkbox" key={key}><input type="checkbox" checked={prefs[key]} onChange={e => edit(key,e.target.checked)} />{c[key]}</label>)}
      <label htmlFor={`${id}-lead`}>{c.leadMinutes}</label><select id={`${id}-lead`} value={prefs.leadMinutes} onChange={e => edit("leadMinutes",Number(e.target.value))}>{[15,30,60].map(n => <option key={n} value={n}>{c.minutes(n)}</option>)}</select>
      <div><button type="button" disabled={saving || !dirty} onClick={() => void save()}>{saving ? c.saving : c.save}</button> · <Link href="/settings">{c.settings}</Link></div>
    </fieldset>{status && <p role="status">{status}</p>}</section>}
  </div>
}
