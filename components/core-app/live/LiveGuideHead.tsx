'use client'

import { useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { liveGuideMessages } from '@/lib/core-app/messages/liveGuide'
import type { LiveChip, LiveMoment } from '@/lib/live/liveGuide'
import '@/components/core-app/home/af-home-guide.css'
import '@/components/core-app/live/af-live-guide.css'

/**
 * The headline of /core/live (2026-11-13): what the page is for, what is happening for you right now,
 * and up to four numbers that each jump to the section that explains them. It replaced the
 * "Live Scores" title and its one-line lede, which said what the page lists but never why to open it.
 *
 * LiveScores still draws the title through the shared PageHeader (core-primitives-rollout), so the
 * page keeps exactly one h1; these are its parts.
 */

/** Weekday and clock time in the reader's own zone — only after hydration, as the rest of /core does. */
function useLocalWhen(iso: string | null): string | null {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    if (!iso) {
      setText(null)
      return
    }
    try {
      setText(new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)))
    } catch {
      setText(null)
    }
  }, [iso])
  return text
}

function ChipView({ chip, t }: { chip: LiveChip; t: Text }) {
  const when = useLocalWhen(chip.key === 'next' ? chip.at : null)
  const value = chip.key === 'next' ? (when ?? '—') : String(chip.value)
  const label =
    chip.key === 'playing'
      ? t.chipPlaying
      : chip.key === 'behind'
        ? t.chipBehind
        : chip.key === 'close'
          ? t.chipClose
          : chip.key === 'next'
            ? t.chipNext
            : t.chipDone
  // Same tone vocabulary as the home and week headlines: warn = red, info = accent, ok = muted.
  const tone =
    chip.key === 'behind' && chip.tone === 'bad'
      ? 'warn'
      : (chip.key === 'close' && chip.tone === 'warn') || (chip.key === 'playing' && chip.tone === 'live')
        ? 'info'
        : 'ok'
  const body = (
    <>
      <b suppressHydrationWarning>{value}</b>
      <span>{label}</span>
    </>
  )
  return chip.href ? (
    <a className="af-hg-chip" data-tone={tone} data-chip={chip.key} href={chip.href}>
      {body}
    </a>
  ) : (
    <span className="af-hg-chip af-lg-chip" data-tone={tone} data-chip={chip.key}>
      {body}
    </span>
  )
}

type Text = (typeof liveGuideMessages)['en']

/** The headline sentence for the moment. The h1 itself is drawn by PageHeader in LiveScores. */
export function liveGuideTitle(moment: LiveMoment, t: Text): string {
  return moment.kind === 'live'
    ? t.headLive(moment.playing)
    : moment.kind === 'between'
      ? t.headBetween
      : moment.kind === 'no-roster'
        ? t.headNoRoster
        : t.headRosterFailed
}

export function LiveGuideEyebrow({ moment, sportLabel, leagueScoped }: { moment: LiveMoment; sportLabel: string; leagueScoped: boolean }) {
  const t = useMessages(liveGuideMessages)
  return (
    <>
      {moment.kind === 'live' ? <span className="af-lg-dot" aria-hidden /> : null}
      {t.eyebrow(sportLabel, leagueScoped)}
    </>
  )
}

/** Up to four numbers, each said once on the page and each jumping to the section that explains it. */
export function LiveGuideChips({ chips }: { chips: LiveChip[] }) {
  const t = useMessages(liveGuideMessages)
  if (chips.length === 0) return null
  return (
    <ul className="af-hg-chips af-lg-chips">
      {chips.map((c) => (
        <li key={c.key}>
          <ChipView chip={c} t={t} />
        </li>
      ))}
    </ul>
  )
}
