'use client'

import { useEffect, useState } from 'react'
import type { TradeGradesPayload } from '@/lib/trade-intel/sleeperTradeGradeService'
import type { ImportedTradeLedgerPayload } from '@/lib/trade-intel/importedTradeLedgerService'
import type { LeagueTradeHistoryItem } from '@/components/league/types'
import { assetValues, gradeReasons, type importedTradeTimelineRows } from '@/lib/core-app/importedTradeTimeline'
import { gradeMoment } from '@/lib/decision-os/trade/gradeMoment'

type Proposal = { id: string; title: string; status: string; involvesYou: boolean; assets: string[]; grade: string | null; explanation: string }
type History = { supported: boolean; grades?: TradeGradesPayload; ledger?: ImportedTradeLedgerPayload; viewerSleeperUserId?: string | null; sync?: { incomplete: boolean } }
/** A completed trade on THE grade, as `trades-panel?history=1` returns it (the Trade Center's rows). */
type GradedHistoryRow = ReturnType<typeof importedTradeTimelineRows>[number]
type TradeCenter = {
  activeTrades?: LeagueTradeHistoryItem[]
  historyTrades?: LeagueTradeHistoryItem[]
  pending?: { scanned: boolean; reason?: string | null }
  importedHistory?: { rows: GradedHistoryRow[]; available: boolean }
}

/**
 * The one sentence Chimmy is handed about a trade's grade — the letters and values it was graded on,
 * so an answer explains THE grade instead of inventing one. Empty when there is no grade.
 */
function gradeFact(
  aName: string,
  bName: string,
  g: { letter: string; partnerLetter: string; getValue: number; giveValue: number; frozenAt?: string | null } | null,
): string {
  if (!g) return ''
  // A completed trade's letter is its frozen original — tell Chimmy WHEN, so it does not call it today's.
  return ` The AllFantasy grade on this league's values ${gradeMoment(g)} is ${aName} ${g.letter} (got ${g.getValue.toLocaleString()} for ${g.giveValue.toLocaleString()}) and ${bName} ${g.partnerLetter}.`
}

function TradeCenterCard({ trade, active, onAsk }: { trade: LeagueTradeHistoryItem; active: boolean; onAsk: (question: string) => void }) {
  /*
   * 🛑 THE ONE GRADE FIRST (2026-09-27). A completed provider trade carries `leagueGrade` from the
   * panel — graded, from the viewer's side — but this card only trusted `currentPricingComplete`,
   * which those rows never set, so a graded trade read "Grade unavailable". Where the one grade is
   * on the row it is shown for BOTH teams; the older single letter is the fallback.
   */
  const one = !active && trade.leagueGrade?.graded && trade.leagueGradeSide !== 'proposer' ? trade.leagueGrade : null
  const hasGrade = active ? (trade.decisionCoveragePct ?? 0) >= 60 : trade.currentPricingComplete === true
  const grade = hasGrade ? (active ? trade.proposalGrade : trade.currentGrade) : null
  const title = trade.proposerName && trade.receiverName ? `${trade.proposerName} → ${trade.receiverName}` : `Trade with ${trade.partnerName}`
  const sent = trade.sent.map(asset => asset.label).join(', ') || 'No recorded assets'
  const received = trade.received.map(asset => asset.label).join(', ') || 'No recorded assets'
  const viewerIsParty = trade.viewerIsProposer || trade.viewerIsReceiver
  return <article>
    <strong>{title}</strong>
    <p>{trade.status || (active ? 'Open offer' : 'Recorded trade')} · {one
      ? `League grade: you ${one.letter} · ${trade.partnerName} ${one.partnerLetter}`
      : grade ? `Current ${active ? 'proposal' : 'market'} grade ${grade}` : 'Grade unavailable'}</p>
    <p>{active && viewerIsParty ? 'You send' : 'Sent'}: {sent}</p>
    <p>{active && viewerIsParty ? 'You receive' : 'Received'}: {received}</p>
    <p>{active && trade.decisionRecommendation
      ? trade.decisionRecommendation
      : one ? `You got ${one.getValue.toLocaleString()} for ${one.giveValue.toLocaleString()} on this league's values ${gradeMoment(one)}.`
      : grade ? `Repriced using this league's current player values. This is not a realized-points grade.` : 'Verified valuation coverage is incomplete; no letter grade is shown.'}</p>
    {!active && trade.currentUnresolvedAssets?.length ? <p>Unpriced: {trade.currentUnresolvedAssets.join(', ')}</p> : null}
    <button type="button" className="af-cm-quickbtn" onClick={() => onAsk(`Explain ${trade.status || 'recorded'} trade ${trade.id}: ${title}. Recorded sent assets: ${sent}. Recorded received assets: ${received}.${gradeFact('my side', trade.partnerName, one)} Verify which side is mine, then explain the grade and whether it fits my roster and this league's rules.`)}>Ask Chimmy</button>
  </article>
}

