'use client'

import '@/components/core-app/af-waivers.css'
import type { WaiversData } from '@/lib/core-app/waivers'
import type { SectionState } from '@/lib/core-app/leagueHome'

/**
 * Screen 7 — Waivers.
 *
 * "Targets, bids and claim order — priced against this league's FAAB and your
 * holes."
 *
 * The handoff builds the honesty rule into the design here: "Some platforms
 * don't publish remaining FAAB. When that happens AllFantasy says so." That is
 * implemented literally — an unknown budget shows the sentence, never "$0",
 * because "$0" says you have nothing to bid rather than that we do not know.
 */

export type WaiversProps = {
  data: WaiversData
}

function Tile({
  label,
  state,
  render,
  sub,
}: {
  label: string
  state: SectionState<unknown>
  render?: (d: never) => { value: string; sub?: string }
  sub?: string
}) {
  if (!state.available) {
    return (
      <div className="af-wv-tile" data-missing="true">
        <div className="af-wv-tile-value af-num">—</div>
        <div className="af-label">{label}</div>
        <div className="af-wv-tile-why">{state.reason}</div>
      </div>
    )
  }
  const out = render ? render(state.data as never) : { value: String(state.data), sub }
  return (
    <div className="af-wv-tile">
      <div className="af-wv-tile-value af-num">{out.value}</div>
      <div className="af-label">{label}</div>
      {out.sub ? <div className="af-wv-tile-sub">{out.sub}</div> : null}
    </div>
  )
}

export function Waivers({ data }: WaiversProps) {
  return (
    <div className="af-wv">
      {/* ── Pricing context ─────────────────────────────────────────── */}
      <div className="af-wv-context">
        <span className="af-label">Priced for this league</span>
        <p className="af-wv-context-body">
          Bids and targets would be priced against <strong>{data.league.name}</strong>
          {data.league.format ? ` — ${data.league.format}` : ''}. The same player is worth a
          different amount in a different league.
        </p>
      </div>

      {/* ── Tiles ───────────────────────────────────────────────────── */}
      <div className="af-wv-tiles">
        <Tile
          label="Your FAAB"
          state={data.budget}
          render={(d: never) => {
            const b = d as unknown as {
              faabRemaining: number
              rankByBudget: number | null
              rostersWithBudget: number
            }
            return {
              value: `$${b.faabRemaining}`,
              sub:
                b.rankByBudget != null
                  ? `${b.rankByBudget} of ${b.rostersWithBudget} by budget left`
                  : undefined,
            }
          }}
        />

        <Tile
          label="Waiver priority"
          state={data.waiverPriority}
          render={(d: never) => {
            const w = d as unknown as { priority: number; leagueRosters: number }
            return { value: `#${w.priority}`, sub: `of ${w.leagueRosters} rosters` }
          }}
        />

        <Tile
          label="Players held"
          state={data.rosterLoad}
          render={(d: never) => {
            const r = d as unknown as { playersHeld: number; starters: number; bench: number; reserve: number }
            return {
              value: String(r.playersHeld),
              sub: `${r.starters} starting · ${r.bench} bench${r.reserve > 0 ? ` · ${r.reserve} IR/taxi` : ''}`,
            }
          }}
        />

        <Tile
          label="Claims queued"
          state={data.claimsQueued}
          render={(d: never) => {
            const c = d as unknown as { count: number }
            return { value: String(c.count), sub: c.count === 0 ? 'nothing pending' : undefined }
          }}
        />
      </div>

      {/* ── Waiver rules ────────────────────────────────────────────── */}
      <section className="af-card af-wv-section">
        <h2 className="af-label">How waivers run here</h2>
        <ul className="af-wv-rules">
          <li>
            <span className="af-wv-rule-key">Waiver type</span>
            {data.waiverType.available ? (
              <span className="af-wv-rule-value">
                {data.waiverType.data.label}
                {data.waiverType.data.budget != null ? (
                  <span className="af-wv-rule-budget af-num">
                    ${data.waiverType.data.budget} budget
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="af-wv-rule-why">{data.waiverType.reason}</span>
            )}
          </li>
          <li>
            <span className="af-wv-rule-key">Waivers run</span>
            {data.processTime.available ? (
              <span className="af-wv-rule-value">
                {data.processTime.data.dayLabel}
                {/*
                  ⚠ "UTC" IS NOT NOISE — IT IS THE ONLY HONEST LABEL. The stored
                  column is processingTimeUtc, and League.timezone cannot localise
                  it: that column is @default("America/New_York") and all 120
                  production leagues carry exactly the default, so converting would
                  shift the hour by a timezone nobody actually chose.
                */}
                <span className="af-wv-rule-budget af-num">
                  {data.processTime.data.timeUtc} UTC
                </span>
              </span>
            ) : (
              <span className="af-wv-rule-why">{data.processTime.reason}</span>
            )}
          </li>
        </ul>
      </section>

      {/* ── Suggested claims ────────────────────────────────────────── */}
      <section className="af-card af-wv-section">
        <header className="af-wv-section-head">
          <h2 className="af-label">Suggested claims</h2>
          <span className="af-wv-section-note">Ranked by confidence, not by hype</span>
        </header>

        {/*
          The ranked list the handoff shows, withheld. A confidence score and a
          dollar bid are the two most directly actionable numbers on this screen —
          someone spends real budget on them — so they are the last things that
          should ever be estimated from nothing.
        */}
        <div className="af-wv-empty">
          <div className="af-wv-empty-mark af-num" aria-hidden>
            —
          </div>
          <p className="af-wv-empty-text">{data.suggestedClaims.reason}</p>
        </div>
      </section>

      <p className="af-wv-footnote">
        Claims are made on {data.league.platform === 'manual' ? 'your platform' : data.league.platform}.
        AllFantasy only reads your league.
      </p>
    </div>
  )
}

export default Waivers
