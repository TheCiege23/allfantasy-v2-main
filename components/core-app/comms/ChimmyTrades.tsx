'use client'

import { useEffect, useState } from 'react'
import type { TradeGradesPayload } from '@/lib/trade-intel/sleeperTradeGradeService'
import type { ImportedTradeLedgerPayload } from '@/lib/trade-intel/importedTradeLedgerService'

type Proposal = { id: string; title: string; status: string; involvesYou: boolean; assets: string[]; grade: string | null; explanation: string }
type History = { supported: boolean; grades?: TradeGradesPayload; ledger?: ImportedTradeLedgerPayload; viewerSleeperUserId?: string | null; sync?: { incomplete: boolean } }

export function ChimmyTrades({ leagueId, onAsk }: { leagueId: string; onAsk: (question: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [history, setHistory] = useState<History | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [visible, setVisible] = useState(10)

  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    setBusy(true)
    setError('')
    const read = async (url: string) => {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
      if (!res.ok) throw new Error('Trade activity could not be loaded. Please retry.')
      return res.json()
    }
    const base = `/api/league/trade-grades?leagueId=${encodeURIComponent(leagueId)}`
    const readProposals = async () => {
      const rows: Proposal[] = []
      let cursor: string | null = null
      do {
        const page = await read(`${base}&view=proposals${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        rows.push(...page.proposals)
        cursor = page.nextCursor
      } while (cursor)
      return rows
    }
    Promise.allSettled([readProposals(), read(base)]).then(([offers, completed]) => {
      if (controller.signal.aborted) return
      setProposals(offers.status === 'fulfilled' ? offers.value : [])
      setHistory(completed.status === 'fulfilled' ? completed.value : null)
      if (offers.status === 'rejected' || completed.status === 'rejected') setError('Some trade activity could not be loaded. Retry to refresh it.')
      setBusy(false)
    })
    return () => controller.abort()
  }, [expanded, leagueId, revision])

  const trades = history?.grades?.trades ?? []
  return <section className="af-cm-trades" aria-label="League trade intelligence">
    <button type="button" className="af-cm-trades-toggle" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
      <span>Trade intelligence</span><span>{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div className="af-cm-trades-body">
      <p>Your proposals and league-approved trades. Private offers on other platforms appear only when available to AllFantasy.</p>
      <button type="button" className="af-cm-linkbtn" disabled={busy} onClick={() => setRevision(v => v + 1)}>Refresh trades</button>
      {busy && <p role="status">Loading league trades…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && <>
        <h3>Proposals and approvals</h3>
        {proposals.length === 0 && <p>No accessible AllFantasy proposals loaded.</p>}
        {proposals.slice(0, visible).map(p => <article key={p.id}>
          <strong>{p.title}</strong><p>{p.status}{p.involvesYou ? ' · Your trade' : ''} · {p.grade ? `Fairness snapshot ${p.grade}` : 'Grade unavailable'}</p>
          <p>{p.assets.join(' · ')}</p><p>{p.explanation}</p>
          <button type="button" className="af-cm-quickbtn" onClick={() => onAsk(`Explain proposal ${p.id}: ${p.title}, involving ${p.assets.join(', ')}. Does it fit my roster and this league's rules? Distinguish the historical fairness snapshot from a current recommendation.`)}>Ask Chimmy</button>
        </article>)}
        <h3>Completed trades</h3>
        {history?.grades?.fetchedAt && <p>Updated {new Date(history.grades.fetchedAt).toLocaleString()}. Grades measure realized fantasy points under league scoring.</p>}
        {history?.grades?.staleAsOf && <p>Cached history; some results may be out of date.</p>}
        {history?.sync?.incomplete && <p>Some provider trades have not finished syncing.</p>}
        {history?.grades?.missing.map(note => <p key={note}>{note}</p>)}
        {trades.slice(0, visible).map(t => {
          const hasSignal = t.sides.some(s => [...s.playersIn, ...s.playersOut].some(p => Object.values(p.creditedBySeason).some(n => n !== 0)) || [...s.picksIn, ...s.picksOut].some(p => p.resolved && Object.values(p.resolved.creditedBySeason).some(n => n !== 0)))
          return <article key={t.id}>
            <strong>{t.season} · Week {t.week}</strong>
            {t.sides.map(s => <div key={s.rosterId}>
              <p><b>{s.teamName || s.managerName}{s.ownerId && s.ownerId === history?.viewerSleeperUserId ? ' (You)' : ''}</b> · {hasSignal ? `Realized grade ${s.currentGrade}` : 'Grade unavailable'}</p>
              <p>Received: {[...s.playersIn.map(p => p.name), ...s.picksIn.map(p => p.label)].join(', ') || 'No recorded assets'}</p>
              <p>{hasSignal ? `Net ${s.cumulativeNet.toFixed(1)} fantasy points while assets were held. This measures results, not current roster fit.` : 'No realized scoring signal yet; a letter would be misleading.'}</p>
            </div>)}
            {t.hasPendingPicks && <p>Unresolved picks can change these grades.</p>}
            <button type="button" className="af-cm-quickbtn" onClick={() => onAsk(`Explain completed trade ${t.id} (${t.season}, week ${t.week}): ${t.sides.map(s => `${s.teamName || s.managerName} received ${[...s.playersIn.map(p => p.name), ...s.picksIn.map(p => p.label)].join(', ')}`).join('; ')}. How does it affect my team in this league?`)}>Ask Chimmy</button>
          </article>
        })}
        {history?.ledger?.notes.map(note => <p key={note}>{note}</p>)}
        {history?.ledger?.trades.slice(0, visible).map(t => <article key={t.id}><strong>{t.season} · Grade unavailable</strong>{t.sides.map(s => <p key={s.teamId}>{s.managerName} received {s.received.map(p => p.name || p.playerId).join(', ')}</p>)}</article>)}
        {history && !trades.length && !history.ledger?.trades.length && <p>No completed trade history available for this league.</p>}
        {Math.max(proposals.length, trades.length, history?.ledger?.trades.length ?? 0) > visible && <button type="button" className="af-cm-linkbtn" onClick={() => setVisible(v => v + 10)}>Show more trades</button>}
      </>}
    </div>}
  </section>
}
