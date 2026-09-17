'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { WaiverOversight as WaiverOversightData } from '@/lib/core-app/commissionerWaivers'
import '@/components/core-app/af-commish-waivers.css'

/**
 * Waiver Oversight — Commissioner Hub section (handoff 2026-09-13).
 *
 * The one client island is the "Run waivers now" button, and it only ever posts to
 * the existing manual-run action, which re-checks the commissioner server-side. See
 * lib/core-app/commissionerWaivers.ts for why there is no "re-run failed claims".
 */
export function WaiverOversight({ data }: { data: WaiverOversightData }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  if (!data.available) {
    return (
      <section id="ch-waivers" className="af-card af-ch-section" aria-labelledby="af-chw-title">
        <header className="af-ch-section-head">
          <h2 id="af-chw-title" className="af-label">
            Waiver oversight
          </h2>
        </header>
        <div className="af-ch-empty">
          <span className="af-ch-empty-mark af-num" aria-hidden>
            —
          </span>
          <p>{data.reason}</p>
        </div>
      </section>
    )
  }

  async function runNow() {
    if (running || !data.available) return
    setRunning(true)
    setNote(null)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(data.leagueId)}/waivers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = (await res.json().catch(() => null)) as { processed?: number; error?: string } | null
      if (!res.ok) {
        setNote({ tone: 'bad', text: body?.error ? `Not run: ${body.error}.` : 'Not run. Try again in a moment.' })
        return
      }
      const n = body?.processed ?? 0
      setNote({
        tone: 'good',
        text: n === 0 ? 'Nothing processed — waivers are locked or no claims were waiting.' : `Processed ${n} ${n === 1 ? 'claim' : 'claims'}.`,
      })
      router.refresh()
    } catch {
      setNote({ tone: 'bad', text: 'Not run — the connection dropped.' })
    } finally {
      setRunning(false)
    }
  }

  const run = data.lastRun
  const runWhen = run
    ? new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(run.at))
    : null

  return (
    <section id="ch-waivers" className="af-chw" aria-labelledby="af-chw-title">
      <div className="af-chw-rule">
        <h2 id="af-chw-title" className="af-label">
          Waiver oversight
        </h2>
        <span className="af-chw-line" aria-hidden />
        <Link className="af-chw-link" href={`/core/waivers?league=${encodeURIComponent(data.leagueId)}`}>
          Waiver rules →
        </Link>
      </div>

      <div className="af-chw-grid">
        <div className="af-card af-ch-section">
          <header className="af-ch-section-head">
            <h3 className="af-label">
              {data.faabBudget != null ? `FAAB budgets · $${data.faabBudget.toLocaleString('en-US')} season` : data.waiverTypeLabel}
            </h3>
            {data.nextRun ? <span className="af-ch-section-note af-num">Runs {data.nextRun}</span> : null}
          </header>
          {data.budgets.length > 0 ? (
            <ul className="af-chw-list">
              {data.budgets.map((b) => (
                <li key={b.rosterId} className="af-chw-row">
                  <span className="af-chw-mark af-num" aria-hidden>
                    {b.initials}
                  </span>
                  <span className="af-chw-main">
                    <span className="af-chw-name">
                      {b.handle} <span className="af-chw-sub">${b.spent.toLocaleString('en-US')} spent</span>
                    </span>
                    <span
                      className="af-chw-bar"
                      role="meter"
                      aria-label={`${b.handle} FAAB remaining`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={b.pct}
                    >
                      <i data-tone={b.tone} style={{ width: `${b.pct}%` }} />
                    </span>
                  </span>
                  <span className="af-chw-amt af-num" data-tone={b.tone}>
                    ${b.remaining.toLocaleString('en-US')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="af-chw-why">{data.budgetsReason}</p>
          )}
        </div>

        <div className="af-card af-ch-section">
          <header className="af-ch-section-head">
            <h3 className="af-label">{run ? `Last run · ${runWhen} ET` : 'Last run'}</h3>
            {run ? <span className="af-ch-section-note">{run.runType === 'manual' ? 'Run by a commissioner' : 'Scheduled'}</span> : null}
          </header>

          {run?.stuck ? (
            <p className="af-chw-stuck" role="status">
              This run started and never finished, so some claims were not processed.
            </p>
          ) : null}

          {run && run.rows.length > 0 ? (
            <ul className="af-chw-list">
              {run.rows.map((r) => (
                <li key={r.id} className="af-chw-row">
                  <span className="af-chw-main">
                    <span className="af-chw-name">{r.player}</span>
                    <span className="af-chw-sub">
                      {r.manager}
                      {r.bid != null ? ` · $${r.bid} bid` : ''}
                    </span>
                  </span>
                  <span className="af-chw-chip" data-result={r.result}>
                    {r.label}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="af-chw-why">{run ? 'The last run processed no claims.' : 'No waiver run has processed in this league yet.'}</p>
          )}

          {data.pendingCount > 0 ? (
            data.canRunNow ? (
              <div className="af-chw-run">
                <button type="button" className="af-btn af-chw-btn" onClick={() => void runNow()} disabled={running}>
                  {running ? 'Running…' : `Run waivers now · ${data.pendingCount} waiting`}
                </button>
                <p className="af-chw-sub" aria-live="polite" data-tone={note?.tone}>
                  {note?.text ?? 'Processes the claims waiting now, by this league’s rules. Settled claims are not re-run.'}
                </p>
              </div>
            ) : (
              <p className="af-chw-why">
                {data.pendingCount} {data.pendingCount === 1 ? 'claim is' : 'claims are'} waiting. Only the primary
                commissioner can run waivers manually.
              </p>
            )
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default WaiverOversight
