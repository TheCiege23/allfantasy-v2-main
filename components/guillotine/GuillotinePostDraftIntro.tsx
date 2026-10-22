'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY_PREFIX = 'guillotine_post_draft_intro_seen_'
const INTRO_VIDEO_SRC = '/guillotine/Guillotine%20League%20Intro.mp4'

export interface GuillotinePostDraftIntroProps {
  leagueId: string
  /** Call when user dismisses (Continue). */
  onContinue: () => void
}

export function GuillotinePostDraftIntro({ leagueId, onContinue }: GuillotinePostDraftIntroProps) {
  const [show, setShow] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!leagueId || typeof window === 'undefined') {
      setChecked(true)
      return
    }
    try {
      const seen = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${leagueId}`)
      setShow(!seen)
    } catch {
      setShow(true)
    }
    setChecked(true)
  }, [leagueId])

  const handleContinue = useCallback(() => {
    if (typeof window !== 'undefined' && leagueId) {
      try {
        window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${leagueId}`, '1')
      } catch {}
    }
    setShow(false)
    onContinue()
  }, [leagueId, onContinue])

  if (!checked || !show) return null

  return (
    <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="mb-3 text-lg font-semibold text-white">Guilly League — Intro</h2>
      <p className="mb-4 text-sm text-white/70">
        Your draft is complete. Watch a quick intro to how your Guilly League works.
      </p>
      <div className="rounded-xl overflow-hidden bg-black">
        <video
          className="w-full aspect-video"
          src={INTRO_VIDEO_SRC}
          controls
          playsInline
        />
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={handleContinue}
          className="rounded-lg bg-cyan-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
        >
          Continue
        </button>
      </div>
    </section>
  )
}
