'use client'

import { useEffect, useState } from 'react'
import { readPortfolioEvidence, type PortfolioEvidence, type PortfolioState } from '@/lib/chimmy/portfolio/types'

/** Same evidence in the Communications drawer and full-page chat. Actions prepare text, never send. */
const displayTime = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

export function ChimmyPortfolioCard({ evidence, onAsk, onEvidenceChange }: {
  evidence: PortfolioEvidence
  onEvidenceChange?: (evidence: PortfolioEvidence) => void
  onAsk?: (prompt: string, state: PortfolioState) => void
}) {
  const [current, setCurrent] = useState(evidence)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { setCurrent(evidence) }, [evidence])
  const visible = expanded ? current.teams : current.teams.slice(0, 4)
  const refresh = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const query = new URLSearchParams({ view: 'roster-portfolio', state: JSON.stringify({ ...current.state, checkedLeagueIds: [] }) })
      if (current.total === current.teams.length && current.teams.length) query.set('scope', current.teams.map(t => t.leagueId).join(','))
      const res = await fetch('/api/chat/chimmy?' + query, { credentials: 'include', cache: 'no-store' })
      if (!res.ok) throw new Error('Analysis could not be refreshed. Your previous comparison is still shown.')
      const next = readPortfolioEvidence((await res.json()).portfolio)
      if (!next) throw new Error('No valid updated comparison was returned.')
      setCurrent(next)
      onEvidenceChange?.(next)
    } catch (e) { setError(e instanceof Error ? e.message : 'Refresh failed.') }
    finally { setBusy(false) }
  }
  return <section aria-label="Your team comparison" className="my-3 min-w-0 rounded-xl border border-teal-400/25 bg-teal-500/5 p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-semibold">Compared {current.compared} of {current.total} teams</p>
      <button type="button" onClick={() => void refresh()} disabled={busy} className="min-h-9 rounded-lg border border-white/20 px-2 disabled:opacity-50">{busy ? 'Refreshing…' : 'Refresh analysis'}</button>
    </div>
    <p className="mt-1 opacity-70">{current.scopeLabel} · {current.horizon === 'week' ? 'This week' : current.horizon === 'dynasty' ? 'Dynasty roster value' : 'Season roster construction'}</p>
    {onAsk && <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Comparison horizon">
      {(['week', 'season', 'dynasty'] as const).map(h => <button type="button" key={h} aria-pressed={current.horizon === h} className="min-h-9 rounded-lg border border-white/15 px-2" onClick={() => onAsk(h === 'week' ? 'What about this week?' : h === 'dynasty' ? 'What about dynasty?' : 'What about the rest of this season?', current.state)}>{h === 'week' ? 'This week' : h === 'dynasty' ? 'Dynasty' : 'This season'}</button>)}
    </div>}
    <p className="mt-1 opacity-60">Checked {displayTime(current.generatedAt)} · Refresh analysis rereads stored data; use the roster screen to sync the source league.</p>
    {error && <p role="alert" className="mt-2 text-amber-300">{error}</p>}
    {current.status !== 'ready' && <p className="mt-2 text-amber-300">{current.status === 'blocked' ? 'Comparison unavailable. This answer is not charged.' : 'Partial coverage. The order applies to the readable teams on this pass.'}</p>}
    <ol className="mt-3 space-y-3">
      {visible.map((t) => <li key={t.leagueId} className="rounded-lg border border-white/10 p-2">
        <p className="font-semibold">{t.leagueName}</p>
        <p className="opacity-70">{t.teamName ?? 'Own team not resolved'} · {t.sport} {t.season}</p>
        <dl className="my-2 grid grid-cols-2 gap-2">
          <div><dt className="opacity-60">League strength</dt><dd>{t.rank && t.outOf ? t.rank + ' of ' + t.outOf : 'Unavailable'}</dd></div>
          <div><dt className="opacity-60">Backup coverage</dt><dd>{t.metrics.find(m => m.key === 'depth')?.value != null ? t.metrics.find(m => m.key === 'depth')!.value + '%' : 'Unavailable'}</dd></div>
        </dl>
        <p className={t.stale ? 'text-amber-300' : 'opacity-60'}>{t.lastSyncedAt ? 'Roster synced ' + displayTime(t.lastSyncedAt) : t.stale ? 'Roster sync time unknown' : 'Native roster read directly'}{t.stale ? ' · Refresh needed' : ''}</p>
        <details className="mt-2">
          <summary className="min-h-8 cursor-pointer">Evidence and gaps</summary>
          <ul className="space-y-2 py-2">{t.metrics.map(m => <li key={m.key}><strong>{m.label}: </strong>{m.detail}</li>)}{t.gaps.map((g, i) => <li key={i} className="text-amber-300">{g}</li>)}</ul>
        </details>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={'Next steps for ' + t.leagueName}>
          {t.actions.map(a => a.href ? <a key={a.label} href={a.href} className="inline-flex min-h-9 items-center rounded-lg border border-teal-400/25 px-2">{a.label}</a> :
            a.prompt && onAsk ? <button key={a.label} type="button" className="min-h-9 rounded-lg border border-teal-400/25 px-2" onClick={() => onAsk(a.prompt!, { ...current.state, focusLeagueId: t.leagueId })}>{a.label}</button> : null)}
        </div>
      </li>)}
    </ol>
    {current.teams.length > 4 && <button type="button" className="mt-2 min-h-9 underline" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? 'Show fewer teams' : 'Show all ' + current.teams.length + ' teams on this pass'}</button>}
    {current.remaining > 0 && onAsk && <button type="button" className="mt-2 block min-h-9 underline" onClick={() => onAsk('Compare my remaining teams', current.state)}>Compare next teams ({current.remaining} remaining)</button>}
    <details className="mt-2"><summary className="min-h-8 cursor-pointer">How this comparison works</summary><ul className="space-y-2 py-2">{current.methodology.map((m, i) => <li key={i}>{m}</li>)}{current.caveats.map((m, i) => <li key={'c' + i}>{m}</li>)}</ul></details>
  </section>
}
