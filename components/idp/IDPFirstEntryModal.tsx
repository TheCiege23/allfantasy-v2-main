'use client'

import { useState, useEffect, useCallback } from 'react'
import { firstEntryIntroStorageKey } from '@/lib/league/post-create-welcome'

const IDP_INTRO_VIDEO = '/league-type-idp-intro.mp4'

const IDP_TAGLINE = 'Individual Defensive Players. Real defenders. Real points.'

const IDP_WELCOME =
  'This league rosters individual defensive players alongside your offense. ' +
  'Linebackers, defensive linemen, and defensive backs earn fantasy points from tackles, sacks, interceptions, and more. ' +
  'Your defensive roster is just as important as your offensive one.'

const IDP_TIPS = [
  'IDP positions: DL (defensive line), LB (linebacker), DB (defensive back).',
  'Advanced modes split into: DE, DT, LB, CB, S for more granular roster builds.',
  'IDP FLEX slots accept any defensive position \u2014 use them for your best available defender.',
  'Scoring styles vary: balanced, tackle-heavy, or big-play-heavy. Check your league settings.',
  'High-tackle LBs are the safest weekly floor. Sack-specialist DEs are boom/bust.',
  'DBs score from interceptions and pass breakups \u2014 stream matchups against pass-heavy offenses.',
  'Draft IDP players in the middle rounds. Don\u2019t reach early, but don\u2019t ignore them either.',
  'Waivers matter for IDP \u2014 defensive snap counts and matchups change weekly.',
]

export interface IDPFirstEntryModalProps {
  leagueId: string
  userId: string
  enabled: boolean
  onClose: () => void
  videoSrc?: string
  forceReplay?: boolean
}

export function IDPFirstEntryModal({
  leagueId,
  userId,
  enabled,
  onClose,
  videoSrc = IDP_INTRO_VIDEO,
  forceReplay = false,
}: IDPFirstEntryModalProps) {
  const [visible, setVisible] = useState(false)
  const [videoKey, setVideoKey] = useState(0)
  const [videoFailed, setVideoFailed] = useState(false)

  const storageKey = firstEntryIntroStorageKey('idp', leagueId, userId)

  const markSeen = useCallback(() => {
    if (typeof window !== 'undefined' && leagueId && userId) {
      try { window.localStorage.setItem(storageKey, '1') } catch { /* ignore */ }
    }
  }, [leagueId, userId, storageKey])

  const handleDismiss = useCallback(() => {
    markSeen()
    setVisible(false)
    onClose()
  }, [markSeen, onClose])

  const handleReplay = useCallback(() => {
    setVideoFailed(false)
    setVideoKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!enabled || !leagueId || !userId) { setVisible(false); return }
    if (forceReplay) { setVisible(true); return }
    try {
      const seen = typeof window !== 'undefined' && window.localStorage.getItem(storageKey)
      setVisible(!seen)
    } catch { setVisible(true) }
  }, [enabled, leagueId, userId, storageKey, forceReplay])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/92 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="IDP League intro"
    >
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-emerald-500/25 bg-[#050a14] shadow-2xl">
        <div className="border-b border-emerald-500/20 bg-gradient-to-r from-emerald-950/40 to-transparent px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-950/40 text-lg font-bold text-emerald-400">
              IDP
            </div>
            <div>
              <p className="text-[15px] font-bold text-emerald-100">IDP League</p>
              <p className="text-[11px] text-white/50">{IDP_TAGLINE}</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/50">{IDP_WELCOME}</p>
        </div>

        {!videoFailed ? (
          <video
            key={videoKey}
            className="aspect-video w-full bg-black"
            src={videoSrc}
            controls
            autoPlay
            muted
            playsInline
            onError={() => setVideoFailed(true)}
            onEnded={handleDismiss}
          />
        ) : (
          <div className="flex aspect-video flex-col items-center justify-center bg-gradient-to-b from-[#030816] to-[#05120a] px-6 text-center">
            <div className="mb-3 text-4xl font-extrabold text-emerald-500/60">IDP</div>
            <p className="text-sm font-semibold text-emerald-200">Individual Defensive Players</p>
            <p className="mt-1 text-xs text-white/50">DL / LB / DB / IDP FLEX</p>
            <p className="mt-3 text-[11px] text-white/40">
              Intro video not found. Add it at{' '}
              <span className="font-mono text-emerald-300/70">public/league-type-idp-intro.mp4</span>
            </p>
          </div>
        )}

        <div className="max-h-[28vh] overflow-y-auto border-t border-white/[0.06] bg-[#040914] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">IDP basics</p>
          <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-white/55">
            {IDP_TIPS.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="text-emerald-400/90" aria-hidden>&#8226;</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] bg-white/[0.04] p-4">
          <button type="button" onClick={handleReplay} className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10">
            Replay
          </button>
          <button type="button" onClick={handleDismiss} className="rounded-lg bg-emerald-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600" data-testid="idp-intro-continue">
            Let's go
          </button>
        </div>
      </div>
    </div>
  )
}
