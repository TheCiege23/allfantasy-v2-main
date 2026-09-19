'use client'

import { useEffect, useState } from 'react'
import type { TradeGradesPayload } from '@/lib/trade-intel/sleeperTradeGradeService'
import type { ImportedTradeLedgerPayload } from '@/lib/trade-intel/importedTradeLedgerService'
import type { LeagueTradeHistoryItem } from '@/components/league/types'

type Proposal = { id: string; title: string; status: string; involvesYou: boolean; assets: string[]; grade: string | null; explanation: string }
type History = { supported: boolean; grades?: TradeGradesPayload; ledger?: ImportedTradeLedgerPayload; viewerSleeperUserId?: string | null; sync?: { incomplete: boolean } }
type TradeCenter = { activeTrades?: LeagueTradeHistoryItem[]; historyTrades?: LeagueTradeHistoryItem[]; pending?: { scanned: boolean; reason?: string | null } }

function TradeCenterCard({ trade, active, onAsk }: { trade: LeagueTradeHistoryItem; active: boolean; onAsk: (question: string) => void }) {
  const hasGrade = active ? (trade.decisionCoveragePct ?? 0) >= 60 : trade.currentPricingComplete === true
  const grade = hasGrade ? (active ? trade.proposalGrade : trade.currentGrade) : null
  const title = trade.proposerName && trade.receiverName ? `${trade.proposerName} → ${trade.receiverName}` : `Trade with ${trade.partnerName}`
  const sent = trade.sent.map(asset => asset.label).join(', ') || 'No recorded assets'
  const received = trade.received.map(asset => asset.label).join(', ') || 'No recorded assets'
  const viewerIsParty = trade.viewerIsProposer || trade.viewerIsReceiver
  return <article>
    <strong>{title}</strong>
    <p>{trade.status || (active ? 'Open offer' : 'Recorded trade')} · {grade ? `Current ${active ? 'proposal' : 'market'} grade ${grade}` : 'Grade unavailable'}</p>
    <p>{active && viewerIsParty ? 'You send' : 'Sent'}: {sent}</p>
    <p>{active && viewerIsParty ? 'You receive' : 'Received'}: {received}</p>
    <p>{active && trade.decisionRecommendation ? trade.decisionRecommendation : grade ? `Repriced using this league's current player values. This is not a realized-points grade.` : 'Verified valuation coverage is incomplete; no letter grade is shown.'}</p>
    {!active && trade.currentUnresolvedAssets?.length ? <p>Unpriced: {trade.currentUnresolvedAssets.join(', ')}</p> : null}
    <button type="button" className="af-cm-quickbtn" onClick={() => onAsk(`Explain ${trade.status || 'recorded'} trade ${trade.id}: ${title}. Recorded sent assets: ${sent}. Recorded received assets: ${received}. Verify which side is mine, then explain the grade and whether it fits my roster and this league's rules.`)}>Ask Chimmy</button>
  </article>
}

export function ChimmyTrades({ leagueId, onAsk }: { leagueId: string; onAsk: (question: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [history, setHistory] = useState<History | null>(null)
  const [tradeCenter, setTradeCenter] = useState<TradeCenter | null>(null)
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
    Promise.allSettled([readProposals(), read(base), read(`/api/league/trades-panel?leagueId=${encodeURIComponent(leagueId)}`)]).then(([offers, completed, center]) => {
      if (controller.signal.aborted) return
      setProposals(offers.status === 'fulfilled' ? offers.value : [])
      setHistory(completed.status === 'fulfilled' ? completed.value : null)
      setTradeCenter(center.status === 'fulfilled' ? center.value : null)
      if (offers.status === 'rejected' || completed.status === 'rejected' || center.status === 'rejected') setError('Some trade activity could not be loaded. Retry to refresh it.')
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
        <h3>Open league offers</h3>
        {tradeCenter?.pending?.scanned === false && tradeCenter.pending.reason && <p>{tradeCenter.pending.reason}</p>}
        {(tradeCenter?.activeTrades ?? []).slice(0, visible).map(trade => <TradeCenterCard key={trade.id} trade={trade} active onAsk={onAsk} />)}
        {tradeCenter && !tradeCenter.activeTrades?.length && <p>No accessible open offers returned by the Trade Center.</p>}
        <h3>Redraft proposals and approvals</h3>
        {proposals.length === 0 && <p>No accessible AllFantasy proposals loaded.</p>}
        {proposals.slice(0, visible).map(p => <article key={p.id}>
          <strong>{p.title}</strong><p>{p.status}{p.involvesYou ? ' · Your trade' : ''} · {p.grade ? `Fairness snapshot ${p.grade}` : 'Grade unavailable'}</p>
          <p>{p.assets.join(' · ')}</p><p>{p.explanation}</p>
          <button type="button" className="af-cm-quickbtn" onClick={() => onAsk(`Explain proposal ${p.id}: ${p.title}, involving ${p.assets.join(', ')}. Does it fit my roster and this league's rules? Distinguish the historical fairness snapshot from a current recommendation.`)}>Ask Chimmy</button>
        </article>)}
        {!!tradeCenter?.historyTrades?.length && <>
          <h3>Recent league trade decisions</h3>
          <p>Includes approved, processed and other recorded decisions available from the Trade Center. Current market grades differ from the realized results below.</p>
          {tradeCenter.historyTrades.slice(0, visible).map(trade => <TradeCenterCard key={trade.id} trade={trade} active={false} onAsk={onAsk} />)}
        </>}
        <h3>Completed trade results</h3>
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
        {Math.max(proposals.length, trades.length, history?.ledger?.trades.length ?? 0, tradeCenter?.activeTrades?.length ?? 0, tradeCenter?.historyTrades?.length ?? 0) > visible && <button type="button" className="af-cm-linkbtn" onClick={() => setVisible(v => v + 10)}>Show more trades</button>}
      </>}
    </div>}
  </section>
}
