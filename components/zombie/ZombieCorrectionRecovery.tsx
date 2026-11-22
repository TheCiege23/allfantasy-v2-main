'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

type Review = { id: string; fromWeek: number; sourceHash: string; status: string; effectsPending: boolean; blockers: string[];
  liveWeeksToRefresh?: number[];
  summary: Array<{ week: number; scoreChanges: number; roleChanges: number; itemChanges: number; winningsChanges: number; retainedChoices: number; newChoices: number }>;
  externalReviews?: Array<{ payoutId: string; week: number }>; changes: Array<{ week: number; teams: Array<{ rosterId: string; beforeRole: string; afterRole: string; beforeWinnings: number; afterWinnings: number }>;
    scores?: Array<{ homeRosterId: string; awayRosterId: string; beforeHome: number; beforeAway: number; afterHome: number; afterAway: number }>;
    items?: Array<{ id: string; before: { rosterId: string; itemType: string; spent: boolean } | null; after: { rosterId: string; itemType: string; spent: boolean } | null }>;
    choices?: Array<{ rosterId: string; decision: string | null; retained: boolean; remaining: number; deadlineAt: string }> }> }
type Pack = { holdFromWeek: number | null; teams: Array<{ id: string; name: string }>; weeks: Array<{ week: number; status: string; requiresStatCorrection: boolean }>; reviews: Review[] }
const control = 'min-h-11 rounded-xl border border-emerald-300/25 bg-black/25 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50'
export function ZombieCorrectionRecovery({ leagueId }: { leagueId: string }) {
  const [pack, setPack] = useState<Pack | null>(null), [selected, setSelected] = useState<Review | null>(null), [week, setWeek] = useState('')
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [reference, setReference] = useState(''), [externalNote, setExternalNote] = useState(''), version = useRef(0)
  const load = useCallback(async (signal?: AbortSignal) => {
    const requestVersion = version.current
    const r = await fetch(`/api/zombie/corrections?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include', signal })
    const p = await r.json()
    if (!r.ok) throw new Error(p.error || 'Recovery status unavailable.')
    if (!Array.isArray(p.reviews) || !Array.isArray(p.weeks)) throw new Error('Recovery returned an incomplete response.')
    if (!signal?.aborted && requestVersion === version.current) setPack(p)
  }, [leagueId])
  useEffect(() => {
    const controller = new AbortController(); const effectVersion = version.current + 1; version.current = effectVersion
    setPack(null); setSelected(null); setMessage(''); setWeek(''); setReason(''); setConfirmed(false); setBusy(false)
    void load(controller.signal).catch(e => { if (!controller.signal.aborted) setMessage(e.message) })
    const timer = setInterval(() => { void load(controller.signal).catch(() => {}) }, 30_000)
    return () => { version.current = effectVersion + 1; controller.abort(); clearInterval(timer) }
  }, [load])
  async function action(body: Record<string, unknown>) {
    if (busy) return
    setBusy(true); setMessage(''); const current = version.current
    try {
      const r = await fetch('/api/zombie/corrections', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, ...body }) })
      const p = await r.json()
      if (version.current !== current) return
      if (!r.ok) throw new Error(p.error || 'Recovery could not be saved.')
      setSelected(p.review ?? null); setConfirmed(false)
      setMessage(p.review ? 'Preview saved. Review every affected week and any dependencies.' : p.effectsPending || p.pending ? 'Game state saved. Standings or reports remain pending retry.' : p.refreshRequired ? 'External review recorded. Prepare a fresh preview before approval.' : 'Recovery completed. The game state and reports are up to date.')
      await load()
    } catch (e) { if (version.current === current) setMessage(e instanceof Error ? e.message : 'Connection interrupted. Retry the same review to check its saved result.') }
    finally { if (version.current === current) setBusy(false) }
  }
  const names = new Map(pack?.teams.map(t => [t.id, t.name]))
  return <section aria-label="Stat corrections and commissioner recovery" className="my-5 space-y-4 rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-950/60 to-[#090c18] p-4 text-white">
    <header><h2 className="font-black">Stat corrections &amp; recovery</h2><p className="mt-1 text-sm text-white/65">Review affected scores, roles, inventory, combat choices and winnings together.</p></header>
    {pack?.holdFromWeek != null && <p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-950/30 p-3 text-sm">Correction hold from Week {pack.holdFromWeek}. New settlement, item use, trades, ambushes and combat responses wait for recovery.</p>}
    {message && <p role="status" aria-live="polite" className="text-sm text-emerald-100">{message}</p>}
    <p className="text-sm text-white/65">Choose the earliest affected week. Preparing a review holds new game actions until the correction is applied.</p>
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Starting week<select className={`${control} ml-2`} value={week} onChange={e => { setWeek(e.target.value); setSelected(null); setConfirmed(false) }} disabled={busy}><option value="">Choose week</option>{pack?.weeks.filter(w => w.status === 'complete').map(w => <option key={w.week} value={w.week}>Week {w.week}{w.requiresStatCorrection ? ' · Review required' : ''}</option>)}</select></label>
      <button className={control} disabled={busy || !week} onClick={() => void action({ action: 'preview', week: Number(week) })}>Prepare correction preview</button></div>
    {selected && <article className="space-y-3 rounded-xl border border-white/15 p-3"><h3 className="font-bold">Reviewed recovery from Week {selected.fromWeek}</h3>
      {Boolean(selected.liveWeeksToRefresh?.length) && <p className="text-sm text-white/75">Unsettled Weeks {selected.liveWeeksToRefresh?.join(', ')} will also receive corrected passive-item bonuses and a scoring refresh. No additional item is spent.</p>}
      {selected.summary.map(s => <p className="text-sm text-white/75" key={s.week}>Week {s.week}: {s.scoreChanges} score changes · {s.roleChanges} role changes · {s.itemChanges} item changes · {s.winningsChanges} winnings changes · {s.retainedChoices} retained choices · {s.newChoices} new/defaulted choices</p>)}
      {selected.changes.map(w => <details key={w.week}><summary className="min-h-11 cursor-pointer text-sm">Week {w.week} team consequences</summary><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Team</th><th className="p-2">Role</th><th className="p-2">Cumulative winnings</th></tr></thead><tbody>{w.teams.map(t => <tr key={t.rosterId}><td className="p-2">{names.get(t.rosterId) || 'Manager'}</td><td className="p-2">{t.beforeRole} → {t.afterRole}</td><td className="p-2">{t.beforeWinnings.toFixed(2)} → {t.afterWinnings.toFixed(2)}</td></tr>)}</tbody></table></div></details>)}
      {selected.changes.map(w => <details key={`detail-${w.week}`}><summary className="min-h-11 cursor-pointer text-sm">Week {w.week} scores, inventory and decisions</summary><div className="space-y-2 text-sm text-white/75">
        {w.scores?.map((s, i) => <p key={i}>{names.get(s.homeRosterId) || 'Manager'} vs {names.get(s.awayRosterId) || 'Manager'}: {s.beforeHome}–{s.beforeAway} → {s.afterHome}–{s.afterAway}</p>)}
        {w.items?.map(i => <p key={i.id}>Item: {i.before ? `${i.before.itemType.replaceAll('_', ' ')} · ${names.get(i.before.rosterId) || 'Manager'}${i.before.spent ? ' · spent' : ''}` : 'not awarded'} → {i.after ? `${i.after.itemType.replaceAll('_', ' ')} · ${names.get(i.after.rosterId) || 'Manager'}${i.after.spent ? ' · spent' : ''}` : 'award removed'}</p>)}
        {w.choices?.map((c, i) => <p key={i}>{names.get(c.rosterId) || 'Manager'}: {c.decision?.replaceAll('_', ' ') || 'manager response pending'} · {c.retained ? 'eligible original choice retained' : 'corrected offer or rule default'} · {c.remaining} ambushes inherited if succession applies · deadline {new Date(c.deadlineAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} Eastern</p>)}
      </div></details>)}
      {selected.blockers.length > 0 && <div role="alert" className="rounded-xl bg-amber-950/40 p-3 text-sm"><p className="font-bold">Dependencies to resolve</p><ul className="mt-2 list-disc space-y-2 pl-5">{selected.blockers.map(b => <li key={b}>{b}</li>)}</ul><p className="mt-3">Manager actions and payments are preserved. Reconcile the listed dependency, then prepare a fresh preview.</p></div>}
      {selected.externalReviews?.length ? <div className="space-y-2"><p className="text-sm">After reconciling the payout with the external provider, record its reference here. This records your review and does not move money.</p>
        <label className="block text-sm">External reconciliation reference<input className={`${control} mt-1 w-full`} value={reference} onChange={e => setReference(e.target.value)} /></label>
        <label className="block text-sm">External review note<textarea className={`${control} mt-1 w-full`} value={externalNote} onChange={e => setExternalNote(e.target.value)} /></label>
        {selected.externalReviews.map(r => <button className={control} key={r.payoutId} disabled={busy || reference.trim().length < 3 || externalNote.trim().length < 12} onClick={() => void action({ action: 'external_review', reviewId: selected.id, payoutId: r.payoutId, reference, note: externalNote })}>Record completed external review · Week {r.week}</button>)}
      </div> : null}
      {selected.status === 'ready' && !selected.blockers.length && <div className="space-y-3"><label className="block text-sm">Approval reason<textarea className={`${control} mt-1 w-full`} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed every affected week and the retained or defaulted combat choices.</label>
        <button className={control} disabled={busy || !confirmed || reason.trim().length < 12} onClick={() => void action({ action: 'approve', reviewId: selected.id, sourceHash: selected.sourceHash, reason })}>Approve and apply reviewed correction</button></div>}
    </article>}
    {pack?.reviews.filter(r => r.status === 'applied').map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-3 text-sm"><span>Recovery from Week {r.fromWeek}: {r.effectsPending ? 'game state applied; standings or reports pending' : 'completed'}</span>{r.effectsPending && <button className={control} disabled={busy} onClick={() => void action({ action: 'retry_effects', reviewId: r.id })}>Retry standings &amp; reports</button>}</div>)}
    <button className="min-h-11 text-sm text-emerald-200 underline" disabled={busy} onClick={() => void load().catch(e => setMessage(e.message))}>Refresh recovery status</button>
  </section>
}