/**
 * A completed trade on THE grade (2026-09-27): each team's letter, what each side got with its value,
 * and the grade's own reasons. Realized points, where the ledger has them, stay beside it as a FACT
 * with no letter — the realized letter is the second grade retired from every other surface.
 */
function GradedHistoryCard({ row, realized, onAsk }: { row: GradedHistoryRow; realized: Map<string, number>; onAsk: (question: string) => void }) {
  const g = row.leagueGrade?.graded ? row.leagueGrade : null
  const a = row.sideAYou ? 'You' : row.sideAName
  const b = row.sideBYou ? 'You' : row.sideBName
  const sentValues = g ? assetValues(row.sent, g.lines, 'give') : []
  const receivedValues = g ? assetValues(row.received, g.lines, 'get') : []
  const list = (assets: GradedHistoryRow['sent'], values: Array<number | null>) =>
    assets.map((asset, i) => `${asset.label}${values[i] != null ? ` (${Math.round(values[i]!).toLocaleString()})` : ''}`).join(', ') || 'No recorded assets'
  const net = (name: string) => realized.get(name)
  const when = row.timestamp ? new Date(row.timestamp).toLocaleDateString() : 'Date unavailable'
  return <article>
    <strong>{when} · {a} ↔ {b}</strong>
    <p>{g ? `League grade: ${a} ${g.letter} · ${b} ${g.partnerLetter}` : row.leagueGrade && !row.leagueGrade.graded ? `Not graded: ${row.leagueGrade.reason}` : 'Grade unavailable'}</p>
    <p>{a} sent: {list(row.sent, sentValues)}</p>
    <p>{b} sent: {list(row.received, receivedValues)}</p>
    {g ? gradeReasons(g, a, b).map(line => <p key={line}>{line}</p>) : null}
    {[row.sideAName, row.sideBName].some(name => net(name) != null) ? (
      <p>Realized so far: {[row.sideAName, row.sideBName].filter(name => net(name) != null).map(name => `${name} net ${net(name)!.toFixed(1)} fantasy points`).join(' · ')} while the assets were held.</p>
    ) : null}
    <button type="button" className="af-cm-quickbtn" onClick={() => onAsk(`Explain completed trade ${row.id} (${when}): ${a} sent ${list(row.sent, sentValues)}; ${b} sent ${list(row.received, receivedValues)}.${gradeFact(a, b, g)} Explain why it graded that way and how it affects my team in this league.`)}>Ask Chimmy</button>
  </article>
}

