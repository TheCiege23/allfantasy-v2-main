'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FirstEntryIntroShell, useFirstEntryIntro } from '@/components/league/FirstEntryIntroShell'
import { SURVIVOR_LEAGUE_INTRO_VIDEO } from '@/lib/survivor/constants'
import { SURVIVOR_ISLAND_TAGLINE } from '@/lib/survivor/survivorIslandContent'
import { getSurvivorThemeById } from '@/lib/survivor/survivorVisuals'
import { firstEntryIntroStorageKey } from '@/lib/league/post-create-welcome'
import type { SurvivorRulesSection, SurvivorRulesTopic } from '@/lib/survivor/survivorRulesAnswers'
import { useSurvivorRulebook } from '@/lib/survivor/useSurvivorRulebook'

export interface SurvivorFirstEntryModalProps {
  leagueId: string
  userId: string
  /** When false, never evaluate visibility. */
  enabled: boolean
  onClose: () => void
  videoSrc?: string
  forceReplay?: boolean
  visualThemeId?: string | null
}

type Step = { title: string; lines: string[] }

/** Shown until the league's own rules load, or if they cannot be read. True for every league. */
const FALLBACK: Record<'tribe' | 'voting' | 'idols' | 'exile', string[]> = {
  tribe: ['You are on a tribe. Your fantasy points add to the tribe total each week.', 'The top-scoring tribe is safe. The lowest-scoring tribe goes to Tribal Council.'],
  voting: ['At Tribal Council the tribe votes someone out.', 'Votes are private: send @Chimmy vote @manager. Nobody sees them until the read.'],
  idols: ['Some players carry a hidden idol. If one of yours does, Chimmy tells you privately.', 'Play it before votes are read to stay safe.'],
  exile: ['After the merge everyone plays for themselves, and voted-out managers can form the jury that picks the winner.'],
}

function pick(sections: SurvivorRulesSection[] | null, topics: SurvivorRulesTopic[], max: number): string[] | null {
  if (!sections) return null
  const lines = topics.flatMap(topic => sections.find(section => section.topic === topic)?.lines ?? [])
  return lines.length ? lines.slice(0, max).map(line => line.replace(/\*\*/g, '')) : null
}

/**
 * The first visit to a Survivor league: about a minute of cards (tribes, voting, idols, then Exile
 * and the jury), each built from THIS league's settings, then a pointer to the rules page and
 * Chimmy. The trailer is optional rather than autoplaying.
 */
export function SurvivorFirstEntryModal({
  leagueId,
  userId,
  enabled,
  onClose,
  videoSrc = SURVIVOR_LEAGUE_INTRO_VIDEO,
  forceReplay = false,
  visualThemeId,
}: SurvivorFirstEntryModalProps) {
  const [step, setStep] = useState(0)
  const [showVideo, setShowVideo] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)

  const storageKey = firstEntryIntroStorageKey('survivor', leagueId, userId)
  const theme = getSurvivorThemeById(visualThemeId, leagueId)

  const { visible, dismiss: handleDismiss } = useFirstEntryIntro({
    storageKey,
    enabled: enabled && Boolean(leagueId && userId),
    forceReplay,
    onClose,
  })
  const { sections } = useSurvivorRulebook(leagueId, visible)

  if (!visible) return null

  const steps: Step[] = [
    { title: 'Your tribe', lines: pick(sections, ['immunity'], 2) ?? FALLBACK.tribe },
    { title: 'Tribal Council', lines: pick(sections, ['voting'], 3) ?? FALLBACK.voting },
    { title: 'Idols', lines: pick(sections, ['idols'], 3) ?? FALLBACK.idols },
    { title: 'Exile Island and the jury', lines: pick(sections, ['exile', 'jury'], 3) ?? FALLBACK.exile },
  ]
  const last = step === steps.length
  const current = last ? null : steps[step]

  return (
    <FirstEntryIntroShell
      ariaLabel="Survivor League intro"
      onDismiss={handleDismiss}
      cardClassName="border border-amber-500/25 bg-[#050a14]"
      closeTestId="survivor-intro-close"
    >
      <div className={`absolute inset-0 ${theme.backgroundClass} opacity-95`} />
      <div className="relative border-b border-amber-500/20 bg-gradient-to-r from-amber-950/40 to-transparent px-4 py-3">
        <p className="text-[15px] font-bold text-amber-100">Welcome to the island</p>
        <p className="mt-1 text-[12px] leading-snug text-white/60">{SURVIVOR_ISLAND_TAGLINE}</p>
        <ol className="mt-3 flex gap-1.5" aria-label="Intro progress">
          {[...steps, null].map((_, index) => (
            <li key={index} aria-current={index === step ? 'step' : undefined}
              className={`h-1.5 flex-1 rounded-full ${index <= step ? 'bg-amber-400' : 'bg-white/15'}`} />
          ))}
        </ol>
      </div>

      <div className="relative min-h-[220px] px-4 py-4" data-testid="survivor-intro-step">
        {current ? (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Step {step + 1} of {steps.length}</p>
            <h2 className="mt-1 text-lg font-bold text-white">{current.title}</h2>
            <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-white/75">
              {current.lines.map(line => <li key={line} className="flex gap-2"><span aria-hidden className="text-amber-400/90">•</span><span>{line}</span></li>)}
            </ul>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-white">You are ready</h2>
            <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-white/75">
              <li>The full rules for this league are always on the <Link href={`/survivor/${leagueId}/rules`} className="font-semibold text-amber-200 underline" onClick={handleDismiss}>Rules page</Link>.</li>
              <li>Stuck? <Link href={`/survivor/${leagueId}/chimmy`} className="font-semibold text-violet-200 underline" onClick={handleDismiss}>Ask Chimmy</Link>. Answers are private.</li>
              <li>The game is always on. Guard your information.</li>
            </ul>
            {!showVideo ? (
              <button type="button" onClick={() => { setVideoFailed(false); setShowVideo(true) }} className="mt-4 text-[12px] font-semibold text-white/70 underline">
                Watch the trailer
              </button>
            ) : !videoFailed ? (
              <video className="mt-4 aspect-video w-full rounded-lg bg-black" src={videoSrc} controls autoPlay muted playsInline onError={() => setVideoFailed(true)} />
            ) : (
              <p className="mt-4 text-[12px] text-white/50">The trailer is not available right now.</p>
            )}
          </>
        )}
      </div>

      <div className="relative flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] bg-white/[0.04] p-4">
        <button type="button" disabled={step === 0} onClick={() => setStep(value => Math.max(0, value - 1))}
          className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10 disabled:opacity-30">
          Back
        </button>
        <div className="flex gap-2">
          {!last ? (
            <>
              <button type="button" onClick={handleDismiss} data-testid="survivor-intro-continue"
                className="rounded-lg px-3 py-2 text-sm font-medium text-white/60 hover:text-white">
                Skip
              </button>
              <button type="button" onClick={() => setStep(value => value + 1)} data-testid="survivor-intro-next"
                className="rounded-lg bg-amber-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">
                Next
              </button>
            </>
          ) : (
            <button type="button" onClick={handleDismiss} data-testid="survivor-intro-continue"
              className="rounded-lg bg-amber-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">
              Let&apos;s play
            </button>
          )}
        </div>
      </div>
    </FirstEntryIntroShell>
  )
}
