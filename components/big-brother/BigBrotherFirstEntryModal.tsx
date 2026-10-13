'use client'

import { useState, useEffect, useCallback } from 'react'
import { firstEntryIntroStorageKey } from '@/lib/league/post-create-welcome'

const BIG_BROTHER_INTRO_VIDEO = '/league-type-big-brother-intro.mp4'

const BIG_BROTHER_TAGLINE = 'Welcome to the Big Brother house. Expect the unexpected.'

const BIG_BROTHER_WELCOME =
  'Each week, one houseguest becomes Head of Household and nominates two players for eviction. ' +
  'A Veto competition gives someone the power to save a nominee. ' +
  'Then the house votes. One player is evicted. Their roster hits waivers. ' +
  'Survive long enough and you might make the jury — or the finale.'

const BIG_BROTHER_TIPS = [
  'The Head of Household (HOH) nominates two players for eviction each week.',
  'Six players compete in the Veto competition — the winner can save a nominee.',
  'If a nominee is saved, the HOH must name a replacement.',
  'Voting is private — only the final tally is revealed at eviction.',
  'Evicted players\u2019 rosters are released to waivers.',
  'After enough evictions, eliminated players become jury members.',
  'The jury votes for the winner at the finale — social game matters!',
  'Fantasy scoring still drives HOH and Veto — set your lineup every week.',
]

export interface BigBrotherFirstEntryModalProps {
  leagueId: string
  userId: string
  enabled: boolean
  onClose: () => void
  videoSrc?: string
  forceReplay?: boolean
}

export function BigBrotherFirstEntryModal({
  leagueId,
  userId,
  enabled,
  onClose,
  videoSrc = BIG_BROTHER_INTRO_VIDEO,
  forceReplay = false,
}: BigBrotherFirstEntryModalProps) {
  const [visible, setVisible] = useState(false)
  const [videoKey, setVideoKey] = useState(0)
  const [videoFailed, setVideoFailed] = useState(false)

  const storageKey = firstEntryIntroStorageKey('big_brother', leagueId, userId)

  const markSeen = useCallback(() => {
    if (typeof window !== 'undefined' && leagueId && userId) {
      try {
        window.localStorage.setItem(storageKey, '1')
      } catch { /* ignore */ }
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
    if (!enabled || !leagueId || !userId) {
      setVisible(false)
      return
    }
    if (forceReplay) {
      setVisible(true)
      return
    }
    try {
      const seen = typeof window !== 'undefined' && window.localStorage.getItem(storageKey)
      setVisible(!seen)
    } catch {
      setVisible(true)
    }
  }, [enabled, leagueId, userId, storageKey, forceReplay])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/92 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Big Brother League intro"
    >
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-cyan-500/25 bg-[#050a14] shadow-2xl">
        {/* Header */}
        <div className="border-b border-cyan-500/20 bg-gradient-to-r from-cyan-950/50 via-purple-950/30 to-transparent px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/40 text-lg">
              <span role="img" aria-label="eye">&#128065;</span>
            </div>
            <div>
              <p className="text-[15px] font-bold text-cyan-100">Big Brother</p>
              <p className="text-[11px] text-white/50">{BIG_BROTHER_TAGLINE}</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/50">{BIG_BROTHER_WELCOME}</p>
        </div>

        {/* Video */}
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
          <div className="flex aspect-video flex-col items-center justify-center bg-gradient-to-b from-[#030816] to-[#0a0520] px-6 text-center">
            <div className="mb-3 text-5xl">&#128065;</div>
            <p className="text-sm font-semibold text-cyan-200">Big Brother League</p>
            <p className="mt-1 text-xs text-white/50">HOH / Nominations / Veto / Eviction / Jury</p>
            <p className="mt-3 text-[11px] text-white/40">
              Intro video not found. Add it at{' '}
              <span className="font-mono text-cyan-300/70">public/league-type-big-brother-intro.mp4</span>
            </p>
          </div>
        )}

        {/* Tips */}
        <div className="max-h-[28vh] overflow-y-auto border-t border-white/[0.06] bg-[#040914] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">How it works</p>
          <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-white/55">
            {BIG_BROTHER_TIPS.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="text-cyan-400/90" aria-hidden>&#8226;</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] bg-white/[0.04] p-4">
          <button
            type="button"
            onClick={handleReplay}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
          >
            Replay
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-lg bg-gradient-to-r from-cyan-600/90 to-purple-600/90 px-4 py-2 text-sm font-medium text-white hover:from-cyan-600 hover:to-purple-600"
            data-testid="bb-intro-continue"
          >
            Enter the house
          </button>
        </div>
      </div>
    </div>
  )
}
