'use client'

import { useCallback, useState } from 'react'

/**
 * Decision OS · Trade Finder, on the Trade Center.
 *
 * The engine already existed — `getTradeFinder` behind
 * `/api/league/trade-finder` — and rendered on a different page. This brings it
 * onto the surface where a manager is actually building a deal.
 *
 * ⚠ FOUR REFUSALS, AND THEY ARE DIFFERENT ANSWERS. The route distinguishes an
 * unsupported platform, an unlinked Sleeper account, a temporary outage, and a
 * genuine "nothing to suggest". Collapsing those into one empty state would tell
 * a Yahoo manager there are no trades available when what is true is that we
 * never looked.
 */

type Side = {
  name: string
  position: string | null
  team: string | null
  marketValue: number | null
}

type Proposal = {
  partner: { name: string; teamName: string | null; completedTrades: number }
  give: Side
  get: Side
  valueGapPct: number | null
  /** Checkable facts only, per the service's own type comment. */
  rationale: string[]
}

type FinderResponse = {
  supported?: boolean
  linked?: boolean
  error?: string
  finder?: {
    proposals: Proposal[]
    contextNotes: string[]
    missing: string[]
  } | null
}

function money(v: number | null): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString() : '—'
}

export function TradeFinderPanel(props: { leagueId: string | null }) {
  const [data, setData] = useState<FinderResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!props.leagueId) return
    setBusy(true)
    try {
      const r = await fetch(
        `/api/league/trade-finder?leagueId=${encodeURIComponent(props.leagueId)}`,
      )
      const j = (await r.json().catch(() => ({}))) as FinderResponse
      setData(j)
    } catch {
      setData({ error: 'Trade finder could not be reached.' })
    } finally {
      setBusy(false)
    }
  }, [props.leagueId])

  if (!props.leagueId) return null

  return (
    <section className="af-tc-dos">
      <div className="af-label">Decision OS · Trade Finder</div>

      {data == null ? (
        <>
          <p className="af-tc-row-sub">
            Look across this league for managers whose roster shape fits yours.
          </p>
          <button type="button" className="af-btn af-btn--ghost" onClick={load} disabled={busy}>
            {busy ? 'Looking…' : 'Find trade partners'}
          </button>
        </>
      ) : null}

      {/* Each refusal says which one it is. */}
      {data?.supported === false ? (
        <p className="af-tc-row-sub">
          Trade Finder reads a Sleeper league&rsquo;s rosters directly, so it does not run on this
          platform yet. That is a gap in what we can see, not a verdict about your league.
        </p>
      ) : null}

      {data?.supported === true && data.linked === false ? (
        <p className="af-tc-row-sub">
          Link your Sleeper account to use this — it needs to know which team is yours before it
          can suggest anyone to trade with.
        </p>
      ) : null}

      {data?.error ? <p className="af-tc-nosignal">{data.error}</p> : null}

      {data?.finder ? (
        <>
          {data.finder.proposals.length === 0 ? (
            <p className="af-tc-row-sub">
              Nothing worth suggesting in this league right now. That is a real answer — no roster
              here has a shape that pairs cleanly with yours.
            </p>
          ) : (
            <div className="af-tc-pairs">
              {data.finder.proposals.slice(0, 6).map((p) => (
                <div key={`${p.partner.name}-${p.get.name}`} className="af-tc-pair">
                  <div className="af-tc-pair-label">
                    {p.partner.teamName || p.partner.name}
                    {p.partner.completedTrades > 0
                      ? ` · ${p.partner.completedTrades} trades made`
                      : ' · never traded'}
                  </div>
                  <div className="af-tc-pair-value" style={{ fontSize: 13 }}>
                    {p.get.name} <span style={{ opacity: 0.5 }}>for</span> {p.give.name}
                  </div>
                  <p className="af-tc-row-sub">
                    {money(p.get.marketValue)} for {money(p.give.marketValue)}
                    {p.valueGapPct != null ? ` · ${Math.abs(Math.round(p.valueGapPct))}% apart` : ''}
                  </p>
                  {/*
                    Rationale is checkable facts only — the service's own type says
                    so. Rendered verbatim rather than summarised, because a
                    paraphrase would turn a fact into an opinion.
                  */}
                  {p.rationale.slice(0, 2).map((r) => (
                    <p key={r} className="af-tc-row-sub">
                      {r}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}

          {data.finder.missing.length > 0 ? (
            <p className="af-tc-row-sub">
              Working without: {data.finder.missing.join(', ')}. Suggestions are thinner than they
              would be with those.
            </p>
          ) : null}

          {data.finder.contextNotes.slice(0, 2).map((n) => (
            <p key={n} className="af-tc-row-sub">
              {n}
            </p>
          ))}
        </>
      ) : null}
    </section>
  )
}
