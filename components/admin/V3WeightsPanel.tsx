"use client"

import React, { useMemo, useState } from "react"
import { useV3ModelAdmin } from "@/hooks/useV3ModelAdmin"
import { DriftDashboard } from "@/components/DriftDashboard"

/**
 * ⚠ FIELD COLOURS ARE TOKENS, NOT `bg-zinc-*`/`bg-white`. The global light-mode
 * `.mode-readable` clamp keys on tokens; a literal Tailwind background survives
 * it and inverts to unreadable in light mode. Layout classes are fine — it is
 * colour and surface that must go through `var(--…)`.
 */
const fieldStyle: React.CSSProperties = {
  background: 'var(--surface2)',
  border: '1px solid var(--line)',
  color: 'var(--text)',
}

function NumberInput(props: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      className="af-num w-20 rounded-xl px-3 py-2 text-sm"
      style={fieldStyle}
      type="number"
      step="0.01"
      value={props.value}
      onChange={(e) => props.onChange(Number(e.target.value))}
    />
  )
}

export function V3WeightsPanel(props: { leagueId: string; season: string; defaultWeek: number }) {
  const admin = useV3ModelAdmin({ leagueId: props.leagueId, season: props.season })

  const defaults = admin.weights?.default ?? { win: 0.22, power: 0.33, luck: 0.1, market: 0.2, skill: 0.15 }

  const [week, setWeek] = useState<number>(props.defaultWeek)
  const [reason, setReason] = useState<string>("manual snapshot")

  const [win, setWin] = useState<number>(defaults.win ?? 0.22)
  const [power, setPower] = useState<number>(defaults.power ?? 0.33)
  const [luck, setLuck] = useState<number>(defaults.luck ?? 0.1)
  const [market, setMarket] = useState<number>(defaults.market ?? 0.2)
  const [skill, setSkill] = useState<number>(defaults.skill ?? 0.15)

  useMemo(() => {
    setWin(defaults.win ?? 0.22)
    setPower(defaults.power ?? 0.33)
    setLuck(defaults.luck ?? 0.1)
    setMarket(defaults.market ?? 0.2)
    setSkill(defaults.skill ?? 0.15)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin.weights?.default])

  return (
    <div className="space-y-4">
      <section className="af-frame" style={{ padding: 16 }}>
        <div className="af-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div className="af-label">V3 weights snapshots</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Season {props.season} · stored snapshots + drift monitoring
            </div>
          </div>
          <button className="af-btn af-btn--ghost" disabled={admin.loading} onClick={() => admin.refresh()}>
            {admin.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/*
          ⚠ A FAILED LOAD IS NOT AN EMPTY LIST. This used to render as dimmed
          body text above "No snapshots yet.", so a read failure and a league
          with no snapshots looked identical. Severity styling makes the
          difference visible.
        */}
        {admin.error ? (
          <div className="af-issue" data-severity="bad" style={{ marginBottom: 12 }}>
            Snapshots could not be read: {admin.error}
          </div>
        ) : null}

        <div className="af-card">
          <div className="af-label" style={{ marginBottom: 8 }}>Create snapshot</div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="af-label" style={{ color: 'var(--muted)' }}>Week</div>
            <input
              className="af-num w-24 rounded-xl px-3 py-2 text-sm"
              style={fieldStyle}
              type="number"
              value={week}
              onChange={(e) => setWeek(Number(e.target.value))}
            />
            <div className="af-label ml-2" style={{ color: 'var(--muted)' }}>Reason</div>
            <input
              className="min-w-[240px] flex-1 rounded-xl px-3 py-2 text-sm"
              style={fieldStyle}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 items-center gap-2 md:grid-cols-5">
            {([
              ['win', win, setWin],
              ['power', power, setPower],
              ['luck', luck, setLuck],
              ['market', market, setMarket],
              ['skill', skill, setSkill],
            ] as const).map(([label, value, onChange]) => (
              <div key={label}>
                <div className="af-label" style={{ color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
                <NumberInput value={value} onChange={onChange} />
              </div>
            ))}
          </div>

          <div className="mt-3">
            {/* ⚠ `af-btn`, never `bg-white text-black` — that literal was the exact
                shape the light-mode clamp cannot reach. */}
            <button
              className="af-btn"
              disabled={admin.loading}
              onClick={() =>
                admin.createSnapshot({
                  season: props.season,
                  week,
                  reason,
                  weights: { win, power, luck, market, skill }
                })
              }
            >
              Save snapshot
            </button>
          </div>
        </div>

        <div className="af-card" style={{ marginTop: 16 }}>
          <div className="af-label" style={{ marginBottom: 8 }}>Recent snapshots</div>
          <div className="max-h-64 overflow-auto text-sm">
            {(admin.weights?.rows ?? []).map((r: any) => (
              <div
                key={String(r.id)}
                className="af-row"
                style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--line2)', padding: '8px 0' }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {r.season} · Week {r.week}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.reason ?? "—"}</div>
                </div>
                <div className="af-num" style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>
                  <div>win {r.weights?.win ?? "—"}</div>
                  <div>power {r.weights?.power ?? "—"}</div>
                  <div>market {r.weights?.market ?? "—"}</div>
                </div>
              </div>
            ))}
            {/*
              ⚠ ONLY CLAIMED WHEN KNOWN. Rendered only once loading has finished
              AND no error is set — otherwise "No snapshots yet" states an
              absence we have not established, which is the same confident lie
              the live surfaces refuse to tell.
            */}
            {!admin.loading && !admin.error && !admin.weights?.rows?.length ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                No snapshots recorded for this league yet.
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <DriftDashboard leagueId={props.leagueId} />
    </div>
  )
}
