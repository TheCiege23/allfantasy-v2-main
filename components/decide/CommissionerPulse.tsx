'use client'

/**
 * CommissionerPulse — commissioner-only card flagging inactive/at-risk
 * managers from counted signals (empty starters, transaction drought, scoring
 * trend, orphan rosters). Every flag lists its exact signals; the method line
 * renders verbatim.
 */

import { useEffect, useState } from 'react'
import { sleeperAvatarThumb } from '@/lib/sports-data/headshots'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
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
  const { t } = useOptionalLanguage()
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
        <h2 className="bdx-disp">{t('decide.pulse.commTitle')}</h2>
        <span className="bdx-sub">
          {pulse
            ? pulse.flaggedCount > 0
              ? t(pulse.flaggedCount === 1 ? 'decide.pulse.flaggedOne' : 'decide.pulse.flaggedMany').replace('{{count}}', String(pulse.flaggedCount))
              : t('decide.pulse.allAlive')
            : t('decide.pulse.tagline')}
        </span>
      </div>
      {loading ? (
        <div className="bdx-skel" />
      ) : !pulse ? (
        <div className="bdx-empty">
          <div className="t">{t('decide.pulse.unavailableTitle')}</div>
          <div className="m">{t('decide.pulse.unavailableMsg')}</div>
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
                        <span className="bdx-sev warn">{t('decide.pulse.signals').replace('{{count}}', String(m.signals.length))}</span>
                      </div>
                      <div className="bdx-line">{m.signals.join(' · ')}</div>
                    </div>
                  )
                })}
            </div>
          ) : (
            <div className="bdx-empty" style={{ marginBottom: 8 }}>
              <div className="t">{t('decide.pulse.noFlagsTitle')}</div>
              <div className="m">{t('decide.pulse.noFlagsMsg')}</div>
            </div>
          )}
          <div className="bdx-rail-empty">{pulse.method}</div>
        </>
      )}
    </div>
  )
}

export default CommissionerPulse
