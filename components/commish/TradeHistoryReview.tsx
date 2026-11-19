'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  AUDIT_OUTSIDE_PCT,
  basisLabel,
  expectedLabel,
  teamTradeLines,
  type AuditRow,
  type FairnessBand,
  type PairFinding,
} from '@/lib/integrity/tradeAudit'

/**
 * Trade history review (commissioner integrity page). The answer to "those two are colluding": every
 * trade a team made, what each side sent, what it was worth WHEN IT HAPPENED, and whether that sat
 * inside the fair range — postable to the league so the league sees the same numbers.
 */

type TradeAuditView = {
  ready: boolean
  rows: AuditRow[]
  teams: { teamId: string; name: string; trades: number }[]
  pairs: PairFinding[]
}

const BAND_LABEL: Record<FairnessBand, string> = { fair: 'Fair', watch: 'Worth a look', outside: 'Outside fair range' }
const BAND_SEV: Record<FairnessBand, string> = { fair: 'low', watch: 'medium', outside: 'high' }
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

function TradeHistoryReview({ leagueId, view: initial, canPost = true }: { leagueId: string; view?: TradeAuditView; canPost?: boolean }) {
  const [view, setView] = useState<TradeAuditView | null>(initial ?? null)
  const [error, setError] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string | null>(initial?.teams[0]?.teamId ?? null)
  const [post, setPost] = useState<string>('idle')

  useEffect(() => {
    if (initial) return
    let live = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trade-audit`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (TradeAuditView & { error?: string }) | null
        if (!live) return
        if (res.ok && body) {
          setView(body)
          setTeamId((t) => t ?? body.teams[0]?.teamId ?? null)
        } else setError(body?.error ?? `HTTP ${res.status}`)
      })
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
  }, [leagueId, initial])

  const lines = useMemo(() => (view && teamId ? teamTradeLines(view.rows, teamId) : []), [view, teamId])
  const team = view?.teams.find((t) => t.teamId === teamId) ?? null
  const counts = useMemo(() => {
    const c = { fair: 0, watch: 0, outside: 0 }
    for (const l of lines) c[l.band] += 1
    return c
  }, [lines])

  async function postReview() {
    if (!teamId) return
    setPost('posting')
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trade-audit`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      })
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setPost(res.ok ? 'posted' : (body?.error ?? `HTTP ${res.status}`))
    } catch (e) {
      setPost(String(e))
    }
  }

  if (error) return <p className="af-cm-empty">{error}</p>
  if (!view) return <p className="af-cm-sub">Loading trade history…</p>
  if (!view.ready) return <p className="af-cm-empty">Trade history review turns on once its database update is applied.</p>
  if (view.teams.length === 0) return <p className="af-cm-empty">No completed trades audited yet. Each trade is recorded when it goes through.</p>

  return (
    <section className="af-cm-audit" data-testid="trade-history-review">
      {view.pairs.length > 0 ? (
        <div className="af-cm-audit-pairs" data-testid="trade-audit-pairs">
          <div className="af-label">Frequent trading partners</div>
          <ul className="af-cm-evidence">
            {view.pairs.map((p) => (
              <li key={p.teamIds.join('|')}>
                {p.names[0]} and {p.names[1]}: {p.count} trades, {expectedLabel(p.expected)} expected from the league&rsquo;s volume
                {p.outside > 0 ? ` · ${p.outside} outside the fair range` : ''}.
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="af-label">Team</div>
      <div className="af-cm-audit-teams" role="group" aria-label="Team">
        {view.teams.map((t) => (
          <button
            key={t.teamId}
            type="button"
            className="af-cm-seg-btn"
            aria-pressed={t.teamId === teamId}
            onClick={() => {
              setTeamId(t.teamId)
              setPost('idle')
            }}
          >
            {t.name} <span className="af-num">· {t.trades}</span>
          </button>
        ))}
      </div>

      {team ? (
        <>
          <p className="af-cm-audit-summary af-num">
            {lines.length} {lines.length === 1 ? 'trade' : 'trades'} · {counts.fair} fair · {counts.watch} worth a look · {counts.outside} outside the fair range
          </p>
          <ol className="af-cm-audit-list">
            {lines.map((l) => (
              <li key={l.tradeKey} className="af-cm-audit-trade" data-band={l.band}>
                <div className="af-cm-audit-head">
                  <span className="af-num">{l.completedAt ? l.completedAt.slice(0, 10) : 'Date unknown'}</span>
                  <span>with {l.partnerName}</span>
                  <span className="af-cm-sev af-num" data-sev={BAND_SEV[l.band]}>
                    {BAND_LABEL[l.band]} · {Math.round(Math.abs(l.gapPct))}%
                  </span>
                </div>
                <div className="af-cm-audit-sides">
                  <div>
                    <div className="af-label">Sent · {fmt(l.sentValue)}</div>
                    <p>{l.sent.join(', ') || 'Nothing'}</p>
                  </div>
                  <div>
                    <div className="af-label">Received · {fmt(l.receivedValue)}</div>
                    <p>{l.received.join(', ') || 'Nothing'}</p>
                  </div>
                </div>
                <p className="af-cm-audit-basis">
                  {l.band === 'fair' ? 'About even.' : `${l.gapPct > 0 ? team.name : l.partnerName} received more.`} Values {basisLabel(l.basis)}.
                </p>
              </li>
            ))}
          </ol>
          <p className="af-cm-audit-basis">
            League values at the time of each trade, not today&rsquo;s. Fair is a gap under 10%; outside the fair range is over {AUDIT_OUTSIDE_PCT}%, the same line the
            trade review uses.
          </p>
          {canPost ? (
            <div className="af-cm-audit-post">
              <button type="button" className="af-btn af-btn--ghost" data-testid="post-trade-review" disabled={post === 'posting' || post === 'posted'} onClick={() => void postReview()}>
                {post === 'posting' ? 'Posting…' : post === 'posted' ? 'Posted to league chat' : 'Post this review to league chat'}
              </button>
              {post !== 'idle' && post !== 'posting' && post !== 'posted' ? (
                <span className="af-cm-actions-note" role="alert">
                  {post}
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

export default TradeHistoryReview
