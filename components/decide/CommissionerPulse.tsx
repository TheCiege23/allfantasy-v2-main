'use client'

/**
 * CommissionerPulse — commissioner-only card flagging inactive/at-risk
 * managers from counted signals (empty starters, transaction drought, scoring
 * trend, orphan rosters). Every flag lists its exact signals; the method line
 * renders verbatim.
 */

import { useEffect, useState } from 'react'
import { sleeperAvatarThumb } from '@/lib/sports-data/headshots'
import './broadcast-deck.css'

type PulseManager = {
  rosterId: number
  ownerId: string | null
  name: string
  teamName: string | null
  avatar: string | null
  emptyStarters: number
  daysSinceTx: number | null
  trend: 'up' | 'down' | 'flat' | null
  signals: string[]
  flagged: boolean
}
type ApiResponse =
  | { supported: false; platform: string }
  | {
      supported: true
      pulse: { flaggedCount: number; managers: PulseManager[]; method: string } | null
      error?: string
    }

export function CommissionerPulse({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetch(`/api/league/commissioner-pulse?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => res.json() as Promise<ApiResponse>)
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch(() => {
        if (!cancelled) setData({ supported: true, pulse: null, error: 'Request failed' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (data && !data.supported) return null
  const pulse = data && data.supported ? data.pulse : null

  return (
    <div data-testid="commissioner-pulse" style={{ marginTop: 18 }}>
      <div className="bdx-kick">
        <h2 className="bdx-disp">Commissioner pulse</h2>
        <span className="bdx-sub">
          {pulse
            ? pulse.flaggedCount > 0
              ? `${pulse.flaggedCount} manager${pulse.flaggedCount === 1 ? '' : 's'} need${pulse.flaggedCount === 1 ? 's' : ''} a look`
              : 'every roster looks alive'
            : 'inactivity signals, counted not guessed'}
        </span>
      </div>
      {loading ? (
        <div className="bdx-skel" />
      ) : !pulse ? (
        <div className="bdx-empty">
          <div className="t">Pulse temporarily unavailable</div>
          <div className="m">The league feed didn&apos;t answer — try again shortly.</div>
        </div>
      ) : (
        <>
          {pulse.managers.filter((m) => m.flagged).length > 0 ? (
            <div className="bdx-rows" style={{ marginBottom: 8 }}>
              {pulse.managers
                .filter((m) => m.flagged)
                .map((m) => {
                  const av = sleeperAvatarThumb(m.avatar)
                  return (
                    <div className="bdx-card c-warn" style={{ marginBottom: 8 }} key={m.rosterId}>
                      <div className="bdx-head">
                        <span className="bdx-kind">
                          {av ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={av}
                              alt=""
                              style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', verticalAlign: '-3px', marginRight: 5 }}
                            />
                          ) : null}
                          {m.name}
                          {m.teamName ? (
                            <span style={{ color: 'var(--bdx-ink-ghost)', fontWeight: 400 }}> · {m.teamName}</span>
                          ) : null}
                        </span>
                        <span className="bdx-sev warn">⚠ {m.signals.length} signals</span>
                      </div>
                      <div className="bdx-line">{m.signals.join(' · ')}</div>
                    </div>
                  )
                })}
            </div>
          ) : (
            <div className="bdx-empty" style={{ marginBottom: 8 }}>
              <div className="t">No inactivity flags this week</div>
              <div className="m">Every roster has a full lineup and recent activity.</div>
            </div>
          )}
          <div className="bdx-rail-empty">{pulse.method}</div>
        </>
      )}
    </div>
  )
}

export default CommissionerPulse
