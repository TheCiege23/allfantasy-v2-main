"use client"

import React, { useEffect, useState } from "react"
import { apiGet } from "@/lib/api"

/**
 * \u26a0 AN ABSENT METRIC RENDERS AN EM DASH, NEVER A ZERO. `0.0` is a measured
 * calibration error; "we have no reading" is a different fact, and on a drift
 * monitor the two lead opposite ways.
 */
function MetricRow(props: { label: string; value: any }) {
  const missing = props.value === null || props.value === undefined
  return (
    <div className="af-row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: 'var(--muted)' }}>{props.label}</span>
      <span
        className="af-num"
        style={{ fontWeight: 700, color: missing ? 'var(--faint)' : 'var(--text)' }}
      >
        {missing ? "\u2014" : props.value}
      </span>
    </div>
  )
}

export function DriftDashboard(props: { leagueId: string }) {
  const [rows, setRows] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        setError(null)
        const data = await apiGet<{ rows: any[] }>(`/api/leagues/${encodeURIComponent(props.leagueId)}/v3/drift?days=60`)
        if (!cancelled) setRows(data.rows ?? [])
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load drift")
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [props.leagueId])

  const latest = rows.length ? rows[rows.length - 1] : null

  return (
    <section className="af-frame" style={{ padding: 16 }}>
      <div className="af-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 className="af-label">Drift Monitoring</h2>
        <span className="af-label" style={{ color: 'var(--faint)' }}>last 60 days</span>
      </div>

      {/*
        \u26a0 A FAILED READ SAYS SO. An error here used to render beside empty metric
        rows, which reads as "no drift" \u2014 the opposite of what an unread monitor
        means. Same rule the live surfaces follow: could-not-load and nothing-to-
        show are different claims.
      */}
      {error ? (
        <div className="af-issue" data-severity="bad" style={{ marginBottom: 12 }}>
          Drift could not be read: {error}
        </div>
      ) : null}

      {/* Layout stays Tailwind; only surfaces and colour move to af-core tokens,
          which is what the light-mode clamp actually keys on. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="af-card">
          <div className="af-label" style={{ marginBottom: 8 }}>Latest</div>
          <div style={{ display: 'grid', gap: 4 }}>
            <MetricRow label="ECE" value={latest?.ece} />
            <MetricRow label="Brier" value={latest?.brier} />
            <MetricRow label="AUC" value={latest?.auc} />
            <MetricRow label="PSI" value={latest?.psiJson ? "see raw" : null} />
            <MetricRow label="Narrative fail rate" value={latest?.narrativeFailRate} />
          </div>
        </div>

        {/*
          The raw series is kept deliberately. It carried a developer note \u2014
          "hook this into charts later (Recharts)" \u2014 which shipped to admins for
          as long as the panel existed; the note is gone, the data is not. These
          twenty rows are the only place the day-by-day movement is legible, and
          an admin reading them is the panel working, not a placeholder.
        */}
        <div className="af-card">
          <div className="af-label" style={{ marginBottom: 8 }}>Series (raw)</div>
          {rows.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
              {error
                ? 'Not loaded \u2014 see the error above.'
                : 'No drift readings in the last 60 days for this league.'}
            </p>
          ) : (
            <div style={{ maxHeight: 224, overflow: 'auto' }}>
              {rows.slice(-20).map((r, i) => (
                <div
                  key={i}
                  className="af-row"
                  style={{
                    justifyContent: 'space-between',
                    borderBottom: '1px solid var(--line2)',
                    padding: '4px 0',
                    fontSize: 12,
                    color: 'var(--muted)',
                  }}
                >
                  <span className="af-num">{String(r.day).slice(0, 10)}</span>
                  <span className="af-num">
                    ECE {r.ece ?? "\u2014"} &bull; Brier {r.brier ?? "\u2014"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
