'use client'

import { useState, useCallback } from 'react'
import { FirstEntryIntroShell, useFirstEntryIntro } from '@/components/league/FirstEntryIntroShell'
import { firstEntryIntroStorageKey } from '@/lib/league/post-create-welcome'

const DEVY_INTRO_VIDEO = '/league-type-devy-intro.mp4'
const C2C_INTRO_VIDEO = '/league-type-c2c-intro.mp4'

const DEVY_TAGLINE = 'Draft the future. Dynasty starts in college.'
const C2C_TAGLINE = 'One franchise. College and pro stars in the same war room.'

const DEVY_WELCOME =
  'Devy Dynasty is a dynasty-only format where you draft and stash college players alongside your pro roster. ' +
  'Build your pipeline years in advance — when they graduate and get drafted to the pros, they promote to your active roster. ' +
  'Three separate drafts: startup veterans, annual rookie, and annual devy.'

const C2C_WELCOME =
  'Campus to Canton (C2C) blends college and pro assets into one franchise. ' +
  'Set your college pipeline, promote talent at the right time, and win both now and later.'

const DEVY_TIPS = [
  'Devy slots hold college players who haven\u2019t been drafted to the pros yet.',
  'Taxi squad stashes young pro players without using a bench spot.',
  'Three draft types: startup vet (once), annual rookie, and annual devy.',
  'When a devy player declares and gets drafted, they promote to your pro roster.',
  'Promotion timing depends on your league settings \u2014 immediate, rollover, or manager choice.',
  'College players in devy slots do NOT score fantasy points until promoted.',
  'Draft capital matters \u2014 devy picks and rookie picks are both tradeable assets.',
  'NFL devy pools NCAA football (QB, RB, WR, TE). NBA devy pools NCAA basketball (G, F, C).',
]

const C2C_TIPS = [
  'C2C combines college development with pro lineup management in one league.',
  'Startup draft type can be snake, linear, or auction, depending on commissioner settings.',
  'Taxi and devy buckets are for development only and do not count toward official weekly score.',
  'Official weekly scoring comes from eligible starter buckets only.',
  'College and pro phases can run merged or separate, based on league setup.',
  'Use promotions strategically to move players from college rights into pro impact windows.',
]

export interface DevyFirstEntryModalProps {
  leagueId: string
  userId: string
  enabled: boolean
  onClose: () => void
  videoSrc?: string
  mode?: 'devy' | 'c2c'
  forceReplay?: boolean
}

export function DevyFirstEntryModal({
  leagueId,
  userId,
  enabled,
  onClose,
  videoSrc = DEVY_INTRO_VIDEO,
  mode = 'devy',
  forceReplay = false,
}: DevyFirstEntryModalProps) {
  const [videoKey, setVideoKey] = useState(0)
  const [videoFailed, setVideoFailed] = useState(false)

  const storageKey = firstEntryIntroStorageKey(mode === 'c2c' ? 'c2c' : 'devy', leagueId, userId)
  const resolvedVideoSrc = videoSrc || (mode === 'c2c' ? C2C_INTRO_VIDEO : DEVY_INTRO_VIDEO)
  const tagline = mode === 'c2c' ? C2C_TAGLINE : DEVY_TAGLINE
  const welcome = mode === 'c2c' ? C2C_WELCOME : DEVY_WELCOME
  const tips = mode === 'c2c' ? C2C_TIPS : DEVY_TIPS
  const title = mode === 'c2c' ? 'Campus to Canton (C2C)' : 'Devy Dynasty'
  const cta = mode === 'c2c' ? 'Enter your C2C league' : 'Build the pipeline'

  const { visible, dismiss: handleDismiss } = useFirstEntryIntro({
    storageKey,
    enabled: enabled && Boolean(leagueId && userId),
    forceReplay,
    onClose,
  })

  const handleReplay = useCallback(() => {
    setVideoFailed(false)
    setVideoKey((k) => k + 1)
  }, [])

  if (!visible) return null

  return (
    <FirstEntryIntroShell
      ariaLabel={mode === 'c2c' ? 'Campus to Canton intro' : 'Devy Dynasty intro'}
      onDismiss={handleDismiss}
      cardClassName="border border-violet-500/25 bg-[#050a14]"
      closeTestId="devy-intro-close"
    >
      <div className="border-b border-violet-500/20 bg-gradient-to-r from-violet-950/40 via-indigo-950/20 to-transparent px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-950/40 text-lg">
            <span role="img" aria-label="crystal ball">&#128302;</span>
          </div>
          <div>
            <p className="text-[15px] font-bold text-violet-100">{title}</p>
            <p className="text-[11px] text-white/50">{tagline}</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/50">{welcome}</p>
      </div>

      {!videoFailed ? (
        <video
          key={videoKey}
          className="aspect-video w-full bg-black"
          src={resolvedVideoSrc}
          controls
          autoPlay
          muted
          playsInline
          onError={() => setVideoFailed(true)}
          onEnded={handleDismiss}
        />
      ) : (
        <div className="flex aspect-video flex-col items-center justify-center bg-gradient-to-b from-[#030816] to-[#0a0520] px-6 text-center">
          <div className="mb-3 text-5xl">&#128302;</div>
          <p className="text-sm font-semibold text-violet-200">{title}</p>
          <p className="mt-1 text-xs text-white/50">
            {mode === 'c2c' ? 'College + Pro unified pipeline' : 'Startup / Rookie / Devy Drafts'}
          </p>
          <p className="mt-3 text-[11px] text-white/40">
            Intro video not found. Add it at{' '}
            <span className="font-mono text-violet-300/70">
              {mode === 'c2c' ? 'public/league-type-c2c-intro.mp4' : 'public/league-type-devy-intro.mp4'}
            </span>
          </p>
        </div>
      )}

      <div className="max-h-[28vh] overflow-y-auto border-t border-white/[0.06] bg-[#040914] px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
          {mode === 'c2c' ? 'How C2C works' : 'How devy works'}
        </p>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-white/55">
          {tips.map((t) => (
            <li key={t} className="flex gap-2">
              <span className="text-violet-400/90" aria-hidden>&#8226;</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] bg-white/[0.04] p-4">
        <button type="button" onClick={handleReplay} className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10">
          Replay
        </button>
        <button type="button" onClick={handleDismiss} className="rounded-lg bg-violet-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600" data-testid="devy-intro-continue">
          {cta}
        </button>
      </div>
    </FirstEntryIntroShell>
  )
}
