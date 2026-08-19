'use client'

/**
 * WaiverIntel — the FAAB bid suggester: league bid history (real winning
 * claims since founding) + market-value-anchored suggestions for available
 * players, needs-tagged. Every formula renders verbatim from the payload.
 */

import { useEffect, useState } from 'react'
import type { WaiverIntelPayload } from '@/lib/waiver-intel/waiverIntelService'
import { sleeperPlayerHeadshot } from '@/lib/sports-data/headshots'
import './broadcast-deck.css'

type ApiResponse =
  | { supported: false; platform: string }
  | { supported: true; intel: WaiverIntelPayload | null; error?: string }

export function WaiverIntel({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetch(`/api/league/waiver-intel?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => res.json() as Promise<ApiResponse>)
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch(() => {
        if (!cancelled) setData({ supported: true, intel: null, error: 'Request failed' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (data && !data.supported) return null
  const intel = data && data.supported ? data.intel : null

  return (
    <div data-testid="waiver-intel" style={{ marginTop: 18 }}>
      <div className="bdx-kick">
        <h2 className="bdx-disp">Waiver intelligence</h2>
        <span className="bdx-sub">
          {intel
            ? `${intel.budget != null ? `$${intel.budget} budget` : 'no FAAB budget set'}${intel.myRemaining != null ? ` · you have $${intel.myRemaining} left` : ''}`
            : 'bids calibrated to this room + the market'}
        </span>
      </div>

      {loading ? (
        <div className="bdx-skel" />
      ) : !intel ? (
        <div className="bdx-empty">
          <div className="t">Waiver intelligence temporarily unavailable</div>
          <div className="m">The first sync scans every waiver claim in league history — try again shortly.</div>
        </div>
      ) : (
        <div className="bdx-support" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
          {/* Targets */}
          <div className="bdx-panelbox">
            <h3>Top available · suggested bids</h3>
            {intel.targets.length > 0 ? (
              <div className="bdx-rows">
                {intel.targets.slice(0, 8).map((t) => {
                  const src = sleeperPlayerHeadshot(t.playerId)
                  return (
                    <div className="bdx-row" key={t.playerId} style={{ alignItems: 'center' }}>
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={src}
                          alt=""
                          loading="lazy"
                          style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', background: '#1c2153', flex: 'none' }}
                          onError={(e) => e.currentTarget.style.setProperty('display', 'none')}
                        />
                      ) : null}
                      <span className="x" style={{ textAlign: 'left', flex: 1 }} title={t.reasoning.join(' · ')}>
                        {t.name}
                        <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}>
                          {' '}
                          {t.position ?? ''}
                          {t.team ? ` · ${t.team}` : ''}
                          {t.marketValue != null ? ` · val ${t.marketValue.toLocaleString()}` : ''}
                        </span>{' '}
                        {t.fillsSlots.length > 0 ? (
                          <span className="bdx-sev ok">▲ fills {t.fillsSlots.join(' / ')}</span>
                        ) : null}
                      </span>
                      <span className="k" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {t.suggestedBid != null ? `bid ~$${t.suggestedBid}` : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="bdx-rail-empty">
                No market-relevant free agents right now — the pool is picked clean.
              </div>
            )}
          </div>

          {/* League history */}
          <div className="bdx-panelbox">
            <h3>How this room bids · {intel.history.claims} winning claims</h3>
            <div className="bdx-rows" style={{ marginBottom: 8 }}>
              <div className="bdx-row"><span className="k">Median winning bid</span><span className="x">{intel.history.medianBid != null ? `$${intel.history.medianBid}` : '—'}</span></div>
              <div className="bdx-row"><span className="k">75th percentile</span><span className="x">{intel.history.p75Bid != null ? `$${intel.history.p75Bid}` : '—'}</span></div>
              <div className="bdx-row"><span className="k">Biggest bid ever</span><span className="x">{intel.history.topBid != null ? `$${intel.history.topBid}` : '—'}</span></div>
            </div>
            {intel.history.recent.length > 0 ? (
              <>
                <div className="bdx-sub" style={{ marginBottom: 3 }}>Recent winners</div>
                <div className="bdx-rows">
                  {intel.history.recent.map((b, i) => (
                    <div className="bdx-row" key={i}>
                      <span className="x" style={{ textAlign: 'left', flex: 1, fontSize: 12 }}>
                        {b.playerName}
                        <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 10.5 }}>
                          {' '}{b.position ?? ''} · {b.season} wk {b.week}
                        </span>
                      </span>
                      <span className="k">${b.bid}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            <div className="bdx-rail-empty" style={{ marginTop: 8 }}>
              {intel.formulaNotes.join(' ')}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default WaiverIntel
