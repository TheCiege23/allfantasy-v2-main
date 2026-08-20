'use client'

/**
 * MatchupCenter — current-week matchups with live scores + projection-model
 * win probability (model text rendered verbatim). Me-highlight on the
 * viewer's matchup; pre-season/no-matchup states are honest.
 */

import { useEffect, useState } from 'react'
import type { MatchupCenterPayload, MatchupSide } from '@/lib/matchup-intel/matchupCenterService'
import { sleeperAvatarThumb } from '@/lib/sports-data/headshots'
import './broadcast-deck.css'

type ApiResponse =
  | { supported: false; platform: string }
  | { supported: true; viewerSleeperUserId: string | null; center: MatchupCenterPayload | null; error?: string }

function Side({ s, right = false }: { s: MatchupSide; right?: boolean }) {
  const av = sleeperAvatarThumb(s.avatar)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: right ? 'row-reverse' : 'row', flex: 1, minWidth: 0 }}>
      {av ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={av} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />
      ) : null}
      <div style={{ minWidth: 0, textAlign: right ? 'right' : 'left' }}>
        <div style={{ fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {s.teamName || s.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--bdx-ink-faint)', fontVariantNumeric: 'tabular-nums' }}>
          {s.actualPoints > 0 ? `${s.actualPoints.toFixed(1)} pts · ` : ''}
          proj {s.projectedPoints != null ? s.projectedPoints.toFixed(1) : '—'}
          {s.unprojectedStarters > 0 ? ` (${s.unprojectedStarters} unprojected)` : ''}
        </div>
      </div>
    </div>
  )
}

export function MatchupCenter({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetch(`/api/league/matchup-center?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => res.json() as Promise<ApiResponse>)
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch(() => {
        if (!cancelled) setData({ supported: true, viewerSleeperUserId: null, center: null, error: 'Request failed' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (data && !data.supported) return null
  const center = data && data.supported ? data.center : null
  const viewerId = data && data.supported ? data.viewerSleeperUserId : null
  if (!loading && (!center || center.matchups.length === 0)) return null

  return (
    <div data-testid="matchup-center" style={{ marginTop: 18 }}>
      <div className="bdx-kick">
        <h2 className="bdx-disp">Matchup center</h2>
        <span className="bdx-sub">
          {center ? `week ${center.week}${center.anyPointsScored ? ' · live scores' : ' · pre-kickoff'}` : ''}
        </span>
      </div>
      {loading || !center ? (
        <div className="bdx-skel" />
      ) : (
        <>
          <div className="bdx-support" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {center.matchups.map((m) => {
              const mine = viewerId && (m.a.ownerId === viewerId || m.b.ownerId === viewerId)
              return (
                <div
                  className="bdx-panelbox"
                  key={m.matchupId}
                  style={mine ? { borderColor: '#ff3d81', boxShadow: '0 0 18px rgba(255,61,129,0.12)' } : undefined}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Side s={m.a} />
                    <div style={{ textAlign: 'center', flex: 'none' }}>
                      {m.winProbA != null ? (
                        <>
                          <div style={{ fontSize: 17, fontWeight: 900, fontStyle: 'italic', fontVariantNumeric: 'tabular-nums' }}>
                            {m.winProbA.toFixed(0)}%
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--bdx-ink-ghost)' }}>vs {(100 - m.winProbA).toFixed(0)}%</div>
                        </>
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--bdx-ink-ghost)' }}>vs</div>
                      )}
                    </div>
                    <Side s={m.b} right />
                  </div>
                  {m.winProbA != null ? (
                    <div style={{ marginTop: 8, height: 4, borderRadius: 999, background: '#1c2153', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${m.winProbA}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg,#ff3d81,#ff8a3d)',
                        }}
                      />
                    </div>
                  ) : null}
                  {mine ? <div className="bdx-sub" style={{ marginTop: 6 }}>your matchup</div> : null}
                </div>
              )
            })}
          </div>
          <div className="bdx-empty" style={{ marginTop: 8 }}>
            <div className="m">{center.model}</div>
          </div>
        </>
      )}
    </div>
  )
}

export default MatchupCenter
