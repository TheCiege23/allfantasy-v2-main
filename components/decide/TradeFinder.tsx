'use client'

/**
 * TradeFinder — "offers likely to get accepted" panel on the Decide tab, from
 * /api/league/trade-finder.
 *
 * Honesty contract: every proposal shows its full rationale (checkable facts:
 * which slot it fills, the ADP gap, the partner's counted trade activity), the
 * method line renders verbatim, and the panel is explicit that market ADP is a
 * conversation starter — not an AF valuation verdict. Honest empty states for
 * unlinked accounts and no-match rosters.
 */

import { useEffect, useState } from 'react'
import type { TradeFinderPayload } from '@/lib/trade-intel/tradeFinderService'
import { sleeperAvatarThumb, sleeperPlayerHeadshot } from '@/lib/sports-data/headshots'
import './broadcast-deck.css'

type ApiResponse =
  | { supported: false; platform: string }
  | { supported: true; linked: false; finder: null }
  | { supported: true; linked: true; finder: TradeFinderPayload | null; error?: string }

function PlayerChip({
  playerId,
  name,
  position,
  team,
  adp,
  marketValue = null,
}: {
  playerId: string
  name: string
  position: string | null
  team: string | null
  adp: number
  marketValue?: number | null
}) {
  const src = sleeperPlayerHeadshot(playerId)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', background: '#1c2153' }}
          onError={(e) => e.currentTarget.style.setProperty('display', 'none')}
        />
      ) : null}
      <b>{name}</b>
      <span style={{ color: 'var(--bdx-ink-ghost)', fontSize: 11 }}>
        {position ?? ''}
        {team ? ` · ${team}` : ''}
        {marketValue != null ? ` · val ${marketValue.toLocaleString()}` : ''} · ADP {adp.toFixed(1)}
      </span>
    </span>
  )
}

export function TradeFinder({
  leagueId,
  onOpenTab,
}: {
  leagueId: string
  onOpenTab: (tabId: string) => void
}) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetch(`/api/league/trade-finder?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => res.json() as Promise<ApiResponse>)
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch(() => {
        if (!cancelled) setData({ supported: true, linked: true, finder: null, error: 'Request failed' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  // Non-sleeper leagues: render nothing rather than a dead panel.
  if (data && !data.supported) return null

  const finder = data && data.supported && 'finder' in data ? data.finder : null

  return (
    <div data-testid="trade-finder" style={{ marginTop: 18 }}>
      <div className="bdx-kick">
        <h2 className="bdx-disp">Trade finder</h2>
        <span className="bdx-sub">
          {finder
            ? `${finder.proposals.length} suggestion${finder.proposals.length === 1 ? '' : 's'} · both sides must gain`
            : 'offers built from real rosters + your format’s market'}
        </span>
      </div>

      {loading ? (
        <div className="bdx-skel" />
      ) : data && data.supported && 'linked' in data && data.linked === false ? (
        <div className="bdx-empty">
          <div className="t">Link your Sleeper account to get trade suggestions</div>
          <div className="m">
            The finder matches YOUR roster&apos;s gaps against every other manager&apos;s tradeable
            depth — it needs to know which team is yours first.
          </div>
        </div>
      ) : !finder ? (
        <div className="bdx-empty">
          <div className="t">Trade finder temporarily unavailable</div>
          <div className="m">The roster or market feed didn&apos;t answer — try again shortly.</div>
        </div>
      ) : !finder.viewer.inLeague ? (
        <div className="bdx-empty">
          <div className="t">Your Sleeper account isn&apos;t on a roster in this league</div>
          <div className="m">Suggestions need a roster to build from.</div>
        </div>
      ) : finder.proposals.length === 0 ? (
        <div className="bdx-empty">
          <div className="t">No fair complementary trades found right now</div>
          <div className="m">
            {finder.viewer.openSlots.length > 0 || finder.viewer.weakSlots.length > 0
              ? `You have needs (${[...finder.viewer.openSlots, ...finder.viewer.weakSlots.map((w) => w.slot)].join(', ')}), but no league-mate currently has matching tradeable depth inside the fairness band — the engine won't invent a lopsided offer to fill the space.`
              : 'Every starter slot on your roster is covered by market-relevant players — nothing needs forcing.'}
          </div>
        </div>
      ) : (
        <>
          {finder.proposals.map((p, i) => {
            const partnerAvatar = sleeperAvatarThumb(p.partner.avatar)
            return (
              <div className="bdx-card c-info" style={{ marginBottom: 10 }} key={`${p.partner.ownerId}-${p.get.playerId}-${i}`}>
                <div className="bdx-head">
                  <span className="bdx-kind">
                    Offer idea · to{' '}
                    {partnerAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={partnerAvatar}
                        alt=""
                        style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', verticalAlign: '-3px' }}
                      />
                    ) : null}{' '}
                    {p.partner.name}
                  </span>
                  {p.partner.completedTrades > 0 ? (
                    <span className="bdx-sev ok">↔ {p.partner.completedTrades} career trades</span>
                  ) : null}
                  <span className="bdx-when">
                    {p.valueGapPct != null
                      ? `value gap ${p.valueGapPct.toFixed(1)}%`
                      : `ADP gap ${p.adpGap.toFixed(1)}`}
                  </span>
                </div>
                <div className="bdx-line" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--bdx-ink-faint)' }}>You send</span>
                  <PlayerChip {...p.give} />
                  <span style={{ color: 'var(--bdx-ink-faint)' }}>⇄ you get</span>
                  <PlayerChip {...p.get} />
                </div>
                <ul className="bdx-why" style={{ marginTop: 8 }}>
                  {p.rationale.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <div className="bdx-acts">
                  <button type="button" className="bdx-btn pri" onClick={() => onOpenTab('trades')}>
                    Build it in Trade Center
                  </button>
                </div>
              </div>
            )
          })}
          <div className="bdx-empty" style={{ marginTop: 4 }}>
            <div className="m">
              <b>Method:</b> {finder.method}
              {finder.contextNotes.map((n) => (
                <span key={n}>
                  <br />
                  {n}
                </span>
              ))}
              {finder.missing.length > 0 ? (
                <>
                  <br />couldn&apos;t sync: {finder.missing.join(', ')}
                </>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default TradeFinder