export function ChimmyTrades({ leagueId, onAsk }: { leagueId: string; onAsk: (question: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [draftProposals, setDraftProposals] = useState<Proposal[]>([])
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
    const readDraftProposals = async () => {
      const rows: Proposal[] = []
      let cursor: string | null = null
      do {
        const page = await read(`${base}&view=draft-proposals${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        rows.push(...page.proposals)
        cursor = page.nextCursor
      } while (cursor)
      return rows
    }
    Promise.allSettled([readProposals(), readDraftProposals(), read(base), read(`/api/league/trades-panel?leagueId=${encodeURIComponent(leagueId)}&history=1`)]).then(([offers, draftOffers, completed, center]) => {
      if (controller.signal.aborted) return
      setProposals(offers.status === 'fulfilled' ? offers.value : [])
      setDraftProposals(draftOffers.status === 'fulfilled' ? draftOffers.value : [])
      setHistory(completed.status === 'fulfilled' ? completed.value : null)
      setTradeCenter(center.status === 'fulfilled' ? center.value : null)
      if (offers.status === 'rejected' || draftOffers.status === 'rejected' || completed.status === 'rejected' || center.status === 'rejected') setError('Some trade activity could not be loaded. Retry to refresh it.')
      setBusy(false)
    })
    return () => controller.abort()
  }, [expanded, leagueId, revision])

  const trades = history?.grades?.trades ?? []
  const graded = tradeCenter?.importedHistory?.available ? tradeCenter.importedHistory.rows : null
  /*
   * Realized points per trade and team, from the ledger — shown as a FACT beside THE grade, never as a
   * letter. Only where the ledger has a real scoring signal: zero credited points is not a result.
   */
  const realizedByTx = new Map<string, Map<string, number>>()
  for (const t of trades) {
    const signal = t.sides.some(s => [...s.playersIn, ...s.playersOut].some(p => Object.values(p.creditedBySeason).some(n => n !== 0)) || [...s.picksIn, ...s.picksOut].some(p => p.resolved && Object.values(p.resolved.creditedBySeason).some(n => n !== 0)))
    if (!signal) continue
    realizedByTx.set(t.id.split(':').at(-1)!, new Map(t.sides.map(s => [s.teamName ?? s.managerName, s.cumulativeNet] as const)))
  }
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
        <h3>Draft-pick proposals</h3>
        {draftProposals.length === 0 && <p>No accessible draft-pick proposals loaded.</p>}
        {draftProposals.slice(0, visible).map(p => <article key={p.id}>
          <strong>{p.title}</strong>
          <p>{p.status}{p.involvesYou ? ' · Your trade' : ''} · Draft-capital verdict {p.grade}</p>
          <p>{p.assets.join(' · ')}</p><p>{p.explanation}</p>
          <button type="button" className="af-cm-quickbtn" onClick={() => onAsk(`Explain draft-pick proposal ${p.id}: ${p.title}, involving ${p.assets.join(', ')}. The stored deterministic receiver-side verdict is ${p.grade}. Does it fit my draft board, roster and this league's exact draft rules?`)}>Ask Chimmy</button>
        </article>)}
        {!!tradeCenter?.historyTrades?.length && <>
          <h3>Recent league trade decisions</h3>
          <p>Includes approved, processed and other recorded decisions available from the Trade Center, graded on this league&rsquo;s values today.</p>
          {tradeCenter.historyTrades.slice(0, visible).map(trade => <TradeCenterCard key={trade.id} trade={trade} active={false} onAsk={onAsk} />)}
        </>}
        <h3>Completed trade results</h3>
        {history?.grades?.staleAsOf && <p>Cached history; some results may be out of date.</p>}
        {history?.sync?.incomplete && <p>Some provider trades have not finished syncing.</p>}
        {history?.grades?.missing.map(note => <p key={note}>{note}</p>)}
        {graded ? <>
          {/*
            🛑 THE ONE GRADE (2026-09-27). These rows are the Trade Center's own completed-trade rows,
            so a trade reads the same letters here, there, on the league page and in the grade email.
          */}
          <p>Each trade keeps the grade it got the first time AllFantasy graded it on this league&rsquo;s values &mdash; the same grade as the Trade Center. Realized points are shown as a result, not a grade.</p>
          {graded.slice(0, visible).map(row => <GradedHistoryCard key={row.id} row={row} realized={realizedByTx.get(row.id.split(':').at(-1)!) ?? new Map()} onAsk={onAsk} />)}
          {graded.length === 0 && <p>No completed trades on file for this league.</p>}
        </> : trades.slice(0, visible).map(t => {
          /*
           * The graded history could not be read: the ledger's rows, with realized points as a FACT.
           * ⚠ NO REALIZED LETTER — it is the second grade retired everywhere else (2026-09-25), and a
           * letter here would contradict the Trade Center for the same trade.
           */
          const hasSignal = t.sides.some(s => [...s.playersIn, ...s.playersOut].some(p => Object.values(p.creditedBySeason).some(n => n !== 0)) || [...s.picksIn, ...s.picksOut].some(p => p.resolved && Object.values(p.resolved.creditedBySeason).some(n => n !== 0)))
          return <article key={t.id}>
            <strong>{t.season} · Week {t.week}</strong>
            {t.sides.map(s => <div key={s.rosterId}>
              <p><b>{s.teamName || s.managerName}{s.ownerId && s.ownerId === history?.viewerSleeperUserId ? ' (You)' : ''}</b> · League grade unavailable right now</p>
              <p>Received: {[...s.playersIn.map(p => p.name), ...s.picksIn.map(p => p.label)].join(', ') || 'No recorded assets'}</p>
              <p>{hasSignal ? `Realized so far: net ${s.cumulativeNet.toFixed(1)} fantasy points while assets were held.` : 'No realized scoring yet.'}</p>
            </div>)}
            <button type="button" className="af-cm-quickbtn" onClick={() => onAsk(`Explain completed trade ${t.id} (${t.season}, week ${t.week}): ${t.sides.map(s => `${s.teamName || s.managerName} received ${[...s.playersIn.map(p => p.name), ...s.picksIn.map(p => p.label)].join(', ')}`).join('; ')}. How does it affect my team in this league?`)}>Ask Chimmy</button>
          </article>
        })}
        {history?.ledger?.notes.map(note => <p key={note}>{note}</p>)}
        {history?.ledger?.trades.slice(0, visible).map(t => <article key={t.id}><strong>{t.season} · Grade unavailable</strong>{t.sides.map(s => <p key={s.teamId}>{s.managerName} received {s.received.map(p => p.name || p.playerId).join(', ')}</p>)}</article>)}
        {!graded && history && !trades.length && !history.ledger?.trades.length && <p>No completed trade history available for this league.</p>}
        {Math.max(proposals.length, draftProposals.length, trades.length, graded?.length ?? 0, history?.ledger?.trades.length ?? 0, tradeCenter?.activeTrades?.length ?? 0, tradeCenter?.historyTrades?.length ?? 0) > visible && <button type="button" className="af-cm-linkbtn" onClick={() => setVisible(v => v + 10)}>Show more trades</button>}
      </>}
    </div>}
  </section>
}
